-- Audit des défauts, en lecture seule. Ne liste QUE les anomalies :
-- un résultat vide est un résultat correct.
--
--   psql -U postgres -h localhost -d regalica_local -f db/verification/audit_defauts.sql

\pset pager off
\pset footer off

\echo '===== A. tenant_id sans index menant (viole R6) ====='
select c.relnamespace::regnamespace::text as schema, c.relname as table_
  from pg_class c
 where c.relkind = 'r'
   and exists (select 1 from pg_attribute a
                where a.attrelid = c.oid and a.attname = 'tenant_id' and a.attnum > 0)
   and not exists (
     select 1 from pg_index i
      where i.indrelid = c.oid
        and (select attname from pg_attribute
              where attrelid = c.oid and attnum = i.indkey[0]) = 'tenant_id')
 order by 1, 2;

\echo '===== B. tenant_id sans RLS (viole R6) ====='
select c.relnamespace::regnamespace::text as schema, c.relname as table_
  from pg_class c
 where c.relkind = 'r'
   and exists (select 1 from pg_attribute a
                where a.attrelid = c.oid and a.attname = 'tenant_id' and a.attnum > 0)
   and not c.relrowsecurity
 order by 1, 2;

\echo '===== C. RLS active sans aucune politique (table refusée à tous) ====='
select c.relnamespace::regnamespace::text as schema, c.relname as table_
  from pg_class c
 where c.relkind = 'r' and c.relrowsecurity
   and not exists (select 1 from pg_policy p where p.polrelid = c.oid)
 order by 1, 2;

\echo '===== D. vues public sans security_invoker ====='
select c.relname as vue
  from pg_class c
 where c.relkind = 'v'
   and c.relnamespace::regnamespace::text = 'public'
   and coalesce((select option_value from pg_options_to_table(c.reloptions)
                  where option_name = 'security_invoker'), 'off') <> 'true'
 order by 1;

\echo '===== E. fonctions security definer sans search_path figé ====='
select p.pronamespace::regnamespace::text as schema, p.proname as fonction
  from pg_proc p
 where p.prosecdef and p.proconfig is null
   and p.pronamespace::regnamespace::text not in ('pg_catalog', 'extensions')
 order by 1, 2;

\echo '===== F. droits résiduels pour public ou anon ====='
select table_schema, table_name, grantee, privilege_type
  from information_schema.role_table_grants
 where grantee in ('PUBLIC', 'anon')
   and table_schema not in ('pg_catalog', 'information_schema')
 order by 1, 2, 3;

\echo '===== G. clés étrangères sans index couvrant (verrou sur le parent) ====='
select c.conrelid::regclass::text as table_, c.conname as contrainte,
       (select n_live_tup from pg_stat_user_tables s where s.relid = c.conrelid) as lignes
  from pg_constraint c
 where c.contype = 'f'
   and c.connamespace::regnamespace::text <> 'pg_catalog'
   and not exists (
     select 1 from pg_index i
      where i.indrelid = c.conrelid
        and (select array_agg(k order by ord)
               from unnest(i.indkey::int2[]) with ordinality t(k, ord)
              where ord <= array_length(c.conkey, 1)) = c.conkey)
 order by lignes desc nulls last, 1, 2;

\echo '===== H. tables sans clé primaire ====='
select c.relnamespace::regnamespace::text as schema, c.relname as table_
  from pg_class c
 where c.relkind = 'r'
   and c.relnamespace::regnamespace::text not in ('pg_catalog', 'information_schema')
   and not exists (select 1 from pg_constraint k
                    where k.conrelid = c.oid and k.contype = 'p')
 order by 1, 2;
