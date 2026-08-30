create schema if not exists identity;
revoke all on schema identity from public;
revoke all on schema identity from anon;
grant usage on schema identity to authenticated;

create table identity.organizations (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in ('pme','cabinet')),
  name            text not null check (length(btrim(name)) > 0),
  legal_id        text,
  jurisdiction    text not null default 'TN',
  currency        text not null default 'TND',
  validation_mode app.validation_mode_t not null default 'mandate',
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table identity.entities (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references identity.organizations(id) on delete cascade,
  code        text not null,
  name        text not null,
  is_default  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, code)
);
create index entities_tenant_idx on identity.entities (tenant_id);

create table identity.profiles (
  user_id      uuid primary key,
  display_name text,
  locale       text not null default 'fr' check (locale in ('fr','en','ar')),
  phone        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table identity.memberships (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references identity.organizations(id) on delete cascade,
  user_id    uuid not null,
  role       text not null check (role in ('dirigeant','collaborateur','expert','assistant')),
  created_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);
create index memberships_user_idx on identity.memberships (user_id);

create table identity.engagements (
  id             uuid primary key default gen_random_uuid(),
  pme_org_id     uuid not null references identity.organizations(id) on delete cascade,
  cabinet_org_id uuid not null references identity.organizations(id) on delete cascade,
  status         text not null default 'propose' check (status in ('propose','actif','suspendu','termine')),
  starts_on      date not null default current_date,
  ends_on        date,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (pme_org_id <> cabinet_org_id),
  unique (pme_org_id, cabinet_org_id)
);
create index engagements_cabinet_idx on identity.engagements (cabinet_org_id, status);
create index engagements_pme_idx on identity.engagements (pme_org_id, status);

create table identity.invitations (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references identity.organizations(id) on delete cascade,
  email       text not null,
  role        text not null check (role in ('dirigeant','collaborateur','expert','assistant')),
  token_hash  text not null unique,
  invited_by  uuid,
  expires_at  timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid,
  created_at  timestamptz not null default now()
);
create index invitations_tenant_idx on identity.invitations (tenant_id);

create or replace function app.member_orgs()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.tenant_id
  from identity.memberships m
  where m.user_id = auth.uid()
$$;

revoke all on function app.member_orgs() from public;
grant execute on function app.member_orgs() to authenticated;

create or replace function app.engaged_orgs()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.pme_org_id
  from identity.engagements e
  join identity.memberships m on m.tenant_id = e.cabinet_org_id
  where m.user_id = auth.uid()
    and e.status = 'actif'
    and e.starts_on <= current_date
    and (e.ends_on is null or e.ends_on >= current_date)
$$;

revoke all on function app.engaged_orgs() from public;
grant execute on function app.engaged_orgs() to authenticated;

create or replace function app.has_org_role(p_org uuid, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from identity.memberships m
    where m.user_id = auth.uid()
      and m.tenant_id = p_org
      and m.role = any(p_roles)
  )
$$;

revoke all on function app.has_org_role(uuid, text[]) from public;
grant execute on function app.has_org_role(uuid, text[]) to authenticated;

create trigger organizations_touch before update on identity.organizations
  for each row execute function app.touch_updated_at();
create trigger entities_touch before update on identity.entities
  for each row execute function app.touch_updated_at();
create trigger profiles_touch before update on identity.profiles
  for each row execute function app.touch_updated_at();
create trigger engagements_touch before update on identity.engagements
  for each row execute function app.touch_updated_at();

alter table identity.organizations enable row level security;
alter table identity.organizations force row level security;
revoke all on table identity.organizations from public, anon, service_role;
grant select, insert, update on table identity.organizations to authenticated;

create policy organizations_sel on identity.organizations for select to authenticated
  using (id in (select app.member_orgs()) or id in (select app.engaged_orgs()) or app.is_platform());
create policy organizations_ins on identity.organizations for insert to authenticated
  with check (created_by = auth.uid());
create policy organizations_upd on identity.organizations for update to authenticated
  using (app.has_org_role(id, array['dirigeant','expert']))
  with check (app.has_org_role(id, array['dirigeant','expert']));

alter table identity.profiles enable row level security;
alter table identity.profiles force row level security;
revoke all on table identity.profiles from public, anon, service_role;
grant select, insert, update on table identity.profiles to authenticated;

create policy profiles_own on identity.profiles for select to authenticated
  using (user_id = auth.uid() or exists (
    select 1 from identity.memberships a
    join identity.memberships b on b.tenant_id = a.tenant_id
    where a.user_id = auth.uid() and b.user_id = identity.profiles.user_id));
create policy profiles_ins on identity.profiles for insert to authenticated
  with check (user_id = auth.uid());
create policy profiles_upd on identity.profiles for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

select app.enable_tenant_rls('identity', 'entities');

alter table identity.memberships enable row level security;
alter table identity.memberships force row level security;
revoke all on table identity.memberships from public, anon, service_role;
grant select, insert, update, delete on table identity.memberships to authenticated;

create policy memberships_sel on identity.memberships for select to authenticated
  using (user_id = auth.uid() or tenant_id in (select app.member_orgs()) or app.is_platform());
create policy memberships_ins on identity.memberships for insert to authenticated
  with check (app.has_org_role(tenant_id, array['dirigeant','expert']));
create policy memberships_upd on identity.memberships for update to authenticated
  using (app.has_org_role(tenant_id, array['dirigeant','expert']))
  with check (app.has_org_role(tenant_id, array['dirigeant','expert']));
create policy memberships_del on identity.memberships for delete to authenticated
  using (app.has_org_role(tenant_id, array['dirigeant','expert']));

alter table identity.engagements enable row level security;
alter table identity.engagements force row level security;
revoke all on table identity.engagements from public, anon, service_role;
grant select, insert, update on table identity.engagements to authenticated;

create policy engagements_sel on identity.engagements for select to authenticated
  using (pme_org_id in (select app.member_orgs())
      or cabinet_org_id in (select app.member_orgs())
      or app.is_platform());
create policy engagements_ins on identity.engagements for insert to authenticated
  with check (app.has_org_role(pme_org_id, array['dirigeant'])
           or app.has_org_role(cabinet_org_id, array['expert']));
create policy engagements_upd on identity.engagements for update to authenticated
  using (app.has_org_role(pme_org_id, array['dirigeant'])
      or app.has_org_role(cabinet_org_id, array['expert']))
  with check (app.has_org_role(pme_org_id, array['dirigeant'])
           or app.has_org_role(cabinet_org_id, array['expert']));

alter table identity.invitations enable row level security;
alter table identity.invitations force row level security;
revoke all on table identity.invitations from public, anon, service_role;
grant select, insert, update on table identity.invitations to authenticated;

create policy invitations_sel on identity.invitations for select to authenticated
  using (tenant_id in (select app.member_orgs()) or app.is_platform());
create policy invitations_ins on identity.invitations for insert to authenticated
  with check (app.has_org_role(tenant_id, array['dirigeant','expert']));
create policy invitations_upd on identity.invitations for update to authenticated
  using (app.has_org_role(tenant_id, array['dirigeant','expert']))
  with check (app.has_org_role(tenant_id, array['dirigeant','expert']));