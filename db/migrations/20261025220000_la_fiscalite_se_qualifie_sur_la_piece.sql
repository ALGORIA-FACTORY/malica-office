begin;
create table if not exists ref.fiscal_cost_classes (
 jurisdiction text not null, account_class text not null, document_kind text not null, source_ref text not null,
 valid_from date not null, valid_to date,
 primary key(jurisdiction,account_class,document_kind,valid_from)
);
alter table ref.fiscal_cost_classes enable row level security;
alter table ref.fiscal_cost_classes force row level security;
create policy fiscal_cost_classes_lire on ref.fiscal_cost_classes for select to authenticated using(true);
grant select on ref.fiscal_cost_classes to authenticated;
insert into ref.fiscal_cost_classes(jurisdiction,account_class,document_kind,source_ref,valid_from) values
 ('TN','2','facture_achat','NC 01 — actifs non courants ; NC 05',date '2026-01-01'),
 ('TN','3','facture_achat','NC 01 — stocks ; NC 04',date '2026-01-01'),
 ('TN','6','facture_achat','NC 01 — achats et charges',date '2026-01-01'),
 ('TN','7','facture_vente','NC 01 — produits',date '2026-01-01') on conflict do nothing;
-- NC 04 §12 et NC 05 : une taxe non récupérable suit le coût de l'achat.
alter table ref.fiscal_charges add column if not exists incorpore_au_cout_achat boolean not null default false;
update ref.fiscal_charges set incorpore_au_cout_achat = true where code = 'FODEC' and pack_version_id in(select id from ref.jurisdiction_packs where jurisdiction='TN');
create or replace view public.ref_fiscal_charges_v with (security_invoker = true) as
 select id, pack_version_id, code, label, document_kind, account_code, fixed_amount,
        taxable, legal_reference, valid_from, valid_to, rate, basis, incorpore_au_cout_achat
 from ref.fiscal_charges;

create table if not exists parametrage.qualifications_fiscales (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references identity.organizations(id),
 piece_id uuid not null references capture.pieces(id),
 extraction_id uuid not null references capture.extractions(id),
 profil_version_id uuid references parametrage.fiscalite_dossiers(id),
 precedent_id uuid references parametrage.qualifications_fiscales(id),
 payload jsonb not null,
 created_by uuid not null default auth.uid(),
 created_at timestamptz not null default clock_timestamp(),
 constraint qualification_fiscale_payload check (jsonb_typeof(payload->'lignes') = 'array' and length(trim(payload->>'justification')) >= 10)
);
create index if not exists qualification_fiscale_tenant_idx on parametrage.qualifications_fiscales(tenant_id, piece_id, created_at desc);
create index if not exists qualification_fiscale_piece_idx on parametrage.qualifications_fiscales(piece_id, created_at desc);
create index if not exists qualification_fiscale_extract_idx on parametrage.qualifications_fiscales(extraction_id);
create index if not exists qualification_fiscale_profil_idx on parametrage.qualifications_fiscales(profil_version_id);
create index if not exists qualification_fiscale_precedent_idx on parametrage.qualifications_fiscales(precedent_id);
alter table parametrage.qualifications_fiscales enable row level security;
alter table parametrage.qualifications_fiscales force row level security;
drop policy if exists qualification_fiscale_lire on parametrage.qualifications_fiscales;
create policy qualification_fiscale_lire on parametrage.qualifications_fiscales for select to authenticated
 using (exists (select 1 from capture.pieces p where p.id = qualifications_fiscales.piece_id and p.tenant_id = qualifications_fiscales.tenant_id));
drop policy if exists qualification_fiscale_ecrire on parametrage.qualifications_fiscales;
create policy qualification_fiscale_ecrire on parametrage.qualifications_fiscales for insert to authenticated
 with check (created_by = (select auth.uid()) and exists (
  select 1 from identity.engagements e where e.pme_org_id = qualifications_fiscales.tenant_id and e.status = 'actif'
   and e.starts_on <= current_date and (e.ends_on is null or e.ends_on >= current_date)
   and app.has_org_role(e.cabinet_org_id, array['expert']))
  and exists (select 1 from capture.pieces p where p.id = qualifications_fiscales.piece_id and p.tenant_id = qualifications_fiscales.tenant_id and p.vis = 'partage'));
revoke all on parametrage.qualifications_fiscales from public, anon, authenticated;
grant select, insert on parametrage.qualifications_fiscales to authenticated;

create or replace function parametrage.qualification_fiscale_garder() returns trigger
language plpgsql set search_path = '' as $$
declare dernier uuid; lecture uuid; profil uuid; p record;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.tenant_id::text,0));
 select * into p from capture.pieces where id = new.piece_id and tenant_id = new.tenant_id and vis = 'partage';
 if not found then raise exception 'Pièce partagée introuvable.' using errcode='42501'; end if;
 select id into lecture from capture.extractions where piece_id = new.piece_id order by created_at desc limit 1;
 if lecture is distinct from new.extraction_id then raise exception 'La lecture a changé : actualisez la qualification.' using errcode='check_violation'; end if;
 select id into dernier from parametrage.qualifications_fiscales where piece_id = new.piece_id order by created_at desc limit 1;
 if dernier is distinct from new.precedent_id then raise exception 'La qualification a changé depuis sa lecture.' using errcode='check_violation'; end if;
 select f.id into profil from parametrage.fiscalite_dossiers f
  where f.tenant_id = new.tenant_id and f.date_effet <= (new.payload->>'dateOperation')::date
  order by f.date_effet desc, f.created_at desc limit 1;
 if profil is distinct from new.profil_version_id then raise exception 'Le profil fiscal a changé : actualisez la qualification.' using errcode='check_violation'; end if;
 if coalesce((select nullif(x.payload->>'document_date','')::date from capture.extractions x where x.id=lecture),(select nullif(d.valeur,'')::date from capture.precisions d where d.piece_id=new.piece_id and d.champ='document_date' order by d.decided_at desc limit 1),(new.payload->>'dateOperation')::date) is distinct from (new.payload->>'dateOperation')::date then raise exception 'La date qualifiée diffère de la date imprimée.' using errcode='check_violation'; end if;
 if new.payload->>'pieceId' is distinct from new.piece_id::text
    or new.payload->>'extractionId' is distinct from new.extraction_id::text then
  raise exception 'La qualification doit citer la pièce et sa lecture.' using errcode='check_violation';
 end if;
 if new.payload->>'documentKind' is distinct from coalesce(case when p.document_kind_statut = 'confirme' then p.document_kind end,
    (select x.payload->>'document_kind' from capture.extractions x where x.id=lecture)) then
  raise exception 'Le sens de la pièce a changé.' using errcode='check_violation';
 end if;
 return new;
end $$;
drop trigger if exists qualification_fiscale_garder on parametrage.qualifications_fiscales;
create trigger qualification_fiscale_garder before insert on parametrage.qualifications_fiscales
 for each row execute function parametrage.qualification_fiscale_garder();
drop trigger if exists qualification_fiscale_immuable on parametrage.qualifications_fiscales;
create trigger qualification_fiscale_immuable before update or delete on parametrage.qualifications_fiscales
 for each row execute function parametrage.fiscalite_immuable();
drop trigger if exists qualification_fiscale_tracer on parametrage.qualifications_fiscales;
create trigger qualification_fiscale_tracer after insert on parametrage.qualifications_fiscales
 for each row execute function parametrage.fiscalite_tracer();
-- Le jugement déterministe d'une pièce partagée peut être rejoué par l'expert.
-- Il ne reçoit jamais des montants du navigateur : analyserPiece relit les jetons.
drop policy if exists analyses_ins_expert on capture.analyses;
create policy analyses_ins_expert on capture.analyses for insert to authenticated
 with check (exists (select 1 from capture.pieces p where p.id = analyses.piece_id and p.tenant_id = analyses.tenant_id and p.vis = 'partage')
  and exists (select 1 from identity.engagements e where e.pme_org_id = analyses.tenant_id and e.status = 'actif'
   and e.starts_on <= current_date and (e.ends_on is null or e.ends_on >= current_date)
   and app.has_org_role(e.cabinet_org_id,array['expert'])));
commit;
