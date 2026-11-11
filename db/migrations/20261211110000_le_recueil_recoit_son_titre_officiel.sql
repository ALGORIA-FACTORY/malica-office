-- Le recueil des textes non incorporés reçoit son nom français (défaut C10a).
--
-- La règle de 20260901180000 interdit un nom qui n'a pas été relu dans le texte
-- du corpus lui-même. Il l'a été le 11 novembre 2026 : la page de titre du PDF
-- officiel de la DGELF (`https://www.finances.gov.tn/sites/default/files/RECUEIL%20DES%20TEXTES%20RELATIFS%20AUX%20DROITS%20ET%20TAXES%20NON%20INCORPORES%20DANS%20LES%20CODES%20FISCAUX%202017.pdf`,
-- SHA-256 55cd9d13e970ccdd…, 468 pages, « Mis à jour au 1er avril 2017 ») porte « RECUEIL DES TEXTES RELATIFS AUX
-- DROITS ET TAXES NON INCORPORES DANS LES CODES FISCAUX ».
--
-- Le nom arabe reste nul : INCERTAIN, à relire dans une édition arabe officielle.
--
-- Retour arrière : update legal.corpus_noms set nom_fr = null where code = 'RECUEIL';

update legal.corpus_noms
   set nom_fr = 'recueil des textes relatifs aux droits et taxes non incorporés dans les codes fiscaux'
 where code = 'RECUEIL' and nom_fr is null;
