-- Un article de test dans la base jetable, encodé par le vecteur que l'encodeur
-- simulé rend (e0) : il remonte à distance 0 pour toute question.
with a as (
  insert into legal.articles (jurisdiction, corpus, numero, statut)
  values ('TN', 'CONSTAT-TEST', '52', 'en_vigueur') returning id
), v as (
  insert into legal.article_versions (article_id, version_num, source_sha256, valid_from, extraction_confiance)
  select id, 1, repeat('0', 64), date '2020-01-01', 'verbatim' from a returning id
)
insert into legal.chunks (article_version_id, ordinal, langue, texte, caracteres, embedding, pricing_id, encode_le)
select v.id, 1, 'fr', 'Article de test : la retenue à la source sur les loyers est fixée par le paramétrage.', length('Article de test : la retenue à la source sur les loyers est fixée par le paramétrage.'),
       ('[1' || repeat(',0', 1023) || ']')::extensions.vector, (select id from agents.model_pricing where role = 'embedding' limit 1), timestamptz '2026-11-09 00:00+00'
  from v;
insert into legal.ingestion_queue (priorite, type_document, corpus, titre, langue) values (1, 'CODE_CONSOLIDE', 'CONSTAT-TEST', 'Corpus de test', 'fr');
