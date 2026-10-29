-- Le journal du jour tient ses jours (29 octobre 2026).
--
-- Relecture indépendante du lot « journal du jour » :
--
--   P1-1  Une écriture validée en supervision DISPARAISSAIT de son journal
--         dès qu'on la forçait : le jour de validation était lu dans
--         `reviewed_at` / `review_outcome`, que la supervision « retourne »
--         réécrit. Un jour passé ne change jamais après coup : la prise en
--         charge se date désormais par le PREMIER fait `ecriture.validee` de
--         la piste d'audit, qui est en ajout seul.
--   P1-3  Le jour se lisait dans le fuseau envoyé par l'écran. Décision du
--         dirigeant : le fuseau est un paramètre métier du cabinet, en base.
--         Le défaut est livré par le référentiel de la juridiction
--         (`ref.calendrier_juridiction.fuseau`, R10) ; le cabinet le change
--         dans ses réglages (`identity.organizations.fuseau`). Sans l'un ni
--         l'autre, la lecture lève (R4 : aucun repli implicite).
--   P2    * Les forçages antérieurs à la marque `ecriture.forcee` se
--           reconnaissent : `corrigerLImputation` retourne l'écriture
--           remplacée et inscrit la correction dans UNE transaction, donc au
--           même `now()` — la correction est l'écriture de la même pièce,
--           créée par le même acteur à l'instant exact du fait
--           `ecriture.retournee`.
--         * La contre-passation d'une écriture que le cabinet n'a jamais
--           prise en charge n'entre pas à son journal : l'originale n'y est
--           jamais entrée, le logiciel qui importe le journal recevrait
--           l'annulation d'une écriture qu'il n'a pas.
--         * Pré-filtre par fenêtre de dates, sur deux index menés par le
--           tenant (R6).
--
-- REJEU (R11) : `if not exists`, `create or replace` ; aucune date du jour
-- écrite dans le référentiel.

begin;

-- --- 1. Le fuseau : un défaut du référentiel, un réglage du cabinet ------------------
alter table ref.calendrier_juridiction add column if not exists fuseau text;
update ref.calendrier_juridiction
   set fuseau = 'Africa/Tunis'
 where jurisdiction = 'TN' and fuseau is distinct from 'Africa/Tunis';

alter table identity.organizations add column if not exists fuseau text;

-- Le fuseau en vigueur pour un cabinet : son réglage, sinon celui de sa
-- juridiction ; aucun des deux, on le dit.
create or replace function app.fuseau_du_cabinet(p_cabinet uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_fuseau text;
begin
  select coalesce(o.fuseau, c.fuseau) into v_fuseau
    from identity.organizations o
    left join ref.calendrier_juridiction c on c.jurisdiction = o.jurisdiction
   where o.id = p_cabinet;
  if v_fuseau is null then
    raise exception 'le fuseau horaire du cabinet n''est pas défini : réglez-le dans les réglages du cabinet'
      using errcode = '22023';
  end if;
  return v_fuseau;
end $$;
revoke all on function app.fuseau_du_cabinet(uuid) from public, anon;
grant execute on function app.fuseau_du_cabinet(uuid) to authenticated;

-- Ce que les réglages montrent : le fuseau en vigueur, celui du référentiel,
-- et si le cabinet a arrêté le sien (R10 : un défaut se dit).
create or replace function public.cabinet_fuseau_lire(p_cabinet uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  if p_cabinet not in (select app.member_orgs()) then
    raise exception 'cabinet introuvable ou non autorise' using errcode = '42501';
  end if;
  select jsonb_build_object(
           'fuseau', coalesce(o.fuseau, c.fuseau),
           'defaut', c.fuseau,
           'regle', o.fuseau is not null,
           'aujourdhui', case when coalesce(o.fuseau, c.fuseau) is not null
                              then (now() at time zone coalesce(o.fuseau, c.fuseau))::date end)
    into v
    from identity.organizations o
    left join ref.calendrier_juridiction c on c.jurisdiction = o.jurisdiction
   where o.id = p_cabinet;
  return v;
end $$;
revoke all on function public.cabinet_fuseau_lire(uuid) from public, anon;
grant execute on function public.cabinet_fuseau_lire(uuid) to authenticated;

-- L'expert arrête le fuseau du cabinet ; nul, le cabinet revient au défaut.
create or replace function public.cabinet_fuseau_definir(p_cabinet uuid, p_fuseau text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_cabinet not in (select app.member_orgs()) then
    raise exception 'cabinet introuvable ou non autorise' using errcode = '42501';
  end if;
  if not app.has_org_role(p_cabinet, array['expert']) then
    raise exception 'Le fuseau horaire du cabinet est réglé par l''expert-comptable.'
      using errcode = '42501';
  end if;
  if p_fuseau is not null
     and not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = p_fuseau) then
    raise exception 'ce fuseau horaire n''existe pas : %', p_fuseau using errcode = '22023';
  end if;

  update identity.organizations set fuseau = p_fuseau where id = p_cabinet;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_cabinet, auth.uid(), 'cabinet.reglages', 'identity', 'organizations', p_cabinet,
          jsonb_build_object('fuseau', p_fuseau));

  return public.cabinet_fuseau_lire(p_cabinet);
end $$;
revoke all on function public.cabinet_fuseau_definir(uuid, text) from public, anon;
grant execute on function public.cabinet_fuseau_definir(uuid, text) to authenticated;

-- --- 2. La prise en charge d'une écriture : origine, instant, qui -------------------
-- Tout est lu dans des faits qui ne changent plus : l'inscription
-- (`booked_at`, gelée par R7) et la piste d'audit (en ajout seul).
create or replace function app.ecriture_prise_en_charge(p_cabinet uuid, p_ecriture uuid)
returns table (origine text, prise_le timestamptz, par uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  e        socle.ecritures%rowtype;
  v_forcee boolean;
  v_cab    boolean;
  v_val_at timestamptz;
  v_val_par uuid;
begin
  select * into e from socle.ecritures x where x.id = p_ecriture and x.status = 'booked';
  if not found then return; end if;

  if e.reverses_id is not null then
    -- Au journal seulement si l'écriture annulée y est entrée.
    if exists (select 1 from app.ecriture_prise_en_charge(p_cabinet, e.reverses_id) o
                where o.prise_le is not null) then
      return query select 'contre_passation'::text, e.booked_at, e.booked_by;
    end if;
    return;
  end if;

  v_forcee := exists (select 1 from audit.event_log a
                       where a.object_table = 'ecritures' and a.object_id = e.id
                         and a.action = 'ecriture.forcee')
           -- Les forçages d'avant la marque : la correction naît dans la
           -- transaction qui retourne l'écriture remplacée.
           or exists (select 1 from audit.event_log a
                       where a.tenant_id = e.tenant_id and a.at = e.created_at
                         and a.action = 'ecriture.retournee' and a.object_table = 'ecritures'
                         and a.actor = e.created_by
                         and a.payload ->> 'piece_id' = e.piece_id::text);
  if v_forcee then
    return query select 'forcee'::text, e.booked_at, e.booked_by;
    return;
  end if;

  v_cab := exists (select 1 from identity.memberships m
                    where m.tenant_id = p_cabinet and m.user_id = e.booked_by);
  select a.at, a.actor into v_val_at, v_val_par
    from audit.event_log a
   where a.object_table = 'ecritures' and a.object_id = e.id and a.action = 'ecriture.validee'
   order by a.at, a.id
   limit 1;

  if v_cab and (v_val_at is null or e.booked_at <= v_val_at) then
    return query select 'validee'::text, e.booked_at, e.booked_by;
  elsif v_val_at is not null then
    return query select 'validee'::text, v_val_at, v_val_par;
  end if;
end $$;
revoke all on function app.ecriture_prise_en_charge(uuid, uuid) from public, anon;
grant execute on function app.ecriture_prise_en_charge(uuid, uuid) to authenticated;

-- --- 3. Le journal du jour, dans le fuseau du cabinet ---------------------------------
create index if not exists ecritures_tenant_booked_at_idx
  on socle.ecritures (tenant_id, booked_at) where status = 'booked';

drop function if exists public.journal_du_jour_lire(uuid, uuid, date, text);

create or replace function public.journal_du_jour_lire(p_cabinet uuid, p_client uuid, p_jour date)
returns table (
  client_tenant_id uuid,
  client_nom       text,
  ecriture_id      uuid,
  journal          text,
  journal_libelle  text,
  journal_rang     smallint,
  piece_id         uuid,
  ecriture_libelle text,
  ordinal          smallint,
  compte           text,
  compte_libelle   text,
  debit            numeric,
  credit           numeric,
  devise           text,
  origine          text,
  inscrite_le      timestamptz,
  heure            text,
  par              text,
  reverses_id      uuid,
  contre_passee_le timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_mandats uuid[] := array(select app.export_mandats(p_cabinet, p_client));
  v_fuseau  text := app.fuseau_du_cabinet(p_cabinet);
  v_debut   timestamptz := p_jour::timestamp at time zone v_fuseau;
  v_fin     timestamptz := (p_jour + 1)::timestamp at time zone v_fuseau;
begin
  return query
    with candidats as (
      -- Inscrites ce jour-là (prises en charge, forcées, contre-passations)…
      select x.id from socle.ecritures x
       where x.tenant_id = any(v_mandats) and x.status = 'booked'
         and x.booked_at >= v_debut and x.booked_at < v_fin
      union
      -- … ou validées ce jour-là.
      select a.object_id from audit.event_log a
       where a.tenant_id = any(v_mandats) and a.action = 'ecriture.validee'
         and a.object_table = 'ecritures' and a.at >= v_debut and a.at < v_fin
    ),
    du_jour as (
      select e.*, p.origine as v_origine, p.prise_le as v_inscrite_le, p.par as v_par
        from candidats c
        join socle.ecritures e on e.id = c.id
        cross join lateral app.ecriture_prise_en_charge(p_cabinet, e.id) p
       where e.status = 'booked'
         and e.vis = 'partage'::app.vis_t
         and e.tenant_id = any(v_mandats)
         and p.prise_le >= v_debut and p.prise_le < v_fin
    )
    select d.tenant_id,
           o.name,
           d.id,
           d.journal,
           coalesce(j.libelle, d.journal),
           j.rang,
           d.piece_id,
           d.libelle,
           l.ordinal,
           l.account_code,
           coalesce(
             (select pa.label from parametrage.accounts pa
               where pa.tenant_id = p_cabinet and pa.account_code = l.account_code),
             (select ra.label from ref.accounts ra
               where ra.pack_version_id = d.pack_version_id and ra.account_code = l.account_code),
             l.libelle),
           l.debit::numeric,
           l.credit::numeric,
           d.devise,
           d.v_origine,
           d.v_inscrite_le,
           to_char(d.v_inscrite_le at time zone v_fuseau, 'HH24:MI'),
           (select coalesce(nullif(btrim(concat_ws(' ', pr.prenom, pr.nom)), ''),
                            nullif(btrim(pr.display_name), ''),
                            u.email::text)
              from auth.users u
              left join identity.profiles pr on pr.user_id = u.id
             where u.id = d.v_par
               and exists (select 1 from identity.memberships m
                            where m.tenant_id = p_cabinet and m.user_id = u.id)),
           d.reverses_id,
           (select r.booked_at from socle.ecritures r
             where r.reverses_id = d.id and r.status = 'booked'
             order by r.booked_at limit 1)
      from du_jour d
      join socle.ecriture_lignes l on l.ecriture_id = d.id
      join identity.organizations o on o.id = d.tenant_id
      left join ref.journals j on j.code = d.journal
     order by j.rang nulls last, d.journal, d.v_inscrite_le, o.name, d.id, l.ordinal;
end $$;
revoke all on function public.journal_du_jour_lire(uuid, uuid, date) from public, anon;
grant execute on function public.journal_du_jour_lire(uuid, uuid, date) to authenticated;

commit;
