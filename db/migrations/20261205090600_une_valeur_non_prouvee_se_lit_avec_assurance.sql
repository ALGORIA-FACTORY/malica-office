-- Une valeur qu'aucun calcul ne prouve se lit avec assurance : le seuil passe de 0,9 à 0,96,
-- et vaut désormais pour toute valeur non prouvée — date, identifiant, nom, texte — et non
-- plus pour les seules désignations.
--
-- Banc sans IA du 4 novembre 2026 (412 pièces), valeurs non numériques, confiance OCR du
-- moins sûr de leurs jetons :
--
--     confiance      justes   fausses
--     < 0,90            12        0
--     0,90 – 0,93       18        3     registre (B lu 8), durée « 4 » pour « 99 »
--     0,93 – 0,95       37        2     matricule « 4084013Z » pour « 4064013Z », nom
--     0,95 – 0,97      117        2     date « 2028 » pour « 2026 », registre
--     ≥ 0,97         1 108        1     (un registre du dossier pris du mauvais côté)
--
-- Toutes les fausses dues à l'OCR sont sous 0,96. Sous le seuil, la valeur n'est pas perdue :
-- elle reste, SIGNALÉE, une piste à vérifier. La valeur qui égale l'identité du dossier
-- (confirmée par la base) et les montants prouvés par l'arithmétique n'y sont pas soumis.

update ref.socle_params
   set value_num = 0.96,
       legal_reference = 'Convention de lecture — sous ce seuil, une valeur qu''aucun calcul ne prouve n''est pas affirmée'
 where code = 'lecture.confiance_du_texte' and value_num = 0.9;
