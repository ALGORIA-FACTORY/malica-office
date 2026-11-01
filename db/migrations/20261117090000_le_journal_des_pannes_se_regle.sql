-- « Tout est réglé » : le journal des pannes se vide à l'écran, sans rien effacer.
--
-- 1er novembre 2026, Wissem : « Journal vide ». `audit.journal_client` est en
-- ajout seul (R7) : une trace qui se réécrit ne prouve rien, et le client n'a
-- aucun droit de suppression (`20261104130000`). Vider « Ce qui n'a pas
-- marché » n'efface donc rien : la personne POSE une marque datée — « tout ce
-- qui précède est réglé » — et l'écran ne montre que les pannes survenues
-- après la dernière marque. L'historique reste en base, entier.
--
-- La marque est un fait, en ajout seul elle aussi, signé de qui la pose.
-- Elle s'écrit par une porte (`public.journal_client_regler`), au `portier`
-- (`20261105100000`) : le client n'écrit aucune table.
--
-- REJEU (R11) : `if not exists`, `create or replace`, `drop … if exists`.

begin;

create table if not exists audit.journal_client_reglements (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references identity.organizations (id) on delete cascade,
  acteur     uuid not null default auth.uid(),
  at         timestamptz not null default clock_timestamp()
);

comment on table audit.journal_client_reglements is
  'Les marques « tout est réglé » du journal des pannes, en ajout seul : la '
  'dernière borne ce que « Ce qui n''a pas marché » montre. Rien n''est effacé '
  'de audit.journal_client. Écrit par public.journal_client_regler.';

-- R6 : l'index mène par `tenant_id`. On lit « la dernière marque de ce dossier ».
create index if not exists journal_client_reglements_tenant_idx
  on audit.journal_client_reglements (tenant_id, at desc);

-- Ajout seul (R7).
drop trigger if exists journal_client_reglements_no_upd on audit.journal_client_reglements;
create trigger journal_client_reglements_no_upd
  before update or delete on audit.journal_client_reglements
  for each row execute function app.deny_mutation();

alter table audit.journal_client_reglements enable row level security;
alter table audit.journal_client_reglements force row level security;
revoke all on table audit.journal_client_reglements from public, anon, service_role;
grant select on table audit.journal_client_reglements to authenticated;

-- Ce que voit le journal, la marque le voit : le dossier, son cabinet engagé.
drop policy if exists journal_client_reglements_sel on audit.journal_client_reglements;
create policy journal_client_reglements_sel on audit.journal_client_reglements
  for select to authenticated
  using (tenant_id in (select app.member_orgs())
         or tenant_id in (select app.engaged_orgs())
         or (select app.is_platform()));

-- La porte s'exécute sous le portier : la politique d'insertion est la règle
-- de droits elle-même — un membre du dossier, signé de lui-même.
drop policy if exists journal_client_reglements_ins on audit.journal_client_reglements;
create policy journal_client_reglements_ins on audit.journal_client_reglements
  for insert to authenticated
  with check (tenant_id in (select app.member_orgs()) and acteur = (select auth.uid()));
grant insert on audit.journal_client_reglements to portier;

-- --- La porte ------------------------------------------------------------------------------------

create or replace function public.journal_client_regler(p_tenant uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare v_at timestamptz;
begin
  if p_tenant is null or p_tenant not in (select app.member_orgs()) then
    raise exception 'refus.journal.droits' using errcode = '42501';
  end if;
  insert into audit.journal_client_reglements (tenant_id) values (p_tenant)
  returning at into v_at;
  return v_at;
end
$$;

alter function public.journal_client_regler(uuid) owner to portier;
revoke all on function public.journal_client_regler(uuid) from public, anon;
grant execute on function public.journal_client_regler(uuid) to authenticated;

comment on function public.journal_client_regler(uuid) is
  'Pose la marque « tout est réglé » du journal des pannes d''un dossier. '
  'N''efface rien : « Ce qui n''a pas marché » ne montre plus que ce qui suit.';

-- Ce que voit l'API, par une vue (`security_invoker`), comme le journal.
create or replace view public.journal_client_reglements_v with (security_invoker = true) as
  select id, tenant_id, acteur, at from audit.journal_client_reglements;
revoke all on table public.journal_client_reglements_v from public, anon, service_role;
grant select on table public.journal_client_reglements_v to authenticated;

commit;
