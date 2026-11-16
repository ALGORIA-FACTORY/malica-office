-- Flouci rejoint les prestataires de paiement en ligne (16 novembre 2026).
--
-- Une ligne, pas du code : l'adaptateur `flouci` de l'API (paiement/
-- prestataires.ts) parle à son API ; la tour le choisit comme les autres
-- (`plateforme.paiement_regler`) et y règle l'adresse de son API
-- (https://developers.flouci.com : la même pour le bac à sable et la
-- production, seules les clés changent). Ses deux clés restent dans
-- l'environnement du serveur (FLOUCI_CLE_PUBLIQUE, FLOUCI_CLE_PRIVEE).
--
-- Flouci accepte les cartes Visa et Mastercard ; sa page propose aussi le
-- portefeuille Flouci. Le portefeuille comme moyen distinct, avec son logo,
-- viendra avec son fichier (public/paiement/) : un moyen sans logo ne s'inscrit
-- pas (`moyens_paiement.logo not null`). Sa page n'a pas de langue réglable :
-- `langue` reste vide. Pas de logo de prestataire non plus, pour la même raison
-- que le moyen : la page dit « Paiement sécurisé par Flouci » en toutes lettres.

insert into facturation.prestataires_paiement
  (code, adaptateur, ouvre_le_paiement, fait_entrer_argent, exige_url_api, langue, logo,
   moyen_encaissement_defaut, rang)
values
  ('flouci', 'flouci', true, true, true, null, null, 'carte',
   (select max(rang) + 1 from facturation.prestataires_paiement));

insert into facturation.moyens_par_prestataire (prestataire, moyen) values
  ('flouci', 'visa'),
  ('flouci', 'mastercard');

insert into ref.labels (ns, key, locale, value) values
  ('prestataire_paiement', 'flouci', 'fr', 'Flouci'),
  ('prestataire_paiement', 'flouci', 'en', 'Flouci'),
  ('prestataire_paiement', 'flouci', 'ar', 'فلوسي');
