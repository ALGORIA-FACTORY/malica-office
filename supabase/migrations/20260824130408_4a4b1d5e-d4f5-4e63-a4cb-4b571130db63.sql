create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated;

do $$ begin
  create domain app.money_t as numeric(38,3);
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.vis_t as enum ('personnel', 'partage');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.validation_mode_t as enum ('autonome', 'mandate');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.verdict_t as enum ('conforme', 'a_corriger', 'non_conforme');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.review_outcome_t as enum ('valide', 'retourne');
exception when duplicate_object then null; end $$;

create or replace function app.current_uid()
returns uuid
language sql
stable
security invoker
set search_path = ''
as $$ select auth.uid() $$;

revoke all on function app.current_uid() from public;
grant execute on function app.current_uid() to authenticated;

create table if not exists app.platform_operators (
  user_id     uuid primary key,
  granted_at  timestamptz not null default now(),
  granted_by  uuid,
  note        text
);

alter table app.platform_operators enable row level security;
alter table app.platform_operators force row level security;
revoke all on table app.platform_operators from public;
revoke all on table app.platform_operators from anon;
revoke all on table app.platform_operators from authenticated;

create or replace function app.is_platform()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from app.platform_operators po
    where po.user_id = auth.uid()
  )
$$;

revoke all on function app.is_platform() from public;
grant execute on function app.is_platform() to authenticated;

create or replace function app.deny_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception
    'R7 : % interdit sur %.% — une correction est une ecriture nouvelle',
    tg_op, tg_table_schema, tg_table_name
    using errcode = 'restrict_violation';
end
$$;

revoke all on function app.deny_mutation() from public;

create or replace function app.enable_tenant_rls(
  p_schema      text,
  p_table       text,
  p_visibility  boolean default false,
  p_append_only boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  q         text := quote_ident(p_schema) || '.' || quote_ident(p_table);
  prefix    text := p_schema || '_' || p_table;
  read_expr text;
begin
  execute 'alter table ' || q || ' enable row level security';
  execute 'alter table ' || q || ' force row level security';

  execute 'revoke all on table ' || q || ' from public';
  execute 'revoke all on table ' || q || ' from anon';
  execute 'revoke all on table ' || q || ' from service_role';
  execute 'grant select, insert, update, delete on table ' || q || ' to authenticated';

  if p_visibility then
    read_expr :=
      '(tenant_id in (select app.member_orgs())'
      || ' or (vis = ''partage''::app.vis_t and tenant_id in (select app.engaged_orgs()))'
      || ' or app.is_platform())';
  else
    read_expr :=
      '(tenant_id in (select app.member_orgs())'
      || ' or tenant_id in (select app.engaged_orgs())'
      || ' or app.is_platform())';
  end if;

  execute format(
    'create policy %I on %s for select to authenticated using (%s)',
    prefix || '_sel', q, read_expr);

  execute format(
    'create policy %I on %s for insert to authenticated with check (tenant_id in (select app.member_orgs()))',
    prefix || '_ins', q);

  if p_append_only then
    execute 'create trigger ' || quote_ident(prefix || '_no_upd')
      || ' before update or delete on ' || q
      || ' for each row execute function app.deny_mutation()';
  else
    execute format(
      'create policy %I on %s for update to authenticated using (tenant_id in (select app.member_orgs())) with check (tenant_id in (select app.member_orgs()))',
      prefix || '_upd', q);
    execute format(
      'create policy %I on %s for delete to authenticated using (tenant_id in (select app.member_orgs()))',
      prefix || '_del', q);
  end if;
end
$$;

revoke all on function app.enable_tenant_rls(text, text, boolean, boolean) from public;

create or replace function app.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

revoke all on function app.touch_updated_at() from public;