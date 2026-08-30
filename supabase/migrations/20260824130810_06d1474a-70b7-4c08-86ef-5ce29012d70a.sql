create schema if not exists catalog;
create schema if not exists pricing;
create schema if not exists commissions;
create schema if not exists billing;
create schema if not exists payments;
create schema if not exists contracts;

do $$
declare s text;
begin
  foreach s in array array['catalog','pricing','commissions','billing','payments','contracts'] loop
    execute format('revoke all on schema %I from public', s);
    execute format('revoke all on schema %I from anon', s);
    execute format('grant usage on schema %I to authenticated', s);
  end loop;
end $$;

create table catalog.products (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references identity.organizations(id) on delete cascade,
  sku        text not null,
  name       text not null,
  kind       text not null check (kind in ('bien','service')),
  tax_code   text,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, sku)
);
create trigger products_touch before update on catalog.products
  for each row execute function app.touch_updated_at();

create table pricing.price_lists (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references identity.organizations(id) on delete cascade,
  code       text not null,
  currency   text not null default 'TND',
  valid_from date not null default current_date,
  valid_to   date,
  created_at timestamptz not null default now(),
  unique (tenant_id, code, valid_from)
);

create table pricing.prices (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references identity.organizations(id) on delete cascade,
  price_list_id uuid not null references pricing.price_lists(id) on delete cascade,
  product_id    uuid not null references catalog.products(id) on delete cascade,
  amount        app.money_t not null check (amount >= 0),
  created_at    timestamptz not null default now(),
  unique (price_list_id, product_id)
);

create table commissions.rules (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references identity.organizations(id) on delete cascade,
  code       text not null,
  basis      text not null check (basis in ('pourcentage','fixe')),
  rate       numeric(9,6) check (rate is null or (rate >= 0 and rate <= 1)),
  amount     app.money_t,
  valid_from date not null default current_date,
  valid_to   date,
  created_at timestamptz not null default now(),
  unique (tenant_id, code, valid_from),
  check ((basis = 'pourcentage' and rate is not null) or (basis = 'fixe' and amount is not null))
);

create table billing.invoice_sequences (
  tenant_id   uuid not null references identity.organizations(id) on delete cascade,
  year        smallint not null,
  prefix      text not null default 'FA',
  last_number integer not null default 0,
  primary key (tenant_id, year)
);

create table billing.invoices (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references identity.organizations(id) on delete cascade,
  entity_id    uuid references identity.entities(id) on delete set null,
  number       text,
  status       text not null default 'brouillon' check (status in ('brouillon','emise','annulee')),
  kind         text not null default 'facture' check (kind in ('facture','avoir')),
  reverses_id  uuid references billing.invoices(id),
  customer_name text not null,
  customer_legal_id text,
  currency     text not null default 'TND',
  issued_on    date,
  due_on       date,
  total_ht     app.money_t not null default 0,
  total_tva    app.money_t not null default 0,
  total_ttc    app.money_t not null default 0,
  created_by   uuid not null default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, number),
  check (status <> 'emise' or (number is not null and issued_on is not null))
);
create index invoices_tenant_idx on billing.invoices (tenant_id, status, issued_on desc);

create table billing.invoice_lines (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references identity.organizations(id) on delete cascade,
  invoice_id uuid not null references billing.invoices(id) on delete cascade,
  ordinal    smallint not null,
  product_id uuid references catalog.products(id) on delete set null,
  libelle    text not null,
  quantity   numeric(18,6) not null check (quantity > 0),
  unit_price app.money_t not null check (unit_price >= 0),
  tax_code   text,
  amount_ht  app.money_t not null default 0,
  amount_tva app.money_t not null default 0,
  unique (invoice_id, ordinal)
);

create table commissions.entries (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references identity.organizations(id) on delete cascade,
  rule_id    uuid not null references commissions.rules(id) on delete restrict,
  invoice_id uuid references billing.invoices(id) on delete set null,
  beneficiary uuid,
  amount     app.money_t not null,
  created_at timestamptz not null default now()
);

create table payments.payments (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references identity.organizations(id) on delete cascade,
  invoice_id uuid references billing.invoices(id) on delete set null,
  method     text not null check (method in ('espece','cheque','virement','carte','traite')),
  amount     app.money_t not null check (amount > 0),
  value_date date not null default current_date,
  reference  text,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);

create table contracts.contracts (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references identity.organizations(id) on delete cascade,
  code        text not null,
  counterparty text not null,
  status      text not null default 'actif' check (status in ('brouillon','actif','suspendu','termine')),
  starts_on   date not null default current_date,
  ends_on     date,
  amount      app.money_t,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, code)
);
create trigger contracts_touch before update on contracts.contracts
  for each row execute function app.touch_updated_at();
create trigger invoices_touch before update on billing.invoices
  for each row execute function app.touch_updated_at();

-- Numerotation legale : sans trou, delivree par le serveur.

create or replace function billing.next_invoice_number(p_tenant uuid, p_year smallint)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prefix text;
  v_next   integer;
begin
  if not exists (select 1 from app.member_orgs() m where m = p_tenant) then
    raise exception 'acces refuse a l organisation demandee' using errcode = 'insufficient_privilege';
  end if;

  insert into billing.invoice_sequences (tenant_id, year, last_number)
  values (p_tenant, p_year, 0)
  on conflict (tenant_id, year) do nothing;

  update billing.invoice_sequences s
     set last_number = s.last_number + 1
   where s.tenant_id = p_tenant and s.year = p_year
  returning s.prefix, s.last_number into v_prefix, v_next;

  return v_prefix || '-' || p_year::text || '-' || lpad(v_next::text, 6, '0');
end
$$;

revoke all on function billing.next_invoice_number(uuid, smallint) from public;
grant execute on function billing.next_invoice_number(uuid, smallint) to authenticated;

-- Immuabilite d une facture emise.

create or replace function billing.freeze_issued()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'emise' then
      raise exception 'R7 : une facture emise ne peut pas etre supprimee'
        using errcode = 'restrict_violation';
    end if;
    return old;
  end if;

  if old.status = 'emise' then
    if new.number is distinct from old.number
    or new.issued_on is distinct from old.issued_on
    or new.total_ht is distinct from old.total_ht
    or new.total_tva is distinct from old.total_tva
    or new.total_ttc is distinct from old.total_ttc
    or new.customer_name is distinct from old.customer_name
    or new.kind is distinct from old.kind
    or (new.status <> old.status and new.status <> 'annulee')
    then
      raise exception 'R7 : facture emise immuable — emettez un avoir'
        using errcode = 'restrict_violation';
    end if;
  end if;
  return new;
end
$$;

revoke all on function billing.freeze_issued() from public;

create trigger invoices_freeze before update or delete on billing.invoices
  for each row execute function billing.freeze_issued();

create or replace function billing.freeze_issued_lines()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_status text;
begin
  select i.status into v_status from billing.invoices i
    where i.id = coalesce(new.invoice_id, old.invoice_id);
  if v_status = 'emise' then
    raise exception 'R7 : les lignes d une facture emise sont immuables'
      using errcode = 'restrict_violation';
  end if;
  return coalesce(new, old);
end
$$;

revoke all on function billing.freeze_issued_lines() from public;

create trigger invoice_lines_freeze before insert or update or delete on billing.invoice_lines
  for each row execute function billing.freeze_issued_lines();

-- Cloisonnement

select app.enable_tenant_rls('catalog', 'products');
select app.enable_tenant_rls('pricing', 'price_lists');
select app.enable_tenant_rls('pricing', 'prices');
select app.enable_tenant_rls('commissions', 'rules');
select app.enable_tenant_rls('commissions', 'entries');
select app.enable_tenant_rls('billing', 'invoices');
select app.enable_tenant_rls('billing', 'invoice_lines');
select app.enable_tenant_rls('payments', 'payments');
select app.enable_tenant_rls('contracts', 'contracts');

alter table billing.invoice_sequences enable row level security;
alter table billing.invoice_sequences force row level security;
revoke all on table billing.invoice_sequences from public, anon, service_role;
grant select on table billing.invoice_sequences to authenticated;
create policy invoice_sequences_sel on billing.invoice_sequences for select to authenticated
  using (tenant_id in (select app.member_orgs()));