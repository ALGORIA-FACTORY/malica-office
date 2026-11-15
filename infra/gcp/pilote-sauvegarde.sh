#!/usr/bin/env bash
# Brancher les sauvegardes du pilote sur son sous-compte de la Storage Box.
#
#   bash <(curl -fsSL https://raw.githubusercontent.com/ALGORIA-FACTORY/malica-office/<commit>/infra/gcp/pilote-sauvegarde.sh) u664122-sub1
#
# Le pilote a son PROPRE sous-compte (dossier malica-pilote) : sa clé n'ouvre
# que ce dossier, pas celui du staging. La console Hetzner ne pose pas de clé
# SSH sur un sous-compte : le mot de passe du sous-compte sert une seule fois,
# depuis la machine, à y installer la clé publique des sauvegardes
# (install-ssh-key). Il est tapé ici, masqué, voyage sur l'entrée standard —
# jamais sur une ligne de commande ni sur le disque — et n'est plus utile
# ensuite.
set -euo pipefail

SOUS_COMPTE="${1:?usage : pilote-sauvegarde.sh <sous-compte, ex. u664122-sub1>}"
[[ "$SOUS_COMPTE" =~ ^u[0-9]+-sub[0-9]+$ ]] || { echo "sous-compte inattendu : $SOUS_COMPTE" >&2; exit 1; }
MACHINE=malica-pilote
ZONE=$(gcloud compute instances list --filter="name=$MACHINE" --format='value(zone.basename())')

read -r -s -p "Mot de passe du sous-compte $SOUS_COMPTE (masqué) : " MOT </dev/tty
echo

printf '%s\n' "$MOT" | gcloud compute ssh "$MACHINE" --zone="$ZONE" --tunnel-through-iap --quiet \
  --command="sudo SOUS_COMPTE='$SOUS_COMPTE' bash -c '$(
    cat <<'DISTANT'
set -euo pipefail
IFS= read -r SSHPASS; export SSHPASS
HOTE="$SOUS_COMPTE.your-storagebox.de"
CLE=/srv/malica/sauvegarde/cle_ssh
command -v sshpass >/dev/null || { apt-get install -y -q sshpass >/dev/null; RETIRER=1; }
sshpass -e ssh -p 23 -o StrictHostKeyChecking=accept-new -o PubkeyAuthentication=no \
  "$SOUS_COMPTE@$HOTE" install-ssh-key <"$CLE.pub"
unset SSHPASS
[ -n "${RETIRER:-}" ] && apt-get purge -y -q sshpass >/dev/null
# La preuve : la clé seule ouvre le sous-compte, sans mot de passe.
ssh -i "$CLE" -p 23 -o BatchMode=yes -o StrictHostKeyChecking=accept-new "$SOUS_COMPTE@$HOTE" ls >/dev/null
sed -i -E "s|^RESTIC_REPOSITORY=.*|RESTIC_REPOSITORY=sftp:$SOUS_COMPTE@$HOTE:restic|" /srv/malica/.env
echo "OK : la clé ouvre $SOUS_COMPTE ; RESTIC_REPOSITORY=sftp:$SOUS_COMPTE@$HOTE:restic"
DISTANT
  )'"
unset MOT
echo FIN-OK
