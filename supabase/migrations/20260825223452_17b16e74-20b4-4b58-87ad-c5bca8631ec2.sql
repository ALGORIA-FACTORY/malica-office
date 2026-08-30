-- 013 — partage du coffre, affectation des clients, PV de réunion, statistiques.
-- Aucun taux, compte ou seuil ici : uniquement de la gouvernance et de la lecture.

-- ------------------------------------------------------------------ partage
create or replace function public.capture_piece_set_vis(
  p_piece uuid,
  p_vis   app.vis_t
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_old app.vis_t;
  v_status text;
begin
  select tenant_id, vis, status into v_tenant, v_old, v_status
    from capture.pieces where id = p_piece for update;
  if v_tenant is null then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;
  if v_old = p_vis then
    return jsonb_build_object('piece_id', p_piece, 'vis', p_vis, 'changed', false);
  end if;
  if p_vis = 'personnel'::app.vis_t and v_status in ('comptabilisee','supervisee') then
    raise exception 'une piece comptabilisee reste partagee' using errcode = 'check_violation';
  end if;

  update capture.pieces set vis = p_vis, updated_at = now() where id = p_piece;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'piece.vis_changed', 'capture', 'pieces', p_piece,
          jsonb_build_object('from', v_old, 'to', p_vis, 'status', v_status));

  if p_vis = 'partage'::app.vis_t then
    insert into collab.notifications (tenant_id, kind, payload)
    values (v_tenant, 'piece.partagee',
            jsonb_build_object('piece_id', p_piece));
  end if;

  return jsonb_build_object('piece_id', p_piece, 'vis', p_vis, 'changed', true);
end $$;

revoke all on function public.capture_piece_set_vis(uuid, app.vis_t) from public, anon;
grant execute on function public.capture_piece_set_vis(uuid, app.vis_t) to authenticated;

-- --------------------------------------------------------------- affectation
create table if not exists collab.assignments (
  id                uuid primary key default gen_random_uuid(),
  cabinet_tenant_id uuid not null references identity.organizations(id) on delete cascade,
  client_tenant_id  uuid not null references identity.organizations(id) on delete cascade,
  collaborator_id   uuid not null references auth.users(id) on delete cascade,
  briefing          text,
  active            boolean not null default true,
  seq               integer not null default 1,
  decided_by        uuid,
  created_at        timestamptz not null default now()
);

create unique index if not exists assignments_active_uq
  on collab.assignments (cabinet_tenant_id, client_tenant_id)
  where active;

create index if not exists assignments_client_idx
  on collab.assignments (client_tenant_id, created_at desc);

alter table collab.assignments enable row level security;

create policy assignments_sel_cabinet on collab.assignments for select to authenticated
  using (cabinet_tenant_id in (select app.member_orgs()));

create policy assignments_ins_cabinet on collab.assignments for insert to authenticated
  with check (cabinet_tenant_id in (select app.member_orgs()));

create policy assignments_upd_cabinet on collab.assignments for update to authenticated
  using (cabinet_tenant_id in (select app.member_orgs()))
  with check (cabinet_tenant_id in (select app.member_orgs()));

-- ------------------------------------------------------------- PV de réunion
create table if not exists collab.pv_reunions (
  id                uuid primary key default gen_random_uuid(),
  cabinet_tenant_id uuid not null references identity.organizations(id) on delete cascade,
  client_tenant_id  uuid references identity.organizations(id) on delete set null,
  at                date not null default current_date,
  titre             text not null,
  participants      text,
  ordre_du_jour     text,
  decisions         text,
  created_by        uuid,
  created_at        timestamptz not null default now()
);

create index if not exists pv_cabinet_idx on collab.pv_reunions (cabinet_tenant_id, at desc);

alter table collab.pv_reunions enable row level security;

create policy pv_sel_cabinet on collab.pv_reunions for select to authenticated
  using (cabinet_tenant_id in (select app.member_orgs()));

create policy pv_ins_cabinet on collab.pv_reunions for insert to authenticated
  with check (cabinet_tenant_id in (select app.member_orgs()));

-- ------------------------------------------------------------------- lecture
create or replace view public.collab_assignments_v
with (security_invoker = true) as
select id, cabinet_tenant_id, client_tenant_id, collaborator_id, briefing,
       active, seq, decided_by, created_at
from collab.assignments;

create or replace view public.collab_pv_v
with (security_invoker = true) as
select id, cabinet_tenant_id, client_tenant_id, at, titre, participants,
       ordre_du_jour, decisions, created_by, created_at
from collab.pv_reunions;

create or replace view public.cabinet_members_v
with (security_invoker = true) as
select m.tenant_id, m.user_id, m.role, u.email::text as email
from identity.memberships m
join auth.users u on u.id = m.user_id
where m.tenant_id in (select app.member_orgs());

create or replace view public.cabinet_stats_v
with (security_invoker = true) as
select p.tenant_id,
       count(*)::bigint as pieces,
       count(*) filter (where p.status = 'capturee')::bigint      as capturees,
       count(*) filter (where p.status = 'lue')::bigint           as lues,
       count(*) filter (where p.status = 'proposee')::bigint      as proposees,
       count(*) filter (where p.status = 'comptabilisee')::bigint as comptabilisees,
       count(*) filter (where p.status = 'supervisee')::bigint    as supervisees,
       count(*) filter (where p.status = 'retournee')::bigint     as retournees,
       coalesce(avg(extract(epoch from (p.updated_at - p.created_at)) / 3600.0)
                 filter (where p.status in ('comptabilisee','supervisee')), 0)::numeric
         as heures_moyennes,
       max(p.created_at) as derniere_piece
from capture.pieces p
group by p.tenant_id;

do $$
declare v text;
begin
  foreach v in array array['collab_assignments_v','collab_pv_v','cabinet_members_v',
                           'cabinet_stats_v']
  loop
    execute format('revoke all on public.%I from public, anon, service_role', v);
    execute format('grant select on public.%I to authenticated', v);
  end loop;
  execute 'grant insert, update on public.collab_assignments_v to authenticated';
  execute 'grant insert on public.collab_pv_v to authenticated';
end $$;

-- Réaffectation atomique : l'ancienne affectation reste au journal (R7).
create or replace function public.collab_assign(
  p_cabinet  uuid,
  p_client   uuid,
  p_user     uuid,
  p_briefing text default null
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_seq integer;
  v_prev uuid;
  v_id uuid;
begin
  if p_cabinet not in (select app.member_orgs()) then
    raise exception 'cabinet non autorise' using errcode = '42501';
  end if;
  if not exists (select 1 from identity.memberships m
                  where m.tenant_id = p_cabinet and m.user_id = p_user) then
    raise exception 'le collaborateur n''est pas membre du cabinet'
      using errcode = 'check_violation';
  end if;
  if not exists (select 1 from identity.engagements e
                  where e.cabinet_org_id = p_cabinet and e.pme_org_id = p_client
                    and e.status = 'actif') then
    raise exception 'aucun mandat actif avec ce client' using errcode = 'check_violation';
  end if;

  select coalesce(max(seq), 0) + 1 into v_seq
    from collab.assignments
   where cabinet_tenant_id = p_cabinet and client_tenant_id = p_client;

  update collab.assignments
     set active = false
   where cabinet_tenant_id = p_cabinet and client_tenant_id = p_client and active
  returning collaborator_id into v_prev;

  insert into collab.assignments (cabinet_tenant_id, client_tenant_id, collaborator_id,
                                  briefing, active, seq, decided_by)
  values (p_cabinet, p_client, p_user, p_briefing, true, v_seq, auth.uid())
  returning id into v_id;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (p_cabinet, auth.uid(), 'client.affecte', 'collab', 'assignments', v_id,
          jsonb_build_object('client_tenant_id', p_client, 'collaborator_id', p_user,
                             'previous_collaborator_id', v_prev, 'briefing', p_briefing,
                             'seq', v_seq));

  return v_id;
end $$;

revoke all on function public.collab_assign(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.collab_assign(uuid, uuid, uuid, text) to authenticated;