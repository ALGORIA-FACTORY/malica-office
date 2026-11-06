-- Le taux nul de la part exonérée suit la mention IMPRIMÉE : EXO ou EXPORT.
--
-- ================================================================== POURQUOI
--
-- `20261201090700` et `20261201090900` nommaient EXO toute part exonérée, sous la seule
-- mention `mention_suspension_exoneration` — INCERTAIN fiscalement, noté alors : une vente à
-- l'export ou en suspension serait nommée EXO. Or le barème distingue EXO (« Exonéré de
-- TVA », Code TVA, tableau A : pas de droit à déduction) et EXPORT (« Export - taux zéro »,
-- Code TVA, art. 11 : droit à déduction conservé) ; la déclaration de TVA les traite
-- autrement. Banc sans IA du 5 novembre 2026 : algoria-111, une vente à l'export (« Vente à
-- l'exportation, hors TVA », champ `mention_export`), restait muette — sa mention n'autorisait
-- pas le taux nul.
--
-- DÉCISION du dirigeant (5 novembre 2026, « ok » à la proposition) : le code suit la mention
-- imprimée — « exonéré » → EXO ; « export », « exportation », « en suspension » → EXPORT ;
-- sans mention, rien n'est affirmé et le comptable choisit.
--
-- ================================================================== CE QUI CHANGE
--
-- 1. La preuve `groupe_taux` qui nomme sa part exonérée gagne `autres_exonerations` :
--    `{"mention_export": "EXPORT"}`. Le moteur (`packages/sudoku/src/lib.rs`) prend le taux
--    de la mention imprimée ; deux mentions de taux différents imprimées : la part n'est pas
--    nommée (la ventilation partielle n'est alors pas affirmée).
-- 2. Les repères de SUSPENSION (« Vente en suspension de TVA », « Suspension », « En
--    suspension ») et « Article 11 » (l'article du taux EXPORT au barème) passent du champ
--    `mention_suspension_exoneration` au champ `mention_export`.
--
-- INCERTAIN fiscalement (R10) : la suspension de TVA (achats en suspension des entreprises
-- totalement exportatrices) rangée sous EXPORT est la proposition acceptée, pas un texte ;
-- défaut livré, `defaut_a_valider`, à valider par l'expert. REJEU (R11) : aucune horloge
-- n'écrit dans `ref`.

begin;

update ref.grille_preuves p
   set expression = p.expression || '{"autres_exonerations": {"mention_export": "EXPORT"}}'::jsonb
 where p.expression ? 'taux_exonere'
   and not p.expression ? 'autres_exonerations'
   and exists (select 1 from ref.grille_champs c
                where c.grille_id = p.grille_id and c.code = 'mention_export');

update ref.grille_champs e
   set reperes_fr = e.reperes_fr
                    || array(select r from unnest(array['Vente en suspension de TVA', 'Suspension',
                                                        'En suspension', 'Article 11']) r
                              where not (r = any (e.reperes_fr)))
 where e.code = 'mention_export'
   and exists (select 1 from ref.grille_champs m
                where m.grille_id = e.grille_id and m.code = 'mention_suspension_exoneration');

update ref.grille_champs m
   set reperes_fr = array(select r from unnest(m.reperes_fr) r
                           where r not in ('Vente en suspension de TVA', 'Suspension',
                                           'En suspension', 'Article 11'))
 where m.code = 'mention_suspension_exoneration'
   and exists (select 1 from ref.grille_champs e
                where e.grille_id = m.grille_id and e.code = 'mention_export');

do $$
begin
  if exists (select 1 from ref.grille_preuves p
              where p.expression ? 'taux_exonere'
                and exists (select 1 from ref.grille_champs c
                             where c.grille_id = p.grille_id and c.code = 'mention_export')
                and not p.expression -> 'autres_exonerations' ? 'mention_export') then
    raise exception 'une preuve qui nomme sa part exonérée ignore la mention d''export';
  end if;
end $$;

commit;
