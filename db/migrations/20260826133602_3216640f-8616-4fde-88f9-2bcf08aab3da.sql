-- 016 — Droits et taxes hors TVA, versionnés par pack (aucune constante fiscale en TypeScript).
create table if not exists ref.fiscal_charges (
  id               uuid primary key default gen_random_uuid(),
  pack_version_id  uuid not null references ref.jurisdiction_packs(id) on delete cascade,
  code             text not null,
  label            text not null,
  document_kind    text not null check (document_kind in ('facture_achat','facture_vente')),
  account_code     text not null,
  fixed_amount     app.money_t,
  taxable          boolean not null default false,
  legal_reference  text,
  valid_from       date not null default current_date,
  valid_to         date,
  unique (pack_version_id, code, document_kind, valid_from)
);

insert into ref.fiscal_charges (pack_version_id, code, label, document_kind, account_code, fixed_amount, legal_reference, valid_from)
select p.id, c.code, c.label, c.kind, c.account, c.amount, c.ref, date '2026-01-01'
from ref.jurisdiction_packs p,
  (values
    ('DROIT_TIMBRE', 'Droit de timbre', 'facture_vente', '4368', 1.000, 'Code des droits de timbre, tarif'),
    ('DROIT_TIMBRE', 'Droit de timbre', 'facture_achat', '665',  1.000, 'Code des droits de timbre, tarif')
  ) as c(code, label, kind, account, amount, ref)
where p.jurisdiction = 'TN' and p.version = '2026.1'
on conflict (pack_version_id, code, document_kind, valid_from) do nothing;

insert into ref.accounts (pack_version_id, account_code, label, account_class)
select p.id, a.code, a.label, a.klass
from ref.jurisdiction_packs p,
  (values
    ('4368', 'Etat, autres impots et taxes', 4),
    ('665',  'Droits d''enregistrement et de timbre', 6)
  ) as a(code, label, klass)
where p.jurisdiction = 'TN' and p.version = '2026.1'
on conflict do nothing;

insert into ref.labels (ns, key, locale, value) values
  ('fiscal_charge','DROIT_TIMBRE','fr','Droit de timbre'),
  ('fiscal_charge','DROIT_TIMBRE','en','Stamp duty'),
  ('fiscal_charge','DROIT_TIMBRE','ar','معلوم الطابع الجبائي')
on conflict (ns, key, locale) do nothing;

create or replace view public.ref_fiscal_charges_v with (security_invoker = true) as
  select id, pack_version_id, code, label, document_kind, account_code, fixed_amount,
         taxable, legal_reference, valid_from, valid_to
    from ref.fiscal_charges;

revoke all on table public.ref_fiscal_charges_v from public, anon, service_role;
grant select on table public.ref_fiscal_charges_v to authenticated;