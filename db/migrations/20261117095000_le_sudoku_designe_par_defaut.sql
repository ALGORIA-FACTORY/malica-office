-- Le sudoku DÉSIGNE par défaut (décision du dirigeant, 1er novembre 2026).
--
-- ================================================================== POURQUOI
--
-- Mesuré le 1er novembre 2026 sur le staging, 18 factures fictives d'une page
-- tirées au hasard, chacune lue dans un dossier en observation et dans un
-- dossier branché : une pièce prouvée se lit en 5,8 s (médiane) au lieu de
-- 19,5 s, sans aucun montant faux. Le dirigeant a décidé de brancher tous les
-- cabinets.
--
-- ================================================================== CE QUI CHANGE
--
-- Seul le DÉFAUT du pack (`ref.socle_params`, `lecture.sudoku`) passe de
-- `observe` à `designe`. R10 : c'est un défaut livré, pas une règle fiscale ;
-- chaque cabinet, ou chaque dossier, peut revenir à l'observation dans ses
-- réglages comptables, et une décision déjà arrêtée par un cabinet l'emporte.
-- La même forme que `20261108100000` (mise à jour d'un défaut existant).
--
-- REJEU (R11) : aucune horloge n'écrit dans `ref`.

begin;

update ref.socle_params
   set value_text = 'designe',
       legal_reference = 'Défaut livré par Malica (pas une règle fiscale). Décidé par le dirigeant '
         || 'le 1er novembre 2026 sur la mesure du staging (18 factures fictives : pièce prouvée '
         || 'lue en 5,8 s au lieu de 19,5 s, aucun montant faux). Un cabinet peut revenir à '
         || 'l''observation dans ses réglages comptables.'
 where code = 'lecture.sudoku'
   and value_text = 'observe';

do $$
begin
  if exists (select 1 from ref.socle_params where code = 'lecture.sudoku' and value_text <> 'designe') then
    raise exception 'lecture.sudoku : un défaut du pack reste en observation';
  end if;
end $$;

commit;
