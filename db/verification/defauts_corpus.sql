-- Relevé des défauts C1 à C10 du corpus juridique, en lecture seule.
--
-- Defects are named in docs/validation-chat-malica/strategie-corpus-2026-11-11.md.
-- Every count here is a definition: the before/after report quotes this file,
-- so the same query measures the same thing on staging, on the test base and
-- on a blank base rebuilt from the repository.
--
--   psql "$DATABASE_URL" -f db/verification/defauts_corpus.sql
--
-- "In force" means: valid_from <= the reference date < valid_to (or valid_to null).
-- The reference date is a psql variable so that a replay is not tied to the day.

\set ON_ERROR_STOP 1
\pset pager off
\pset footer off
\if :{?au}
\else
  \set au '2026-11-11'
\endif

begin transaction read only;

\echo '===== C1. Article « abrogé » portant une version en vigueur ====='
select a.corpus, count(*) as articles
  from legal.articles a
 where a.statut = 'abroge'
   and exists (select 1 from legal.article_versions v
                where v.article_id = a.id
                  and v.valid_from <= date :'au'
                  and (v.valid_to is null or v.valid_to > date :'au'))
 group by rollup (a.corpus)
 order by a.corpus nulls last;

\echo ''
\echo '===== C2. Article couvert avant et après 2024, sans version pour 2024 ====='
select a.corpus, count(*) as articles
  from legal.articles a
 where exists (select 1 from legal.article_versions v
                where v.article_id = a.id and v.valid_from < date '2024-01-01')
   and exists (select 1 from legal.article_versions v
                where v.article_id = a.id
                  and (v.valid_to is null or v.valid_to > date '2025-01-01'))
   and not exists (select 1 from legal.article_versions v
                    where v.article_id = a.id
                      and v.valid_from < date '2025-01-01'
                      and (v.valid_to is null or v.valid_to > date '2024-01-01'))
 group by rollup (a.corpus)
 order by a.corpus nulls last;

\echo ''
\echo '===== C2 bis. Éditions détenues par code fiscal (une ligne par millésime) ====='
select a.corpus,
       string_agg(distinct v.edition_min::text, ', ' order by v.edition_min::text) as editions
  from legal.articles a
  join legal.article_versions v on v.article_id = a.id
 where a.corpus in ('CTVA', 'CIRPPIS', 'CDET', 'CDPF', 'CFL', 'RECUEIL')
 group by a.corpus
 order by a.corpus;

\echo ''
\echo '===== C3. Article « en vigueur » sans version ouverte à la date ====='
select a.corpus, count(*) as articles
  from legal.articles a
 where a.statut = 'en_vigueur'
   and not exists (select 1 from legal.article_versions v
                    where v.article_id = a.id
                      and v.valid_from <= date :'au'
                      and (v.valid_to is null or v.valid_to > date :'au'))
 group by rollup (a.corpus)
 order by a.corpus nulls last;

\echo ''
\echo '===== C4. Statut « indéterminé », par famille ====='
select coalesce(n.famille, '(sans nom)') as famille, count(*) as articles
  from legal.articles a
  left join legal.corpus_noms n on n.code = a.corpus
 where a.statut = 'indetermine'
 group by rollup (coalesce(n.famille, '(sans nom)'))
 order by 1 nulls last;

\echo ''
\echo '===== C5. Versions longues (plus de 20 000 caractères ou plus de 10 fragments) ====='
select a.corpus, a.numero,
       length(coalesce(v.texte_fr, v.texte_ar)) as caracteres,
       (select count(*) from legal.chunks c where c.article_version_id = v.id) as fragments
  from legal.article_versions v
  join legal.articles a on a.id = v.article_id
 where length(coalesce(v.texte_fr, v.texte_ar)) > 20000
    or (select count(*) from legal.chunks c where c.article_version_id = v.id) > 10
 order by 3 desc
 limit 50;

\echo ''
\echo '===== C6. Versions de code dont la date de validité est un 1er janvier d''édition ====='
select a.corpus,
       count(*) filter (where v.valid_from = make_date(v.edition_min, 1, 1)) as debut_au_1er_janvier,
       count(*) filter (where v.valid_to is not null
                          and v.valid_to = make_date(extract(year from v.valid_to)::int, 1, 1)) as fin_au_1er_janvier,
       count(*) as versions
  from legal.article_versions v
  join legal.articles a on a.id = v.article_id
  join legal.corpus_noms n on n.code = a.corpus and n.famille = 'code'
 where v.edition_min is not null
 group by rollup (a.corpus)
 order by a.corpus nulls last;

\echo ''
\echo '===== C7. Versions sans référence au Journal Officiel, par famille ====='
select coalesce(n.famille, '(sans nom)') as famille,
       count(*) filter (where v.jort_reference is null) as sans_jort,
       count(*) as versions
  from legal.article_versions v
  join legal.articles a on a.id = v.article_id
  left join legal.corpus_noms n on n.code = a.corpus
 group by rollup (coalesce(n.famille, '(sans nom)'))
 order by 1 nulls last;

\echo ''
\echo '===== C8. Extraction « incertain » ou « partiel », par corpus ====='
select a.corpus,
       count(*) filter (where v.extraction_confiance = 'incertain') as incertain,
       count(*) filter (where v.extraction_confiance = 'partiel') as partiel
  from legal.article_versions v
  join legal.articles a on a.id = v.article_id
 where v.extraction_confiance <> 'verbatim'
 group by rollup (a.corpus)
 order by a.corpus nulls last;

\echo ''
\echo '===== C9. Couverture arabe des codes (versions avec texte arabe / versions) ====='
select a.corpus,
       count(*) filter (where v.texte_ar is not null) as avec_arabe,
       count(*) as versions
  from legal.article_versions v
  join legal.articles a on a.id = v.article_id
  join legal.corpus_noms n on n.code = a.corpus and n.famille = 'code'
 group by a.corpus
 order by a.corpus;

\echo ''
\echo '===== C10. Corpus sans nom, et documents en échec ====='
select a.corpus, count(*) as articles,
       case when n.code is null then 'absent de corpus_noms' else 'nom français vide' end as defaut
  from legal.articles a
  left join legal.corpus_noms n on n.code = a.corpus
 where n.code is null or nullif(btrim(n.nom_fr), '') is null
 group by a.corpus, n.code
 order by a.corpus;

select corpus, annee, langue, echec_motif
  from legal.ingestion_queue
 where statut = 'echec'
 order by corpus, annee;

commit;
