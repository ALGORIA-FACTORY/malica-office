-- Les normes comptables tunisiennes : ce que la loi 96-112 institue.
--
-- La loi relative au systeme comptable des entreprises est entree au corpus ;
-- les normes qu'elle institue, non. Or c'est LA doctrine comptable obligatoire :
-- la NC 05 dit comment amortir une immobilisation, la NC 03 quand un revenu se
-- constate, la NC 41 comment traiter un contrat de location. Un cabinet les
-- applique tous les jours, plus souvent que le code de la TVA.
--
-- ================================================== POURQUOI UN TYPE A PART
--
-- Une norme comptable n'est pas decoupee en articles : elle est redigee en
-- paragraphes numerotes. La decouper en articles serait lui inventer une
-- structure qu'elle n'a pas. Elle suit donc le meme modele que les notes
-- communes : UNE NORME = UN TEXTE, corpus NCT, numero = le numero de la norme.
--
-- Chaque norme est approuvee par arrete du ministre des finances : son autorite
-- dans legal.sources est celle d'un arrete, opposable a tous.
--
-- Aucune n'a de millesime : l'annee est deduite du texte le plus recent que la
-- norme cite, comme pour les editions de code sans date. C'est une borne
-- inferieure, pas une date de publication, et c'est dit comme tel.
--
-- Les normes 21 a 42 viennent du site du ministere des finances ; les normes 1 a
-- 20, absentes de ce site, d'une copie du fac-simile officiel. La colonne
-- source_url conserve l'adresse exacte de chaque provenance.

begin;

insert into legal.ingestion_queue (priorite, type_document, corpus, annee, titre, langue, url_fichier, statut)
values
  (4, 'NORME_COMPTABLE', 'NCT', null, 'NCT 1 - Norme comptable generale', 'fr', 'https://www.exacomaudit.com/docs/Normes-comptables-Tunisie/NCT01.pdf', 'a_faire'),
  (4, 'NORME_COMPTABLE', 'NCT', null, 'NCT 2 - Capitaux propres', 'fr', 'https://www.exacomaudit.com/docs/Normes-comptables-Tunisie/NCT02.pdf', 'a_faire'),
  (4, 'NORME_COMPTABLE', 'NCT', null, 'NCT 3 - Revenus', 'fr', 'https://www.exacomaudit.com/docs/Normes-comptables-Tunisie/NCT03.pdf', 'a_faire'),
  (4, 'NORME_COMPTABLE', 'NCT', null, 'NCT 4 - Stocks', 'fr', 'https://www.exacomaudit.com/docs/Normes-comptables-Tunisie/NCT04.pdf', 'a_faire'),
  (4, 'NORME_COMPTABLE', 'NCT', null, 'NCT 5 - Immobilisations corporelles', 'fr', 'https://www.exacomaudit.com/docs/Normes-comptables-Tunisie/NCT05.pdf', 'a_faire'),
  (4, 'NORME_COMPTABLE', 'NCT', null, 'NCT 6 - Immobilisations incorporelles', 'fr', 'https://www.exacomaudit.com/docs/Normes-comptables-Tunisie/NCT06.pdf', 'a_faire'),
  (4, 'NORME_COMPTABLE', 'NCT', null, 'NCT 7 - Placements', 'fr', 'https://www.exacomaudit.com/docs/Normes-comptables-Tunisie/NCT07.pdf', 'a_faire'),
  (4, 'NORME_COMPTABLE', 'NCT', null, 'NCT 8 - Resultat net de l''exercice et elements extraordinaires', 'fr', 'https://www.exacomaudit.com/docs/Normes-comptables-Tunisie/NCT08.pdf', 'a_faire'),
  (4, 'NORME_COMPTABLE', 'NCT', null, 'NCT 9 - Contrats de construction', 'fr', 'https://www.exacomaudit.com/docs/Normes-comptables-Tunisie/NCT09.pdf', 'a_faire'),
  (4, 'NORME_COMPTABLE', 'NCT', null, 'NCT 10 - Charges reportees', 'fr', 'https://www.exacomaudit.com/docs/Normes-comptables-Tunisie/NCT10.pdf', 'a_faire'),
  (4, 'NORME_COMPTABLE', 'NCT', null, 'NCT 11 - Modifications comptables', 'fr', 'https://www.exacomaudit.com/docs/Normes-comptables-Tunisie/NCT11.pdf', 'a_faire'),
  (4, 'NORME_COMPTABLE', 'NCT', null, 'NCT 12 - Subventions publiques', 'fr', 'https://www.exacomaudit.com/docs/Normes-comptables-Tunisie/NCT12.pdf', 'a_faire'),
  (4, 'NORME_COMPTABLE', 'NCT', null, 'NCT 13 - Charges d''emprunt', 'fr', 'https://www.exacomaudit.com/docs/Normes-comptables-Tunisie/NCT13.pdf', 'a_faire'),
  (4, 'NORME_COMPTABLE', 'NCT', null, 'NCT 14 - Eventualites et evenements posterieurs a la date de cloture', 'fr', 'https://www.exacomaudit.com/docs/Normes-comptables-Tunisie/NCT14.pdf', 'a_faire'),
  (4, 'NORME_COMPTABLE', 'NCT', null, 'NCT 15 - Operations en monnaies etrangeres', 'fr', 'https://www.exacomaudit.com/docs/Normes-comptables-Tunisie/NCT15.pdf', 'a_faire'),
  (4, 'NORME_COMPTABLE', 'NCT', null, 'NCT 16 - Presentation des etats financiers des OPCVM', 'fr', 'https://www.exacomaudit.com/docs/Normes-comptables-Tunisie/NCT16.pdf', 'a_faire'),
  (4, 'NORME_COMPTABLE', 'NCT', null, 'NCT 17 - Portefeuille-titres dans les OPCVM', 'fr', 'https://www.exacomaudit.com/docs/Normes-comptables-Tunisie/NCT17.pdf', 'a_faire'),
  (4, 'NORME_COMPTABLE', 'NCT', null, 'NCT 18 - Controle interne et organisation comptable dans les OPCVM', 'fr', 'https://www.exacomaudit.com/docs/Normes-comptables-Tunisie/NCT18.pdf', 'a_faire'),
  (4, 'NORME_COMPTABLE', 'NCT', null, 'NCT 19 - Etats financiers intermediaires', 'fr', 'https://www.exacomaudit.com/docs/Normes-comptables-Tunisie/NCT19.pdf', 'a_faire'),
  (4, 'NORME_COMPTABLE', 'NCT', null, 'NCT 20 - Depenses de recherche et de developpement', 'fr', 'https://www.exacomaudit.com/docs/Normes-comptables-Tunisie/NCT20.pdf', 'a_faire'),
  (4, 'NORME_COMPTABLE', 'NCT', null, 'NCT 21 - Presentation des etats financiers des etablissements bancaires', 'fr', 'https://www.finances.gov.tn/sites/default/files/NC21.pdf', 'a_faire'),
  (4, 'NORME_COMPTABLE', 'NCT', null, 'NCT 22 - Controle interne et organisation comptable dans les etablissements bancaires', 'fr', 'https://www.finances.gov.tn/sites/default/files/NC22.pdf', 'a_faire'),
  (4, 'NORME_COMPTABLE', 'NCT', null, 'NCT 23 - Operations en devises dans les etablissements bancaires', 'fr', 'https://www.finances.gov.tn/sites/default/files/NC23.pdf', 'a_faire'),
  (4, 'NORME_COMPTABLE', 'NCT', null, 'NCT 24 - Engagements et revenus y afferents dans les etablissements bancaires', 'fr', 'https://www.finances.gov.tn/sites/default/files/NC24.pdf', 'a_faire'),
  (4, 'NORME_COMPTABLE', 'NCT', null, 'NCT 25 - Portefeuille-titres dans les etablissements bancaires', 'fr', 'https://www.finances.gov.tn/sites/default/files/NC25.pdf', 'a_faire'),
  (4, 'NORME_COMPTABLE', 'NCT', null, 'NCT 26 - Presentation des etats financiers des entreprises d''assurance', 'fr', 'https://www.finances.gov.tn/sites/default/files/NC26.pdf', 'a_faire'),
  (4, 'NORME_COMPTABLE', 'NCT', null, 'NCT 27 - Controle interne et organisation comptable dans les entreprises d''assurance', 'fr', 'https://www.finances.gov.tn/sites/default/files/NC27.pdf', 'a_faire'),
  (4, 'NORME_COMPTABLE', 'NCT', null, 'NCT 28 - Revenus dans les entreprises d''assurance', 'fr', 'https://www.finances.gov.tn/sites/default/files/NC28.pdf', 'a_faire'),
  (4, 'NORME_COMPTABLE', 'NCT', null, 'NCT 29 - Provisions techniques', 'fr', 'https://www.finances.gov.tn/sites/default/files/NC29.pdf', 'a_faire'),
  (4, 'NORME_COMPTABLE', 'NCT', null, 'NCT 30 - Charges techniques dans les entreprises d''assurance', 'fr', 'https://www.finances.gov.tn/sites/default/files/NC30.pdf', 'a_faire'),
  (4, 'NORME_COMPTABLE', 'NCT', null, 'NCT 31 - Placements dans les entreprises d''assurance', 'fr', 'https://www.finances.gov.tn/sites/default/files/NC31.pdf', 'a_faire'),
  (4, 'NORME_COMPTABLE', 'NCT', null, 'NCT 32 - Presentation des etats financiers des associations de micro-credit', 'fr', 'https://www.finances.gov.tn/sites/default/files/NC32.pdf', 'a_faire'),
  (4, 'NORME_COMPTABLE', 'NCT', null, 'NCT 33 - Controle interne et organisation comptable dans les associations de micro-credit', 'fr', 'https://www.finances.gov.tn/sites/default/files/NC33.pdf', 'a_faire'),
  (4, 'NORME_COMPTABLE', 'NCT', null, 'NCT 34 - Micro-credits et revenus y afferents', 'fr', 'https://www.finances.gov.tn/sites/default/files/NC34.pdf', 'a_faire'),
  (4, 'NORME_COMPTABLE', 'NCT', null, 'NCT 35 - Etats financiers consolides', 'fr', 'https://www.finances.gov.tn/sites/default/files/NC35.pdf', 'a_faire'),
  (4, 'NORME_COMPTABLE', 'NCT', null, 'NCT 36 - Participations dans les entreprises liees', 'fr', 'https://www.finances.gov.tn/sites/default/files/NC36.pdf', 'a_faire'),
  (4, 'NORME_COMPTABLE', 'NCT', null, 'NCT 37 - Participations dans les co-entreprises', 'fr', 'https://www.finances.gov.tn/sites/default/files/NC37.pdf', 'a_faire'),
  (4, 'NORME_COMPTABLE', 'NCT', null, 'NCT 38 - Regroupements d''entreprises', 'fr', 'https://www.finances.gov.tn/sites/default/files/NC38.pdf', 'a_faire'),
  (4, 'NORME_COMPTABLE', 'NCT', null, 'NCT 39 - Informations sur les parties liees', 'fr', 'https://www.finances.gov.tn/sites/default/files/NC39.pdf', 'a_faire'),
  (4, 'NORME_COMPTABLE', 'NCT', null, 'NCT 40 - Structures sportives privees', 'fr', 'https://www.finances.gov.tn/sites/default/files/NC40.pdf', 'a_faire'),
  (4, 'NORME_COMPTABLE', 'NCT', null, 'NCT 41 - Contrats de location', 'fr', 'https://www.finances.gov.tn/sites/default/files/nc41.pdf', 'a_faire'),
  (4, 'NORME_COMPTABLE', 'NCT', null, 'NCT 42 - Comptabilite simplifiee', 'fr', 'https://www.finances.gov.tn/sites/default/files/nc42.pdf', 'a_faire')
on conflict do nothing;

commit;
