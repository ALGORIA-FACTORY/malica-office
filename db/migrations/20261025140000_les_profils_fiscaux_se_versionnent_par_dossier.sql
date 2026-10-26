-- Le comptable déclare des règles datées. Aucun taux nouveau n'est inventé.
-- Les profils sont des modèles ; chaque dossier conserve un instantané et ses exceptions.
begin;
alter table ref.fiscal_charges add column if not exists famille text not null default 'autre'
  check (famille in ('timbre','fodec','retenue','autre'));
update ref.fiscal_charges set famille = 'timbre' where code = 'DROIT_TIMBRE';
update ref.fiscal_charges set famille = 'fodec' where code = 'FODEC';

create table if not exists parametrage.profils_fiscaux (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references identity.organizations(id),
  profil_id uuid not null,
  precedent_id uuid references parametrage.profils_fiscaux(id),
  nom text not null check (length(trim(nom)) between 1 and 160),
  categorie text not null check (length(trim(categorie)) between 1 and 160),
  jurisdiction text not null,
  date_effet date not null,
  configuration jsonb not null check (jsonb_typeof(configuration) = 'object'),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists profils_fiscaux_tenant_idx
  on parametrage.profils_fiscaux(tenant_id, profil_id, created_at desc);
create index if not exists profils_fiscaux_precedent_idx on parametrage.profils_fiscaux(precedent_id);

create table if not exists parametrage.fiscalite_dossiers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references identity.organizations(id),
  cabinet_id uuid not null references identity.organizations(id),
  version_profil_id uuid not null references parametrage.profils_fiscaux(id),
  precedent_id uuid references parametrage.fiscalite_dossiers(id),
  categorie text not null,
  personnalise boolean not null,
  date_effet date not null,
  configuration jsonb not null check (jsonb_typeof(configuration) = 'object'),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists fiscalite_dossiers_tenant_idx
  on parametrage.fiscalite_dossiers(tenant_id, date_effet desc, created_at desc);
create index if not exists fiscalite_dossiers_cabinet_idx on parametrage.fiscalite_dossiers(cabinet_id, tenant_id);
create index if not exists fiscalite_dossiers_profil_idx on parametrage.fiscalite_dossiers(version_profil_id);
create index if not exists fiscalite_dossiers_precedent_idx on parametrage.fiscalite_dossiers(precedent_id);

alter table parametrage.profils_fiscaux enable row level security;
alter table parametrage.profils_fiscaux force row level security;
alter table parametrage.fiscalite_dossiers enable row level security;
alter table parametrage.fiscalite_dossiers force row level security;

drop policy if exists profils_fiscaux_lire on parametrage.profils_fiscaux;
create policy profils_fiscaux_lire on parametrage.profils_fiscaux for select to authenticated
  using (tenant_id in (select app.member_orgs()));
drop policy if exists profils_fiscaux_ecrire on parametrage.profils_fiscaux;
create policy profils_fiscaux_ecrire on parametrage.profils_fiscaux for insert to authenticated
  with check (app.has_org_role(tenant_id, array['expert']) and created_by = (select auth.uid()));
drop policy if exists fiscalite_dossiers_lire on parametrage.fiscalite_dossiers;
create policy fiscalite_dossiers_lire on parametrage.fiscalite_dossiers for select to authenticated
  using (tenant_id in (select app.member_orgs()) or tenant_id in (select app.engaged_orgs()));
drop policy if exists fiscalite_dossiers_ecrire on parametrage.fiscalite_dossiers;
create policy fiscalite_dossiers_ecrire on parametrage.fiscalite_dossiers for insert to authenticated
  with check (created_by = (select auth.uid()) and app.has_org_role(cabinet_id, array['expert'])
    and exists (select 1 from identity.engagements e where e.cabinet_org_id = cabinet_id
      and e.pme_org_id = tenant_id and e.status = 'actif'
      and e.starts_on <= current_date and (e.ends_on is null or e.ends_on >= current_date)));
revoke all on parametrage.profils_fiscaux, parametrage.fiscalite_dossiers from public, anon, authenticated;
grant select, insert on parametrage.profils_fiscaux, parametrage.fiscalite_dossiers to authenticated;

create or replace function parametrage.fiscalite_immuable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Un paramétrage fiscal se versionne ; il ne se réécrit pas.' using errcode = 'restrict_violation';
end $$;
drop trigger if exists profils_fiscaux_immuables on parametrage.profils_fiscaux;
create trigger profils_fiscaux_immuables before update or delete on parametrage.profils_fiscaux
  for each row execute function parametrage.fiscalite_immuable();
drop trigger if exists fiscalite_dossiers_immuable on parametrage.fiscalite_dossiers;
create trigger fiscalite_dossiers_immuable before update or delete on parametrage.fiscalite_dossiers
  for each row execute function parametrage.fiscalite_immuable();

create or replace function parametrage.configuration_fiscale_valider(c jsonb, j text, d date)
returns void language plpgsql set search_path = '' as $$
declare r jsonb; v_axe text; v_code text;
begin
  if c->>'activite' is null or length(trim(c->>'activite')) = 0
     or jsonb_typeof(c->'regles') is distinct from 'array' then
    raise exception 'Activité et règles fiscales requises.' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(c->'regles') not between 1 and 100 then
    raise exception 'Nombre de règles fiscales invalide.' using errcode = 'check_violation';
  end if;
  foreach v_axe in array array['imposition', 'tva'] loop
    v_code := case when v_axe = 'imposition' then c->>'regimeImposition' else c->>'regimeTva' end;
    if v_code is not null and not exists (select 1 from ref.regimes_fiscaux f
      where f.jurisdiction = j and f.axe = v_axe and f.code = v_code
        and f.valid_from <= d and (f.valid_to is null or f.valid_to > d)) then
      raise exception 'Régime fiscal inconnu à cette date.' using errcode = 'check_violation';
    end if;
  end loop;
  if c->>'prorataTva' is not null and
     (c->>'regimeTva' is distinct from 'partiel' or (c->>'prorataTva')::numeric not between 0 and 100) then
    raise exception 'Prorata de TVA invalide.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from jsonb_array_elements(c->'regles') as v(regle)
    group by v.regle->>'famille', v.regle->>'operation', v.regle->>'typeOperation', v.regle->>'code' having count(*) > 1) then
    raise exception 'Règle fiscale en double.' using errcode = 'check_violation';
  end if;
  for r in select value from jsonb_array_elements(c->'regles') loop
    if coalesce(r->>'famille','') not in ('tva','timbre','fodec','retenue','autre')
       or coalesce(r->>'operation','') not in ('achat','vente','paiement_emis','paiement_recu')
       or coalesce(r->>'applicabilite','') not in ('applicable','non_applicable','exonere','suspendu','a_qualifier')
       or coalesce(r->>'mode','') not in ('taux','montant','aucun')
       or length(trim(coalesce(r->>'code',''))) = 0
       or length(trim(coalesce(r->>'typeOperation',''))) = 0 then
      raise exception 'Règle fiscale incomplète.' using errcode = 'check_violation';
    end if;
    if r->>'seuil' is not null and r->>'seuil' !~ '^\d+(\.\d{1,6})?$' then
      raise exception 'Seuil fiscal invalide.' using errcode = 'check_violation';
    end if;
    if r->>'applicabilite' <> 'a_qualifier' and length(trim(coalesce(r->>'referenceLegale',''))) = 0 then
      raise exception 'Référence légale requise.' using errcode = 'check_violation';
    end if;
    if r->>'applicabilite' = 'applicable' then
      if r->>'mode' = 'aucun' or coalesce(r->>'valeur','') !~ '^\d+(\.\d{1,6})?$'
         or (r->>'mode' = 'taux' and ((r->>'valeur')::numeric > 100 or length(trim(coalesce(r->>'assiette',''))) = 0)) then
        raise exception 'Montant, taux ou assiette invalide.' using errcode = 'check_violation';
      end if;
    elsif r->>'mode' <> 'aucun' or r->>'valeur' is not null then
      raise exception 'Une règle sans prélèvement ne porte pas de montant.' using errcode = 'check_violation';
    end if;
    if r->>'applicabilite' in ('exonere','suspendu') and length(trim(coalesce(r->>'justificatif',''))) = 0 then
      raise exception 'Justificatif requis.' using errcode = 'check_violation';
    end if;
  end loop;
end $$;

create or replace function parametrage.profil_fiscal_garder() returns trigger
language plpgsql set search_path = '' as $$
declare precedent parametrage.profils_fiscaux;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.profil_id::text, 0));
  select * into precedent from parametrage.profils_fiscaux
    where tenant_id = new.tenant_id and profil_id = new.profil_id order by created_at desc limit 1;
  if new.precedent_id is distinct from precedent.id or
     (precedent.id is not null and (new.date_effet < precedent.date_effet or new.jurisdiction <> precedent.jurisdiction)) then
    raise exception 'Profil modifié depuis sa lecture ou date antérieure.' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from identity.organizations o where o.id = new.tenant_id and o.kind = 'cabinet' and o.archived_at is null) then
    raise exception 'Une comptabilité est requise.' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from ref.jurisdiction_packs p where p.jurisdiction = new.jurisdiction
    and p.effective_from <= new.date_effet and (p.effective_to is null or p.effective_to > new.date_effet)) then
    raise exception 'Aucun référentiel actif pour cette juridiction et cette date.' using errcode = 'check_violation';
  end if;
  perform parametrage.configuration_fiscale_valider(new.configuration, new.jurisdiction, new.date_effet);
  return new;
end $$;
drop trigger if exists profil_fiscal_garder on parametrage.profils_fiscaux;
create trigger profil_fiscal_garder before insert on parametrage.profils_fiscaux
  for each row execute function parametrage.profil_fiscal_garder();

create or replace function parametrage.fiscalite_dossier_garder() returns trigger
language plpgsql set search_path = '' as $$
declare precedent parametrage.fiscalite_dossiers; profil parametrage.profils_fiscaux;
        fiche identity.fiches_fiscales; j text; c jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.tenant_id::text, 0));
  select * into precedent from parametrage.fiscalite_dossiers where tenant_id = new.tenant_id
    order by date_effet desc, created_at desc limit 1;
  if new.precedent_id is distinct from precedent.id or (precedent.id is not null and new.date_effet < precedent.date_effet) then
    raise exception 'Dossier modifié depuis l’aperçu ou date antérieure.' using errcode = 'check_violation';
  end if;
  select * into profil from parametrage.profils_fiscaux where id = new.version_profil_id and tenant_id = new.cabinet_id;
  select jurisdiction into j from identity.organizations where id = new.tenant_id and archived_at is null;
  if profil.id is null or j is null or profil.jurisdiction <> j or new.date_effet < profil.date_effet
     or new.categorie <> profil.categorie then
    raise exception 'Profil incompatible avec le dossier ou sa date.' using errcode = 'check_violation';
  end if;
  if not new.personnalise and new.configuration <> profil.configuration then
    raise exception 'Une exception doit être identifiée comme personnalisation.' using errcode = 'check_violation';
  end if;
  c := new.configuration;
  perform parametrage.configuration_fiscale_valider(c, j, new.date_effet);
  -- La fiche existante reste la source des échéances : on la versionne dans
  -- la même transaction, en préservant les attributs propres au client.
  select * into fiche from identity.fiches_fiscales where tenant_id = new.tenant_id
    order by valid_from desc limit 1;
  if fiche.id is null or fiche.regime_imposition is distinct from c->>'regimeImposition'
     or fiche.regime_tva is distinct from c->>'regimeTva'
     or fiche.prorata_tva is distinct from (c->>'prorataTva')::numeric
     or fiche.secteur is distinct from c->>'activite' then
    if fiche.id is not null and (fiche.valid_from >= new.date_effet or fiche.valid_to is not null) then
      raise exception 'Une fiche existe déjà à cette date ; choisissez une date d’effet ultérieure.' using errcode = 'check_violation';
    end if;
    update identity.fiches_fiscales set valid_to = new.date_effet where id = fiche.id;
    insert into identity.fiches_fiscales
      (tenant_id, regime_imposition, regime_tva, prorata_tva, secteur, debut_activite,
       cloture_exercice, forme_juridique, mode_depot, source, valid_from)
    values (new.tenant_id, c->>'regimeImposition', c->>'regimeTva', (c->>'prorataTva')::numeric,
      c->>'activite', fiche.debut_activite, fiche.cloture_exercice, fiche.forme_juridique,
      fiche.mode_depot, 'saisie', new.date_effet);
  end if;
  return new;
end $$;
drop trigger if exists fiscalite_dossier_garder on parametrage.fiscalite_dossiers;
create trigger fiscalite_dossier_garder before insert on parametrage.fiscalite_dossiers
  for each row execute function parametrage.fiscalite_dossier_garder();

create or replace function parametrage.fiscalite_tracer() returns trigger
language plpgsql set search_path = '' as $$
begin
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (new.tenant_id, auth.uid(), 'fiscalite.version_creee', tg_table_schema, tg_table_name, new.id, to_jsonb(new));
  return new;
end $$;
drop trigger if exists profil_fiscal_tracer on parametrage.profils_fiscaux;
create trigger profil_fiscal_tracer after insert on parametrage.profils_fiscaux
  for each row execute function parametrage.fiscalite_tracer();
drop trigger if exists fiscalite_dossier_tracer on parametrage.fiscalite_dossiers;
create trigger fiscalite_dossier_tracer after insert on parametrage.fiscalite_dossiers
  for each row execute function parametrage.fiscalite_tracer();

commit;
