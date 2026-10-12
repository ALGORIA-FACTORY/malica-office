#!/usr/bin/env bash
# Déployer une version sur ce serveur.
#
#   deployer.sh --deposer <version>   l'entrée standard porte un paquet git
#   deployer.sh <version>             l'entrée standard porte, ou non, un jeton
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
  docker compose --project-directory "$DEPOT/infra" --env-file "$ENV" "$@"
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

  echo "▶ sonde"
  local domaine
  domaine=$(grep -E '^DOMAINE=' "$ENV" | cut -d= -f2-)
  local i
  for i in $(seq 1 45); do
    if curl -fsS --max-time 5 "https://$domaine/sante/profonde" >/dev/null 2>&1; then
      echo "OK  $version sert https://$domaine"
      curl -sS --max-time 5 "https://$domaine/sante/profonde"
      echo
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
else
  principal "$@"
fi
exit $?
