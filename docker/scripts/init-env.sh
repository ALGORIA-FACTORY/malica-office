#!/usr/bin/env bash
# Crée docker/env/*.env depuis les modèles *.env.example, et génère les secrets
# UNE fois (jamais écrasés, jamais affichés). Idempotent : relancer ne change rien.
set -euo pipefail
cd "$(dirname "$0")/../env"
umask 077

gen() { openssl rand -base64 48 | tr -d '/+=\n' | cut -c1-40; }
for f in *.env.example; do [ -e "${f%.example}" ] || cp "$f" "${f%.example}"; done

val() { sed -n "s/^$2=//p" "$1" | head -1; }
put() { # put <fichier> <clé> <valeur> : remplace la ligne <clé>=
  local tmp; tmp=$(mktemp); awk -v k="$2" -v v="$3" 'BEGIN{FS=OFS="="} $1==k{print k"="v; next} {print}' "$1" >"$tmp"; cat "$tmp" >"$1"; rm -f "$tmp"; }

owner_pw=$(val db.env MALICA_DB_OWNER_PASSWORD); [ -n "$owner_pw" ] || owner_pw=$(gen)
api_pw=$(val db.env MALICA_API_PASSWORD);        [ -n "$api_pw" ]   || api_pw=$(gen)
jwt=$(val api.env JWT_SECRET);                   [ -n "$jwt" ]      || jwt=$(gen)
restic=$(val sauvegarde.env RESTIC_PASSWORD);    [ -n "$restic" ]   || restic=$(gen)
owner=$(val db.env MALICA_DB_OWNER); name=$(val db.env MALICA_DB_NAME)

put db.env MALICA_DB_OWNER_PASSWORD "$owner_pw"
put db.env MALICA_API_PASSWORD "$api_pw"
put migrate.env DATABASE_URL_ADMIN "postgres://$owner:$owner_pw@pg-shared:5432/$name"
put api.env DATABASE_URL "postgres://malica_api:$api_pw@pg-shared:5432/$name"
put api.env JWT_SECRET "$jwt"
put sauvegarde.env PGPASSWORD "$owner_pw"
put sauvegarde.env RESTIC_PASSWORD "$restic"
chmod 600 ./*.env
echo "OK : docker/env/*.env prêts (mode 600). Renseignez les clés des modèles dans env/api.env."
