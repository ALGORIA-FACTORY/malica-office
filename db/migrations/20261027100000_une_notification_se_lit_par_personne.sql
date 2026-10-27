-- Une notification se lit par personne.
--
-- ================================================================== POURQUOI
--
-- Audit du 27 octobre 2026 (`une-notification-se-lit-par-personne.test.ts`) :
-- le cabinet ne pouvait pas marquer comme lue une notification du dossier de
-- son client. `collab.notifications` n'a de politique de modification que pour
-- les membres du dossier : l'`update` du cabinet touchait zéro ligne, sans
-- erreur, et la notification restait « non lue » à vie, badge compris.
--
-- Ouvrir cette modification au cabinet aurait été faux : un seul `read_at`
-- pour deux lecteurs, et la lecture du cabinet aurait effacé le « non lu »
-- du dirigeant.
--
-- ================================================================== CE QUI CHANGE
--
-- Chaque personne inscrit SA lecture, un fait daté, en ajout seul :
-- `collab.notification_lectures`. Le `read_at` de la notification reste lu
-- pour les membres du dossier (les lectures d'avant) ; il n'est plus écrit.
-- `public.notification_marquer_lue` inscrit la lecture de l'appelant, pour
-- une notification qu'il voit, et refuse celle qu'il ne voit pas.

create table if not exists collab.notification_lectures (
  tenant_id       uuid not null references identity.organizations(id) on delete cascade,
  notification_id uuid not null references collab.notifications(id) on delete cascade,
  user_id         uuid not null default auth.uid(),
  lu_le           timestamptz not null default now(),
  primary key (tenant_id, notification_id, user_id)
);

create index if not exists notification_lectures_lecteur_idx
  on collab.notification_lectures (tenant_id, user_id);

alter table collab.notification_lectures enable row level security;
alter table collab.notification_lectures force row level security;
revoke all on table collab.notification_lectures from public, anon, service_role;
-- Ajout seul : ni modification ni suppression, la lecture est un fait (R7).
grant select, insert on table collab.notification_lectures to authenticated;

-- Chacun ne lit que ses propres lectures.
create policy collab_notification_lectures_sel on collab.notification_lectures
  for select to authenticated
  using (user_id = auth.uid()
         and (tenant_id in (select app.member_orgs())
              or tenant_id in (select app.engaged_orgs())
              or (select app.is_platform())));

-- Chacun n'inscrit que la sienne, sur un dossier qu'il tient ou qu'il suit.
create policy collab_notification_lectures_ins on collab.notification_lectures
  for insert to authenticated
  with check (user_id = auth.uid()
              and (tenant_id in (select app.member_orgs())
                   or tenant_id in (select app.engaged_orgs())
                   or (select app.is_platform())));

create or replace function public.notification_marquer_lue(p_notification uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  -- Ce que l'appelant voit, et rien d'autre : la politique de lecture de la
  -- notification tranche (membre, cabinet engagé, plateforme).
  select tenant_id into v_tenant from collab.notifications where id = p_notification;
  if v_tenant is null then
    raise exception 'notification introuvable' using errcode = '42501';
  end if;

  insert into collab.notification_lectures (tenant_id, notification_id)
  values (v_tenant, p_notification)
  on conflict do nothing;
end
$$;

revoke all on function public.notification_marquer_lue(uuid) from public, anon;
grant execute on function public.notification_marquer_lue(uuid) to authenticated;
