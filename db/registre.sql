-- Le catalogue d'une base, objet par objet : ce que db/registre.mjs compare.
-- Une seule requête, en lecture seule, qui rend (genre, objet, definition).
-- Relevée sur un serveur distant par psql :
--   psql -At -c "select coalesce(json_agg(c), '[]') from ( <cette requête> ) c"
--
-- ================================================================ CE QUI EST COMPARÉ
--
-- La base elle-même (encodage, locale, limite de connexions, droits, réglages
-- propres à la base, commentaire) ; schémas ; extensions (leur version) ;
-- types autonomes ; relations (genre, propriétaire, RLS activée et forcée,
-- persistance, identité de réplication, options, clé et bornes de partition,
-- droits) ; colonnes (position, type, nullabilité, défaut, génération,
-- identité, collation, stockage, compression, cible de statistiques, options,
-- droits) ; contraintes ; index (définition, options, regroupement, identité
-- de réplication) ; séquences (paramètres, colonne propriétaire) ; vues ;
-- fonctions, procédures et agrégats (définition complète, propriétaire,
-- droits) ; déclencheurs ; politiques ; règles ; héritage ; droits par défaut ;
-- conversions de types ; opérateurs, classes et familles d'opérateurs ;
-- méthodes d'accès ; langages ; transformations ; conversions d'encodage ;
-- collations ; configurations, dictionnaires, analyseurs et modèles de
-- recherche textuelle ; statistiques étendues ; publications et
-- souscriptions ; enveloppes, serveurs et correspondances d'utilisateurs
-- étrangers ; déclencheurs d'événement ; étiquettes de sécurité ;
-- commentaires.
--
-- Les droits sont rendus comme des ENSEMBLES triés (aclexplode), le défaut
-- explicité (acldefault) : l'ordre des GRANT n'est pas un écart. Les noms sont
-- qualifiés à la main (quote_ident), jamais par ::regclass, qui dépendrait du
-- search_path. registre.mjs ramène les fins de ligne à LF : c'est la SEULE
-- normalisation du texte — un corps qui ne diffère que par des CR n'est pas
-- un écart, tout autre caractère en est un.
--
-- ================================================================ CE QUI NE L'EST PAS, ET POURQUOI
--
-- Rien d'autre n'est écarté. Une catégorie absente de cette liste et de la
-- précédente est un oubli : l'ajouter à la requête, pas à la liste.
--
--   - Les DONNÉES : le référentiel semé par les migrations a son comparateur
--     (db/verification/comparer-referentiel.mjs), le corpus ses empreintes
--     par table (docs/etat-staging.md, B.1).
--   - Le contenu de app.migrations : registre.mjs le confronte aux fichiers du
--     dépôt, nom et empreinte (ecartsDuRegistre) ; la date d'application varie
--     par nature.
--   - Le NOM et le PROPRIÉTAIRE de la base : ils diffèrent par construction
--     entre la base de travail et la base jetable de référence. Dans les
--     droits de la base, le propriétaire est rendu « <propriétaire> ».
--   - Les RÔLES et leurs appartenances : globaux au serveur, partagés par ses
--     bases. Ce qu'un rôle PEUT faire dans la base est comparé par les droits ;
--     que malica_api ne contourne pas la RLS est éprouvé par
--     apps/api/src/isolation.test.ts.
--   - L'intérieur des EXTENSIONS (pgvector, pgcrypto, btree_gist) : leurs
--     objets suivent leur version, qui est comparée (pg_depend, deptype 'e').
--   - Les objets du serveur : pg_catalog, information_schema, pg_toast, et les
--     langages, méthodes d'accès et conversions de types créés par initdb
--     (numéro d'objet < 16384), présents avant toute migration.
--   - Les déclencheurs INTERNES : ceux qui mettent en œuvre les clés
--     étrangères, comparées comme contraintes.
--   - Les options des tables TOAST, et les colonnes SUPPRIMÉES : la position
--     d'une colonne est son rang parmi les colonnes vivantes.
--   - Le STOCKAGE PHYSIQUE : tailles, gonflement, statistiques du
--     planificateur, tablespaces, grands objets. Le dépôt n'en crée aucun.
--
-- Une base relevée sur un AUTRE serveur que la référence (registre.mjs
-- --catalogue) peut différer sur la ligne « base » — encodage, locale : c'est
-- une différence réelle d'environnement, dite, pas écartée.
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
-- la base elle-même : ni son nom ni son propriétaire (voir l'en-tête)
select 'base' as genre, 'courante' as objet,
       'encodage=' || pg_encoding_to_char(d.encoding) || ' fournisseur=' || d.datlocprovider::text
       || ' collate=' || d.datcollate || ' ctype=' || d.datctype || ' locale=' || coalesce(d.datlocale, '')
       || ' règles_icu=' || coalesce(d.daticurules, '') || ' limite_connexions=' || d.datconnlimit
       || ' droits=' ||
       (select coalesce(string_agg(format('%s=%s%s/%s',
                case when a.grantee = 0 then 'PUBLIC' when a.grantee = d.datdba then '<propriétaire>' else pg_get_userbyid(a.grantee) end,
                a.privilege_type, case when a.is_grantable then '*' else '' end,
                case when a.grantor = d.datdba then '<propriétaire>' else pg_get_userbyid(a.grantor) end), ',' order by 1), '')
          from aclexplode(coalesce(d.datacl, acldefault('d', d.datdba))) a)
       || ' réglages=' || coalesce((select array_to_string(st.setconfig, ',') from pg_db_role_setting st
                                     where st.setdatabase = d.oid and st.setrole = 0), '') as definition
  from pg_database d
 where d.datname = current_database()
union all
-- les schémas
select 'schéma', quote_ident(n.nspname),
       'propriétaire=' || pg_get_userbyid(n.nspowner) || ' droits=' ||
       (select coalesce(string_agg(format('%s=%s%s/%s',
                case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
                a.privilege_type, case when a.is_grantable then '*' else '' end,
                pg_get_userbyid(a.grantor)), ',' order by 1), '')
          from aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a)
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
       || ' clé_de_partition=' || coalesce(case when r.relkind = 'p' then pg_get_partkeydef(r.oid) end, '')
       || ' bornes=' || coalesce((select pg_get_expr(c.relpartbound, c.oid) from pg_class c where c.oid = r.oid), '')
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
       || ' stockage=' || a.attstorage::text
       || ' compression=' || a.attcompression::text
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
       || ' identité_réplication=' || (select i.indisreplident from pg_index i where i.indexrelid = r.oid)
  from rel r
 where r.relkind in ('i', 'I')
union all
-- les séquences
select 'séquence', r.nom,
       format('type=%s début=%s incrément=%s min=%s max=%s cache=%s cycle=%s',
              format_type(s.seqtypid, null), s.seqstart, s.seqincrement, s.seqmin, s.seqmax, s.seqcache, s.seqcycle)
       || ' possédée_par=' || coalesce((select t.nom || '.' || quote_ident(att.attname)
                                          from pg_depend dp
                                          join rel t on t.oid = dp.refobjid
                                          join pg_attribute att on att.attrelid = dp.refobjid and att.attnum = dp.refobjsubid
                                         where dp.classid = 'pg_class'::regclass and dp.objid = s.seqrelid
                                           and dp.refclassid = 'pg_class'::regclass and dp.deptype in ('a', 'i')), '')
  from pg_sequence s join rel r on r.oid = s.seqrelid
union all
-- les vues
select 'vue', r.nom, pg_get_viewdef(r.oid)
  from rel r
 where r.relkind in ('v', 'm')
union all
-- les fonctions et procédures : définition complète, propriétaire, droits
select 'fonction', quote_ident(ns.nspname) || '.' || quote_ident(p.proname) || '(' || pg_get_function_identity_arguments(p.oid) || ')',
       case when p.prokind = 'a'
            then (select format('agrégat transition=%s type=%s finale=%s combinaison=%s initiale=%s tri=%s genre=%s',
                                ag.aggtransfn::regproc, format_type(ag.aggtranstype, null), ag.aggfinalfn::regproc,
                                ag.aggcombinefn::regproc, coalesce(ag.agginitval, ''), ag.aggsortop::regoper, ag.aggkind)
                    from pg_aggregate ag where ag.aggfnoid = p.oid)
                 || ' arguments=' || pg_get_function_arguments(p.oid)
            else pg_get_functiondef(p.oid) end
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
-- les langages, méthodes d'accès, classes et familles d'opérateurs,
-- transformations, conversions d'encodage, analyseurs et modèles de recherche
select 'langage', quote_ident(l.lanname),
       'fiable=' || l.lanpltrusted || ' propriétaire=' || pg_get_userbyid(l.lanowner) || ' droits=' ||
       (select coalesce(string_agg(format('%s=%s%s/%s',
                case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
                a.privilege_type, case when a.is_grantable then '*' else '' end,
                pg_get_userbyid(a.grantor)), ',' order by 1), '')
          from aclexplode(coalesce(l.lanacl, acldefault('l', l.lanowner))) a)
  from pg_language l
 where l.oid >= 16384
   and not exists (select 1 from ext where ext.classid = 'pg_language'::regclass and ext.objid = l.oid)
union all
select 'méthode_d_accès', quote_ident(am.amname), am.amtype::text || ' ' || am.amhandler::regproc::text
  from pg_am am
 where am.oid >= 16384
   and not exists (select 1 from ext where ext.classid = 'pg_am'::regclass and ext.objid = am.oid)
union all
select 'classe_d_opérateurs', quote_ident(ns.nspname) || '.' || quote_ident(oc.opcname) || ' ' || am.amname,
       'type=' || format_type(oc.opcintype, null) || ' défaut=' || oc.opcdefault
  from pg_opclass oc join ns on ns.oid = oc.opcnamespace join pg_am am on am.oid = oc.opcmethod
 where not exists (select 1 from ext where ext.classid = 'pg_opclass'::regclass and ext.objid = oc.oid)
union all
select 'famille_d_opérateurs', quote_ident(ns.nspname) || '.' || quote_ident(ofa.opfname) || ' ' || am.amname, ''
  from pg_opfamily ofa join ns on ns.oid = ofa.opfnamespace join pg_am am on am.oid = ofa.opfmethod
 where not exists (select 1 from ext where ext.classid = 'pg_opfamily'::regclass and ext.objid = ofa.oid)
union all
select 'transformation', format_type(tr.trftype, null) || ' ' || (select lanname from pg_language where oid = tr.trflang),
       tr.trffromsql::regproc::text || ' ' || tr.trftosql::regproc::text
  from pg_transform tr
 where not exists (select 1 from ext where ext.classid = 'pg_transform'::regclass and ext.objid = tr.oid)
union all
select 'conversion_d_encodage', quote_ident(ns.nspname) || '.' || quote_ident(cv.conname),
       pg_encoding_to_char(cv.conforencoding) || ' -> ' || pg_encoding_to_char(cv.contoencoding)
       || ' ' || cv.conproc::regproc::text || ' défaut=' || cv.condefault
  from pg_conversion cv join ns on ns.oid = cv.connamespace
 where not exists (select 1 from ext where ext.classid = 'pg_conversion'::regclass and ext.objid = cv.oid)
union all
select 'analyseur_de_recherche', quote_ident(ns.nspname) || '.' || quote_ident(pr.prsname), pr.prsstart::regproc::text
  from pg_ts_parser pr join ns on ns.oid = pr.prsnamespace
 where not exists (select 1 from ext where ext.classid = 'pg_ts_parser'::regclass and ext.objid = pr.oid)
union all
select 'modèle_de_recherche', quote_ident(ns.nspname) || '.' || quote_ident(tm.tmplname), tm.tmpllexize::regproc::text
  from pg_ts_template tm join ns on ns.oid = tm.tmplnamespace
 where not exists (select 1 from ext where ext.classid = 'pg_ts_template'::regclass and ext.objid = tm.oid)
union all
-- les données étrangères, les souscriptions, les étiquettes de sécurité
select 'enveloppe_étrangère', quote_ident(fw.fdwname),
       coalesce(fw.fdwhandler::regproc::text, '') || ' options=' || coalesce(array_to_string(fw.fdwoptions, ','), '')
  from pg_foreign_data_wrapper fw
 where not exists (select 1 from ext where ext.classid = 'pg_foreign_data_wrapper'::regclass and ext.objid = fw.oid)
union all
select 'serveur_étranger', quote_ident(sv.srvname),
       'type=' || coalesce(sv.srvtype, '') || ' options=' || coalesce(array_to_string(sv.srvoptions, ','), '')
  from pg_foreign_server sv
union all
select 'correspondance_utilisateur', um.srvname || ' ' || um.usename, coalesce(array_to_string(um.umoptions, ','), '')
  from pg_user_mappings um
union all
select 'souscription', quote_ident(su.subname), 'publications=' || array_to_string(su.subpublications, ',')
  from pg_subscription su
 where su.subdbid = (select oid from pg_database where datname = current_database())
union all
select 'étiquette_de_sécurité', sl.provider || ' ' || io.type || ' ' || io.identity, sl.label
  from pg_seclabel sl
  cross join lateral pg_identify_object(sl.classoid, sl.objoid, sl.objsubid) io
union all
-- les déclencheurs d'événement
select 'déclencheur_événement', quote_ident(ev.evtname),
       ev.evtevent || ' ' || ev.evtfoid::regproc::text || ' état=' || ev.evtenabled::text
  from pg_event_trigger ev
union all
-- les commentaires (pg_identify_object : non traduit) ; celui de la base
-- courante sous un nom neutre, puisque le nom diffère par construction
select 'commentaire',
       case when d.classoid = 'pg_database'::regclass then 'base courante' else io.type || ' ' || io.identity end,
       d.description
  from pg_description d
  cross join lateral pg_identify_object(d.classoid, d.objoid, d.objsubid) io
 where (d.classoid <> 'pg_database'::regclass
        or d.objoid = (select oid from pg_database where datname = current_database()))
   and not exists (select 1 from ext where ext.classid = d.classoid and ext.objid = d.objoid)
   and coalesce(io.schema, '') not in ('pg_catalog', 'information_schema')
