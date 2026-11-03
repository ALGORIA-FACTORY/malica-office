-- ======================================================================
--  Premium compte ses places par société (moteur commercial, 5 bis/9 —
--  décision du dirigeant n° 7).
--
--  « Premium : 4 places incluses pour la licence, puis 8 DT HT par place et
--  PAR SOCIÉTÉ ; et 29 DT HT par organisation supplémentaire (au-delà des 2
--  incluses). Les abonnés actuels gardent leur grille jusqu'à leur prochain
--  changement d'offre. »
--
--  Les montants (8, 29, 4, 2) sont déjà dans la grille Premium du
--  19 octobre ; ce qui change est la PORTÉE d'une place : une personne qui
--  travaille dans deux sociétés de la licence occupe deux places. C'est une
--  colonne de la grille, `ref.offres.portee_sieges` (`licence` : une personne
--  = une place ; `organisation` : un couple société × personne = une place),
--  et une ligne Premium DATÉE qui la porte. Rien n'est écrit en dur : la tour
--  la change par `plateforme.grille_publier` (qui reprend la portée de la
--  ligne précédente si elle ne la dit pas).
--
--  L'ENTRÉE EN VIGUEUR : le premier jour du mois qui suit le déploiement.
--  Le déploiement n'a pas de date au moment où ceci s'écrit : la ligne est
--  datée du 1er décembre 2026 (littéral, R11). Si le déploiement glisse, la
--  tour publie la même ligne à la bonne date — INCERTAIN, à confirmer par le
--  dirigeant (`docs/livraison-2026-10-19/10-ce-qui-reste-ouvert.md`).
--
--  LES ABONNÉS ACTUELS : un forfait lit sa grille à `offre_depuis`
--  (`ref.offre_a(h.offre_code, h.offre_depuis)`) ; un abonné souscrit avant
--  le 1er décembre garde la ligne du 19 octobre jusqu'à son prochain
--  changement d'offre, qui pose un nouveau `offre_depuis`.
--
--  UN SEUL CORPS (R12) : le compte des places, les lectures du forfait et
--  son prix se lisent par trois fonctions que `droits_v`, `periodes_v` et le
--  stock (`droit_du_forfait`, `droit_paye`) appellent toutes.
-- ======================================================================

-- ------------------------------------------------------------ 1. La portée d'une place

alter table ref.offres
  add column portee_sieges text not null default 'licence'
    check (portee_sieges in ('licence', 'organisation'));
comment on column ref.offres.portee_sieges is
  'Ce qu''est une place au-delà des places incluses : `licence`, une personne (quelle que soit '
  'le nombre de sociétés où elle travaille) ; `organisation`, un couple société × personne '
  '(décision du dirigeant n° 7, Premium).';

insert into ref.offres
  (code, libelle, prix_mensuel_ht, lectures_par_organisation, sieges_inclus, sieges_max,
   prix_siege_sup, lectures_par_siege_sup, organisations_incluses, organisations_max,
   prix_organisation_sup, rang, recharges_permises, portee_sieges, effective_from, created_at)
select o.code, o.libelle, o.prix_mensuel_ht, o.lectures_par_organisation, o.sieges_inclus,
       o.sieges_max, o.prix_siege_sup, o.lectures_par_siege_sup, o.organisations_incluses,
       o.organisations_max, o.prix_organisation_sup, o.rang, o.recharges_permises,
       'organisation', date '2026-12-01', timestamptz '2026-11-02 00:00:00+00'
  from ref.offres o
 where o.code = 'premium' and o.effective_from = date '2026-10-19';

-- ------------------------------------------------------------ 2. Le compte des places

create or replace view facturation.places_v with (security_invoker = true) as
 select l.id as licence_id,
    ((select count(distinct lo.tenant_id) as count
        from facturation.licence_organisations lo
       where lo.licence_id = l.id))::integer as organisations,
    ((select count(distinct m.user_id) as count
        from facturation.licence_organisations lo
        join identity.memberships m on m.tenant_id = lo.tenant_id
       where lo.licence_id = l.id
         and m.role = any (array['dirigeant'::text, 'collaborateur'::text, 'assistant'::text])
         and m.user_id <> l.titulaire))::integer as sieges_occupes,
    ((select count(distinct (m.tenant_id, m.user_id)) as count
        from facturation.licence_organisations lo
        join identity.memberships m on m.tenant_id = lo.tenant_id
       where lo.licence_id = l.id
         and m.role = any (array['dirigeant'::text, 'collaborateur'::text, 'assistant'::text])
         and m.user_id <> l.titulaire))::integer as sieges_par_societe
   from facturation.licences l;
comment on view facturation.places_v is
  'Les sociétés et les places d''une licence : `sieges_occupes` compte des personnes, '
  '`sieges_par_societe` des couples société × personne (décision du dirigeant n° 7). Laquelle '
  'compte se lit dans la grille (`ref.offres.portee_sieges`, `facturation.sieges_comptes`).';

/** Les places qu'une grille compte : des personnes, ou des couples société × personne. */
create function facturation.sieges_comptes(p_portee text, p_sieges integer, p_par_societe integer)
returns integer
language sql immutable set search_path = '' as $$
  select case p_portee when 'organisation' then p_par_societe else p_sieges end
$$;

/** Les lectures mensuelles d'un forfait, pour ses sociétés et ses places comptées. */
create function facturation.lectures_du_forfait(o ref.offres, p_organisations integer, p_sieges integer)
returns integer
language sql immutable set search_path = '' as $$
  select (o.lectures_par_organisation * greatest(p_organisations, o.organisations_incluses::integer)
          + o.lectures_par_siege_sup * greatest(0, p_sieges - o.sieges_inclus))::integer
$$;

/** Le prix mensuel HT d'un forfait, pour ses sociétés et ses places comptées. */
create function facturation.prix_du_forfait(o ref.offres, p_organisations integer, p_sieges integer)
returns app.money_t
language sql immutable set search_path = '' as $$
  select (o.prix_mensuel_ht::numeric
          + o.prix_siege_sup::numeric * greatest(0, p_sieges - o.sieges_inclus)::numeric
          + o.prix_organisation_sup::numeric
            * greatest(0, p_organisations - o.organisations_incluses)::numeric)::app.money_t
$$;

-- ------------------------------------------------------------ 3. Les vues qui en vivent

-- `sieges_occupes` y devient les places COMPTÉES par la grille du forfait :
-- ce que l'émission facture (`emettre` lit `consommation_v.sieges_occupes`)
-- et ce que l'écran montre sont le même nombre.
create or replace view facturation.droits_v with (security_invoker = true) as
 select l.id as licence_id,
    l.titulaire,
    h.offre_code,
    l.statut,
    o.libelle as offre_libelle,
    p.organisations,
    o.organisations_max,
    s.sieges as sieges_occupes,
    o.sieges_inclus,
    o.sieges_max,
    facturation.lectures_du_forfait(o, p.organisations, s.sieges) as lectures_droit,
    facturation.prix_du_forfait(o, p.organisations, s.sieges) as prix_mensuel_ht,
    o.rang as offre_rang,
    h.canal,
    h.offre_depuis,
    h.id as forfait_id,
    l.origine,
    l.origine_cabinet,
    o.prix_mensuel_ht as prix_offre_ht,
    o.organisations_incluses
   from facturation.licences l
     join facturation.forfait_courant_v h on h.licence_id = l.id
     cross join lateral ref.offre_a(h.offre_code, h.offre_depuis) o
     join facturation.places_v p on p.licence_id = l.id
     cross join lateral (select facturation.sieges_comptes(o.portee_sieges, p.sieges_occupes,
                                                           p.sieges_par_societe) as sieges) s;

-- Le prix d'un segment de la répartition : même corps que `droits_v`.
create or replace view facturation.periodes_v with (security_invoker = true) as
 WITH bornes AS (
         SELECT h_1.licence_id,
            h_1.effet_du AS jour
           FROM facturation.forfait_historique h_1
        UNION
         SELECT h_1.licence_id,
            h_1.effet_au
           FROM facturation.forfait_historique h_1
          WHERE (h_1.effet_au IS NOT NULL)
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
    h.offre_code,
    h.offre_depuis,
    h.canal,
    h.motif AS forfait_motif,
    o.libelle AS offre_libelle,
    o.rang AS offre_rang,
    p.organisations,
    facturation.sieges_comptes(o.portee_sieges, p.sieges_occupes, p.sieges_par_societe) AS sieges_occupes,
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
    (((t.prix_total_ht)::numeric - LEAST(COALESCE(ca.base_cabinet, (0)::numeric), (t.prix_total_ht)::numeric)))::app.money_t AS part_pme_ht,
    ((COALESCE(ca.vivants, (0)::bigint) > 0) OR (l.titulaire IS NOT NULL)) AS facturable
   FROM ((((((segments s
     JOIN facturation.licences l ON ((l.id = s.licence_id)))
     JOIN facturation.forfait_historique h ON (((h.licence_id = s.licence_id) AND (h.effet_du <= s.du) AND ((h.effet_au IS NULL) OR (h.effet_au > s.du)))))
     CROSS JOIN LATERAL ref.offre_a(h.offre_code, h.offre_depuis) o(id, code, libelle, prix_mensuel_ht, lectures_par_organisation, sieges_inclus, sieges_max, prix_siege_sup, lectures_par_siege_sup, organisations_incluses, organisations_max, prix_organisation_sup, effective_from, created_at, rang))
     JOIN facturation.places_v p ON ((p.licence_id = s.licence_id)))
     CROSS JOIN LATERAL ( SELECT facturation.prix_du_forfait(o.*::ref.offres, p.organisations, facturation.sieges_comptes(o.portee_sieges, p.sieges_occupes, p.sieges_par_societe)) AS prix_total_ht) t)
     LEFT JOIN LATERAL ( SELECT count(*) AS vivants,
            sum((oa.prix_mensuel_ht)::numeric) FILTER (WHERE (a.canal = 'cabinet'::text)) AS base_cabinet,
            max(oa.rang) FILTER (WHERE (a.canal = 'cabinet'::text)) AS plancher_rang,
            (array_agg(a.offre_code ORDER BY oa.rang DESC) FILTER (WHERE (a.canal = 'cabinet'::text)))[1] AS plancher_offre_code,
            (array_agg(a.offre_code ORDER BY oa.rang DESC) FILTER (WHERE (a.canal = 'cabinet'::text)))[1] AS acces_offre_code,
            (array_agg(a.cabinet_tenant_id ORDER BY oa.rang DESC) FILTER (WHERE (a.canal = 'cabinet'::text)))[1] AS cabinet_tenant_id,
            (array_agg(a.id ORDER BY oa.rang DESC) FILTER (WHERE (a.canal = 'cabinet'::text)))[1] AS acces_id,
            (array_agg(a.reference ORDER BY oa.rang DESC) FILTER (WHERE (a.canal = 'cabinet'::text)))[1] AS acces_reference,
            (array_agg(a.reference ORDER BY oa.rang DESC))[1] AS reference_vivante
           FROM (facturation.acces a
             CROSS JOIN LATERAL ref.offre_a(a.offre_code, a.offre_depuis) oa(id, code, libelle, prix_mensuel_ht, lectures_par_organisation, sieges_inclus, sieges_max, prix_siege_sup, lectures_par_siege_sup, organisations_incluses, organisations_max, prix_organisation_sup, effective_from, created_at, rang))
          WHERE ((a.licence_id = s.licence_id) AND (a.effet_du IS NOT NULL) AND (a.effet_du <= s.du) AND ((a.effet_au IS NULL) OR (a.effet_au > s.du)))) ca ON (true))
  WHERE ((s.au_exclu IS NULL) OR (s.au_exclu > s.du));

-- ------------------------------------------------------------ 4. La tour publie la portée

-- Reprise de la définition EN VIGUEUR (20261022140000) : seule la portée change.
CREATE OR REPLACE FUNCTION plateforme.grille_publier(p_effective_from date, p_offres jsonb, p_recharges jsonb, p_motif text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_trous jsonb;
  v_id    uuid;
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('code', t.code, 'detail', t.detail)), '[]')
    into v_trous
    from plateforme.grille_trous(p_effective_from, p_offres, p_recharges) t;
  if jsonb_array_length(v_trous) > 0 then
    raise exception '%', app.refus_avec_valeurs('refus.grille.trous', 'trous', (v_trous)::text) using errcode = 'check_violation';
  end if;

  insert into ref.offres
    (code, libelle, prix_mensuel_ht, lectures_par_organisation, sieges_inclus, sieges_max,
     prix_siege_sup, lectures_par_siege_sup, organisations_incluses, organisations_max,
     prix_organisation_sup, rang, recharges_permises, portee_sieges, effective_from)
  select e ->> 'code', e ->> 'libelle', (e ->> 'prix_mensuel_ht')::numeric,
         (e ->> 'lectures_par_organisation')::int, (e ->> 'sieges_inclus')::int,
         (e ->> 'sieges_max')::int, coalesce((e ->> 'prix_siege_sup')::numeric, 0),
         coalesce((e ->> 'lectures_par_siege_sup')::int, 0),
         coalesce((e ->> 'organisations_incluses')::int, 1), (e ->> 'organisations_max')::int,
         coalesce((e ->> 'prix_organisation_sup')::numeric, 0), (e ->> 'rang')::int,
         coalesce((e ->> 'recharges_permises')::boolean, true),
         -- La portée d'une place : celle que la grille publiée dit, sinon celle
         -- de la ligne précédente de l'offre (décision 7 ne se perd pas).
         coalesce(e ->> 'portee_sieges',
                  (select x.portee_sieges from ref.offres x
                    where x.code = e ->> 'code' and x.effective_from <= p_effective_from
                    order by x.effective_from desc limit 1),
                  'licence'),
         p_effective_from
    from jsonb_array_elements(p_offres) e;

  insert into ref.recharges (code, libelle, prix_ht, lectures, validite_mois, rang, effective_from)
  select e ->> 'code', e ->> 'libelle', (e ->> 'prix_ht')::numeric, (e ->> 'lectures')::int,
         (e ->> 'validite_mois')::int, (e ->> 'rang')::int, p_effective_from
    from jsonb_array_elements(coalesce(p_recharges, '[]'::jsonb)) e;

  insert into plateforme.grilles_publiees (effective_from, offres, recharges, motif, publie_par)
  values (p_effective_from, p_offres, coalesce(p_recharges, '[]'::jsonb), p_motif, auth.uid())
  returning id into v_id;

  return jsonb_build_object('grille_id', v_id, 'effective_from', p_effective_from,
                            'offres', jsonb_array_length(p_offres),
                            'recharges', jsonb_array_length(coalesce(p_recharges, '[]'::jsonb)));
end
$function$;
