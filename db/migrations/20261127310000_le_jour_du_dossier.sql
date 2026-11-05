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
-- `public.jour_du_dossier(dossier)` rend le jour courant dans le fuseau de l'organisation,
-- sinon celui de sa juridiction (la règle de `pieces_v.recue_le` et de
-- `app.fuseau_du_cabinet`) ; sans l'un ni l'autre, il refuse (`refus.fuseau.non_defini`).
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
  select (now() at time zone app.fuseau_du_cabinet(p_dossier))::date
$$;

comment on function public.jour_du_dossier(uuid) is
  'Le jour courant dans le fuseau du dossier (organisation, sinon juridiction). Les réglages '
  'd''un dossier se lisent à ce jour, jamais au jour UTC du serveur (5 novembre 2026).';

revoke all on function public.jour_du_dossier(uuid) from public;
grant execute on function public.jour_du_dossier(uuid) to authenticated;
