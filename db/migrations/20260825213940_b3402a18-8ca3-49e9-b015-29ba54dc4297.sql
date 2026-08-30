-- ============================ 009 : IMMO / STOCKS / BANQUE ============================
create schema if not exists immo;
create schema if not exists stocks;
create schema if not exists banque;

do $$ declare s text;
begin
  foreach s in array array['immo','stocks','banque'] loop
    execute format('revoke all on schema %I from public, anon, service_role', s);
    execute format('grant usage on schema %I to authenticated', s);
  end loop;
end $$;

do $$ begin
  create type app.amort_method_t as enum ('lineaire','degressif');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.stock_methode_t as enum ('cump','fifo');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.stock_sens_t as enum ('entree','sortie');
exception when duplicate_object then null; end $$;

-- ---------------------------- REFERENTIEL GOUVERNE ----------------------------
create table if not exists ref.immo_categories (
  id                uuid primary key default gen_random_uuid(),
  pack_version_id   uuid not null references ref.jurisdiction_packs(id) on delete cascade,
  code              text not null,
  label             text not null,
  method            app.amort_method_t not null,
  duree_annees      smallint not null check (duree_annees between 1 and 100),
  coefficient       numeric(9,4) not null default 1 check (coefficient >= 1),
  account_immo      text not null,
  account_amort     text not null,
  account_dotation  text not null,
  legal_reference   text,
  valid_from        date not null,
  valid_to          date,
  unique (pack_version_id, code, valid_from)
);

create table if not exists ref.socle_params (
  id              uuid primary key default gen_random_uuid(),
  pack_version_id uuid not null references ref.jurisdiction_packs(id) on delete cascade,
  code            text not null,
  value_text      text,
  value_num       numeric(38,6),
  legal_reference text,
  valid_from      date not null,
  valid_to        date,
  unique (pack_version_id, code, valid_from),
  check (value_text is not null or value_num is not null)
);

do $$ declare t text;
begin
  foreach t in array array['immo_categories','socle_params'] loop
    execute format('alter table ref.%I enable row level security', t);
    execute format('alter table ref.%I force row level security', t);
    execute format('revoke all on table ref.%I from public, anon, service_role', t);
    execute format('grant select on table ref.%I to authenticated', t);
    execute format('create policy %I on ref.%I for select to authenticated using (true)', 'ref_' || t || '_sel', t);
  end loop;
end $$;

-- ---------------------------- IMMOBILISATIONS ----------------------------
create table if not exists immo.assets (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references identity.organizations(id) on delete cascade,
  entity_id         uuid references identity.entities(id) on delete set null,
  vis               app.vis_t not null default 'partage',
  piece_id          uuid references capture.pieces(id) on delete set null,
  category_id       uuid not null references ref.immo_categories(id),
  label             text not null,
  mise_en_service   date not null,
  valeur_brute      app.money_t not null check (valeur_brute > 0),
  valeur_residuelle app.money_t not null default 0 check (valeur_residuelle >= 0),
  method            app.amort_method_t not null,
  duree_annees      smallint not null check (duree_annees between 1 and 100),
  coefficient       numeric(9,4) not null default 1 check (coefficient >= 1),
  devise            text not null,
  pack_version_id   uuid not null references ref.jurisdiction_packs(id),
  status            text not null default 'en_service' check (status in ('en_service','cede','rebute')),
  created_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (valeur_residuelle < valeur_brute)
);
create index if not exists immo_assets_tenant_idx on immo.assets (tenant_id, status, mise_en_service desc);

create table if not exists immo.dotations (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references identity.organizations(id) on delete cascade,
  asset_id        uuid not null references immo.assets(id) on delete cascade,
  exercice        smallint not null check (exercice between 1900 and 2200),
  months          smallint not null check (months between 0 and 12),
  dotation        app.money_t not null check (dotation >= 0),
  cumul           app.money_t not null check (cumul >= 0),
  vnc             app.money_t not null check (vnc >= 0),
  ecriture_id     uuid references socle.ecritures(id) on delete set null,
  pack_version_id uuid not null references ref.jurisdiction_packs(id),
  created_by      uuid,
  created_at      timestamptz not null default now(),
  unique (asset_id, exercice)
);

create table if not exists immo.depreciations (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references identity.organizations(id) on delete cascade,
  asset_id           uuid not null references immo.assets(id) on delete cascade,
  at                 date not null,
  vnc                app.money_t not null check (vnc >= 0),
  valeur_recouvrable app.money_t not null check (valeur_recouvrable >= 0),
  mouvement          app.money_t not null,
  cumul              app.money_t not null check (cumul >= 0),
  motif_id           uuid references ref.rejet_motifs(id),
  note               text,
  ecriture_id        uuid references socle.ecritures(id) on delete set null,
  created_by         uuid,
  created_at         timestamptz not null default now()
);

create table if not exists immo.cessions (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references identity.organizations(id) on delete cascade,
  asset_id     uuid not null references immo.assets(id) on delete cascade,
  at           date not null,
  prix         app.money_t not null check (prix >= 0),
  vnc          app.money_t not null check (vnc >= 0),
  resultat     app.money_t not null,
  ecriture_id  uuid references socle.ecritures(id) on delete set null,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  unique (asset_id)
);

-- ---------------------------- STOCKS ----------------------------
create table if not exists stocks.items (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references identity.organizations(id) on delete cascade,
  entity_id          uuid references identity.entities(id) on delete set null,
  vis                app.vis_t not null default 'partage',
  reference          text not null,
  designation        text not null,
  unite              text not null default 'u',
  methode            app.stock_methode_t not null,
  account_stock      text not null,
  account_variation  text not null,
  devise             text not null,
  pack_version_id    uuid not null references ref.jurisdiction_packs(id),
  active             boolean not null default true,
  created_by         uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (tenant_id, reference)
);

create table if not exists stocks.mouvements (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references identity.organizations(id) on delete cascade,
  item_id        uuid not null references stocks.items(id) on delete cascade,
  sens           app.stock_sens_t not null,
  at             date not null,
  quantite       numeric(38,3) not null check (quantite > 0),
  cout_unitaire  app.money_t,
  reference      text,
  piece_id       uuid references capture.pieces(id) on delete set null,
  ecriture_id    uuid references socle.ecritures(id) on delete set null,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  check (sens = 'sortie' or cout_unitaire is not null)
);
create index if not exists stocks_mouvements_item_idx on stocks.mouvements (item_id, at);

create table if not exists stocks.inventaires (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references identity.organizations(id) on delete cascade,
  item_id         uuid references stocks.items(id) on delete cascade,
  period          text not null,
  initial         app.money_t not null,
  final           app.money_t not null,
  variation       app.money_t not null,
  ecriture_id     uuid references socle.ecritures(id) on delete set null,
  pack_version_id uuid not null references ref.jurisdiction_packs(id),
  created_by      uuid,
  created_at      timestamptz not null default now()
);

-- ---------------------------- BANQUE ----------------------------
create table if not exists banque.comptes (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references identity.organizations(id) on delete cascade,
  entity_id      uuid references identity.entities(id) on delete set null,
  vis            app.vis_t not null default 'partage',
  label          text not null,
  iban           text,
  devise         text not null,
  account_code   text not null,
  active         boolean not null default true,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (tenant_id, label)
);

create table if not exists banque.releve_lignes (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references identity.organizations(id) on delete cascade,
  compte_id        uuid not null references banque.comptes(id) on delete cascade,
  at               date not null,
  label            text not null,
  montant          app.money_t not null,
  reference        text,
  import_batch     uuid not null,
  idempotency_key  text not null,
  status           text not null default 'ouverte' check (status in ('ouverte','rapprochee','ignoree')),
  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (tenant_id, idempotency_key)
);
create index if not exists banque_lignes_compte_idx on banque.releve_lignes (compte_id, at, status);

create table if not exists banque.rapprochements (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references identity.organizations(id) on delete cascade,
  ligne_id        uuid not null references banque.releve_lignes(id) on delete cascade,
  ecriture_id     uuid not null references socle.ecritures(id) on delete cascade,
  score           smallint not null check (score between 0 and 100),
  ecart_montant   app.money_t not null,
  ecart_jours     smallint not null,
  reference_exacte boolean not null default false,
  decided_by      uuid,
  motif_id        uuid references ref.rejet_motifs(id),
  pack_version_id uuid not null references ref.jurisdiction_packs(id),
  created_at      timestamptz not null default now(),
  unique (ligne_id)
);

-- ---------------------------- RLS TENANT ----------------------------
select app.enable_tenant_rls('immo', 'assets', true, false);
select app.enable_tenant_rls('immo', 'dotations', false, true);
select app.enable_tenant_rls('immo', 'depreciations', false, true);
select app.enable_tenant_rls('immo', 'cessions', false, true);
select app.enable_tenant_rls('stocks', 'items', true, false);
select app.enable_tenant_rls('stocks', 'mouvements', false, false);
select app.enable_tenant_rls('stocks', 'inventaires', false, true);
select app.enable_tenant_rls('banque', 'comptes', true, false);
select app.enable_tenant_rls('banque', 'releve_lignes', false, false);
select app.enable_tenant_rls('banque', 'rapprochements', false, true);

create trigger immo_assets_touch before update on immo.assets
  for each row execute function app.touch_updated_at();
create trigger stocks_items_touch before update on stocks.items
  for each row execute function app.touch_updated_at();
create trigger banque_comptes_touch before update on banque.comptes
  for each row execute function app.touch_updated_at();
create trigger banque_lignes_touch before update on banque.releve_lignes
  for each row execute function app.touch_updated_at();

-- le cabinet mandate peut apparier et decider sur le partage
create policy dotations_ins_cabinet on immo.dotations for insert to authenticated
  with check (tenant_id in (select app.engaged_orgs()));
create policy depreciations_ins_cabinet on immo.depreciations for insert to authenticated
  with check (tenant_id in (select app.engaged_orgs()));
create policy cessions_ins_cabinet on immo.cessions for insert to authenticated
  with check (tenant_id in (select app.engaged_orgs()));
create policy inventaires_ins_cabinet on stocks.inventaires for insert to authenticated
  with check (tenant_id in (select app.engaged_orgs()));
create policy rapprochements_ins_cabinet on banque.rapprochements for insert to authenticated
  with check (tenant_id in (select app.engaged_orgs()));
create policy banque_lignes_upd_cabinet on banque.releve_lignes for update to authenticated
  using (tenant_id in (select app.engaged_orgs()))
  with check (tenant_id in (select app.engaged_orgs()));

-- ---------------------------- VUES PUBLIQUES ----------------------------
create or replace view public.ref_immo_categories_v with (security_invoker = true) as
  select id, pack_version_id, code, label, method, duree_annees, coefficient,
         account_immo, account_amort, account_dotation, legal_reference, valid_from, valid_to
    from ref.immo_categories;

create or replace view public.ref_socle_params_v with (security_invoker = true) as
  select id, pack_version_id, code, value_text, value_num, legal_reference, valid_from, valid_to
    from ref.socle_params;

create or replace view public.immo_assets_v with (security_invoker = true) as
  select id, tenant_id, entity_id, vis, piece_id, category_id, label, mise_en_service,
         valeur_brute, valeur_residuelle, method, duree_annees, coefficient, devise,
         pack_version_id, status, created_at, updated_at
    from immo.assets;

create or replace view public.immo_dotations_v with (security_invoker = true) as
  select id, tenant_id, asset_id, exercice, months, dotation, cumul, vnc,
         ecriture_id, pack_version_id, created_at
    from immo.dotations;

create or replace view public.immo_depreciations_v with (security_invoker = true) as
  select id, tenant_id, asset_id, at, vnc, valeur_recouvrable, mouvement, cumul,
         motif_id, note, ecriture_id, created_at
    from immo.depreciations;

create or replace view public.immo_cessions_v with (security_invoker = true) as
  select id, tenant_id, asset_id, at, prix, vnc, resultat, ecriture_id, created_at
    from immo.cessions;

create or replace view public.stocks_items_v with (security_invoker = true) as
  select id, tenant_id, entity_id, vis, reference, designation, unite, methode,
         account_stock, account_variation, devise, pack_version_id, active, created_at, updated_at
    from stocks.items;

create or replace view public.stocks_mouvements_v with (security_invoker = true) as
  select id, tenant_id, item_id, sens, at, quantite, cout_unitaire, reference,
         piece_id, ecriture_id, created_at
    from stocks.mouvements;

create or replace view public.stocks_inventaires_v with (security_invoker = true) as
  select id, tenant_id, item_id, period, initial, final, variation, ecriture_id,
         pack_version_id, created_at
    from stocks.inventaires;

create or replace view public.banque_comptes_v with (security_invoker = true) as
  select id, tenant_id, entity_id, vis, label, iban, devise, account_code, active,
         created_at, updated_at
    from banque.comptes;

create or replace view public.banque_lignes_v with (security_invoker = true) as
  select id, tenant_id, compte_id, at, label, montant, reference, import_batch,
         idempotency_key, status, created_at, updated_at
    from banque.releve_lignes;

create or replace view public.banque_rapprochements_v with (security_invoker = true) as
  select id, tenant_id, ligne_id, ecriture_id, score, ecart_montant, ecart_jours,
         reference_exacte, decided_by, motif_id, pack_version_id, created_at
    from banque.rapprochements;

do $$
declare v text;
begin
  foreach v in array array['ref_immo_categories_v','ref_socle_params_v','immo_assets_v',
                           'immo_dotations_v','immo_depreciations_v','immo_cessions_v',
                           'stocks_items_v','stocks_mouvements_v','stocks_inventaires_v',
                           'banque_comptes_v','banque_lignes_v','banque_rapprochements_v'] loop
    execute format('revoke all on public.%I from public, anon, service_role', v);
    execute format('grant select on public.%I to authenticated', v);
  end loop;
  foreach v in array array['immo_assets_v','immo_dotations_v','immo_depreciations_v',
                           'immo_cessions_v','stocks_items_v','stocks_mouvements_v',
                           'stocks_inventaires_v','banque_comptes_v','banque_lignes_v',
                           'banque_rapprochements_v'] loop
    execute format('grant insert on public.%I to authenticated', v);
  end loop;
  execute 'grant update on public.immo_assets_v to authenticated';
  execute 'grant update on public.stocks_items_v to authenticated';
  execute 'grant update on public.banque_comptes_v to authenticated';
  execute 'grant update on public.banque_lignes_v to authenticated';
end $$;

-- ---------------------------- SEED PACK TN 2026.1 ----------------------------
insert into ref.immo_categories (pack_version_id, code, label, method, duree_annees, coefficient,
                                account_immo, account_amort, account_dotation, legal_reference, valid_from)
select p.id, c.code, c.label, c.method::app.amort_method_t, c.duree, c.coef,
       c.ai, c.aa, c.ad, c.ref, date '2026-01-01'
from ref.jurisdiction_packs p,
  (values
    ('constructions',  'Constructions',                    'lineaire',  20, 1.0,   '2213', '2813', '6811', 'NCT 5 — Immobilisations corporelles'),
    ('materiel',       'Materiel et outillage industriel',  'degressif',  5, 1.5,   '2234', '2834', '6811', 'NCT 5 + Code IRPP/IS art. 12 bis'),
    ('informatique',   'Materiel informatique',             'degressif',  3, 1.5,   '2282', '2882', '6811', 'NCT 5 + Code IRPP/IS art. 12 bis'),
    ('mobilier',       'Mobilier de bureau',                'lineaire',  10, 1.0,   '2284', '2884', '6811', 'NCT 5 — Immobilisations corporelles'),
    ('vehicules',      'Materiel de transport',             'lineaire',   5, 1.0,   '2283', '2883', '6811', 'NCT 5 — Immobilisations corporelles'),
    ('agencements',    'Agencements et installations',      'lineaire',  10, 1.0,   '2181', '2818', '6811', 'NCT 5 — Immobilisations corporelles'),
    ('logiciels',      'Logiciels et licences',             'lineaire',   3, 1.0,   '2051', '2805', '6811', 'NCT 6 — Immobilisations incorporelles')
  ) as c(code, label, method, duree, coef, ai, aa, ad, ref)
where p.jurisdiction = 'TN' and p.version = '2026.1'
on conflict (pack_version_id, code, valid_from) do nothing;

insert into ref.socle_params (pack_version_id, code, value_text, value_num, legal_reference, valid_from)
select p.id, s.code, s.vtext, s.vnum, s.ref, date '2026-01-01'
from ref.jurisdiction_packs p,
  (values
    ('stock.methode',                'cump', null::numeric, 'NCT 4 — Stocks (CMP autorise)'),
    ('stock.quantite_decimals',      null,   3,             'Convention de tenue'),
    ('money.decimals',               null,   3,             'Millime tunisien — 3 decimales'),
    ('rapprochement.tolerance_jours', null,  5,             'Convention de rapprochement'),
    ('rapprochement.tolerance_montant', null, 1.000,        'Convention de rapprochement'),
    ('immo.prorata',                 'mensuel', null,       'Code IRPP/IS — prorata temporis mensuel')
  ) as s(code, vtext, vnum, ref)
where p.jurisdiction = 'TN' and p.version = '2026.1'
on conflict (pack_version_id, code, valid_from) do nothing;