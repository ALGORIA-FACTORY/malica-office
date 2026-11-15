#!/usr/bin/env bash
# Le pilote prend son nom définitif, et son stockage redevient inscriptible.
#
#   bash <(curl -fsSL https://raw.githubusercontent.com/ALGORIA-FACTORY/malica-office/<commit>/infra/gcp/pilote-domaine.sh)
#
# - DOMAINE devient pilote.malica-office.algoria-factory.com (l'enregistrement
#   A existe chez Cloudflare, en « DNS only ») ; l'adresse sslip.io reste
#   servie en DOMAINE_ALIAS — rien de ce qui la connaît ne casse.
# - $RACINE/pieces passe à l'uid de l'API (voir provisionner.sh, même date).
# - Les services repartent sur la version déjà déployée ; la sonde profonde
#   doit répondre 200 sous les deux noms.
set -euo pipefail

MACHINE=malica-pilote
DOMAINE=pilote.malica-office.algoria-factory.com
ZONE=$(gcloud compute instances list --filter="name=$MACHINE" --format='value(zone.basename())')
ADRESSE=$(gcloud compute addresses describe "$MACHINE-ip" --region="${ZONE%-*}" --format='value(address)')

gcloud compute ssh "$MACHINE" --zone="$ZONE" --tunnel-through-iap --quiet \
  --command="sudo DOMAINE='$DOMAINE' ALIAS='$ADRESSE.sslip.io' bash -s" <<'DISTANT'
set -euo pipefail
RACINE=/srv/malica
echo "malica : $(id malica)"
chown 1000:malica "$RACINE/pieces"
chmod 2770 "$RACINE/pieces"
sed -i -E "s|^DOMAINE=.*|DOMAINE=$DOMAINE|; s|^DOMAINE_ALIAS=.*|DOMAINE_ALIAS=$ALIAS|" "$RACINE/.env"
grep -E '^DOMAINE(_ALIAS)?=' "$RACINE/.env"
cd "$RACINE"
sudo -u malica docker compose --project-directory "$RACINE/depot/infra" --env-file "$RACINE/.env" up -d >/dev/null 2>&1
for nom in "$DOMAINE" "$ALIAS"; do
  code=000
  for _ in $(seq 45); do
    code=$(curl -s -o /dev/null -w '%{http_code}' --resolve "$nom:443:127.0.0.1" "https://$nom/sante/profonde" || true)
    [ "$code" = 200 ] && break
    sleep 2
  done
  echo "https://$nom/sante/profonde → $code"
  [ "$code" = 200 ]
done
DISTANT
echo FIN-OK
