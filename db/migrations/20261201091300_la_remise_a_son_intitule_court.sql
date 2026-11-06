-- La remise de ligne a son intitulé court : « R. ».
--
-- Banc sans IA du 4 novembre 2026 : 46 factures du jeu d'ALGORIA (gabarit « PU TTC », un
-- logiciel de caisse tunisien courant) titrent la colonne de remise « R. » et y impriment
-- « 5,00 » sans « % ». La remise n'était pas lue, et les lignes ne fermaient pas. Le moteur
-- lit désormais une colonne de remise nommée par l'en-tête du tableau (`lignes`,
-- `colonnes_de_remise`) : l'intitulé n'y vaut que sur une rangée d'en-tête qui porte au
-- moins deux autres intitulés de lignes, en mot entier.
--
-- REJEU (R11) : aucune horloge n'écrit dans `ref`.

begin;

update ref.grille_champs gc
   set reperes_fr = gc.reperes_fr || array['R.']
  from ref.concepts k
 where k.id = gc.concept_id and gc.code = 'remise_ligne'
   and not ('R.' = any (gc.reperes_fr));

commit;
