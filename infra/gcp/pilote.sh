#!/usr/bin/env bash
# Malica pilot server on GCP (c4d-standard-4, europe-west1). Run in Cloud Shell. Idempotent.
set -euo pipefail
P=malica-office-algoria; R=europe-west1; VM=malica-pilote
SA=$VM@$P.iam.gserviceaccount.com
gcloud config set project $P
PN=$(gcloud projects describe $P --format='value(projectNumber)')
gcloud services enable iap.googleapis.com billingbudgets.googleapis.com
# Remove the empty n2 VM created by mistake
gcloud compute instances delete malica-ci-runner --zone=europe-west1-b --quiet || true
# Dedicated service account (no roles)
gcloud iam service-accounts describe $SA >/dev/null 2>&1 || gcloud iam service-accounts create $VM --display-name="Malica pilote - no roles"
# Fixed public address
gcloud compute addresses describe $VM-ip --region=$R >/dev/null 2>&1 || gcloud compute addresses create $VM-ip --region=$R
# Firewall: web open, SSH only via Google IAP, drop world-open SSH/RDP
gcloud compute firewall-rules describe pilote-web >/dev/null 2>&1 || gcloud compute firewall-rules create pilote-web --network=default --allow=tcp:80,tcp:443 --source-ranges=0.0.0.0/0 --target-tags=pilote
gcloud compute firewall-rules describe pilote-iap-ssh >/dev/null 2>&1 || gcloud compute firewall-rules create pilote-iap-ssh --network=default --allow=tcp:22 --source-ranges=35.235.240.0/20 --target-tags=pilote
for r in default-allow-ssh default-allow-rdp; do gcloud compute firewall-rules delete $r --quiet 2>/dev/null || true; done
# Create c4d-standard-4 (first zone with capacity)
for Z in europe-west1-b europe-west1-c europe-west1-d; do
  if gcloud compute instances create $VM --zone=$Z --machine-type=c4d-standard-4 \
    --image-family=ubuntu-2404-lts-amd64 --image-project=ubuntu-os-cloud \
    --boot-disk-size=100GB --boot-disk-type=hyperdisk-balanced --boot-disk-auto-delete \
    --address=$VM-ip --service-account=$SA --scopes=cloud-platform \
    --tags=pilote --labels=usage=pilote,app=malica \
    --shielded-secure-boot --shielded-vtpm --shielded-integrity-monitoring \
    --metadata=enable-oslogin=TRUE,block-project-ssh-keys=TRUE --deletion-protection; then break; fi
done
Z=$(gcloud compute instances list --filter=name=$VM --format='value(zone.basename())')
# Daily disk snapshot 23h Tunis, kept 7 days, stored in EU
gcloud compute resource-policies describe $VM-quotidien --region=$R >/dev/null 2>&1 || gcloud compute resource-policies create snapshot-schedule $VM-quotidien --region=$R --daily-schedule --start-time=22:00 --max-retention-days=7 --storage-location=eu
gcloud compute disks add-resource-policies $VM --zone=$Z --resource-policies=$VM-quotidien
# Night stop 00:00 -> 10:00 Africa/Tunis
gcloud projects add-iam-policy-binding $P --condition=None --quiet --member=serviceAccount:service-$PN@compute-system.iam.gserviceaccount.com --role=roles/compute.instanceAdmin.v1 >/dev/null
gcloud compute resource-policies describe $VM-nuit --region=$R >/dev/null 2>&1 || gcloud compute resource-policies create instance-schedule $VM-nuit --region=$R --vm-start-schedule='0 10 * * *' --vm-stop-schedule='0 0 * * *' --timezone=Africa/Tunis
gcloud compute instances add-resource-policies $VM --zone=$Z --resource-policies=$VM-nuit
# Budget alert (gross cost, credits excluded)
BA=$(gcloud billing projects describe $P --format='value(billingAccountName)' | sed 's#billingAccounts/##')
gcloud billing budgets create --billing-account=$BA --display-name=$VM --budget-amount=150USD --filter-projects=projects/$P --filter-labels=usage=pilote --credit-types-treatment=exclude-all-credits --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 --threshold-rule=percent=1.0
gcloud compute instances describe $VM --zone=$Z --format='yaml(name,zone.basename(),machineType.basename(),status,networkInterfaces[0].accessConfigs[0].natIP,resourcePolicies,deletionProtection)'
echo FIN-OK
