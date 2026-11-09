#!/usr/bin/env bash
# Joue les migrations de Malica Office sur pg-shared. À utiliser à chaque mise à jour du schéma.
#
# Pourquoi pas seulement le service `migrate` : certaines migrations font `alter function … owner to
# portier`, ce que PostgreSQL n'autorise que si `portier` (ou `greffier`) a CREATE sur le schéma (un superutilisateur
# contourne la règle). Le droit est donc accordé le temps de la migration, puis retiré : ces rôles ne
# garde jamais CREATE. Le superutilisateur de pg-shared n'est utilisé qu'ici, par `docker exec`.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . env/db.env; set +a
[ -z "${1:-}" ] || MALICA_DB_NAME=$1   # une autre base du même serveur (ex. malica_test)
DK=(docker); docker info >/dev/null 2>&1 || DK=(sudo docker)
psql_su() { "${DK[@]}" exec -i "$PG_SHARED_CONTAINER" sh -c 'psql -X -q -U "$POSTGRES_USER" -v ON_ERROR_STOP=1 "$@"' _ -d "$MALICA_DB_NAME" -v owner="$MALICA_DB_OWNER" "$@"; }

ouvrir() { psql_su <<'SQL'
select format('alter default privileges for role %I grant create on schemas to portier, greffier, malica_exploitation', :'owner') \gexec
select format('grant create on schema %I to portier, greffier, malica_exploitation', nspname) from pg_namespace
  where nspname !~ '^pg_' and nspname <> 'information_schema' \gexec
SQL
}
fermer() { psql_su <<'SQL'
select format('alter default privileges for role %I revoke create on schemas from portier, greffier, malica_exploitation', :'owner') \gexec
select format('revoke create on schema %I from portier, greffier, malica_exploitation', nspname) from pg_namespace
  where nspname !~ '^pg_' and nspname <> 'information_schema' \gexec
SQL
}
trap fermer EXIT
ouvrir
# L'URL passe par l'environnement (jamais sur la ligne de commande) quand la base n'est pas celle de env/migrate.env.
if [ -n "${1:-}" ]; then export DATABASE_URL_ADMIN="postgres://$MALICA_DB_OWNER:$MALICA_DB_OWNER_PASSWORD@pg-shared:5432/$MALICA_DB_NAME"; docker compose -f compose.yml run --rm -e DATABASE_URL_ADMIN migrate
else docker compose -f compose.yml run --rm migrate; fi
