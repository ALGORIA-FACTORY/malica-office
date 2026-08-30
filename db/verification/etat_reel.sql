-- État réel de la base, en lecture seule. Aucune écriture, aucun verrou.
-- À comparer avec ce que les migrations promettent.

\pset pager off
\pset footer off

\echo '===== 1. RÔLES ====='
select rolname, rolcanlogin as peut_se_connecter, rolbypassrls as contourne_rls,
       rolinherit as herite
  from pg_roles
 where rolname not like 'pg\_%'
 order by rolname;

\echo '===== 2. SCHÉMAS ET NOMBRE DE TABLES ====='
select n.nspname as schema, count(c.oid) filter (where c.relkind = 'r') as tables,
       count(c.oid) filter (where c.relkind = 'v') as vues
  from pg_namespace n
  left join pg_class c on c.relnamespace = n.oid
 where n.nspname not in ('pg_catalog','information_schema','pg_toast')
 group by n.nspname order by n.nspname;

\echo '===== 3. TABLES AVEC tenant_id : RLS ET INDEX ====='
select c.relnamespace::regnamespace::text as schema, c.relname as table_,
       c.relrowsecurity as rls, c.relforcerowsecurity as forcee,
       (select count(*) from pg_policy p where p.polrelid = c.oid) as policies,
       exists (
         select 1 from pg_index i
          where i.indrelid = c.oid
            and (select attname from pg_attribute
                  where attrelid = c.oid and attnum = i.indkey[0]) = 'tenant_id'
       ) as index_menant_tenant
  from pg_class c
 where c.relkind = 'r'
   and c.relnamespace::regnamespace::text not in ('pg_catalog','information_schema')
   and exists (select 1 from pg_attribute a
                where a.attrelid = c.oid and a.attname = 'tenant_id' and a.attnum > 0)
 order by index_menant_tenant, schema, table_;

\echo '===== 4. TABLES SANS RLS (hors ref/app) ====='
select c.relnamespace::regnamespace::text as schema, c.relname as table_
  from pg_class c
 where c.relkind = 'r'
   and not c.relrowsecurity
   and c.relnamespace::regnamespace::text in
       ('identity','capture','socle','immo','stocks','banque','collab','coffre',
        'schedule','audit','agents','billing','pricing','payments','catalog',
        'contracts','commissions','legal','sync','ref')
 order by 1,2;

\echo '===== 5. VUES : security_invoker ====='
select c.relname as vue,
       coalesce((select option_value from pg_options_to_table(c.reloptions)
                  where option_name = 'security_invoker'), 'NON DÉFINI') as invoker
  from pg_class c
 where c.relkind = 'v' and c.relnamespace::regnamespace::text = 'public'
 order by invoker, vue;

\echo '===== 6. VUES LISIBLES MAIS TABLE DE BASE REFUSÉE ====='
-- le défaut trouvé sur les 5 tables ref : droit sur la vue, pas sur la table
select c.relname as vue, has_table_privilege('authenticated', c.oid, 'select') as vue_lisible
  from pg_class c
 where c.relkind = 'v' and c.relnamespace::regnamespace::text = 'public'
   and not has_table_privilege('authenticated', c.oid, 'select')
 order by 1;

\echo '===== 7. TABLES ref : DROIT DE LECTURE ====='
select c.relname as table_, c.relrowsecurity as rls,
       (select count(*) from pg_policy p where p.polrelid = c.oid) as policies,
       has_table_privilege('authenticated', c.oid, 'select') as lisible_authenticated
  from pg_class c
 where c.relkind = 'r' and c.relnamespace::regnamespace::text = 'ref'
 order by lisible_authenticated, c.relname;

\echo '===== 8. FONCTIONS security definer ====='
select p.pronamespace::regnamespace::text as schema, p.proname as fonction,
       p.prosecdef as security_definer,
       coalesce(array_to_string(p.proconfig, ', '), 'AUCUN search_path') as config
  from pg_proc p
 where p.pronamespace::regnamespace::text in ('app','public','auth','identity','nomenclature')
   and p.prosecdef
 order by 1,2;

\echo '===== 9. LE COMPTE 4367 ET SES VOISINS ====='
select a.account_code, a.label, a.account_class, p.jurisdiction, p.version
  from ref.accounts a join ref.jurisdiction_packs p on p.id = a.pack_version_id
 where a.account_code in ('4366','4367','4368','4369','665','6654','701')
 order by a.account_code;

\echo '===== 10. IMPUTATION DU DROIT DE TIMBRE ====='
select code, document_kind, account_code, fixed_amount, legal_reference
  from ref.fiscal_charges order by code, document_kind;

\echo '===== 11. VOLUMES RÉELS ====='
select c.relnamespace::regnamespace::text as schema, c.relname as table_,
       c.reltuples::bigint as lignes_estimees
  from pg_class c
 where c.relkind = 'r'
   and c.relnamespace::regnamespace::text not in
       ('pg_catalog','information_schema','pg_toast')
 order by c.reltuples desc nulls last limit 25;

\echo '===== 12. TABLES VIDES ====='
select c.relnamespace::regnamespace::text as schema, c.relname as table_
  from pg_class c
 where c.relkind = 'r' and c.reltuples = 0
   and c.relnamespace::regnamespace::text not in
       ('pg_catalog','information_schema','pg_toast')
 order by 1,2;

\echo '===== 13. UTILISATEURS ET ORGANISATIONS ====='
select (select count(*) from auth.users) as utilisateurs,
       (select count(*) from identity.organizations) as organisations,
       (select count(*) from identity.memberships) as rattachements,
       (select count(*) from identity.engagements) as mandats;

\echo '===== 14. INDEX EXISTANTS PAR SCHÉMA ====='
select schemaname as schema, count(*) as index_
  from pg_indexes
 where schemaname not in ('pg_catalog','information_schema')
 group by schemaname order by schemaname;

\echo '===== 15. EXTENSIONS ====='
select extname, extnamespace::regnamespace::text as schema from pg_extension order by 1;
