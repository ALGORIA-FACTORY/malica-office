-- Le total HT a ses autres libellés arabes.
--
-- Banc sans IA du 4 novembre 2026 : sur les factures arabes du jeu d'ALGORIA et du jeu
-- synthétique, le HT s'imprime « المبلغ الصافي دون اعتبار الأداءات » (le montant NET hors
-- taxes : a053, a063, s041, s053, s065, s080) ou « المجموع دون اعتبار الأداءات » (le
-- total hors taxes : a090, a091, a096, a099). Le seul repère arabe du concept était
-- « المبلغ دون اعتبار الأداءات » : la preuve arithmétique tenait, mais le HT « ne portait
-- pas son libellé » et la pièce restait muette. Les deux libellés sont ajoutés à tous les
-- champs du concept `total_ht`, dans toutes les grilles (le dictionnaire des concepts est
-- la seule source des repères ; rien n'est écrit dans le moteur).
--
-- REJEU (R11) : aucune horloge n'écrit dans `ref`.

begin;

update ref.grille_champs gc
   set reperes_ar = gc.reperes_ar || array['المبلغ الصافي دون اعتبار الأداءات']
  from ref.concepts k
 where k.id = gc.concept_id and k.code = 'total_ht'
   and not ('المبلغ الصافي دون اعتبار الأداءات' = any (gc.reperes_ar));

update ref.grille_champs gc
   set reperes_ar = gc.reperes_ar || array['المجموع دون اعتبار الأداءات']
  from ref.concepts k
 where k.id = gc.concept_id and k.code = 'total_ht'
   and not ('المجموع دون اعتبار الأداءات' = any (gc.reperes_ar));

commit;
