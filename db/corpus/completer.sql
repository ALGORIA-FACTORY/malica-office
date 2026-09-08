-- Complète les colonnes que la reconstruction laisse vides.
--
-- L'audit colonne par colonne a montré quatre colonnes entièrement nulles sur
-- `legal.article_versions` : `source_url`, `amendements`, `modifie_par` et
-- `jort_reference`. Les trois premières sont récupérables — la quatrième ne
-- l'est pas depuis le texte, et reste nulle plutôt que d'être inventée.
--
--   psql -U postgres -h localhost -d malica_local -f db/corpus/completer.sql

\echo '===== 1. L''URL de la source ====='
-- Une version d'article sans son URL est une citation qu'on ne peut pas
-- vérifier. L'URL est connue : c'est celle de l'édition dont la version est
-- issue. Pour un code, le corpus porte son nom ; pour une loi de finances,
-- l'identité est « LF-2018 » alors que la file d'ingestion dit « LF » + année.
update legal.article_versions v
   set source_url = q.url_fichier
  from legal.articles a, legal.ingestion_queue q
 where a.id = v.article_id
   and v.source_url is null
   and q.url_fichier is not null
   and q.annee is not distinct from v.edition_min
   and (q.corpus = a.corpus or a.corpus = q.corpus || '-' || q.annee);

select count(*) filter (where source_url is not null) as avec_url,
       count(*) filter (where source_url is null) as sans_url,
       count(*) as total
  from legal.article_versions;

\echo ''
\echo '===== 2. Les mentions d''amendement ====='
-- Les éditions consolidées de la DGELF portent « (Modifié Art 69 LF 2024) » à
-- la fin des articles amendés. C'est le seul pont fiable vers l'historique des
-- modifications, et il était perdu. On le capture tel quel, sans le réécrire.
with mentions as (
  select v.id,
         array_agg(btrim(m[1], '()') order by m[1]) as trouvees
    from legal.article_versions v
    cross join lateral regexp_matches(
      coalesce(v.texte_fr, v.texte_ar),
      '(\((?:Modifi|Ajout|Abrog|Complét|Remplac)[^)]{0,200}\))',
      'gi') as m
   group by v.id
)
update legal.article_versions v
   set amendements = (select array_agg(distinct x) from unnest(m.trouvees) x),
       modifie_par = m.trouvees[1]
  from mentions m
 where m.id = v.id;

select count(*) filter (where amendements is not null) as avec_amendements,
       count(*) filter (where modifie_par is not null) as avec_modifie_par,
       count(*) as total
  from legal.article_versions;

\echo ''
\echo '===== 3. Ce qui reste nul, et pourquoi ====='
select 'jort_reference' colonne,
       count(*) filter (where jort_reference is null) as nuls,
       'la référence au Journal officiel n''est pas dans le texte des éditions consolidées'::text as raison
  from legal.article_versions
union all
select 'texte_ar',
       count(*) filter (where texte_ar is null),
       'les éditions arabes ne couvrent pas tous les codes ; le français fait foi aussi'
  from legal.article_versions
union all
select 'valid_to',
       count(*) filter (where valid_to is null),
       'version toujours en vigueur : la nullité est ici l''information'
  from legal.article_versions;
