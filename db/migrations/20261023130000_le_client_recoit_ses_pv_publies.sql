-- Les PV déjà publiés sont des livrables du client, même après la fin du mandat.
-- Le brouillon reste au cabinet. La réception est un fait séparé : elle ne
-- modifie ni le PV figé ni ses chiffres et ne vaut pas approbation.

alter table collab.pv_reunions force row level security;
create index if not exists pv_client_publication_idx
  on collab.pv_reunions (client_tenant_id, envoye_le desc);

drop policy if exists pv_sel_client_publie on collab.pv_reunions;
create policy pv_sel_client_publie on collab.pv_reunions for select to authenticated
  using (statut = 'envoye'
     and client_tenant_id in (select app.member_orgs())
     and app.has_org_role(client_tenant_id, array['dirigeant']));

create table if not exists collab.pv_receptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references identity.organizations(id),
  pv_id uuid not null references collab.pv_reunions(id),
  membre_id uuid not null references auth.users(id),
  recu_le timestamptz not null default now(),
  unique (pv_id, membre_id)
);
create index if not exists pv_receptions_tenant_idx on collab.pv_receptions (tenant_id, pv_id);
create index if not exists pv_receptions_membre_idx on collab.pv_receptions (membre_id);
alter table collab.pv_receptions enable row level security;
alter table collab.pv_receptions force row level security;
revoke all on collab.pv_receptions from public, anon, service_role;
grant select, insert on collab.pv_receptions to authenticated;

drop policy if exists pv_receptions_sel on collab.pv_receptions;
create policy pv_receptions_sel on collab.pv_receptions for select to authenticated
  using ((tenant_id in (select app.member_orgs()) and app.has_org_role(tenant_id, array['dirigeant']))
    or exists (select 1 from collab.pv_reunions p
                where p.id = pv_id and p.cabinet_tenant_id in (select app.member_orgs())));
drop policy if exists pv_receptions_ins on collab.pv_receptions;
create policy pv_receptions_ins on collab.pv_receptions for insert to authenticated
  with check (tenant_id in (select app.member_orgs())
    and app.has_org_role(tenant_id, array['dirigeant'])
    and membre_id = (select auth.uid())
    and exists (select 1 from collab.pv_reunions p
                 where p.id = pv_id and p.client_tenant_id = tenant_id and p.statut = 'envoye'));

create or replace function collab.pv_reception_consigner()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_cabinet uuid;
begin
  if tg_op <> 'INSERT' then
    raise exception 'Une réception est un fait daté : elle ne se réécrit pas.' using errcode = '42501';
  end if;
  select p.cabinet_tenant_id into v_cabinet from collab.pv_reunions p
    where p.id = new.pv_id and p.client_tenant_id = new.tenant_id and p.statut = 'envoye';
  if v_cabinet is null or new.membre_id <> auth.uid()
     or not app.has_org_role(new.tenant_id, array['dirigeant']) then
    raise exception 'Procès-verbal introuvable.' using errcode = 'P0002';
  end if;
  new.recu_le := clock_timestamp();
  return new;
end $$;
drop trigger if exists pv_reception_figee on collab.pv_receptions;
create trigger pv_reception_figee before insert or update or delete on collab.pv_receptions
  for each row execute function collab.pv_reception_consigner();

create or replace function collab.pv_reception_journaliser()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_cabinet uuid;
begin
  select cabinet_tenant_id into v_cabinet from collab.pv_reunions where id = new.pv_id;
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (new.tenant_id, auth.uid(), 'pv.recu', 'collab', 'pv_receptions', new.id,
          jsonb_build_object('pv_id', new.pv_id, 'recu_le', new.recu_le)),
         (v_cabinet, auth.uid(), 'pv.recu', 'collab', 'pv_receptions', new.id,
          jsonb_build_object('pv_id', new.pv_id, 'client_tenant_id', new.tenant_id, 'recu_le', new.recu_le));
  return new;
end $$;
revoke all on function collab.pv_reception_journaliser() from public, anon, authenticated, service_role;
drop trigger if exists pv_reception_journal on collab.pv_receptions;
create trigger pv_reception_journal after insert on collab.pv_receptions
  for each row execute function collab.pv_reception_journaliser();

create or replace view public.pv_receptions_v with (security_invoker = true) as
  select id, tenant_id, pv_id, membre_id, recu_le from collab.pv_receptions;
revoke all on public.pv_receptions_v from public, anon, service_role;
grant select on public.pv_receptions_v to authenticated;

create or replace function public.pv_accuser_reception(p_pv uuid)
returns timestamptz language plpgsql security invoker set search_path = '' as $$
declare v_tenant uuid; v_quand timestamptz;
begin
  select client_tenant_id into v_tenant from collab.pv_reunions
    where id = p_pv and statut = 'envoye';
  if v_tenant is null or not app.has_org_role(v_tenant, array['dirigeant']) then
    raise exception 'Procès-verbal introuvable.' using errcode = 'P0002';
  end if;
  insert into collab.pv_receptions (tenant_id, pv_id, membre_id)
    values (v_tenant, p_pv, auth.uid()) on conflict (pv_id, membre_id) do nothing;
  select recu_le into v_quand from collab.pv_receptions
    where pv_id = p_pv and membre_id = auth.uid();
  return v_quand;
end $$;
revoke all on function public.pv_accuser_reception(uuid) from public, anon, service_role;
grant execute on function public.pv_accuser_reception(uuid) to authenticated;
