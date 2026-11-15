#!/bin/sh
# Démarrer crond avec les horaires de CET environnement.
#
# Heure d'Afrique/Tunis (TZ de l'image). La sortie va dans le journal du
# conteneur. Par défaut — staging, allumé jour et nuit :
#   toutes les six heures   un dump de la base, puis dumps et pièces hors site ;
#   dimanche 03:30          la rétention (24 h / 14 j / 8 sem / 12 mois) ;
#   le 1er du mois, 04:30   la vérification du dépôt, un dixième relu.
#
# ===================================== POURQUOI LES HORAIRES VIENNENT DU .env
#
# 15 novembre 2026. Le pilote sur Google Cloud s'arrête de 0 h à 10 h pour ne
# pas payer la nuit. Les horaires figés dans l'image tombaient alors machine
# éteinte : le dump de 0 h et de 6 h, la rétention du dimanche 3 h 30 et la
# vérification de 4 h 30 ne partaient JAMAIS — et le dépôt grossissait sans
# rétention. Chaque environnement pose donc ses horaires dans son .env ; une
# expression refusée arrête le conteneur au lieu de sauter une sauvegarde
# en silence.
set -eu

SAUVEGARDE_CRON="${SAUVEGARDE_CRON:-0 */6 * * *}"
ELAGUER_CRON="${ELAGUER_CRON:-30 3 * * 0}"
VERIFIER_CRON="${VERIFIER_CRON:-30 4 1 * *}"

# Cinq champs, chiffres et * / , - seulement : rien d'autre ne monte dans la
# table de crond.
valide() {
  printf '%s\n' "$2" | grep -Eq '^[0-9*/,-]+( [0-9*/,-]+){4}$' || {
    echo "$1 invalide : « $2 » (cinq champs cron attendus)" >&2
    exit 1
  }
}
valide SAUVEGARDE_CRON "$SAUVEGARDE_CRON"
valide ELAGUER_CRON "$ELAGUER_CRON"
valide VERIFIER_CRON "$VERIFIER_CRON"

cat >/etc/crontabs/root <<EOF
$SAUVEGARDE_CRON /usr/local/bin/sauvegarder.sh >>/proc/1/fd/1 2>&1
$ELAGUER_CRON /usr/local/bin/sauvegarder.sh elaguer >>/proc/1/fd/1 2>&1
$VERIFIER_CRON /usr/local/bin/sauvegarder.sh verifier >>/proc/1/fd/1 2>&1
EOF
echo "horaires (Africa/Tunis) :"
sed 's/ \/usr.*//' /etc/crontabs/root | paste -sd ';' - | sed 's/;/ · /g'

exec crond -f -l 6
