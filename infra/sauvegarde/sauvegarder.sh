#!/usr/bin/env bash
# Sauvegarder — ce que crond lance.
#
#   sauvegarder.sh            un dump de la base, puis dumps et pièces hors site
#   sauvegarder.sh elaguer    la rétention : 24 h / 14 j / 8 sem / 12 mois, puis le nettoyage
#   sauvegarder.sh verifier   restic check, un dixième des données relu
#
# Le dépôt restic est chiffré par RESTIC_PASSWORD et vit sur la Storage Box
# (SFTP, port 23, la clé montée dans /root/.ssh). Deux dumps restent sur le
# volume local pour une restauration rapide ; tout le reste est hors site.
#
# Quand SAUVEGARDE_SIGNAL_URL est renseignée, chaque sauvegarde réussie
# l'appelle : la surveillance alerte sur le SILENCE, pas sur un message
# d'erreur qui pourrait ne jamais partir.
set -euo pipefail

DUMPS=/sauvegardes
PIECES=/pieces
ARGS_SFTP="-i /root/.ssh/id_ed25519 -p 23 -o BatchMode=yes -o StrictHostKeyChecking=accept-new"

r() { restic -o "sftp.args=$ARGS_SFTP" "$@"; }
maintenant() { date +%Y-%m-%dT%H:%M:%S; }

sauvegarder() {
  local horodatage
  horodatage=$(date +%Y%m%d-%H%M%S)
  local dump="$DUMPS/regalica-$horodatage.dump"

  echo "[$(maintenant)] dump → $dump"
  pg_dump -h postgres -U postgres -d regalica -Fc --no-owner -f "$dump.tmp"
  mv "$dump.tmp" "$dump"
  ls -1t "$DUMPS"/regalica-*.dump | tail -n +3 | xargs -r rm -f

  echo "[$(maintenant)] hors site"
  r snapshots >/dev/null 2>&1 || r init
  r backup --quiet --tag base "$DUMPS"
  r backup --quiet --tag pieces "$PIECES"
  echo "[$(maintenant)] ok : $(du -h "$dump" | cut -f1) de base, $(du -sh "$PIECES" | cut -f1) de pièces"

  if [ -n "${SAUVEGARDE_SIGNAL_URL:-}" ]; then
    curl -fsS --max-time 10 "$SAUVEGARDE_SIGNAL_URL" >/dev/null || echo "[$(maintenant)] le signal n'est pas parti"
  fi
}

elaguer() {
  echo "[$(maintenant)] rétention"
  r forget --quiet --keep-hourly 24 --keep-daily 14 --keep-weekly 8 --keep-monthly 12 --prune
  echo "[$(maintenant)] ok"
}

verifier() {
  echo "[$(maintenant)] vérification du dépôt"
  r check --read-data-subset=10%
  echo "[$(maintenant)] ok"
}

case "${1:-sauvegarder}" in
sauvegarder) sauvegarder ;;
elaguer) elaguer ;;
verifier) verifier ;;
*)
  echo "usage : sauvegarder.sh [sauvegarder|elaguer|verifier]" >&2
  exit 2
  ;;
esac
