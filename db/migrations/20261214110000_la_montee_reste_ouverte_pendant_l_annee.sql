-- ======================================================================
--  La montée reste ouverte pendant l'année (décision du dirigeant du
--  12 novembre 2026, 7.5 ; recette du 11 novembre, 3.6).
--
--  LE DÉFAUT. Un engagement annuel pris le 11 novembre pour une année qui
--  commence le 1er décembre bloquait toute montée dès la souscription
--  (`forfait_changer` : « engagement_annuel » pour toute offre).
--
--  LA RÈGLE.
--   - La DESCENTE reste fermée pendant l'engagement (et avant qu'il commence).
--   - MONTÉE PENDANT L'ANNÉE : l'écart mensuel × 12 × les jours restants de
--     l'année / les jours de l'année se règle le jour même ; l'année continue
--     sur la nouvelle offre ; les mois offerts restent ceux de l'engagement
--     initial (l'écart n'en reçoit pas).
--   - MONTÉE AVANT LE DÉBUT : l'engagement passe sur la nouvelle offre au prix
--     annuel correspondant : l'écart × (12 − mois offerts), réglé le jour même.
--     Les jours d'avant l'année restent au mois, comme toute montée.
--
--  LE MÉCANISME. Un engagement ne se réécrit pas (R7) : chaque montée est une
--  ligne de `facturation.engagement_montees`, figée à sa naissance (offre,
--  prix mensuel, montant HT, jours comptés). `facturation.annuel_de` rend
--  l'engagement au prix de sa dernière montée à la date lue : tout ce qui lit
--  le prix couvert par l'année (facture du mois, échéance anniversaire, tarif
--  couvert) suit, jour par jour. La montée part sur la prochaine facture du
--  titulaire, une fois (`facture_engagement_montees`), et son acompte se règle
--  le jour même (`paiement_montee_preparer`), dans les deux régimes.
--
--  INCERTAIN, nommé dans docs/livraison-2026-10-19/10-ce-qui-reste-ouvert.md :
--  périmètre « PME » ouvert et montée AVANT le début de l'année, les jours
--  qui restent avant l'année partent par le complément du jour (une facture),
--  l'écart de l'année par son acompte : deux montants à régler.
--
--  REJEU (R11) : aucune donnée de référence écrite.
-- ======================================================================

create table facturation.engagement_montees (
  id               uuid primary key default gen_random_uuid(),
  engagement_id    uuid not null references facturation.engagements_annuels(id),
  licence_id       uuid not null references facturation.licences(id),
  forfait_id       uuid not null unique references facturation.forfait_historique(id),
  offre_code       text not null references ref.offre_codes(code),
  le               date not null,
  prix_mensuel_ht  app.money_t not null check (prix_mensuel_ht > 0),
  ecart_mensuel_ht app.money_t not null check (ecart_mensuel_ht > 0),
  jours_restants   integer check (jours_restants > 0),
  jours_annee      integer check (jours_annee > 0),
  montant_ht       app.money_t not null check (montant_ht > 0),
  libelle          text not null,
  created_at       timestamptz not null default now(),
  constraint engagement_montees_jours_coherents
    check ((jours_restants is null) = (jours_annee is null) and jours_restants <= jours_annee)
);

create index engagement_montees_licence_idx on facturation.engagement_montees (licence_id, le);
create index engagement_montees_engagement_idx on facturation.engagement_montees (engagement_id, le);

comment on table facturation.engagement_montees is
  'Les montées d''offre pendant un engagement annuel, ou avant qu''il commence (7.5). Une ligne '
  'par montée, figée : l''année continue sur `offre_code` au prix `prix_mensuel_ht` dès `le`.';

alter table facturation.engagement_montees enable row level security;
alter table facturation.engagement_montees force row level security;
revoke all on table facturation.engagement_montees from public, anon;
grant select on table facturation.engagement_montees to authenticated;
create policy engagement_montees_lire on facturation.engagement_montees
  for select to authenticated
  using ((select app.is_platform())
         or licence_id in (select l.id from facturation.licences l
                            where l.titulaire = (select auth.uid())));
create trigger engagement_montees_ne_se_reecrivent_pas
  before update or delete on facturation.engagement_montees
  for each row execute function app.deny_mutation();

create table facturation.facture_engagement_montees (
  facture_id uuid not null references facturation.factures(id),
  montee_id  uuid not null unique references facturation.engagement_montees(id),
  primary key (facture_id, montee_id)
);

alter table facturation.facture_engagement_montees enable row level security;
alter table facturation.facture_engagement_montees force row level security;
revoke all on table facturation.facture_engagement_montees from public, anon;
grant select on table facturation.facture_engagement_montees to authenticated;
create policy facture_engagement_montees_lire on facturation.facture_engagement_montees
  for select to authenticated
  using ((select app.is_platform())
         or montee_id in (select m.id from facturation.engagement_montees m));
create trigger facture_engagement_montees_ne_se_reecrivent_pas
  before update or delete on facturation.facture_engagement_montees
  for each row execute function app.deny_mutation();

/*
 * L'engagement qui couvre `p_le`, au prix et à l'offre de sa dernière montée
 * à cette date (une montée d'avant le début vaut dès le début). Même type
 * qu'avant : ses lecteurs ne changent pas.
 */
create or replace function facturation.annuel_de(p_licence uuid, p_le date)
returns facturation.engagements_annuels
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.licence_id, coalesce(m.offre_code, e.offre_code), e.du, e.au,
         coalesce(m.prix_mensuel_ht, e.prix_mensuel_ht), e.mois_offerts, e.montant_ht,
         e.souscrit_par, e.souscrit_le
    from facturation.engagements_annuels e
    left join lateral (
      select x.offre_code, x.prix_mensuel_ht
        from facturation.engagement_montees x
       where x.engagement_id = e.id and x.le <= p_le
       order by x.le desc, x.created_at desc
       limit 1) m on true
   where e.licence_id = p_licence and e.du <= p_le and e.au >= p_le
   order by e.du desc limit 1
$$;

/* Le HT des montées de l'année pas encore facturées, nées avant `p_avant`. */
create function facturation.annuel_montees_a_facturer(p_licence uuid, p_avant date)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(m.montant_ht), 0)
    from facturation.engagement_montees m
   where m.licence_id = p_licence and m.le < p_avant
     and not exists (select 1 from facturation.facture_engagement_montees fm
                      where fm.montee_id = m.id)
$$;

revoke all on function facturation.annuel_montees_a_facturer(uuid, date)
  from public, anon, authenticated;

/*
 * Une montée vient d'être posée le `p_le` sur une licence engagée à l'année
 * (en cours, ou qui commencera) : l'écart de l'année, figé. Appelée par la
 * porte `forfait_changer` seule (elle a vérifié qui monte).
 */
create function facturation.annuel_monter(p_licence uuid, p_le date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e        facturation.engagements_annuels;
  h        facturation.forfait_historique;
  v_prix   numeric;
  v_couv   numeric;
  v_ecart  numeric;
  v_jr     integer;
  v_ja     integer;
  v_ht     numeric;
begin
  select x.* into e from facturation.engagements_annuels x
   where x.licence_id = p_licence and x.au >= p_le
   order by x.du desc limit 1;
  if e.id is null then
    return;
  end if;
  select f.* into h from facturation.forfait_historique f
   where f.licence_id = p_licence and f.effet_au is null;
  v_prix  := (ref.offre_a(h.offre_code, h.offre_depuis)).prix_mensuel_ht;
  v_couv  := (facturation.annuel_de(p_licence, greatest(p_le, e.du))).prix_mensuel_ht;
  v_ecart := v_prix - v_couv;
  if v_ecart <= 0 then
    return;
  end if;
  if p_le < e.du then
    v_ht := v_ecart * (12 - e.mois_offerts);
  else
    v_jr := e.au + 1 - p_le;
    v_ja := e.au + 1 - e.du;
    v_ht := round(v_ecart * 12 * v_jr / v_ja, 3);
  end if;
  insert into facturation.engagement_montees
    (engagement_id, licence_id, forfait_id, offre_code, le, prix_mensuel_ht, ecart_mensuel_ht,
     jours_restants, jours_annee, montant_ht, libelle)
  values
    (e.id, p_licence, h.id, h.offre_code, p_le, v_prix, v_ecart, v_jr, v_ja, v_ht,
     'Abonnement annuel : passage ' || initcap(coalesce(
        (select m.offre_code from facturation.engagement_montees m
          where m.engagement_id = e.id order by m.le desc, m.created_at desc limit 1),
        e.offre_code))
       || ' -> ' || initcap(h.offre_code) || ' — du '
       || to_char(greatest(p_le, e.du), 'DD/MM/YYYY') || ' au ' || to_char(e.au, 'DD/MM/YYYY')
       || case when v_jr is null then ' (12 mois, ' || e.mois_offerts || ' offerts)'
               else ' (' || v_jr || '/' || v_ja || ' jours)' end);
end
$$;

revoke all on function facturation.annuel_monter(uuid, date) from public, anon, authenticated;
grant execute on function facturation.annuel_monter(uuid, date) to portier;

-- Repris de sa définition en vigueur ; la descente seule reste fermée par l'année.
create or replace function public.forfait_changer(p_offre text, p_tenant uuid DEFAULT NULL::uuid, p_le date DEFAULT CURRENT_DATE)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_licence uuid := facturation.ma_licence(p_tenant);
  v_emp     record;
  v_courant record;
  v_cible   record;
  v_motif   text;
begin
  -- Un engagement à l'année ferme la DESCENTE ; la montée reste ouverte
  -- (décision du 12 novembre 2026, 7.5) : elle se règle par
  -- `facturation.annuel_monter`, appelée une fois la ligne posée.
  if exists (select 1 from facturation.engagements_annuels e
              where e.licence_id = v_licence and e.au >= p_le)
     and (ref.offre_a(p_offre, p_le)).rang
         <= (select (ref.offre_a(f.offre_code, p_le)).rang
               from facturation.forfait_courant_v f where f.licence_id = v_licence) then
    raise exception '%', app.refus_avec_valeurs('refus.forfait.empeche', 'motif', 'engagement_annuel', 'chiffres', '{}') using errcode = 'check_violation';
  end if;

  select e.code, e.chiffres into v_emp
    from facturation.empechement_de_forfait(v_licence, p_offre, p_le) e;

  if v_emp.code is not null then
    raise exception '%', app.refus_avec_valeurs('refus.forfait.empeche', 'motif', (v_emp.code)::text, 'chiffres', (v_emp.chiffres)::text)
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

  if v_motif = 'montee' then
    perform facturation.annuel_monter(v_licence, p_le);
  end if;

  return true;
end;
$function$;

-- Repris de sa définition en vigueur ; seules les offres plus basses sont fermées par l'année.
create or replace function public.mes_offres(p_tenant uuid DEFAULT NULL::uuid, p_le date DEFAULT CURRENT_DATE)
 RETURNS TABLE(code text, libelle text, rang smallint, prix_mensuel_ht numeric, lectures_par_organisation integer, lectures_incluses integer, sieges_inclus smallint, sieges_max smallint, organisations_incluses smallint, organisations_max smallint, courant boolean, empechement text, chiffres jsonb, prix_ttc numeric)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_licence uuid := facturation.ma_licence(p_tenant);
  v_courant text;
  v_annuel  boolean;
  v_rang    smallint;
  v_base    numeric;
begin
  select f.offre_code into v_courant
    from facturation.forfait_courant_v f where f.licence_id = v_licence;
  select exists (select 1 from facturation.engagements_annuels e
                  where e.licence_id = v_licence and e.au >= p_le) into v_annuel;
  v_rang := (ref.offre_a(v_courant, p_le)).rang;
  -- Ce que la comptabilité paie pour la société : la base dont on retranche.
  -- Le tarif figé de l'accès, celui que la comptabilité est facturée.
  select (ref.offre_a(p.offre_code, p.offre_depuis)).prix_mensuel_ht::numeric into v_base
    from facturation.prise_en_charge_de(v_licence) p;

  return query
    with grille as (
      select distinct on (o.code) o.*
        from ref.offres o
       where o.effective_from <= p_le
       order by o.code, o.effective_from desc),
    a_payer as (
      select g.*,
             case when v_base is null then g.prix_mensuel_ht::numeric
                  else nullif(greatest(g.prix_mensuel_ht::numeric - v_base, 0), 0) end as paye
        from grille g)
    select g.code, g.libelle, g.rang, g.paye,
           g.lectures_par_organisation,
           (g.lectures_par_organisation * g.organisations_incluses)::int,
           g.sieges_inclus, g.sieges_max,
           g.organisations_incluses, g.organisations_max,
           (g.code = v_courant) as courant,
           case when v_annuel and g.rang < v_rang then 'engagement_annuel' else e.code end,
           case when v_annuel and g.rang < v_rang then '{}'::jsonb else e.chiffres end,
           case when g.paye is null then null
                else (public.prix_ttc(g.paye, p_le) ->> 'ttc')::numeric end
      from a_payer g
      cross join lateral facturation.empechement_de_forfait(v_licence, g.code, p_le) e
     order by g.rang;
end;
$function$;

-- Repris de sa définition en vigueur ; l'offre de l'année est celle de sa dernière montée.
create or replace function public.mon_annuel(p_tenant uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_licence  uuid;
  v_regle    jsonb := public.abonnement_reglage();
  v_offerts  smallint := (v_regle ->> 'annuel_mois_offerts')::smallint;
  v_courant  record;
  v_en_cours facturation.engagements_annuels;
  v_du       date;
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

  -- L'échéance suivante d'une PME payée d'avance ; sinon le mois prochain.
  select x.couvre_au into v_du
    from facturation.factures x
   where x.licence_id = v_licence and x.payeur_type = 'titulaire' and x.ancre is not null
     and x.avoir_de is null and x.statut <> 'annulee'
     and x.couvre_du <= current_date and x.couvre_au > current_date
   order by x.couvre_au desc limit 1;
  v_du := coalesce(v_du, (date_trunc('month', current_date) + interval '1 month')::date);

  -- L'engagement en cours, ou celui qui commencera à la prochaine échéance.
  select e.* into v_en_cours from facturation.engagements_annuels e
   where e.licence_id = v_licence and e.au >= current_date
   order by e.du desc limit 1;
  if v_en_cours.id is not null then
    return jsonb_build_object(
      'en_cours', jsonb_build_object(
        'du', v_en_cours.du, 'au', v_en_cours.au,
        'offre', (facturation.annuel_de(v_licence, greatest(current_date, v_en_cours.du))).offre_code,
        'montant_ht', v_en_cours.montant_ht, 'mois_offerts', v_en_cours.mois_offerts,
        'ttc', coalesce(
          (select p.montant_ttc::numeric from facturation.paiements_en_ligne p
            where p.engagement_id = v_en_cours.id),
          (public.prix_ttc(v_en_cours.montant_ht, v_en_cours.souscrit_le::date) ->> 'ttc')::numeric)));
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

  -- La comptabilité paie : aucune proposition, donc aucun prix.
  if v_ferme = 'paye_par_un_cabinet' then
    return jsonb_build_object('en_cours', null, 'ferme', v_ferme, 'proposition', null);
  end if;

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
$function$;

-- Repris de sa définition en vigueur ; le prix couvert par l'année se lit jour par jour, et les montées de l'année se facturent.
create or replace function facturation.emission_du_titulaire(p_licence uuid, p_nature text, p_du date, p_au date, p_periode_du date, p_ancre date, p_tarif_mensuel numeric, p_inclut_la_base boolean, p_offre text, p_reference text, p_jour date, p_acteur uuid, p_jours_echeance integer DEFAULT 15)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c          record;
  f          record;
  v_jours    integer := p_au - p_du;
  v_jdp      integer := p_au - p_periode_du;
  v_nom      text;
  v_part     numeric := p_tarif_mensuel;
  v_abo      numeric := round(p_tarif_mensuel * (p_au - p_du) / (p_au - p_periode_du), 3);
  v_par_an   numeric := 0;
  v_annuel   facturation.engagements_annuels;
  v_debut    facturation.engagements_annuels;
  v_recharge record;
  v_montee   record;
  v_paiement record;
  v_ht       numeric;
  v_tva      numeric;
  v_numero   text;
  v_id       uuid;
  v_enc      uuid;
  v_ordinal  smallint := 0;
  v_dates    text := 'du ' || to_char(p_du, 'DD/MM/YYYY') || ' au '
                     || to_char(p_au - 1, 'DD/MM/YYYY')
                     || case when p_au - p_du <> p_au - p_periode_du
                             then ' (' || (p_au - p_du) || '/' || (p_au - p_periode_du) || ' jours)'
                             else '' end;
begin
  select * into c from facturation.consommation_v where licence_id = p_licence;
  if c.licence_id is null then
    raise exception 'refus.introuvable.licence' using errcode = 'no_data_found';
  end if;

  if exists (select 1 from facturation.factures x
              where x.licence_id = p_licence and x.payeur_type = 'titulaire'
                and x.payeur_personne = c.titulaire and x.nature = p_nature
                and x.couvre_du = p_du and x.avoir_de is null)
     or (p_nature = 'base' and exists (
           select 1 from facturation.factures x
            where x.licence_id = p_licence and x.payeur_type = 'titulaire'
              and x.payeur_personne = c.titulaire and x.nature = 'base'
              and x.avoir_de is null and x.statut <> 'annulee'
              and daterange(x.couvre_du, x.couvre_au, '[)') && daterange(p_du, p_au, '[)'))) then
    return jsonb_build_object('deja', true);
  end if;
  -- Une licence sans société n'est pas encore servie : rien à facturer.
  if coalesce(c.organisations, 0) < 1 then
    return jsonb_build_object('rien', true);
  end if;

  select p.display_name into v_nom from identity.profiles p where p.user_id = c.titulaire;
  if v_nom is null or length(btrim(v_nom)) = 0 then
    raise exception '%', app.refus_avec_valeurs('refus.facturation.destinataire_sans_nom',
                                                'destinataire', (c.titulaire)::text)
      using errcode = 'no_data_found';
  end if;

  select * into f from facturation.fiscalite_en_vigueur(p_jour);
  if f.timbre is null then
    raise exception 'refus.referentiel.manquant' using errcode = 'no_data_found';
  end if;

  if p_nature = 'base' then
    -- L'ANNÉE (20261022190000) : l'offre des jours couverts est payée par
    -- l'engagement ; il ne reste que les places et sociétés en plus.
    v_annuel := facturation.annuel_de(p_licence, p_du);
    if v_annuel.id is not null then
      v_part := greatest(0, p_tarif_mensuel - v_annuel.prix_mensuel_ht);
    end if;
    -- Jour par jour : une montée pendant l'année change le prix couvert (7.5).
    select coalesce(round(sum((facturation.annuel_de(p_licence, j::date)).prix_mensuel_ht) / v_jdp, 3), 0)
      into v_par_an
      from generate_series(p_du, p_au - 1, interval '1 day') j;
    v_abo := greatest(0, v_abo - v_par_an);
    select e.* into v_debut from facturation.engagements_annuels e
     where e.licence_id = p_licence and e.du < p_au
       and not exists (select 1 from facturation.facture_annuels fa where fa.engagement_id = e.id)
     order by e.souscrit_le limit 1;
    select (v_abo + coalesce(v_debut.montant_ht, 0) + coalesce(sum(x.prix_ht), 0)) into v_ht
      from facturation.recharges x
     where x.licence_id = p_licence and x.achetee_le <= p_jour
       and not exists (select 1 from facturation.facture_recharges fr where fr.recharge_id = x.id);
    v_ht := v_ht + facturation.annuel_montees_a_facturer(p_licence, p_jour + 1);
  else
    v_ht := v_abo;
  end if;

  -- Rien à payer (l'année couvre tout, ou un écart qui s'arrondit à zéro) :
  -- aucune facture, qui ne porterait qu'un timbre.
  if v_ht <= 0 then
    return jsonb_build_object('couvert', case when v_annuel.id is not null then 'annuel' end);
  end if;

  v_tva    := round(v_ht * f.taux, 3);
  v_numero := 'ALG-' || to_char(p_du, 'YYYYMM') || '-'
              || lpad(nextval('facturation.numero_facture_seq')::text, 5, '0');

  insert into facturation.factures
    (licence_id, numero, periode, emise_le, echeance_le, offre_code, organisations,
     sieges_payants, montant_ht, taux_tva, montant_tva, timbre, montant_ttc, devise,
     payeur_type, payeur_tenant_id, payeur_personne, destinataire_nom, destinataire_legal_id,
     reference_abonne, nature, couvre_du, couvre_au, ancre, part_mensuelle_ht, inclut_la_base)
  values
    (p_licence, v_numero, date_trunc('month', p_du)::date, p_jour, p_jour + p_jours_echeance,
     p_offre, c.organisations, greatest(0, c.sieges_occupes - c.sieges_inclus), v_ht, f.taux,
     v_tva, f.timbre, v_ht + v_tva + f.timbre, f.devise,
     'titulaire', null, c.titulaire, v_nom, null,
     p_reference, p_nature, p_du, p_au, p_ancre, v_part, p_inclut_la_base)
  returning id into v_id;

  if p_nature = 'complement' then
    v_ordinal := 1;
    insert into facturation.facture_lignes
      (facture_id, ordinal, libelle, quantite, prix_unitaire, montant_ht)
    values (v_id, 1,
            'Complément d''abonnement ' || p_offre
              || ' (offre, places ou sociétés en plus) — ' || v_dates,
            1, v_abo, v_abo);
  elsif v_annuel.id is null and v_par_an = 0 then
    v_ordinal := 1;
    insert into facturation.facture_lignes
      (facture_id, ordinal, libelle, quantite, prix_unitaire, montant_ht)
    values (v_id, 1, 'Abonnement ' || p_offre || ' — ' || v_dates, 1, v_abo, v_abo);
  elsif v_abo > 0 then
    v_ordinal := 1;
    insert into facturation.facture_lignes
      (facture_id, ordinal, libelle, quantite, prix_unitaire, montant_ht)
    values (v_id, 1,
            case when v_annuel.id is not null
                 then 'Places et sociétés en plus — ' || v_dates
                      || ' (l''offre est couverte par l''abonnement annuel)'
                 else 'Abonnement ' || p_offre || ' — ' || v_dates
                      || ' (hors jours couverts par l''abonnement annuel)' end,
            1, v_abo, v_abo);
  end if;

  if p_nature = 'base' then
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

    for v_montee in
      select m.id, m.libelle, m.montant_ht
        from facturation.engagement_montees m
       where m.licence_id = p_licence and m.le <= p_jour
         and not exists (select 1 from facturation.facture_engagement_montees fm
                          where fm.montee_id = m.id)
       order by m.le, m.created_at
    loop
      v_ordinal := v_ordinal + 1;
      insert into facturation.facture_lignes
        (facture_id, ordinal, libelle, quantite, prix_unitaire, montant_ht)
      values (v_id, v_ordinal, v_montee.libelle, 1, v_montee.montant_ht, v_montee.montant_ht);
      insert into facturation.facture_engagement_montees (facture_id, montee_id)
      values (v_id, v_montee.id);
    end loop;

    for v_recharge in
      select x.id, x.lectures, x.prix_ht, x.achetee_le, x.origine
        from facturation.recharges x
       where x.licence_id = p_licence and x.achetee_le <= p_jour
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

    -- Les acomptes payés en ligne (montée d'avant, recharge, année) s'imputent
    -- ici ; le paiement d'une facture s'est inscrit sur ELLE, à la confirmation.
    for v_paiement in
      select p.id, p.montant_ttc, e.reference, e.prestataire, e.le::date as le,
             facturation.moyen_encaissement_du_paiement(p.id) as moyen
        from facturation.paiements_en_ligne p
        join facturation.paiement_evenements e on e.paiement_id = p.id and e.etat = 'paye'
        join facturation.prestataires_paiement pp on pp.code = e.prestataire
                                                 and pp.fait_entrer_argent
       where p.licence_id = p_licence
         and p.objet <> 'facture'
         and not exists (select 1 from facturation.paiement_imputations i where i.paiement_id = p.id)
       order by e.le, p.id
    loop
      insert into facturation.encaissements
        (facture_id, montant, moyen, reference, encaisse_le, saisi_par)
      values (v_id, v_paiement.montant_ttc, v_paiement.moyen,
              v_paiement.prestataire || ' ' || coalesce(v_paiement.reference, v_paiement.id::text),
              v_paiement.le, coalesce(auth.uid(), p_acteur))
      returning id into v_enc;
      insert into facturation.paiement_imputations (paiement_id, encaissement_id)
      values (v_paiement.id, v_enc);
    end loop;
  end if;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  select lo.tenant_id, p_acteur, 'facture.emise', 'facturation', 'factures', v_id,
         jsonb_build_object('numero', v_numero, 'nature', p_nature, 'du', p_du, 'au', p_au,
                            'ttc', v_ht + v_tva + f.timbre, 'par', 'facturation_automatique')
    from facturation.licence_organisations lo
   where lo.licence_id = p_licence
   order by lo.tenant_id limit 1;

  return jsonb_build_object('facture_id', v_id, 'numero', v_numero, 'nature', p_nature,
                            'du', p_du, 'au', p_au, 'ht', v_ht, 'ttc', v_ht + v_tva + f.timbre);
end
$function$;

-- Repris de sa définition en vigueur ; idem, à la facture du mois.
create or replace function facturation.emission_de_la_licence(p_licence uuid, p_periode date, p_jours_echeance integer DEFAULT 15)
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
  v_montee   record;
  v_ordinal  smallint;
  v_paiement record;
  v_enc      uuid;
  v_annuel   facturation.engagements_annuels;
  v_debut    facturation.engagements_annuels;
  v_mois     app.money_t;
  v_couvert  boolean := false;
  v_par_cabinet boolean := false;
begin
  if extract(day from p_periode) <> 1 then
    raise exception 'refus.facturation.premier_du_mois' using errcode = 'check_violation';
  end if;

  select * into c from facturation.consommation_v where licence_id = p_licence;
  if c.licence_id is null then
    raise exception 'refus.introuvable.licence' using errcode = 'no_data_found';
  end if;

  select o.currency, o.jurisdiction into v_emetteur
    from facturation.emetteurs e
    join identity.organizations o on o.id = e.organisation_id
   where e.valide_des <= current_date
   order by e.valide_des desc limit 1;
  if not found then
    raise exception 'refus.referentiel.manquant'
      using errcode = 'no_data_found';
  end if;

  select p.id into v_pack
    from ref.jurisdiction_packs p
   where p.jurisdiction = v_emetteur.jurisdiction
     and p.effective_from <= current_date
     and (p.effective_to is null or p.effective_to >= current_date)
   order by p.effective_from desc limit 1;
  if v_pack is null then
    raise exception 'refus.referentiel.manquant'
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
    raise exception 'refus.referentiel.manquant'
      using errcode = 'no_data_found';
  end if;
  if v_timbre is null then
    raise exception
      'refus.referentiel.manquant'
      using errcode = 'no_data_found';
  end if;

  v_sieges := greatest(0, c.sieges_occupes - c.sieges_inclus)::smallint;

  for l in
    select * from facturation.lignes_a_facturer(p_licence, p_periode)
     order by payeur_type
  loop
    -- La part d'un CABINET ne se facture plus licence par licence : elle
    -- entre dans la facture mensuelle unique du cabinet
    -- (`facturation.emettre_cabinet`, 20 octobre 2026), un seul timbre.
    if l.payeur_type = 'cabinet' then
      v_par_cabinet := true;
      continue;
    end if;
    if l.payeur_type = 'cabinet' then
      select o.name, o.legal_id into v_nom, v_legal
        from identity.organizations o where o.id = l.payeur_tenant_id;
    else
      select p.display_name, null::text into v_nom, v_legal
        from identity.profiles p where p.user_id = l.payeur_personne;
    end if;

    if v_nom is null or length(btrim(v_nom)) = 0 then
      raise exception
        '%', app.refus_avec_valeurs('refus.facturation.destinataire_sans_nom', 'destinataire', (coalesce(l.payeur_tenant_id, l.payeur_personne))::text)
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
        -- Jour par jour : une montée pendant l'année change le prix couvert (7.5).
        v_mois := greatest(0, l.montant_ht
                              - (select round(sum((facturation.annuel_de(p_licence, j::date)).prix_mensuel_ht)
                                              / l.jours_du_mois, 3)
                                   from generate_series(p_periode, (p_periode + interval '1 month')::date - 1,
                                                        interval '1 day') j))::app.money_t;
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
      v_ht := (v_ht + facturation.annuel_montees_a_facturer(
                        p_licence, (p_periode + interval '1 month')::date))::app.money_t;
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
      for v_montee in
        select m.id, m.libelle, m.montant_ht
          from facturation.engagement_montees m
         where m.licence_id = p_licence and m.le < (p_periode + interval '1 month')::date
           and not exists (select 1 from facturation.facture_engagement_montees fm
                            where fm.montee_id = m.id)
         order by m.le, m.created_at
      loop
        v_ordinal := v_ordinal + 1;
        insert into facturation.facture_lignes
          (facture_id, ordinal, libelle, quantite, prix_unitaire, montant_ht)
        values (v_id, v_ordinal, v_montee.libelle, 1, v_montee.montant_ht, v_montee.montant_ht);
        insert into facturation.facture_engagement_montees (facture_id, montee_id)
        values (v_id, v_montee.id);
      end loop;

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
        select p.id, p.montant_ttc, e.reference, e.prestataire, e.le::date as le,
               facturation.moyen_encaissement_du_paiement(p.id) as moyen
          from facturation.paiements_en_ligne p
          join facturation.paiement_evenements e on e.paiement_id = p.id and e.etat = 'paye'
          -- Seul un prestataire qui fait entrer de l'argent s'impute (la table le dit).
          join facturation.prestataires_paiement pp on pp.code = e.prestataire
                                                   and pp.fait_entrer_argent
         where p.licence_id = p_licence
           -- Le paiement d'une facture s'est inscrit sur ELLE, à la confirmation.
           and p.objet <> 'facture'
           and not exists (select 1 from facturation.paiement_imputations i where i.paiement_id = p.id)
         order by e.le, p.id
      loop
        insert into facturation.encaissements (facture_id, montant, moyen, reference, encaisse_le)
        values (v_id, v_paiement.montant_ttc, v_paiement.moyen,
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
    if v_par_cabinet then
      return jsonb_build_object('facture_id', null, 'numero', null, 'ttc', 0,
                                'factures', '[]'::jsonb, 'couvert_par', 'cabinet');
    end if;
    raise exception
      '%', app.refus_avec_valeurs('refus.facturation.rien_a_facturer', 'periode', (p_periode)::text)
      using errcode = 'no_data_found';
  end if;

  return jsonb_build_object(
    'facture_id', v_premiere, 'numero', v_premier, 'ttc', v_ttc,
    'factures', v_faites);
end
$function$;

-- Repris de 20261214090000 ; l'acompte d'une montée de l'année porte son écart annuel.
create or replace function public.paiement_montee_preparer(p_tenant uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_licence  uuid;
  r          record;
  v_prec     record;
  v_ecart    numeric;
  v_jours    int;
  v_restants int;
  v_ht       numeric;
  f          record;
  v_id       uuid;
  v_facture  uuid;
  v_annee    facturation.engagement_montees;
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
    raise exception 'refus.reserve.proprietaire_principal' using errcode = '42501';
  end if;

  -- La montée en cours d'abord, puis celle que le forfait en cours garde.
  for r in
    select h.id, h.rang, h.offre_code, h.offre_depuis, h.effet_du, h.ecart_titulaire_ht
      from facturation.forfait_historique c
      join facturation.forfait_historique h
        on h.id = c.id or (h.id = c.garde_forfait_id and c.garde_jusqu_au > current_date)
     where c.licence_id = v_licence and c.effet_au is null and h.motif = 'montee'
     order by (h.id = c.id) desc
  loop
    -- Déjà préparé : on le rend tel quel.
    select p.id into v_id from facturation.paiements_en_ligne p where p.forfait_id = r.id;
    if v_id is not null then
      return (select to_jsonb(v) from facturation.paiements_en_ligne_v v where v.paiement_id = v_id);
    end if;

    -- Une montée pendant l'année, ou avant qu'elle commence (7.5) : l'écart
    -- de l'année se règle le jour même, quel que soit le périmètre.
    select m.* into v_annee from facturation.engagement_montees m where m.forfait_id = r.id;

    if plateforme.facturation_auto_ouverte('pme') and v_annee.id is null then
      perform facturation.facturer_sur_le_champ(v_licence, r.effet_du);
      select x.id into v_facture
        from facturation.factures x
       where x.licence_id = v_licence and x.payeur_type = 'titulaire'
         and x.payeur_personne = auth.uid() and x.ancre is not null
         and x.couvre_du >= r.effet_du and x.avoir_de is null and x.statut <> 'annulee'
       order by x.created_at desc, (x.nature = 'complement') desc
       limit 1;
      if v_facture is not null then
        return public.paiement_facture_preparer(v_facture);
      end if;
      continue;   -- rien d'émis pour elle (déjà couvert, ou le passage réessaiera).
    end if;

    select h.offre_code, h.offre_depuis into v_prec
      from facturation.forfait_historique h
     where h.licence_id = v_licence and h.effet_au = r.effet_du and h.rang < r.rang
     order by h.rang desc limit 1;
    if v_prec.offre_code is null then
      continue;
    end if;
    v_ecart := coalesce(
      r.ecart_titulaire_ht,
      (ref.offre_a(r.offre_code, r.offre_depuis)).prix_mensuel_ht
        - (ref.offre_a(v_prec.offre_code, v_prec.offre_depuis)).prix_mensuel_ht);
    v_jours  := extract(day from (date_trunc('month', r.effet_du) + interval '1 month'
                                  - interval '1 day'))::int;
    v_restants := v_jours - extract(day from r.effet_du)::int + 1;
    v_ht := round(v_ecart * v_restants / v_jours, 3);
    if v_annee.id is not null then
      -- Les jours d'avant l'année restent au mois (sauf périmètre ouvert, où
      -- le complément du jour les porte) ; ceux de l'année, par l'écart annuel.
      v_ht := case when r.effet_du < (select e.du from facturation.engagements_annuels e
                                         where e.id = v_annee.engagement_id)
                    and not plateforme.facturation_auto_ouverte('pme')
                   then coalesce(v_ht, 0) else 0 end
              + v_annee.montant_ht;
    end if;
    if v_ht is null or v_ht <= 0 then
      continue;
    end if;

    -- Sans émetteur désigné, ALGORIA ne facture pas encore : rien ne se prépare,
    -- et on ne suppose aucune TVA (R4). L'offre reste ouverte ; la tour désigne
    -- l'émetteur, et le paiement suivra la facture.
    if not exists (select 1 from facturation.emetteurs e where e.valide_des <= r.effet_du) then
      return null;
    end if;

    select * into f from facturation.fiscalite_en_vigueur(r.effet_du);

    insert into facturation.paiements_en_ligne
      (licence_id, objet, forfait_id, libelle, montant_ht, taux_tva, montant_tva, montant_ttc,
       devise, cree_par)
    values
      (v_licence, 'montee', r.id,
       coalesce(v_annee.libelle,
                'Passage ' || initcap(v_prec.offre_code) || ' -> ' || initcap(r.offre_code)
                  || ' — ' || v_restants || '/' || v_jours || ' jours'),
       v_ht, f.taux, round(v_ht * f.taux, 3), v_ht + round(v_ht * f.taux, 3), f.devise, auth.uid())
    returning id into v_id;

    return (select to_jsonb(v) from facturation.paiements_en_ligne_v v where v.paiement_id = v_id);
  end loop;

  return null;   -- rien à payer maintenant : aucune montée due.
end
$function$;
