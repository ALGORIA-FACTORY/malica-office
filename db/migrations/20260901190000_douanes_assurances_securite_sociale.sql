-- Ce qu'un cabinet applique aussi, et qui manquait.
--
--   CTVA 2024   l'edition francaise 2024 du code de la TVA. Nos editions
--               francaises s'arretaient a 2023 et les seules plus recentes
--               etaient arabes : interrogee sur 2026, Malica repondait qu'elle
--               n'avait pas le texte francais en vigueur. Elle l'a maintenant.
--   CDOUANE     code des douanes — la TVA a l'importation, les regimes
--               suspensifs, la valeur en douane. Une PME importatrice y est tous
--               les jours.
--   CNSS        loi 60-30 sur l'organisation de la securite sociale — les
--               cotisations sociales de la paie.
--   CASSUR      code des assurances, publie par le Comite general des assurances.
--
-- Restent hors corpus, faute de source telechargeable : le code des changes (en
-- cours de refonte parlementaire), la loi 2018-52 sur le registre national des
-- entreprises, et la loi 88-108 sur le statut des experts-comptables. Elles ne
-- sont pas oubliees : elles sont notees ici pour qu'on les cherche.

begin;

insert into legal.ingestion_queue (priorite, type_document, corpus, annee, titre, langue, url_fichier, statut)
values
  (5, 'CODE_CONSOLIDE', 'CTVA', 2024,
   'Code de la taxe sur la valeur ajoutee, edition 2024', 'fr',
   'https://alliance-tunisie.com/wp-content/uploads/2024/06/CODE-DE-LA-TVA-2024.pdf', 'a_faire'),
  (4, 'CODE_CONSOLIDE', 'CDOUANE', null,
   'Code des douanes', 'fr',
   'http://chaexpert.com/documents/CODE%20DES%20DOUANES.pdf', 'a_faire'),
  (4, 'CODE_CONSOLIDE', 'CNSS', 1960,
   'Loi 60-30 du 14 decembre 1960 relative a l''organisation des regimes de securite sociale', 'fr',
   'http://www.alliance-tunisie.com/wp-content/uploads/2019/05/LOI-CNSS.pdf', 'a_faire'),
  (4, 'CODE_CONSOLIDE', 'CASSUR', null,
   'Code des assurances', 'fr',
   'https://www.cga.gov.tn/fileadmin/contenus/pdf/Code_Assurance_Version_FR.pdf', 'a_faire')
on conflict do nothing;

commit;
