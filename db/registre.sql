-- Le catalogue d'une base, objet par objet : ce que db/registre.mjs compare.
-- Une seule requête, en lecture seule, qui rend (genre, objet, definition).
-- Relevée sur un serveur distant par psql :
--   psql -At -c "select coalesce(json_agg(c), '[]') from ( <cette requête> ) c"
--
-- Les droits sont rendus comme des ENSEMBLES triés (aclexplode) et le défaut
-- est explicité (acldefault) : l'ordre des GRANT n'est pas un écart.
-- Les objets appartenant à une extension sont écartés (pg_depend, 'e').
-- Les noms sont qualifiés à la main (quote_ident), jamais par ::regclass,
-- qui dépendrait du search_path.
with ns as (
  select oid, nspname
    from pg_namespace
   where nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
     and nspname not like 'pg\_temp\_%'
     and nspname not like 'pg\_toast\_temp\_%'
),
ext as (
  select classid, objid from pg_depend where deptype = 'e'
),
rel as (
  select c.oid, c.relkind, c.relowner, c.relacl, c.reloptions, c.relrowsecurity,
         c.relforcerowsecurity, c.relpersistence, c.relreplident,
         quote_ident(ns.nspname) || '.' || quote_ident(c.relname) as nom
    from pg_class c
    join ns on ns.oid = c.relnamespace
   where c.relkind in ('r', 'p', 'v', 'm', 'S', 'f', 'i', 'I')
     and not exists (select 1 from ext where ext.classid = 'pg_class'::regclass and ext.objid = c.oid)
)
-- les schémas
select 'schéma' as genre, quote_ident(n.nspname) as objet,
       'propriétaire=' || pg_get_userbyid(n.nspowner) || ' droits=' ||
       (select coalesce(string_agg(format('%s=%s%s/%s',
                case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
                a.privilege_type, case when a.is_grantable then '*' else '' end,
                pg_get_userbyid(a.grantor)), ',' order by 1), '')
          from aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a) as definition
  from pg_namespace n join ns on ns.oid = n.oid
union all
-- les extensions : leur version, pas leur contenu
select 'extension', e.extname, e.extversion || ' dans ' || quote_ident(n.nspname)
  from pg_extension e join pg_namespace n on n.oid = e.extnamespace
union all
-- les types autonomes : énumérations, domaines, intervalles, composites
select 'type', quote_ident(ns.nspname) || '.' || quote_ident(t.typname),
       case t.typtype
         when 'e' then 'énumération(' || (select string_agg(quote_literal(enumlabel), ',' order by enumsortorder)
                                          from pg_enum where enumtypid = t.oid) || ')'
         when 'd' then 'domaine ' || format_type(t.typbasetype, t.typtypmod)
                       || case when t.typnotnull then ' not null' else '' end
                       || coalesce(' default ' || t.typdefault, '')
                       || coalesce((select ' ' || string_agg(conname || ' ' || pg_get_constraintdef(oid), ' ; ' order by conname)
                                      from pg_constraint where contypid = t.oid), '')
         when 'r' then 'intervalle de ' || (select format_type(rngsubtype, null) from pg_range where rngtypid = t.oid)
         else 'composite(' || (select string_agg(quote_ident(attname) || ' ' || format_type(atttypid, atttypmod), ',' order by attnum)
                               from pg_attribute where attrelid = t.typrelid and attnum > 0 and not attisdropped) || ')'
       end
       || ' propriétaire=' || pg_get_userbyid(t.typowner) || ' droits=' ||
       (select coalesce(string_agg(format('%s=%s%s/%s',
                case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
                a.privilege_type, case when a.is_grantable then '*' else '' end,
                pg_get_userbyid(a.grantor)), ',' order by 1), '')
          from aclexplode(coalesce(t.typacl, acldefault('T', t.typowner))) a)
  from pg_type t join ns on ns.oid = t.typnamespace
 where (t.typtype in ('e', 'd', 'r')
        or (t.typtype = 'c' and (select relkind from pg_class where oid = t.typrelid) = 'c'))
   and not exists (select 1 from ext where ext.classid = 'pg_type'::regclass and ext.objid = t.oid)
union all
-- les relations : genre, propriétaire, RLS, options, droits
select 'relation', r.nom,
       'genre=' || r.relkind::text || ' propriétaire=' || pg_get_userbyid(r.relowner)
       || ' rls=' || r.relrowsecurity || ' rls_forcée=' || r.relforcerowsecurity
       || ' persistance=' || r.relpersistence::text
       || ' identité_réplication=' || r.relreplident::text
       || ' options=' || coalesce(array_to_string(r.reloptions, ','), '')
       || ' droits=' ||
       (select coalesce(string_agg(format('%s=%s%s/%s',
                case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
                a.privilege_type, case when a.is_grantable then '*' else '' end,
                pg_get_userbyid(a.grantor)), ',' order by 1), '')
          from aclexplode(coalesce(r.relacl, acldefault((case when r.relkind = 'S' then 's' else 'r' end)::"char", r.relowner))) a)
  from rel r
 where r.relkind not in ('i', 'I')
union all
-- les colonnes : position, type, nullabilité, défaut, génération, identité, collation, droits
select 'colonne', r.nom || '.' || quote_ident(a.attname),
       'position=' || row_number() over (partition by a.attrelid order by a.attnum)
       || ' type=' || format_type(a.atttypid, a.atttypmod)
       || ' non_nul=' || a.attnotnull
       || ' défaut=' || coalesce(pg_get_expr(d.adbin, d.adrelid), '')
       || ' générée=' || a.attgenerated::text
       || ' identité=' || a.attidentity::text
       || ' collation=' || case when a.attcollation <> t.typcollation
                                then coalesce((select collname from pg_collation where oid = a.attcollation), '?')
                                else '' end
       || ' statistiques=' || coalesce(a.attstattarget::text, '')
       || ' options=' || coalesce(array_to_string(a.attoptions, ','), '')
       || ' droits=' ||
       (select coalesce(string_agg(format('%s=%s%s/%s',
                case when x.grantee = 0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end,
                x.privilege_type, case when x.is_grantable then '*' else '' end,
                pg_get_userbyid(x.grantor)), ',' order by 1), '')
          from aclexplode(a.attacl) x)
  from pg_attribute a
  join rel r on r.oid = a.attrelid
  join pg_type t on t.oid = a.atttypid
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
 where r.relkind in ('r', 'p', 'v', 'm', 'f')
   and a.attnum > 0 and not a.attisdropped
union all
-- les contraintes de table
select 'contrainte', r.nom || '.' || quote_ident(con.conname),
       pg_get_constraintdef(con.oid)
       || ' reportable=' || con.condeferrable || ' reportée=' || con.condeferred
       || ' validée=' || con.convalidated
  from pg_constraint con join rel r on r.oid = con.conrelid
union all
-- les index
select 'index', r.nom,
       pg_get_indexdef(r.oid) || ' options=' || coalesce(array_to_string(r.reloptions, ','), '')
       || ' regroupé=' || (select i.indisclustered from pg_index i where i.indexrelid = r.oid)
  from rel r
 where r.relkind in ('i', 'I')
union all
-- les séquences
select 'séquence', r.nom,
       format('type=%s début=%s incrément=%s min=%s max=%s cache=%s cycle=%s',
              format_type(s.seqtypid, null), s.seqstart, s.seqincrement, s.seqmin, s.seqmax, s.seqcache, s.seqcycle)
  from pg_sequence s join rel r on r.oid = s.seqrelid
union all
-- les vues
select 'vue', r.nom, pg_get_viewdef(r.oid)
  from rel r
 where r.relkind in ('v', 'm')
union all
-- les fonctions et procédures : définition complète, propriétaire, droits
select 'fonction', quote_ident(ns.nspname) || '.' || quote_ident(p.proname) || '(' || pg_get_function_identity_arguments(p.oid) || ')',
       case when p.prokind = 'a' then 'agrégat' else pg_get_functiondef(p.oid) end
       || ' propriétaire=' || pg_get_userbyid(p.proowner) || ' droits=' ||
       (select coalesce(string_agg(format('%s=%s%s/%s',
                case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
                a.privilege_type, case when a.is_grantable then '*' else '' end,
                pg_get_userbyid(a.grantor)), ',' order by 1), '')
          from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a)
  from pg_proc p join ns on ns.oid = p.pronamespace
 where not exists (select 1 from ext where ext.classid = 'pg_proc'::regclass and ext.objid = p.oid)
union all
-- les déclencheurs
select 'déclencheur', r.nom || '.' || quote_ident(tg.tgname),
       pg_get_triggerdef(tg.oid) || ' état=' || tg.tgenabled::text
  from pg_trigger tg join rel r on r.oid = tg.tgrelid
 where not tg.tgisinternal
union all
-- les politiques RLS
select 'politique', r.nom || '.' || quote_ident(pol.polname),
       format('commande=%s permissive=%s rôles=%s using=%s check=%s',
              pol.polcmd, pol.polpermissive,
              (select string_agg(case when ro = 0 then 'PUBLIC' else pg_get_userbyid(ro) end, ',' order by 1)
                 from unnest(pol.polroles) ro),
              coalesce(pg_get_expr(pol.polqual, pol.polrelid), ''),
              coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), ''))
  from pg_policy pol join rel r on r.oid = pol.polrelid
union all
-- les règles (hors celle qui fait d'une relation une vue)
select 'règle', r.nom || '.' || quote_ident(ru.rulename), pg_get_ruledef(ru.oid)
  from pg_rewrite ru join rel r on r.oid = ru.ev_class
 where ru.rulename <> '_RETURN'
union all
-- l'héritage et le partitionnement
select 'héritage', c.nom || ' < ' || p.nom, 'rang=' || i.inhseqno
  from pg_inherits i join rel c on c.oid = i.inhrelid join rel p on p.oid = i.inhparent
union all
-- les droits par défaut
select 'droits_par_défaut',
       pg_get_userbyid(da.defaclrole) || ' ' || coalesce(quote_ident(n.nspname), '*') || ' ' || da.defaclobjtype::text,
       (select coalesce(string_agg(format('%s=%s%s/%s',
                case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
                a.privilege_type, case when a.is_grantable then '*' else '' end,
                pg_get_userbyid(a.grantor)), ',' order by 1), '')
          from aclexplode(da.defaclacl) a)
  from pg_default_acl da left join pg_namespace n on n.oid = da.defaclnamespace
union all
-- les conversions et opérateurs définis par le dépôt
select 'conversion', format_type(ca.castsource, null) || ' -> ' || format_type(ca.casttarget, null),
       coalesce(ca.castfunc::regprocedure::text, '') || ' contexte=' || ca.castcontext::text || ' méthode=' || ca.castmethod::text
  from pg_cast ca
 where ca.oid >= 16384
   and not exists (select 1 from ext where ext.classid = 'pg_cast'::regclass and ext.objid = ca.oid)
union all
select 'opérateur',
       quote_ident(ns.nspname) || '.' || o.oprname || '(' || format_type(o.oprleft, null) || ',' || format_type(o.oprright, null) || ')',
       o.oprcode::text
  from pg_operator o join ns on ns.oid = o.oprnamespace
 where not exists (select 1 from ext where ext.classid = 'pg_operator'::regclass and ext.objid = o.oid)
union all
-- les collations, configurations et dictionnaires de recherche textuelle du dépôt
select 'collation', quote_ident(ns.nspname) || '.' || quote_ident(co.collname),
       'fournisseur=' || co.collprovider::text || ' collate=' || coalesce(co.collcollate, '') || ' ctype=' || coalesce(co.collctype, '')
       || ' locale=' || coalesce(co.colllocale, '') || ' déterministe=' || co.collisdeterministic
  from pg_collation co join ns on ns.oid = co.collnamespace
 where not exists (select 1 from ext where ext.classid = 'pg_collation'::regclass and ext.objid = co.oid)
union all
select 'recherche_textuelle', quote_ident(ns.nspname) || '.' || quote_ident(cf.cfgname),
       'analyseur=' || cf.cfgparser::regproc::text || ' ' ||
       coalesce((select string_agg(m.maptokentype || ':' || m.mapdict::regdictionary::text, ',' order by m.maptokentype, m.mapseqno)
                   from pg_ts_config_map m where m.mapcfg = cf.oid), '')
  from pg_ts_config cf join ns on ns.oid = cf.cfgnamespace
 where not exists (select 1 from ext where ext.classid = 'pg_ts_config'::regclass and ext.objid = cf.oid)
union all
select 'dictionnaire', quote_ident(ns.nspname) || '.' || quote_ident(di.dictname),
       di.dicttemplate::text || ' ' || coalesce(di.dictinitoption, '')
  from pg_ts_dict di join ns on ns.oid = di.dictnamespace
 where not exists (select 1 from ext where ext.classid = 'pg_ts_dict'::regclass and ext.objid = di.oid)
union all
-- les statistiques étendues et les publications
select 'statistiques', quote_ident(ns.nspname) || '.' || quote_ident(se.stxname), pg_get_statisticsobjdef(se.oid)
  from pg_statistic_ext se join ns on ns.oid = se.stxnamespace
union all
select 'publication', quote_ident(pu.pubname),
       'toutes_tables=' || pu.puballtables || ' ins=' || pu.pubinsert || ' upd=' || pu.pubupdate || ' del=' || pu.pubdelete
  from pg_publication pu
union all
-- les déclencheurs d'événement
select 'déclencheur_événement', quote_ident(ev.evtname),
       ev.evtevent || ' ' || ev.evtfoid::regproc::text || ' état=' || ev.evtenabled::text
  from pg_event_trigger ev
union all
-- les commentaires, sur tout objet créé par le dépôt (pg_identify_object : non traduit)
select 'commentaire', io.type || ' ' || io.identity, d.description
  from pg_description d
  cross join lateral pg_identify_object(d.classoid, d.objoid, d.objsubid) io
 where d.objoid >= 16384
   and d.classoid <> 'pg_database'::regclass
   and not exists (select 1 from ext where ext.classid = d.classoid and ext.objid = d.objoid)
   and coalesce(io.schema, '') not in ('pg_catalog', 'information_schema')
