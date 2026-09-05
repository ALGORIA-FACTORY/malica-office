-- Les codes qui commandent la comptabilite, et qui manquaient.
--
-- ================================================== POURQUOI
--
-- Le corpus etait purement fiscal : huit codes, tous des impots. Or un cabinet
-- comptable ne travaille pas que sur ce qu'on paie, il travaille d'abord sur ce
-- qu'on a le DROIT de faire. Quatre textes commandent la tenue des comptes plus
-- directement que n'importe quel code d'impot :
--
--   CSC   code des societes commerciales — constitution, capital, assemblees,
--         comptes sociaux, fusion, liquidation, responsabilite du gerant. C'est
--         lui qui impose la tenue, l'approbation et le depot des comptes.
--   COC   code des obligations et des contrats (1907) — le droit commun de tout
--         contrat : c'est le fondement de toute facture et de toute creance.
--   CCOM  code de commerce — l'acte de commerce, le fonds, les effets de
--         commerce, la faillite.
--   SCE   loi 96-112 relative au systeme comptable des entreprises — le texte
--         qui institue le plan comptable et les normes tunisiennes.
--   CTRAV code du travail — les charges sociales et le contrat de travail des
--         salaries de la PME.
--
-- ================================================== LES SOURCES
--
-- Les fac-similes de l'Imprimerie Officielle circulent sur plusieurs sites ;
-- droit-afrique.com, le plus connu, refuse le telechargement direct (HTTP 403).
-- On prend donc les copies servies par la Banque Nationale Agricole et par des
-- cabinets, et le CMF pour la loi 96-112. Ce ne sont pas les sites de
-- l'Imprimerie Officielle elle-meme : la colonne
-- source_url conserve donc l'adresse exacte d'ou le texte a ete tire, et
-- extraction_confiance dira ce que vaut l'extraction. Le jour ou une edition
-- officielle plus recente sera disponible, elle s'ajoutera comme une edition de
-- plus — le modele « une identite, des versions » est fait pour cela.

begin;

insert into legal.ingestion_queue (priorite, type_document, corpus, annee, titre, langue, url_fichier, statut)
values
  (5, 'CODE_CONSOLIDE', 'CSC', 2011,
   'Code des societes commerciales (edition 2011)', 'fr',
   'https://alliance-tunisie.com/wp-content/uploads/2024/06/CODE-DES-SOCIETES-COMMERCIALES.pdf', 'a_faire'),
  (5, 'CODE_CONSOLIDE', 'COC', 2010,
   'Code des obligations et des contrats (edition 2010)', 'fr',
   'http://www.bna.tn/documents/Code_des_obligations_et_des_contrats.pdf', 'a_faire'),
  (5, 'CODE_CONSOLIDE', 'CCOM', 2010,
   'Code de commerce (edition 2010)', 'fr',
   'http://www.bna.tn/documents/code_de_commerce.pdf', 'a_faire'),
  (5, 'CODE_CONSOLIDE', 'CTRAV', 2020,
   'Code du travail (edition 2020)', 'fr',
   'http://chaexpert.com/documents/Code%20Travail%20Tunisie%202020.pdf', 'a_faire'),
  (5, 'CODE_CONSOLIDE', 'CSC', 2011,
   'Code des societes commerciales, edition arabe', 'ar',
   'https://www.cmf.tn/sites/default/files/pdfs/reglementation/textes-reference/code_societes_ar.pdf', 'a_faire'),
  (5, 'CODE_CONSOLIDE', 'SCE', 1996,
   'Loi n 96-112 du 30 decembre 1996 relative au systeme comptable des entreprises', 'fr',
   'https://www.cmf.tn/sites/default/files/pdfs/reglementation/textes-reference/loi_96-112_301296_fr.pdf', 'a_faire')
on conflict do nothing;

commit;
