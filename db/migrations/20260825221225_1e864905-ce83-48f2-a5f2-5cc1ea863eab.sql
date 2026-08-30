-- 011_stocks_comptabilisation.sql

-- ---------------------------- REFERENTIEL ----------------------------
create table if not exists ref.stock_categories (
  id                          uuid primary key default gen_random_uuid(),
  pack_version_id             uuid not null references ref.jurisdiction_packs(id) on delete cascade,
  code                        text not null,
  label                       text not null,
  account_stock               text not null,
  account_variation           text not null,
  account_provision           text not null,
  account_provision_dotation  text not null,
  account_provision_reprise   text not null,
  legal_reference             text,
  valid_from                  date not null,
  valid_to                    date,
  created_at                  timestamptz not null default now(),
  unique (pack_version_id, code, valid_from)
);

alter table stocks.items
  add column if not exists category_id uuid references ref.stock_categories(id) on delete restrict;

create table if not exists stocks.depreciations (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references identity.organizations(id) on delete cascade,
  item_id          uuid not null references stocks.items(id) on delete cascade,
  at               date not null,
  valeur_stock     app.money_t not null check (valeur_stock >= 0),
  valeur_nette     app.money_t not null check (valeur_nette >= 0),
  mouvement        app.money_t not null,
  cumul            app.money_t not null check (cumul >= 0),
  note             text,
  ecriture_id      uuid references socle.ecritures(id) on delete set null,
  pack_version_id  uuid not null references ref.jurisdiction_packs(id),
  created_by       uuid,
  created_at       timestamptz not null default now(),
  unique (item_id, at)
);

-- Zero doublon : mouvements, inventaires, depreciations
create unique index if not exists stocks_mouvements_uniq
  on stocks.mouvements (tenant_id, item_id, at, sens, quantite, coalesce(reference, ''));
create unique index if not exists stocks_inventaires_uniq
  on stocks.inventaires (tenant_id, coalesce(item_id, '00000000-0000-0000-0000-000000000000'::uuid), period);

-- ---------------------------- RLS ----------------------------
select app.enable_tenant_rls('stocks', 'depreciations', false, true);

create policy stocks_depreciations_ins_cabinet on stocks.depreciations for insert to authenticated
  with check (tenant_id in (select app.engaged_orgs()));

-- ---------------------------- VUES ----------------------------
create or replace view public.ref_stock_categories_v with (security_invoker = true) as
  select id, pack_version_id, code, label, account_stock, account_variation,
         account_provision, account_provision_dotation, account_provision_reprise,
         legal_reference, valid_from, valid_to
    from ref.stock_categories;

drop view if exists public.stocks_items_v;
create view public.stocks_items_v with (security_invoker = true) as
  select id, tenant_id, entity_id, vis, reference, designation, unite, methode,
         account_stock, account_variation, devise, pack_version_id,
         active, created_at, updated_at, category_id
    from stocks.items;

create or replace view public.stocks_depreciations_v with (security_invoker = true) as
  select id, tenant_id, item_id, at, valeur_stock, valeur_nette, mouvement, cumul,
         note, ecriture_id, pack_version_id, created_at
    from stocks.depreciations;

do $$
declare v text;
begin
  foreach v in array array['ref_stock_categories_v','stocks_depreciations_v','stocks_items_v'] loop
    execute format('revoke all on public.%I from public, anon, service_role', v);
    execute format('grant select on public.%I to authenticated', v);
  end loop;
  execute 'grant insert on public.stocks_depreciations_v to authenticated';
  execute 'grant insert, update on public.stocks_items_v to authenticated';
end $$;

-- ---------------------------- SEED PACK TN 2026.1 ----------------------------
insert into ref.stock_categories (pack_version_id, code, label, account_stock, account_variation,
                                 account_provision, account_provision_dotation,
                                 account_provision_reprise, legal_reference, valid_from)
select p.id, c.code, c.label, c.acs, c.acv, c.acp, c.acpd, c.acpr, c.ref, date '2026-01-01'
from ref.jurisdiction_packs p,
  (values
    ('marchandises',        'Marchandises',                 '37', '6037', '397', '6817', '7817', 'NCT 4 — Stocks'),
    ('matieres_premieres',  'Matieres premieres',           '31', '6031', '391', '6817', '7817', 'NCT 4 — Stocks'),
    ('autres_appro',        'Autres approvisionnements',    '32', '6032', '392', '6817', '7817', 'NCT 4 — Stocks'),
    ('encours',             'En-cours de production',       '33', '713',  '393', '6817', '7817', 'NCT 4 — Stocks'),
    ('produits_finis',      'Produits finis',               '35', '713',  '395', '6817', '7817', 'NCT 4 — Stocks')
  ) as c(code, label, acs, acv, acp, acpd, acpr, ref)
where p.jurisdiction = 'TN' and p.version = '2026.1'
on conflict (pack_version_id, code, valid_from) do nothing;

-- ---------------------------- GESTES INDIVISIBLES ----------------------------
-- Variation d'inventaire : ecriture produite + ligne au journal, en une transaction.
create or replace function public.stocks_inventaire_constater(
  p_item uuid,
  p_period text,
  p_initial numeric,
  p_final numeric,
  p_variation numeric,
  p_pack_version uuid,
  p_date date,
  p_journal text default 'OD'
) returns jsonb
language plpgsql
set search_path to ''
as $$
declare
  v_tenant uuid;
  v_entity uuid;
  v_vis app.vis_t;
  v_devise text;
  v_label text;
  v_acc_stock text;
  v_acc_var text;
  v_abs numeric;
  v_ecr uuid;
  v_inv uuid;
begin
  select i.tenant_id, i.entity_id, i.vis, i.devise, i.designation,
         coalesce(c.account_stock, i.account_stock),
         coalesce(c.account_variation, i.account_variation)
    into v_tenant, v_entity, v_vis, v_devise, v_label, v_acc_stock, v_acc_var
    from stocks.items i
    left join ref.stock_categories c on c.id = i.category_id
   where i.id = p_item;

  if v_tenant is null then
    raise exception 'article introuvable ou non autorise' using errcode = '42501';
  end if;
  if coalesce(p_variation, 0) = 0 then
    raise exception 'aucune variation a constater' using errcode = 'check_violation';
  end if;
  if exists (select 1 from stocks.inventaires s
              where s.tenant_id = v_tenant and s.item_id = p_item and s.period = p_period) then
    raise exception 'inventaire deja constate pour cette periode' using errcode = 'unique_violation';
  end if;

  v_abs := abs(p_variation);

  insert into socle.ecritures (tenant_id, entity_id, vis, journal, date_ecriture,
                              devise, libelle, pack_version_id, status)
  values (v_tenant, v_entity, v_vis, p_journal, p_date, v_devise,
          'Variation de stock ' || p_period || ' — ' || v_label,
          p_pack_version, 'proposee')
  returning id into v_ecr;

  if p_variation > 0 then
    insert into socle.ecriture_lignes (tenant_id, ecriture_id, ordinal, account_code,
                                       libelle, debit, credit)
    values (v_tenant, v_ecr, 1, v_acc_stock, 'Stock final — ' || v_label, v_abs, 0),
           (v_tenant, v_ecr, 2, v_acc_var, 'Variation de stock — ' || v_label, 0, v_abs);
  else
    insert into socle.ecriture_lignes (tenant_id, ecriture_id, ordinal, account_code,
                                       libelle, debit, credit)
    values (v_tenant, v_ecr, 1, v_acc_var, 'Variation de stock — ' || v_label, v_abs, 0),
           (v_tenant, v_ecr, 2, v_acc_stock, 'Stock initial — ' || v_label, 0, v_abs);
  end if;

  update socle.ecritures
     set status = 'booked', booked_by = auth.uid(), booked_at = now(), updated_at = now()
   where id = v_ecr;

  insert into stocks.inventaires (tenant_id, item_id, period, initial, final, variation,
                                  ecriture_id, pack_version_id, created_by)
  values (v_tenant, p_item, p_period, p_initial, p_final, p_variation,
          v_ecr, p_pack_version, auth.uid())
  returning id into v_inv;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, pack_version_id, payload)
  values (v_tenant, auth.uid(), 'stock.inventaire_constate', 'stocks', 'inventaires', v_inv,
          p_pack_version,
          jsonb_build_object('item_id', p_item, 'period', p_period,
                             'variation', p_variation, 'ecriture_id', v_ecr));

  return jsonb_build_object('inventaire_id', v_inv, 'ecriture_id', v_ecr);
end $$;

-- Depreciation de stock (mouvement > 0) ou reprise (mouvement < 0), ecriture comprise.
create or replace function public.stocks_depreciation_constater(
  p_item uuid,
  p_at date,
  p_valeur_stock numeric,
  p_valeur_nette numeric,
  p_mouvement numeric,
  p_cumul numeric,
  p_pack_version uuid,
  p_note text default null,
  p_journal text default 'OD'
) returns jsonb
language plpgsql
set search_path to ''
as $$
declare
  v_tenant uuid;
  v_entity uuid;
  v_vis app.vis_t;
  v_devise text;
  v_label text;
  v_acc_prov text;
  v_acc_dot text;
  v_acc_rep text;
  v_abs numeric;
  v_ecr uuid;
  v_dep uuid;
begin
  select i.tenant_id, i.entity_id, i.vis, i.devise, i.designation,
         c.account_provision, c.account_provision_dotation, c.account_provision_reprise
    into v_tenant, v_entity, v_vis, v_devise, v_label, v_acc_prov, v_acc_dot, v_acc_rep
    from stocks.items i
    join ref.stock_categories c on c.id = i.category_id
   where i.id = p_item;

  if v_tenant is null then
    raise exception 'article introuvable, sans categorie de pack ou non autorise'
      using errcode = '42501';
  end if;
  if coalesce(p_mouvement, 0) = 0 then
    raise exception 'aucun mouvement a constater' using errcode = 'check_violation';
  end if;

  v_abs := abs(p_mouvement);

  insert into socle.ecritures (tenant_id, entity_id, vis, journal, date_ecriture,
                              devise, libelle, pack_version_id, status)
  values (v_tenant, v_entity, v_vis, p_journal, p_at, v_devise,
          case when p_mouvement > 0 then 'Dépréciation de stock — '
               else 'Reprise de dépréciation de stock — ' end || v_label,
          p_pack_version, 'proposee')
  returning id into v_ecr;

  if p_mouvement > 0 then
    insert into socle.ecriture_lignes (tenant_id, ecriture_id, ordinal, account_code,
                                       libelle, debit, credit)
    values (v_tenant, v_ecr, 1, v_acc_dot, 'Dotation provision stock — ' || v_label, v_abs, 0),
           (v_tenant, v_ecr, 2, v_acc_prov, 'Provision stock — ' || v_label, 0, v_abs);
  else
    insert into socle.ecriture_lignes (tenant_id, ecriture_id, ordinal, account_code,
                                       libelle, debit, credit)
    values (v_tenant, v_ecr, 1, v_acc_prov, 'Provision stock — ' || v_label, v_abs, 0),
           (v_tenant, v_ecr, 2, v_acc_rep, 'Reprise provision stock — ' || v_label, 0, v_abs);
  end if;

  update socle.ecritures
     set status = 'booked', booked_by = auth.uid(), booked_at = now(), updated_at = now()
   where id = v_ecr;

  insert into stocks.depreciations (tenant_id, item_id, at, valeur_stock, valeur_nette,
                                    mouvement, cumul, note, ecriture_id, pack_version_id,
                                    created_by)
  values (v_tenant, p_item, p_at, p_valeur_stock, p_valeur_nette, p_mouvement, p_cumul,
          p_note, v_ecr, p_pack_version, auth.uid())
  returning id into v_dep;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, pack_version_id, payload)
  values (v_tenant, auth.uid(), 'stock.depreciation_constatee', 'stocks', 'depreciations',
          v_dep, p_pack_version,
          jsonb_build_object('item_id', p_item, 'at', p_at, 'mouvement', p_mouvement,
                             'ecriture_id', v_ecr));

  return jsonb_build_object('depreciation_id', v_dep, 'ecriture_id', v_ecr);
end $$;

revoke all on function public.stocks_inventaire_constater(uuid, text, numeric, numeric, numeric, uuid, date, text) from public, anon;
revoke all on function public.stocks_depreciation_constater(uuid, date, numeric, numeric, numeric, numeric, uuid, text, text) from public, anon;
grant execute on function public.stocks_inventaire_constater(uuid, text, numeric, numeric, numeric, uuid, date, text) to authenticated;
grant execute on function public.stocks_depreciation_constater(uuid, date, numeric, numeric, numeric, numeric, uuid, text, text) to authenticated;