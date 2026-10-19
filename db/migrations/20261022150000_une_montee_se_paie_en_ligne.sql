-- Une montée d'offre — et une recharge — se paient en ligne (décidé le 19
-- octobre 2026).
--
--   * la nouvelle offre s'ouvre TOUT DE SUITE ; le paiement suit ;
--   * à la montée, le client paie la DIFFÉRENCE DU MOIS : l'écart de prix
--     entre l'offre quittée et l'offre prise, au prorata des jours qui restent,
--     TVA comprise ;
--   * une recharge achetée se paie de même, son prix TVA comprise ;
--   * aucun timbre sur ces paiements : le timbre est celui de la FACTURE du
--     mois, et il n'y en a qu'un. Le paiement en ligne est un ACOMPTE : à
--     l'émission de la facture, il s'y impute comme encaissement par carte.
--
-- La base calcule le montant (R3, R4 : la TVA vient du pack de l'émetteur)
-- et tient le registre ; le prestataire (ClicToPay, un autre demain, ou le
-- simulateur du staging) est choisi par l'API, qui ne fait que transmettre.
-- Rien ne se réécrit : un paiement naît, puis des événements s'y ajoutent —
-- le lien créé, le paiement constaté, le refus. L'état se déduit (R7, comme
-- `facturation.encours_v`).

-- --- 1. La fiscalité en vigueur, lue une fois --------------------------------

create or replace function facturation.fiscalite_en_vigueur(p_le date default current_date)
returns table (taux numeric, timbre numeric, devise text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_emetteur record;
  v_pack     uuid;
begin
  select o.currency, o.jurisdiction into v_emetteur
    from facturation.emetteurs e
    join identity.organizations o on o.id = e.organisation_id
   where e.valide_des <= p_le
   order by e.valide_des desc limit 1;
  if not found then
    raise exception 'aucun emetteur designe (facturation.emetteurs)' using errcode = 'no_data_found';
  end if;

  select p.id into v_pack
    from ref.jurisdiction_packs p
   where p.jurisdiction = v_emetteur.jurisdiction
     and p.effective_from <= p_le
     and (p.effective_to is null or p.effective_to >= p_le)
   order by p.effective_from desc limit 1;

  select r.rate into taux
    from ref.tva_rates r
   where r.pack_version_id = v_pack and r.code = 'TVA19'
     and r.valid_from <= p_le and (r.valid_to is null or r.valid_to >= p_le)
   order by r.valid_from desc limit 1;

  select coalesce(sp.value_num, sp.value_text::numeric) into timbre
    from ref.socle_params sp
   where sp.pack_version_id = v_pack and sp.code = 'facture.droit_de_timbre'
     and sp.valid_from <= p_le and (sp.valid_to is null or sp.valid_to >= p_le)
   order by sp.valid_from desc limit 1;

  -- Pas de repli (R4) : un montant calculé sous un taux supposé serait faux.
  if taux is null then
    raise exception 'aucun taux de TVA en vigueur (ref.tva_rates, code TVA19)'
      using errcode = 'no_data_found';
  end if;
  devise := v_emetteur.currency;
  return next;
end
$$;

revoke all on function facturation.fiscalite_en_vigueur(date) from public, anon, authenticated;

-- --- 2. Le registre des paiements en ligne -----------------------------------

create table facturation.paiements_en_ligne (
  id           uuid primary key default gen_random_uuid(),
  licence_id   uuid not null references facturation.licences (id),
  objet        text not null check (objet in ('montee', 'recharge')),
  forfait_id   uuid unique references facturation.forfait_historique (id),
  recharge_id  uuid unique references facturation.recharges (id),
  libelle      text not null,
  montant_ht   app.money_t not null check (montant_ht > 0),
  taux_tva     numeric(8,6) not null check (taux_tva >= 0),
  montant_tva  app.money_t not null check (montant_tva >= 0),
  montant_ttc  app.money_t not null,
  devise       text not null,
  cree_par     uuid not null,
  cree_le      timestamptz not null default now(),
  constraint paiements_ttc_coherent check (montant_ttc = montant_ht + montant_tva),
  constraint paiements_objet_designe check (
    (objet = 'montee' and forfait_id is not null and recharge_id is null)
    or (objet = 'recharge' and recharge_id is not null and forfait_id is null))
);

create index paiements_en_ligne_licence_idx on facturation.paiements_en_ligne (licence_id, cree_le desc);

create table facturation.paiement_evenements (
  id            uuid primary key default gen_random_uuid(),
  paiement_id   uuid not null references facturation.paiements_en_ligne (id),
  etat          text not null check (etat in ('lien_cree', 'paye', 'refuse')),
  prestataire   text not null check (prestataire in ('simulateur', 'clictopay')),
  reference     text,
  lien          text,
  detail        jsonb not null default '{}'::jsonb,
  le            timestamptz not null default now()
);

-- Payé une fois, jamais deux : c'est la base qui le tient, pas l'API.
create unique index paiement_paye_une_fois on facturation.paiement_evenements (paiement_id)
  where etat = 'paye';
create index paiement_evenements_idx on facturation.paiement_evenements (paiement_id, le desc);

-- L'imputation d'un paiement sur la facture du mois : le lien, à part.
create table facturation.paiement_imputations (
  paiement_id     uuid primary key references facturation.paiements_en_ligne (id),
  encaissement_id uuid not null unique references facturation.encaissements (id),
  le              timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['paiements_en_ligne', 'paiement_evenements', 'paiement_imputations'] loop
    execute format('alter table facturation.%I enable row level security', t);
    execute format('revoke all on table facturation.%I from public, anon', t);
    execute format('grant select on table facturation.%I to authenticated', t);
    execute format(
      'create trigger %I before update or delete on facturation.%I
         for each row execute function app.deny_mutation()', t || '_ne_se_reecrit_pas', t);
  end loop;
end $$;

create policy paiements_en_ligne_lire on facturation.paiements_en_ligne
  for select to authenticated
  using ((select app.is_platform())
         or licence_id in (select l.id from facturation.licences l
                            where l.titulaire = (select auth.uid())));

create policy paiement_evenements_lire on facturation.paiement_evenements
  for select to authenticated
  using (paiement_id in (select p.id from facturation.paiements_en_ligne p));

create policy paiement_imputations_lire on facturation.paiement_imputations
  for select to authenticated
  using (paiement_id in (select p.id from facturation.paiements_en_ligne p));

-- L'état se déduit : payé l'emporte, puis le dernier événement, sinon « à payer ».
create or replace view facturation.paiements_en_ligne_v with (security_invoker = true) as
select
  p.id as paiement_id, p.licence_id, p.objet, p.libelle,
  p.montant_ht, p.montant_tva, p.montant_ttc, p.devise, p.cree_le,
  case
    when exists (select 1 from facturation.paiement_evenements e
                  where e.paiement_id = p.id and e.etat = 'paye') then 'paye'
    else coalesce(d.etat, 'a_payer')
  end as etat,
  d.prestataire, d.reference, d.lien,
  exists (select 1 from facturation.paiement_imputations i where i.paiement_id = p.id) as impute
from facturation.paiements_en_ligne p
left join lateral (
  select e.etat, e.prestataire, e.reference, e.lien
    from facturation.paiement_evenements e
   where e.paiement_id = p.id
   order by e.le desc, e.id desc limit 1
) d on true;

grant select on facturation.paiements_en_ligne_v to authenticated;

-- --- 3. Ce qu'on paie : la différence du mois, ou la recharge ---------------

-- La porte du titulaire, nommée : il dirige une société de la licence, et il
-- en est le propriétaire principal.
create or replace function facturation.titulaire_de(p_licence uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from facturation.licences l
      join facturation.licence_organisations lo on lo.licence_id = l.id
     where l.id = p_licence and l.titulaire = auth.uid()
       and app.has_org_role(lo.tenant_id, array['dirigeant']))
$$;

revoke all on function facturation.titulaire_de(uuid) from public, anon, authenticated;

create or replace function public.paiement_montee_preparer(p_tenant uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_licence  uuid;
  v_cour     record;
  v_prec     record;
  v_neuf     numeric;
  v_ancien   numeric;
  v_jours    int;
  v_restants int;
  v_ht       numeric;
  f          record;
  v_id       uuid;
begin
  select l.id into v_licence
    from facturation.licences l
    join facturation.licence_organisations lo on lo.licence_id = l.id
   where l.titulaire = auth.uid() and (p_tenant is null or lo.tenant_id = p_tenant)
   order by l.id limit 1;
  -- La porte, nommée (`schema.test.ts`) : dirigeant d'une société de la
  -- licence, ET son propriétaire principal.
  if v_licence is null
     or not exists (select 1 from facturation.licence_organisations lo
                     where lo.licence_id = v_licence
                       and app.has_org_role(lo.tenant_id, array['dirigeant']))
     or not facturation.titulaire_de(v_licence) then
    raise exception 'seul le proprietaire principal paie l''abonnement' using errcode = '42501';
  end if;

  select h.id, h.offre_code, h.offre_depuis, h.effet_du, h.motif into v_cour
    from facturation.forfait_courant_v h where h.licence_id = v_licence;
  if v_cour.motif is distinct from 'montee' then
    return null;   -- rien à payer maintenant : pas de montée en cours.
  end if;

  -- Déjà préparé : on le rend tel quel.
  select p.id into v_id from facturation.paiements_en_ligne p where p.forfait_id = v_cour.id;
  if v_id is not null then
    return (select to_jsonb(v) from facturation.paiements_en_ligne_v v where v.paiement_id = v_id);
  end if;

  select h.offre_code, h.offre_depuis into v_prec
    from facturation.forfait_historique h
   where h.licence_id = v_licence and h.effet_au = v_cour.effet_du and h.id <> v_cour.id
   order by h.created_at desc, h.id desc limit 1;
  if v_prec.offre_code is null then
    return null;
  end if;

  v_neuf   := (ref.offre_a(v_cour.offre_code, v_cour.offre_depuis)).prix_mensuel_ht;
  v_ancien := (ref.offre_a(v_prec.offre_code, v_prec.offre_depuis)).prix_mensuel_ht;
  v_jours  := extract(day from (date_trunc('month', v_cour.effet_du) + interval '1 month'
                                - interval '1 day'))::int;
  v_restants := v_jours - extract(day from v_cour.effet_du)::int + 1;
  v_ht := round((v_neuf - v_ancien) * v_restants / v_jours, 3);
  if v_ht <= 0 then
    return null;
  end if;

  -- Sans émetteur désigné, ALGORIA ne facture pas encore : rien ne se prépare,
  -- et on ne suppose aucune TVA (R4). L'offre reste ouverte ; la tour désigne
  -- l'émetteur, et le paiement suivra la facture.
  if not exists (select 1 from facturation.emetteurs e where e.valide_des <= v_cour.effet_du) then
    return null;
  end if;

  select * into f from facturation.fiscalite_en_vigueur(v_cour.effet_du);

  insert into facturation.paiements_en_ligne
    (licence_id, objet, forfait_id, libelle, montant_ht, taux_tva, montant_tva, montant_ttc,
     devise, cree_par)
  values
    (v_licence, 'montee', v_cour.id,
     'Passage ' || initcap(v_prec.offre_code) || ' -> ' || initcap(v_cour.offre_code)
       || ' — ' || v_restants || '/' || v_jours || ' jours',
     v_ht, f.taux, round(v_ht * f.taux, 3), v_ht + round(v_ht * f.taux, 3), f.devise, auth.uid())
  returning id into v_id;

  return (select to_jsonb(v) from facturation.paiements_en_ligne_v v where v.paiement_id = v_id);
end
$$;

revoke all on function public.paiement_montee_preparer(uuid) from public, anon;
grant execute on function public.paiement_montee_preparer(uuid) to authenticated;

create or replace function public.paiement_recharge_preparer(p_recharge uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r    record;
  f    record;
  v_id uuid;
begin
  select x.* into r from facturation.recharges x where x.id = p_recharge;
  if r.id is null
     or not exists (select 1 from facturation.licence_organisations lo
                     where lo.licence_id = r.licence_id
                       and app.has_org_role(lo.tenant_id, array['dirigeant']))
     or not facturation.titulaire_de(r.licence_id) then
    raise exception 'seul le proprietaire principal paie une recharge' using errcode = '42501';
  end if;
  if r.prix_ht <= 0 then
    return null;   -- offerte par la plateforme : rien à payer.
  end if;
  if not exists (select 1 from facturation.emetteurs e where e.valide_des <= r.achetee_le) then
    return null;   -- pas encore d'émetteur : la facture du mois portera la recharge.
  end if;

  select p.id into v_id from facturation.paiements_en_ligne p where p.recharge_id = r.id;
  if v_id is null then
    select * into f from facturation.fiscalite_en_vigueur(r.achetee_le);
    insert into facturation.paiements_en_ligne
      (licence_id, objet, recharge_id, libelle, montant_ht, taux_tva, montant_tva, montant_ttc,
       devise, cree_par)
    values
      (r.licence_id, 'recharge', r.id, 'Recharge ' || r.lectures || ' lectures',
       r.prix_ht, f.taux, round(r.prix_ht * f.taux, 3), r.prix_ht + round(r.prix_ht * f.taux, 3),
       f.devise, auth.uid())
    returning id into v_id;
  end if;

  return (select to_jsonb(v) from facturation.paiements_en_ligne_v v where v.paiement_id = v_id);
end
$$;

revoke all on function public.paiement_recharge_preparer(uuid) from public, anon;
grant execute on function public.paiement_recharge_preparer(uuid) to authenticated;

-- --- 4. Ce que le prestataire a dit ------------------------------------------
--
-- L'API transmet ; la base inscrit. Le simulateur n'est admis que si l'API l'a
-- déclaré pour la transaction (`malica.paiement_simulateur = oui`), ce qu'elle
-- ne fait qu'en staging : en production, un « payé » du simulateur est refusé
-- par la base elle-même.

create or replace function public.paiement_inscrire(
  p_paiement uuid, p_etat text, p_prestataire text,
  p_reference text default null, p_lien text default null, p_detail jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_licence uuid;
begin
  select p.licence_id into v_licence from facturation.paiements_en_ligne p where p.id = p_paiement;
  if v_licence is null
     or not exists (select 1 from facturation.licence_organisations lo
                     where lo.licence_id = v_licence
                       and app.has_org_role(lo.tenant_id, array['dirigeant']))
     or not facturation.titulaire_de(v_licence) then
    raise exception 'paiement introuvable' using errcode = '42501';
  end if;
  if p_prestataire = 'simulateur'
     and coalesce(current_setting('malica.paiement_simulateur', true), '') <> 'oui' then
    raise exception 'le simulateur de paiement n''est pas ouvert ici' using errcode = '42501';
  end if;
  if p_etat = 'paye' and exists (select 1 from facturation.paiement_evenements e
                                  where e.paiement_id = p_paiement and e.etat = 'paye') then
    -- Déjà constaté : on ne le compte pas deux fois, on le rend.
    return (select to_jsonb(v) from facturation.paiements_en_ligne_v v where v.paiement_id = p_paiement);
  end if;

  insert into facturation.paiement_evenements
    (paiement_id, etat, prestataire, reference, lien, detail)
  values (p_paiement, p_etat, p_prestataire, p_reference, p_lien, coalesce(p_detail, '{}'::jsonb));

  if p_etat = 'paye' then
    insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
    select lo.tenant_id, auth.uid(), 'paiement.recu', 'facturation', 'paiements_en_ligne', p_paiement,
           jsonb_build_object('prestataire', p_prestataire, 'reference', p_reference)
      from facturation.licence_organisations lo
     where lo.licence_id = v_licence
     order by lo.tenant_id limit 1;
  end if;

  return (select to_jsonb(v) from facturation.paiements_en_ligne_v v where v.paiement_id = p_paiement);
end
$$;

revoke all on function public.paiement_inscrire(uuid, text, text, text, text, jsonb) from public, anon;
grant execute on function public.paiement_inscrire(uuid, text, text, text, text, jsonb) to authenticated;
-- --- 5. La facture du mois impute les acomptes ---------------------------------
--
-- Corps vivant de `facturation.emettre` (dernière définition : 20261022120000),
-- plus l'imputation des paiements en ligne reçus, sur la facture du titulaire.
CREATE OR REPLACE FUNCTION facturation.emettre(p_licence uuid, p_periode date, p_jours_echeance integer DEFAULT 15)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c          record;
  v_emetteur record;
  v_pack     uuid;
  v_taux     numeric(8,6);
  v_timbre   app.money_t;
  v_sieges   smallint;
  l          record;
  v_tva      app.money_t;
  v_nom      text;
  v_legal    text;
  v_numero   text;
  v_id       uuid;
  v_faites   jsonb := '[]'::jsonb;
  v_premiere uuid;
  v_premier  text;
  v_ttc      app.money_t := 0;
  v_ht       app.money_t;
  v_recharge record;
  v_ordinal  smallint;
  v_paiement record;
  v_enc      uuid;
begin
  if not app.is_platform() then
    raise exception 'reserve aux operateurs de la plateforme' using errcode = '42501';
  end if;
  if extract(day from p_periode) <> 1 then
    raise exception 'une periode est un premier du mois' using errcode = 'check_violation';
  end if;

  select * into c from facturation.consommation_v where licence_id = p_licence;
  if c.licence_id is null then
    raise exception 'licence introuvable' using errcode = 'no_data_found';
  end if;

  -- R4 : l'émetteur est une donnée, pas une hypothèse. Sa devise est celle de
  -- la facture ; sa juridiction désigne le pack dont on lit le taux et le
  -- timbre.
  select o.currency, o.jurisdiction into v_emetteur
    from facturation.emetteurs e
    join identity.organizations o on o.id = e.organisation_id
   where e.valide_des <= current_date
   order by e.valide_des desc limit 1;
  if not found then
    raise exception 'aucun emetteur designe (facturation.emetteurs)'
      using errcode = 'no_data_found';
  end if;

  select p.id into v_pack
    from ref.jurisdiction_packs p
   where p.jurisdiction = v_emetteur.jurisdiction
     and p.effective_from <= current_date
     and (p.effective_to is null or p.effective_to >= current_date)
   order by p.effective_from desc limit 1;
  if v_pack is null then
    raise exception 'aucun pack de juridiction en vigueur pour l''emetteur (ref.jurisdiction_packs)'
      using errcode = 'no_data_found';
  end if;

  select r.rate into v_taux
    from ref.tva_rates r
   where r.pack_version_id = v_pack
     and r.code = 'TVA19'
     and r.valid_from <= current_date
     and (r.valid_to is null or r.valid_to >= current_date)
   order by r.valid_from desc limit 1;

  select coalesce(sp.value_num, sp.value_text::numeric) into v_timbre
    from ref.socle_params sp
   where sp.pack_version_id = v_pack
     and sp.code = 'facture.droit_de_timbre'
     and sp.valid_from <= current_date
     and (sp.valid_to is null or sp.valid_to >= current_date)
   order by sp.valid_from desc limit 1;

  -- Pas de valeur de repli. R4 jusqu'au bout : une facture émise sous un taux
  -- supposé serait fausse sans que personne ne le voie.
  if v_taux is null then
    raise exception 'aucun taux de TVA en vigueur (ref.tva_rates, code TVA19)'
      using errcode = 'no_data_found';
  end if;
  if v_timbre is null then
    raise exception
      'aucun droit de timbre en vigueur (ref.socle_params, code facture.droit_de_timbre)'
      using errcode = 'no_data_found';
  end if;

  v_sieges := greatest(0, c.sieges_occupes - c.sieges_inclus)::smallint;

  -- Une ligne par payeur. `order by payeur_type` fixe l'ordre — `cabinet`
  -- avant `titulaire` — pour que `facture_id` désigne toujours la même facture
  -- d'une exécution à l'autre.
  for l in
    select * from facturation.a_facturer(p_licence, p_periode)
     order by payeur_type
  loop
    if l.payeur_type = 'cabinet' then
      select o.name, o.legal_id into v_nom, v_legal
        from identity.organizations o where o.id = l.payeur_tenant_id;
    else
      select p.display_name, null::text into v_nom, v_legal
        from identity.profiles p where p.user_id = l.payeur_personne;
    end if;

    -- Pas de repli (R4) : une facture sans destinataire nommé n'est pas une
    -- facture. On refuse, et on dit où le nom manque.
    if v_nom is null or length(btrim(v_nom)) = 0 then
      raise exception
        'le destinataire % n''a pas de nom (identity.organizations.name ou identity.profiles.display_name)',
        coalesce(l.payeur_tenant_id, l.payeur_personne)
        using errcode = 'no_data_found';
    end if;

    -- Les recharges vont sur la facture du titulaire : celles achetées jusqu'à
    -- la fin de la période et pas encore facturées (20261022120000).
    v_ht := l.montant_ht;
    if l.payeur_type = 'titulaire' then
      select (l.montant_ht + coalesce(sum(x.prix_ht), 0))::app.money_t into v_ht
        from facturation.recharges x
       where x.licence_id = p_licence
         and x.achetee_le < (p_periode + interval '1 month')::date
         and not exists (select 1 from facturation.facture_recharges fr where fr.recharge_id = x.id);
    end if;

    v_tva    := round(v_ht * v_taux, 3);
    v_numero := 'ALG-' || to_char(p_periode, 'YYYYMM') || '-'
                || lpad(nextval('facturation.numero_facture_seq')::text, 5, '0');

    insert into facturation.factures
      (licence_id, numero, periode, emise_le, echeance_le, offre_code,
       organisations, sieges_payants, montant_ht, taux_tva, montant_tva,
       timbre, montant_ttc, devise,
       payeur_type, payeur_tenant_id, payeur_personne,
       destinataire_nom, destinataire_legal_id, reference_abonne)
    values
      (p_licence, v_numero, p_periode, current_date,
       current_date + p_jours_echeance, l.offre_code,
       c.organisations, v_sieges, v_ht, v_taux, v_tva, v_timbre,
       v_ht + v_tva + v_timbre, v_emetteur.currency,
       l.payeur_type, l.payeur_tenant_id, l.payeur_personne,
       v_nom, v_legal, l.acces_reference)
    returning id into v_id;

    insert into facturation.facture_lignes
      (facture_id, ordinal, libelle, quantite, prix_unitaire, montant_ht)
    values (v_id, 1,
            'Abonnement ' || l.offre_code || ' — '
            || to_char(p_periode, 'TMMonth YYYY')
            || ' (' || l.jours || '/' || l.jours_du_mois || ' jours)',
            1, l.montant_ht, l.montant_ht);

    if l.payeur_type = 'titulaire' then
      v_ordinal := 1;
      for v_recharge in
        select x.id, x.lectures, x.prix_ht, x.achetee_le, x.origine
          from facturation.recharges x
         where x.licence_id = p_licence
           and x.achetee_le < (p_periode + interval '1 month')::date
           and not exists (select 1 from facturation.facture_recharges fr where fr.recharge_id = x.id)
         order by x.achetee_le, x.id
      loop
        v_ordinal := v_ordinal + 1;
        insert into facturation.facture_lignes
          (facture_id, ordinal, libelle, quantite, prix_unitaire, montant_ht)
        values (v_id, v_ordinal,
                'Recharge ' || v_recharge.lectures || ' lectures'
                  || case when v_recharge.origine = 'automatique' then ' (automatique)' else '' end
                  || ' — ' || to_char(v_recharge.achetee_le, 'DD/MM/YYYY'),
                1, v_recharge.prix_ht, v_recharge.prix_ht);
        insert into facturation.facture_recharges (facture_id, recharge_id) values (v_id, v_recharge.id);
      end loop;

      -- Les paiements en ligne déjà reçus (montée, recharge) sont des acomptes :
      -- ils s'imputent ici, une fois, comme encaissements par carte
      -- (20261022150000).
      for v_paiement in
        select p.id, p.montant_ttc, e.reference, e.prestataire, e.le::date as le
          from facturation.paiements_en_ligne p
          join facturation.paiement_evenements e on e.paiement_id = p.id and e.etat = 'paye'
         where p.licence_id = p_licence
           and not exists (select 1 from facturation.paiement_imputations i where i.paiement_id = p.id)
         order by e.le, p.id
      loop
        insert into facturation.encaissements (facture_id, montant, moyen, reference, encaisse_le)
        values (v_id, v_paiement.montant_ttc, 'carte',
                v_paiement.prestataire || ' ' || coalesce(v_paiement.reference, v_paiement.id::text),
                v_paiement.le)
        returning id into v_enc;
        insert into facturation.paiement_imputations (paiement_id, encaissement_id)
        values (v_paiement.id, v_enc);
      end loop;
    end if;

    if v_premiere is null then
      v_premiere := v_id;
      v_premier  := v_numero;
    end if;
    v_ttc    := v_ttc + v_ht + v_tva + v_timbre;
    v_faites := v_faites || jsonb_build_object(
                  'facture_id', v_id, 'numero', v_numero,
                  'payeur_type', l.payeur_type,
                  'payeur', coalesce(l.payeur_tenant_id, l.payeur_personne),
                  'destinataire', v_nom,
                  'offre_code', l.offre_code,
                  'jours', l.jours, 'jours_du_mois', l.jours_du_mois,
                  'ht', v_ht,
                  'ttc', v_ht + v_tva + v_timbre);
  end loop;

  if jsonb_array_length(v_faites) = 0 then
    raise exception
      'rien a facturer sur cette licence pour % : aucun payeur sur la periode (facturation.a_facturer)',
      p_periode
      using errcode = 'no_data_found';
  end if;

  return jsonb_build_object(
    'facture_id', v_premiere, 'numero', v_premier, 'ttc', v_ttc,
    'factures', v_faites);
end
$function$;
