-- ======================================================================
--  La PME paie d'avance, à sa date anniversaire ; le cabinet reste au mois
--  (décisions du dirigeant, 4 novembre 2026, confirmées).
--
--  A. CABINETS. Rien ne change : une facture mensuelle consolidée, à terme
--     échu, au prorata des jours, qui porte aussi la base au prix public des
--     licences PME que le cabinet paie (règle D9, 20261020110000).
--  B. PME. Ce que la PME (son titulaire) paie se facture D'AVANCE, à la date
--     anniversaire, sans prorata. Un abonnement qui commence le 20 novembre a
--     sa facture le 20 novembre pour [20 nov., 20 déc.), puis le 20 décembre
--     pour [20 déc., 20 janv.), datée du jour même. Né un 29, 30 ou 31 : la
--     facture tombe le dernier jour des mois plus courts, puis revient au jour
--     d'origine (31 janv. → 28 févr. → 31 mars : `facturation.echeance_de`).
--  C. COMPLÉMENT. Une montée d'offre, une place ou une société en plus en
--     cours de période se facturent LE JOUR MÊME à la PME, sur une facture
--     complémentaire qui porte son propre timbre : l'écart de prix au prorata
--     des jours qui restent jusqu'à l'échéance suivante. Ensuite, le nouveau
--     prix est dans la facture anniversaire. Ce chemin REMPLACE l'acompte de
--     montée (20261022150000) dès que le périmètre PME est ouvert : le
--     paiement en ligne paie la facture complémentaire.
--  D. DEUX PAYEURS (D9). Le cabinet reste facturé au mois, à terme échu, pour
--     la base seule ; la part de la PME suit l'anniversaire de SA montée
--     (complément le jour de la montée, puis chaque mois à cette date).
--  E. DESCENTE, place ou société retirée : effet à l'échéance suivante. La
--     période déjà facturée reste due, sans avoir. Le plancher d'un accès de
--     cabinet reste ce qu'il était (`facturation.empechement_de_forfait`).
--  F. Ce que le cabinet « accorde » (places, sociétés) au-delà de la base, la
--     PME le paie : D9, inchangé (`facturation.periodes_v`).
--
--  LE MÉCANISME. Une facture de PME porte ce qu'elle couvre : `couvre_du`,
--  `couvre_au` (exclu), sa `nature` (base ou complement), l'`ancre` de son
--  anniversaire et le `part_mensuelle_ht` — le tarif MENSUEL qu'elle couvre.
--  Ce qui est couvert un jour donné est la somme de ces tarifs (plus le prix
--  mensuel d'un abonnement annuel en cours) : un complément part quand le
--  tarif du jour le dépasse, rien ne part quand il est en dessous (E). Une
--  descente puis une remontée dans la même période ne refacturent donc rien.
--  Les jours facturés une fois, jamais deux, la base le tient : exclusion
--  `factures_un_jour_de_base_une_fois` (btree_gist, comme les historiques).
--
--  LE SAUT D'ANCIEN À NOUVEAU. Les factures d'avant restent ce qu'elles
--  étaient (le mois de leur `periode`). La première échéance d'une PME déjà
--  facturée au mois commence le jour où sa dernière facture s'arrête, et va
--  jusqu'à son anniversaire suivant, au prorata de cette période : ni jour
--  facturé deux fois, ni trou.
--
--  ACOMPTES DE MONTÉE. Un acompte déjà payé reste valable : il s'impute sur la
--  prochaine facture anniversaire de la PME, comme il s'imputait sur la
--  facture du mois. Un acompte préparé tant que le périmètre était coupé reste
--  payable tel quel (`paiement_montee_preparer` le rend) ; une fois payé, il
--  s'impute de même. Aucun acompte nouveau ne se crée périmètre ouvert.
--
--  LA TOUR. L'interrupteur unique (20261127090000) devient deux périmètres
--  indépendants, `cabinets` et `pme`, chacun daté, motivé, en ajout seul (R7),
--  livrés COUPÉS. La décision unique, jamais ouverte, devient celle des
--  cabinets ; la PME reçoit la sienne, coupée, datée du même littéral (R11).
--
--  INCERTAIN (juridique et fiscal, à valider par le conseil d'ALGORIA) :
--  facturer d'avance un service à venir ; un droit de timbre sur chaque
--  facture complémentaire ; aucun avoir à la descente. Écrit dans
--  docs/livraison-2026-10-19/10-ce-qui-reste-ouvert.md.
-- ======================================================================

-- ------------------------------------------------------------- 1. Deux périmètres à la tour

-- Le défaut range la décision existante (jamais ouverte) sous les cabinets,
-- sans réécrire la ligne : `add column … default` remplit sans déclencheur.
alter table plateforme.reglages_facturation_auto
  add column perimetre text not null default 'cabinets'
    constraint reglages_facturation_auto_perimetre check (perimetre in ('cabinets', 'pme'));
alter table plateforme.reglages_facturation_auto alter column perimetre drop default;

create index reglages_facturation_auto_perimetre_idx
  on plateforme.reglages_facturation_auto (perimetre, decide_le desc, rang desc);

comment on column plateforme.reglages_facturation_auto.perimetre is
  'Ce que la décision ouvre ou coupe : la facture mensuelle des cabinets, ou les échéances '
  'anniversaire et les compléments des PME. Les deux périmètres sont indépendants.';

insert into plateforme.reglages_facturation_auto
  (perimetre, actif, rattrapage_mois, motif, decide_par, decide_le)
values ('pme', false, 1,
        'Périmètre PME séparé de la décision unique du 4 novembre 2026 (jamais ouverte) : '
        'échéance anniversaire d''avance et facture complémentaire le jour même. Livré coupé. '
        'Rattrapage d''une échéance : la période en cours seulement.',
        null, timestamptz '2026-11-04 00:00:00+00');

drop function plateforme.facturation_auto_etat();
drop function plateforme.facturation_auto_regler(boolean, integer, text);
drop function plateforme.facturation_auto_ouverte();
drop function plateforme.facturation_auto_en_vigueur();

/* La décision en vigueur d'un périmètre. Lue par les fonctions de l'émission seulement. */
create function plateforme.facturation_auto_en_vigueur(p_perimetre text)
returns plateforme.reglages_facturation_auto
language sql
stable
security definer
set search_path = ''
as $$
  select r.* from plateforme.reglages_facturation_auto r
   where r.perimetre = p_perimetre
   order by r.decide_le desc, r.rang desc
   limit 1
$$;

revoke all on function plateforme.facturation_auto_en_vigueur(text) from public, anon, authenticated;

/* Ce périmètre est-il ouvert, ici et maintenant ? */
create function plateforme.facturation_auto_ouverte(p_perimetre text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((plateforme.facturation_auto_en_vigueur(p_perimetre)).actif, false)
$$;

revoke all on function plateforme.facturation_auto_ouverte(text) from public, anon, authenticated;
grant execute on function plateforme.facturation_auto_ouverte(text) to malica_api;

/* La tour ouvre ou coupe un périmètre : daté, motivé, en ajout seul. */
create function plateforme.facturation_auto_regler(
  p_perimetre text, p_actif boolean, p_rattrapage_mois integer, p_motif text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  if p_perimetre is null or p_actif is null or p_rattrapage_mois is null
     or p_motif is null or length(btrim(p_motif)) = 0 then
    raise exception 'refus.saisie.incomplete' using errcode = '22023';
  end if;
  if p_perimetre not in ('cabinets', 'pme') then
    raise exception 'refus.facturation_auto.perimetre_inconnu' using errcode = '22023';
  end if;
  if p_rattrapage_mois < 1 then
    raise exception 'refus.facturation_auto.rattrapage_hors_bornes' using errcode = '22023';
  end if;
  insert into plateforme.reglages_facturation_auto
    (perimetre, actif, rattrapage_mois, motif, decide_par)
  values (p_perimetre, p_actif, p_rattrapage_mois, btrim(p_motif), auth.uid())
  returning id into v_id;
  return (select to_jsonb(r) - 'decide_par' - 'rang' from plateforme.reglages_facturation_auto r
           where r.id = v_id);
end
$$;

revoke all on function plateforme.facturation_auto_regler(text, boolean, integer, text)
  from public, anon;
grant execute on function plateforme.facturation_auto_regler(text, boolean, integer, text)
  to authenticated;

-- Chaque passage dit sous quel périmètre il a tourné. Le défaut range les
-- passages existants sous les cabinets (jamais ouverte : il n'y en a pas).
alter table fabrique.facturations_du_jour
  add column perimetre text not null default 'cabinets'
    constraint facturations_du_jour_perimetre check (perimetre in ('cabinets', 'pme'));
alter table fabrique.facturations_du_jour alter column perimetre drop default;
create index facturations_du_jour_perimetre_idx
  on fabrique.facturations_du_jour (perimetre, passee_le desc, rang desc);

-- ------------------------------------------------- 2. Une facture dit ce qu'elle couvre

alter table facturation.factures
  add column nature            text not null default 'base'
    constraint factures_nature check (nature in ('base', 'complement')),
  add column couvre_du         date,
  add column couvre_au         date,
  add column ancre             date,
  add column part_mensuelle_ht app.money_t,
  add column inclut_la_base    boolean not null default false;

comment on column facturation.factures.nature is
  'base : la facture d''une période (le mois des cabinets et des factures d''avant, l''échéance '
  'anniversaire d''une PME) ; complement : l''écart de prix facturé le jour d''une montée, d''une '
  'place ou d''une société en plus, jusqu''à l''échéance suivante.';
comment on column facturation.factures.couvre_du is
  'Le premier jour couvert. Une facture d''avant couvre le mois de sa période.';
comment on column facturation.factures.couvre_au is 'Le lendemain du dernier jour couvert (exclu).';
comment on column facturation.factures.ancre is
  'L''anniversaire de la PME : le jour où sa suite de paiements a commencé. Nul pour une facture '
  'mensuelle (cabinet, ou PME d''avant le 4 novembre 2026).';
comment on column facturation.factures.part_mensuelle_ht is
  'Le tarif mensuel HT que la facture couvre sur ses jours (l''écart, pour un complément). La '
  'somme sur un jour dit ce qui est déjà facturé ce jour-là.';
comment on column facturation.factures.inclut_la_base is
  'La PME paie aussi la base de l''offre sur ces jours (aucun cabinet ne la paie) : le cabinet '
  'qui reprend la licence ne la refacture pas avant leur fin.';

-- Les factures d'avant couvrent le mois de leur période. Pas de déclencheur
-- de réécriture sur `factures` : la mise à jour ne touche que ces colonnes neuves.
update facturation.factures
   set couvre_du = periode, couvre_au = (periode + interval '1 month')::date
 where couvre_du is null;

alter table facturation.factures
  alter column couvre_du set not null,
  alter column couvre_au set not null,
  add constraint factures_couvre_une_fenetre check (couvre_au > couvre_du),
  add constraint factures_anniversaire_coherent check (
    ((ancre is null) = (part_mensuelle_ht is null))
    and (nature = 'base' or ancre is not null)
    and (ancre is null or (licence_id is not null and payeur_type = 'titulaire'
                           and ancre <= couvre_du
                           and periode = date_trunc('month', couvre_du)::date)));

-- Une émission mensuelle (le cabinet, l'émission manuelle de la plateforme)
-- ne nomme pas ses jours : ce sont ceux du mois de sa période.
create function facturation.une_facture_couvre_son_mois()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.couvre_du is null then
    new.couvre_du := new.periode;
  end if;
  if new.couvre_au is null then
    new.couvre_au := (new.periode + interval '1 month')::date;
  end if;
  return new;
end
$$;

revoke all on function facturation.une_facture_couvre_son_mois() from public, anon, authenticated;

create trigger factures_couvrent_leur_mois
  before insert on facturation.factures
  for each row execute function facturation.une_facture_couvre_son_mois();

-- L'unicité : une facture par payeur, licence, nature et premier jour couvert
-- (remplace « une par payeur et par mois », qu'une échéance anniversaire et
-- un complément du même mois violeraient). Pour une facture mensuelle, le
-- premier jour couvert EST sa période : la garantie d'avant reste entière.
drop index facturation.factures_une_par_payeur_et_periode;
create unique index factures_une_par_payeur_nature_et_debut
  on facturation.factures (licence_id, payeur_type, coalesce(payeur_tenant_id, payeur_personne),
                           nature, couvre_du,
                           coalesce(avoir_de, '00000000-0000-0000-0000-000000000000'::uuid));

-- Un jour de base se facture une fois au même payeur pour la même licence.
-- Les compléments, eux, se superposent à la base par construction : leur
-- borne est le tarif couvert (`facturation.tarif_couvert_le`), pas le jour.
alter table facturation.factures
  add constraint factures_un_jour_de_base_une_fois
  exclude using gist (licence_id with =, payeur_type with =,
                      (coalesce(payeur_tenant_id, payeur_personne)) with =,
                      daterange(couvre_du, couvre_au, '[)') with &&)
  where (licence_id is not null and nature = 'base' and avoir_de is null and statut <> 'annulee');

-- ------------------------------------------------------------- 3. Le calendrier anniversaire

/*
 * La période anniversaire qui contient `p_jour`, pour une suite commencée le
 * `p_ancre` : [ancre + k mois, ancre + k+1 mois). PostgreSQL ramène un 31 au
 * dernier jour d'un mois plus court, et l'ancre fixe garde le jour d'origine
 * ensuite : 31 janv. → 28 févr. (29 une année bissextile) → 31 mars.
 */
create function facturation.echeance_de(p_ancre date, p_jour date, out debut date, out fin date)
language plpgsql
immutable
set search_path = ''
as $$
declare
  k integer := ((extract(year from p_jour) - extract(year from p_ancre)) * 12
                + extract(month from p_jour) - extract(month from p_ancre))::integer;
begin
  while (p_ancre + make_interval(months => k))::date > p_jour loop
    k := k - 1;
  end loop;
  while (p_ancre + make_interval(months => k + 1))::date <= p_jour loop
    k := k + 1;
  end loop;
  debut := (p_ancre + make_interval(months => k))::date;
  fin   := (p_ancre + make_interval(months => k + 1))::date;
end
$$;

revoke all on function facturation.echeance_de(date, date) from public, anon, authenticated;

/*
 * Ce que le titulaire paie le jour `p_jour` (la part PME de D9), ou aucune
 * ligne s'il ne paie rien ce jour-là. `base_par_un_cabinet` : un cabinet paie
 * la base ces jours-là, la PME l'écart seulement.
 */
create function facturation.part_du_titulaire_le(p_licence uuid, p_jour date)
returns table (part_ht app.money_t, offre_code text, reference text, base_par_un_cabinet boolean,
               du date)
language sql
stable
security definer
set search_path = ''
as $$
  select pv.part_pme_ht, pv.offre_code, pv.reference_vivante,
         pv.cabinet_tenant_id is not null and pv.part_cabinet_ht > 0, pv.du
    from facturation.periodes_v pv
   where pv.licence_id = p_licence and pv.facturable and pv.titulaire is not null
     and pv.part_pme_ht > 0
     and pv.du <= p_jour and (pv.au_exclu is null or pv.au_exclu > p_jour)
   order by pv.du desc
   limit 1
$$;

revoke all on function facturation.part_du_titulaire_le(uuid, date) from public, anon, authenticated;

/*
 * Le premier jour de la suite ININTERROMPUE de jours où le titulaire paie,
 * qui contient `p_jour` : l'anniversaire de la PME. Une montée qui fait
 * naître la part de la PME (D9) ouvre une suite : son jour est l'anniversaire.
 */
create function facturation.debut_de_la_suite(p_licence uuid, p_jour date)
returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_du   date;
  v_prec date;
begin
  select t.du into v_du from facturation.part_du_titulaire_le(p_licence, p_jour) t;
  if v_du is null then
    return null;
  end if;
  loop
    select pv.du into v_prec
      from facturation.periodes_v pv
     where pv.licence_id = p_licence and pv.facturable and pv.titulaire is not null
       and pv.part_pme_ht > 0 and pv.au_exclu = v_du
     limit 1;
    exit when v_prec is null;
    v_du := v_prec;
  end loop;
  return v_du;
end
$$;

revoke all on function facturation.debut_de_la_suite(uuid, date) from public, anon, authenticated;

/*
 * Le tarif mensuel déjà facturé au titulaire pour le jour `p_jour` : les
 * échéances et compléments qui couvrent ce jour, plus le prix mensuel d'un
 * abonnement annuel en cours (son offre est payée par l'année).
 */
create function facturation.tarif_couvert_le(p_licence uuid, p_jour date)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select sum(f.part_mensuelle_ht)
                     from facturation.factures f
                     join facturation.licences l on l.id = f.licence_id
                    where f.licence_id = p_licence and f.payeur_type = 'titulaire'
                      and f.payeur_personne = l.titulaire and f.ancre is not null
                      and f.avoir_de is null and f.statut <> 'annulee'
                      and f.couvre_du <= p_jour and f.couvre_au > p_jour), 0)
         + coalesce((facturation.annuel_de(p_licence, p_jour)).prix_mensuel_ht, 0)
$$;

revoke all on function facturation.tarif_couvert_le(uuid, date) from public, anon, authenticated;

-- ------------------------------------------------------ 4. Émettre une facture de la PME

/*
 * Une facture du titulaire pour [p_du, p_au), d'une période anniversaire qui
 * commence le `p_periode_du` (le prorata ne vaut que pour la première
 * échéance d'une PME facturée au mois avant ce jour, et pour un complément).
 * `p_tarif_mensuel` est le tarif mensuel que la facture couvre : la part de
 * la PME pour une base, l'écart pour un complément.
 *
 * Rien ne se tire avant d'être sûr d'émettre : déjà émise (même payeur,
 * nature et premier jour), jours de base déjà facturés, licence sans société,
 * destinataire sans nom — tout est vu AVANT `nextval`, qui ne se rend pas.
 *
 * Une base porte aussi, comme la facture du mois avant elle : la ligne d'un
 * abonnement annuel qui commence avant la fin de la période (une fois), les
 * recharges achetées jusqu'au jour d'émission, et l'imputation des acomptes
 * payés en ligne (montée, recharge, année). Un complément ne porte que son
 * écart. Rend `{facture_id, …}`, ou `{deja}` / `{rien}` / `{couvert: annuel}`.
 */
create function facturation.emission_du_titulaire(
  p_licence uuid, p_nature text, p_du date, p_au date, p_periode_du date, p_ancre date,
  p_tarif_mensuel numeric, p_inclut_la_base boolean, p_offre text, p_reference text,
  p_jour date, p_acteur uuid, p_jours_echeance integer default 15)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
    select coalesce(sum(round(e.prix_mensuel_ht
                              * (least(p_au, e.au + 1) - greatest(p_du, e.du)) / v_jdp, 3)), 0)
      into v_par_an
      from facturation.engagements_annuels e
     where e.licence_id = p_licence and e.du < p_au and e.au + 1 > p_du;
    v_abo := greatest(0, v_abo - v_par_an);
    select e.* into v_debut from facturation.engagements_annuels e
     where e.licence_id = p_licence and e.du < p_au
       and not exists (select 1 from facturation.facture_annuels fa where fa.engagement_id = e.id)
     order by e.souscrit_le limit 1;
    select (v_abo + coalesce(v_debut.montant_ht, 0) + coalesce(sum(x.prix_ht), 0)) into v_ht
      from facturation.recharges x
     where x.licence_id = p_licence and x.achetee_le <= p_jour
       and not exists (select 1 from facturation.facture_recharges fr where fr.recharge_id = x.id);
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
$$;

revoke all on function facturation.emission_du_titulaire(
  uuid, text, date, date, date, date, numeric, boolean, text, text, date, uuid, integer)
  from public, anon, authenticated;

/*
 * Tout ce qui est dû par le titulaire d'une licence le jour `p_jour` :
 *
 *   1. LES ÉCHÉANCES. La suite reprend où la dernière facture s'arrête si le
 *      titulaire paie encore ce jour-là (sans trou) ; sinon une suite neuve
 *      commence au premier jour de paiement qui contient `p_jour`. Chaque
 *      période qui commence au plus tard `p_jour` part, d'avance, au tarif de
 *      son premier jour, dans la fenêtre de rattrapage (`p_rattrapage`
 *      échéances : la période en cours, et les précédentes). Le titulaire ne
 *      paie plus au début d'une période : la suite s'arrête (fin
 *      d'abonnement, ou un cabinet qui reprend tout) — rien n'est facturé
 *      après la fin, la période déjà facturée reste due.
 *      La première facture d'une suite où un cabinet paie la base (D9) est un
 *      COMPLÉMENT à cette base ; les suivantes sont des bases.
 *   2. LE COMPLÉMENT DU JOUR. Le tarif du jour dépasse ce qui est couvert :
 *      l'écart, du jour à l'échéance suivante, au prorata. Un second
 *      changement le même jour, après un complément déjà émis, part au
 *      passage suivant (un complément par jour : la clé d'unicité).
 */
create function facturation.facturation_du_titulaire(
  p_licence uuid, p_jour date, p_rattrapage integer, p_acteur uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_titulaire uuid;
  v_fin       date;
  v_ancre     date;
  v_s         date;
  v_plancher  date;
  v_premiere  boolean := false;
  v_tarif     numeric;
  v_couvert   numeric;
  e           record;
  p           record;
  v_res       jsonb;
  v_factures  jsonb := '[]'::jsonb;
begin
  select l.titulaire into v_titulaire from facturation.licences l
   where l.id = p_licence and l.statut <> 'resiliee';
  if v_titulaire is null then
    return jsonb_build_object('factures', v_factures, 'couverte', false);
  end if;

  -- 1. Les échéances.
  select x.couvre_au, x.ancre into v_fin, v_ancre
    from facturation.factures x
   where x.licence_id = p_licence and x.payeur_type = 'titulaire'
     and x.payeur_personne = v_titulaire and x.avoir_de is null and x.statut <> 'annulee'
   order by x.couvre_au desc, x.ancre nulls last
   limit 1;

  if v_fin is not null and v_fin <= p_jour
     and exists (select 1 from facturation.part_du_titulaire_le(p_licence, v_fin)) then
    v_s     := v_fin;
    v_ancre := coalesce(v_ancre, facturation.debut_de_la_suite(p_licence, v_fin));
  elsif v_fin is null or v_fin <= p_jour then
    v_ancre    := facturation.debut_de_la_suite(p_licence, p_jour);
    v_s        := v_ancre;
    v_premiere := true;
  end if;

  if v_s is not null then
    v_plancher := (facturation.echeance_de(
                    v_ancre, (p_jour - make_interval(months => p_rattrapage - 1))::date)).debut;
    if v_s < v_plancher then
      v_s := v_plancher;
      v_premiere := false;
    end if;
    while v_s <= p_jour loop
      select * into p from facturation.part_du_titulaire_le(p_licence, v_s);
      exit when p.part_ht is null;
      select * into e from facturation.echeance_de(v_ancre, v_s);
      v_res := facturation.emission_du_titulaire(
                 p_licence,
                 case when v_premiere and p.base_par_un_cabinet then 'complement' else 'base' end,
                 v_s, e.fin, e.debut, v_ancre, p.part_ht, not p.base_par_un_cabinet,
                 p.offre_code, p.reference, p_jour, p_acteur);
      if v_res ? 'facture_id' then
        v_factures := v_factures || v_res;
      end if;
      v_premiere := false;
      v_s := e.fin;
    end loop;
  end if;

  -- 2. Le complément du jour. Le jour est couvert par une facture de la
  -- suite, ou par l'année (un mois qu'elle paie seule n'a pas de facture).
  select x.ancre into v_ancre
    from facturation.factures x
   where x.licence_id = p_licence and x.payeur_type = 'titulaire'
     and x.payeur_personne = v_titulaire and x.ancre is not null
     and x.avoir_de is null and x.statut <> 'annulee'
     and x.couvre_du <= p_jour
   order by x.couvre_au desc
   limit 1;
  if v_ancre is null
     or not (exists (select 1 from facturation.factures x
                      where x.licence_id = p_licence and x.payeur_type = 'titulaire'
                        and x.payeur_personne = v_titulaire and x.ancre is not null
                        and x.avoir_de is null and x.statut <> 'annulee'
                        and x.couvre_du <= p_jour and x.couvre_au > p_jour)
             or (facturation.annuel_de(p_licence, p_jour)).id is not null) then
    return jsonb_build_object('factures', v_factures, 'couverte', false);
  end if;

  select * into p from facturation.part_du_titulaire_le(p_licence, p_jour);
  v_tarif   := coalesce(p.part_ht, 0);
  v_couvert := facturation.tarif_couvert_le(p_licence, p_jour);
  if v_tarif > v_couvert then
    select * into e from facturation.echeance_de(v_ancre, p_jour);
    v_res := facturation.emission_du_titulaire(
               p_licence, 'complement', p_jour, e.fin, e.debut, v_ancre, v_tarif - v_couvert,
               not p.base_par_un_cabinet, p.offre_code, p.reference, p_jour, p_acteur);
    if v_res ? 'facture_id' then
      v_factures := v_factures || v_res;
    end if;
  end if;
  return jsonb_build_object('factures', v_factures, 'couverte', true);
end
$$;

revoke all on function facturation.facturation_du_titulaire(uuid, date, integer, uuid)
  from public, anon, authenticated;

-- ------------------------------------------- 5. Le cabinet ne refacture pas un jour payé d'avance

/*
 * Repris de 20261127090000 ; seul change le début de chaque segment : une
 * licence que la PME a payée d'avance, base comprise (`inclut_la_base`), ne
 * passe au cabinet qu'à la fin de ces jours-là. Ni jour facturé deux fois,
 * ni trou : la PME a payé jusqu'à son échéance, le cabinet prend la suite.
 */
create or replace function facturation.lignes_a_facturer_cabinet(p_cabinet uuid, p_periode date)
returns table(licence_id uuid, tenant_id uuid, organisation text, reference text, offre_code text,
              jours integer, jours_du_mois integer, montant_ht app.money_t)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
  with mois as (
    select p_periode                                     as du,
           (p_periode + interval '1 month')::date         as au_exclu,
           ((p_periode + interval '1 month')::date - p_periode)::int as jours
  ),
  lignes as (
    select pv.licence_id                         as licence_id,
           a.tenant_id                           as tenant_id,
           pv.acces_reference                    as reference,
           pv.part_offre_code                    as part_offre_code,
           pv.part_ht                            as part_ht,
           m.jours                               as jours_du_mois,
           greatest(pv.du, m.du, coalesce(t.paye_jusqu_au, m.du)) as seg_du,
           least(coalesce(pv.au_exclu, m.au_exclu), m.au_exclu) as seg_au_exclu
      from facturation.payeurs_v pv
      join facturation.acces a on a.id = pv.acces_id
      cross join mois m
      left join lateral (
        select max(f.couvre_au) as paye_jusqu_au
          from facturation.factures f
         where f.licence_id = pv.licence_id and f.payeur_type = 'titulaire'
           and f.inclut_la_base and f.avoir_de is null and f.statut <> 'annulee'
           and f.couvre_du < least(coalesce(pv.au_exclu, m.au_exclu), m.au_exclu)
      ) t on true
     where pv.payeur_type = 'cabinet'
       and pv.payeur_tenant_id = p_cabinet
       and pv.du < m.au_exclu
       and (pv.au_exclu is null or pv.au_exclu > m.du)
  )
  select
    l.licence_id,
    l.tenant_id,
    o.name,
    (array_agg(l.reference order by l.seg_du desc))[1],
    (array_agg(l.part_offre_code order by l.seg_du desc))[1],
    sum(l.seg_au_exclu - l.seg_du)::int,
    max(l.jours_du_mois)::int,
    round(sum(l.part_ht * (l.seg_au_exclu - l.seg_du) / l.jours_du_mois), 3)::app.money_t
  from lignes l
  join identity.organizations o on o.id = l.tenant_id
  where l.seg_du < l.seg_au_exclu
  group by l.licence_id, l.tenant_id, o.name;
end
$$;

-- ------------------------------------------------------- 6. Le passage du jour, par périmètre

/*
 * Les cabinets : leur facture mensuelle unique, des `rattrapage_mois`
 * derniers mois clos. Le corps est celui de 20261127090000, déplacé ; la
 * boucle des titulaires en est sortie (B : la PME a son périmètre).
 */
create function fabrique.facturation_des_cabinets(p_jour date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reglage  plateforme.reglages_facturation_auto := plateforme.facturation_auto_en_vigueur('cabinets');
  v_dernier  date;
  v_premier  date;
  r          record;
  v_res      jsonb;
  v_cle      text;
  v_emises   integer := 0;
  v_deja     integer := 0;
  v_rien     integer := 0;
  v_factures jsonb := '[]'::jsonb;
  v_erreurs  jsonb := '[]'::jsonb;
begin
  if not coalesce(v_reglage.actif, false) then
    return jsonb_build_object('etat', 'coupee');
  end if;
  if exists (select 1 from fabrique.facturations_du_jour x
              where x.jour = p_jour and x.decision_id = v_reglage.id) then
    return jsonb_build_object('etat', 'deja_passee', 'decision', v_reglage.id);
  end if;

  v_dernier := (date_trunc('month', p_jour) - interval '1 month')::date;
  v_premier := (date_trunc('month', p_jour) - make_interval(months => v_reglage.rattrapage_mois))::date;

  for r in
    select distinct pv.payeur_tenant_id as cabinet, m.periode::date as periode
      from generate_series(v_premier::timestamp, v_dernier::timestamp, interval '1 month') m(periode)
      join facturation.payeurs_v pv
        on pv.payeur_type = 'cabinet'
       and pv.du < (m.periode + interval '1 month')::date
       and (pv.au_exclu is null or pv.au_exclu > m.periode::date)
     order by 2, 1
  loop
    if exists (select 1 from facturation.factures x
                where x.payeur_tenant_id = r.cabinet and x.periode = r.periode
                  and x.licence_id is null and x.avoir_de is null) then
      v_deja := v_deja + 1;
      continue;
    end if;
    begin
      v_res := facturation.emission_du_cabinet(r.cabinet, r.periode, v_reglage.decide_par);
      v_emises := v_emises + 1;
      v_factures := v_factures || jsonb_build_object(
        'facture_id', v_res -> 'facture_id', 'numero', v_res -> 'numero', 'periode', r.periode,
        'cabinet', r.cabinet);
    exception
      when unique_violation then
        v_deja := v_deja + 1;
      when others then
        v_cle := split_part(sqlerrm, '?', 1);
        if v_cle = 'refus.facturation.rien_a_facturer' then
          v_rien := v_rien + 1;
        else
          v_erreurs := v_erreurs || jsonb_build_object(
            'cabinet', r.cabinet, 'periode', r.periode, 'cle', left(v_cle, 200),
            'etat', sqlstate);
        end if;
    end;
  end loop;

  insert into fabrique.facturations_du_jour
    (perimetre, jour, decision_id, emises, deja_emises, rien_a_facturer, erreurs, detail)
  values ('cabinets', p_jour, v_reglage.id, v_emises, v_deja, v_rien, jsonb_array_length(v_erreurs),
          jsonb_build_object('factures', v_factures, 'erreurs', v_erreurs,
                             'mois', jsonb_build_object('du', v_premier, 'au', v_dernier)));

  return jsonb_build_object(
    'etat', 'passee', 'decision', v_reglage.id,
    'emises', v_emises, 'deja_emises', v_deja, 'rien_a_facturer', v_rien,
    'erreurs', jsonb_array_length(v_erreurs), 'factures', v_factures, 'detail_erreurs', v_erreurs);
end
$$;

revoke all on function fabrique.facturation_des_cabinets(date) from public, anon, authenticated;

/*
 * Les PME : chaque licence dont le titulaire paie dans la fenêtre de
 * rattrapage, une sous-transaction par licence — un refus n'arrête pas les
 * autres. Une licence qui reçoit au moins une facture compte `emises` (une
 * par facture) ; sinon `deja_emises` si une facture couvre déjà le jour,
 * `rien_a_facturer` sinon (année qui couvre tout, licence sans société).
 */
create function fabrique.facturation_des_pme(p_jour date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reglage  plateforme.reglages_facturation_auto := plateforme.facturation_auto_en_vigueur('pme');
  v_depuis   date;
  r          record;
  f          jsonb;
  v_res      jsonb;
  v_cle      text;
  v_emises   integer := 0;
  v_deja     integer := 0;
  v_rien     integer := 0;
  v_factures jsonb := '[]'::jsonb;
  v_erreurs  jsonb := '[]'::jsonb;
begin
  if not coalesce(v_reglage.actif, false) then
    return jsonb_build_object('etat', 'coupee');
  end if;
  if exists (select 1 from fabrique.facturations_du_jour x
              where x.jour = p_jour and x.decision_id = v_reglage.id) then
    return jsonb_build_object('etat', 'deja_passee', 'decision', v_reglage.id);
  end if;

  v_depuis := (p_jour - make_interval(months => v_reglage.rattrapage_mois))::date;
  for r in
    select distinct pv.licence_id
      from facturation.payeurs_v pv
      join facturation.licences l on l.id = pv.licence_id and l.statut <> 'resiliee'
     where pv.payeur_type = 'titulaire'
       and pv.du <= p_jour
       and (pv.au_exclu is null or pv.au_exclu > v_depuis)
     order by 1
  loop
    begin
      v_res := facturation.facturation_du_titulaire(
                 r.licence_id, p_jour, v_reglage.rattrapage_mois, v_reglage.decide_par);
      if jsonb_array_length(v_res -> 'factures') > 0 then
        for f in select * from jsonb_array_elements(v_res -> 'factures') loop
          v_emises := v_emises + 1;
          v_factures := v_factures || (f || jsonb_build_object('licence', r.licence_id));
        end loop;
      elsif (v_res ->> 'couverte')::boolean then
        v_deja := v_deja + 1;
      else
        v_rien := v_rien + 1;
      end if;
    exception
      when unique_violation or exclusion_violation then
        v_deja := v_deja + 1;
      when others then
        v_cle := split_part(sqlerrm, '?', 1);
        v_erreurs := v_erreurs || jsonb_build_object(
          'licence', r.licence_id, 'periode', p_jour, 'cle', left(v_cle, 200), 'etat', sqlstate);
    end;
  end loop;

  insert into fabrique.facturations_du_jour
    (perimetre, jour, decision_id, emises, deja_emises, rien_a_facturer, erreurs, detail)
  values ('pme', p_jour, v_reglage.id, v_emises, v_deja, v_rien, jsonb_array_length(v_erreurs),
          jsonb_build_object('factures', v_factures, 'erreurs', v_erreurs, 'depuis', v_depuis));

  return jsonb_build_object(
    'etat', 'passee', 'decision', v_reglage.id,
    'emises', v_emises, 'deja_emises', v_deja, 'rien_a_facturer', v_rien,
    'erreurs', jsonb_array_length(v_erreurs), 'factures', v_factures, 'detail_erreurs', v_erreurs);
end
$$;

revoke all on function fabrique.facturation_des_pme(date) from public, anon, authenticated;

/*
 * Le passage du jour `p_jour` (le jour de la plateforme, que l'API lit en
 * base) : chaque périmètre ouvert, une fois par jour et par décision de la
 * tour. `etat` dit l'ensemble : `coupee` si les deux le sont, `passee` si
 * l'un a travaillé, `deja_passee` sinon. Chaque périmètre rend son bilan.
 */
create or replace function fabrique.facturation_du_jour(p_jour date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cab jsonb;
  v_pme jsonb;
begin
  if p_jour is null then
    raise exception 'refus.saisie.incomplete' using errcode = '22023';
  end if;
  -- Deux appels concurrents ne se croisent pas : le second attend, puis voit
  -- que le jour est passé.
  perform pg_advisory_xact_lock(hashtext('fabrique.facturation_du_jour.emission')::bigint);
  if not (plateforme.facturation_auto_ouverte('cabinets')
          or plateforme.facturation_auto_ouverte('pme')) then
    return jsonb_build_object('etat', 'coupee', 'jour', p_jour);
  end if;
  -- La date d'émission des factures du cabinet (`current_date` de son corps)
  -- est celle de la plateforme, pour la fin de cette transaction.
  perform set_config('TimeZone', plateforme.fuseau_de_la_plateforme(), true);

  v_cab := fabrique.facturation_des_cabinets(p_jour);
  v_pme := fabrique.facturation_des_pme(p_jour);
  return jsonb_build_object(
    'etat', case when 'passee' in (v_cab ->> 'etat', v_pme ->> 'etat') then 'passee'
                 else 'deja_passee' end,
    'jour', p_jour,
    'cabinets', v_cab,
    'pme', v_pme);
end
$$;

-- --------------------------------------------- 7. Le jour même : la montée, la place, la société

/*
 * Ce qu'un geste rend dû se facture sur le champ, si le périmètre PME est
 * ouvert : à partir d'aujourd'hui (le jour de la plateforme), y compris pour
 * un geste daté de la veille par un serveur à l'heure UTC. Un geste daté d'un
 * jour à venir attend le passage de ce jour-là. Un refus
 * (pas d'émetteur, destinataire sans nom…) n'arrête jamais le geste qui l'a
 * déclenché : il est dit au journal de la base, et le passage du jour
 * réessaie et le compte en erreur.
 */
create function facturation.facturer_sur_le_champ(p_licence uuid, p_jour date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reglage plateforme.reglages_facturation_auto := plateforme.facturation_auto_en_vigueur('pme');
  v_jour    date;
begin
  if p_licence is null or not coalesce(v_reglage.actif, false) then
    return null;
  end if;
  begin
    v_jour := (now() at time zone plateforme.fuseau_de_la_plateforme())::date;
    if p_jour is not null and p_jour > v_jour then
      return null;
    end if;
    return facturation.facturation_du_titulaire(p_licence, v_jour, v_reglage.rattrapage_mois,
                                                v_reglage.decide_par);
  exception when others then
    raise warning 'facturation.facturer_sur_le_champ(%) : %', p_licence, sqlerrm;
    return null;
  end;
end
$$;

revoke all on function facturation.facturer_sur_le_champ(uuid, date) from public, anon, authenticated;

/*
 * Les déclencheurs passent À LA VALIDATION (contrainte différée) : une
 * licence se crée, se rattache à sa société et reçoit l'accès de son cabinet
 * dans la même transaction, et la facture lit l'état final — jamais la
 * licence à demi montée, qu'elle facturerait au titulaire à la place du
 * cabinet. Ils sont `security definer` : la porte qui écrit (le portier, un
 * client) n'exécute rien de la facturation.
 */
create function facturation.un_changement_se_facture_sur_le_champ()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_licence uuid;
begin
  if tg_table_name = 'forfait_historique' then
    perform facturation.facturer_sur_le_champ(new.licence_id, new.effet_du);
  elsif tg_table_name in ('licence_organisations', 'acces') then
    perform facturation.facturer_sur_le_champ(new.licence_id, null);
  else
    select lo.licence_id into v_licence
      from facturation.licence_organisations lo where lo.tenant_id = new.tenant_id;
    perform facturation.facturer_sur_le_champ(v_licence, null);
  end if;
  return null;
end
$$;

revoke all on function facturation.un_changement_se_facture_sur_le_champ()
  from public, anon, authenticated;

create constraint trigger forfait_historique_se_facture_sur_le_champ
  after insert on facturation.forfait_historique
  deferrable initially deferred
  for each row execute function facturation.un_changement_se_facture_sur_le_champ();

create constraint trigger licence_organisations_se_facturent_sur_le_champ
  after insert on facturation.licence_organisations
  deferrable initially deferred
  for each row execute function facturation.un_changement_se_facture_sur_le_champ();

-- La fin de l'accès d'un cabinet : la PME reprend ce qu'il payait.
create constraint trigger acces_se_facture_sur_le_champ
  after update of statut on facturation.acces
  deferrable initially deferred
  for each row when (new.licence_id is not null)
  execute function facturation.un_changement_se_facture_sur_le_champ();

-- Une place de plus : une personne entre, ou change de rôle.
create constraint trigger memberships_se_facturent_sur_le_champ
  after insert or update of role on identity.memberships
  deferrable initially deferred
  for each row execute function facturation.un_changement_se_facture_sur_le_champ();

-- ------------------------------------------- 8. La montée se paie par sa facture complémentaire

/*
 * Repris de sa définition en vigueur (20261117110000). Périmètre PME ouvert,
 * la montée ne prépare plus d'acompte : elle émet tout de suite ce qu'elle
 * rend dû (le complément, ou l'échéance d'une suite qui commence ce jour-là)
 * et rend le paiement en ligne de cette facture. Un acompte déjà préparé
 * reste rendu tel quel, payable ; une fois payé, il s'impute sur l'échéance
 * suivante. Périmètre coupé : l'acompte, comme avant.
 */
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
  v_facture  uuid;
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

  if plateforme.facturation_auto_ouverte('pme') then
    perform facturation.facturer_sur_le_champ(v_licence, v_cour.effet_du);
    select x.id into v_facture
      from facturation.factures x
     where x.licence_id = v_licence and x.payeur_type = 'titulaire'
       and x.payeur_personne = auth.uid() and x.ancre is not null
       and x.couvre_du >= v_cour.effet_du and x.avoir_de is null and x.statut <> 'annulee'
     order by x.created_at desc, (x.nature = 'complement') desc
     limit 1;
    if v_facture is null then
      return null;   -- rien d'émis ce jour (l'écart est déjà couvert, ou le passage réessaiera).
    end if;
    return public.paiement_facture_preparer(v_facture);
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

-- ---------------------------------------------------------------- 9. Ce que la tour lit

/* Un périmètre : sa décision en vigueur (et qui l'a prise), son dernier passage. */
create function plateforme.facturation_auto_etat_du_perimetre(p_perimetre text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_reglage plateforme.reglages_facturation_auto := plateforme.facturation_auto_en_vigueur(p_perimetre);
begin
  return jsonb_build_object(
    'reglage',
      case when v_reglage.id is null then null else
        jsonb_build_object(
          'actif', v_reglage.actif, 'rattrapage_mois', v_reglage.rattrapage_mois,
          'motif', v_reglage.motif, 'decide_le', v_reglage.decide_le,
          'decide_par_email', (select u.email::text from auth.users u where u.id = v_reglage.decide_par),
          'decide_par_nom', (select p.display_name::text from identity.profiles p
                              where p.user_id = v_reglage.decide_par))
      end,
    'dernier',
      (select jsonb_build_object('jour', x.jour, 'passee_le', x.passee_le,
                                 'emises', x.emises, 'deja_emises', x.deja_emises,
                                 'rien_a_facturer', x.rien_a_facturer, 'erreurs', x.erreurs,
                                 'detail_erreurs', coalesce(x.detail -> 'erreurs', '[]'::jsonb))
         from fabrique.facturations_du_jour x
        where x.perimetre = p_perimetre
        order by x.passee_le desc, x.rang desc limit 1));
end
$$;

revoke all on function plateforme.facturation_auto_etat_du_perimetre(text)
  from public, anon, authenticated;

/* Pour la plateforme seule : les deux périmètres, chacun avec sa décision et son dernier passage. */
create function plateforme.facturation_auto_etat()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'cabinets', plateforme.facturation_auto_etat_du_perimetre('cabinets'),
    'pme', plateforme.facturation_auto_etat_du_perimetre('pme'));
end
$$;

revoke all on function plateforme.facturation_auto_etat() from public, anon;
grant execute on function plateforme.facturation_auto_etat() to authenticated;

-- --------------------------------------------- 10. L'année commence à l'anniversaire de la PME

/*
 * Une PME facturée à sa date anniversaire a déjà payé d'avance sa période en
 * cours : son année commence à l'échéance suivante, et se facture ce jour-là
 * (une ligne, douze mois — 20261022190000, inchangé), sur l'échéance qui
 * l'ouvre ; ensuite, chaque anniversaire ne facture que les places et
 * sociétés en plus (aucune facture sans elles). Une PME encore facturée au
 * mois garde le premier du mois suivant, comme avant. Le premier du mois
 * cesse donc d'être une règle de l'engagement.
 */
alter table facturation.engagements_annuels drop constraint engagements_annuels_du_check;

-- Repris de sa définition en vigueur (`pg_get_functiondef` d'une base migrée) ;
-- seul change `v_du`.
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
