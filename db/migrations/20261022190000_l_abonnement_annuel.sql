-- L'abonnement annuel : douze mois, dont deux offerts (décidé le 19 octobre
-- 2026, réglable par la tour).
--
-- =============================================================== LA RÈGLE
--
-- Le propriétaire principal d'une licence payée EN DIRECT passe à l'année :
--
--   — l'engagement commence le PREMIER DU MOIS SUIVANT et dure douze mois. Le
--     mois en cours reste facturé au mois, à terme échu, comme il l'a
--     toujours été : aucun jour n'est payé deux fois, aucun n'est oublié ;
--   — il paie (12 − mois offerts) × le prix MENSUEL DE L'OFFRE, à la
--     souscription, en ligne. Les places et les sociétés en plus ne sont pas
--     dans l'année : elles restent facturées au mois, au prorata, comme avant ;
--   — les lectures ne changent pas : le droit reste mensuel, le report aussi ;
--   — pendant l'engagement, l'offre ne change pas. Une montée en cours d'année
--     poserait un prorata d'engagement que personne n'a décidé ; la tour
--     intervient si un client le demande.
--
-- Une licence dont un cabinet paie une part n'y a pas accès : l'année se
-- vend au client qui paie seul (le cabinet a ses propres conditions).
--
-- =============================================================== LA FACTURE
--
-- `facturation.emettre` apprend deux choses, et rien d'autre :
--
--   — le mois où l'engagement commence, la facture du titulaire porte UNE
--     ligne « Abonnement annuel », une seule fois (`facture_annuels`) ;
--   — chaque mois couvert, la part de l'offre ne se facture plus au mois :
--     il ne reste que les places et sociétés en plus, et les recharges. Un
--     mois couvert sans rien d'autre ne produit AUCUNE facture — une facture à
--     zéro qui ne porterait qu'un timbre serait un impôt sans opération.
--
-- Le paiement en ligne de l'année est un acompte, imputé sur la facture qui
-- porte la ligne, comme une montée (20261022150000).
--
-- REJEU (R11) : tables créées une fois, fonctions en `create or replace`.

begin;

-- --- 1. L'engagement --------------------------------------------------------

create table facturation.engagements_annuels (
  id               uuid primary key default gen_random_uuid(),
  licence_id       uuid not null references facturation.licences (id),
  offre_code       text not null,
  du               date not null check (extract(day from du) = 1),
  au               date not null,
  prix_mensuel_ht  app.money_t not null check (prix_mensuel_ht > 0),
  mois_offerts     smallint not null check (mois_offerts between 0 and 11),
  montant_ht       app.money_t not null,
  souscrit_par     uuid not null,
  souscrit_le      timestamptz not null default now(),
  constraint engagements_douze_mois check (au = (du + interval '12 months - 1 day')::date),
  constraint engagements_montant check (montant_ht = prix_mensuel_ht * (12 - mois_offerts))
);

create index engagements_annuels_licence_idx on facturation.engagements_annuels (licence_id, du desc);

comment on table facturation.engagements_annuels is
  'Les engagements à l''année d''une licence : douze mois à partir d''un premier '
  'du mois, payés (12 − offerts) × le prix de l''offre. Rien ne se réécrit.';

alter table facturation.engagements_annuels enable row level security;
revoke all on table facturation.engagements_annuels from public, anon;
grant select on table facturation.engagements_annuels to authenticated;

create policy engagements_annuels_lire on facturation.engagements_annuels
  for select to authenticated using (
    (select app.is_platform())
    or licence_id in (select l.id from facturation.licences l where l.titulaire = (select auth.uid())));

create trigger engagements_annuels_ne_se_reecrivent_pas
  before update or delete on facturation.engagements_annuels
  for each row execute function app.deny_mutation();

-- L'engagement qui couvre une date, s'il y en a un.
create or replace function facturation.annuel_de(p_licence uuid, p_le date)
returns facturation.engagements_annuels
language sql
stable
security definer
set search_path = ''
as $$
  select e.* from facturation.engagements_annuels e
   where e.licence_id = p_licence and e.du <= p_le and e.au >= p_le
   order by e.du desc limit 1
$$;

revoke all on function facturation.annuel_de(uuid, date) from public, anon, authenticated;

-- --- 2. Le paiement en ligne apprend l'année --------------------------------

alter table facturation.paiements_en_ligne
  add column engagement_id uuid unique references facturation.engagements_annuels (id);

alter table facturation.paiements_en_ligne drop constraint if exists paiements_en_ligne_objet_check;
alter table facturation.paiements_en_ligne drop constraint if exists paiements_objet_designe;
alter table facturation.paiements_en_ligne
  add constraint paiements_en_ligne_objet_check check (objet in ('montee', 'recharge', 'annuel')),
  add constraint paiements_objet_designe check (
    (objet = 'montee' and forfait_id is not null and recharge_id is null and engagement_id is null)
    or (objet = 'recharge' and recharge_id is not null and forfait_id is null and engagement_id is null)
    or (objet = 'annuel' and engagement_id is not null and forfait_id is null and recharge_id is null));

-- --- 3. Ce que l'application lit et propose ---------------------------------

-- Ce que l'année coûterait, ce qui la ferme, ou l'engagement en cours.
create or replace function public.mon_annuel(p_tenant uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_licence  uuid;
  v_regle    jsonb := public.abonnement_reglage();
  v_offerts  smallint := (v_regle ->> 'annuel_mois_offerts')::smallint;
  v_courant  record;
  v_en_cours facturation.engagements_annuels;
  v_du       date := (date_trunc('month', current_date) + interval '1 month')::date;
  v_prix     numeric;
  v_ferme    text;
begin
  if p_tenant is null then
    select l.id into v_licence from facturation.licences l
     where l.titulaire = auth.uid() order by l.id limit 1;
  else
    select l.id into v_licence
      from facturation.licences l
      join facturation.licence_organisations lo on lo.licence_id = l.id
     where lo.tenant_id = p_tenant and l.titulaire = auth.uid();
  end if;
  if v_licence is null then
    return null;   -- seul le propriétaire principal voit l'année : c'est lui qui paie.
  end if;

  -- L'engagement en cours, ou celui qui commencera le mois prochain.
  select e.* into v_en_cours from facturation.engagements_annuels e
   where e.licence_id = v_licence and e.au >= current_date
   order by e.du desc limit 1;
  if v_en_cours.id is not null then
    return jsonb_build_object(
      'en_cours', jsonb_build_object(
        'du', v_en_cours.du, 'au', v_en_cours.au, 'offre', v_en_cours.offre_code,
        'montant_ht', v_en_cours.montant_ht, 'mois_offerts', v_en_cours.mois_offerts));
  end if;

  select h.offre_code, h.offre_depuis into v_courant
    from facturation.forfait_courant_v h where h.licence_id = v_licence;
  select o.prix_mensuel_ht into v_prix from ref.offre_a(v_courant.offre_code, v_courant.offre_depuis) o;

  v_ferme := case
    when not coalesce((v_regle ->> 'annuel_ouvert')::boolean, false) then 'annuel_ferme'
    when v_prix is null or v_prix <= 0 then 'offre_sans_prix'
    when exists (select 1 from facturation.payeurs_v pv
                  where pv.licence_id = v_licence and pv.payeur_type = 'cabinet'
                    and (pv.au_exclu is null or pv.au_exclu > current_date)) then 'paye_par_un_cabinet'
    when exists (select 1 from facturation.licences l
                  where l.id = v_licence and l.statut <> 'active') then 'licence_inactive'
    else null end;

  return jsonb_build_object(
    'en_cours', null,
    'ferme', v_ferme,
    'proposition', case when v_prix is null then null else jsonb_build_object(
      'offre', v_courant.offre_code,
      'du', v_du,
      'au', (v_du + interval '12 months - 1 day')::date,
      'prix_mensuel_ht', v_prix,
      'mois_offerts', v_offerts,
      'montant_ht', v_prix * (12 - v_offerts),
      'ttc', (public.prix_ttc(v_prix * (12 - v_offerts)) ->> 'ttc')::numeric) end);
end
$$;

revoke all on function public.mon_annuel(uuid) from public, anon;
grant execute on function public.mon_annuel(uuid) to authenticated;

-- Souscrire : le propriétaire principal, seul. Rend l'engagement et, s'il y a
-- un émetteur, le paiement en ligne à régler.
create or replace function public.annuel_souscrire(p_tenant uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_etat     jsonb := public.mon_annuel(p_tenant);
  v_licence  uuid;
  v_prop     jsonb;
  v_id       uuid;
  v_pid      uuid;
  f          record;
  v_ht       numeric;
begin
  if p_tenant is null then
    select l.id into v_licence from facturation.licences l
     where l.titulaire = auth.uid() order by l.id limit 1;
  else
    select l.id into v_licence
      from facturation.licences l
      join facturation.licence_organisations lo on lo.licence_id = l.id
     where lo.tenant_id = p_tenant and l.titulaire = auth.uid();
  end if;
  if v_licence is null
     or not facturation.titulaire_de(v_licence)
     or not exists (select 1 from facturation.licence_organisations lo
                     where lo.licence_id = v_licence
                       and app.has_org_role(lo.tenant_id, array['dirigeant'])) then
    raise exception 'seul le proprietaire principal passe a l''annee' using errcode = '42501';
  end if;
  if v_etat -> 'en_cours' <> 'null'::jsonb then
    raise exception 'annuel_refuse:deja_engage' using errcode = 'check_violation';
  end if;
  if v_etat ->> 'ferme' is not null then
    raise exception 'annuel_refuse:%', v_etat ->> 'ferme' using errcode = 'check_violation';
  end if;

  v_prop := v_etat -> 'proposition';
  insert into facturation.engagements_annuels
    (licence_id, offre_code, du, au, prix_mensuel_ht, mois_offerts, montant_ht, souscrit_par)
  values
    (v_licence, v_prop ->> 'offre', (v_prop ->> 'du')::date, (v_prop ->> 'au')::date,
     (v_prop ->> 'prix_mensuel_ht')::numeric, (v_prop ->> 'mois_offerts')::smallint,
     (v_prop ->> 'montant_ht')::numeric, auth.uid())
  returning id into v_id;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  select lo.tenant_id, auth.uid(), 'abonnement.annuel', 'facturation', 'engagements_annuels', v_id, v_prop
    from facturation.licence_organisations lo
   where lo.licence_id = v_licence
   order by lo.tenant_id limit 1;

  -- Le paiement : seulement s'il y a un émetteur (R4) ; sinon la facture du
  -- premier mois portera la ligne, et le paiement suivra la facture.
  if exists (select 1 from facturation.emetteurs e where e.valide_des <= current_date) then
    select * into f from facturation.fiscalite_en_vigueur(current_date);
    v_ht := (v_prop ->> 'montant_ht')::numeric;
    insert into facturation.paiements_en_ligne
      (licence_id, objet, engagement_id, libelle, montant_ht, taux_tva, montant_tva, montant_ttc,
       devise, cree_par)
    values
      (v_licence, 'annuel', v_id,
       'Abonnement annuel ' || initcap(v_prop ->> 'offre') || ' — du '
         || to_char((v_prop ->> 'du')::date, 'DD/MM/YYYY') || ' au '
         || to_char((v_prop ->> 'au')::date, 'DD/MM/YYYY'),
       v_ht, f.taux, round(v_ht * f.taux, 3), v_ht + round(v_ht * f.taux, 3), f.devise, auth.uid())
    returning id into v_pid;
  end if;

  return jsonb_build_object(
    'engagement', v_id,
    'paiement', (select to_jsonb(v) from facturation.paiements_en_ligne_v v where v.paiement_id = v_pid));
end
$$;

revoke all on function public.annuel_souscrire(uuid) from public, anon;
grant execute on function public.annuel_souscrire(uuid) to authenticated;

-- --- 4. Pendant l'année, l'offre ne change pas -------------------------------

create or replace function public.forfait_changer(p_offre text, p_tenant uuid default null, p_le date default current_date)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_licence uuid := facturation.ma_licence(p_tenant);
  v_emp     record;
  v_courant record;
  v_cible   record;
  v_motif   text;
begin
  -- Ajouté le 19 octobre 2026 : un engagement à l'année fige l'offre.
  if exists (select 1 from facturation.engagements_annuels e
              where e.licence_id = v_licence and e.au >= p_le) then
    raise exception 'forfait_refuse:engagement_annuel:{}' using errcode = 'check_violation';
  end if;

  select e.code, e.chiffres into v_emp
    from facturation.empechement_de_forfait(v_licence, p_offre, p_le) e;

  if v_emp.code is not null then
    raise exception 'forfait_refuse:%:%', v_emp.code, v_emp.chiffres
      using errcode = 'check_violation';
  end if;

  select f.id, f.offre_code, f.canal, f.effet_du into v_courant
    from facturation.forfait_courant_v f where f.licence_id = v_licence;

  select o.rang into v_cible
    from ref.offres o
   where o.code = p_offre and o.effective_from <= p_le
   order by o.effective_from desc limit 1;

  select case when v_cible.rang > o.rang then 'montee' else 'descente' end into v_motif
    from ref.offres o
   where o.code = v_courant.offre_code and o.effective_from <= p_le
   order by o.effective_from desc limit 1;

  update facturation.forfait_historique
     set effet_au = p_le
   where licence_id = v_licence and effet_au is null;

  insert into facturation.forfait_historique
    (licence_id, offre_code, offre_depuis, canal, effet_du, motif, decide_par)
  values
    (v_licence, p_offre, p_le, v_courant.canal, p_le, v_motif, auth.uid());

  return true;
end;
$$;

-- La grille, vue de l'application, dit aussi que l'année fige l'offre.
create or replace function public.mes_offres(p_tenant uuid default null, p_le date default current_date)
returns table (
  code text, libelle text, rang smallint, prix_mensuel_ht numeric,
  lectures_par_organisation integer, lectures_incluses integer,
  sieges_inclus smallint, sieges_max smallint,
  organisations_incluses smallint, organisations_max smallint,
  courant boolean, empechement text, chiffres jsonb, prix_ttc numeric)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_licence uuid := facturation.ma_licence(p_tenant);
  v_courant text;
  v_annuel  boolean;
begin
  select f.offre_code into v_courant
    from facturation.forfait_courant_v f where f.licence_id = v_licence;
  select exists (select 1 from facturation.engagements_annuels e
                  where e.licence_id = v_licence and e.au >= p_le) into v_annuel;

  return query
    with grille as (
      select distinct on (o.code) o.*
        from ref.offres o
       where o.effective_from <= p_le
       order by o.code, o.effective_from desc)
    select g.code, g.libelle, g.rang, g.prix_mensuel_ht::numeric,
           g.lectures_par_organisation,
           (g.lectures_par_organisation * g.organisations_incluses)::int,
           g.sieges_inclus, g.sieges_max,
           g.organisations_incluses, g.organisations_max,
           (g.code = v_courant) as courant,
           case when v_annuel and g.code <> v_courant then 'engagement_annuel' else e.code end,
           case when v_annuel and g.code <> v_courant then '{}'::jsonb else e.chiffres end,
           (public.prix_ttc(g.prix_mensuel_ht::numeric, p_le) ->> 'ttc')::numeric
      from grille g
      cross join lateral facturation.empechement_de_forfait(v_licence, g.code, p_le) e
     order by g.rang;
end;
$$;

-- --- 5. La facture apprend l'année ------------------------------------------

create table facturation.facture_annuels (
  facture_id     uuid not null references facturation.factures (id),
  engagement_id  uuid not null unique references facturation.engagements_annuels (id),
  primary key (facture_id, engagement_id)
);

alter table facturation.facture_annuels enable row level security;
revoke all on table facturation.facture_annuels from public, anon;
grant select on table facturation.facture_annuels to authenticated;
create policy facture_annuels_lire on facturation.facture_annuels
  for select to authenticated using ((select app.is_platform()));
create trigger facture_annuels_ne_se_reecrivent_pas
  before update or delete on facturation.facture_annuels
  for each row execute function app.deny_mutation();

-- Corps repris de la base (20261022160000), et trois ajouts seulement, tous
-- dans la branche du titulaire : la part de l'offre d'un mois couvert ne se
-- facture plus, la ligne annuelle se porte le mois où l'année commence, et un
-- mois couvert sans rien d'autre ne produit aucune facture.
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
  v_annuel   facturation.engagements_annuels;
  v_debut    facturation.engagements_annuels;
  v_mois     app.money_t;
  v_couvert  boolean := false;
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

    if v_nom is null or length(btrim(v_nom)) = 0 then
      raise exception
        'le destinataire % n''a pas de nom (identity.organizations.name ou identity.profiles.display_name)',
        coalesce(l.payeur_tenant_id, l.payeur_personne)
        using errcode = 'no_data_found';
    end if;

    -- L'ANNÉE (20261022190000). La part de l'offre d'un mois couvert est
    -- payée par l'engagement : il ne reste au mois que les places et sociétés
    -- en plus. Le mois où l'année commence porte sa ligne, une fois.
    v_mois   := l.montant_ht;
    v_annuel := null;
    v_debut  := null;
    if l.payeur_type = 'titulaire' then
      v_annuel := facturation.annuel_de(p_licence, p_periode);
      if v_annuel.id is not null then
        v_mois := greatest(0, l.montant_ht
                              - round(v_annuel.prix_mensuel_ht * l.jours / l.jours_du_mois, 3))::app.money_t;
      end if;
      select e.* into v_debut from facturation.engagements_annuels e
       where e.licence_id = p_licence and e.du = p_periode
         and not exists (select 1 from facturation.facture_annuels fa where fa.engagement_id = e.id)
       order by e.souscrit_le limit 1;
    end if;

    v_ht := v_mois;
    if l.payeur_type = 'titulaire' then
      select (v_mois + coalesce(v_debut.montant_ht, 0) + coalesce(sum(x.prix_ht), 0))::app.money_t into v_ht
        from facturation.recharges x
       where x.licence_id = p_licence
         and x.achetee_le < (p_periode + interval '1 month')::date
         and not exists (select 1 from facturation.facture_recharges fr where fr.recharge_id = x.id);
    end if;

    -- Un mois couvert par l'année, sans rien d'autre : aucune facture. Une
    -- facture à zéro ne porterait qu'un timbre, sans opération.
    if l.payeur_type = 'titulaire' and v_annuel.id is not null and v_ht = 0 then
      v_couvert := true;
      continue;
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

    v_ordinal := 0;
    if v_annuel.id is null then
      v_ordinal := 1;
      insert into facturation.facture_lignes
        (facture_id, ordinal, libelle, quantite, prix_unitaire, montant_ht)
      values (v_id, 1,
              'Abonnement ' || l.offre_code || ' — '
              || to_char(p_periode, 'TMMonth YYYY')
              || ' (' || l.jours || '/' || l.jours_du_mois || ' jours)',
              1, l.montant_ht, l.montant_ht);
    elsif v_mois > 0 then
      v_ordinal := 1;
      insert into facturation.facture_lignes
        (facture_id, ordinal, libelle, quantite, prix_unitaire, montant_ht)
      values (v_id, 1,
              'Places et sociétés en plus — ' || to_char(p_periode, 'TMMonth YYYY')
              || ' (l''offre est couverte par l''abonnement annuel)',
              1, v_mois, v_mois);
    end if;

    if v_debut.id is not null then
      v_ordinal := v_ordinal + 1;
      insert into facturation.facture_lignes
        (facture_id, ordinal, libelle, quantite, prix_unitaire, montant_ht)
      values (v_id, v_ordinal,
              'Abonnement annuel ' || v_debut.offre_code || ' — du '
              || to_char(v_debut.du, 'DD/MM/YYYY') || ' au ' || to_char(v_debut.au, 'DD/MM/YYYY')
              || ' (12 mois, ' || v_debut.mois_offerts || ' offerts)',
              1, v_debut.montant_ht, v_debut.montant_ht);
      insert into facturation.facture_annuels (facture_id, engagement_id) values (v_id, v_debut.id);
    end if;

    if l.payeur_type = 'titulaire' then
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

      for v_paiement in
        select p.id, p.montant_ttc, e.reference, e.prestataire, e.le::date as le
          from facturation.paiements_en_ligne p
          join facturation.paiement_evenements e on e.paiement_id = p.id and e.etat = 'paye'
                                              and e.prestataire <> 'simulateur'
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
    if v_couvert then
      return jsonb_build_object('facture_id', null, 'numero', null, 'ttc', 0,
                                'factures', '[]'::jsonb, 'couvert_par', 'annuel');
    end if;
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

commit;
