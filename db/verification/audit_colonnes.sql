-- Inspection colonne par colonne de toute la base, en lecture seule.
--
-- Pour chaque colonne de chaque table qui porte des lignes : combien de nuls,
-- combien de chaines vides, combien de chaines qui ne contiennent que des
-- espaces. Une colonne entierement nulle est soit une colonne morte, soit une
-- promesse non tenue : dans les deux cas elle merite d'etre nommee.
--
--   psql -U postgres -h localhost -d regalica_local -f db/verification/audit_colonnes.sql

\pset pager off
\pset footer off

create temporary table if not exists _audit_colonnes (
  schema_ text, table_ text, colonne text, type_ text,
  lignes bigint, nuls bigint, vides bigint, blancs bigint, distincts bigint
) on commit preserve rows;
truncate _audit_colonnes;

do $$
declare
  r record;
  n bigint;
  v_nuls bigint;
  v_vides bigint;
  v_blancs bigint;
  v_distincts bigint;
  v_lignes bigint;
begin
  for r in
    select c.table_schema as s, c.table_name as t, c.column_name as col, c.data_type as ty
      from information_schema.columns c
      join pg_class pc on pc.relname = c.table_name
      join pg_namespace pn on pn.oid = pc.relnamespace and pn.nspname = c.table_schema
     where pc.relkind = 'r'
       and c.table_schema not in ('pg_catalog', 'information_schema', 'extensions')
     order by 1, 2, c.ordinal_position
  loop
    execute format('select count(*) from %I.%I', r.s, r.t) into v_lignes;
    if v_lignes = 0 then continue; end if;

    execute format('select count(*) filter (where %I is null), count(distinct %I) from %I.%I',
                   r.col, r.col, r.s, r.t)
      into v_nuls, v_distincts;

    v_vides := 0;
    v_blancs := 0;
    if r.ty in ('text', 'character varying', 'character') then
      execute format($f$select count(*) filter (where %I = ''),
                            count(*) filter (where %I <> '' and btrim(%I) = '')
                       from %I.%I$f$, r.col, r.col, r.col, r.s, r.t)
        into v_vides, v_blancs;
    end if;

    insert into _audit_colonnes
      values (r.s, r.t, r.col, r.ty, v_lignes, v_nuls, v_vides, v_blancs, v_distincts);
  end loop;
end $$;

\echo '===== 1. COLONNES ENTIEREMENT NULLES (la promesse non tenue) ====='
select schema_ || '.' || table_ as table_, colonne, type_, lignes
  from _audit_colonnes
 where nuls = lignes
 order by lignes desc, 1, 2;

\echo ''
\echo '===== 2. COLONNES MAJORITAIREMENT NULLES (plus de la moitie) ====='
select schema_ || '.' || table_ as table_, colonne, lignes, nuls,
       round(100.0 * nuls / lignes, 1) as pourcent_nul
  from _audit_colonnes
 where nuls > 0 and nuls < lignes and nuls * 2 > lignes
 order by pourcent_nul desc, lignes desc
 limit 40;

\echo ''
\echo '===== 3. CHAINES VIDES ET CHAINES BLANCHES (des nuls qui ne disent pas leur nom) ====='
select schema_ || '.' || table_ as table_, colonne, lignes, vides, blancs
  from _audit_colonnes
 where vides > 0 or blancs > 0
 order by vides + blancs desc
 limit 30;

\echo ''
\echo '===== 4. COLONNES CONSTANTES (une seule valeur pour toutes les lignes) ====='
-- Une colonne qui ne prend qu'une valeur sur des milliers de lignes ne
-- distingue rien : soit c'est un defaut jamais surcharge, soit une donnee
-- ecrite en dur qui aurait du varier.
select schema_ || '.' || table_ as table_, colonne, type_, lignes
  from _audit_colonnes
 where distincts = 1 and lignes > 20 and nuls = 0
 order by lignes desc
 limit 30;

\echo ''
\echo '===== 5. RESUME PAR TABLE ====='
select schema_ || '.' || table_ as table_, max(lignes) as lignes,
       count(*) as colonnes,
       count(*) filter (where nuls = lignes) as colonnes_vides,
       count(*) filter (where nuls > 0) as colonnes_avec_nuls
  from _audit_colonnes
 group by 1
 having max(lignes) > 0
 order by 2 desc;
