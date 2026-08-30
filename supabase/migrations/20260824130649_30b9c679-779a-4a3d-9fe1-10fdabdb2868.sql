create extension if not exists vector with schema extensions;

create schema if not exists ref;
create schema if not exists legal;
create schema if not exists capture;
create schema if not exists socle;
create schema if not exists coffre;
create schema if not exists agents;
create schema if not exists schedule;
create schema if not exists collab;
create schema if not exists audit;
create schema if not exists sync;

do $$
declare s text;
begin
  foreach s in array array['ref','legal','capture','socle','coffre','agents','schedule','collab','audit','sync'] loop
    execute format('revoke all on schema %I from public', s);
    execute format('revoke all on schema %I from anon', s);
    execute format('grant usage on schema %I to authenticated', s);
  end loop;
end $$;

-- ============================ REF ============================

create table ref.jurisdiction_packs (
  id             uuid primary key default gen_random_uuid(),
  jurisdiction   text not null,
  version        text not null,
  effective_from date not null,
  effective_to   date,
  source         text,
  validated_by   uuid,
  validated_at   timestamptz,
  created_at     timestamptz not null default now(),
  unique (jurisdiction, version),
  check ((validated_by is null) = (validated_at is null))
);

create table ref.accounts (
  id              uuid primary key default gen_random_uuid(),
  pack_version_id uuid not null references ref.jurisdiction_packs(id) on delete cascade,
  account_code    text not null,
  label           text not null,
  parent_code     text,
  account_class   text not null,
  unique (pack_version_id, account_code)
);

create table ref.tva_rates (
  id              uuid primary key default gen_random_uuid(),
  pack_version_id uuid not null references ref.jurisdiction_packs(id) on delete cascade,
  code            text not null,
  label           text not null,
  rate            numeric(9,6) not null check (rate >= 0 and rate <= 1),
  valid_from      date not null,
  valid_to        date,
  legal_reference text,
  unique (pack_version_id, code, valid_from)
);

create table ref.pack_rules (
  id              uuid primary key default gen_random_uuid(),
  pack_version_id uuid not null references ref.jurisdiction_packs(id) on delete cascade,
  jurisdiction    text not null,
  kind            text not null,
  label           text not null,
  cadence         text not null check (cadence in ('monthly','quarterly','yearly')),
  day_of_month    smallint not null check (day_of_month between 1 and 31),
  month_offset    smallint not null check (month_offset >= 0),
  legal_reference text,
  valid_from      date not null,
  valid_to        date,
  unique (pack_version_id, kind, valid_from)
);

create table ref.mentions (
  id              uuid primary key default gen_random_uuid(),
  pack_version_id uuid not null references ref.jurisdiction_packs(id) on delete cascade,
  code            text not null,
  label           text not null,
  mandatory       boolean not null default true,
  legal_reference text,
  unique (pack_version_id, code)
);

create table ref.account_mappings (
  id                    uuid primary key default gen_random_uuid(),
  pack_version_id       uuid not null references ref.jurisdiction_packs(id) on delete cascade,
  document_kind         text not null check (document_kind in ('facture_achat','facture_vente')),
  tax_code              text not null,
  main_account          text not null,
  vat_account           text not null,
  counterparty_account  text not null,
  unique (pack_version_id, document_kind, tax_code)
);

create table ref.rejet_motifs (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique,
  severity        text not null default 'bloquant' check (severity in ('bloquant','avertissement')),
  requires_note   boolean not null default false,
  sort_order      smallint not null default 100,
  active          boolean not null default true,
  valid_from      date not null default current_date,
  valid_to        date
);

create table ref.labels (
  id     uuid primary key default gen_random_uuid(),
  ns     text not null,
  key    text not null,
  locale text not null check (locale in ('fr','en','ar')),
  value  text not null,
  unique (ns, key, locale)
);

do $$
declare t text;
begin
  foreach t in array array['jurisdiction_packs','accounts','tva_rates','pack_rules','mentions','account_mappings','rejet_motifs','labels'] loop
    execute format('alter table ref.%I enable row level security', t);
    execute format('alter table ref.%I force row level security', t);
    execute format('revoke all on table ref.%I from public, anon, service_role', t);
    execute format('grant select on table ref.%I to authenticated', t);
    execute format('create policy %I on ref.%I for select to authenticated using (true)', 'ref_' || t || '_sel', t);
  end loop;
end $$;

-- ============================ LEGAL ============================

create table legal.documents (
  id           uuid primary key default gen_random_uuid(),
  jurisdiction text not null,
  code         text not null,
  title        text not null,
  source_url   text,
  unique (jurisdiction, code)
);

create table legal.versions (
  id             uuid primary key default gen_random_uuid(),
  document_id    uuid not null references legal.documents(id) on delete cascade,
  version_label  text not null,
  article        text,
  effective_from date not null,
  effective_to   date,
  body           text not null,
  unique (document_id, version_label, article)
);

create table legal.chunks (
  id         uuid primary key default gen_random_uuid(),
  version_id uuid not null references legal.versions(id) on delete cascade,
  ordinal    integer not null,
  content    text not null,
  embedding  extensions.vector(768),
  unique (version_id, ordinal)
);

create index legal_chunks_hnsw on legal.chunks
  using hnsw (embedding extensions.vector_cosine_ops);

do $$
declare t text;
begin
  foreach t in array array['documents','versions','chunks'] loop
    execute format('alter table legal.%I enable row level security', t);
    execute format('alter table legal.%I force row level security', t);
    execute format('revoke all on table legal.%I from public, anon, service_role', t);
    execute format('grant select on table legal.%I to authenticated', t);
    execute format('create policy %I on legal.%I for select to authenticated using (true)', 'legal_' || t || '_sel', t);
  end loop;
end $$;

-- ============================ CAPTURE ============================

create table capture.pieces (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references identity.organizations(id) on delete cascade,
  entity_id       uuid references identity.entities(id) on delete set null,
  vis             app.vis_t not null default 'partage',
  source          text not null check (source in ('photo','pdf')),
  storage_path    text not null,
  sha256          text,
  page_count      smallint,
  status          text not null default 'capturee'
                  check (status in ('capturee','lue','proposee','confirmee','comptabilisee','supervisee','retournee')),
  idempotency_key text not null,
  created_by      uuid not null default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tenant_id, idempotency_key)
);
create index pieces_tenant_status_idx on capture.pieces (tenant_id, status, created_at desc);

create table capture.piece_versions (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references identity.organizations(id) on delete cascade,
  piece_id     uuid not null references capture.pieces(id) on delete cascade,
  ordinal      smallint not null,
  storage_path text not null,
  sha256       text not null,
  created_by   uuid not null default auth.uid(),
  created_at   timestamptz not null default now(),
  unique (piece_id, ordinal)
);

create table capture.token_plan (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references identity.organizations(id) on delete cascade,
  piece_id  uuid not null references capture.pieces(id) on delete cascade,
  page      smallint not null,
  ordinal   integer not null,
  text      text not null,
  x0        numeric(10,6) not null,
  y0        numeric(10,6) not null,
  x1        numeric(10,6) not null,
  y1        numeric(10,6) not null,
  confidence numeric(5,4),
  created_at timestamptz not null default now(),
  unique (piece_id, page, ordinal)
);
create index token_plan_piece_idx on capture.token_plan (piece_id, page);

create table capture.citations (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references identity.organizations(id) on delete cascade,
  piece_id   uuid not null references capture.pieces(id) on delete cascade,
  field      text not null,
  token_id   uuid not null references capture.token_plan(id) on delete cascade,
  page       smallint not null,
  bbox       jsonb not null,
  zone       text,
  created_at timestamptz not null default now()
);
create index citations_piece_idx on capture.citations (piece_id, field);

create table capture.extractions (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references identity.organizations(id) on delete cascade,
  piece_id   uuid not null references capture.pieces(id) on delete cascade,
  contract   text not null,
  payload    jsonb not null,
  flags      jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index extractions_piece_idx on capture.extractions (piece_id, created_at desc);

create table capture.conformite (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references identity.organizations(id) on delete cascade,
  piece_id         uuid not null references capture.pieces(id) on delete cascade,
  verdict          app.verdict_t not null,
  motif_id         uuid references ref.rejet_motifs(id),
  note             text,
  legal_version_id uuid references legal.versions(id),
  pack_version_id  uuid not null references ref.jurisdiction_packs(id),
  decided_by       uuid not null default auth.uid(),
  decided_at       timestamptz not null default now(),
  check (verdict = 'conforme' or motif_id is not null)
);
create index conformite_piece_idx on capture.conformite (piece_id, decided_at desc);

-- ============================ SOCLE ============================

create table socle.ecritures (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references identity.organizations(id) on delete cascade,
  entity_id          uuid references identity.entities(id) on delete set null,
  piece_id           uuid references capture.pieces(id) on delete set null,
  vis                app.vis_t not null default 'partage',
  journal            text not null,
  date_ecriture      date not null,
  devise             text not null default 'TND',
  libelle            text not null,
  pack_version_id    uuid not null references ref.jurisdiction_packs(id),
  status             text not null default 'proposee'
                     check (status in ('proposee','booked')),
  booked_by          uuid,
  booked_at          timestamptz,
  booked_autonome    boolean not null default false,
  reviewed_by        uuid,
  reviewed_at        timestamptz,
  review_outcome     app.review_outcome_t,
  review_motif_id    uuid references ref.rejet_motifs(id),
  review_note        text,
  reverses_id        uuid references socle.ecritures(id),
  reversal_reason_id uuid references ref.rejet_motifs(id),
  created_by         uuid not null default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check ((booked_by is null) = (booked_at is null)),
  check ((reviewed_by is null) = (reviewed_at is null)),
  check (status <> 'booked' or booked_by is not null),
  check (review_outcome is distinct from 'retourne' or review_motif_id is not null),
  check (reverses_id is null or reversal_reason_id is not null)
);
create index ecritures_tenant_idx on socle.ecritures (tenant_id, status, date_ecriture desc);
create index ecritures_piece_idx on socle.ecritures (piece_id);
create index ecritures_reverses_idx on socle.ecritures (reverses_id);

create table socle.ecriture_lignes (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references identity.organizations(id) on delete cascade,
  ecriture_id  uuid not null references socle.ecritures(id) on delete cascade,
  ordinal      smallint not null,
  account_code text not null,
  libelle      text not null,
  debit        app.money_t not null default 0,
  credit       app.money_t not null default 0,
  tax_code     text,
  created_at   timestamptz not null default now(),
  unique (ecriture_id, ordinal),
  check (debit >= 0 and credit >= 0),
  check ((debit = 0) <> (credit = 0))
);
create index lignes_ecriture_idx on socle.ecriture_lignes (ecriture_id);

-- R5 : l'équilibre et le quatre-yeux sont défendus par la base.

create or replace function socle.assert_bookable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_debit  numeric(38,3);
  v_credit numeric(38,3);
  v_count  integer;
  v_mode   app.validation_mode_t;
begin
  if new.status = 'booked' and (old.status is distinct from 'booked') then
    select count(*), coalesce(sum(l.debit),0), coalesce(sum(l.credit),0)
      into v_count, v_debit, v_credit
      from socle.ecriture_lignes l where l.ecriture_id = new.id;

    if v_count = 0 then
      raise exception 'R5 : une ecriture sans ligne ne peut pas etre comptabilisee'
        using errcode = 'check_violation';
    end if;
    if v_debit <> v_credit then
      raise exception 'R5 : desequilibre debit=% credit=%', v_debit, v_credit
        using errcode = 'check_violation';
    end if;

    select o.validation_mode into v_mode
      from identity.organizations o where o.id = new.tenant_id;
    new.booked_autonome := (v_mode = 'autonome');
  end if;

  if new.review_outcome is not null and new.reviewed_by is not null then
    select o.validation_mode into v_mode
      from identity.organizations o where o.id = new.tenant_id;
    if v_mode = 'mandate' and new.reviewed_by = new.booked_by then
      raise exception 'chk_ecr_4eyes : en mode mandat, le superviseur ne peut pas etre celui qui a comptabilise'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end
$$;

revoke all on function socle.assert_bookable() from public;

create trigger ecritures_assert_bookable before update on socle.ecritures
  for each row execute function socle.assert_bookable();

-- R7 : une ecriture comptabilisee est immuable, hors champs de supervision.

create or replace function socle.freeze_booked()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'booked' then
    if new.tenant_id     is distinct from old.tenant_id
    or new.entity_id     is distinct from old.entity_id
    or new.piece_id      is distinct from old.piece_id
    or new.journal       is distinct from old.journal
    or new.date_ecriture is distinct from old.date_ecriture
    or new.devise        is distinct from old.devise
    or new.libelle       is distinct from old.libelle
    or new.pack_version_id is distinct from old.pack_version_id
    or new.status        is distinct from old.status
    or new.booked_by     is distinct from old.booked_by
    or new.booked_at     is distinct from old.booked_at
    or new.reverses_id   is distinct from old.reverses_id
    then
      raise exception 'R7 : ecriture comptabilisee immuable — une correction est une contre-passation'
        using errcode = 'restrict_violation';
    end if;
  end if;
  return new;
end
$$;

revoke all on function socle.freeze_booked() from public;

create trigger ecritures_freeze_booked before update on socle.ecritures
  for each row execute function socle.freeze_booked();

create or replace function socle.freeze_lignes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_status text;
begin
  select e.status into v_status from socle.ecritures e
    where e.id = coalesce(new.ecriture_id, old.ecriture_id);
  if v_status = 'booked' then
    raise exception 'R7 : les lignes d une ecriture comptabilisee sont immuables'
      using errcode = 'restrict_violation';
  end if;
  return coalesce(new, old);
end
$$;

revoke all on function socle.freeze_lignes() from public;

create trigger lignes_freeze before insert or update or delete on socle.ecriture_lignes
  for each row execute function socle.freeze_lignes();

create trigger ecritures_touch before update on socle.ecritures
  for each row execute function app.touch_updated_at();
create trigger pieces_touch before update on capture.pieces
  for each row execute function app.touch_updated_at();

-- ============================ COFFRE ============================

create table coffre.objects (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references identity.organizations(id) on delete cascade,
  bucket     text not null,
  path       text not null,
  sha256     text not null,
  bytes      bigint not null,
  mime       text not null,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (bucket, path)
);

-- ============================ AGENTS ============================

create table agents.agent_runs (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references identity.organizations(id) on delete cascade,
  piece_id    uuid references capture.pieces(id) on delete set null,
  agent       text not null,
  model       text not null,
  sovereign   boolean not null,
  cost        app.money_t not null default 0,
  latency_ms  integer not null default 0,
  tokens_in   integer,
  tokens_out  integer,
  status      text not null check (status in ('ok','degraded','error')),
  error       text,
  created_by  uuid not null default auth.uid(),
  created_at  timestamptz not null default now()
);
create index agent_runs_tenant_idx on agents.agent_runs (tenant_id, created_at desc);
create index agent_runs_piece_idx on agents.agent_runs (piece_id);

create table agents.budgets (
  tenant_id            uuid primary key references identity.organizations(id) on delete cascade,
  monthly_cost_cap     app.money_t not null default 0,
  per_piece_cost_cap   app.money_t not null default 0,
  per_piece_latency_ms integer not null default 60000,
  updated_at           timestamptz not null default now()
);

create trigger budgets_touch before update on agents.budgets
  for each row execute function app.touch_updated_at();

-- ============================ SCHEDULE ============================

create table schedule.echeances (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references identity.organizations(id) on delete cascade,
  entity_id       uuid references identity.entities(id) on delete set null,
  kind            text not null,
  label           text not null,
  period          text not null,
  due_date        date not null,
  pack_version_id uuid not null references ref.jurisdiction_packs(id),
  status          text not null default 'a_venir' check (status in ('a_venir','fait','en_retard')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tenant_id, kind, period)
);

create trigger echeances_touch before update on schedule.echeances
  for each row execute function app.touch_updated_at();

-- ============================ COLLAB ============================

create table collab.notifications (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references identity.organizations(id) on delete cascade,
  user_id    uuid,
  kind       text not null,
  payload    jsonb not null default '{}'::jsonb,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_tenant_idx on collab.notifications (tenant_id, created_at desc);

create table collab.push_devices (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references identity.organizations(id) on delete cascade,
  user_id     uuid not null default auth.uid(),
  platform    text not null check (platform in ('web','ios','android')),
  token       text not null,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (token)
);

create trigger push_devices_touch before update on collab.push_devices
  for each row execute function app.touch_updated_at();

-- ============================ AUDIT ============================

create table audit.event_log (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references identity.organizations(id) on delete cascade,
  actor           uuid not null default auth.uid(),
  action          text not null,
  object_schema   text not null,
  object_table    text not null,
  object_id       uuid,
  motif_id        uuid references ref.rejet_motifs(id),
  pack_version_id uuid references ref.jurisdiction_packs(id),
  payload         jsonb not null default '{}'::jsonb,
  at              timestamptz not null default now()
);
create index event_log_tenant_idx on audit.event_log (tenant_id, at desc);
create index event_log_object_idx on audit.event_log (object_table, object_id);

-- ============================ SYNC ============================

create table sync.outbox (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references identity.organizations(id) on delete cascade,
  device_id       text not null,
  idempotency_key text not null,
  kind            text not null,
  payload         jsonb not null,
  applied_at      timestamptz,
  created_at      timestamptz not null default now(),
  unique (tenant_id, idempotency_key)
);

-- ============================ RLS ============================

select app.enable_tenant_rls('capture', 'pieces', true, false);
select app.enable_tenant_rls('capture', 'piece_versions', false, true);
select app.enable_tenant_rls('capture', 'token_plan', false, true);
select app.enable_tenant_rls('capture', 'citations', false, true);
select app.enable_tenant_rls('capture', 'extractions', false, true);
select app.enable_tenant_rls('capture', 'conformite', false, true);
select app.enable_tenant_rls('socle', 'ecritures', true, false);
select app.enable_tenant_rls('socle', 'ecriture_lignes', false, false);
select app.enable_tenant_rls('coffre', 'objects', false, true);
select app.enable_tenant_rls('agents', 'agent_runs', false, true);
select app.enable_tenant_rls('agents', 'budgets', false, false);
select app.enable_tenant_rls('schedule', 'echeances', false, false);
select app.enable_tenant_rls('collab', 'notifications', false, false);
select app.enable_tenant_rls('collab', 'push_devices', false, false);
select app.enable_tenant_rls('audit', 'event_log', false, true);
select app.enable_tenant_rls('sync', 'outbox', false, false);