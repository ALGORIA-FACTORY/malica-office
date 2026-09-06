#!/usr/bin/env bash
# Restaurer — la répétition mensuelle, et l'incident.
#
#   restaurer.sh lister                         les instantanés hors site
#   restaurer.sh repeter [instantané]           dans regalica_restauree, à côté de la base vivante ; mesure le temps
#   restaurer.sh remplacer <instantané>         la base vivante devient celle de l'instantané (API et site arrêtés avant)
#   restaurer.sh pieces <instantané> [dossier]  les pièces, dans /restauration/pieces par défaut
#
# Se lance depuis le serveur, à travers compose :
#   docker compose run --rm sauvegarde restaurer.sh repeter
#
# « remplacer » ne détruit rien : la base d'avant est renommée
# regalica_avant_<horodatage>, et se supprime à la main une fois l'incident
# clos. Il exige REMPLACER=oui dans l'environnement, pour qu'un doigt qui
# glisse ne suffise pas.
set -euo pipefail

CIBLE=/restauration
ARGS_SFTP="-i /root/.ssh/id_ed25519 -p 23 -o BatchMode=yes -o StrictHostKeyChecking=accept-new"

r() { restic -o "sftp.args=$ARGS_SFTP" "$@"; }
psql_admin() { psql -h postgres -U postgres -v ON_ERROR_STOP=1 -qAt "$@"; }
maintenant() { date +%Y-%m-%dT%H:%M:%S; }

# Ramène le dump le plus récent de l'instantané, et affiche son chemin.
ramener_le_dump() {
  local instantane="${1:-latest}"
  rm -rf "$CIBLE/base"
  r restore "$instantane" --tag base --target "$CIBLE/base" --quiet
  local dump
  dump=$(find "$CIBLE/base" -name 'regalica-*.dump' | sort | tail -n 1)
  [ -n "$dump" ] || {
    echo "aucun dump dans l'instantané $instantane" >&2
    exit 1
  }
  echo "$dump"
}

# Charge un dump dans une base neuve, et dit combien de tables elle porte.
charger() {
  local dump="$1" base="$2"
  psql_admin -d postgres -c "drop database if exists $base with (force)"
  psql_admin -d postgres -c "create database $base"
  pg_restore -h postgres -U postgres -d "$base" --no-owner --no-privileges --exit-on-error "$dump"
  psql_admin -d "$base" -c "select count(*) from pg_tables where schemaname not in ('pg_catalog','information_schema')"
}

lister() {
  r snapshots --tag base --compact
}

repeter() {
  local debut
  debut=$(date +%s)
  echo "[$(maintenant)] répétition depuis ${1:-latest}"
  local dump
  dump=$(ramener_le_dump "${1:-latest}")
  local tables
  tables=$(charger "$dump" regalica_restauree)
  local duree=$(($(date +%s) - debut))
  echo "[$(maintenant)] regalica_restauree : $tables tables, restaurée en $duree s depuis $(basename "$dump")"
  echo "À consigner dans docs/exploitation.md (registre des répétitions), puis :"
  echo "  docker compose run --rm sauvegarde psql -h postgres -U postgres -c 'drop database regalica_restauree'"
}

remplacer() {
  local instantane="${1:?usage : restaurer.sh remplacer <instantané>}"
  [ "${REMPLACER:-}" = "oui" ] || {
    echo "refusé : REMPLACER=oui manque. Arrêtez d'abord l'API et le site (docker compose stop api web)." >&2
    exit 2
  }
  local debut
  debut=$(date +%s)
  echo "[$(maintenant)] remplacement depuis $instantane"
  local dump
  dump=$(ramener_le_dump "$instantane")
  charger "$dump" regalica_restauree >/dev/null
  local avant="regalica_avant_$(date +%Y%m%d_%H%M%S)"
  psql_admin -d postgres -c "alter database regalica rename to $avant"
  psql_admin -d postgres -c "alter database regalica_restauree rename to regalica"
  echo "[$(maintenant)] regalica remplacée en $(($(date +%s) - debut)) s ; l'ancienne est $avant. Relancez : docker compose up -d"
}

pieces() {
  local instantane="${1:?usage : restaurer.sh pieces <instantané> [dossier]}"
  local dossier="${2:-$CIBLE/pieces}"
  echo "[$(maintenant)] pièces de $instantane → $dossier"
  r restore "$instantane" --tag pieces --target "$dossier" --quiet
  echo "[$(maintenant)] ok : $(find "$dossier" -type f | wc -l) fichiers"
}

case "${1:-}" in
lister) lister ;;
repeter) repeter "${2:-latest}" ;;
remplacer) remplacer "${2:-}" ;;
pieces) pieces "${2:-}" "${3:-}" ;;
*)
  sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
  ;;
esac
