#!/usr/bin/env bash
# Prépare la base de Malica Office sur pg-shared. Idempotent. À lancer UNE fois
# (puis après toute recréation du serveur), AVANT `docker compose up`.
#
# Pourquoi un script côté hôte : les migrations créent des rôles (anon,
# authenticated, service_role, portier…), globaux au serveur. Le propriétaire de
# la base n'a pas le droit d'en créer ; le superutilisateur de pg-shared le fait
# ici, une fois, et n'entre jamais dans un conteneur de Malica.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f env/db.env ] || { echo "ERR: lancez d'abord scripts/init-env.sh" >&2; exit 1; }
set -a; . env/db.env; set +a
[ -z "${1:-}" ] || MALICA_DB_NAME=$1
DK=(docker); docker info >/dev/null 2>&1 || DK=(sudo docker)
[ "$("${DK[@]}" inspect -f '{{.State.Health.Status}}' "$PG_SHARED_CONTAINER" 2>/dev/null || true)" = healthy ] \
  || { echo "ERR: $PG_SHARED_CONTAINER n'est pas healthy (cd ~/pg-shared && docker compose up -d --wait)" >&2; exit 1; }

# La base et son propriétaire : le script de pg-shared (sans extension, voir plus bas).
DB_ROLE_PASSWORD="$MALICA_DB_OWNER_PASSWORD" ~/pg-shared/create-db.sh "$MALICA_DB_NAME" "$MALICA_DB_OWNER"

export MALICA_API_PASSWORD
psql_su() { "${DK[@]}" exec -i -e MALICA_API_PASSWORD "$PG_SHARED_CONTAINER" sh -c 'psql -X -q -U "$POSTGRES_USER" -v ON_ERROR_STOP=1 -v apipw="$MALICA_API_PASSWORD" "$@"' _ "$@"; }

# Les rôles du serveur, les mêmes que db/local/00_compat_supabase.sql et les
# migrations créent (elles ne les recréent pas s'ils existent).
psql_su -d postgres -v db="$MALICA_DB_NAME" -v owner="$MALICA_DB_OWNER" <<'SQL'
select 'create role anon nologin noinherit'                    where not exists (select 1 from pg_roles where rolname='anon') \gexec
select 'create role authenticated nologin noinherit'           where not exists (select 1 from pg_roles where rolname='authenticated') \gexec
select 'create role service_role nologin noinherit bypassrls'  where not exists (select 1 from pg_roles where rolname='service_role') \gexec
select 'create role portier nologin inherit'                   where not exists (select 1 from pg_roles where rolname='portier') \gexec
select 'create role greffier nologin noinherit'                where not exists (select 1 from pg_roles where rolname='greffier') \gexec
select 'create role malica_exploitation nologin noinherit'     where not exists (select 1 from pg_roles where rolname='malica_exploitation') \gexec
select format('create role malica_api login noinherit password %L', :'apipw') where not exists (select 1 from pg_roles where rolname='malica_api') \gexec
select format('alter role malica_api with login password %L', :'apipw') \gexec
grant authenticated to malica_api;
grant authenticated to portier;
-- Les migrations rejouent `grant authenticated to malica_api` : il faut l'option ADMIN sur ce seul rôle,
-- sans en hériter les droits (le propriétaire ne devient pas `authenticated`).
select format('grant authenticated to %I with admin option, inherit false', :'owner') \gexec
-- Les tables sont sous `force row level security` : sans BYPASSRLS, le propriétaire ne peut pas semer les
-- référentiels des migrations. C'est le strict minimum au lieu d'un superutilisateur ; l'API, elle,
-- se connecte en `malica_api` et reste soumise à la RLS.
-- Les migrations donnent des fonctions à ces rôles (`alter … owner to`, `set role`) : le propriétaire doit en être membre.
select format('grant portier, greffier, malica_exploitation to %I', :'owner') \gexec
select format('alter role %I bypassrls', :'owner') \gexec
select format('grant connect on database %I to malica_api, anon, authenticated, service_role, portier, greffier, malica_exploitation', :'db') \gexec
SQL

# Les extensions (créées par le superutilisateur) dans le schéma `extensions`, comme le veulent les migrations.
psql_su -d "$MALICA_DB_NAME" -v owner="$MALICA_DB_OWNER" <<'SQL'
select format('create schema if not exists extensions authorization %I', :'owner') \gexec
create extension if not exists pgcrypto   with schema extensions;
create extension if not exists vector     with schema extensions;
create extension if not exists btree_gist with schema extensions;
grant usage on schema extensions to public;
SQL
echo "OK : base $MALICA_DB_NAME prête sur $PG_SHARED_CONTAINER (propriétaire $MALICA_DB_OWNER, rôle API malica_api)."
