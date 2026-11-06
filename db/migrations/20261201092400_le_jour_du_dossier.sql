-- Le jour DU DOSSIER, dans son fuseau, pour qui lit ses réglages.
--
-- ================================================================== POURQUOI
--
-- 5 novembre 2026, 23 h UTC (minuit passé à Tunis) : le mode du lecteur prouvé
-- (`lecture.sudoku`) d'un dossier, arrêté « depuis » le jour du cabinet (le 6 novembre à
-- Tunis), était lu par l'API au jour UTC du serveur (`aujourdhui()`, le 5 novembre) : pas
-- encore en vigueur. Pendant une heure chaque nuit (deux en été), un réglage arrêté le jour
-- même ne s'appliquait pas — le pack décidait à sa place. Les épreuves de la relecture de
-- nuit l'ont montré : elles échouaient toutes entre 23 h et minuit UTC.
--
-- ================================================================== CE QUI CHANGE
--
-- `public.jour_du_dossier(dossier)` rend le jour où se lisent les réglages du dossier : le
-- jour du cabinet qui le règle (`app.cabinet_du_parametrage`), dans son fuseau — le
-- calendrier où les réglages ont été datés —, et pour un dossier sans cabinet, son propre
-- fuseau. C'est la règle de `app.relecture_de_nuit` (`20261130230000`, « le jour du
-- cabinet ») : les deux réglages du lecteur, `lecture.sudoku` et `lecture.relecture_nuit`,
-- se lisent le même jour. Sans fuseau, il refuse (`refus.fuseau.non_defini`).
-- L'API lit les réglages du lecteur à ce jour (`contexteSudoku`).
--
-- REJEU (R11) : aucune horloge n'écrit dans `ref`.

create or replace function public.jour_du_dossier(p_dossier uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (now() at time zone app.fuseau_du_cabinet(
            coalesce(app.cabinet_du_parametrage(p_dossier), p_dossier)))::date
$$;

comment on function public.jour_du_dossier(uuid) is
  'Le jour où se lisent les réglages d''un dossier : celui du cabinet qui le règle, dans son '
  'fuseau (le dossier lui-même sans cabinet) ; jamais le jour UTC du serveur. Même règle que '
  'app.relecture_de_nuit (6 novembre 2026).';

revoke all on function public.jour_du_dossier(uuid) from public;
grant execute on function public.jour_du_dossier(uuid) to authenticated;
