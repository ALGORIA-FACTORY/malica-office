#!/usr/bin/env bash
# Installer Malica sur le pilote Google Cloud — depuis Cloud Shell, une fois.
#
#   bash <(curl -fsSL https://raw.githubusercontent.com/ALGORIA-FACTORY/malica-office/<commit>/infra/gcp/pilote-installer.sh)
#
# (et non « curl | bash » : gh et gcloud lisent le clavier, pas le script)
#
# La machine existe déjà (pilote.sh). Ce script suit « Mettre un serveur en
# service » de docs/exploitation.md, adapté à Google Cloud :
#
#   1. l'identité du déploiement : Workload Identity pour CE dépôt et
#      l'environnement GitHub « pilote » seulement, un compte de service qui
#      n'a que le droit d'ouvrir un tunnel IAP — aucune clé Google nulle part ;
#   2. le serveur : le dépôt déposé en paquet (le serveur ne va rien chercher),
#      provisionner.sh, un .env aux secrets générés SUR la machine, la clé des
#      sauvegardes, la clé de la CI derrière porte-ssh.sh ;
#   3. l'environnement GitHub « pilote » : la clé privée de la CI et les
#      variables, posées par gh ; la clé quitte Cloud Shell aussitôt après.
#
# Idempotent : se relance sans rien régénérer de ce qui existe (.env, clés).
# Les clés des modèles ne passent pas par ici : secrets GitHub de
# l'environnement « pilote », déposés par deployer.yml à chaque déploiement.
set -euo pipefail

PROJET=malica-office-algoria
REGION=europe-west1
MACHINE=malica-pilote
DEPOT=ALGORIA-FACTORY/malica-office
ENVIRONNEMENT=pilote
STORAGE_BOX=u664122 # BX11 « malica-sauvegardes » (docs/exploitation.md)
PORT_TUNNEL=2222
REGISTRE=ghcr.io/algoria-factory

gcloud config set project "$PROJET" >/dev/null
NUMERO=$(gcloud projects describe "$PROJET" --format='value(projectNumber)')
ZONE=$(gcloud compute instances list --filter="name=$MACHINE" --format='value(zone.basename())')
[ -n "$ZONE" ] || { echo "la machine $MACHINE n'existe pas : lancer pilote.sh d'abord" >&2; exit 1; }
ADRESSE=$(gcloud compute addresses describe "$MACHINE-ip" --region="$REGION" --format='value(address)')
DOMAINE="${DOMAINE:-$ADRESSE.sslip.io}"
echo "▶ $MACHINE ($ZONE) — https://$DOMAINE"

# ---------------------------------------------------------------- 1. identité
gcloud services enable iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com iap.googleapis.com >/dev/null
DEPLOYEUR="malica-deployeur@$PROJET.iam.gserviceaccount.com"
gcloud iam service-accounts describe "$DEPLOYEUR" >/dev/null 2>&1 ||
  gcloud iam service-accounts create malica-deployeur --display-name="Malica - deploiement pilote (tunnel IAP seulement)"
for role in roles/iap.tunnelResourceAccessor roles/compute.viewer; do
  gcloud projects add-iam-policy-binding "$PROJET" --condition=None --quiet \
    --member="serviceAccount:$DEPLOYEUR" --role="$role" >/dev/null
done
gcloud iam workload-identity-pools describe github --location=global >/dev/null 2>&1 ||
  gcloud iam workload-identity-pools create github --location=global --display-name="GitHub Actions"
gcloud iam workload-identity-pools providers describe malica-office --location=global --workload-identity-pool=github >/dev/null 2>&1 ||
  gcloud iam workload-identity-pools providers create-oidc malica-office --location=global --workload-identity-pool=github \
    --display-name="malica-office (pilote)" --issuer-uri=https://token.actions.githubusercontent.com \
    --attribute-mapping=google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.environment=assertion.environment \
    --attribute-condition="assertion.repository=='$DEPOT' && assertion.environment=='$ENVIRONNEMENT'"
gcloud iam service-accounts add-iam-policy-binding "$DEPLOYEUR" --quiet --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$NUMERO/locations/global/workloadIdentityPools/github/attribute.environment/$ENVIRONNEMENT" >/dev/null
FOURNISSEUR="projects/$NUMERO/locations/global/workloadIdentityPools/github/providers/malica-office"

# ---------------------------------------------------------------- 2. serveur
TRAVAIL=$(mktemp -d)
trap 'rm -rf "$TRAVAIL"' EXIT
git clone --quiet "https://github.com/$DEPOT.git" "$TRAVAIL/depot"
git -C "$TRAVAIL/depot" bundle create "$TRAVAIL/depot.bundle" HEAD 2>/dev/null
ssh-keygen -q -t ed25519 -N "" -C "malica-deploi-pilote" -f "$TRAVAIL/deploi"

SSH=(gcloud compute ssh "$MACHINE" --zone="$ZONE" --tunnel-through-iap --quiet)
gcloud compute scp --zone="$ZONE" --tunnel-through-iap --quiet "$TRAVAIL/depot.bundle" "$TRAVAIL/deploi.pub" "$MACHINE:/tmp/"

"${SSH[@]}" --command="sudo DOMAINE='$DOMAINE' REGISTRE='$REGISTRE' STORAGE_BOX='$STORAGE_BOX' bash -s" <<'DISTANT' | tee "$TRAVAIL/distant.log"
set -euo pipefail
RACINE=/srv/malica
if [ ! -d "$RACINE/depot/.git" ]; then
  install -d "$RACINE"
  git init -q "$RACINE/depot"
  git -C "$RACINE/depot" fetch -q /tmp/depot.bundle HEAD:refs/depose/main
  git -C "$RACINE/depot" checkout -q --detach refs/depose/main
fi
bash "$RACINE/depot/infra/provisionner.sh" >/tmp/provisionner.log 2>&1 || { tail -30 /tmp/provisionner.log; exit 1; }
chown -R malica:malica "$RACINE/depot"

genere() { openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | cut -c1-48; }
pose() { sed -i -E "s|^$1=.*|$1=$2|" "$RACINE/.env"; }
if [ ! -f "$RACINE/.env" ]; then
  install -o malica -g malica -m 600 "$RACINE/depot/infra/env.exemple" "$RACINE/.env"
  pose DOMAINE "$DOMAINE"
  pose REGISTRE "$REGISTRE"
  pose POSTGRES_PASSWORD "$(genere)"
  pose MALICA_API_PASSWORD "$(genere)"
  pose JWT_SECRET "$(genere)"
  pose RESTIC_REPOSITORY "sftp:$STORAGE_BOX@$STORAGE_BOX.your-storagebox.de:malica-pilote"
  pose RESTIC_PASSWORD "$(genere)"
  pose SAUVEGARDE_CRON "0 11,17,23 * * *"
  pose ELAGUER_CRON "0 21 * * 0"
  pose VERIFIER_CRON "0 20 1 * *"
  echo "  .env créé, secrets générés sur la machine"
else
  echo "  .env existant, inchangé"
fi

[ -f "$RACINE/sauvegarde/cle_ssh" ] ||
  ssh-keygen -q -t ed25519 -N "" -C "malica-pilote-sauvegarde" -f "$RACINE/sauvegarde/cle_ssh"

CLE="command=\"$RACINE/depot/infra/porte-ssh.sh\",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty $(cat /tmp/deploi.pub)"
printf '%s\n' "$CLE" >/home/malica/.ssh/authorized_keys
chown malica:malica /home/malica/.ssh/authorized_keys
chmod 600 /home/malica/.ssh/authorized_keys
rm -f /tmp/depot.bundle /tmp/deploi.pub

echo "EMPREINTE $(cut -d' ' -f1,2 /etc/ssh/ssh_host_ed25519_key.pub)"
echo "SAUVEGARDE $(cat "$RACINE/sauvegarde/cle_ssh.pub")"
DISTANT

EMPREINTE=$(sed -n 's/^EMPREINTE //p' "$TRAVAIL/distant.log")
CLE_SAUVEGARDE=$(sed -n 's/^SAUVEGARDE //p' "$TRAVAIL/distant.log")
[ -n "$EMPREINTE" ] || { echo "empreinte du serveur introuvable" >&2; exit 1; }

# ---------------------------------------------------------------- 3. GitHub
if ! command -v gh >/dev/null 2>&1; then
  curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg status=none
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" |
    sudo tee /etc/apt/sources.list.d/github-cli.list >/dev/null
  sudo apt-get update -q >/dev/null && sudo apt-get install -y -q gh >/dev/null
fi
gh auth status >/dev/null 2>&1 || gh auth login --hostname github.com --git-protocol https --web </dev/tty

MOI=$(gh api user --jq .id)
gh api -X PUT "repos/$DEPOT/environments/$ENVIRONNEMENT" --input - >/dev/null <<JSON
{"reviewers":[{"type":"User","id":$MOI}],"deployment_branch_policy":null}
JSON
gh secret set DEPLOI_CLE_SSH --repo "$DEPOT" --env "$ENVIRONNEMENT" <"$TRAVAIL/deploi"
pose_var() { gh variable set "$1" --repo "$DEPOT" --env "$ENVIRONNEMENT" --body "$2"; }
pose_var DOMAINE "$DOMAINE"
pose_var DEPLOI_HOTE localhost
pose_var DEPLOI_PORT "$PORT_TUNNEL"
pose_var DEPLOI_EMPREINTE_HOTE "[localhost]:$PORT_TUNNEL $EMPREINTE"
pose_var GCP_FOURNISSEUR_IDENTITE "$FOURNISSEUR"
pose_var GCP_COMPTE_DEPLOI "$DEPLOYEUR"
pose_var GCP_PROJET "$PROJET"
pose_var GCP_ZONE "$ZONE"
pose_var GCP_MACHINE "$MACHINE"
shred -u "$TRAVAIL/deploi"
gh auth logout --hostname github.com >/dev/null 2>&1 || true

cat <<FIN

================================================================ PRÊT
Machine     $MACHINE ($ZONE), https://$DOMAINE
GitHub      environnement « $ENVIRONNEMENT » : clé, variables, approbation
À FAIRE     déposer cette clé PUBLIQUE dans la Storage Box $STORAGE_BOX (Hetzner) :

$CLE_SAUVEGARDE

FIN
echo FIN-OK
