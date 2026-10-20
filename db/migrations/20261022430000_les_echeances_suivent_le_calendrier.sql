-- Les échéances suivent le calendrier réel (20 octobre 2026).
--
-- Décision Wissem Barouni du 20 octobre 2026 : la date légale reste au pack
-- (tenue par ALGORIA, une fois pour tous, avec son texte) ; mais une échéance
-- qui tombe un jour férié ou de repos se REPORTE au premier jour ouvrable
-- suivant, et un report exceptionnel (communiqué du ministère, prorogation)
-- se SAISIT — par ALGORIA pour toute la juridiction, ou par le cabinet pour
-- ses dossiers. Le cabinet ne réécrit pas la date légale d'une obligation du
-- pack : il garde ses obligations propres, à la date qu'il veut.
--
-- Règle de report : l'administration fiscale tunisienne (DGI) admet le dépôt
-- le premier jour ouvrable suivant quand le dernier délai tombe un jour férié
-- ou de repos — article exact à confirmer par Mondher Chaouech ; la règle est
-- une ligne de `ref.calendrier_juridiction`, pas une constante.
--
-- Pose :
--   1. `ref.calendrier_juridiction` : jours de repos et règle de report ;
--   2. `ref.jours_feries` : fêtes fixes (mois, jour) ou datées (fêtes
--      religieuses, annoncées chaque année) ;
--   3. `app.jour_ouvrable` ;
--   4. `ref.echeance_origines` : d'où vient la date retenue ;
--   5. `ref.reports_echeance` (ALGORIA) et `collab.reports_echeance_cabinet` ;
--   6. `schedule.echeances` garde la date légale à côté de la date retenue ;
--   7. `echeances_deriver` applique : report du cabinet, sinon d'ALGORIA,
--      sinon premier jour ouvrable ;
--   8. les fonctions de lecture et d'écriture, cabinet et tour.
--
-- REJEU (R11) : `if not exists`, `on conflict do nothing`, `create or replace`.

begin;

-- 1. La règle de calendrier d'une juridiction --------------------------------------
create table if not exists ref.calendrier_juridiction (
  jurisdiction         text primary key check (length(btrim(jurisdiction)) > 0),
  -- Jours de repos hebdomadaire, en numérotation ISO (1 = lundi … 7 = dimanche).
  jours_repos          smallint[] not null
                        check (jours_repos <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]),
  report_jour_ouvrable boolean not null,
  source               text not null check (length(btrim(source)) > 0),
  updated_by           uuid default auth.uid(),
  updated_at           timestamptz not null default now()
);
comment on table ref.calendrier_juridiction is
  'Les jours de repos d''une juridiction, et si une échéance qui y tombe se reporte au premier jour ouvrable.';

insert into ref.calendrier_juridiction (jurisdiction, jours_repos, report_jour_ouvrable, source)
values ('TN', array[6, 7]::smallint[], true,
        'DGI : dépôt admis le premier jour ouvrable suivant un dernier délai férié ou chômé — article à confirmer')
on conflict (jurisdiction) do nothing;

-- 2. Les jours fériés --------------------------------------------------------------
-- Une fête FIXE revient chaque année au même mois et au même jour ; une fête
-- DATÉE (religieuse, annoncée) n'a lieu qu'une fois. Une ligne ne se supprime
-- pas : elle se clôt (`valid_to`).
create table if not exists ref.jours_feries (
  id           uuid primary key default gen_random_uuid(),
  jurisdiction text not null check (length(btrim(jurisdiction)) > 0),
  mois         smallint check (mois between 1 and 12),
  jour         smallint check (jour between 1 and 31),
  le           date,
  libelle      text not null check (length(btrim(libelle)) > 0),
  source       text not null check (length(btrim(source)) > 0),
  valid_from   date not null default date '2000-01-01',
  valid_to     date,
  retire_par   uuid,
  motif_retrait text,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  check ((le is null) = (mois is not null and jour is not null)),
  check (le is not null or (mois is not null and jour is not null)),
  check (valid_to is null or valid_to > valid_from)
);
create unique index if not exists jours_feries_date_uidx
  on ref.jours_feries (jurisdiction, le) where le is not null and valid_to is null;
create unique index if not exists jours_feries_fixe_uidx
  on ref.jours_feries (jurisdiction, mois, jour) where le is null and valid_to is null;
create index if not exists jours_feries_jurisdiction_idx on ref.jours_feries (jurisdiction);

-- Les fêtes nationales fixes de la Tunisie (calendrier officiel 2026). Les
-- fêtes religieuses se datent chaque année depuis la tour, à leur annonce.
insert into ref.jours_feries (jurisdiction, mois, jour, libelle, source)
select 'TN', v.mois, v.jour, v.libelle,
       'Calendrier officiel des jours fériés 2026 (Business News, 29 décembre 2025)'
  from (values
    (1::smallint, 1::smallint, 'Jour de l''An'),
    (3, 20, 'Fête de l''Indépendance'),
    (4, 9, 'Journée des Martyrs'),
    (5, 1, 'Fête du Travail'),
    (7, 25, 'Fête de la République'),
    (8, 13, 'Fête de la Femme'),
    (10, 15, 'Fête de l''Évacuation'),
    (12, 17, 'Fête de la Révolution et de la Jeunesse')
  ) as v(mois, jour, libelle)
 where not exists (select 1 from ref.jours_feries f
                    where f.jurisdiction = 'TN' and f.mois = v.mois and f.jour = v.jour
                      and f.le is null and f.valid_to is null);

-- 3. Le premier jour ouvrable ------------------------------------------------------
create or replace function app.est_ouvrable(p_juridiction text, p_date date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not (
    extract(isodow from p_date)::smallint = any (
      coalesce((select c.jours_repos from ref.calendrier_juridiction c
                 where c.jurisdiction = p_juridiction), array[]::smallint[]))
    or exists (
      select 1 from ref.jours_feries f
       where f.jurisdiction = p_juridiction
         and p_date >= f.valid_from and (f.valid_to is null or p_date < f.valid_to)
         and (f.le = p_date
              or (f.le is null and f.mois = extract(month from p_date)::smallint
                  and f.jour = extract(day from p_date)::smallint))))
$$;

create or replace function app.jour_ouvrable(p_juridiction text, p_date date)
returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_jour date := p_date;
begin
  if p_date is null then return null; end if;
  if not coalesce((select c.report_jour_ouvrable from ref.calendrier_juridiction c
                    where c.jurisdiction = p_juridiction), false) then
    return p_date;
  end if;
  -- Borne de sûreté : un calendrier qui ne laisserait aucun jour ouvrable
  -- dans le mois rend la date légale plutôt que de tourner sans fin.
  while not app.est_ouvrable(p_juridiction, v_jour) loop
    v_jour := v_jour + 1;
    if v_jour - p_date > 31 then return p_date; end if;
  end loop;
  return v_jour;
end
$$;
revoke all on function app.est_ouvrable(text, date) from public, anon;
revoke all on function app.jour_ouvrable(text, date) from public, anon;
grant execute on function app.est_ouvrable(text, date) to authenticated;
grant execute on function app.jour_ouvrable(text, date) to authenticated;

-- 4. D'où vient la date retenue ----------------------------------------------------
create table if not exists ref.echeance_origines (
  code       text primary key check (length(btrim(code)) > 0),
  sort_order smallint not null default 100
);
insert into ref.echeance_origines (code, sort_order) values
  ('loi', 10), ('jour_ouvrable', 20), ('report_algoria', 30), ('report_cabinet', 40)
on conflict (code) do nothing;

-- 5. Les reports exceptionnels -----------------------------------------------------
-- Publié par ALGORIA : vaut pour toute la juridiction.
create table if not exists ref.reports_echeance (
  id              uuid primary key default gen_random_uuid(),
  jurisdiction    text not null check (length(btrim(jurisdiction)) > 0),
  obligation_code text not null check (length(btrim(obligation_code)) > 0),
  periode         text not null check (periode ~ '^[0-9]{4}(-(0[1-9]|1[0-2])|-T[1-4])?$'),
  nouvelle_date   date not null,
  motif           text not null check (length(btrim(motif)) > 0),
  source          text not null check (length(btrim(source)) > 0),
  retire_le       timestamptz,
  retire_par      uuid,
  motif_retrait   text,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now()
);
create unique index if not exists reports_echeance_ouvert_uidx
  on ref.reports_echeance (jurisdiction, obligation_code, periode) where retire_le is null;

-- Saisi par le cabinet : vaut pour ses dossiers.
create table if not exists collab.reports_echeance_cabinet (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references identity.organizations(id) on delete cascade,
  obligation_code text not null check (length(btrim(obligation_code)) > 0),
  periode         text not null check (periode ~ '^[0-9]{4}(-(0[1-9]|1[0-2])|-T[1-4])?$'),
  nouvelle_date   date not null,
  motif           text not null check (length(btrim(motif)) > 0),
  source          text,
  retire_le       timestamptz,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now()
);
create unique index if not exists reports_echeance_cabinet_ouvert_uidx
  on collab.reports_echeance_cabinet (tenant_id, obligation_code, periode) where retire_le is null;
create index if not exists reports_echeance_cabinet_tenant_id_fk_idx
  on collab.reports_echeance_cabinet (tenant_id);
select app.enable_tenant_rls('collab', 'reports_echeance_cabinet', false, false);

-- Les tables de référence se lisent ; elles ne s'écrivent que par les
-- fonctions de la tour.
alter table ref.calendrier_juridiction enable row level security;
alter table ref.jours_feries enable row level security;
alter table ref.echeance_origines enable row level security;
alter table ref.reports_echeance enable row level security;
drop policy if exists ref_calendrier_juridiction_sel on ref.calendrier_juridiction;
create policy ref_calendrier_juridiction_sel on ref.calendrier_juridiction
  for select to authenticated using (true);
drop policy if exists ref_jours_feries_sel on ref.jours_feries;
create policy ref_jours_feries_sel on ref.jours_feries for select to authenticated using (true);
drop policy if exists ref_echeance_origines_sel on ref.echeance_origines;
create policy ref_echeance_origines_sel on ref.echeance_origines
  for select to authenticated using (true);
drop policy if exists ref_reports_echeance_sel on ref.reports_echeance;
create policy ref_reports_echeance_sel on ref.reports_echeance
  for select to authenticated using (true);
grant select on ref.calendrier_juridiction, ref.jours_feries, ref.echeance_origines,
                ref.reports_echeance to authenticated;

-- 6. L'échéance garde sa date légale -----------------------------------------------
alter table schedule.echeances add column if not exists date_legale date;
alter table schedule.echeances add column if not exists date_origine text not null default 'loi';
alter table schedule.echeances add column if not exists report_motif text;
alter table schedule.echeances add column if not exists report_source text;
update schedule.echeances set date_legale = due_date where date_legale is null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'echeances_date_origine_fkey') then
    alter table schedule.echeances
      add constraint echeances_date_origine_fkey
      foreign key (date_origine) references ref.echeance_origines(code);
  end if;
end $$;
create index if not exists echeances_date_origine_fk_idx on schedule.echeances (date_origine);

create or replace view public.echeances_v
with (security_invoker = true) as
select e.id, e.tenant_id, e.entity_id, e.kind, e.label, e.period, e.due_date, e.pack_version_id,
       e.status, e.created_at, e.updated_at,
       e.fait_le, e.fait_par,
       coalesce(fo.echeance_regle, op.regle) as echeance_regle,
       fo.texte_source, fo.article,
       coalesce(fo.periodicite, op.periodicite) as periodicite,
       coalesce(e.date_legale, e.due_date) as date_legale,
       e.date_origine, e.report_motif, e.report_source
from schedule.echeances e
join identity.organizations o on o.id = e.tenant_id
left join ref.fiscal_obligations fo
  on fo.jurisdiction = o.jurisdiction
 and fo.code = e.kind
 and fo.valid_from <= coalesce(e.date_legale, e.due_date)
 and (fo.valid_to is null or fo.valid_to > coalesce(e.date_legale, e.due_date))
left join collab.obligations_propres op
  on e.kind like 'CAB:%' and op.id::text = substr(e.kind, 5);
revoke insert, update on public.echeances_v from authenticated;

-- 7. La dérivation suit le calendrier ----------------------------------------------
create or replace function public.echeances_deriver(
  p_tenant uuid,
  p_jusqua date default (current_date + interval '4 months')::date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_juridiction text;
  v_fiche       record;
  v_pack        uuid;
  v_cabinet     uuid;
  v_depuis      date := date_trunc('month', current_date)::date;
  v_n           int  := 0;
  v_ob          record;
  v_mois        date;
  v_periode     text;
  v_legale      date;
  v_echeance    date;
  v_origine     text;
  v_motif       text;
  v_source      text;
  v_rep         record;
begin
  if not (p_tenant in (select app.member_orgs())
          or p_tenant in (select app.engaged_orgs())
          or app.is_platform()) then
    raise exception 'dossier introuvable ou non autorise' using errcode = '42501';
  end if;

  select jurisdiction into v_juridiction from identity.organizations where id = p_tenant;

  select forme_juridique, mode_depot, regime_imposition, secteur
    into v_fiche
    from identity.fiches_fiscales
   where tenant_id = p_tenant and valid_to is null
   order by valid_from desc
   limit 1;
  if not found then
    return jsonb_build_object('generees', 0, 'raison', 'fiche.absente');
  end if;
  if v_fiche.forme_juridique is null or v_fiche.mode_depot is null then
    return jsonb_build_object('generees', 0, 'raison', 'fiche.incomplete');
  end if;

  select id into v_pack
    from ref.jurisdiction_packs
   where jurisdiction = v_juridiction
     and effective_from <= current_date
     and (effective_to is null or effective_to > current_date)
   order by effective_from desc
   limit 1;
  if v_pack is null then
    return jsonb_build_object('generees', 0, 'raison', 'pack.absent');
  end if;

  -- Le cabinet qui tient ce dossier, s'il y en a un.
  select cabinet_org_id into v_cabinet
    from identity.engagements
   where pme_org_id = p_tenant and status = 'actif'
     and starts_on <= current_date and (ends_on is null or ends_on >= current_date)
   order by starts_on desc
   limit 1;

  for v_ob in
    with applicables as (
      select o.code, o.libelle, o.periodicite, o.echeance_jour, null::integer as echeance_mois,
             split_part(o.code, '_', 1) as famille,
             (case when o.forme_juridique is not null then 2 else 0 end
              + case when o.mode_depot is not null then 1 else 0 end
              + case when o.regime is not null then 4 else 0 end) as precision
        from ref.fiscal_obligations o
       where o.jurisdiction = v_juridiction
         and o.periodicite in ('mensuelle', 'trimestrielle')
         and o.echeance_jour is not null
         and o.valid_from <= p_jusqua
         and (o.valid_to is null or o.valid_to > v_depuis)
         and (o.forme_juridique is null or o.forme_juridique = v_fiche.forme_juridique)
         and (o.mode_depot is null or o.mode_depot = v_fiche.mode_depot)
         and (o.regime is null or o.regime = v_fiche.regime_imposition)
    ),
    retenues as (
      select a.code, a.libelle, a.periodicite, a.echeance_jour, a.echeance_mois
        from applicables a
       where a.precision = (select max(b.precision) from applicables b where b.famille = a.famille)
      union all
      select 'CAB:' || p.id::text, p.libelle, p.periodicite, p.echeance_jour, p.echeance_mois
        from collab.obligations_propres p
       where v_cabinet is not null and p.tenant_id = v_cabinet and p.active
         and (p.secteur = '*' or p.secteur = v_fiche.secteur)
    )
    select * from retenues
  loop
    v_mois := v_depuis;
    while v_mois <= p_jusqua loop
      v_legale := null;
      if v_ob.periodicite = 'mensuelle' then
        v_periode := to_char(v_mois - interval '1 month', 'YYYY-MM');
        v_legale  := v_mois + (v_ob.echeance_jour - 1);
      elsif v_ob.periodicite = 'trimestrielle' and extract(month from v_mois)::int % 3 = 1 then
        v_periode := to_char(v_mois - interval '1 month', 'YYYY')
                     || '-T' || extract(quarter from v_mois - interval '1 month')::text;
        v_legale  := v_mois + (v_ob.echeance_jour - 1);
      elsif v_ob.periodicite = 'annuelle' and extract(month from v_mois)::int = v_ob.echeance_mois then
        v_periode := to_char(v_mois, 'YYYY');
        v_legale  := v_mois + (v_ob.echeance_jour - 1);
      end if;

      -- La fenêtre se juge sur la date LÉGALE : un report qui pousse
      -- l'échéance au-delà de l'horizon doit quand même mettre la ligne à jour.
      if v_legale is not null and v_legale between v_depuis and p_jusqua
         -- Le cabinet a-t-il écarté cette obligation pour cet exercice et ce secteur ?
         and not exists (
           select 1 from collab.obligations_cabinet r
            where r.tenant_id = v_cabinet and r.obligation_code = v_ob.code
              and r.exercice = extract(year from v_legale)::int
              and (r.secteur = '*' or r.secteur = v_fiche.secteur)
              and r.active = false)
      then
        -- La date retenue : report du cabinet, sinon d'ALGORIA, sinon le
        -- premier jour ouvrable à partir de la date légale.
        v_echeance := null;
        v_motif := null;
        v_source := null;
        select r.nouvelle_date, r.motif, r.source into v_rep
          from collab.reports_echeance_cabinet r
         where v_cabinet is not null and r.tenant_id = v_cabinet
           and r.obligation_code = v_ob.code and r.periode = v_periode and r.retire_le is null;
        if found then
          v_echeance := v_rep.nouvelle_date;
          v_origine  := 'report_cabinet';
          v_motif    := v_rep.motif;
          v_source   := v_rep.source;
        else
          select r.nouvelle_date, r.motif, r.source into v_rep
            from ref.reports_echeance r
           where r.jurisdiction = v_juridiction
             and r.obligation_code = v_ob.code and r.periode = v_periode and r.retire_le is null;
          if found then
            v_echeance := v_rep.nouvelle_date;
            v_origine  := 'report_algoria';
            v_motif    := v_rep.motif;
            v_source   := v_rep.source;
          else
            v_echeance := app.jour_ouvrable(v_juridiction, v_legale);
            v_origine  := case when v_echeance = v_legale then 'loi' else 'jour_ouvrable' end;
          end if;
        end if;

        insert into schedule.echeances
          (tenant_id, kind, label, period, due_date, pack_version_id,
           date_legale, date_origine, report_motif, report_source)
        values (p_tenant, v_ob.code, v_ob.libelle, v_periode, v_echeance, v_pack,
                v_legale, v_origine, v_motif, v_source)
        on conflict (tenant_id, kind, period) do update
          set due_date        = excluded.due_date,
              label           = excluded.label,
              pack_version_id = excluded.pack_version_id,
              date_legale     = excluded.date_legale,
              date_origine    = excluded.date_origine,
              report_motif    = excluded.report_motif,
              report_source   = excluded.report_source
          where schedule.echeances.status <> 'fait';
        v_n := v_n + 1;
      end if;
      v_mois := (v_mois + interval '1 month')::date;
    end loop;
  end loop;

  -- Ce que le cabinet a écarté depuis sort du calendrier, sauf ce qui est fait.
  delete from schedule.echeances s
   where s.tenant_id = p_tenant and s.status <> 'fait'
     and coalesce(s.date_legale, s.due_date) >= v_depuis
     and exists (
       select 1 from collab.obligations_cabinet r
        where r.tenant_id = v_cabinet and r.obligation_code = s.kind
          and r.exercice = extract(year from coalesce(s.date_legale, s.due_date))::int
          and (r.secteur = '*' or r.secteur = v_fiche.secteur)
          and r.active = false);

  update schedule.echeances set status = 'en_retard'
   where tenant_id = p_tenant and status = 'a_venir' and due_date < current_date;
  update schedule.echeances set status = 'a_venir'
   where tenant_id = p_tenant and status = 'en_retard' and due_date >= current_date;

  return jsonb_build_object('generees', v_n, 'raison', null);
end
$$;
revoke all on function public.echeances_deriver(uuid, date) from public, anon;
grant execute on function public.echeances_deriver(uuid, date) to authenticated;

-- 8. Les reports du cabinet --------------------------------------------------------
-- Le code doit désigner une obligation que le cabinet connaît : du pack de
-- SA juridiction, ou l'une de ses obligations propres.
create or replace function public.cabinet_report_poser(
  p_cabinet uuid, p_code text, p_periode text, p_date date, p_motif text, p_source text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_juridiction text;
  v_id          uuid;
begin
  if p_cabinet not in (select app.member_orgs()) then
    raise exception 'cabinet introuvable ou non autorise' using errcode = '42501';
  end if;
  if p_date is null then
    raise exception 'la nouvelle date est requise' using errcode = 'check_violation';
  end if;
  if coalesce(btrim(p_motif), '') = '' then
    raise exception 'un report se motive' using errcode = 'check_violation';
  end if;
  if coalesce(p_periode, '') !~ '^[0-9]{4}(-(0[1-9]|1[0-2])|-T[1-4])?$' then
    raise exception 'periode illisible : AAAA-MM, AAAA-Tn ou AAAA' using errcode = 'check_violation';
  end if;
  select jurisdiction into v_juridiction from identity.organizations where id = p_cabinet;
  if not (
    exists (select 1 from ref.fiscal_obligations o
             where o.jurisdiction = v_juridiction and o.code = p_code)
    or (p_code like 'CAB:%' and exists (
          select 1 from collab.obligations_propres p
           where p.tenant_id = p_cabinet and p.id::text = substr(p_code, 5)))
  ) then
    raise exception 'obligation inconnue de ce cabinet' using errcode = 'check_violation';
  end if;

  update collab.reports_echeance_cabinet
     set retire_le = now()
   where tenant_id = p_cabinet and obligation_code = p_code and periode = p_periode
     and retire_le is null;
  insert into collab.reports_echeance_cabinet
    (tenant_id, obligation_code, periode, nouvelle_date, motif, source)
  values (p_cabinet, p_code, p_periode, p_date, btrim(p_motif), nullif(btrim(p_source), ''))
  returning id into v_id;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_cabinet, auth.uid(), 'cabinet.report_echeance', 'collab', 'reports_echeance_cabinet', v_id,
          jsonb_build_object('code', p_code, 'periode', p_periode, 'date', p_date,
                             'motif', p_motif, 'source', p_source));
  return jsonb_build_object('id', v_id);
end
$$;

create or replace function public.cabinet_report_retirer(p_cabinet uuid, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_cabinet not in (select app.member_orgs()) then
    raise exception 'cabinet introuvable ou non autorise' using errcode = '42501';
  end if;
  update collab.reports_echeance_cabinet
     set retire_le = now()
   where id = p_id and tenant_id = p_cabinet and retire_le is null;
  if not found then
    raise exception 'report introuvable' using errcode = 'P0002';
  end if;
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_cabinet, auth.uid(), 'cabinet.report_retire', 'collab', 'reports_echeance_cabinet', p_id,
          '{}'::jsonb);
  return jsonb_build_object('id', p_id);
end
$$;

-- Les reports qui touchent les dossiers du cabinet : les siens, et ceux
-- qu'ALGORIA a publiés pour sa juridiction.
create or replace function public.cabinet_reports_lire(p_cabinet uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_juridiction text;
  v             jsonb;
begin
  if p_cabinet not in (select app.member_orgs()) then
    raise exception 'cabinet introuvable ou non autorise' using errcode = '42501';
  end if;
  select jurisdiction into v_juridiction from identity.organizations where id = p_cabinet;
  select coalesce(jsonb_agg(x.j order by x.nouvelle_date desc, x.creee desc), '[]'::jsonb) into v
    from (
      select r.nouvelle_date, r.created_at as creee,
             jsonb_build_object(
               'id', r.id, 'origine', 'report_cabinet', 'code', r.obligation_code,
               'libelle', coalesce(
                 (select o.libelle from ref.fiscal_obligations o
                   where o.jurisdiction = v_juridiction and o.code = r.obligation_code
                   order by o.valid_from desc limit 1),
                 (select p.libelle from collab.obligations_propres p
                   where r.obligation_code like 'CAB:%' and p.id::text = substr(r.obligation_code, 5))),
               'periode', r.periode, 'nouvelleDate', r.nouvelle_date,
               'motif', r.motif, 'source', r.source, 'creeLe', r.created_at) as j
        from collab.reports_echeance_cabinet r
       where r.tenant_id = p_cabinet and r.retire_le is null
      union all
      select r.nouvelle_date, r.created_at,
             jsonb_build_object(
               'id', r.id, 'origine', 'report_algoria', 'code', r.obligation_code,
               'libelle', (select o.libelle from ref.fiscal_obligations o
                            where o.jurisdiction = r.jurisdiction and o.code = r.obligation_code
                            order by o.valid_from desc limit 1),
               'periode', r.periode, 'nouvelleDate', r.nouvelle_date,
               'motif', r.motif, 'source', r.source, 'creeLe', r.created_at)
        from ref.reports_echeance r
       where r.jurisdiction = v_juridiction and r.retire_le is null
    ) x;
  return v;
end
$$;

revoke all on function public.cabinet_report_poser(uuid, text, text, date, text, text) from public, anon;
revoke all on function public.cabinet_report_retirer(uuid, uuid) from public, anon;
revoke all on function public.cabinet_reports_lire(uuid) from public, anon;
grant execute on function public.cabinet_report_poser(uuid, text, text, date, text, text) to authenticated;
grant execute on function public.cabinet_report_retirer(uuid, uuid) to authenticated;
grant execute on function public.cabinet_reports_lire(uuid) to authenticated;

-- 9. La tour : jours fériés, règle de report, reports publiés -----------------------
create or replace function plateforme.calendrier_lire(p_juridiction text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_platform() then
    raise exception 'reserve aux operateurs de la plateforme' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'regle', (select jsonb_build_object('joursRepos', c.jours_repos,
                                        'reportJourOuvrable', c.report_jour_ouvrable,
                                        'source', c.source)
                from ref.calendrier_juridiction c where c.jurisdiction = p_juridiction),
    'joursFeries', (select coalesce(jsonb_agg(jsonb_build_object(
                       'id', f.id, 'mois', f.mois, 'jour', f.jour, 'le', f.le,
                       'libelle', f.libelle, 'source', f.source)
                       order by coalesce(f.le, make_date(2000, f.mois, f.jour)) nulls last, f.libelle),
                     '[]'::jsonb)
                      from ref.jours_feries f
                     where f.jurisdiction = p_juridiction and f.valid_to is null
                       and (f.le is null or f.le >= date_trunc('year', current_date)::date)),
    'reports', (select coalesce(jsonb_agg(jsonb_build_object(
                   'id', r.id, 'code', r.obligation_code,
                   'libelle', (select o.libelle from ref.fiscal_obligations o
                                where o.jurisdiction = r.jurisdiction and o.code = r.obligation_code
                                order by o.valid_from desc limit 1),
                   'periode', r.periode, 'nouvelleDate', r.nouvelle_date,
                   'motif', r.motif, 'source', r.source)
                   order by r.nouvelle_date desc), '[]'::jsonb)
                  from ref.reports_echeance r
                 where r.jurisdiction = p_juridiction and r.retire_le is null),
    'obligations', (select coalesce(jsonb_agg(distinct jsonb_build_object(
                       'code', o.code, 'libelle', o.libelle, 'periodicite', o.periodicite)), '[]'::jsonb)
                      from ref.fiscal_obligations o
                     where o.jurisdiction = p_juridiction and o.echeance_jour is not null
                       and o.periodicite in ('mensuelle', 'trimestrielle', 'annuelle')
                       and (o.valid_to is null or o.valid_to > current_date)));
end
$$;

create or replace function plateforme.jour_ferie_poser(
  p_juridiction text, p_mois smallint, p_jour smallint, p_le date, p_libelle text, p_source text
) returns jsonb
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
  if coalesce(btrim(p_source), '') = '' then
    raise exception 'un jour ferie se source' using errcode = 'check_violation';
  end if;
  insert into ref.jours_feries (jurisdiction, mois, jour, le, libelle, source)
  values (p_juridiction,
          case when p_le is null then p_mois end,
          case when p_le is null then p_jour end,
          p_le, btrim(p_libelle), btrim(p_source))
  returning id into v_id;
  return jsonb_build_object('id', v_id);
end
$$;

create or replace function plateforme.jour_ferie_retirer(p_id uuid, p_motif text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_platform() then
    raise exception 'reserve aux operateurs de la plateforme' using errcode = '42501';
  end if;
  if coalesce(btrim(p_motif), '') = '' then
    raise exception 'un retrait se motive' using errcode = 'check_violation';
  end if;
  update ref.jours_feries
     set valid_to = greatest(current_date, valid_from + 1),
         retire_par = auth.uid(), motif_retrait = btrim(p_motif)
   where id = p_id and valid_to is null;
  if not found then
    raise exception 'jour ferie introuvable' using errcode = 'P0002';
  end if;
  return jsonb_build_object('id', p_id);
end
$$;

create or replace function plateforme.report_publier(
  p_juridiction text, p_code text, p_periode text, p_date date, p_motif text, p_source text
) returns jsonb
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
  if p_date is null then
    raise exception 'la nouvelle date est requise' using errcode = 'check_violation';
  end if;
  if coalesce(btrim(p_motif), '') = '' or coalesce(btrim(p_source), '') = '' then
    raise exception 'un report publie se motive et se source' using errcode = 'check_violation';
  end if;
  if coalesce(p_periode, '') !~ '^[0-9]{4}(-(0[1-9]|1[0-2])|-T[1-4])?$' then
    raise exception 'periode illisible : AAAA-MM, AAAA-Tn ou AAAA' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from ref.fiscal_obligations o
                  where o.jurisdiction = p_juridiction and o.code = p_code) then
    raise exception 'obligation inconnue du pack' using errcode = 'check_violation';
  end if;
  update ref.reports_echeance
     set retire_le = now(), retire_par = auth.uid(), motif_retrait = 'remplace par un nouveau report'
   where jurisdiction = p_juridiction and obligation_code = p_code and periode = p_periode
     and retire_le is null;
  insert into ref.reports_echeance (jurisdiction, obligation_code, periode, nouvelle_date, motif, source)
  values (p_juridiction, p_code, p_periode, p_date, btrim(p_motif), btrim(p_source))
  returning id into v_id;
  return jsonb_build_object('id', v_id);
end
$$;

create or replace function plateforme.report_retirer(p_id uuid, p_motif text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_platform() then
    raise exception 'reserve aux operateurs de la plateforme' using errcode = '42501';
  end if;
  if coalesce(btrim(p_motif), '') = '' then
    raise exception 'un retrait se motive' using errcode = 'check_violation';
  end if;
  update ref.reports_echeance
     set retire_le = now(), retire_par = auth.uid(), motif_retrait = btrim(p_motif)
   where id = p_id and retire_le is null;
  if not found then
    raise exception 'report introuvable' using errcode = 'P0002';
  end if;
  return jsonb_build_object('id', p_id);
end
$$;

revoke all on function plateforme.calendrier_lire(text) from public, anon;
revoke all on function plateforme.jour_ferie_poser(text, smallint, smallint, date, text, text) from public, anon;
revoke all on function plateforme.jour_ferie_retirer(uuid, text) from public, anon;
revoke all on function plateforme.report_publier(text, text, text, date, text, text) from public, anon;
revoke all on function plateforme.report_retirer(uuid, text) from public, anon;
grant execute on function plateforme.calendrier_lire(text) to authenticated;
grant execute on function plateforme.jour_ferie_poser(text, smallint, smallint, date, text, text) to authenticated;
grant execute on function plateforme.jour_ferie_retirer(uuid, text) to authenticated;
grant execute on function plateforme.report_publier(text, text, text, date, text, text) to authenticated;
grant execute on function plateforme.report_retirer(uuid, text) to authenticated;

commit;
