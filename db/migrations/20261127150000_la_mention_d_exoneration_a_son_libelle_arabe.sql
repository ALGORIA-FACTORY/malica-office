-- La mention d'exonération a son libellé arabe, et elle nomme sa part exonérée.
--
-- ================================================================== POURQUOI
--
-- Banc sans IA du 4 novembre 2026 : les factures arabes exonérées du jeu d'ALGORIA (a055,
-- a065, a098…) impriment « عملية معفاة من الأداء على القيمة المضافة ». Le champ de la mention
-- (`mention_suspension_exoneration`) n'avait aucun repère arabe : la mention n'était pas lue,
-- l'exonération n'était pas permise, et la pièce, dont tous les totaux étaient lus, restait
-- muette.
--
-- ================================================================== CE QUI CHANGE
--
-- 1. Deux repères arabes pour tous les champs du concept de la mention : « معفاة من الأداء »
--    et « معفى من الأداء » (exonérée, exonéré de la taxe). Le moteur les compare sans
--    signes diacritiques ni espaces.
-- 2. `taux_exonere` (`20261127130000`) vaut aussi pour l'exonération TOTALE : la part
--    exonérée, alors tout le total HT, est l'instance de la ventilation sous le taux nul
--    EXO. INCERTAIN fiscalement, comme pour l'exonération partielle : une vente en
--    suspension ou à l'export sous la même mention serait nommée EXO, et non EXPORT. Défaut
--    livré (R10, `defaut_a_valider`), à valider par l'expert.
--
-- REJEU (R11) : aucune horloge n'écrit dans `ref`.

begin;

update ref.grille_champs gc
   set reperes_ar = gc.reperes_ar || array['معفاة من الأداء']
  from ref.concepts k
 where k.id = gc.concept_id and k.id in (select concept_id from ref.grille_champs where code = 'mention_suspension_exoneration')
   and not ('معفاة من الأداء' = any (gc.reperes_ar));

update ref.grille_champs gc
   set reperes_ar = gc.reperes_ar || array['معفى من الأداء']
  from ref.concepts k
 where k.id = gc.concept_id and k.id in (select concept_id from ref.grille_champs where code = 'mention_suspension_exoneration')
   and not ('معفى من الأداء' = any (gc.reperes_ar));

commit;
