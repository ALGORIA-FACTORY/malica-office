-- Le RIB a son libellé arabe.
--
-- Banc sans IA du 4 novembre 2026 : sur les pièces arabes et bilingues, le RIB s'imprime
-- « 99 250 7735580665993 59 : المعرّف البنكي ». Aucun champ du concept `rib` ne portait de
-- repère arabe : la valeur n'était prise que par le repli « seul RIB de la page », que le
-- moteur ne fait plus (une valeur sans libellé n'est à aucun champ). Le libellé est ajouté à
-- tous les champs du concept, dans toutes les grilles ; le moteur ignore les signes
-- diacritiques (« المعرّف » = « المعرف »).

update ref.grille_champs gc
   set reperes_ar = gc.reperes_ar || array['المعرف البنكي']
  from ref.concepts k
 where k.id = gc.concept_id and k.code = 'rib'
   and not ('المعرف البنكي' = any (gc.reperes_ar));
