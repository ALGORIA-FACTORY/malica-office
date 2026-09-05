-- =====================================================================================
--  Regalica Office — Les honoraires du cabinet : mandats, factures, encaissements.
--
--  POURQUOI : ce que chaque mandat doit produire, ce qui est facturé, ce qui est
--  encaissé. Un montant n'est jamais deviné : il vient du barème du mandat ou
--  de la facture émise. Toute arithmétique vit ici, en numeric — l'écran ne
--  calcule rien, l'API non plus.
--
--  CE QUI ENGAGE NE SE RÉÉCRIT PAS (R7) : un brouillon se modifie ; une facture
--  émise se fige avec son numéro, et ne connaît plus que deux passages, tous
--  deux par fonction — encaissée jusqu'à être payée, ou annulée par un avoir.
--  Un mandat ne se corrige pas : on le clôt et on en ouvre un autre, daté.
--
--  RIEN EN DUR (R4) : le taux de TVA est celui du pack, désigné par son code et
--  photographié sur la facture au moment où il s'applique ; les droits fixes
--  (timbre) viennent de `ref.fiscal_charges` ; le délai de paiement est porté
--  par le mandat, saisi par le cabinet.
--
--  Toutes les écritures passent par des fonctions : `authenticated` ne peut ni
--  modifier ni supprimer une ligne de ces tables directement.
--
--  Idempotent.
-- =====================================================================================

-- --- 1. Les mandats d'honoraires --------------------------------------------------------
create table if not exists collab.mandats_honoraires (
  id                   uuid primary key default gen_random_uuid(),
  -- Le cabinet : c'est lui le tenant. Le client est une organisation mandatée.
  tenant_id            uuid not null references identity.organizations(id) on delete cascade,
  client_tenant_id     uuid not null references identity.organizations(id) on delete cascade,
  mode                 text not null check (mode in ('forfait', 'temps', 'mixte')),
  frequence            text not null check (frequence in ('mensuelle', 'trimestrielle', 'annuelle')),
  jour_facturation     integer not null check (jour_facturation between 1 and 28),
  forfait              numeric(18,3) check (forfait is null or forfait >= 0),
  taux_horaire         numeric(18,3) check (taux_horaire is null or taux_horaire >= 0),
  -- Le délai de paiement, en jours après l'émission. Saisi, jamais supposé.
  delai_paiement_jours integer not null check (delai_paiement_jours between 0 and 365),
  -- Les prestations que le forfait couvre, telles que le cabinet les nomme.
  couverture           text[] not null default '{}',
  valid_from           date not null default current_date,
  valid_to             date check (valid_to is null or valid_to >= valid_from),
  created_by           uuid not null default auth.uid(),
  created_at           timestamptz not null default now(),
  check (tenant_id <> client_tenant_id),
  -- Un forfait sans montant, ou un temps sans taux, ne dit rien.
  check (mode <> 'forfait' or forfait is not null),
  check (mode <> 'temps' or taux_horaire is not null),
  check (mode <> 'mixte' or (forfait is not null and taux_horaire is not null))
);
create index if not exists mandats_honoraires_tenant_idx
  on collab.mandats_honoraires (tenant_id, client_tenant_id);
-- Un seul mandat ouvert par client et par cabinet.
create unique index if not exists mandats_honoraires_ouvert_uq
  on collab.mandats_honoraires (tenant_id, client_tenant_id) where valid_to is null;
select app.enable_tenant_rls('collab', 'mandats_honoraires', false, false);
revoke insert, update, delete on collab.mandats_honoraires from authenticated;

-- --- 2. Les factures d'honoraires ----------------------------------------------------------
create table if not exists collab.factures_honoraires (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references identity.organizations(id) on delete cascade,
  client_tenant_id uuid not null references identity.organizations(id) on delete cascade,
  mandat_id        uuid references collab.mandats_honoraires(id) on delete set null,
  -- Attribué à l'émission, jamais avant : un brouillon n'a pas de numéro.
  numero           text,
  periode_du       date not null,
  periode_au       date not null check (periode_au >= periode_du),
  statut           text not null default 'brouillon'
                   check (statut in ('brouillon', 'emise', 'payee', 'annulee')),
  -- Le pack sous lequel la facture est établie : le taux et les droits en viennent.
  pack_version_id  uuid not null references ref.jurisdiction_packs(id),
  taux_tva_code    text not null,
  -- Le taux photographié : la facture reste lisible quand le pack évolue.
  taux_tva         numeric(9,6) not null check (taux_tva >= 0 and taux_tva <= 1),
  total_ht         numeric(18,3) not null default 0,
  total_tva        numeric(18,3) not null default 0,
  -- Les droits fixes du pack sur une facture de vente (timbre), et leur nom.
  droits_fixes     numeric(18,3) not null default 0,
  droits_libelle   text,
  total_ttc        numeric(18,3) not null default 0,
  devise           text not null,
  emise_le         date,
  -- L'échéance : émission + délai du mandat. Figée à l'émission.
  echeance_le      date,
  payee_le         date,
  annulee_le       date,
  -- L'avoir désigne la facture qu'il annule.
  avoir_de         uuid references collab.factures_honoraires(id),
  created_by       uuid not null default auth.uid(),
  created_at       timestamptz not null default now(),
  check (tenant_id <> client_tenant_id),
  check ((statut = 'brouillon') = (numero is null)),
  check ((statut = 'brouillon') = (emise_le is null)),
  check (statut <> 'payee' or payee_le is not null),
  check (statut <> 'annulee' or annulee_le is not null)
);
create index if not exists factures_honoraires_tenant_idx
  on collab.factures_honoraires (tenant_id, emise_le desc, created_at desc);
create unique index if not exists factures_honoraires_numero_uq
  on collab.factures_honoraires (tenant_id, numero) where numero is not null;
select app.enable_tenant_rls('collab', 'factures_honoraires', false, false);
revoke insert, update, delete on collab.factures_honoraires from authenticated;

create table if not exists collab.factures_honoraires_lignes (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references identity.organizations(id) on delete cascade,
  facture_id    uuid not null references collab.factures_honoraires(id) on delete cascade,
  ordre         integer not null check (ordre >= 1),
  libelle       text not null check (length(btrim(libelle)) > 0),
  quantite      numeric(18,3) not null,
  prix_unitaire numeric(18,3) not null,
  -- Le montant de la ligne se déduit ; personne ne le saisit.
  montant_ht    numeric(18,3) generated always as (round(quantite * prix_unitaire, 3)) stored,
  unique (facture_id, ordre)
);
create index if not exists factures_honoraires_lignes_tenant_idx
  on collab.factures_honoraires_lignes (tenant_id, facture_id);
select app.enable_tenant_rls('collab', 'factures_honoraires_lignes', false, false);
revoke insert, update, delete on collab.factures_honoraires_lignes from authenticated;

-- --- 3. Les encaissements ------------------------------------------------------------------
-- Un encaissement est un fait daté : il s'ajoute, il ne se corrige pas.
create table if not exists collab.encaissements_honoraires (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references identity.organizations(id) on delete cascade,
  facture_id  uuid not null references collab.factures_honoraires(id) on delete restrict,
  montant     numeric(18,3) not null check (montant > 0),
  encaisse_le date not null,
  moyen       text not null check (moyen in ('virement', 'cheque', 'especes', 'carte', 'autre')),
  reference   text,
  created_by  uuid not null default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists encaissements_honoraires_tenant_idx
  on collab.encaissements_honoraires (tenant_id, facture_id);
select app.enable_tenant_rls('collab', 'encaissements_honoraires', false, true);
revoke insert on collab.encaissements_honoraires from authenticated;

-- --- 4. R7 : une facture émise ne bouge plus ----------------------------------------------
-- Seules les fonctions ci-dessous posent le laissez-passer, pour UNE facture,
-- le temps d'une transaction : le passage emise → payee, emise → annulee.
create or replace function app.honoraires_facture_figee()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.statut = 'brouillon' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'UPDATE'
     and coalesce(current_setting('regalica.honoraires_transition', true), '') = old.id::text
  then
    return new;
  end if;
  raise exception
    'R7 : % interdit sur une facture d''honoraires émise — une correction est un avoir',
    tg_op
    using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists factures_honoraires_figee on collab.factures_honoraires;
create trigger factures_honoraires_figee
  before update or delete on collab.factures_honoraires
  for each row execute function app.honoraires_facture_figee();

-- Les lignes suivent la facture : figées dès qu'elle est émise.
create or replace function app.honoraires_ligne_figee()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_statut text;
begin
  select statut into v_statut
    from collab.factures_honoraires
   where id = coalesce(new.facture_id, old.facture_id);
  -- Absente : la facture (brouillon) est en train de disparaître, en cascade.
  if v_statut is null or v_statut = 'brouillon' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception
    'R7 : % interdit sur les lignes d''une facture d''honoraires émise',
    tg_op
    using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists factures_honoraires_lignes_figees on collab.factures_honoraires_lignes;
create trigger factures_honoraires_lignes_figees
  before insert or update or delete on collab.factures_honoraires_lignes
  for each row execute function app.honoraires_ligne_figee();

-- --- 5. Les totaux se déduisent des lignes ------------------------------------------------
-- HT = somme des lignes ; TVA = HT × taux photographié ; droits fixes = ceux du
-- pack pour une facture de vente, en vigueur ce jour ; TTC = HT + TVA + droits.
-- Un avoir ne recalcule pas ses droits : il reprend, en négatif, ceux de la
-- facture qu'il annule (posés par `honoraires_avoir`).
create or replace function app.honoraires_totaux(p_facture uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  f        record;
  v_ht     numeric(18,3);
  v_tva    numeric(18,3);
  v_droits numeric(18,3);
  v_lib    text;
begin
  select * into f from collab.factures_honoraires where id = p_facture;
  if f.id is null then return; end if;

  select coalesce(sum(montant_ht), 0) into v_ht
    from collab.factures_honoraires_lignes where facture_id = p_facture;
  v_tva := round(v_ht * f.taux_tva, 3);

  if f.avoir_de is null then
    select coalesce(sum(c.fixed_amount), 0), string_agg(c.label, ', ' order by c.label)
      into v_droits, v_lib
      from ref.fiscal_charges c
     where c.pack_version_id = f.pack_version_id
       and c.document_kind = 'facture_vente'
       and c.fixed_amount is not null
       and c.valid_from <= current_date
       and (c.valid_to is null or c.valid_to >= current_date);
  else
    v_droits := f.droits_fixes;
    v_lib := f.droits_libelle;
  end if;

  update collab.factures_honoraires
     set total_ht = v_ht,
         total_tva = v_tva,
         droits_fixes = v_droits,
         droits_libelle = v_lib,
         total_ttc = v_ht + v_tva + v_droits
   where id = p_facture;
end;
$$;
revoke all on function app.honoraires_totaux(uuid) from public, anon, authenticated;

create or replace function app.honoraires_totaux_apres_ligne()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.honoraires_totaux(coalesce(new.facture_id, old.facture_id));
  return null;
end;
$$;

drop trigger if exists factures_honoraires_lignes_totaux on collab.factures_honoraires_lignes;
create trigger factures_honoraires_lignes_totaux
  after insert or update or delete on collab.factures_honoraires_lignes
  for each row execute function app.honoraires_totaux_apres_ligne();

-- --- 6. Les vues -----------------------------------------------------------------------------
create or replace view public.mandats_honoraires_v with (security_invoker = true) as
select id, tenant_id, client_tenant_id, mode, frequence, jour_facturation, forfait, taux_horaire,
       delai_paiement_jours, couverture, valid_from, valid_to, created_by, created_at
  from collab.mandats_honoraires;
grant select on public.mandats_honoraires_v to authenticated;

create or replace view public.factures_honoraires_v with (security_invoker = true) as
select id, tenant_id, client_tenant_id, mandat_id, numero, periode_du, periode_au, statut,
       pack_version_id, taux_tva_code, taux_tva, total_ht, total_tva, droits_fixes, droits_libelle,
       total_ttc, devise, emise_le, echeance_le, payee_le, annulee_le, avoir_de, created_by, created_at
  from collab.factures_honoraires;
grant select on public.factures_honoraires_v to authenticated;

create or replace view public.factures_honoraires_lignes_v with (security_invoker = true) as
select id, tenant_id, facture_id, ordre, libelle, quantite, prix_unitaire, montant_ht
  from collab.factures_honoraires_lignes;
grant select on public.factures_honoraires_lignes_v to authenticated;

create or replace view public.encaissements_honoraires_v with (security_invoker = true) as
select id, tenant_id, facture_id, montant, encaisse_le, moyen, reference, created_by, created_at
  from collab.encaissements_honoraires;
grant select on public.encaissements_honoraires_v to authenticated;

-- --- 7. La prochaine facturation d'un mandat ----------------------------------------------
-- Dérivée de la fréquence, du jour et de l'ouverture du mandat. Aucun jour
-- n'est supposé : tout vient du mandat.
create or replace function public.honoraires_prochaine_facturation(
  p_frequence text, p_jour integer, p_valid_from date, p_valid_to date
) returns date
language plpgsql
stable
set search_path = ''
as $$
declare
  v_pas   integer := case p_frequence when 'mensuelle' then 1 when 'trimestrielle' then 3 else 12 end;
  v_mois  date := date_trunc('month', current_date)::date;
  v_cand  date;
  v_ecart integer;
  i       integer;
begin
  if p_valid_to is not null and p_valid_to < current_date then
    return null;
  end if;
  for i in 0..13 loop
    v_cand := v_mois + (p_jour - 1);
    v_ecart := (extract(year from v_cand)::int - extract(year from p_valid_from)::int) * 12
             + (extract(month from v_cand)::int - extract(month from p_valid_from)::int);
    if v_cand >= current_date and v_cand >= p_valid_from and v_ecart % v_pas = 0
       and (p_valid_to is null or v_cand <= p_valid_to) then
      return v_cand;
    end if;
    v_mois := (v_mois + interval '1 month')::date;
  end loop;
  return null;
end;
$$;
revoke all on function public.honoraires_prochaine_facturation(text, integer, date, date) from public, anon;
grant execute on function public.honoraires_prochaine_facturation(text, integer, date, date) to authenticated;

-- --- 8. Définir un mandat : on clôt, on rouvre --------------------------------------------
create or replace function public.honoraires_mandat_definir(
  p_cabinet uuid, p_client uuid, p_mode text, p_frequence text, p_jour integer,
  p_forfait numeric, p_taux_horaire numeric, p_delai integer, p_couverture text[]
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_cabinet not in (select app.member_orgs()) then
    raise exception 'cabinet introuvable ou non autorise' using errcode = '42501';
  end if;
  if not exists (
    select 1 from identity.engagements e
     where e.cabinet_org_id = p_cabinet and e.pme_org_id = p_client and e.status = 'actif'
       and e.starts_on <= current_date and (e.ends_on is null or e.ends_on >= current_date)
  ) then
    raise exception 'ce client n''est pas mandaté auprès de ce cabinet' using errcode = '22023';
  end if;

  update collab.mandats_honoraires
     set valid_to = current_date
   where tenant_id = p_cabinet and client_tenant_id = p_client and valid_to is null;

  insert into collab.mandats_honoraires
    (tenant_id, client_tenant_id, mode, frequence, jour_facturation, forfait, taux_horaire,
     delai_paiement_jours, couverture)
  values
    (p_cabinet, p_client, p_mode, p_frequence, p_jour,
     case when p_mode in ('forfait', 'mixte') then p_forfait end,
     case when p_mode in ('temps', 'mixte') then p_taux_horaire end,
     p_delai,
     coalesce((select array_agg(btrim(c)) from unnest(p_couverture) c where btrim(c) <> ''), '{}'))
  returning id into v_id;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_cabinet, auth.uid(), 'honoraires.mandat_defini', 'collab', 'mandats_honoraires', v_id,
          jsonb_build_object('client', p_client, 'mode', p_mode, 'frequence', p_frequence,
                             'jour', p_jour, 'forfait', p_forfait, 'taux_horaire', p_taux_horaire,
                             'delai', p_delai, 'couverture', to_jsonb(p_couverture)));
  return jsonb_build_object('id', v_id);
end;
$$;
revoke all on function public.honoraires_mandat_definir(uuid, uuid, text, text, integer, numeric, numeric, integer, text[]) from public, anon;
grant execute on function public.honoraires_mandat_definir(uuid, uuid, text, text, integer, numeric, numeric, integer, text[]) to authenticated;

create or replace function public.honoraires_mandat_clore(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from collab.mandats_honoraires where id = p_id and valid_to is null;
  if v_tenant is null or v_tenant not in (select app.member_orgs()) then
    raise exception 'mandat introuvable ou déjà clos' using errcode = 'P0002';
  end if;
  update collab.mandats_honoraires set valid_to = current_date where id = p_id;
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (v_tenant, auth.uid(), 'honoraires.mandat_clos', 'collab', 'mandats_honoraires', p_id, '{}'::jsonb);
  return jsonb_build_object('id', p_id);
end;
$$;
revoke all on function public.honoraires_mandat_clore(uuid) from public, anon;
grant execute on function public.honoraires_mandat_clore(uuid) to authenticated;

-- --- 9. Le brouillon : créer, modifier -----------------------------------------------------
-- Le taux est désigné par son code ; la fonction le lit dans le pack en vigueur
-- pour la juridiction du cabinet et le photographie sur la facture.
create or replace function app.honoraires_taux_du_pack(p_cabinet uuid, p_code text, out o_pack uuid, out o_taux numeric)
returns record
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_juridiction text;
begin
  select jurisdiction into v_juridiction from identity.organizations where id = p_cabinet;
  select p.id into o_pack
    from ref.jurisdiction_packs p
   where p.jurisdiction = v_juridiction
     and p.effective_from <= current_date
     and (p.effective_to is null or p.effective_to > current_date)
   order by p.effective_from desc limit 1;
  if o_pack is null then
    raise exception 'aucun pack de juridiction en vigueur pour ce cabinet' using errcode = '22023';
  end if;
  select t.rate into o_taux
    from ref.tva_rates t
   where t.pack_version_id = o_pack and t.code = p_code
     and t.valid_from <= current_date and (t.valid_to is null or t.valid_to >= current_date)
   order by t.valid_from desc limit 1;
  if o_taux is null then
    raise exception 'ce taux de TVA n''existe pas dans le pack en vigueur' using errcode = '22023';
  end if;
end;
$$;
revoke all on function app.honoraires_taux_du_pack(uuid, text) from public, anon, authenticated;

-- Remplace les lignes d'un brouillon par celles reçues : [{libelle, quantite, prix_unitaire}].
create or replace function app.honoraires_lignes_poser(p_facture uuid, p_tenant uuid, p_lignes jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from collab.factures_honoraires_lignes where facture_id = p_facture;
  insert into collab.factures_honoraires_lignes (tenant_id, facture_id, ordre, libelle, quantite, prix_unitaire)
  select p_tenant, p_facture, l.ordinality::int, btrim(l.value ->> 'libelle'),
         (l.value ->> 'quantite')::numeric, (l.value ->> 'prix_unitaire')::numeric
    from jsonb_array_elements(coalesce(p_lignes, '[]'::jsonb)) with ordinality as l
   where btrim(coalesce(l.value ->> 'libelle', '')) <> '';
  -- Sans ligne, les totaux se remettent à zéro tout de même.
  perform app.honoraires_totaux(p_facture);
end;
$$;
revoke all on function app.honoraires_lignes_poser(uuid, uuid, jsonb) from public, anon, authenticated;

create or replace function public.honoraires_brouillon_creer(
  p_cabinet uuid, p_client uuid, p_du date, p_au date, p_taux_code text, p_lignes jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id     uuid;
  v_mandat uuid;
  v_devise text;
  v_taux   record;
begin
  if p_cabinet not in (select app.member_orgs()) then
    raise exception 'cabinet introuvable ou non autorise' using errcode = '42501';
  end if;
  if not exists (
    select 1 from identity.engagements e
     where e.cabinet_org_id = p_cabinet and e.pme_org_id = p_client and e.status = 'actif'
  ) then
    raise exception 'ce client n''est pas mandaté auprès de ce cabinet' using errcode = '22023';
  end if;

  select id into v_mandat from collab.mandats_honoraires
   where tenant_id = p_cabinet and client_tenant_id = p_client and valid_to is null;
  select currency into v_devise from identity.organizations where id = p_cabinet;
  v_taux := app.honoraires_taux_du_pack(p_cabinet, p_taux_code);

  insert into collab.factures_honoraires
    (tenant_id, client_tenant_id, mandat_id, periode_du, periode_au, pack_version_id,
     taux_tva_code, taux_tva, devise)
  values (p_cabinet, p_client, v_mandat, p_du, p_au, v_taux.o_pack, p_taux_code, v_taux.o_taux, v_devise)
  returning id into v_id;

  perform app.honoraires_lignes_poser(v_id, p_cabinet, p_lignes);

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_cabinet, auth.uid(), 'honoraires.brouillon_cree', 'collab', 'factures_honoraires', v_id,
          jsonb_build_object('client', p_client, 'periode_du', p_du, 'periode_au', p_au, 'taux', p_taux_code));
  return jsonb_build_object('id', v_id);
end;
$$;
revoke all on function public.honoraires_brouillon_creer(uuid, uuid, date, date, text, jsonb) from public, anon;
grant execute on function public.honoraires_brouillon_creer(uuid, uuid, date, date, text, jsonb) to authenticated;

create or replace function public.honoraires_brouillon_modifier(
  p_id uuid, p_du date, p_au date, p_taux_code text, p_lignes jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  f      record;
  v_taux record;
begin
  select * into f from collab.factures_honoraires where id = p_id;
  if f.id is null or f.tenant_id not in (select app.member_orgs()) then
    raise exception 'facture introuvable ou non autorisée' using errcode = 'P0002';
  end if;
  if f.statut <> 'brouillon' then
    raise exception 'cette facture est émise : elle ne se modifie plus, elle s''annule par un avoir'
      using errcode = '22023';
  end if;
  v_taux := app.honoraires_taux_du_pack(f.tenant_id, p_taux_code);

  update collab.factures_honoraires
     set periode_du = p_du, periode_au = p_au,
         pack_version_id = v_taux.o_pack, taux_tva_code = p_taux_code, taux_tva = v_taux.o_taux
   where id = p_id;
  perform app.honoraires_lignes_poser(p_id, f.tenant_id, p_lignes);
  return jsonb_build_object('id', p_id);
end;
$$;
revoke all on function public.honoraires_brouillon_modifier(uuid, date, date, text, jsonb) from public, anon;
grant execute on function public.honoraires_brouillon_modifier(uuid, date, date, text, jsonb) to authenticated;

-- Un brouillon n'engage rien : il peut disparaître.
create or replace function public.honoraires_brouillon_supprimer(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  f record;
begin
  select id, tenant_id, statut into f from collab.factures_honoraires where id = p_id;
  if f.id is null or f.tenant_id not in (select app.member_orgs()) then
    raise exception 'facture introuvable ou non autorisée' using errcode = 'P0002';
  end if;
  if f.statut <> 'brouillon' then
    raise exception 'une facture émise ne se supprime pas : elle s''annule par un avoir'
      using errcode = '22023';
  end if;
  delete from collab.factures_honoraires where id = p_id;
  return true;
end;
$$;
revoke all on function public.honoraires_brouillon_supprimer(uuid) from public, anon;
grant execute on function public.honoraires_brouillon_supprimer(uuid) to authenticated;

-- --- 10. Émettre : numéroter, figer, journaliser ------------------------------------------
-- Le numéro suit H-AAAA-NNNN, continu par cabinet et par année. Le verrou
-- consultatif sérialise deux émissions concurrentes du même cabinet.
create or replace function app.honoraires_numero_suivant(p_cabinet uuid, p_date date)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_annee  text := to_char(p_date, 'YYYY');
  v_prefixe text := 'H-' || v_annee || '-';
  v_n      integer;
begin
  perform pg_advisory_xact_lock(hashtext(p_cabinet::text || ':' || v_annee));
  select coalesce(max(substr(numero, length(v_prefixe) + 1)::integer), 0) + 1
    into v_n
    from collab.factures_honoraires
   where tenant_id = p_cabinet and numero like v_prefixe || '%';
  return v_prefixe || lpad(v_n::text, 4, '0');
end;
$$;
revoke all on function app.honoraires_numero_suivant(uuid, date) from public, anon, authenticated;

create or replace function public.honoraires_facture_emettre(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  f        record;
  v_delai  integer;
  v_numero text;
  v_jour   date := current_date;
begin
  select * into f from collab.factures_honoraires where id = p_id;
  if f.id is null or f.tenant_id not in (select app.member_orgs()) then
    raise exception 'facture introuvable ou non autorisée' using errcode = 'P0002';
  end if;
  if f.statut <> 'brouillon' then
    raise exception 'cette facture est déjà émise' using errcode = '22023';
  end if;
  if not exists (select 1 from collab.factures_honoraires_lignes where facture_id = p_id) then
    raise exception 'une facture sans ligne ne s''émet pas' using errcode = '22023';
  end if;
  if f.total_ht <= 0 then
    raise exception 'le total hors taxes doit être positif pour émettre' using errcode = '22023';
  end if;

  -- Le délai : celui du mandat, ou à défaut aucun — l'échéance est le jour même.
  select delai_paiement_jours into v_delai
    from collab.mandats_honoraires where id = f.mandat_id;
  if v_delai is null then
    select delai_paiement_jours into v_delai
      from collab.mandats_honoraires
     where tenant_id = f.tenant_id and client_tenant_id = f.client_tenant_id and valid_to is null;
  end if;

  v_numero := app.honoraires_numero_suivant(f.tenant_id, v_jour);

  update collab.factures_honoraires
     set statut = 'emise', numero = v_numero, emise_le = v_jour,
         echeance_le = v_jour + coalesce(v_delai, 0)
   where id = p_id;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (f.tenant_id, auth.uid(), 'honoraires.facture_emise', 'collab', 'factures_honoraires', p_id,
          jsonb_build_object('numero', v_numero, 'client', f.client_tenant_id,
                             'total_ttc', f.total_ttc, 'echeance', v_jour + coalesce(v_delai, 0)));
  return jsonb_build_object('id', p_id, 'numero', v_numero);
end;
$$;
revoke all on function public.honoraires_facture_emettre(uuid) from public, anon;
grant execute on function public.honoraires_facture_emettre(uuid) to authenticated;

-- --- 11. Encaisser -------------------------------------------------------------------------
create or replace function public.honoraires_encaisser(
  p_facture uuid, p_montant numeric, p_date date, p_moyen text, p_reference text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  f       record;
  v_id    uuid;
  v_somme numeric(18,3);
begin
  select * into f from collab.factures_honoraires where id = p_facture;
  if f.id is null or f.tenant_id not in (select app.member_orgs()) then
    raise exception 'facture introuvable ou non autorisée' using errcode = 'P0002';
  end if;
  if f.statut <> 'emise' then
    raise exception 'seule une facture émise et non soldée s''encaisse' using errcode = '22023';
  end if;
  if f.total_ttc <= 0 then
    raise exception 'un avoir ne s''encaisse pas' using errcode = '22023';
  end if;

  insert into collab.encaissements_honoraires (tenant_id, facture_id, montant, encaisse_le, moyen, reference)
  values (f.tenant_id, p_facture, p_montant, p_date, p_moyen, nullif(btrim(p_reference), ''))
  returning id into v_id;

  select coalesce(sum(montant), 0) into v_somme
    from collab.encaissements_honoraires where facture_id = p_facture;

  if v_somme >= f.total_ttc then
    perform set_config('regalica.honoraires_transition', p_facture::text, true);
    update collab.factures_honoraires set statut = 'payee', payee_le = p_date where id = p_facture;
    perform set_config('regalica.honoraires_transition', '', true);
  end if;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (f.tenant_id, auth.uid(), 'honoraires.encaissement', 'collab', 'encaissements_honoraires', v_id,
          jsonb_build_object('facture', p_facture, 'numero', f.numero, 'montant', p_montant,
                             'date', p_date, 'moyen', p_moyen, 'soldee', v_somme >= f.total_ttc));
  return jsonb_build_object('id', v_id, 'encaisse', v_somme, 'soldee', v_somme >= f.total_ttc);
end;
$$;
revoke all on function public.honoraires_encaisser(uuid, numeric, date, text, text) from public, anon;
grant execute on function public.honoraires_encaisser(uuid, numeric, date, text, text) to authenticated;

-- --- 12. L'avoir : la seule correction d'une facture émise ---------------------------------
-- L'avoir reprend chaque ligne en négatif, les mêmes droits en négatif, prend
-- son propre numéro, et la facture d'origine passe « annulée ».
create or replace function public.honoraires_avoir(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  f        record;
  v_avoir  uuid;
  v_numero text;
  v_jour   date := current_date;
begin
  select * into f from collab.factures_honoraires where id = p_id;
  if f.id is null or f.tenant_id not in (select app.member_orgs()) then
    raise exception 'facture introuvable ou non autorisée' using errcode = 'P0002';
  end if;
  if f.statut not in ('emise', 'payee') then
    raise exception 'seule une facture émise s''annule par un avoir' using errcode = '22023';
  end if;
  if f.avoir_de is not null then
    raise exception 'un avoir ne s''annule pas' using errcode = '22023';
  end if;

  insert into collab.factures_honoraires
    (tenant_id, client_tenant_id, mandat_id, periode_du, periode_au, pack_version_id,
     taux_tva_code, taux_tva, devise, droits_fixes, droits_libelle, avoir_de)
  values (f.tenant_id, f.client_tenant_id, f.mandat_id, f.periode_du, f.periode_au, f.pack_version_id,
          f.taux_tva_code, f.taux_tva, f.devise, -f.droits_fixes, f.droits_libelle, p_id)
  returning id into v_avoir;

  insert into collab.factures_honoraires_lignes (tenant_id, facture_id, ordre, libelle, quantite, prix_unitaire)
  select tenant_id, v_avoir, ordre, libelle, -quantite, prix_unitaire
    from collab.factures_honoraires_lignes where facture_id = p_id order by ordre;

  v_numero := app.honoraires_numero_suivant(f.tenant_id, v_jour);
  update collab.factures_honoraires
     set statut = 'emise', numero = v_numero, emise_le = v_jour, echeance_le = v_jour
   where id = v_avoir;

  perform set_config('regalica.honoraires_transition', p_id::text, true);
  update collab.factures_honoraires set statut = 'annulee', annulee_le = v_jour where id = p_id;
  perform set_config('regalica.honoraires_transition', '', true);

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (f.tenant_id, auth.uid(), 'honoraires.avoir', 'collab', 'factures_honoraires', v_avoir,
          jsonb_build_object('annule', p_id, 'numero_annule', f.numero, 'numero', v_numero));
  return jsonb_build_object('id', v_avoir, 'numero', v_numero);
end;
$$;
revoke all on function public.honoraires_avoir(uuid) from public, anon;
grant execute on function public.honoraires_avoir(uuid) to authenticated;

-- --- 13. La synthèse d'un mois -------------------------------------------------------------
-- Facturé (émis dans le mois, avoirs compris), encaissé (dans le mois), reste dû
-- et retards (toutes factures émises non soldées ; en retard au-delà de leur
-- échéance), taux d'encaissement du mois. Tout est sommé ici, en numeric.
create or replace function public.honoraires_synthese_lire(p_cabinet uuid, p_mois text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_du date;
  v_au date;
  v    jsonb;
begin
  if p_cabinet not in (select app.member_orgs()) then
    raise exception 'cabinet introuvable ou non autorise' using errcode = '42501';
  end if;
  v_du := to_date(p_mois || '-01', 'YYYY-MM-DD');
  v_au := (v_du + interval '1 month')::date;

  with emises as (
    select f.*, coalesce((select sum(e.montant) from collab.encaissements_honoraires e
                           where e.facture_id = f.id), 0) as encaisse
      from collab.factures_honoraires f
     where f.tenant_id = p_cabinet and f.statut <> 'brouillon'
  ),
  du_mois as (
    select coalesce(sum(total_ht), 0) as ht, coalesce(sum(total_ttc), 0) as ttc, count(*) as n
      from emises where emise_le >= v_du and emise_le < v_au
  ),
  encaisse as (
    select coalesce(sum(e.montant), 0) as montant, count(*) as n
      from collab.encaissements_honoraires e
     where e.tenant_id = p_cabinet and e.encaisse_le >= v_du and e.encaisse_le < v_au
  ),
  ouvertes as (
    select coalesce(sum(total_ttc - encaisse), 0) as reste, count(*) as n,
           coalesce(sum(total_ttc - encaisse) filter (where echeance_le < current_date), 0) as retard,
           count(*) filter (where echeance_le < current_date) as n_retard
      from emises where statut = 'emise' and total_ttc > 0
  ),
  brouillons as (
    select count(*) as n from collab.factures_honoraires
     where tenant_id = p_cabinet and statut = 'brouillon'
  )
  select jsonb_build_object(
           'mois', p_mois,
           'devise', (select currency from identity.organizations where id = p_cabinet),
           -- Les montants voyagent en texte : un nombre JSON deviendrait un flottant.
           'factureHt', du_mois.ht::text,
           'factureTtc', du_mois.ttc::text,
           'nbFactures', du_mois.n,
           'encaisse', encaisse.montant::text,
           'nbEncaissements', encaisse.n,
           'resteDu', ouvertes.reste::text,
           'nbOuvertes', ouvertes.n,
           'enRetard', ouvertes.retard::text,
           'nbRetard', ouvertes.n_retard,
           'tauxEncaissement', case when du_mois.ttc > 0
                                    then round(encaisse.montant / du_mois.ttc, 4)::text end,
           'nbBrouillons', brouillons.n)
    into v
    from du_mois, encaisse, ouvertes, brouillons;
  return v;
end;
$$;
revoke all on function public.honoraires_synthese_lire(uuid, text) from public, anon;
grant execute on function public.honoraires_synthese_lire(uuid, text) to authenticated;
