-- Qualité du corpus juridique, en lecture seule.
--
-- Ce script ne mesure pas la quantité. Il mesure ce qui est FAUX, et il le nomme. Un corpus qui grossit sans
-- que personne ne mesure ses défauts produit des réponses plausibles et
-- fausses, ce qui est pire que pas de réponse du tout.
--
--   psql -U postgres -h localhost -d regalica_local -f db/verification/qualite_corpus.sql

\pset pager off
\pset footer off

\echo '===== 1. VOLUMÉTRIE ====='
select 'documents en file' q, count(*)::text r from legal.ingestion_queue
union all select 'dont ingérés', count(*)::text from legal.ingestion_queue where statut = 'ingere'
union all select 'articles', count(*)::text from legal.articles
union all select 'versions', count(*)::text from legal.article_versions
union all select 'fragments vectorisés', count(*)::text from legal.chunks where embedding is not null
union all select 'fragments sans empreinte', count(*)::text from legal.chunks where embedding is null;

\echo ''
\echo '===== 2. DÉCOUPAGE : articles dont le corps n''est pas le bon ====='
-- Un article de code est court. Quand il pèse plus de 20 000 caractères, c'est
-- qu'il a avalé ce qui le suivait — une annexe, un tableau, un décret entier.
with derniere as (
  select distinct on (v.article_id) v.article_id, v.id,
         coalesce(v.texte_fr, v.texte_ar) as t
    from legal.article_versions v
   order by v.article_id, v.valid_from desc nulls last, v.version_num desc
)
select a.corpus,
       count(*) as articles,
       count(*) filter (where length(d.t) > 20000 and a.numero not like '%annexe') as demesures,
       count(*) filter (where length(d.t) between 5001 and 20000) as suspects,
       count(*) filter (where a.numero not like '%annexe'
                          and (d.t ilike '%chargés, chacun en ce qui le concerne%'
                            or d.t ilike '%exécution du présent décret%')) as blocs_de_signature,
       count(*) filter (where d.t ilike '%CHAPITRE%' and d.t ilike '%PAGES%') as tables_des_matieres,
       max(length(d.t)) as plus_long
  from legal.articles a
  join derniere d on d.article_id = a.id
 where exists (select 1 from legal.ingestion_queue q
                where q.corpus = a.corpus and q.type_document = 'CODE_CONSOLIDE')
 group by 1
 order by 3 desc, 5 desc;

\echo ''
\echo '===== 3. LANGUE : ce que la base déclare contre ce qu''elle détient ====='
select langue_faisant_foi as declare,
       count(*) filter (where texte_ar is not null) as detient_l_arabe,
       count(*) filter (where texte_ar is null and texte_fr is not null) as ne_detient_que_le_francais,
       count(*) filter (where texte_ar is null and texte_fr is null) as ne_detient_rien
  from legal.article_versions
 group by 1;

\echo ''
\echo '===== 4. VÉRITÉS CONNUES : chaque ligne doit dire « oui » ====='
-- Des faits qu'un expert-comptable tunisien vérifierait de tête. Si l'un tombe
-- à « non », le corpus ment sur un point que tout le monde connaît — et il ment
-- donc probablement ailleurs, là où personne ne le vérifie.
-- On interroge la derniere version DE CHAQUE LANGUE : le francais et l'arabe
-- font foi l'un comme l'autre, et une edition arabe plus recente ne doit pas
-- faire disparaitre le texte francais du controle.
with derniere as (
  select distinct on (v.article_id, v.langue_faisant_foi)
         v.article_id, coalesce(v.texte_fr, v.texte_ar) as t
    from legal.article_versions v
   order by v.article_id, v.langue_faisant_foi, v.valid_from desc nulls last, v.version_num desc
),
art as (
  -- Les sauts de ligne de l'extraction coupent les expressions en deux :
  -- « registre du\ncommerce » ne repondait a aucun ilike '%registre du
  -- commerce%'. On aplatit les blancs avant de chercher.
  select a.corpus, a.numero, regexp_replace(d.t, '\s+', ' ', 'g') as t
    from legal.articles a join derniere d on d.article_id = a.id
)
select 'CTVA art. 7 fixe le taux normal de TVA' controle,
       coalesce((select bool_or(t ilike '%taux de 19%' or t like '%19%')
                   from art where corpus = 'CTVA' and numero = '7'), false) as ok
union all
select 'CTVA art. 9 traite du droit à déduction',
       coalesce((select bool_or(t ilike '%déductible%' or t like '%طرح%')
                   from art where corpus = 'CTVA' and numero = '9'), false)
union all
select 'CIRPPIS art. 52 fixe les retenues à la source',
       coalesce((select bool_or(t ilike '%retenue à la source%')
                   from art where corpus = 'CIRPPIS' and numero = '52'), false)
union all
select 'CDET art. 127 impose la mention du timbre sur facture',
       coalesce((select bool_or(t ilike '%droit de timbre%' and t ilike '%facture%')
                   from art where corpus = 'CDET' and numero = '127'), false)
union all
select 'CDPF art. 1 ouvre le code des droits et procédures',
       coalesce((select bool_or(length(t) between 50 and 5000)
                   from art where corpus = 'CDPF' and numero = '1'), false)
union all
select 'CFL art. 1 ouvre le code de la fiscalité locale',
       coalesce((select bool_or(length(t) between 50 and 8000)
                   from art where corpus = 'CFL' and numero = '1'), false)
union all
select 'CSC art. 14 impose l''immatriculation au registre du commerce',
       coalesce((select bool_or(t ilike '%registre du commerce%')
                   from art where corpus = 'CSC' and numero = '14'), false)
union all
select 'SCE art. 21 fixe le délai des états financiers',
       coalesce((select bool_or(t ilike '%trois mois%')
                   from art where corpus = 'SCE' and numero = '21'), false)
union all
select 'COC art. 2 énonce les éléments de validité de l''obligation',
       coalesce((select bool_or(length(t) between 50 and 5000)
                   from art where corpus = 'COC' and numero = '2'), false)
union all
select 'les notes communes n''obligent que l''administration',
       coalesce((select bool_and(s.opposable_a = array['administration'])
                   from legal.articles a join legal.sources s on s.code = a.source_code
                  where a.corpus like 'NC-%'), false);

\echo ''
\echo '===== 5. COUVERTURE : articles attendus contre articles présents ====='
select a.corpus,
       count(*) as articles_identifies,
       count(*) filter (where v.n > 1) as a_plusieurs_versions,
       max(v.n) as versions_max
  from legal.articles a
  join (select article_id, count(*) as n from legal.article_versions group by 1) v
    on v.article_id = a.id
 where exists (select 1 from legal.ingestion_queue q
                where q.corpus = a.corpus and q.type_document = 'CODE_CONSOLIDE')
 group by 1 order by 2 desc;

\echo ''
\echo '===== 6. LANGUES : le français et l''arabe font foi tous les deux ====='
-- Un corpus qui ne détiendrait que le français prétendrait connaître le droit
-- tunisien sans détenir sa version qui fait foi. On compte donc, code par code,
-- les articles dont on tient VRAIMENT le texte dans chaque langue.
select a.corpus,
       count(distinct a.id) as articles,
       count(distinct a.id) filter (where v.texte_fr is not null) as en_francais,
       count(distinct a.id) filter (where v.texte_ar is not null) as en_arabe,
       count(distinct a.id) filter (where v.texte_fr is not null and v.texte_ar is null) as francais_seul
  from legal.articles a
  join legal.article_versions v on v.article_id = a.id
 where exists (select 1 from legal.ingestion_queue q
                where q.corpus = a.corpus and q.type_document = 'CODE_CONSOLIDE')
 group by 1 order by 2 desc;

\echo ''
\echo '===== 7. PROVENANCE : ce que vaut le texte que l''on sert ====='
-- « verbatim » = extrait du PDF officiel. « partiel » = PDF à police maison,
-- déchiffré : lettres sûres, quelques signes perdus. « incertain » = microfilm
-- passé à la reconnaissance optique. Servir de l'OCR sans le dire serait mentir.
select extraction_confiance, count(*) as versions,
       count(distinct article_id) as articles,
       min(edition_min) as premiere_edition, max(edition_max) as derniere_edition
  from legal.article_versions
 group by 1 order by 2 desc;

\echo ''
\echo '===== 8. DATATION : de quoi répondre « au 31/12/2024 » et pas seulement « aujourd''hui » ====='
-- Une version bornée des deux côtés est une version qu''on sait situer dans le
-- temps. Sans elles, la recherche ne sait dire que « le dernier état ».
select count(*) as versions,
       count(*) filter (where valid_to is not null) as bornees,
       count(*) filter (where valid_to is null) as encore_en_vigueur,
       min(valid_from) as plus_ancienne, max(valid_from) as plus_recente
  from legal.article_versions;

\echo ''
\echo '===== 9. AUTORITÉ : chaque article sait-il ce qu''il vaut ? ====='
-- La table legal.sources dit, par type de texte, son autorité et à qui il est
-- opposable. Tant qu''aucun article n''y renvoie, Regalica cite un texte sans
-- savoir s''il oblige le contribuable ou seulement l''administration.
select coalesce(a.source_code, '(non rattaché)') as source,
       coalesce(s.libelle, '—') as nature,
       coalesce(s.autorite, '—') as autorite,
       coalesce(array_to_string(s.opposable_a, ', '), '—') as opposable_a,
       count(*) as articles
  from legal.articles a
  left join legal.sources s on s.code = a.source_code
 group by 1,2,3,4 order by 5 desc;

\echo ''
\echo '===== 10. STATUT : l''article tient-il encore debout ? ====='
-- « abrogé » vaut pour l''avenir ; « annulé » efface rétroactivement. Un article
-- déclaré abrogé doit porter la citation qui le prouve — la contrainte
-- articles_abrogation_citee l''impose, on vérifie ici qu''elle est respectée.
select statut, count(*) as articles,
       count(abroge_par) as avec_citation,
       count(*) filter (where statut = 'abroge' and abroge_par is null) as abrogations_non_justifiees
  from legal.articles group by 1 order by 2 desc;

\echo ''
\echo '===== 11. PUBLICATION OFFICIELLE : peut-on prouver où le texte a paru ? ====='
-- Devant un contrôle, citer un article ne suffit pas : il faut montrer sa
-- publication. Les éditions consolidées de la DGELF n''en portent pas — ce sont
-- des compilations administratives, pas des numéros du Journal Officiel — et
-- leur absence de référence est donc exacte, pas un défaut.
select case when exists (select 1 from legal.ingestion_queue q
                          where q.corpus = a.corpus and q.type_document = 'CODE_CONSOLIDE')
            then 'édition consolidée (pas de JORT attendu)'
            else 'texte publié au JORT' end as genre,
       count(*) as versions,
       count(v.jort_reference) as avec_reference,
       count(distinct v.jort_reference) as numeros_distincts
  from legal.article_versions v join legal.articles a on a.id = v.article_id
 group by 1 order by 2 desc;

\echo ''
\echo '===== 12. AUCUN ARTICLE SAUTÉ : les trous dans la numérotation ====='
-- Un code numérote ses articles de 1 à N. Si la base en détient 538 alors que le
-- dernier porte le n° 746, il manque 208 numéros — ou bien ils ont été abrogés,
-- ou bien le découpage les a ratés. Cette requête ne tranche pas : elle compte,
-- et laisse voir. Les numéros suffixés (13 bis) et les annexes sont exclus du
-- calcul, qui ne porte que sur la suite des entiers.
with numeros as (
  select a.corpus, (regexp_match(a.numero, '^([0-9]{1,4})$'))[1]::int as n
    from legal.articles a
   where exists (select 1 from legal.ingestion_queue q
                  where q.corpus = a.corpus and q.type_document = 'CODE_CONSOLIDE')
     and a.numero ~ '^[0-9]{1,4}$'
)
select corpus,
       count(*) as articles_entiers,
       min(n) as premier, max(n) as dernier,
       max(n) - min(n) + 1 - count(*) as numeros_absents,
       round(100.0 * count(*) / nullif(max(n) - min(n) + 1, 0), 1) as pourcentage_couvert
  from numeros
 group by 1 order by 5 desc;
