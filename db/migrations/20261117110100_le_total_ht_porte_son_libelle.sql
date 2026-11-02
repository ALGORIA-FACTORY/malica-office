-- Le total HT porte son libellé : « Total H.T » en est un.
--
-- ================================================================== POURQUOI
--
-- Décision du dirigeant (2 novembre 2026) : zéro fausse preuve l'emporte sur les
-- pièces gagnées. Le moteur ne retient plus une preuve dont le total HT ne porte
-- pas son libellé (repères du champ `total_ht`, sur le jeton ou dans la suite de
-- mots juste avant lui sur sa rangée), sauf si les lignes le ferment exactement.
-- Sans cette règle, 100/B-15 (tranches 0 % et 19 %) et 50/05 (ticket, un chiffre
-- du TTC mal lu) sortaient prouvées FAUSSES.
--
-- Les repères du total HT deviennent donc décisifs. Au banc des 150 factures
-- fictives, 50/12 (OCR) imprime « Total H.T » : les points ne sont pas retirés
-- par la comparaison des repères (sans accents, sans casse, sans espaces), et
-- « Total HT » ne le reconnaît pas. Même forme sur le staging (50/35).
--
-- ================================================================== CE QUI CHANGE
--
-- Le repère « Total H.T » s'ajoute à `total_ht` dans la grille facture
-- (« Total H.T. » le contient). R10 : un défaut livré (`defaut_a_valider`),
-- que l'expertise corrige comme les autres repères.
-- REJEU (R11) : aucune horloge n'écrit dans `ref`.

begin;

update ref.grille_champs c
   set reperes_fr = c.reperes_fr || array['Total H.T']::text[]
  from ref.grilles g
 where g.id = c.grille_id and g.code = 'facture' and c.code = 'total_ht'
   and not ('Total H.T' = any (c.reperes_fr));

do $$
declare n integer;
begin
  select count(*) into n from ref.grille_champs c join ref.grilles g on g.id = c.grille_id
   where g.code = 'facture' and c.code = 'total_ht' and 'Total H.T' = any (c.reperes_fr);
  if n <> (select count(*) from ref.grilles where code = 'facture') then
    raise exception 'grille facture : % champ(s) total_ht avec « Total H.T », 1 par grille attendu', n;
  end if;
end $$;

commit;
