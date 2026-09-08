-- =====================================================================================
--  Malica Office — Le calendrier du cabinet, et le ton de ses restitutions.
--
--  POURQUOI : le pack dit quelles obligations existent ; le cabinet dit
--  lesquelles il suit pour ses mandats, par secteur et par exercice, avec
--  quel rappel — et il peut ajouter une obligation qui n'existe que pour lui
--  (une taxe locale, une convention de place). Une obligation désactivée
--  DISPARAÎT du calendrier des dossiers concernés : la dérivation la lit.
--
--  Le ton des restitutions est un réglage du cabinet : les PV que Malica
--  rédige le portent.
--
--  Idempotent.
-- =====================================================================================

-- --- 1. Le ton --------------------------------------------------------------------------
alter table collab.reglages_cabinet
  add column if not exists ton_restitutions text not null default 'sobre'
    check (ton_restitutions in ('sobre', 'chaleureux'));

-- La vue se recompose depuis le catalogue : rejouée après qu'une migration
-- plus récente l'a élargie, elle garde toutes les colonnes (une vue remplacée
-- ne peut pas en perdre).
do $$
declare
  v_cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into v_cols
    from information_schema.columns
   where table_schema = 'collab' and table_name = 'reglages_cabinet';
  execute format(
    'create or replace view public.reglages_cabinet_v with (security_invoker = true) as select %s from collab.reglages_cabinet',
    v_cols);
end $$;
grant select on public.reglages_cabinet_v to authenticated;

create or replace function public.cabinet_reglages_lire(p_tenant uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v jsonb;
begin
  if p_tenant not in (select app.member_orgs()) then
    raise exception 'cabinet introuvable ou non autorise' using errcode = '42501';
  end if;
  select jsonb_build_object(
           'seuilConfianceLot', r.seuil_confiance_lot,
           'seuilConfianceRevue', r.seuil_confiance_revue,
           'doubleValidationAuDela', r.double_validation_au_dela,
           'propositionsProactives', r.propositions_proactives,
           'capaciteDossiers', r.capacite_dossiers_par_collaborateur,
           'ton', r.ton_restitutions,
           'regle', true)
    into v
    from collab.reglages_cabinet r where r.tenant_id = p_tenant;
  if v is not null then return v; end if;

  -- Les défauts, tels que le schéma les déclare.
  select jsonb_build_object(
           'seuilConfianceLot', (select column_default::numeric from information_schema.columns
                                  where table_schema = 'collab' and table_name = 'reglages_cabinet'
                                    and column_name = 'seuil_confiance_lot'),
           'seuilConfianceRevue', (select column_default::numeric from information_schema.columns
                                    where table_schema = 'collab' and table_name = 'reglages_cabinet'
                                      and column_name = 'seuil_confiance_revue'),
           'doubleValidationAuDela', null,
           'propositionsProactives', true,
           'capaciteDossiers', (select column_default::integer from information_schema.columns
                                 where table_schema = 'collab' and table_name = 'reglages_cabinet'
                                   and column_name = 'capacite_dossiers_par_collaborateur'),
           'ton', (select split_part(column_default, '''', 2) from information_schema.columns
                    where table_schema = 'collab' and table_name = 'reglages_cabinet'
                      and column_name = 'ton_restitutions'),
           'regle', false)
    into v;
  return v;
end $$;

drop function if exists public.cabinet_reglages_definir(uuid, numeric, numeric, numeric, boolean, integer);
create or replace function public.cabinet_reglages_definir(
  p_tenant uuid,
  p_seuil_lot numeric,
  p_seuil_revue numeric,
  p_double_validation numeric,
  p_proactives boolean,
  p_capacite integer,
  p_ton text
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_tenant not in (select app.member_orgs()) then
    raise exception 'cabinet introuvable ou non autorise' using errcode = '42501';
  end if;
  insert into collab.reglages_cabinet
    (tenant_id, seuil_confiance_lot, seuil_confiance_revue, double_validation_au_dela,
     propositions_proactives, capacite_dossiers_par_collaborateur, ton_restitutions)
  values (p_tenant, p_seuil_lot, p_seuil_revue, p_double_validation, p_proactives, p_capacite, p_ton)
  on conflict (tenant_id) do update
    set seuil_confiance_lot = excluded.seuil_confiance_lot,
        seuil_confiance_revue = excluded.seuil_confiance_revue,
        double_validation_au_dela = excluded.double_validation_au_dela,
        propositions_proactives = excluded.propositions_proactives,
        capacite_dossiers_par_collaborateur = excluded.capacite_dossiers_par_collaborateur,
        ton_restitutions = excluded.ton_restitutions,
        updated_by = auth.uid(),
        updated_at = now();

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_tenant, auth.uid(), 'cabinet.reglages', 'collab', 'reglages_cabinet', p_tenant,
          jsonb_build_object('seuil_lot', p_seuil_lot, 'seuil_revue', p_seuil_revue,
                             'double_validation', p_double_validation, 'proactives', p_proactives,
                             'capacite', p_capacite, 'ton', p_ton));

  return public.cabinet_reglages_lire(p_tenant);
end $$;

revoke all on function public.cabinet_reglages_definir(uuid, numeric, numeric, numeric, boolean, integer, text) from public, anon;
grant execute on function public.cabinet_reglages_definir(uuid, numeric, numeric, numeric, boolean, integer, text) to authenticated;

-- --- 2. Ce que le cabinet suit, par secteur et par exercice ------------------------------
-- Une ligne n'existe que quand le cabinet a touché à l'obligation ; absente,
-- l'obligation du pack s'applique, active, avec le rappel par défaut.
create table if not exists collab.obligations_cabinet (
  tenant_id       uuid not null references identity.organizations(id) on delete cascade,
  obligation_code text not null,
  exercice        integer not null check (exercice between 2000 and 2100),
  -- '*' : toutes activités ; sinon le secteur tel que la fiche du client l'écrit.
  secteur         text not null default '*',
  active          boolean not null default true,
  -- Le rappel, en jours avant la date limite.
  rappel_jours    integer not null default 7 check (rappel_jours between 0 and 60),
  updated_by      uuid not null default auth.uid(),
  updated_at      timestamptz not null default now(),
  primary key (tenant_id, obligation_code, exercice, secteur)
);
create index if not exists obligations_cabinet_tenant_idx on collab.obligations_cabinet (tenant_id);
select app.enable_tenant_rls('collab', 'obligations_cabinet', false, false);

-- --- 3. Les obligations propres au cabinet ------------------------------------------------
-- Elles n'existent que pour ses mandats, jamais dans le pack.
create table if not exists collab.obligations_propres (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references identity.organizations(id) on delete cascade,
  libelle       text not null check (length(btrim(libelle)) > 0),
  periodicite   text not null check (periodicite in ('mensuelle', 'trimestrielle', 'annuelle')),
  echeance_jour integer not null check (echeance_jour between 1 and 28),
  -- Le mois n'a de sens que pour une obligation annuelle.
  echeance_mois integer check (echeance_mois between 1 and 12),
  regle         text not null check (length(btrim(regle)) > 0),
  secteur       text not null default '*',
  active        boolean not null default true,
  created_by    uuid not null default auth.uid(),
  created_at    timestamptz not null default now(),
  check ((periodicite = 'annuelle') = (echeance_mois is not null))
);
create index if not exists obligations_propres_tenant_idx on collab.obligations_propres (tenant_id);
select app.enable_tenant_rls('collab', 'obligations_propres', false, false);

-- --- 4. Lire le calendrier du cabinet ------------------------------------------------------
-- Pour un exercice et un secteur : les obligations périodiques du pack de la
-- juridiction du cabinet, plus les siennes, avec ce qu'il en a réglé et le
-- nombre de mandats concernés. Le compte est RÉEL : il vient des fiches.
create or replace function public.cabinet_calendrier_lire(p_cabinet uuid, p_exercice integer, p_secteur text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_juridiction text;
  v_resultat    jsonb;
begin
  if p_cabinet not in (select app.member_orgs()) then
    raise exception 'cabinet introuvable ou non autorise' using errcode = '42501';
  end if;
  select jurisdiction into v_juridiction from identity.organizations where id = p_cabinet;

  with mandats as (
    select e.pme_org_id, f.forme_juridique, f.mode_depot, f.regime_imposition, f.secteur
      from identity.engagements e
      left join lateral (
        select forme_juridique, mode_depot, regime_imposition, secteur
          from identity.fiches_fiscales x
         where x.tenant_id = e.pme_org_id and x.valid_to is null
         order by x.valid_from desc limit 1) f on true
     where e.cabinet_org_id = p_cabinet and e.status = 'actif'
       and e.starts_on <= current_date and (e.ends_on is null or e.ends_on >= current_date)
  ),
  du_pack as (
    select o.code, o.libelle, o.periodicite, o.echeance_jour, null::integer as echeance_mois,
           o.echeance_regle as regle, o.texte_source, o.article, false as propre,
           '*'::text as secteur,
           (select count(*) from mandats m
             where (o.forme_juridique is null or o.forme_juridique = m.forme_juridique)
               and (o.mode_depot is null or o.mode_depot = m.mode_depot)
               and (o.regime is null or o.regime = m.regime_imposition)
               and (p_secteur = '*' or m.secteur = p_secteur)) as mandats
      from ref.fiscal_obligations o
     where o.jurisdiction = v_juridiction
       and o.periodicite in ('mensuelle', 'trimestrielle', 'annuelle')
       and o.echeance_jour is not null
       and o.valid_from <= make_date(p_exercice, 12, 31)
       and (o.valid_to is null or o.valid_to >= make_date(p_exercice, 1, 1))
  ),
  propres as (
    select 'CAB:' || p.id::text as code, p.libelle, p.periodicite, p.echeance_jour, p.echeance_mois,
           p.regle, null::text as texte_source, null::text as article, true as propre,
           p.secteur,
           (select count(*) from mandats m
             where (p.secteur = '*' or m.secteur = p.secteur)
               and (p_secteur = '*' or m.secteur = p_secteur)) as mandats
      from collab.obligations_propres p
     where p.tenant_id = p_cabinet and p.active
       and (p.secteur = '*' or p.secteur = p_secteur)
  ),
  toutes as (
    select * from du_pack union all select * from propres
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'code', t.code,
           'libelle', t.libelle,
           'periodicite', t.periodicite,
           'echeanceJour', t.echeance_jour,
           'echeanceMois', t.echeance_mois,
           'regle', t.regle,
           'texteSource', t.texte_source,
           'article', t.article,
           'propre', t.propre,
           'secteur', t.secteur,
           'mandats', t.mandats,
           'active', coalesce(r.active, true),
           'rappelJours', coalesce(r.rappel_jours,
             (select column_default::integer from information_schema.columns
               where table_schema = 'collab' and table_name = 'obligations_cabinet'
                 and column_name = 'rappel_jours')),
           'regle_par_le_cabinet', r.tenant_id is not null)
           order by t.propre, t.periodicite, t.libelle), '[]'::jsonb)
    into v_resultat
    from toutes t
    left join collab.obligations_cabinet r
      on r.tenant_id = p_cabinet and r.obligation_code = t.code
     and r.exercice = p_exercice and r.secteur = p_secteur;

  return v_resultat;
end $$;

revoke all on function public.cabinet_calendrier_lire(uuid, integer, text) from public, anon;
grant execute on function public.cabinet_calendrier_lire(uuid, integer, text) to authenticated;

-- --- 5. Régler une obligation --------------------------------------------------------------
create or replace function public.cabinet_obligation_definir(
  p_cabinet uuid, p_code text, p_exercice integer, p_secteur text, p_active boolean, p_rappel integer
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_cabinet not in (select app.member_orgs()) then
    raise exception 'cabinet introuvable ou non autorise' using errcode = '42501';
  end if;
  insert into collab.obligations_cabinet (tenant_id, obligation_code, exercice, secteur, active, rappel_jours)
  values (p_cabinet, p_code, p_exercice, p_secteur, p_active, p_rappel)
  on conflict (tenant_id, obligation_code, exercice, secteur) do update
    set active = excluded.active, rappel_jours = excluded.rappel_jours,
        updated_by = auth.uid(), updated_at = now();

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_cabinet, auth.uid(), 'cabinet.obligation_reglee', 'collab', 'obligations_cabinet', p_cabinet,
          jsonb_build_object('code', p_code, 'exercice', p_exercice, 'secteur', p_secteur,
                             'active', p_active, 'rappel', p_rappel));
  return jsonb_build_object('active', p_active, 'rappelJours', p_rappel);
end $$;

revoke all on function public.cabinet_obligation_definir(uuid, text, integer, text, boolean, integer) from public, anon;
grant execute on function public.cabinet_obligation_definir(uuid, text, integer, text, boolean, integer) to authenticated;

-- --- 6. Ajouter une obligation propre ------------------------------------------------------
create or replace function public.cabinet_obligation_propre_creer(
  p_cabinet uuid, p_libelle text, p_periodicite text, p_jour integer, p_mois integer, p_regle text, p_secteur text
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_cabinet not in (select app.member_orgs()) then
    raise exception 'cabinet introuvable ou non autorise' using errcode = '42501';
  end if;
  insert into collab.obligations_propres (tenant_id, libelle, periodicite, echeance_jour, echeance_mois, regle, secteur)
  values (p_cabinet, btrim(p_libelle), p_periodicite, p_jour, p_mois, btrim(p_regle), coalesce(nullif(btrim(p_secteur), ''), '*'))
  returning id into v_id;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_cabinet, auth.uid(), 'cabinet.obligation_propre', 'collab', 'obligations_propres', v_id,
          jsonb_build_object('libelle', p_libelle, 'periodicite', p_periodicite, 'jour', p_jour,
                             'mois', p_mois, 'secteur', p_secteur));
  return jsonb_build_object('id', v_id);
end $$;

revoke all on function public.cabinet_obligation_propre_creer(uuid, text, text, integer, integer, text, text) from public, anon;
grant execute on function public.cabinet_obligation_propre_creer(uuid, text, text, integer, integer, text, text) to authenticated;

-- --- 7. La dérivation écoute le cabinet ----------------------------------------------------
-- Une obligation que le cabinet mandaté a désactivée pour l'exercice et le
-- secteur du dossier n'entre pas ; ses obligations propres entrent.
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
  v_echeance    date;
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
      v_echeance := null;
      if v_ob.periodicite = 'mensuelle' then
        v_periode  := to_char(v_mois - interval '1 month', 'YYYY-MM');
        v_echeance := v_mois + (v_ob.echeance_jour - 1);
      elsif v_ob.periodicite = 'trimestrielle' and extract(month from v_mois)::int % 3 = 1 then
        v_periode  := to_char(v_mois - interval '1 month', 'YYYY')
                      || '-T' || extract(quarter from v_mois - interval '1 month')::text;
        v_echeance := v_mois + (v_ob.echeance_jour - 1);
      elsif v_ob.periodicite = 'annuelle' and extract(month from v_mois)::int = v_ob.echeance_mois then
        v_periode  := to_char(v_mois, 'YYYY');
        v_echeance := v_mois + (v_ob.echeance_jour - 1);
      end if;

      if v_echeance is not null and v_echeance between v_depuis and p_jusqua
         -- Le cabinet a-t-il écarté cette obligation pour cet exercice et ce secteur ?
         and not exists (
           select 1 from collab.obligations_cabinet r
            where r.tenant_id = v_cabinet and r.obligation_code = v_ob.code
              and r.exercice = extract(year from v_echeance)::int
              and (r.secteur = '*' or r.secteur = v_fiche.secteur)
              and r.active = false)
      then
        insert into schedule.echeances (tenant_id, kind, label, period, due_date, pack_version_id)
        values (p_tenant, v_ob.code, v_ob.libelle, v_periode, v_echeance, v_pack)
        on conflict (tenant_id, kind, period) do update
          set due_date        = excluded.due_date,
              label           = excluded.label,
              pack_version_id = excluded.pack_version_id
          where schedule.echeances.status <> 'fait';
        v_n := v_n + 1;
      end if;
      v_mois := (v_mois + interval '1 month')::date;
    end loop;
  end loop;

  -- Ce que le cabinet a écarté depuis sort du calendrier, sauf ce qui est fait.
  delete from schedule.echeances s
   where s.tenant_id = p_tenant and s.status <> 'fait' and s.due_date >= v_depuis
     and exists (
       select 1 from collab.obligations_cabinet r
        where r.tenant_id = v_cabinet and r.obligation_code = s.kind
          and r.exercice = extract(year from s.due_date)::int
          and (r.secteur = '*' or r.secteur = v_fiche.secteur)
          and r.active = false);

  update schedule.echeances set status = 'en_retard'
   where tenant_id = p_tenant and status = 'a_venir' and due_date < current_date;
  update schedule.echeances set status = 'a_venir'
   where tenant_id = p_tenant and status = 'en_retard' and due_date >= current_date;

  return jsonb_build_object('generees', v_n, 'raison', null);
end
$$;

-- La vue connaît aussi les obligations propres : leur règle vient du cabinet.
create or replace view public.echeances_v
with (security_invoker = true) as
select e.id, e.tenant_id, e.entity_id, e.kind, e.label, e.period, e.due_date, e.pack_version_id,
       e.status, e.created_at, e.updated_at,
       e.fait_le, e.fait_par,
       coalesce(fo.echeance_regle, op.regle) as echeance_regle,
       fo.texte_source, fo.article,
       coalesce(fo.periodicite, op.periodicite) as periodicite
from schedule.echeances e
join identity.organizations o on o.id = e.tenant_id
left join ref.fiscal_obligations fo
  on fo.jurisdiction = o.jurisdiction
 and fo.code = e.kind
 and fo.valid_from <= e.due_date
 and (fo.valid_to is null or fo.valid_to > e.due_date)
left join collab.obligations_propres op
  on e.kind like 'CAB:%' and op.id::text = substr(e.kind, 5);
