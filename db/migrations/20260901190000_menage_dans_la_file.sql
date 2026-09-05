-- Menage : trois incoherences relevees par db/verification/proprete_corpus.sql.
--
-- 1. LA LOI DE L'INVESTISSEMENT, DEUX FOIS
--    La loi 2016-71 etait deja dans la file sous le corpus INCITATIONS, edition
--    2016. La migration 20260901160000 l'a rajoutee sous un corpus INVEST, avec
--    la meme adresse. Meme document, meme texte, trente-six articles ecrits deux
--    fois sous deux identites. On garde INCITATIONS, qui porte aussi la refonte
--    de 2017, et on retire INVEST.
--
-- 2. DEUX DECRETS-LOIS POUR LA MEME ANNEE
--    Le decret-loi 2021-21 du 28 decembre 2021 porte la loi de finances 2022 ;
--    le decret-loi 2022-69 du 22 novembre 2022 est un texte distinct de la meme
--    annee budgetaire. Ranges sous le meme corpus et le meme millesime, leurs
--    articles se confondaient : l'article 5 de l'un devenait une version de
--    l'article 5 de l'autre. Le second recoit son propre corpus.
--
-- 3. UNE NOTE COMMUNE INTROUVABLE
--    La note commune 6/2014 est referencee par le portail sans fichier. Elle
--    restait « a faire » indefiniment. On la marque « ignore » avec son motif :
--    un manque connu et documente vaut mieux qu'une tache qui ne finit jamais.

begin;

delete from legal.article_versions v
 using legal.articles a
 where a.id = v.article_id and a.corpus = 'INVEST';
delete from legal.articles where corpus = 'INVEST';
delete from legal.ingestion_queue where corpus = 'INVEST';

update legal.ingestion_queue
   set corpus = 'DECRET_LOI_FINANCES_NOV'
 where corpus = 'DECRET_LOI_FINANCES' and titre like '%2022-69%';

update legal.ingestion_queue
   set statut = 'ignore',
       echec_motif = 'Referencee par le portail de la DGI sans fichier telechargeable.'
 where type_document = 'NOTE_COMMUNE' and url_fichier is null;

commit;
