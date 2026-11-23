#!/usr/bin/env bash
# Déployer une version sur ce serveur.
#
#   deployer.sh --deposer <version>   l'entrée standard porte un paquet git
#   deployer.sh <version>             l'entrée standard porte, ou non, un jeton
#   deployer.sh --journal <réf>[,…]   relit les pannes citées, en lecture seule
#   deployer.sh --lectures <jours>    relit les lectures échouées, en lecture seule
#
# ================================================== LE SERVEUR NE DÉTIENT RIEN
#
# 12 octobre 2026. Le dépôt est passé sous l'organisation ALGORIA-FACTORY et le
# déploiement s'est arrêté net, pour une raison qui n'était pas celle qu'on
# croyait : l'organisation INTERDIT les clés de déploiement. La clé du serveur
# n'était ni expirée ni mal transférée — elle était interdite par une règle. Et
# ses identifiants de registre, un jeton personnel posé en clair dans un
# fichier, ne pouvaient plus lire les images devenues celles de l'organisation.
#
# Le déménagement fut l'occasion, pas la cause. Un serveur qui va CHERCHER son
# code et ses images a besoin d'un accès permanent au dépôt entier et au
# registre — exactement ce qu'une organisation raisonnable refuse, et
# exactement ce qu'on ne veut pas laisser sur une machine exposée.
#
# Le sens est donc inversé : la CI, qui vient de compiler, DÉPOSE le code
# (`--deposer`, un paquet git sur l'entrée standard) et prête un jeton de
# registre le temps d'un `pull` (l'entrée standard de `deployer`). Le serveur
# ne garde ni clé GitHub, ni jeton.
#
# Les images portent la même étiquette que le dépôt : la CI (images.yml) les
# publie, ce script les tire. Ce qu'il fait, dans l'ordre : le dépôt sur la
# version, .env qui la retient, les images, les migrations (le service
# `migrer`, dont l'API et le site attendent la fin), puis la sonde profonde
# par l'origine publique. Une sonde rouge est un déploiement raté : les
# journaux s'affichent et le code de sortie le dit.
#
# Revenir en arrière est le même geste avec la version d'avant — tant que les
# migrations restent « expansion puis contraction » (docs/exploitation.md).
#
# Lancé par la CI à travers porte-ssh.sh, ou à la main par l'utilisateur
# malica. Un seul déploiement à la fois.
set -euo pipefail

RACINE=/srv/malica
DEPOT=$RACINE/depot
ENV=$RACINE/.env

compose() {
  # Les profils actifs, lus dans le FICHIER d'environnement du serveur.
  #
  # Le second lecteur (`ocr`) est derriere un profil : present dans la
  # composition, demarre seulement si on le demande. Une ligne
  # `COMPOSE_PROFILES=ocr` dans le .env du serveur l'allume ; la retirer
  # l'eteint. Une seule ligne a changer le jour ou il faut rendre la main a
  # la machine.
  #
  # Lu dans le fichier, et non dans l'environnement : `--env-file` sert les
  # CONTENEURS, pas le shell qui lance compose. La premiere ecriture s'y est
  # trompee, et le profil n'aurait jamais ete vu.
  local profils
  profils="$(sed -n 's/^COMPOSE_PROFILES=//p' "$ENV" 2>/dev/null | tail -1 | tr -d '"'"'"'"'"'"'"'"'")"
  COMPOSE_PROFILES="$profils"     docker compose --project-directory "$DEPOT/infra" --env-file "$ENV" "$@"
}

# Importer le code que la CI envoie sur l'entrée standard.
#
# Le paquet est un « bundle » git : il porte les objets et la référence HEAD du
# commit à déployer. On l'écrit dans un fichier temporaire — git refuse de lire
# un bundle sur un tuyau, il lui faut pouvoir revenir en arrière dedans — puis
# on le range sous `refs/depose/<version>`, là où le déploiement va le
# chercher. Le fichier part dans tous les cas, succès ou échec.
deposer() {
  local version="${1:?usage : deployer.sh --deposer <version>}"
  [[ "$version" =~ ^[A-Za-z0-9._/-]+$ ]] || {
    echo "version invalide : $version" >&2
    exit 2
  }

  # Le fichier est confié au ménage unique posé en bas du script, et non à un
  # `trap` local : deux `trap … EXIT` ne cohabitent pas, le second remplace le
  # premier sans un mot — et celui qui tombait ici emportait l'effacement de la
  # copie du script.
  local paquet
  paquet=$(mktemp "$RACINE/.depose.XXXXXX.bundle")
  PAQUET_RECU="$paquet"
  cat >"$paquet"

  [ -s "$paquet" ] || {
    echo "KO : aucun paquet reçu sur l'entrée standard" >&2
    exit 2
  }
  # `-C` : sshd demarre dans le dossier personnel, et `git bundle verify`
  # exige d etre DANS un depot — « need a repository to verify a bundle ».
  # Le premier essai reel du nouveau chemin est tombe exactement la.
  git -C "$DEPOT" bundle verify "$paquet" >/dev/null 2>&1 || {
    echo "KO : le paquet reçu n'est pas un bundle git lisible" >&2
    exit 2
  }

  # ======================================= POURQUOI « refs/depose » ET NON « origin »
  #
  # Première écriture : `refs/remotes/origin/<version>`. Cet espace APPARTIENT
  # à un dépôt distant nommé `origin` — et le 12 octobre 2026, en retirant de
  # ce serveur le dépôt distant devenu inutile (il n'a plus de clé pour le
  # joindre), `git remote remove origin` a effacé la référence déposée avec
  # lui. Le déploiement suivant aurait dit « cette version n'a pas été
  # déposée » sur un serveur qui l'avait reçue dix minutes plus tôt.
  #
  # Une référence qui ne vient d'aucun dépôt distant ne se range pas dans
  # l'espace d'un dépôt distant. Celle-ci a le sien, que rien ne nettoie.
  git -C "$DEPOT" fetch --quiet "$paquet" "HEAD:refs/depose/$version"
  echo "▶ déposé  $(git -C "$DEPOT" log -1 --format='%h %s' "refs/depose/$version")"
}

principal() {
  local version="${1:?usage : deployer.sh <version>}"
  [[ "$version" =~ ^[A-Za-z0-9._/-]+$ ]] || {
    echo "version invalide : $version" >&2
    exit 2
  }
  [ -f "$ENV" ] || {
    echo "$ENV absent : cp $DEPOT/infra/env.exemple $ENV, puis renseigner" >&2
    exit 2
  }

  exec 9>"$RACINE/.deployer.verrou"
  flock -n 9 || {
    echo "un déploiement est déjà en cours" >&2
    exit 3
  }

  echo "▶ dépôt → $version"
  # Aucun appel à GitHub : le code a été DÉPOSÉ juste avant (`--deposer`), et
  # le serveur n'a aucune clé pour aller le chercher. Si la référence manque,
  # on le dit au lieu de déployer la version d'avant en silence.
  git -C "$DEPOT" rev-parse --verify --quiet "refs/depose/$version" >/dev/null || {
    echo "KO : « $version » n'a pas été déposée sur ce serveur." >&2
    echo "     La CI envoie le code par « deposer $version » avant de déployer ;" >&2
    echo "     à la main : git bundle create p.bundle HEAD puis" >&2
    echo "     ssh malica@… \"deposer $version\" < p.bundle" >&2
    exit 2
  }
  git -C "$DEPOT" checkout --quiet --detach "refs/depose/$version"
  echo "  $(git -C "$DEPOT" log -1 --format='%h %s')"

  # L'étiquette d'image est la version. Retenue dans .env : un `up` ultérieur,
  # un redémarrage de la machine, repartent de la même.
  if grep -q '^VERSION=' "$ENV"; then
    sed -i -E "s|^VERSION=.*|VERSION=$version|" "$ENV"
  else
    echo "VERSION=$version" >>"$ENV"
  fi

  echo "▶ images"
  # Le jeton du registre arrive sur l'entrée standard et ne touche jamais le
  # disque : `docker login` le lit sur un tuyau, et on se déconnecte juste
  # après. Rien à voler sur cette machine entre deux déploiements.
  #
  # Son absence n'est pas une erreur : un déploiement local, sur des images
  # déjà présentes, n'a personne à qui demander.
  # L'identité du registre arrive sur l'entrée standard, en DEUX lignes : le
  # nom, puis le jeton.
  #
  # ============================== POURQUOI LE NOM VOYAGE AVEC LE JETON
  #
  # Première écriture : seul le jeton arrivait, et le nom valait
  # « x-access-token » — la convention de git sur HTTPS, qui n'est pas celle
  # d'un registre. GHCR a accepté la connexion et délivré une autorisation
  # VIDE : le `login` réussissait, le `pull` répondait « unauthorized », et
  # rien dans les deux ne disait pourquoi.
  #
  # Le nom doit être celui du porteur du jeton — `github.actor` pour la CI —
  # et il change d'un appelant à l'autre : une personne, le robot des actions
  # planifiées. Le mettre dans `.env` du serveur l'aurait figé sur un seul
  # appelant, et aurait redonné à la machine une identité à garder. Il voyage
  # donc avec le jeton, et disparaît avec lui.
  local utilisateur="" jeton=""
  if [ ! -t 0 ]; then
    read -r utilisateur || true
    read -r jeton || true
    # ========================================= LES SECRETS D'APPLICATION
    #
    # 20 octobre 2026. Les lignes suivantes, s'il y en a, portent des secrets
    # que l'API attend dans .env et que personne ne pouvait poser à la main
    # sans accès au serveur — la clé Brevo d'abord. Ils viennent des secrets
    # GitHub de l'environnement, voyagent sur l'entrée standard comme le jeton,
    # et seuls les noms de la liste passent. Une valeur vide ne touche à rien.
    # 15 novembre 2026 : les clés des modèles rejoignent la liste — le pilote
    # sur Google Cloud n'a jamais eu de .env rempli à la main, et ces clés ne
    # passent ni par un poste ni par une conversation.
    local ligne nom valeur
    while IFS= read -r ligne || [ -n "$ligne" ]; do
      nom="${ligne%%=*}"
      valeur="${ligne#*=}"
      # 16 novembre 2026 : l'adresse publique rejoint la liste. Le pilote
      # servait sous son adresse technique (sslip.io), et les liens de ses
      # courriels y menaient ; elle se règle désormais depuis les variables
      # de l'environnement GitHub, sans connexion au serveur.
      case "$nom" in
      # 16 novembre 2026 : les comptes marchands du paiement en ligne.
      BREVO_API_KEY | ANTHROPIC_API_KEY | DEEPSEEK_API_KEY | QWEN_API_KEY) ;;
      CLICTOPAY_UTILISATEUR | CLICTOPAY_MOT_DE_PASSE | FLOUCI_CLE_PUBLIQUE | FLOUCI_CLE_PRIVEE) ;;
      # 23 novembre 2026 : le simulateur de paiement, « oui » sur le staging seul.
      PAIEMENT_SIMULATEUR)
        [[ "$valeur" == "oui" || "$valeur" == "non" ]] || {
          echo "KO : PAIEMENT_SIMULATEUR vaut oui ou non, ignoré" >&2
          continue
        }
        ;;
      DOMAINE | DOMAINE_ALIAS)
        [ -z "$valeur" ] || [[ "$valeur" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]] || {
          echo "KO : $nom n'est pas un nom d'hôte, ignoré" >&2
          continue
        }
        ;;
      *) continue ;;
      esac
      [ -n "$valeur" ] || continue
      [[ "$valeur" =~ ^[A-Za-z0-9._-]+$ ]] || {
        echo "KO : $nom porte des caractères inattendus, ignoré" >&2
        continue
      }
      if grep -q "^$nom=" "$ENV"; then
        sed -i -E "s|^$nom=.*|$nom=$valeur|" "$ENV"
      else
        printf '%s=%s\n' "$nom" "$valeur" >>"$ENV"
      fi
      echo "  secret $nom posé dans .env"
    done
  fi
  if [ -n "$jeton" ]; then
    local registre
    registre=$(grep -E '^REGISTRE=' "$ENV" | cut -d= -f2- | cut -d/ -f1)
    registre=${registre:-ghcr.io}
    [ -n "$utilisateur" ] || {
      echo "KO : un jeton de registre est arrivé sans son nom de porteur." >&2
      echo "     L'entrée standard attend deux lignes : le nom, puis le jeton." >&2
      exit 2
    }
    printf '%s' "$jeton" |
      docker login "$registre" -u "$utilisateur" --password-stdin >/dev/null
    jeton=""
    # Le ménage est posé UNE fois, en bas du fichier, sur EXIT. Ici on dit
    # seulement de quoi se déconnecter : deux `trap … EXIT` dans un même script
    # ne cohabitent pas — le second remplace le premier, en silence, et c'est
    # ainsi qu'on perd soit la déconnexion, soit l'effacement de la copie.
    REGISTRE_CONNECTE="$registre"
  fi
  compose pull --quiet

  echo "▶ migrations, puis les services"
  if ! compose up -d --remove-orphans; then
    echo "KO : le démarrage a échoué — journal de migrer :" >&2
    compose logs --no-log-prefix --tail 80 migrer >&2 || true
    exit 1
  fi

  # Le Caddyfile est MONTÉ, pas copié dans une image : `up -d` ne recrée pas
  # Caddy quand seul son contenu change, et Caddy garde l'ancien en mémoire.
  # Campagne du 21 octobre 2026 (ANO-027) : la CSP et X-Frame-Options étaient
  # au dépôt depuis 0.2.50, et absentes du staging. On recharge, sans coupure ;
  # un Caddyfile invalide est refusé par Caddy, qui garde l'ancien.
  echo "▶ Caddy relit son Caddyfile"
  if ! compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile; then
    echo "KO : Caddy refuse le Caddyfile du dépôt — l'ancien reste servi." >&2
    exit 1
  fi

  echo "▶ sonde"
  local domaine
  domaine=$(grep -E '^DOMAINE=' "$ENV" | cut -d= -f2-)
  local i
  for i in $(seq 1 45); do
    if curl -fsS --max-time 5 "https://$domaine/sante/profonde" >/dev/null 2>&1; then
      echo "OK  $version sert https://$domaine"
      curl -sS --max-time 5 "https://$domaine/sante/profonde"
      echo
      # Les en-têtes du Caddyfile sont-ils servis ? Le dire, sans bloquer.
      if curl -sSI --max-time 5 "https://$domaine/" | grep -qi '^content-security-policy:'; then
        echo "OK  en-têtes de sécurité servis"
      else
        echo "ATTENTION : Content-Security-Policy absente — Caddy sert-il le Caddyfile du dépôt ?" >&2
      fi
      docker image prune -f >/dev/null
      return 0
    fi
    sleep 2
  done

  echo "KO : https://$domaine/sante/profonde ne répond pas en 200 après 90 s" >&2
  compose ps >&2
  compose logs --tail 40 api web caddy >&2 || true
  exit 1
}

# Relire, en lecture seule, les pannes qu'un écran a citées par leur référence.
#
# L'écran dit « Une erreur est survenue. (réf. 28AE8D15) » ; la ligne du
# journal porte « [ref 28AE8D15] … » en tête de son message. La transaction est
# en lecture seule (PGOPTIONS) : une faute dans cette requête ne peut rien
# écrire.
#
# La sortie part dans le journal d'une action GitHub, et le dépôt est PUBLIC.
# On n'y met donc que le technique : l'heure, l'endroit du code, la version, la
# plateforme, le message et la pile d'appels — l'un et l'autre avec courriels
# et longues suites de chiffres masqués : une pile JavaScript commence par le
# message de l'erreur, elle le répète tel quel. Jamais le dossier ni la personne.
journal() {
  local refs="${1:?usage : deployer.sh --journal <réf>[,<réf>…]}"
  [[ "$refs" =~ ^[0-9A-F]{8}(,[0-9A-F]{8}){0,19}$ ]] || {
    echo "références invalides : $refs" >&2
    exit 2
  }
  local motif
  motif="^\\[ref (${refs//,/|})\\] "
  compose exec -T -e PGOPTIONS='-c default_transaction_read_only=on' postgres \
    psql -X -q -U postgres -d malica -v ON_ERROR_STOP=1 -P pager=off -x -c "
      select to_char(at at time zone 'Africa/Tunis', 'YYYY-MM-DD HH24:MI:SS') as heure,
             ou, version, plateforme,
             left(regexp_replace(regexp_replace(message,
               '[^[:space:]@]+@[^[:space:]@]+', '«courriel»', 'g'),
               '[0-9]{6,}', '«nombre»', 'g'), 1200) as message,
             left(regexp_replace(regexp_replace(coalesce(pile, ''),
               '[^[:space:]@]+@[^[:space:]@]+', '«courriel»', 'g'),
               '[0-9]{6,}', '«nombre»', 'g'), 4000) as pile
        from audit.journal_client
       where message ~ '$motif'
       order by at"
}

# Relire, en lecture seule, les lectures de pièces qui ont échoué récemment.
#
# 21 novembre 2026 : une note d'honoraires dite « illisible » au pilote se
# lisait parfaitement hors de lui ; la cause est le motif du travail échoué
# (`fabrique.travail_faits`), que seul le pilote garde. Mêmes règles que
# `journal` : transaction en lecture seule, sortie technique seulement, motif
# masqué (courriels, longues suites de chiffres), ni dossier ni personne — la
# pièce n'est nommée que par son identifiant.
lectures() {
  local jours="${1:?usage : deployer.sh --lectures <jours>}"
  [[ "$jours" =~ ^[1-7]$ ]] || {
    echo "nombre de jours invalide : $jours" >&2
    exit 2
  }
  compose exec -T -e PGOPTIONS='-c default_transaction_read_only=on' postgres \
    psql -X -q -U postgres -d malica -v ON_ERROR_STOP=1 -P pager=off -x -c "
      select to_char(f.inscrit_le at time zone 'Africa/Tunis', 'YYYY-MM-DD HH24:MI:SS') as heure,
             t.piece_id as piece, f.nature as fait, f.tentative,
             left(regexp_replace(regexp_replace(f.motif,
               '[^[:space:]@]+@[^[:space:]@]+', '«courriel»', 'g'),
               '[0-9]{6,}', '«nombre»', 'g'), 1500) as motif
        from fabrique.travail_faits f
        join fabrique.travaux t on t.tenant_id = f.tenant_id and t.id = f.travail_id
       where f.nature not in ('pris', 'termine')
         and f.inscrit_le > now() - interval '$jours days'
       order by f.inscrit_le desc
       limit 60"
}

# ================================== LE SCRIPT NE SE LIT PAS PENDANT QU'IL CHANGE
#
# `deployer` fait un `git checkout` du dépôt — et ce script EST dans le dépôt.
# Bash lit un script par morceaux, au fil de l'exécution : réécrire le fichier
# sous ses pieds lui fait reprendre la lecture à un décalage devenu faux, et il
# exécute une ligne coupée en deux. Le symptôme serait une erreur de syntaxe
# surgie au milieu d'un déploiement qui marchait la veille, sur une machine où
# le fichier est juste.
#
# Rien ne l'a encore déclenché : il faut que la version déployée modifie ce
# fichier, ce qui est arrivé deux fois aujourd'hui sans dégât — l'amorçage à la
# main avait mis le script à jour AVANT que la CI ne le lance.
#
# On se recopie donc hors du dépôt, une fois, et on se relance depuis la copie.
# `MALICA_DEPLOYEUR_FIGE` coupe la récursion.
if [ -z "${MALICA_DEPLOYEUR_FIGE:-}" ] && [ "${0#"$DEPOT"}" != "$0" ]; then
  copie=$(mktemp "$RACINE/.deployeur.XXXXXX.sh")
  cp "$0" "$copie"
  chmod +x "$copie"
  # La copie s'efface elle-même : un `trap` ici ne courrait pas, `exec`
  # remplace le processus.
  MALICA_DEPLOYEUR_FIGE=1 MALICA_DEPLOYEUR_COPIE="$copie" exec "$copie" "$@"
fi

# ======================================================= UN SEUL MÉNAGE, SUR EXIT
#
# Deux `trap … EXIT` dans un même script ne cohabitent pas : le second remplace
# le premier, sans un mot. Tout ce qui doit partir à la fin part donc d'ici.
#
# Et sur EXIT, pas sur RETURN : ce script meurt par `exit 1` dès qu'une étape
# échoue, et un `trap RETURN` ne court pas sur un `exit`. Le jeton serait resté
# dans ~/.docker/config.json exactement dans le cas où cela compte — le
# déploiement raté, celui qu'on laisse en l'état pour aller voir.
menage() {
  [ -z "${REGISTRE_CONNECTE:-}" ] || docker logout "$REGISTRE_CONNECTE" >/dev/null 2>&1 || true
  [ -z "${PAQUET_RECU:-}" ] || rm -f "$PAQUET_RECU"
  [ -z "${MALICA_DEPLOYEUR_COPIE:-}" ] || rm -f "$MALICA_DEPLOYEUR_COPIE"
}
trap menage EXIT

if [ "${1:-}" = "--deposer" ]; then
  shift
  deposer "$@"
elif [ "${1:-}" = "--journal" ]; then
  shift
  journal "$@"
elif [ "${1:-}" = "--lectures" ]; then
  shift
  lectures "$@"
else
  principal "$@"
fi
exit $?
