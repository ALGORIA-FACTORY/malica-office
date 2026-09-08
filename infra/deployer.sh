#!/usr/bin/env bash
# Déployer une version sur ce serveur.
#
#   deployer.sh <version>        une étiquette git (v0.3.1) ou une branche (main)
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
  # --force : une étiquette déplacée sur GitHub (une version refaite) ne bloque pas le déploiement.
  git -C "$DEPOT" fetch --tags --force --prune --quiet origin
  if git -C "$DEPOT" rev-parse --verify --quiet "refs/tags/$version" >/dev/null; then
    git -C "$DEPOT" checkout --quiet --detach "refs/tags/$version"
  else
    git -C "$DEPOT" checkout --quiet --detach "origin/$version"
  fi
  echo "  $(git -C "$DEPOT" log -1 --format='%h %s')"

  # L'étiquette d'image est la version. Retenue dans .env : un `up` ultérieur,
  # un redémarrage de la machine, repartent de la même.
  if grep -q '^VERSION=' "$ENV"; then
    sed -i -E "s|^VERSION=.*|VERSION=$version|" "$ENV"
  else
    echo "VERSION=$version" >>"$ENV"
  fi

  echo "▶ images"
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

principal "$@"
exit $?
