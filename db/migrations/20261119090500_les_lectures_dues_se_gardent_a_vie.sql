-- ======================================================================
--  Les lectures dues se gardent à vie (moteur commercial, 6/9 — plan du
--  2 novembre 2026, annexe D1, D2 ; décisions du dirigeant n° 3, 4, 8, 9).
--
--  Le report d'UN mois (`facturation.report_de`, récursif, 20261022180000)
--  ne suffit plus : les lectures non consommées sont gardées À VIE. Un
--  registre en ajout seul les tient, `facturation.lectures_dues` :
--
--    report_forfait   à la clôture d'un mois : le droit du forfait moins ce
--                     qui a été lu sur le forfait, s'il en reste ;
--    puisement        à la clôture d'un mois : ce qui a été lu AU-DELÀ du
--                     forfait, pris dans le stock (jamais plus que le stock :
--                     `lecture_autorisee` lit le solde avant d'autoriser) ;
--    offerte          à l'instant du geste de la tour (`lectures_offrir`).
--
--  Une seule clôture par licence et par mois (unique partiel) : la passe
--  rejouée n'écrit rien de plus. Un mois que la passe n'a pas encore clos
--  compte quand même, à la volée, au même calcul (`ecart_du_mois`) : le
--  client ne perd rien parce que la tour n'a pas encore lancé la passe.
--
--  Décision 3 : les jours d'ESSAI n'alimentent pas le stock (le crédit d'un
--  mois se proratise sur ses jours payés). Décision 4 : un mois OFFERT
--  alimente le stock comme un mois payé (rien à faire : son forfait existe).
--  Décision 8 : une licence RÉSILIÉE ne crédite plus rien ; son stock est
--  gelé, jamais remboursé, et rendu si elle reprend.
--
--  Décision 9 : le traitement comptable de cette dette (produit constaté
--  d'avance) est INCERTAIN — à valider par l'expert-comptable d'ALGORIA. Le
--  registre la mesure ; il ne décide pas de son écriture.
--
--  `facturation.report_de` reste la règle « un mois » ; elle lit désormais
--  le droit du forfait par `facturation.droit_du_forfait` (un seul corps).
-- ======================================================================

-- ------------------------------------------------------------ 1. Le droit et le lu d'un mois

/** Le droit du forfait d'une licence sur un mois : l'offre portée le dernier jour du mois. */
create function facturation.droit_du_forfait(p_licence uuid, p_periode date) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select (o.lectures_par_organisation * greatest(pl.organisations, o.organisations_incluses)
            + o.lectures_par_siege_sup * greatest(0, pl.sieges_occupes - o.sieges_inclus))::int
      from facturation.forfait_historique h
      cross join lateral ref.offre_a(h.offre_code, h.offre_depuis) o
      cross join facturation.places_v pl
     where h.licence_id = p_licence and pl.licence_id = p_licence
       and h.effet_du <= (p_periode + interval '1 month - 1 day')::date
       and (h.effet_au is null or h.effet_au > (p_periode + interval '1 month - 1 day')::date)
     order by h.effet_du desc
     limit 1), 0)
$$;
revoke all on function facturation.droit_du_forfait(uuid, date) from public, anon, authenticated;

/** Les lectures d'un mois prises sur le forfait ou le stock (hors recharges). */
create function facturation.lues_hors_recharge(p_licence uuid, p_periode date) returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::int from facturation.lectures l
   where l.licence_id = p_licence and l.periode = p_periode and l.recharge_id is null
$$;
revoke all on function facturation.lues_hors_recharge(uuid, date) from public, anon, authenticated;

/** La règle « un mois » relit le droit par la même fonction (R12 : un seul corps). */
create or replace function facturation.report_de(p_licence uuid, p_periode date) returns integer
language sql stable set search_path = '' as $$
  with recursive
  regle as (select (public.abonnement_reglage() ->> 'report_mois')::int as n),
  debut as (select date_trunc('month', min(h.effet_du))::date as d
              from facturation.forfait_historique h where h.licence_id = p_licence),
  mois (m, report) as (
    select d, 0 from debut where d is not null and d <= p_periode
    union all
    select (mois.m + interval '1 month')::date,
           least(x.droit, greatest(0, x.droit - greatest(0, x.conso - mois.report)))::int
      from mois
      cross join lateral (
        select facturation.droit_du_forfait(p_licence, mois.m) as droit,
               facturation.lues_hors_recharge(p_licence, mois.m) as conso
      ) x
     where mois.m < p_periode)
  select case when (select n from regle) = 0 then 0
              else coalesce((select report from mois where m = p_periode), 0) end
$$;

-- ------------------------------------------------------------ 2. Le registre

create table facturation.lectures_dues (
  id              uuid primary key default gen_random_uuid(),
  licence_id      uuid not null references facturation.licences (id) on delete restrict,
  periode         date not null check (extract(day from periode) = 1),
  nature          text not null references ref.natures_lecture_due (code),
  lectures        integer not null check (lectures > 0),
  intervention_id uuid references plateforme.interventions (id),
  passe_id        uuid,
  inscrit_par     uuid references auth.users (id),
  inscrit_le      timestamptz not null default now(),
  constraint lectures_dues_offerte_nomme_son_geste
    check ((nature = 'offerte') = (intervention_id is not null))
);
comment on table facturation.lectures_dues is
  'Le stock de lectures dues d''une licence, en ajout seul : crédits (forfait non consommé, '
  'lectures offertes) et puisements. Une seule clôture par licence et par mois. Le stock d''un '
  'Premium est commun à ses sociétés : la clé est la licence, pas le tenant.';
create unique index lectures_dues_une_cloture_par_mois
  on facturation.lectures_dues (licence_id, periode) where nature <> 'offerte';
create unique index lectures_dues_une_par_geste
  on facturation.lectures_dues (intervention_id) where intervention_id is not null;
create index lectures_dues_licence_idx on facturation.lectures_dues (licence_id, periode desc);
create index lectures_dues_nature_fk_idx on facturation.lectures_dues (nature);
create index lectures_dues_passe_idx on facturation.lectures_dues (passe_id);
create index lectures_dues_inscrit_par_idx on facturation.lectures_dues (inscrit_par);

alter table facturation.lectures_dues enable row level security;
alter table facturation.lectures_dues force row level security;
revoke all on table facturation.lectures_dues from public, anon, service_role;
grant select on table facturation.lectures_dues to authenticated;
create policy facturation_lectures_dues_sel on facturation.lectures_dues for select to authenticated
  using (licence_id in (select facturation.licences_lisibles()));
create policy service_hors_perimetre on facturation.lectures_dues as restrictive
  for select to authenticated using ((select app.service()) is null);
create trigger service_hors_perimetre before insert or update or delete on facturation.lectures_dues
  for each statement execute function app.service_hors_perimetre();
create trigger facturation_lectures_dues_ajout_seul before update or delete on facturation.lectures_dues
  for each row execute function app.deny_mutation();

-- ------------------------------------------------------------ 3. L'écart d'un mois, le solde

/**
 * Ce qu'un mois apporte au stock (positif) ou y prend (négatif). Les jours
 * d'essai ne créditent rien (décision 3) ; une licence résiliée non plus
 * (décision 8).
 */
create function facturation.ecart_du_mois(p_licence uuid, p_periode date) returns integer
language plpgsql stable security definer set search_path = '' as $$
declare
  v_droit integer := facturation.droit_du_forfait(p_licence, p_periode);
  v_lues  integer := facturation.lues_hors_recharge(p_licence, p_periode);
  v_jours integer := ((p_periode + interval '1 month')::date - p_periode);
  v_essai integer := facturation.jours_d_essai(p_licence, p_periode);
  v_ecart integer;
begin
  if exists (select 1 from facturation.licences l where l.id = p_licence and l.statut = 'resiliee') then
    return least(0, v_droit - v_lues);
  end if;
  v_ecart := v_droit - v_lues;
  if v_ecart > 0 and v_essai > 0 then
    v_ecart := floor(v_ecart::numeric * (v_jours - v_essai) / v_jours)::int;
  end if;
  return v_ecart;
end
$$;
revoke all on function facturation.ecart_du_mois(uuid, date) from public, anon, authenticated;

/** Le premier mois de forfait d'une licence. */
create function facturation.premier_mois(p_licence uuid) returns date
language sql stable security definer set search_path = '' as $$
  select date_trunc('month', min(h.effet_du))::date
    from facturation.forfait_historique h where h.licence_id = p_licence
$$;
revoke all on function facturation.premier_mois(uuid) from public, anon, authenticated;

/**
 * Qui peut demander le stock d'une licence : la plateforme, qui la lit
 * (`licences_lisibles`), ou un membre d'une de ses sociétés et le cabinet qui
 * y est engagé — ceux dont les lectures la consomment (`lecture_autorisee`
 * lit le report sous l'identité du lecteur). Personne d'autre : la fonction
 * est `definer`, la RLS du registre ne la protège pas (revue Codex de #202).
 * Une session ouverte par un superutilisateur, SANS identité (migration,
 * maintenance, épreuve qui pose ses fixtures), n'est pas un client : l'API se
 * connecte sous `malica_api` et pose toujours l'identité de l'appelant.
 */
create function facturation.licence_consultable(p_licence uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (auth.uid() is null
          and exists (select 1 from pg_catalog.pg_roles r
                       where r.rolname = session_user and r.rolsuper))
      or app.is_platform()
      or p_licence in (select facturation.licences_lisibles())
      or exists (select 1 from facturation.licence_organisations lo
                  where lo.licence_id = p_licence
                    and (lo.tenant_id in (select app.member_orgs())
                         or lo.tenant_id in (select app.engaged_orgs())))
$$;
revoke all on function facturation.licence_consultable(uuid) from public, anon, authenticated;

/**
 * Le solde du stock au début du mois `p_periode` : le registre des mois
 * clos, les lectures offertes jusqu'à ce mois inclus, et l'écart des mois
 * antérieurs que la passe n'a pas encore clos. Jamais négatif.
 */
create function facturation.lectures_dues_solde(p_licence uuid, p_periode date) returns integer
language plpgsql stable security definer set search_path = '' as $$
begin
  if not facturation.licence_consultable(p_licence) then
    raise exception 'refus.geste.non_permis' using errcode = '42501';
  end if;
  return greatest(0,
    coalesce((select sum(case when d.nature = 'puisement' then -d.lectures else d.lectures end)
                from facturation.lectures_dues d
               where d.licence_id = p_licence
                 and (d.periode < p_periode or (d.nature = 'offerte' and d.periode <= p_periode))), 0)
    + coalesce((select sum(facturation.ecart_du_mois(p_licence, m::date))
                  from generate_series(facturation.premier_mois(p_licence),
                                       (p_periode - interval '1 month')::date,
                                       interval '1 month') m
                 where not exists (select 1 from facturation.lectures_dues d
                                    where d.licence_id = p_licence and d.periode = m::date
                                      and d.nature <> 'offerte')), 0))::int;
end
$$;
revoke all on function facturation.lectures_dues_solde(uuid, date) from public, anon;
grant execute on function facturation.lectures_dues_solde(uuid, date) to authenticated;

/** Ce que le mois reçoit en plus de son forfait, selon la règle de report en vigueur. */
create function facturation.lectures_reportees(p_licence uuid, p_periode date) returns integer
language plpgsql stable security definer set search_path = '' as $$
begin
  if not facturation.licence_consultable(p_licence) then
    raise exception 'refus.geste.non_permis' using errcode = '42501';
  end if;
  return case public.abonnement_reglage() ->> 'report_regle'
           when 'a_vie' then facturation.lectures_dues_solde(p_licence, p_periode)
           when 'un_mois' then facturation.report_de(p_licence, p_periode)
           else 0 end;
end
$$;
revoke all on function facturation.lectures_reportees(uuid, date) from public, anon;
grant execute on function facturation.lectures_reportees(uuid, date) to authenticated;

create or replace view facturation.consommation_v with (security_invoker = true) as
 select d.licence_id,
    d.offre_code,
    d.statut,
    (d.lectures_droit_total + r.report) as lectures_droit,
    d.lectures_droit as lectures_forfait,
    d.lectures_supplement,
    (coalesce(c.consommees, (0)::bigint))::integer as lectures_consommees,
    (greatest((0)::bigint, ((d.lectures_droit_total + r.report) - coalesce(c.consommees, (0)::bigint))))::integer as lectures_restantes,
    d.organisations,
    d.sieges_occupes,
    d.sieges_inclus,
    d.sieges_max,
    d.prix_mensuel_ht,
    d.organisations_max,
    d.offre_libelle,
    d.offre_rang,
    d.canal,
    d.origine,
    d.titulaire,
    r.report as lectures_report
   from ((facturation.droits_reels_v d
     cross join lateral (select facturation.lectures_reportees(d.licence_id,
                                  (date_trunc('month', current_date::timestamptz))::date) as report) r)
     left join lateral (select count(*) as consommees
           from facturation.lectures l
          where l.licence_id = d.licence_id
            and l.periode = (date_trunc('month', current_date::timestamptz))::date
            and l.recharge_id is null) c on true);

create or replace function public.mon_report(p_tenant uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_licence uuid;
  v_regle   text := public.abonnement_reglage() ->> 'report_regle';
begin
  if p_tenant is null then
    select l.id into v_licence from facturation.licences l
     where l.titulaire = auth.uid() order by l.id limit 1;
  else
    select lo.licence_id into v_licence from facturation.licence_organisations lo
     where lo.tenant_id = p_tenant and lo.tenant_id in (select app.member_orgs());
  end if;
  if v_licence is null then
    return null;
  end if;
  return jsonb_build_object(
    'report', facturation.lectures_reportees(v_licence, date_trunc('month', current_date)::date),
    'actif', v_regle <> 'aucun',
    'regle', v_regle);
end
$$;

/**
 * Le stock, licence par licence, sous l'identité de l'appelant : la tour voit
 * tout, la PME et son cabinet la leur (`lectures_dues` est sous RLS).
 */
create view facturation.lectures_dues_v with (security_invoker = true) as
  select l.id as licence_id,
         coalesce(sum(d.lectures) filter (where d.nature <> 'puisement'), 0)::int as credits,
         coalesce(sum(d.lectures) filter (where d.nature = 'puisement'), 0)::int as puisees,
         coalesce(sum(d.lectures) filter (where d.nature = 'offerte'), 0)::int as offertes,
         facturation.lectures_dues_solde(l.id, (date_trunc('month', current_date::timestamptz))::date)
           as solde,
         max(d.periode) filter (where d.nature <> 'offerte') as dernier_mois_clos
    from facturation.licences l
    left join facturation.lectures_dues d on d.licence_id = l.id
   group by l.id;
revoke all on facturation.lectures_dues_v from public, anon;
grant select on facturation.lectures_dues_v to authenticated;

-- ------------------------------------------------------------ 4. La clôture, les lectures offertes

/**
 * Clôt les mois de la licence jusqu'à `p_periode` inclus, dans l'ordre :
 * une ligne par mois clos (crédit ou puisement), rien pour un écart nul. Un
 * mois en cours ne se clôt pas. Idempotente. Appelée par la passe seule.
 */
create function facturation.cloturer_lectures(p_licence uuid, p_periode date, p_passe uuid)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  m        date;
  v_ecart  integer;
  v_closes integer := 0;
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  if p_periode >= date_trunc('month', current_date)::date then
    return 0;
  end if;
  for m in
    select g::date from generate_series(facturation.premier_mois(p_licence), p_periode,
                                        interval '1 month') g
  loop
    continue when exists (select 1 from facturation.lectures_dues d
                           where d.licence_id = p_licence and d.periode = m
                             and d.nature <> 'offerte');
    v_ecart := facturation.ecart_du_mois(p_licence, m);
    continue when v_ecart = 0;
    insert into facturation.lectures_dues (licence_id, periode, nature, lectures, passe_id, inscrit_par)
    values (p_licence, m, case when v_ecart > 0 then 'report_forfait' else 'puisement' end,
            abs(v_ecart), p_passe, auth.uid())
    on conflict do nothing;
    v_closes := v_closes + 1;
  end loop;
  return v_closes;
end
$$;
revoke all on function facturation.cloturer_lectures(uuid, date, uuid) from public, anon, authenticated;

create function plateforme.lectures_offrir(
  p_licence uuid, p_nombre integer, p_motif text, p_cle text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r   plateforme.reglages_commerciaux;
  v_g jsonb;
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  r := plateforme.reglage_commercial();
  if p_nombre is null or p_nombre < 1 or p_nombre > r.lectures_offertes_max then
    raise exception '%', app.refus_avec_valeurs('refus.geste.au_dela_du_plafond',
                                                'plafond', r.lectures_offertes_max::text)
      using errcode = 'check_violation';
  end if;
  v_g := plateforme.geste_inscrire(p_licence, 'lectures_offertes', p_nombre, null,
                                   date_trunc('month', current_date)::date, null, p_motif, p_cle, null);
  if not (v_g ->> 'deja')::boolean then
    insert into facturation.lectures_dues (licence_id, periode, nature, lectures, intervention_id, inscrit_par)
    values (p_licence, date_trunc('month', current_date)::date, 'offerte', p_nombre,
            (v_g ->> 'id')::uuid, auth.uid());
  end if;
  return v_g;
end
$$;
revoke all on function plateforme.lectures_offrir(uuid, integer, text, text) from public, anon;
grant execute on function plateforme.lectures_offrir(uuid, integer, text, text) to authenticated;

-- Le supplément mensuel de lectures (`supplement_lectures`) est un geste
-- historique : les lectures offertes vont désormais dans le stock, une fois.
drop function plateforme.accorder_lectures(uuid, integer, text, date, date);
