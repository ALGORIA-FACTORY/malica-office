-- ======================================================================
--  Le PV garde le jour de son cumul (5 novembre 2026).
--
--  Le cumul d'un PV s'arrête désormais au jour de la réunion
--  (`arreteDuCumul`, Socle), et non plus à la fin de son mois. Un PV rédigé
--  avant porte des chiffres arrêtés à la fin du mois : relu, il ne doit pas
--  prendre la date du jour de réunion pour des montants qui la dépassent
--  (revue de #250). La date d'arrêt se garde donc avec les chiffres.
--
--  `arrete` est posée par la base quand les chiffres changent : le jour de
--  la réunion — qui est toujours dans son propre mois, donc le même jour que
--  `arreteDuCumul(mois de at, at)`. Un PV rédigé avant garde `arrete` nul :
--  l'écran lit alors la fin du mois, comme quand il a été rédigé.
-- ======================================================================

begin;

alter table collab.pv_reunions add column arrete date;

comment on column collab.pv_reunions.arrete is
  'Le jour où s''arrête le cumul des chiffres du PV ; nul pour un PV rédigé avant le 5 novembre '
  '2026, dont le cumul s''arrête à la fin du mois de la réunion.';

create function collab.pv_dater_le_cumul() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.chiffres is distinct from old.chiffres then
    new.arrete := new.at;
  end if;
  return new;
end
$$;

create trigger pv_reunions_date_du_cumul
  before update on collab.pv_reunions
  for each row execute function collab.pv_dater_le_cumul();

create or replace view public.collab_pv_v with (security_invoker = true) as
  select id, cabinet_tenant_id, client_tenant_id, at, titre, participants, ordre_du_jour,
         decisions, created_by, created_at, sections, chiffres, ton, statut, envoye_le,
         redige_par_malica, arrete
    from collab.pv_reunions;

commit;
