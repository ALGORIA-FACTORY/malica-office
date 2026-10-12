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
# on le range sous `refs/remotes/origin/<version>`, là où le déploiement va le
# chercher. Le fichier part dans tous les cas, succès ou échec.
deposer() {
  local version="${1:?usage : deployer.sh --deposer <version>}"
  [[ "$version" =~ ^[A-Za-z0-9._/-]+$ ]] || {
    echo "version invalide : $version" >&2
    exit 2
  }

  local paquet
  paquet=$(mktemp "$RACINE/.depose.XXXXXX.bundle")
  # shellcheck disable=SC2064
  trap "rm -f '$paquet'" EXIT
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

  git -C "$DEPOT" fetch --quiet "$paquet" "HEAD:refs/remotes/origin/$version"
  echo "▶ déposé  $(git -C "$DEPOT" log -1 --format='%h %s' "refs/remotes/origin/$version")"
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
  git -C "$DEPOT" rev-parse --verify --quiet "refs/remotes/origin/$version" >/dev/null || {
    echo "KO : « $version » n'a pas été déposée sur ce serveur." >&2
    echo "     La CI envoie le code par « deposer $version » avant de déployer ;" >&2
    echo "     à la main : git bundle create p.bundle HEAD puis" >&2
    echo "     ssh malica@… \"deposer $version\" < p.bundle" >&2
    exit 2
  }
  git -C "$DEPOT" checkout --quiet --detach "refs/remotes/origin/$version"
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
  local jeton=""
  if [ ! -t 0 ]; then read -r jeton || true; fi
  if [ -n "$jeton" ]; then
    local registre utilisateur
    registre=$(grep -E '^REGISTRE=' "$ENV" | cut -d= -f2- | cut -d/ -f1)
    registre=${registre:-ghcr.io}
    utilisateur=$(grep -E '^REGISTRE_UTILISATEUR=' "$ENV" | cut -d= -f2-)
    printf '%s' "$jeton" |
      docker login "$registre" -u "${utilisateur:-x-access-token}" --password-stdin >/dev/null
    jeton=""
    # La déconnexion part sur EXIT, et non sur RETURN.
    #
    # Première écriture : `trap … RETURN`. Elle ne se déclenche QUE si la
    # fonction rend la main — or ce script meurt par `exit 1` dès qu'une étape
    # échoue, et un `trap RETURN` ne court pas sur un `exit`. Le jeton serait
    # donc resté dans ~/.docker/config.json exactement dans le cas où cela
    # compte : le déploiement raté, celui qu'on laisse en l'état pour aller
    # voir. C'était le défaut que ce mécanisme est censé supprimer, replacé
    # deux lignes plus bas.
    # shellcheck disable=SC2064
    trap "docker logout '$registre' >/dev/null 2>&1 || true" EXIT
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

if [ "${1:-}" = "--deposer" ]; then
  shift
  deposer "$@"
else
  principal "$@"
fi
exit $?
