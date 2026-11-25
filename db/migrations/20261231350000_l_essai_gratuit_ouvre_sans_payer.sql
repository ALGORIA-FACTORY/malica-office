-- L'essai gratuit (décision du CEO, 25 novembre 2026).
--
-- « La période d'essai, en nombre de jours, paramétrable dans la tour, ne concerne que les
-- nouvelles entrées. Le client peut l'interrompre. Le passage à l'abonnement et le paiement se
-- font en un clic. Une comptabilité qui appelle ses clients : pas d'essai (sauf le client qui
-- paie seul, à venir). » Choix du 25/11 : Basic pendant l'essai ; à la fin, sans paiement, le
-- dossier est fermé — seule la page de paiement reste ouverte ; « interrompre », c'est payer
-- plus tôt.
--
-- 1. `plateforme.reglages_abonnement.essai_jours` : 0 = pas d'essai. La tour le règle avec
--    le reste de l'abonnement, daté et motivé.
-- 2. `facturation.essais` : un essai par licence, posé à SA naissance (`licence_naitre`) avec
--    les jours réglés à cet instant, figés. Les licences nées avant n'en ont pas : rien ne
--    change pour elles. Une société amenée par une comptabilité n'en a pas.
-- 3. `periodes_v` : pendant l'essai, la part de la PME est nulle. Aucune facture ne naît donc
--    avant le paiement, et la société s'ouvre sans payer. L'essai court de son début jusqu'au
--    jour où il se clôt (paiement, ou prise en charge par une comptabilité) — un essai échu et
--    non payé ne se facture pas non plus : on ne fabrique pas de dette.
-- 4. Passer à l'abonnement = `forfait_demander` sur une licence en essai : payé d'abord (la
--    machine de la montée demandée, extraite en `facturation.montee_demandee_ouvrir`). Au
--    paiement, l'essai se clôt au jour de la demande et la première base naît réglée ; la
--    date anniversaire est ce jour-là.
-- 5. `app.licence_active` : un essai échu non payé ferme le dossier.
-- 6. `public.mon_essai` pour l'écran ; `notif.prevenir_les_essais` (fin proche, fin) appelé
--    par le travailleur horaire des relances, une fois par essai et par avis.

begin;

-- ---------------------------------------------------------------- 1. le réglage
alter table plateforme.reglages_abonnement
  add column essai_jours smallint not null default 0
    constraint reglages_abonnement_essai_jours_borne check (essai_jours between 0 and 90);

drop function plateforme.abonnement_regler(smallint, boolean, smallint, text);
create function plateforme.abonnement_regler(p_report_mois smallint, p_annuel_ouvert boolean,
  p_annuel_mois_offerts smallint, p_essai_jours smallint, p_motif text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_id      uuid;
  v_courant plateforme.reglages_abonnement;
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  select r.* into v_courant
    from plateforme.reglages_abonnement r order by r.decide_le desc, r.id desc limit 1;
  insert into plateforme.reglages_abonnement
    (report_mois, annuel_ouvert, annuel_mois_offerts, essai_jours, lien_valide_minutes,
     alerte_lectures_part, motif, decide_par)
  values (p_report_mois, p_annuel_ouvert, p_annuel_mois_offerts, p_essai_jours,
          coalesce(v_courant.lien_valide_minutes, 60),
          coalesce(v_courant.alerte_lectures_part, 0.100),
          p_motif, auth.uid())
  returning id into v_id;
  return (select to_jsonb(r) - 'decide_par' from plateforme.reglages_abonnement r where r.id = v_id);
end
$function$;
revoke all on function plateforme.abonnement_regler(smallint, boolean, smallint, smallint, text)
  from public, anon;
grant execute on function plateforme.abonnement_regler(smallint, boolean, smallint, smallint, text)
  to authenticated;

create or replace function public.abonnement_reglage()
 returns jsonb
 language sql
 stable security definer
 set search_path to ''
as $function$
  select coalesce(
    (select jsonb_build_object('report_mois', r.report_mois,
                               'annuel_ouvert', r.annuel_ouvert,
                               'annuel_mois_offerts', r.annuel_mois_offerts,
                               'essai_jours', r.essai_jours,
                               'lien_valide_minutes', r.lien_valide_minutes,
                               'alerte_lectures_part', r.alerte_lectures_part,
                               'motif', r.motif, 'decide_le', r.decide_le)
       from plateforme.reglages_abonnement r
      order by r.decide_le desc, r.id desc limit 1),
    jsonb_build_object('report_mois', 0, 'annuel_ouvert', false, 'annuel_mois_offerts', 0,
                       'essai_jours', 0, 'lien_valide_minutes', null,
                       'alerte_lectures_part', null, 'motif', null, 'decide_le', null))
$function$;

-- ---------------------------------------------------------------- 2. l'essai d'une licence
create table facturation.essais (
  licence_id  uuid primary key references facturation.licences (id),
  debut       date not null,
  jours       smallint not null check (jours > 0),
  fin         date generated always as (debut + jours) stored,
  converti_le date,
  motif_fin   text check (motif_fin in ('paiement', 'prise_en_charge')),
  reglage_id  uuid not null references plateforme.reglages_abonnement (id),
  created_at  timestamptz not null default now(),
  constraint essais_clos_avec_son_motif check ((converti_le is null) = (motif_fin is null)),
  constraint essais_clos_apres_leur_debut check (converti_le is null or converti_le >= debut)
);
comment on table facturation.essais is
  'L''essai gratuit d''une licence née seule (25/11/2026) : [debut, converti_le) sans part PME.';
alter table facturation.essais enable row level security;
revoke all on facturation.essais from public, anon, authenticated;

-- Un essai ne se réécrit pas : seule sa clôture s'écrit, une fois.
create function facturation.un_essai_ne_se_clot_qu_une_fois()
 returns trigger
 language plpgsql
 set search_path to ''
as $function$
begin
  if tg_op = 'DELETE'
     or new.licence_id is distinct from old.licence_id or new.debut is distinct from old.debut
     or new.jours is distinct from old.jours or new.reglage_id is distinct from old.reglage_id
     or old.converti_le is not null then
    raise exception 'refus.essai.fige' using errcode = 'check_violation';
  end if;
  return new;
end
$function$;
create trigger essais_se_closent_une_fois before update or delete on facturation.essais
  for each row execute function facturation.un_essai_ne_se_clot_qu_une_fois();

create function facturation.essai_ouvert(p_licence uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$
  select exists (select 1 from facturation.essais e
                  where e.licence_id = p_licence and e.converti_le is null)
$function$;
revoke all on function facturation.essai_ouvert(uuid) from public, anon, authenticated;

create function facturation.essai_clore(p_licence uuid, p_le date, p_motif text)
 returns void
 language sql
 security definer
 set search_path to ''
as $function$
  update facturation.essais e
     set converti_le = greatest(p_le, e.debut), motif_fin = p_motif
   where e.licence_id = p_licence and e.converti_le is null
$function$;
revoke all on function facturation.essai_clore(uuid, date, text) from public, anon, authenticated;

-- Amenée par une comptabilité : créée ou invitée (rôle dirigeant) par un membre d'un cabinet.
-- La même règle que `comptabilite_a_invite`, pour un cabinet quelconque.
create function facturation.amenee_par_une_comptabilite(p_pme uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$
  select exists (
           select 1
             from identity.organizations o
             join identity.memberships m on m.user_id = o.created_by
             join identity.organizations c on c.id = m.tenant_id and c.kind = 'cabinet'
            where o.id = p_pme)
      or exists (
           select 1
             from identity.invitations i
             join identity.memberships m on m.user_id = i.invited_by
             join identity.organizations c on c.id = m.tenant_id and c.kind = 'cabinet'
            where i.tenant_id = p_pme and i.role = 'dirigeant' and i.revoked_at is null)
$function$;
revoke all on function facturation.amenee_par_une_comptabilite(uuid)
  from public, anon, authenticated;

-- Une comptabilité qui prend la licence en charge met fin à l'essai : elle paie dès ce jour.
create function facturation.une_prise_en_charge_clot_l_essai()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  if new.canal = 'cabinet' and new.statut = 'actif' and new.licence_id is not null then
    perform facturation.essai_clore(new.licence_id, coalesce(new.effet_du, current_date),
                                    'prise_en_charge');
  end if;
  return new;
end
$function$;
create trigger acces_clot_l_essai after insert or update of statut on facturation.acces
  for each row execute function facturation.une_prise_en_charge_clot_l_essai();

-- ---------------------------------------------------------------- 3. pendant l'essai, rien n'est dû
CREATE OR REPLACE VIEW facturation.periodes_v WITH (security_invoker = true) AS  WITH bornes AS (
         SELECT h_1.licence_id,
            h_1.effet_du AS jour
           FROM facturation.forfait_historique h_1
        UNION
         SELECT h_1.licence_id,
            h_1.effet_au
           FROM facturation.forfait_historique h_1
          WHERE (h_1.effet_au IS NOT NULL)
        UNION
         SELECT h_1.licence_id,
            h_1.garde_jusqu_au
           FROM facturation.forfait_historique h_1
          WHERE (h_1.garde_jusqu_au IS NOT NULL)
        UNION
         SELECT a.licence_id,
            a.effet_du
           FROM facturation.acces a
          WHERE ((a.licence_id IS NOT NULL) AND (a.effet_du IS NOT NULL))
        UNION
         SELECT a.licence_id,
            a.effet_au
           FROM facturation.acces a
          WHERE ((a.licence_id IS NOT NULL) AND (a.effet_au IS NOT NULL))
        UNION
         SELECT a.licence_id,
            a.franchise_jusqu_au
           FROM facturation.acces a
          WHERE ((a.licence_id IS NOT NULL) AND (a.franchise_jusqu_au IS NOT NULL))
        UNION
         SELECT e.licence_id,
            e.debut
           FROM facturation.essais e
        UNION
         SELECT e.licence_id,
            e.converti_le
           FROM facturation.essais e
          WHERE (e.converti_le IS NOT NULL)
        ), segments AS (
         SELECT b.licence_id,
            b.jour AS du,
            lead(b.jour) OVER (PARTITION BY b.licence_id ORDER BY b.jour) AS au_exclu
           FROM bornes b
        )
 SELECT s.licence_id,
    s.du,
    s.au_exclu,
    (s.au_exclu - 1) AS au,
    l.titulaire,
    l.origine,
    l.origine_cabinet,
    h.id AS forfait_id,
    COALESCE(g.offre_code, h.offre_code) AS offre_code,
    COALESCE(g.offre_depuis, h.offre_depuis) AS offre_depuis,
    h.canal,
    h.motif AS forfait_motif,
    o.libelle AS offre_libelle,
    o.rang AS offre_rang,
    p.organisations,
    p.sieges_occupes,
    o.prix_mensuel_ht AS prix_offre_ht,
    t.prix_total_ht,
    ca.acces_id,
    ca.acces_reference,
    ca.reference_vivante,
    ca.cabinet_tenant_id,
    ca.acces_offre_code,
    ca.plancher_rang,
    ca.plancher_offre_code,
    (LEAST(COALESCE(ca.base_cabinet, (0)::numeric), (t.prix_total_ht)::numeric))::app.money_t AS part_cabinet_ht,
    (CASE
        WHEN (es.licence_id IS NOT NULL) THEN (0)::numeric
        ELSE ((t.prix_total_ht)::numeric - LEAST(COALESCE(ca.base_cabinet, (0)::numeric), (t.prix_total_ht)::numeric))
    END)::app.money_t AS part_pme_ht,
    ((COALESCE(ca.vivants, (0)::bigint) > 0) OR (l.titulaire IS NOT NULL)) AS facturable,
    (es.licence_id IS NOT NULL) AS en_essai
   FROM (((((((segments s
     JOIN facturation.licences l ON ((l.id = s.licence_id)))
     JOIN facturation.forfait_historique h ON (((h.licence_id = s.licence_id) AND (h.effet_du <= s.du) AND ((h.effet_au IS NULL) OR (h.effet_au > s.du)))))
     LEFT JOIN facturation.forfait_historique g ON (((g.id = h.garde_forfait_id) AND (h.garde_jusqu_au > s.du))))
     CROSS JOIN LATERAL ref.offre_a(COALESCE(g.offre_code, h.offre_code), COALESCE(g.offre_depuis, h.offre_depuis)) o(id, code, libelle, prix_mensuel_ht, lectures_par_organisation, sieges_inclus, sieges_max, prix_siege_sup, lectures_par_siege_sup, organisations_incluses, organisations_max, prix_organisation_sup, effective_from, created_at, rang, recharges_permises))
     JOIN facturation.places_v p ON ((p.licence_id = s.licence_id)))
     CROSS JOIN LATERAL ( SELECT ((((o.prix_mensuel_ht)::numeric + ((o.prix_siege_sup)::numeric * (GREATEST(0, (p.sieges_occupes - o.sieges_inclus)))::numeric)) + ((o.prix_organisation_sup)::numeric * (GREATEST(0, (p.organisations - o.organisations_incluses)))::numeric)))::app.money_t AS prix_total_ht) t)
     LEFT JOIN LATERAL ( SELECT count(*) AS vivants,
            sum(((oa.prix_mensuel_ht)::numeric -
                CASE
                    WHEN (a.franchise_jusqu_au > s.du) THEN (a.franchise_ht)::numeric
                    ELSE (0)::numeric
                END)) FILTER (WHERE (a.canal = 'cabinet'::text)) AS base_cabinet,
            max(oa.rang) FILTER (WHERE (a.canal = 'cabinet'::text)) AS plancher_rang,
            (array_agg(a.offre_code ORDER BY oa.rang DESC) FILTER (WHERE (a.canal = 'cabinet'::text)))[1] AS plancher_offre_code,
            (array_agg(a.offre_code ORDER BY oa.rang DESC) FILTER (WHERE (a.canal = 'cabinet'::text)))[1] AS acces_offre_code,
            (array_agg(a.cabinet_tenant_id ORDER BY oa.rang DESC) FILTER (WHERE (a.canal = 'cabinet'::text)))[1] AS cabinet_tenant_id,
            (array_agg(a.id ORDER BY oa.rang DESC) FILTER (WHERE (a.canal = 'cabinet'::text)))[1] AS acces_id,
            (array_agg(a.reference ORDER BY oa.rang DESC) FILTER (WHERE (a.canal = 'cabinet'::text)))[1] AS acces_reference,
            (array_agg(a.reference ORDER BY oa.rang DESC))[1] AS reference_vivante
           FROM (facturation.acces a
             CROSS JOIN LATERAL ref.offre_a(a.offre_code, a.offre_depuis) oa(id, code, libelle, prix_mensuel_ht, lectures_par_organisation, sieges_inclus, sieges_max, prix_siege_sup, lectures_par_siege_sup, organisations_incluses, organisations_max, prix_organisation_sup, effective_from, created_at, rang, recharges_permises))
          WHERE ((a.licence_id = s.licence_id) AND (a.effet_du IS NOT NULL) AND (a.effet_du <= s.du) AND ((a.effet_au IS NULL) OR (a.effet_au > s.du)))) ca ON (true))
     LEFT JOIN facturation.essais es ON (((es.licence_id = s.licence_id) AND (es.debut <= s.du) AND ((es.converti_le IS NULL) OR (es.converti_le > s.du))))
  WHERE ((s.au_exclu IS NULL) OR (s.au_exclu > s.du));

-- ---------------------------------------------------------------- naissance
CREATE OR REPLACE FUNCTION facturation.licence_naitre(p_tenant uuid, p_titulaire uuid, p_offre text DEFAULT NULL::text, p_le date DEFAULT CURRENT_DATE)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_licence uuid;
  v_kind    text;
  v_offre   text;
  v_essai   plateforme.reglages_abonnement;
begin
  -- D'ABORD la nature de la société, ENSUITE la porte. Dans l'autre ordre,
  -- un cabinet — dont le créateur est `expert`, jamais `dirigeant` — butait
  -- sur la porte au lieu d'être ignoré, et `create_organization` refusait
  -- d'ouvrir le moindre cabinet. Relevé par les épreuves, pas par la relecture.
  select o.kind into v_kind from identity.organizations o where o.id = p_tenant;
  if v_kind is distinct from 'pme' then
    return null;   -- un cabinet n'est pas abonné : il ouvre des accès.
  end if;

  -- La porte : le dirigeant de la société, ou la plateforme. Sans session
  -- (le rattrapage d'une migration), c'est la migration qui décide.
  if auth.uid() is not null
     and not (app.is_platform() or app.has_org_role(p_tenant, array['dirigeant'])) then
    raise exception 'refus.reserve.dirigeant_ou_plateforme'
      using errcode = '42501';
  end if;

  -- Idempotente : une société ne porte qu'une licence, et la sienne se rend.
  select lo.licence_id into v_licence
    from facturation.licence_organisations lo where lo.tenant_id = p_tenant;
  if v_licence is not null then
    return v_licence;
  end if;

  v_offre := p_offre;
  if v_offre is null then
    select c.offre_code into v_offre
      from ref.offres_par_canal c
     where c.canal = 'direct' and c.par_defaut and c.effective_from <= p_le
     order by c.effective_from desc
     limit 1;
    -- Aucun repli : sans offre de naissance en vigueur, on ne l'invente pas.
    if v_offre is null then
      raise exception '%', app.refus_avec_valeurs('refus.offre.naissance_absente', 'date', (p_le)::text)
        using errcode = '22023';
    end if;
  end if;

  -- Le déclencheur `licences_ouvre_historique` ouvre la première période ;
  -- `rattachement_legitime` vérifie que le titulaire dirige la société.
  insert into facturation.licences (titulaire, offre_code, offre_depuis, origine)
  values (p_titulaire, v_offre, p_le, 'direct')
  returning id into v_licence;

  insert into facturation.licence_organisations (licence_id, tenant_id)
  values (v_licence, p_tenant);

  -- L'essai gratuit (25 novembre 2026) : une entrée NOUVELLE, inscrite seule, reçoit les jours
  -- que la tour a réglés à cet instant ; ils se figent sur l'essai. Une société amenée par une
  -- comptabilité n'en a pas : c'est la comptabilité qui paie, dès le premier jour.
  select r.* into v_essai
    from plateforme.reglages_abonnement r order by r.decide_le desc, r.id desc limit 1;
  if coalesce(v_essai.essai_jours, 0) > 0
     and not facturation.amenee_par_une_comptabilite(p_tenant) then
    insert into facturation.essais (licence_id, debut, jours, reglage_id)
    values (v_licence, p_le, v_essai.essai_jours, v_essai.id);
  end if;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (p_tenant, coalesce(auth.uid(), p_titulaire), 'licence.nee', 'facturation',
          'licences', v_licence, jsonb_build_object('offre', v_offre, 'depuis', p_le));

  return v_licence;
end
$function$;

-- ---------------------------------------------------------------- 4. passer à l'abonnement
CREATE OR REPLACE FUNCTION facturation.montee_demandee_ouvrir(
  p_licence uuid, p_tenant uuid, p_offre text, p_ht numeric, p_tva numeric, p_timbre numeric,
  p_ttc numeric, p_devise text, p_libelle text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
-- La demande payée d'abord, et son paiement à régler : un seul chemin pour la montée et pour
-- le passage de l'essai à l'abonnement (extrait de `forfait_demander`, 25 novembre 2026).
declare
  v_le     date;
  f        record;
  v_dem    uuid;
  v_id     uuid;
begin
  -- Le jour du devis : celui de la plateforme (il y a un émetteur).
  v_le := (now() at time zone plateforme.fuseau_de_la_plateforme())::date;

  -- La même demande, encore à payer : on la rend telle quelle.
  select p.id into v_id
    from facturation.montees_demandees d
    join facturation.paiements_en_ligne p on p.montee_demandee_id = d.id
    join facturation.paiements_en_ligne_v v on v.paiement_id = p.id
   where d.licence_id = p_licence and d.offre_code = p_offre and d.le = v_le
     and v.etat in ('a_payer', 'lien_cree', 'non_abouti', 'refuse')
   order by d.cree_le desc limit 1;
  if v_id is not null then
    return jsonb_build_object('change', false, 'paiement',
      (select to_jsonb(v) from facturation.paiements_en_ligne_v v where v.paiement_id = v_id));
  end if;

  select * into f from facturation.fiscalite_en_vigueur(v_le);

  insert into facturation.montees_demandees (licence_id, par_societe, offre_code, le, demande_par)
  values (p_licence, p_tenant, p_offre, v_le, auth.uid())
  returning id into v_dem;

  insert into facturation.paiements_en_ligne
    (licence_id, objet, montee_demandee_id, libelle, montant_ht, taux_tva, montant_tva, timbre,
     montant_ttc, devise, cree_par)
  values
    (p_licence, 'montee_demandee', v_dem, p_libelle, p_ht, f.taux, p_tva, p_timbre, p_ttc,
     coalesce(p_devise, f.devise), auth.uid())
  returning id into v_id;

  return jsonb_build_object('change', false, 'paiement',
    (select to_jsonb(v) from facturation.paiements_en_ligne_v v where v.paiement_id = v_id));
end
$function$;
revoke all on function facturation.montee_demandee_ouvrir(uuid, uuid, text, numeric, numeric, numeric, numeric, text, text)
  from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.forfait_demander(p_offre text, p_tenant uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_licence uuid := facturation.ma_licence(p_tenant);
  v_courant text;
  v_auto    boolean := plateforme.facturation_auto_ouverte('pme');
  v_annee   boolean;
  v_devis   jsonb;
  v_sim     jsonb;
  v_ht      numeric;
  v_tva     numeric;
  v_timbre  numeric;
  v_ttc     numeric;
  v_devise  text;
  v_libelle text;
  v_programmee jsonb;
begin
  select c.offre_code into v_courant
    from facturation.forfait_courant_v c where c.licence_id = v_licence;

  -- EN ESSAI (25 novembre 2026) : passer à l'abonnement se paie d'abord, quelle que soit
  -- l'offre — la même ou une autre. Le montant est la première base, jouée puis défaite par
  -- la fonction même qui l'émettra au paiement ; l'essai se clôt au paiement, pas avant.
  if facturation.essai_ouvert(v_licence) then
    if not v_auto
       or not exists (select 1 from facturation.emetteurs em where em.valide_des <= current_date) then
      raise exception 'refus.forfait.paiement_indisponible' using errcode = 'check_violation';
    end if;
    v_sim := facturation.montee_a_regler(v_licence, p_offre, p_tenant,
                                         (now() at time zone plateforme.fuseau_de_la_plateforme())::date);
    if coalesce((v_sim ->> 'rien')::boolean, false) then
      raise exception 'refus.forfait.paiement_indisponible' using errcode = 'check_violation';
    end if;
    return facturation.montee_demandee_ouvrir(
      v_licence, p_tenant, p_offre, (v_sim ->> 'ht')::numeric, (v_sim ->> 'tva')::numeric,
      (v_sim ->> 'timbre')::numeric, (v_sim ->> 'ttc')::numeric, v_sim ->> 'devise',
      'Abonnement ' || initcap(p_offre)
        || ' — du ' || to_char((v_sim ->> 'du')::date, 'DD/MM/YYYY')
        || ' au ' || to_char((v_sim ->> 'au')::date, 'DD/MM/YYYY'));
  end if;

  -- Une descente ne se paie pas. Sous la facturation d'avance, elle attend la fin de la
  -- période payée : le client garde jusque-là ce qu'il a payé (CGV, art. 8). Sinon, elle
  -- garde son chemin. `forfait_changer` dit ses refus.
  if v_licence is null or v_courant is null
     or (ref.offre_a(p_offre, current_date)).rang is null
     or (ref.offre_a(p_offre, current_date)).rang <= (ref.offre_a(v_courant, current_date)).rang then
    if v_licence is not null and v_courant is not null
       and (ref.offre_a(p_offre, current_date)).rang is not null then
      v_programmee := facturation.descente_programmer(v_licence, p_offre, p_tenant);
      if v_programmee is not null then
        return jsonb_build_object('change', false, 'paiement', null, 'descente', v_programmee);
      end if;
    end if;
    perform public.forfait_changer(p_offre, p_tenant);
    return jsonb_build_object('change', true, 'paiement', public.paiement_montee_preparer(p_tenant));
  end if;

  -- Une montée annule la descente qui attendait l'échéance : le client a changé d'avis.
  perform facturation.descente_annuler_pour(v_licence, 'montee');

  -- Rien que la société paie elle-même (sa comptabilité la prend entièrement en charge) :
  -- l'offre s'ouvre tout de suite. `mes_offres` rend le prix qu'elle paie, nul sinon.
  if (select m.prix_mensuel_ht from public.mes_offres(p_tenant) m where m.code = p_offre) is null then
    perform public.forfait_changer(p_offre, p_tenant);
    return jsonb_build_object('change', true, 'paiement', null);
  end if;

  -- Aucun paiement possible : aucune montée gratuite (20261231150000).
  if not exists (select 1 from facturation.emetteurs em where em.valide_des <= current_date) then
    raise exception 'refus.forfait.paiement_indisponible' using errcode = 'check_violation';
  end if;

  -- Les refus du changement (la porte, l'empêchement) se disent AVANT de faire payer.
  v_annee := exists (select 1 from facturation.engagements_annuels e
                      where e.licence_id = v_licence and e.au >= current_date);
  if v_annee then
    -- Pendant l'année, le montant est celui que le chemin de l'année calcule (l'écart des
    -- jours au mois et celui de l'année, les montées remplacées non réglées) : il est JOUÉ,
    -- puis défait. Sur ce chemin, rien ne s'émet ni ne se numérote — seulement l'historique,
    -- la montée de l'engagement et l'acompte, tous défaits.
    begin
      perform public.forfait_changer(p_offre, p_tenant);
      v_sim := public.paiement_montee_preparer(p_tenant);
      raise exception using errcode = 'MLM02', detail = coalesce(v_sim::text, 'null');
    exception when sqlstate 'MLM02' then
      get stacked diagnostics v_libelle = pg_exception_detail;
      v_sim := nullif(v_libelle, 'null')::jsonb;
    end;
    if v_sim is null then
      perform public.forfait_changer(p_offre, p_tenant);
      return jsonb_build_object('change', true, 'paiement', null);
    end if;
    v_ht := (v_sim ->> 'montant_ht')::numeric;
    v_tva := (v_sim ->> 'montant_tva')::numeric;
    v_ttc := (v_sim ->> 'montant_ttc')::numeric;
    v_timbre := v_ttc - v_ht - v_tva;
    v_devise := v_sim ->> 'devise';
    v_libelle := v_sim ->> 'libelle';
  elsif v_auto then
    -- SOUS LA FACTURATION D'AVANCE : le montant est la facture que la montée émettra, JOUÉE
    -- puis défaite par la fonction même qui l'émettra (`montee_a_regler`). Un seul calcul,
    -- pour tous les cas : complément au-dessus de ce qui est payé, offre gardée, comptabilité
    -- qui paie une part, aucune facture d'avance encore. Rien d'émis : rien n'est dû, la
    -- période payée couvre déjà l'offre demandée — elle s'ouvre (recette Flouci du
    -- 24 novembre 2026, point 1 : « Basic → Solo » sous un Premium payé était refusé).
    v_sim := facturation.montee_a_regler(v_licence, p_offre, p_tenant,
                                         (now() at time zone plateforme.fuseau_de_la_plateforme())::date);
    if coalesce((v_sim ->> 'rien')::boolean, false) then
      perform public.forfait_changer(p_offre, p_tenant);
      return jsonb_build_object('change', true, 'paiement', null);
    end if;
    v_ht := (v_sim ->> 'ht')::numeric;
    v_tva := (v_sim ->> 'tva')::numeric;
    v_timbre := (v_sim ->> 'timbre')::numeric;
    v_ttc := (v_sim ->> 'ttc')::numeric;
    v_devise := v_sim ->> 'devise';
    v_libelle := 'Passage ' || initcap(v_courant) || ' → ' || initcap(p_offre)
      || ' — du ' || to_char((v_sim ->> 'du')::date, 'DD/MM/YYYY')
      || ' au ' || to_char((v_sim ->> 'au')::date, 'DD/MM/YYYY');
  else
    begin
      perform public.forfait_changer(p_offre, p_tenant);
      raise exception using errcode = 'MLM01';
    exception when sqlstate 'MLM01' then
      null;
    end;
    -- Au mois (périmètre coupé) : le devis, qui suit la formule de la préparation du
    -- paiement (R3). Rien ne se chiffre que si rien n'est dû : l'offre s'ouvre.
    v_devis := public.montee_devis(p_offre, p_tenant);
    if (v_devis ->> 'a_regler_ttc') is null then
      perform public.forfait_changer(p_offre, p_tenant);
      return jsonb_build_object('change', true, 'paiement', null);
    end if;
    v_ht := (v_devis ->> 'a_regler_ht')::numeric;
    v_tva := (v_devis ->> 'a_regler_tva')::numeric;
    v_timbre := coalesce((v_devis ->> 'timbre')::numeric, 0);
    v_ttc := v_ht + v_tva + v_timbre;
    v_devise := v_devis ->> 'devise';
    v_libelle := 'Passage ' || initcap(v_courant) || ' → ' || initcap(p_offre)
      || ' — ' || (v_devis ->> 'jours_restants') || '/' || (v_devis ->> 'jours_du_mois') || ' jours';
  end if;

  return facturation.montee_demandee_ouvrir(v_licence, p_tenant, p_offre, v_ht, v_tva, v_timbre,
                                            v_ttc, v_devise, v_libelle);
end
$function$;

CREATE OR REPLACE FUNCTION facturation.montee_a_regler(p_licence uuid, p_offre text, p_tenant uuid, p_jour date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_reglage plateforme.reglages_facturation_auto := plateforme.facturation_auto_en_vigueur('pme');
  v_det     text;
  v_avant   uuid[];
  r         jsonb;
begin
  if p_licence is null or not facturation.titulaire_de(p_licence) then
    raise exception 'refus.reserve.proprietaire_principal' using errcode = '42501';
  end if;
  -- Les factures qui existaient avant le jeu : seule compte celle que le jeu émet.
  select coalesce(array_agg(x.id), '{}') into v_avant
    from facturation.factures x where x.licence_id = p_licence;
  begin
    -- En essai, le jeu clôt d'abord l'essai ce jour-là : la facture jouée est la première
    -- base, de ce jour à la même date le mois suivant.
    perform facturation.essai_clore(p_licence, p_jour, 'paiement');
    if p_offre is distinct from (select c.offre_code from facturation.forfait_courant_v c
                                  where c.licence_id = p_licence) then
      perform public.forfait_changer(p_offre, p_tenant, p_jour);
    end if;
    perform facturation.facturation_du_titulaire(p_licence, p_jour, v_reglage.rattrapage_mois,
                                                 v_reglage.decide_par);
    select jsonb_build_object(
             'ht', x.montant_ht, 'tva', x.montant_tva, 'timbre', x.timbre, 'ttc', x.montant_ttc,
             'devise', x.devise, 'du', greatest(x.couvre_du, p_jour), 'au', x.couvre_au - 1,
             'jours', x.couvre_au - greatest(x.couvre_du, p_jour),
             'jours_periode', x.couvre_au - x.couvre_du)
      into r
      from facturation.factures x
      join facturation.licences l on l.id = x.licence_id
     where x.licence_id = p_licence and x.payeur_type = 'titulaire'
       and x.payeur_personne = l.titulaire and x.ancre is not null
       and x.avoir_de is null and x.statut <> 'annulee'
       and x.couvre_du <= p_jour and x.couvre_au > p_jour
       and x.emise_le = p_jour
       and not (x.id = any (v_avant))   -- émise par CE jeu, pas avant lui
     order by x.couvre_du desc
     limit 1;
    if r is null then
      r := jsonb_build_object('rien', true,
                              'au', (facturation.periode_payee_d_avance(p_licence, p_jour)).fin - 1);
    end if;
    raise exception using errcode = 'MLM03', detail = r::text;
  exception when sqlstate 'MLM03' then
    get stacked diagnostics v_det = pg_exception_detail;
  end;
  return v_det::jsonb;
end
$function$;

CREATE OR REPLACE FUNCTION facturation.une_montee_payee_s_ouvre()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  d         facturation.montees_demandees;
  p         facturation.paiements_en_ligne;
  v_rendu   text := coalesce(current_setting('request.jwt.claim.sub', true), '');
  v_ouvert  uuid;
  v_facture uuid;
  v_enc     uuid;
  v_jour    date;
  v_reste   numeric;
  v_avant   uuid[];
  v_reglage plateforme.reglages_facturation_auto;
begin
  if new.etat <> 'paye' then
    return new;
  end if;
  -- Un « payé » du simulateur ne fait entrer aucun argent : il n'ouvre rien, comme il
  -- ne règle aucune facture (audit du 23 novembre 2026, B3).
  if not exists (select 1 from facturation.prestataires_paiement pp
                  where pp.code = new.prestataire and pp.fait_entrer_argent) then
    return new;
  end if;
  select x.* into p from facturation.paiements_en_ligne x
   where x.id = new.paiement_id and x.objet = 'montee_demandee';
  if p.id is null then
    return new;
  end if;
  select m.* into d from facturation.montees_demandees m where m.id = p.montee_demandee_id;
  if exists (select 1 from facturation.montees_ouvertes o where o.montee_id = d.id) then
    return new;
  end if;

  perform set_config('request.jwt.claim.sub', d.demande_par::text, true);
  begin
    -- Le paiement qui met fin à un essai l'arrête au jour de la demande (25 novembre 2026).
    perform facturation.essai_clore(d.licence_id, d.le, 'paiement');
    if d.offre_code is distinct from (select c.offre_code from facturation.forfait_courant_v c
                                       where c.licence_id = d.licence_id) then
      perform public.forfait_changer(d.offre_code, d.par_societe, d.le);
    end if;
    select c.id into v_ouvert from facturation.forfait_courant_v c where c.licence_id = d.licence_id;
    insert into facturation.montees_ouvertes (montee_id, forfait_id) values (d.id, v_ouvert);

    if plateforme.facturation_auto_ouverte('pme')
       and exists (select 1 from facturation.prestataires_paiement pp
                    where pp.code = new.prestataire and pp.fait_entrer_argent)
       and not exists (select 1 from facturation.paiement_imputations i where i.paiement_id = p.id) then
      -- La facture se tire par la fonction même que le devis a jouée : celle qui couvre le
      -- jour porte le paiement. Une erreur d'émission remonte au bloc ci-dessous (le refus
      -- s'écrit, la tour le voit) au lieu d'être avalée en avertissement.
      v_jour := (now() at time zone plateforme.fuseau_de_la_plateforme())::date;
      v_reglage := plateforme.facturation_auto_en_vigueur('pme');
      select coalesce(array_agg(x.id), '{}') into v_avant
        from facturation.factures x where x.licence_id = d.licence_id;
      -- La facture qui naît de ce paiement naît réglée : son avis le dit (20261231270000).
      perform set_config('malica.paye_d_abord_le', v_jour::text, true);
      perform facturation.facturation_du_titulaire(d.licence_id, v_jour, v_reglage.rattrapage_mois,
                                                   v_reglage.decide_par);
      perform set_config('malica.paye_d_abord_le', '', true);
      -- La facture que CE paiement vient d'émettre et qui couvre le jour : la même que le
      -- devis a jouée (`montee_a_regler`).
      select x.id into v_facture
        from facturation.factures x
       where x.licence_id = d.licence_id and x.payeur_type = 'titulaire'
         and x.payeur_personne = d.demande_par and x.ancre is not null
         and x.avoir_de is null and x.statut <> 'annulee'
         and x.couvre_du <= v_jour and x.couvre_au > v_jour
         and x.emise_le = v_jour
         and not (x.id = any (v_avant))
       order by x.couvre_du desc
       limit 1;
      -- Une BASE émise impute d'elle-même les acomptes payés en ligne (`emission_du_titulaire`) :
      -- ce paiement l'est alors déjà, il ne s'impute pas deux fois.
      if v_facture is not null
         and not exists (select 1 from facturation.paiement_imputations i where i.paiement_id = p.id) then
        select e.reste_du into v_reste from facturation.encours_v e where e.facture_id = v_facture;
        insert into facturation.encaissements (facture_id, montant, moyen, reference, encaisse_le)
        values (v_facture, p.montant_ttc, facturation.moyen_encaissement_du_paiement(p.id),
                new.prestataire || ' ' || coalesce(new.reference, p.id::text), new.le::date)
        returning id into v_enc;
        insert into facturation.paiement_imputations (paiement_id, encaissement_id)
        values (p.id, v_enc);
        -- Payé plus que la facture (le jour a changé entre la demande et le paiement) :
        -- la différence est due au client, la tour la voit au journal.
        if v_reste is not null and p.montant_ttc > v_reste then
          insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
          values (d.par_societe, d.demande_par, 'paiement.trop_percu', 'facturation',
                  'paiements_en_ligne', p.id,
                  jsonb_build_object('facture_id', v_facture, 'encaisse', p.montant_ttc,
                                     'reste_du_avant', greatest(v_reste, 0),
                                     'trop_percu', p.montant_ttc - greatest(v_reste, 0),
                                     'devise', p.devise, 'prestataire', new.prestataire,
                                     'reference', new.reference));
        end if;
      end if;
    end if;
  exception when others then
    -- Le paiement n'est jamais rejeté : le refus s'écrit, la tour rembourse.
    insert into facturation.montees_ouvertes (montee_id, refus) values (d.id, sqlerrm);
  end;
  perform set_config('request.jwt.claim.sub', v_rendu, true);
  return new;
end
$function$;

-- ---------------------------------------------------------------- 5. un essai échu ferme le dossier
CREATE OR REPLACE FUNCTION app.licence_active(p_tenant uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case
    -- Seuls ceux qui voient le dossier apprennent s'il est suspendu : un
    -- membre de la société, un membre d'un cabinet qui la tient sous mandat
    -- actif, un opérateur de la plateforme. Les autres sont refusés, quel que
    -- soit l'état — la réponse ne dit donc rien d'un dossier étranger (R6).
    -- Sans personne derrière l'appel (une tâche du serveur, une migration),
    -- il n'y a rien à cacher à qui que ce soit.
    when not (auth.uid() is null and app.api_tenant() is null
              or app.is_platform()
              or p_tenant in (select app.member_orgs())
              or exists (select 1 from identity.engagements e
                          where e.pme_org_id = p_tenant and e.status = 'actif'
                            and e.cabinet_org_id in (select app.member_orgs())))
      then app.refuser_lecture_de_licence()
    else coalesce(
      (select c.statut from facturation.licence_organisations lo
         join facturation.consommation_v c on c.licence_id = lo.licence_id
        where lo.tenant_id = p_tenant),
      'active') = 'active'
      -- Un essai terminé sans paiement ferme le dossier (25 novembre 2026) : seul le
      -- paiement le rouvre.
      and not exists (select 1 from facturation.licence_organisations lo
                        join facturation.essais e on e.licence_id = lo.licence_id
                       where lo.tenant_id = p_tenant and e.converti_le is null
                         and e.fin <= current_date)
  end;
$function$;

-- ---------------------------------------------------------------- 6. ce que l'écran lit
create function public.mon_essai(p_tenant uuid)
 returns jsonb
 language sql
 stable security definer
 set search_path to ''
as $function$
  select jsonb_build_object(
           'etat', case when e.converti_le is not null then 'converti'
                        when current_date >= e.fin then 'termine'
                        else 'en_cours' end,
           'debut', e.debut,
           'dernier_jour', e.fin - 1,
           'jours', e.jours,
           'jours_restants', greatest(e.fin - current_date, 0),
           'titulaire', l.titulaire = auth.uid())
    from facturation.licence_organisations lo
    join facturation.essais e on e.licence_id = lo.licence_id
    join facturation.licences l on l.id = lo.licence_id
   where lo.tenant_id = p_tenant
     and (p_tenant in (select app.member_orgs()) or app.is_platform())
$function$;
revoke all on function public.mon_essai(uuid) from public, anon;
grant execute on function public.mon_essai(uuid) to authenticated;

-- ---------------------------------------------------------------- les avis
insert into ref.socle_params (pack_version_id, code, value_num, legal_reference, valid_from)
select p.id, 'essai.preavis_jours', 3, 'Politique d''abonnement ALGORIA', date '2026-11-25'
  from ref.jurisdiction_packs p
 where p.jurisdiction = 'TN'
   and p.effective_from <= date '2026-11-25'
   and (p.effective_to is null or p.effective_to >= date '2026-11-25')
on conflict do nothing;

create function notif.prevenir_les_essais()
 returns integer
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  r         record;
  v_preavis integer;
  v_code    text;
  v_cle     text;
  v_n       integer := 0;
begin
  select sp.value_num::integer into v_preavis from ref.socle_params sp
   where sp.code = 'essai.preavis_jours'
     and sp.valid_from <= current_date and (sp.valid_to is null or sp.valid_to >= current_date)
   order by sp.valid_from desc limit 1;
  for r in
    select e.licence_id, e.fin, l.titulaire, facturation.societe_facturee(e.licence_id) as tenant
      from facturation.essais e
      join facturation.licences l on l.id = e.licence_id
     where e.converti_le is null
       and (current_date >= e.fin or (v_preavis is not null and current_date >= e.fin - v_preavis))
  loop
    v_code := case when current_date >= r.fin then 'essai.termine' else 'essai.fin_proche' end;
    v_cle := 'essai:' || r.licence_id::text || ':' || v_code;
    -- Une fois par essai et par avis : l'avis déjà posé ne se repose pas.
    continue when exists (select 1 from notif.envois x where x.sujet_cle = v_cle and x.code = v_code);
    perform notif.emettre(r.tenant, v_code,
      jsonb_build_object('fin', to_char(r.fin - 1, 'DD/MM/YYYY')),
      r.titulaire, v_cle, interval '400 days');
    v_n := v_n + 1;
  end loop;
  return v_n;
end
$function$;
revoke all on function notif.prevenir_les_essais() from public, anon, authenticated;
grant execute on function notif.prevenir_les_essais() to malica_api;

insert into notif.gabarits
  (code, canal, locale, sujet, titre, corps, action_libelle, action_route, effective_from, ton)
values
  ('essai.fin_proche', 'app', 'fr', null, 'Votre essai se termine bientôt',
   'Votre essai gratuit prend fin le {{fin}}. Passez à l''abonnement en un clic pour continuer sans interruption.',
   null, null, date '2026-11-25', 'alerte'),
  ('essai.fin_proche', 'app', 'en', null, 'Your trial ends soon',
   'Your free trial ends on {{fin}}. Switch to a subscription in one click to keep going without interruption.',
   null, null, date '2026-11-25', 'alerte'),
  ('essai.fin_proche', 'app', 'ar', null, 'تنتهي فترة التجربة قريبًا',
   'تنتهي فترة التجربة المجانية يوم {{fin}}. اشتركوا بنقرة واحدة لتواصلوا دون انقطاع.',
   null, null, date '2026-11-25', 'alerte'),
  ('essai.fin_proche', 'email', 'fr', 'Malica Office — votre essai se termine le {{fin}}',
   'Votre essai se termine bientôt',
   'Votre essai gratuit de Malica Office prend fin le {{fin}}. Pour continuer sans interruption, passez à l''abonnement : un clic, puis le paiement en ligne.',
   'Passer à l''abonnement', '/pme/reglages?page=abonnement', date '2026-11-25', 'alerte'),
  ('essai.fin_proche', 'email', 'en', 'Malica Office — your trial ends on {{fin}}',
   'Your trial ends soon',
   'Your free Malica Office trial ends on {{fin}}. To keep going without interruption, switch to a subscription: one click, then online payment.',
   'Subscribe', '/pme/reglages?page=abonnement', date '2026-11-25', 'alerte'),
  ('essai.fin_proche', 'email', 'ar', 'Malica Office — تنتهي فترة التجربة يوم {{fin}}',
   'تنتهي فترة التجربة قريبًا',
   'تنتهي فترة التجربة المجانية لـ Malica Office يوم {{fin}}. لتواصلوا دون انقطاع، اشتركوا: نقرة واحدة ثم الدفع عبر الإنترنت.',
   'الاشتراك', '/pme/reglages?page=abonnement', date '2026-11-25', 'alerte'),
  ('essai.termine', 'app', 'fr', null, 'Votre essai est terminé',
   'Votre essai gratuit a pris fin le {{fin}}. Votre dossier est conservé : passez à l''abonnement pour le rouvrir.',
   null, null, date '2026-11-25', 'erreur'),
  ('essai.termine', 'app', 'en', null, 'Your trial has ended',
   'Your free trial ended on {{fin}}. Your file is kept: subscribe to reopen it.',
   null, null, date '2026-11-25', 'erreur'),
  ('essai.termine', 'app', 'ar', null, 'انتهت فترة التجربة',
   'انتهت فترة التجربة المجانية يوم {{fin}}. ملفكم محفوظ: اشتركوا لإعادة فتحه.',
   null, null, date '2026-11-25', 'erreur'),
  ('essai.termine', 'email', 'fr', 'Malica Office — votre essai est terminé',
   'Votre essai est terminé',
   'Votre essai gratuit de Malica Office a pris fin le {{fin}}. Votre dossier et vos pièces sont conservés. Passez à l''abonnement pour le rouvrir : un clic, puis le paiement en ligne.',
   'Passer à l''abonnement', '/pme/reglages?page=abonnement', date '2026-11-25', 'erreur'),
  ('essai.termine', 'email', 'en', 'Malica Office — your trial has ended',
   'Your trial has ended',
   'Your free Malica Office trial ended on {{fin}}. Your file and documents are kept. Subscribe to reopen it: one click, then online payment.',
   'Subscribe', '/pme/reglages?page=abonnement', date '2026-11-25', 'erreur'),
  ('essai.termine', 'email', 'ar', 'Malica Office — انتهت فترة التجربة',
   'انتهت فترة التجربة',
   'انتهت فترة التجربة المجانية لـ Malica Office يوم {{fin}}. ملفكم ووثائقكم محفوظة. اشتركوا لإعادة فتحه: نقرة واحدة ثم الدفع عبر الإنترنت.',
   'الاشتراك', '/pme/reglages?page=abonnement', date '2026-11-25', 'erreur');

insert into notif.diffusions (code, canal, gabarit, valid_from) values
  ('essai.fin_proche', 'email', 'essai.fin_proche', date '2026-11-25'),
  ('essai.termine', 'email', 'essai.termine', date '2026-11-25');

insert into notif.cartes_courriel (code, rang, genre, libelle_cle, valeur_cle) values
  ('essai.fin_proche', 1, 'ligne', 'donnee.finEssai', 'valeur.fin'),
  ('essai.termine', 1, 'ligne', 'donnee.finEssai', 'valeur.fin');

insert into notif.libelles_courriel (cle, locale, texte, effective_from) values
  ('etiquette.essai', 'fr', 'Essai gratuit', date '2026-11-25'),
  ('etiquette.essai', 'en', 'Free trial', date '2026-11-25'),
  ('etiquette.essai', 'ar', 'التجربة المجانية', date '2026-11-25'),
  ('raison.essai', 'fr',
   'Vous recevez ce message parce que vous êtes le propriétaire principal de cet essai Malica Office.',
   date '2026-11-25'),
  ('raison.essai', 'en',
   'You are receiving this message because you are the principal owner of this Malica Office trial.',
   date '2026-11-25'),
  ('raison.essai', 'ar', 'تصلكم هذه الرسالة لأنكم المالك الرئيسي لهذه التجربة في Malica Office.',
   date '2026-11-25'),
  ('apercu.essai.fin_proche', 'fr', 'Votre essai prend fin le {{fin}} : un clic pour continuer.', date '2026-11-25'),
  ('apercu.essai.fin_proche', 'en', 'Your trial ends on {{fin}}: one click to keep going.', date '2026-11-25'),
  ('apercu.essai.fin_proche', 'ar', 'تنتهي تجربتكم يوم {{fin}}: نقرة واحدة للمواصلة.', date '2026-11-25'),
  ('apercu.essai.termine', 'fr', 'Votre essai est terminé : votre dossier vous attend.', date '2026-11-25'),
  ('apercu.essai.termine', 'en', 'Your trial has ended: your file is waiting for you.', date '2026-11-25'),
  ('apercu.essai.termine', 'ar', 'انتهت تجربتكم: ملفكم في انتظاركم.', date '2026-11-25'),
  ('donnee.finEssai', 'fr', 'Dernier jour d''essai', date '2026-11-25'),
  ('donnee.finEssai', 'en', 'Last trial day', date '2026-11-25'),
  ('donnee.finEssai', 'ar', 'آخر يوم في التجربة', date '2026-11-25'),
  ('valeur.fin', 'fr', '{{fin}}', date '2026-11-25'),
  ('valeur.fin', 'en', '{{fin}}', date '2026-11-25'),
  ('valeur.fin', 'ar', '{{fin}}', date '2026-11-25')
on conflict do nothing;

commit;
