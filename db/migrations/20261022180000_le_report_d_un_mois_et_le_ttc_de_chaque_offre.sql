-- Le report d'un mois et le TTC de chaque offre — réglables par la tour
-- (décidé le 19 octobre 2026 : « approuvé pour tout », « tout doit être
-- paramétrable »).
--
-- ================================================================ LE REPORT
--
-- Les lectures du forfait non consommées en M passent sur M+1, et pas plus
-- loin : ce qui est reporté se lit d'abord, et ce qui en reste à la fin de
-- M+1 s'éteint. Le report ne se cumule donc jamais — un client qui ne lit
-- rien pendant six mois n'arrive pas avec six mois de lectures, il arrive
-- avec un mois de plus, au plus.
--
-- Ce qui se reporte est la part du FORFAIT : les recharges ont leur propre
-- échéance (20261022120000), et le supplément accordé par la plateforme est un
-- geste daté, pas un dû.
--
-- La règle se calcule mois par mois depuis le premier forfait de la licence :
--
--   report(M) = min(droit(M−1), max(0, droit(M−1) − max(0, conso(M−1) − report(M−1))))
--
-- avec droit(M−1) lu sur l'offre en vigueur le dernier jour de M−1. Aucune
-- table de soldes : un solde stocké se désaccorde, un solde recalculé jamais
-- (même principe que `facturation.encours_v`). Limite assumée et écrite : les
-- sociétés et les places d'un mois passé ne sont pas historisées ; on lit
-- celles d'aujourd'hui.
--
-- La tour l'allume ou l'éteint (`plateforme.abonnement_regler`), daté et
-- motivé. La décision du 19 octobre est inscrite ici, avec sa date (R11).
--
-- ================================================================== LE TTC
--
-- Les réglages disaient : « le TTC calculé ne vient jamais d'une
-- multiplication dans un composant React ». Il vient désormais de la base,
-- par la même fiscalité que la facture (`facturation.fiscalite_en_vigueur`) :
-- HT + TVA au taux en vigueur + droit de timbre. Sans émetteur désigné, il n'y
-- a pas de facture, donc pas de TTC : la fonction rend vide, et l'écran dit HT.

begin;

-- --- 1. Le réglage de l'abonnement, par la tour ----------------------------

create table plateforme.reglages_abonnement (
  id           uuid primary key default gen_random_uuid(),
  report_mois  smallint not null check (report_mois in (0, 1)),
  -- L'abonnement annuel (20261022190000) : ouvert ou non, et combien de mois
  -- il offre sur douze. Réglés ici pour que la tour tienne tout au même
  -- endroit.
  annuel_ouvert        boolean not null default true,
  annuel_mois_offerts  smallint not null default 2 check (annuel_mois_offerts between 0 and 11),
  motif        text not null check (length(btrim(motif)) > 0),
  -- Vide pour la seule décision inscrite par migration (celle du 19 octobre).
  decide_par   uuid,
  decide_le    timestamptz not null default now()
);

comment on table plateforme.reglages_abonnement is
  'Ce que la tour règle de l''abonnement : le report d''un mois (0 ou 1). La '
  'dernière décision vaut ; rien ne se réécrit.';

alter table plateforme.reglages_abonnement enable row level security;
revoke all on table plateforme.reglages_abonnement from public, anon;
grant select on table plateforme.reglages_abonnement to authenticated;

create policy reglages_abonnement_lire on plateforme.reglages_abonnement
  for select to authenticated using ((select app.is_platform()));

create trigger reglages_abonnement_ne_se_reecrivent_pas
  before update or delete on plateforme.reglages_abonnement
  for each row execute function app.deny_mutation();

insert into plateforme.reglages_abonnement
  (report_mois, annuel_ouvert, annuel_mois_offerts, motif, decide_le)
values (1, true, 2,
        'Décision du dirigeant, 19 octobre 2026 : report d''un mois des lectures non '
        'consommées ; abonnement annuel à deux mois offerts',
        timestamptz '2026-10-19 12:00:00+01');

create or replace function plateforme.abonnement_regler(
  p_report_mois smallint, p_annuel_ouvert boolean, p_annuel_mois_offerts smallint, p_motif text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not app.is_platform() then
    raise exception 'reserve aux operateurs de la plateforme' using errcode = '42501';
  end if;
  insert into plateforme.reglages_abonnement
    (report_mois, annuel_ouvert, annuel_mois_offerts, motif, decide_par)
  values (p_report_mois, p_annuel_ouvert, p_annuel_mois_offerts, p_motif, auth.uid())
  returning id into v_id;
  return (select to_jsonb(r) - 'decide_par' from plateforme.reglages_abonnement r where r.id = v_id);
end
$$;

revoke all on function plateforme.abonnement_regler(smallint, boolean, smallint, text) from public, anon;
grant execute on function plateforme.abonnement_regler(smallint, boolean, smallint, text) to authenticated;

-- Lisible par toute personne connectée : un client doit savoir si ses
-- lectures se reportent.
create or replace function public.abonnement_reglage()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object('report_mois', r.report_mois,
                               'annuel_ouvert', r.annuel_ouvert,
                               'annuel_mois_offerts', r.annuel_mois_offerts,
                               'motif', r.motif, 'decide_le', r.decide_le)
       from plateforme.reglages_abonnement r
      order by r.decide_le desc, r.id desc limit 1),
    jsonb_build_object('report_mois', 0, 'annuel_ouvert', false, 'annuel_mois_offerts', 0,
                       'motif', null, 'decide_le', null))
$$;

revoke all on function public.abonnement_reglage() from public, anon;
grant execute on function public.abonnement_reglage() to authenticated;

-- --- 2. Le report d'une licence, pour un mois ------------------------------

create or replace function facturation.report_de(p_licence uuid, p_periode date)
returns integer
language sql
stable
set search_path = ''
as $$
  with recursive
  regle as (select (public.abonnement_reglage() ->> 'report_mois')::int as n),
  places as (select p.organisations, p.sieges_occupes
               from facturation.places_v p where p.licence_id = p_licence),
  debut as (select date_trunc('month', min(h.effet_du))::date as d
              from facturation.forfait_historique h where h.licence_id = p_licence),
  mois (m, report) as (
    select d, 0 from debut where d is not null and d <= p_periode
    union all
    select (mois.m + interval '1 month')::date,
           least(x.droit, greatest(0, x.droit - greatest(0, x.conso - mois.report)))::int
      from mois
      cross join lateral (
        select coalesce((
                 select o.lectures_par_organisation * greatest(pl.organisations, o.organisations_incluses)
                        + o.lectures_par_siege_sup * greatest(0, pl.sieges_occupes - o.sieges_inclus)
                   from facturation.forfait_historique h
                   cross join lateral ref.offre_a(h.offre_code, h.offre_depuis) o
                   cross join places pl
                  where h.licence_id = p_licence
                    and h.effet_du <= (mois.m + interval '1 month - 1 day')::date
                    and (h.effet_au is null or h.effet_au > (mois.m + interval '1 month - 1 day')::date)
                  order by h.effet_du desc
                  limit 1), 0) as droit,
               (select count(*)::int from facturation.lectures l
                 where l.licence_id = p_licence and l.periode = mois.m
                   and l.recharge_id is null) as conso
      ) x
     where mois.m < p_periode)
  select case when (select n from regle) = 0 then 0
              else coalesce((select report from mois where m = p_periode), 0) end
$$;

revoke all on function facturation.report_de(uuid, date) from public, anon;
grant execute on function facturation.report_de(uuid, date) to authenticated;

comment on function facturation.report_de(uuid, date) is
  'Les lectures du forfait de M−1 non consommées, reportées sur M (au plus un '
  'mois de droit, jamais cumulé). Zéro si la tour a éteint le report.';

-- Le compteur du mois porte le report : le droit l'inclut, et la colonne le
-- dit à part pour que l'écran puisse l'expliquer. Corps repris de
-- `20261022120000`, plus le report.
create or replace view facturation.consommation_v with (security_invoker = true) as
select
  d.licence_id, d.offre_code, d.statut,
  (d.lectures_droit_total + r.report)::int               as lectures_droit,
  d.lectures_droit                                       as lectures_forfait,
  d.lectures_supplement,
  coalesce(c.consommees, 0)::int                         as lectures_consommees,
  greatest(0, d.lectures_droit_total + r.report - coalesce(c.consommees, 0))::int
                                                         as lectures_restantes,
  d.organisations, d.sieges_occupes, d.sieges_inclus, d.sieges_max,
  d.prix_mensuel_ht,
  d.organisations_max, d.offre_libelle,
  d.offre_rang, d.canal, d.origine, d.titulaire,
  r.report                                               as lectures_report
from facturation.droits_reels_v d
cross join lateral (
  select facturation.report_de(d.licence_id, date_trunc('month', current_date)::date) as report
) r
left join lateral (
  select count(*) as consommees
  from facturation.lectures l
  where l.licence_id = d.licence_id
    and l.periode = date_trunc('month', current_date)::date
    and l.recharge_id is null
) c on true;

-- Le report, vu de l'application : celui de MA licence, pour ce mois. Un
-- membre le lit pour le dossier qu'il ouvre ; le titulaire, pour la sienne.
create or replace function public.mon_report(p_tenant uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_licence uuid;
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
    'report', facturation.report_de(v_licence, date_trunc('month', current_date)::date),
    'actif', (public.abonnement_reglage() ->> 'report_mois')::int = 1);
end
$$;

revoke all on function public.mon_report(uuid) from public, anon;
grant execute on function public.mon_report(uuid) to authenticated;

-- --- 3. Le TTC, par la fiscalité de la facture -----------------------------

create or replace function public.prix_ttc(p_ht numeric, p_le date default current_date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  f     record;
  v_tva numeric;
begin
  if p_ht is null or p_ht < 0 then
    return null;
  end if;
  begin
    select * into f from facturation.fiscalite_en_vigueur(p_le);
  exception when no_data_found then
    -- Pas d'émetteur, pas de taux : pas de facture, donc pas de TTC. On ne
    -- suppose rien (R4).
    return null;
  end;
  if f.timbre is null then
    return null;
  end if;
  v_tva := round(p_ht * f.taux, 3);
  return jsonb_build_object(
    'ht', round(p_ht, 3), 'taux', f.taux, 'tva', v_tva, 'timbre', f.timbre,
    'ttc', round(p_ht, 3) + v_tva + f.timbre, 'devise', f.devise);
end
$$;

revoke all on function public.prix_ttc(numeric, date) from public, anon;
grant execute on function public.prix_ttc(numeric, date) to authenticated;

comment on function public.prix_ttc(numeric, date) is
  'HT + TVA en vigueur + droit de timbre, par la fiscalité de la facture. Vide '
  'sans émetteur désigné.';

-- La grille, vue de l'application, dit son TTC. Le type de retour change : la
-- fonction se recrée (corps de `20261022130000`, plus `prix_ttc`).
drop function public.mes_offres(uuid, date);

create function public.mes_offres(p_tenant uuid default null, p_le date default current_date)
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
begin
  select f.offre_code into v_courant
    from facturation.forfait_courant_v f where f.licence_id = v_licence;

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
           e.code, e.chiffres,
           (public.prix_ttc(g.prix_mensuel_ht::numeric, p_le) ->> 'ttc')::numeric
      from grille g
      cross join lateral facturation.empechement_de_forfait(v_licence, g.code, p_le) e
     order by g.rang;
end;
$$;

revoke all on function public.mes_offres(uuid, date) from public, anon;
grant execute on function public.mes_offres(uuid, date) to authenticated;

comment on function public.mes_offres(uuid, date) is
  'La grille en vigueur, offre par offre : prix HT et TTC, lectures garanties, '
  'places et sociétés, l''offre courante, et ce qui empêcherait d''y passer.';

commit;
