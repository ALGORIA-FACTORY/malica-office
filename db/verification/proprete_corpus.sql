-- Propreté du corpus : ce qui est incohérent, orphelin ou en double.
--
-- Les autres scripts mesurent la QUALITÉ du contenu. Celui-ci mesure l'ÉTAT DE LA
-- BASE : rien ne doit pendre dans le vide, rien ne doit exister en deux
-- exemplaires, rien ne doit se contredire. Chaque bloc doit rendre zéro — sauf
-- ceux dont le commentaire dit explicitement ce qu'ils tolèrent.
--
--   psql -U postgres -d malica_local -f db/verification/proprete_corpus.sql

\pset pager off
\pset footer off

\echo '===== 1. ORPHELINS : tout doit rendre 0 ====='
select 'articles sans aucune version' quoi, count(*)::text combien
  from legal.articles a
 where not exists (select 1 from legal.article_versions v where v.article_id = a.id)
union all
select 'versions sans article',
       (select count(*)::text from legal.article_versions v
         where not exists (select 1 from legal.articles a where a.id = v.article_id))
union all
select 'versions sans aucun fragment',
       (select count(*)::text from legal.article_versions v
         where not exists (select 1 from legal.chunks c where c.article_version_id = v.id))
union all
select 'fragments sans version',
       (select count(*)::text from legal.chunks c
         where not exists (select 1 from legal.article_versions v where v.id = c.article_version_id))
union all
select 'fragments sans empreinte',
       (select count(*)::text from legal.chunks where embedding is null)
union all
select 'empreintes sans tarif',
       (select count(*)::text from legal.chunks where embedding is not null and pricing_id is null)
union all
select 'articles rattachés à une source inconnue',
       (select count(*)::text from legal.articles a
         where a.source_code is not null
           and not exists (select 1 from legal.sources s where s.code = a.source_code));

\echo ''
\echo '===== 2. COHÉRENCE INTERNE : tout doit rendre 0 ====='
select 'versions sans aucun texte' quoi, count(*)::text combien
  from legal.article_versions where texte_fr is null and texte_ar is null
union all
select 'langue déclarée qui ne correspond pas au texte détenu',
       (select count(*)::text from legal.article_versions
         where (langue_faisant_foi = 'ar' and texte_ar is null)
            or (langue_faisant_foi = 'fr' and texte_fr is null))
union all
select 'bornes de validité inversées (valid_to <= valid_from)',
       (select count(*)::text from legal.article_versions
         where valid_to is not null and valid_to <= valid_from)
union all
select 'articles abrogés sans citation',
       (select count(*)::text from legal.articles where statut = 'abroge' and abroge_par is null)
union all
select 'éditions incohérentes (edition_min > edition_max)',
       (select count(*)::text from legal.article_versions
         where edition_min is not null and edition_max is not null and edition_min > edition_max)
union all
select 'fragments dont le texte est vide',
       (select count(*)::text from legal.chunks where btrim(texte) = '')
union all
select 'fragments dont la longueur déclarée est fausse',
       (select count(*)::text from legal.chunks where caracteres <> length(texte))
union all
select 'fragments sans en-tête de contexte',
       (select count(*)::text from legal.chunks where entete is null)
union all
-- L'en-tête est écrite avec l'empreinte : elle dit ce qui a RÉELLEMENT été
-- encodé ce jour-là. Si le statut d'un article change, ou si une édition
-- s'ajoute, l'en-tête vieillit sans que rien ne le signale. Ce contrôle le
-- signale — et la réponse est de réencoder les fragments concernés.
select 'en-têtes vieillies depuis l''encodage',
       (select count(*)::text
          from legal.chunks c
          join legal.article_versions v on v.id = c.article_version_id
          join legal.articles a on a.id = v.article_id
         where c.entete is distinct from
               legal.entete_de_fragment(a.corpus, a.numero, v.edition_min, a.source_code, a.statut));

\echo ''
\echo '===== 3. DOUBLONS ====='
-- Deux versions d''un même article ne doivent jamais porter la même empreinte :
-- ce serait le même texte enregistré deux fois.
select 'articles en double (même corpus, même numéro)' quoi, count(*)::text combien
  from (select jurisdiction, corpus, numero from legal.articles
         group by 1,2,3 having count(*) > 1) d
union all
select 'versions identiques d''un même article (même SHA-256)',
       (select count(*)::text from (
          select article_id, source_sha256 from legal.article_versions
           group by 1,2 having count(*) > 1) d)
union all
select 'documents en double dans la file (même URL)',
       (select count(*)::text from (
          select url_fichier from legal.ingestion_queue
           where url_fichier is not null group by 1 having count(*) > 1) d)
union all
-- Le portail de la DGELF sert parfois le même PDF sous deux adresses, ou sous
-- deux années. Deux lignes actives sur un même fichier, c'est le même texte
-- rangé deux fois : l'une des deux doit être écartée, avec son motif.
select 'documents actifs en double dans la file (même empreinte)',
       (select count(*)::text from (
          select sha256_source from legal.ingestion_queue
           where sha256_source is not null and statut = 'ingere'
           group by 1 having count(*) > 1) d)
union all
-- Les notes communes et les normes comptables ne sont pas des « éditions » :
-- elles partagent toutes le même corpus et se distinguent par leur numéro.
select 'éditions en double (même corpus, année, langue)',
       (select count(*)::text from (
          select corpus, annee, langue from legal.ingestion_queue
           where type_document not in ('NOTE_COMMUNE', 'NORME_COMPTABLE')
           group by 1,2,3 having count(*) > 1) d);

\echo ''
\echo '===== 3 bis. LES NOTES COMMUNES CONTRE LEUR PROPRE EN-TÊTE ====='
-- Une note commune porte son identité sur elle-même : « NOTE COMMUNE N° 11/2009 ».
-- Si l'identité en base la contredit, de deux choses l'une : ou le portail s'est
-- trompé d'année et la note est rangée au mauvais endroit, ou la couche de texte
-- du PDF rend les chiffres à l'envers — et alors le texte servi n'est pas fiable.
-- Dans les deux cas la ligne doit disparaître : ce bloc doit rendre 0 ligne.
with lu as (
  select a.corpus, a.numero, v.extraction_confiance,
         regexp_match(substring(coalesce(v.texte_fr, v.texte_ar) from 1 for 1500),
                      'note\s+commune\s*n[^0-9]{0,4}(\d{1,3})\s*/\s*(\d{4})', 'i') as en_tete
    from legal.articles a
    join legal.article_versions v on v.article_id = a.id
   where a.corpus like 'NC-%'
)
select corpus, numero, extraction_confiance,
       en_tete[1] || '/' || en_tete[2] as lu_sur_la_note
  from lu
 where en_tete is not null
   and ('NC-' || en_tete[2], (en_tete[1]::int)::text) is distinct from (corpus, numero)
 order by corpus, numero;

\echo ''
\echo '===== 4. LA FILE D''INGESTION contre CE QUI EST EN BASE ====='
-- Un document marqué « ingéré » doit avoir produit des articles ; un document
-- qui a produit des articles ne doit pas rester « à faire ».
with produit as (
  select distinct corpus from legal.articles
  union select distinct regexp_replace(corpus, '-\d{4}$', '') from legal.articles
)
select q.type_document,
       count(*) as en_file,
       count(*) filter (where q.statut = 'ingere') as marques_ingeres,
       count(*) filter (where exists (select 1 from produit p where p.corpus = q.corpus)) as ont_produit_des_articles,
       count(*) filter (where q.url_fichier is null) as sans_url
  from legal.ingestion_queue q
 group by 1 order by 2 desc;

\echo ''
\echo '===== 5. CE QUI N''A RIEN PRODUIT, ET POURQUOI ====='
-- La liste doit être courte et chaque ligne explicable. Une édition qui ne
-- produit rien sans raison connue est un défaut, pas un fait.
select q.type_document, q.corpus, q.annee, q.langue
  from legal.ingestion_queue q
 where q.type_document in ('CODE_CONSOLIDE', 'LOI_FINANCES', 'CONVENTION')
   and not exists (
     select 1 from legal.articles a
      where a.corpus = q.corpus
         or a.corpus = q.corpus || '-' || q.annee)
 order by 1, 2, 3;

\echo ''
\echo '===== 6. VOLUMÉTRIE PAR FAMILLE ====='
select coalesce(s.libelle, '(non rattaché)') as nature,
       count(distinct a.id) as articles,
       count(distinct v.id) as versions,
       count(c.id) as fragments
  from legal.articles a
  left join legal.sources s on s.code = a.source_code
  left join legal.article_versions v on v.article_id = a.id
  left join legal.chunks c on c.article_version_id = v.id
 group by 1 order by 2 desc;
