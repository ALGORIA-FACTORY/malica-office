-- Elargir le corpus : conventions internationales, incitations, editions manquantes.
--
-- ================================================== LES CONVENTIONS
--
-- Une convention de non double imposition PRIME sur la loi interne : la
-- Constitution de 2022, article 74, lui donne une autorite superieure. C'est la
-- ligne la plus haute de legal.sources, et jusqu'ici aucune convention n'etait
-- dans le corpus. Concretement : une retenue a la source de 15 % prevue par le
-- code de l'IRPP tombe a 10 % ou a zero si la convention avec le pays du
-- beneficiaire le prevoit. Repondre sans les conventions, c'est repondre faux
-- des qu'un paiement franchit la frontiere — et c'est le quotidien d'un cabinet.
--
-- Quarante-huit conventions, telechargees depuis le portail de la Direction
-- generale des impots (jibaya.tn). Chacune est son propre corpus : l'article 12
-- de la convention avec la France n'a rien a voir avec l'article 12 de celle
-- avec le Qatar.
--
-- ================================================== LES PRIX DE TRANSFERT
--
-- La regle de fond est deja dans le corpus : article 48 septies du code de
-- l'IRPP et de l'IS pour le principe de pleine concurrence, articles 38 bis et
-- suivants du code des droits et procedures fiscaux pour la documentation, et
-- la note commune 13/2022 pour la doctrine. Ce qui manquait, c'est le reseau
-- conventionnel : sans lui, on ne sait pas quel Etat impose quoi.
--
-- ================================================== LES INCITATIONS
--
-- Le corpus ne portait que la refonte de 2017 (loi 2017-8). Or les avantages
-- acquis sous le code d'incitation aux investissements de 1993 courent encore,
-- et la loi de l'investissement de 2016 regit les autorisations. Les trois se
-- lisent ensemble.
--
-- ================================================== LES EDITIONS MANQUANTES
--
-- Le portail publie des editions que nous n'avions pas : TVA 2018, 2020 et
-- 2022, IRPP 2018, procedures fiscales 2020, recueil 2018 et 2020. Chaque
-- edition supplementaire est une borne de plus pour la recherche datee : sans
-- l'edition 2020, la base ne sait pas dire ce qui s'appliquait en 2020.
--
-- Et surtout : les lois de finances de 2000 a 2022 EN ARABE. Nous n'avions
-- l'arabe d'aucune loi de finances ; c'est pourtant la langue qui fait foi.

begin;

insert into legal.ingestion_queue (priorite, type_document, corpus, annee, titre, langue, url_fichier, statut)
values
  (4, 'CONVENTION', 'CONV-AFRIQUE-DU-SUD', null, 'Convention de non double imposition Tunisie - Afrique du Sud', 'fr', 'https://jibaya.tn/wp-content/uploads/2024/01/Afrique-du-sud.pdf', 'a_faire'),
  (4, 'CONVENTION', 'CONV-ALGERIE', null, 'Convention de non double imposition Tunisie - Algerie', 'fr', 'https://jibaya.tn/wp-content/uploads/2024/01/Algerie.pdf', 'a_faire'),
  (4, 'CONVENTION', 'CONV-ALLEMAGNE', null, 'Convention de non double imposition Tunisie - Allemagne', 'fr', 'https://jibaya.tn/wp-content/uploads/2024/01/DBA-TUN-franz.pdf', 'a_faire'),
  (4, 'CONVENTION', 'CONV-AUTRICHE', null, 'Convention de non double imposition Tunisie - Autriche', 'fr', 'https://jibaya.tn/wp-content/uploads/2024/01/Autriche.pdf', 'a_faire'),
  (4, 'CONVENTION', 'CONV-BELGIQUE', null, 'Convention de non double imposition Tunisie - Belgique', 'fr', 'https://jibaya.tn/wp-content/uploads/2024/01/belgique.pdf', 'a_faire'),
  (4, 'CONVENTION', 'CONV-BURKINA-FASO', null, 'Convention de non double imposition Tunisie - Burkina Faso', 'fr', 'https://jibaya.tn/wp-content/uploads/2024/01/BURKINA-FASO-1.pdf', 'a_faire'),
  (4, 'CONVENTION', 'CONV-CANADA', null, 'Convention de non double imposition Tunisie - Canada', 'fr', 'https://jibaya.tn/wp-content/uploads/2024/01/Canada.pdf', 'a_faire'),
  (4, 'CONVENTION', 'CONV-CHINE', null, 'Convention de non double imposition Tunisie - Chine', 'fr', 'https://jibaya.tn/wp-content/uploads/2024/01/Chine.pdf', 'a_faire'),
  (4, 'CONVENTION', 'CONV-COREE-DU-SUD', null, 'Convention de non double imposition Tunisie - Coree du Sud', 'fr', 'https://jibaya.tn/wp-content/uploads/2024/01/Coree_du_sud.pdf', 'a_faire'),
  (4, 'CONVENTION', 'CONV-DANEMARK', null, 'Convention de non double imposition Tunisie - Danemark', 'fr', 'https://jibaya.tn/wp-content/uploads/2024/01/Danemark.pdf', 'a_faire'),
  (4, 'CONVENTION', 'CONV-EGYPTE', null, 'Convention de non double imposition Tunisie - Egypte', 'fr', 'https://jibaya.tn/wp-content/uploads/2024/01/Egypte.pdf', 'a_faire'),
  (4, 'CONVENTION', 'CONV-EMIRATS', null, 'Convention de non double imposition Tunisie - Emirats arabes unis', 'fr', 'https://jibaya.tn/wp-content/uploads/2024/01/emirate-des-etats-unis.pdf', 'a_faire'),
  (4, 'CONVENTION', 'CONV-ESPAGNE', null, 'Convention de non double imposition Tunisie - Espagne', 'fr', 'https://jibaya.tn/wp-content/uploads/2024/01/Espagne.pdf', 'a_faire'),
  (4, 'CONVENTION', 'CONV-ETATS-UNIS', null, 'Convention de non double imposition Tunisie - Etats-Unis d''Amerique', 'fr', 'https://jibaya.tn/wp-content/uploads/2024/01/Etats-unis-Amerique.pdf', 'a_faire'),
  (4, 'CONVENTION', 'CONV-ETHIOPIE', null, 'Convention de non double imposition Tunisie - Ethiopie', 'fr', 'https://jibaya.tn/wp-content/uploads/2024/01/ETHIOUPIE.pdf', 'a_faire'),
  (4, 'CONVENTION', 'CONV-FRANCE', null, 'Convention de non double imposition Tunisie - France', 'fr', 'https://jibaya.tn/wp-content/uploads/2024/01/France.pdf', 'a_faire'),
  (4, 'CONVENTION', 'CONV-GRECE', null, 'Convention de non double imposition Tunisie - Grece', 'fr', 'https://jibaya.tn/wp-content/uploads/2024/01/Grece.pdf', 'a_faire'),
  (4, 'CONVENTION', 'CONV-HONGRIE', null, 'Convention de non double imposition Tunisie - Hongrie', 'fr', 'https://jibaya.tn/wp-content/uploads/2024/01/hongrie.pdf', 'a_faire'),
  (4, 'CONVENTION', 'CONV-ITALIE', null, 'Convention de non double imposition Tunisie - Italie', 'fr', 'https://jibaya.tn/wp-content/uploads/2024/01/Italie.pdf', 'a_faire'),
  (4, 'CONVENTION', 'CONV-JORDANIE', null, 'Convention de non double imposition Tunisie - Jordanie', 'fr', 'https://jibaya.tn/wp-content/uploads/2024/01/Jordanie.pdf', 'a_faire'),
  (4, 'CONVENTION', 'CONV-LIBAN', null, 'Convention de non double imposition Tunisie - Liban', 'fr', 'https://jibaya.tn/wp-content/uploads/2024/01/Liban.pdf', 'a_faire'),
  (4, 'CONVENTION', 'CONV-LIBYE', null, 'Convention de non double imposition Tunisie - Libye', 'fr', 'https://jibaya.tn/wp-content/uploads/2024/01/Lybie.pdf', 'a_faire'),
  (4, 'CONVENTION', 'CONV-LUXEMBOURG', null, 'Convention de non double imposition Tunisie - Luxembourg', 'fr', 'https://jibaya.tn/wp-content/uploads/2024/01/Luxembourg.pdf', 'a_faire'),
  (4, 'CONVENTION', 'CONV-MALI', null, 'Convention de non double imposition Tunisie - Mali', 'fr', 'https://jibaya.tn/wp-content/uploads/2024/01/MALI.pdf', 'a_faire'),
  (4, 'CONVENTION', 'CONV-MALTE', null, 'Convention de non double imposition Tunisie - Malte', 'fr', 'https://jibaya.tn/wp-content/uploads/2024/01/malte.pdf', 'a_faire'),
  (4, 'CONVENTION', 'CONV-MAROC', null, 'Convention de non double imposition Tunisie - Maroc', 'fr', 'https://jibaya.tn/wp-content/uploads/2024/01/Maroc.pdf', 'a_faire'),
  (4, 'CONVENTION', 'CONV-MAURITANIE', null, 'Convention de non double imposition Tunisie - Mauritanie', 'fr', 'https://jibaya.tn/wp-content/uploads/2024/01/Mauritanie.pdf', 'a_faire'),
  (4, 'CONVENTION', 'CONV-NORVEGE', null, 'Convention de non double imposition Tunisie - Norvege', 'fr', 'https://jibaya.tn/wp-content/uploads/2024/01/Norvege.pdf', 'a_faire'),
  (4, 'CONVENTION', 'CONV-OMAN', null, 'Convention de non double imposition Tunisie - Sultanat d''Oman', 'fr', 'https://jibaya.tn/wp-content/uploads/2024/01/Oman.pdf', 'a_faire'),
  (4, 'CONVENTION', 'CONV-PAKISTAN', null, 'Convention de non double imposition Tunisie - Pakistan', 'fr', 'https://jibaya.tn/wp-content/uploads/2024/01/Pakistan.pdf', 'a_faire'),
  (4, 'CONVENTION', 'CONV-PAYS-BAS', null, 'Convention de non double imposition Tunisie - Pays-Bas', 'fr', 'https://jibaya.tn/wp-content/uploads/2024/01/Pays-Bas.pdf', 'a_faire'),
  (4, 'CONVENTION', 'CONV-POLOGNE', null, 'Convention de non double imposition Tunisie - Pologne', 'fr', 'https://jibaya.tn/wp-content/uploads/2024/01/Pologne.pdf', 'a_faire'),
  (4, 'CONVENTION', 'CONV-QATAR', null, 'Convention de non double imposition Tunisie - Qatar', 'fr', 'https://jibaya.tn/wp-content/uploads/2024/01/Qatar.pdf', 'a_faire'),
  (4, 'CONVENTION', 'CONV-ROUMANIE', null, 'Convention de non double imposition Tunisie - Roumanie', 'fr', 'https://jibaya.tn/wp-content/uploads/2024/01/Roumanie.pdf', 'a_faire'),
  (4, 'CONVENTION', 'CONV-SENEGAL', null, 'Convention de non double imposition Tunisie - Senegal', 'fr', 'https://jibaya.tn/wp-content/uploads/2024/01/Senegal.pdf', 'a_faire'),
  (4, 'CONVENTION', 'CONV-SERBIE', null, 'Convention de non double imposition Tunisie - Serbie', 'fr', 'https://jibaya.tn/wp-content/uploads/2024/01/Serbie.pdf', 'a_faire'),
  (4, 'CONVENTION', 'CONV-SLOVAQUIE', null, 'Convention de non double imposition Tunisie - Slovaquie', 'fr', 'https://jibaya.tn/wp-content/uploads/2024/01/Slovaquie.pdf', 'a_faire'),
  (4, 'CONVENTION', 'CONV-SUEDE', null, 'Convention de non double imposition Tunisie - Suede', 'fr', 'https://jibaya.tn/wp-content/uploads/2024/01/Suede.pdf', 'a_faire'),
  (4, 'CONVENTION', 'CONV-SUISSE', null, 'Convention de non double imposition Tunisie - Suisse', 'fr', 'https://jibaya.tn/wp-content/uploads/2024/01/Suisse.pdf', 'a_faire'),
  (4, 'CONVENTION', 'CONV-SYRIE', null, 'Convention de non double imposition Tunisie - Syrie', 'fr', 'https://jibaya.tn/wp-content/uploads/2024/01/SYRIE.pdf', 'a_faire'),
  (4, 'CONVENTION', 'CONV-TCHEQUIE', null, 'Convention de non double imposition Tunisie - Republique tcheque', 'fr', 'https://jibaya.tn/wp-content/uploads/2024/01/Republique-Tcheque.pdf', 'a_faire'),
  (4, 'CONVENTION', 'CONV-TURQUIE', null, 'Convention de non double imposition Tunisie - Turquie', 'fr', 'https://jibaya.tn/wp-content/uploads/2024/01/Turquie.pdf', 'a_faire'),
  (4, 'CONVENTION', 'CONV-UMA', null, 'Convention de non double imposition Tunisie - Union du Maghreb arabe', 'fr', 'https://jibaya.tn/wp-content/uploads/2024/01/U.M.A.pdf', 'a_faire'),
  (4, 'CONVENTION', 'CONV-VIETNAM', null, 'Convention de non double imposition Tunisie - Vietnam', 'fr', 'https://jibaya.tn/wp-content/uploads/2024/01/VIETNAM-FR.pdf', 'a_faire'),
  (4, 'CONVENTION', 'CONV-YEMEN', null, 'Convention de non double imposition Tunisie - Yemen', 'fr', 'https://jibaya.tn/wp-content/uploads/2024/01/Yemen.pdf', 'a_faire'),
  (4, 'CONVENTION', 'CONV-ARABIE-SAOUDITE', null, 'Convention de non double imposition Tunisie - Arabie saoudite (edition arabe)', 'ar', 'https://jibaya.tn/wp-content/uploads/2024/01/Arabie-saoudite-langue-arabe.pdf', 'a_faire'),
  (4, 'CONVENTION', 'CONV-COTE-IVOIRE', null, 'Convention de non double imposition Tunisie - Cote d''Ivoire (edition arabe)', 'ar', 'https://jibaya.tn/wp-content/uploads/2024/01/Cote-dIvoire_c.pdf', 'a_faire'),
  (4, 'CONVENTION', 'CONV-SINGAPOUR', null, 'Convention de non double imposition Tunisie - Singapour (edition arabe)', 'ar', 'https://jibaya.tn/wp-content/uploads/2026/07/Singapore-Tunisia-Ar-signee-1.pdf', 'a_faire'),
  (4, 'CODE_CONSOLIDE', 'CII', 1993, 'Code d''incitation aux investissements (loi 93-120)', 'fr', 'https://cmf.tn/sites/default/files/pdfs/reglementation/textes-reference/code_incitation_invest_fr.pdf', 'a_faire'),
  (4, 'CODE_CONSOLIDE', 'INVEST', 2016, 'Loi 2016-71 portant loi de l''investissement', 'fr', 'https://jibaya.tn/wp-content/uploads/2024/01/Loi-n°-2016-71-portant-loi-de-linvestissement.pdf', 'a_faire'),
  (5, 'CODE_CONSOLIDE', 'CTVA', 2018, 'Code de la TVA, edition 2018', 'fr', 'https://jibaya.tn/wp-content/uploads/2024/01/Code-TVA-2018-FR.pdf', 'a_faire'),
  (5, 'CODE_CONSOLIDE', 'CTVA', 2020, 'Code de la TVA, edition 2020', 'fr', 'https://jibaya.tn/wp-content/uploads/2024/01/Code-de-la-Taxe-sur-la-Valeur-Ajoutee-2020.pdf', 'a_faire'),
  (5, 'CODE_CONSOLIDE', 'CTVA', 2022, 'Code de la TVA, edition 2022', 'fr', 'https://jibaya.tn/wp-content/uploads/2024/01/Code-de-la-taxe-sur-la-valeur-ajoutee-2022.pdf', 'a_faire'),
  (5, 'CODE_CONSOLIDE', 'CIRPPIS', 2018, 'Code de l''IRPP et de l''IS, edition 2018', 'fr', 'https://jibaya.tn/wp-content/uploads/2024/01/code-IRPP-IS-2018.pdf', 'a_faire'),
  (5, 'CODE_CONSOLIDE', 'CDPF', 2020, 'Code des droits et procedures fiscaux, edition 2020', 'fr', 'https://jibaya.tn/wp-content/uploads/2024/01/Code-des-droits-et-procedures-fiscaux-2020.pdf', 'a_faire'),
  (5, 'CODE_CONSOLIDE', 'RECUEIL', 2018, 'Recueil des textes relatifs aux droits et taxes non incorpores, edition 2018', 'fr', 'https://jibaya.tn/wp-content/uploads/2024/01/RECUEIL-DES-TEXTES-RELATIFS-AUX-DROITS-ET-TAXES-NON-INCORPORES-DANS-LES-CODES-FISCAUX-2018.pdf', 'a_faire'),
  (5, 'CODE_CONSOLIDE', 'RECUEIL', 2020, 'Recueil des textes relatifs aux droits et taxes non incorpores, edition 2020', 'fr', 'https://jibaya.tn/wp-content/uploads/2024/01/RECUEIL-DES-TEXTES-RELATIFS-AUX-DROITS-ET-TAXES-NON-INCORPORES-DANS-LES-CODES-FISCAUX-2020.pdf', 'a_faire'),
  (5, 'LOI_FINANCES', 'LF', 2000, 'Loi de finances 2000, edition arabe', 'ar', 'https://jibaya.tn/wp-content/uploads/2024/01/قانون-المالية-لسنة-2000_compressed.pdf', 'a_faire'),
  (5, 'LOI_FINANCES', 'LF', 2001, 'Loi de finances 2001, edition arabe', 'ar', 'https://jibaya.tn/wp-content/uploads/2024/01/قانون-المالية-لسنة-2001_compressed.pdf', 'a_faire'),
  (5, 'LOI_FINANCES', 'LF', 2002, 'Loi de finances 2002, edition arabe', 'ar', 'https://jibaya.tn/wp-content/uploads/2024/01/قانون-المالية-لسنة-2002_compressed.pdf', 'a_faire'),
  (5, 'LOI_FINANCES', 'LFC', 2002, 'Loi de finances 2002, edition arabe', 'ar', 'https://jibaya.tn/wp-content/uploads/2024/01/قانون-المالية-التكميلي-لسنة-2002.pdf', 'a_faire'),
  (5, 'LOI_FINANCES', 'LF', 2003, 'Loi de finances 2003, edition arabe', 'ar', 'https://jibaya.tn/wp-content/uploads/2024/01/قانون-المالية-لسنة-2003_compressed.pdf', 'a_faire'),
  (5, 'LOI_FINANCES', 'LF', 2004, 'Loi de finances 2004, edition arabe', 'ar', 'https://jibaya.tn/wp-content/uploads/2024/01/قانون-المالية-لسنة-2004-1_compressed.pdf', 'a_faire'),
  (5, 'LOI_FINANCES', 'LFC', 2004, 'Loi de finances 2004, edition arabe', 'ar', 'https://jibaya.tn/wp-content/uploads/2024/01/قانون-المالية-التكميلي-لسنة-2004.pdf', 'a_faire'),
  (5, 'LOI_FINANCES', 'LF', 2005, 'Loi de finances 2005, edition arabe', 'ar', 'https://jibaya.tn/wp-content/uploads/2024/01/قانون-المالية-لسنة-2005_compressed.pdf', 'a_faire'),
  (5, 'LOI_FINANCES', 'LF', 2006, 'Loi de finances 2006, edition arabe', 'ar', 'https://jibaya.tn/wp-content/uploads/2024/01/قانون-المالية-لسنة-2006_compressed.pdf', 'a_faire'),
  (5, 'LOI_FINANCES', 'LF', 2007, 'Loi de finances 2007, edition arabe', 'ar', 'https://jibaya.tn/wp-content/uploads/2024/01/قانون-المالية-لسنة-2007_compressed.pdf', 'a_faire'),
  (5, 'LOI_FINANCES', 'LF', 2008, 'Loi de finances 2008, edition arabe', 'ar', 'https://jibaya.tn/wp-content/uploads/2024/01/قانون-المالية-لسنة-2008_compressed.pdf', 'a_faire'),
  (5, 'LOI_FINANCES', 'LF', 2009, 'Loi de finances 2009, edition arabe', 'ar', 'https://jibaya.tn/wp-content/uploads/2024/01/قانون-المالية-لسنة-2009_compressed.pdf', 'a_faire'),
  (5, 'LOI_FINANCES', 'LF', 2010, 'Loi de finances 2010, edition arabe', 'ar', 'https://jibaya.tn/wp-content/uploads/2024/01/قانون-المالية-لسنة-2010_compressed.pdf', 'a_faire'),
  (5, 'LOI_FINANCES', 'LF', 2011, 'Loi de finances 2011, edition arabe', 'ar', 'https://jibaya.tn/wp-content/uploads/2024/01/قانون-المالية-لسنة-2011_compressed.pdf', 'a_faire'),
  (5, 'LOI_FINANCES', 'LF', 2012, 'Loi de finances 2012, edition arabe', 'ar', 'https://jibaya.tn/wp-content/uploads/2024/01/قانون-المالية-لسنة-2012_compressed.pdf', 'a_faire'),
  (5, 'LOI_FINANCES', 'LFC', 2012, 'Loi de finances 2012, edition arabe', 'ar', 'https://jibaya.tn/wp-content/uploads/2024/01/قانون-المالية-التكميلي-لسنة-2012.pdf', 'a_faire'),
  (5, 'LOI_FINANCES', 'LF', 2013, 'Loi de finances 2013, edition arabe', 'ar', 'https://jibaya.tn/wp-content/uploads/2024/01/قانون-المالية-لسنة-2013_compressed.pdf', 'a_faire'),
  (5, 'LOI_FINANCES', 'LFC', 2013, 'Loi de finances 2013, edition arabe', 'ar', 'https://jibaya.tn/wp-content/uploads/2024/01/قانون-المالية-التكميلي-لسنة-2013.pdf', 'a_faire'),
  (5, 'LOI_FINANCES', 'LF', 2014, 'Loi de finances 2014, edition arabe', 'ar', 'https://jibaya.tn/wp-content/uploads/2024/01/قانون-المالية-لسنة-2014_compressed.pdf', 'a_faire'),
  (5, 'LOI_FINANCES', 'LFC', 2014, 'Loi de finances 2014, edition arabe', 'ar', 'https://jibaya.tn/wp-content/uploads/2024/01/قانون-المالية-التكميلي-لسنة-2014.pdf', 'a_faire'),
  (5, 'LOI_FINANCES', 'LF', 2015, 'Loi de finances 2015, edition arabe', 'ar', 'https://jibaya.tn/wp-content/uploads/2024/01/قانون-المالية-لسنة-2015_compressed.pdf', 'a_faire'),
  (5, 'LOI_FINANCES', 'LFC', 2015, 'Loi de finances 2015, edition arabe', 'ar', 'https://jibaya.tn/wp-content/uploads/2024/01/قانون-المالية-التكميلي-لسنة-2015.pdf', 'a_faire'),
  (5, 'LOI_FINANCES', 'LF', 2016, 'Loi de finances 2016, edition arabe', 'ar', 'https://jibaya.tn/wp-content/uploads/2024/01/قانون-المالية-لسنة-2016_compressed.pdf', 'a_faire'),
  (5, 'LOI_FINANCES', 'LFC', 2016, 'Loi de finances 2016, edition arabe', 'ar', 'https://jibaya.tn/wp-content/uploads/2024/01/قانون-المالية-التكميلي-لسنة-2016.pdf', 'a_faire'),
  (5, 'LOI_FINANCES', 'LF', 2017, 'Loi de finances 2017, edition arabe', 'ar', 'https://jibaya.tn/wp-content/uploads/2024/01/قانون-المالية-لسنة-2017_compressed.pdf', 'a_faire'),
  (5, 'LOI_FINANCES', 'LF', 2018, 'Loi de finances 2018, edition arabe', 'ar', 'https://jibaya.tn/wp-content/uploads/2024/01/قانون-المالية-لسنة-2018_compressed.pdf', 'a_faire'),
  (5, 'LOI_FINANCES', 'LF', 2019, 'Loi de finances 2019, edition arabe', 'ar', 'https://jibaya.tn/wp-content/uploads/2024/01/قانون-المالية-لسنة-2019_compressed.pdf', 'a_faire'),
  (5, 'LOI_FINANCES', 'LF', 2020, 'Loi de finances 2020, edition arabe', 'ar', 'https://jibaya.tn/wp-content/uploads/2024/01/قانون-المالية-لسنة-2020_compressed-1.pdf', 'a_faire'),
  (5, 'LOI_FINANCES', 'LF', 2021, 'Loi de finances 2021, edition arabe', 'ar', 'https://jibaya.tn/wp-content/uploads/2024/01/قانون-المالية-لسنة-2021_compressed.pdf', 'a_faire'),
  (5, 'LOI_FINANCES', 'LF', 2022, 'Loi de finances 2022, edition arabe', 'ar', 'https://jibaya.tn/wp-content/uploads/2024/01/قانون-المالية-لسنة-2022_compressed.pdf', 'a_faire')
on conflict do nothing;

commit;
