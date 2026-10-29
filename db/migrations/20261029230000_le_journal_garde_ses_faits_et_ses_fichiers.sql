-- Le journal du jour garde ses faits et ses fichiers (29 octobre 2026).
--
-- Revue de #129 (relecture indépendante et Codex) :
--
--   P2-1  « Chaque export est numéroté et gardé » (spec §4) : le fichier ne
--         l'était pas. Le journal des exports dit désormais où le relire : son
--         nom et son type ; les octets vivent dans le stockage des pièces, sous
--         le dossier du cabinet, servis sous la même RLS que la ligne.
--   P2-2  L'appartenance au jour se lisait dans les membres ACTUELS du cabinet :
--         un collaborateur parti emportait ses écritures — et leurs
--         contre-passations — des journaux passés, et son nom avec. La prise en
--         charge se GÈLE désormais au moment où elle a lieu (inscription par un
--         membre du cabinet, ou validation en supervision) : qui, quand, sous
--         quel nom. Le journal lit ce fait, jamais l'état présent.
--         Et une contre-passation n'entre au journal que si l'écriture annulée
--         y était entrée AVANT elle : un retour du jour D ne change pas
--         rétroactivement quand l'écriture est validée le jour D+1.
--   P3    * `app.ecriture_prise_en_charge` et `app.fuseau_du_cabinet` sont
--           `security definer` sans garde : leur exécution est retirée à tous,
--           seules les fonctions de lecture gardées (definer) les appellent ;
--         * chaque export garde le fuseau dans lequel il a été coupé : un
--           fuseau changé ne fabrique pas d'écart, le suivant le dit ;
--         * un jour à venir dans le fuseau du cabinet ne s'exporte pas : il ne
--           prend pas de numéro.
--
-- REPRISE : les prises en charge antérieures à cette migration sont relevées
-- depuis les faits existants (inscription, premier `ecriture.validee`) et les
-- membres du cabinet À CETTE DATE — la meilleure lecture disponible ; un
-- membre déjà parti avant elle n'y figure pas.
--
-- REJEU (R11) : `if not exists`, `on conflict do nothing`, `create or replace`.

begin;

-- --- 1. La prise en charge, gelée -----------------------------------------------------
-- `tenant_id` est le CABINET : c'est son journal. Écrite par déclencheur
-- seulement (aucun droit d'écriture direct), et jamais réécrite (R7).
create table if not exists socle.prises_en_charge (
  tenant_id        uuid not null references identity.organizations(id) on delete cascade,
  ecriture_id      uuid not null references socle.ecritures(id) on delete cascade,
  client_tenant_id uuid not null references identity.organizations(id) on delete cascade,
  par              uuid not null,
  par_nom          text,
  prise_le         timestamptz not null,
  created_at       timestamptz not null default now(),
  primary key (tenant_id, ecriture_id)
);
create index if not exists prises_en_charge_tenant_jour_idx
  on socle.prises_en_charge (tenant_id, prise_le);
create index if not exists prises_en_charge_ecriture_idx
  on socle.prises_en_charge (ecriture_id);
select app.enable_tenant_rls('socle', 'prises_en_charge', false, true);
revoke insert, update, delete on socle.prises_en_charge from authenticated;

-- Le nom tel qu'il est AU MOMENT du fait : prénom et nom, sinon le nom
-- affiché, sinon l'adresse.
create or replace function app.nom_au_moment(p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(nullif(btrim(concat_ws(' ', pr.prenom, pr.nom)), ''),
                  nullif(btrim(pr.display_name), ''),
                  u.email::text)
    from auth.users u
    left join identity.profiles pr on pr.user_id = u.id
   where u.id = p_user
$$;
revoke all on function app.nom_au_moment(uuid) from public, anon, authenticated;

-- Gèle la prise en charge pour chaque cabinet engagé dont l'acteur est
-- membre : à l'inscription (`booked_by`, `booked_at`) et à la validation
-- (`reviewed_by`, `reviewed_at`). La première prise l'emporte.
create or replace function app.geler_la_prise_en_charge()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_par uuid;
  v_le  timestamptz;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'booked' then return null; end if;
    v_par := new.booked_by;
    v_le := new.booked_at;
  elsif new.status = 'booked' and old.status is distinct from 'booked' then
    v_par := new.booked_by;
    v_le := new.booked_at;
  elsif new.review_outcome = 'valide' and new.reviewed_at is distinct from old.reviewed_at then
    v_par := new.reviewed_by;
    v_le := new.reviewed_at;
  else
    return null;
  end if;

  insert into socle.prises_en_charge (tenant_id, ecriture_id, client_tenant_id, par, par_nom, prise_le)
  select e.cabinet_org_id, new.id, new.tenant_id, v_par, app.nom_au_moment(v_par), v_le
    from identity.engagements e
    join identity.memberships m on m.tenant_id = e.cabinet_org_id and m.user_id = v_par
   where e.pme_org_id = new.tenant_id and e.status = 'actif'
  on conflict (tenant_id, ecriture_id) do nothing;
  return null;
end $$;
revoke all on function app.geler_la_prise_en_charge() from public, anon, authenticated;

drop trigger if exists ecritures_prise_en_charge on socle.ecritures;
create trigger ecritures_prise_en_charge
  after insert or update on socle.ecritures
  for each row execute function app.geler_la_prise_en_charge();

-- La reprise : la première prise de chaque cabinet — son inscription par un
-- membre, ou la première validation par un membre.
insert into socle.prises_en_charge (tenant_id, ecriture_id, client_tenant_id, par, par_nom, prise_le)
select distinct on (f.cabinet, f.ecriture)
       f.cabinet, f.ecriture, f.client, f.par, app.nom_au_moment(f.par), f.le
  from (
    select g.cabinet_org_id as cabinet, x.id as ecriture, x.tenant_id as client,
           x.booked_by as par, x.booked_at as le
      from socle.ecritures x
      join identity.engagements g on g.pme_org_id = x.tenant_id
      join identity.memberships m on m.tenant_id = g.cabinet_org_id and m.user_id = x.booked_by
     where x.status = 'booked'
    union all
    select g.cabinet_org_id, a.object_id, a.tenant_id, a.actor, a.at
      from audit.event_log a
      join socle.ecritures x on x.id = a.object_id and x.status = 'booked'
      join identity.engagements g on g.pme_org_id = a.tenant_id
      join identity.memberships m on m.tenant_id = g.cabinet_org_id and m.user_id = a.actor
     where a.action = 'ecriture.validee' and a.object_table = 'ecritures'
  ) f
 order by f.cabinet, f.ecriture, f.le
on conflict (tenant_id, ecriture_id) do nothing;

-- --- 2. L'origine, lue dans des faits gelés -------------------------------------------
drop function if exists app.ecriture_prise_en_charge(uuid, uuid);
create function app.ecriture_prise_en_charge(p_cabinet uuid, p_ecriture uuid)
returns table (origine text, prise_le timestamptz, par_nom text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  e        socle.ecritures%rowtype;
  p        socle.prises_en_charge%rowtype;
begin
  select * into p from socle.prises_en_charge x
   where x.tenant_id = p_cabinet and x.ecriture_id = p_ecriture;
  if not found then return; end if;
  select * into e from socle.ecritures x where x.id = p_ecriture;

  if e.reverses_id is not null then
    -- Au journal seulement si l'écriture annulée y était entrée AVANT elle.
    if exists (select 1 from socle.prises_en_charge o
                where o.tenant_id = p_cabinet and o.ecriture_id = e.reverses_id
                  and o.prise_le <= p.prise_le) then
      return query select 'contre_passation'::text, p.prise_le, p.par_nom;
    end if;
    return;
  end if;

  if exists (select 1 from audit.event_log a
              where a.object_table = 'ecritures' and a.object_id = e.id
                and a.action = 'ecriture.forcee')
     -- Les forçages d'avant la marque : la correction naît dans la transaction
     -- qui retourne l'écriture remplacée (20261029210000).
     or exists (select 1 from audit.event_log a
                 where a.tenant_id = e.tenant_id and a.at = e.created_at
                   and a.action = 'ecriture.retournee' and a.object_table = 'ecritures'
                   and a.actor = e.created_by
                   and a.payload ->> 'piece_id' = e.piece_id::text) then
    return query select 'forcee'::text, p.prise_le, p.par_nom;
    return;
  end if;
  return query select 'validee'::text, p.prise_le, p.par_nom;
end $$;
-- Seules les lectures gardées (definer) l'appellent : personne d'autre.
revoke all on function app.ecriture_prise_en_charge(uuid, uuid) from public, anon, authenticated;
revoke all on function app.fuseau_du_cabinet(uuid) from public, anon, authenticated;

-- --- 3. Le journal du jour, lu dans les prises gelées ---------------------------------
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
    with du_jour as (
      select e.*, o.origine as v_origine, o.prise_le as v_inscrite_le, o.par_nom as v_par_nom
        from socle.prises_en_charge pc
        join socle.ecritures e on e.id = pc.ecriture_id
        cross join lateral app.ecriture_prise_en_charge(p_cabinet, e.id) o
       where pc.tenant_id = p_cabinet
         and pc.prise_le >= v_debut and pc.prise_le < v_fin
         and pc.client_tenant_id = any(v_mandats)
         and e.status = 'booked'
         and e.vis = 'partage'::app.vis_t
    )
    select d.tenant_id,
           og.name,
           d.id,
           d.journal,
           coalesce(j.libelle, d.journal),
           j.rang,
           app.version_courante(d.piece_id),
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
           d.v_par_nom,
           d.reverses_id,
           (select r.booked_at from socle.ecritures r
             where r.reverses_id = d.id and r.status = 'booked'
             order by r.booked_at limit 1)
      from du_jour d
      join socle.ecriture_lignes l on l.ecriture_id = d.id
      join identity.organizations og on og.id = d.tenant_id
      left join ref.journals j on j.code = d.journal
     order by j.rang nulls last, d.journal, d.v_inscrite_le, og.name, d.id, l.ordinal;
end $$;
revoke all on function public.journal_du_jour_lire(uuid, uuid, date) from public, anon;
grant execute on function public.journal_du_jour_lire(uuid, uuid, date) to authenticated;

-- L'ancien pré-filtre n'a plus de lecteur : le journal part des prises gelées.
drop index if exists socle.ecritures_tenant_booked_at_idx;

-- --- 4. Les exports gardent leur fichier et leur fuseau ------------------------------
alter table collab.exports add column if not exists fuseau text;
alter table collab.exports add column if not exists nom_de_fichier text;
alter table collab.exports add column if not exists type_mime text;

create or replace view public.exports_v with (security_invoker = true) as
select id, tenant_id, client_tenant_id, format, du, au, lignes, taille_octets, empreinte,
       pack_version_id, created_by, created_at, numero, ecritures, contre_passees,
       fuseau, nom_de_fichier, type_mime
  from collab.exports;
revoke all on public.exports_v from public, anon, service_role;
grant select on public.exports_v to authenticated;

drop function if exists public.journal_export_journaliser(
  uuid, uuid, date, text, integer, integer, bigint, text, uuid, uuid[], uuid[], jsonb);

create or replace function public.journal_export_journaliser(
  p_cabinet uuid, p_client uuid, p_jour date, p_format text, p_numero integer,
  p_lignes integer, p_taille bigint, p_empreinte text, p_pack uuid,
  p_ecritures uuid[], p_contre_passees uuid[], p_ecart jsonb,
  p_fuseau text, p_nom_de_fichier text, p_type_mime text
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id      uuid;
  v_dernier integer;
  v_cal     jsonb;
begin
  if p_cabinet not in (select app.member_orgs()) then
    raise exception 'cabinet introuvable ou non autorise' using errcode = '42501';
  end if;
  perform 1 from app.export_mandats(p_cabinet, p_client);
  if p_format not in ('journal_csv', 'journal_xlsx') then
    raise exception 'ce format n''est pas un export du journal' using errcode = '22023';
  end if;
  -- Un jour à venir, dans le fuseau du cabinet, ne prend pas de numéro.
  v_cal := public.cabinet_fuseau_lire(p_cabinet);
  if (v_cal ->> 'aujourdhui') is null or p_jour > (v_cal ->> 'aujourdhui')::date then
    raise exception 'ce jour est à venir : il n''a pas encore de journal à exporter'
      using errcode = '22023';
  end if;
  if p_fuseau is distinct from (v_cal ->> 'fuseau') then
    raise exception 'le fuseau de l''export n''est pas celui du cabinet' using errcode = '22023';
  end if;

  select max(x.numero) into v_dernier
    from collab.exports x
   where x.tenant_id = p_cabinet
     and x.client_tenant_id is not distinct from p_client
     and x.du = p_jour and x.numero is not null;
  if p_numero <> coalesce(v_dernier, 0) + 1 then
    raise exception 'un autre export de ce journal vient d''etre produit : recommencez'
      using errcode = '40001';
  end if;

  insert into collab.exports
    (tenant_id, client_tenant_id, format, du, au, lignes, taille_octets, empreinte,
     pack_version_id, numero, ecritures, contre_passees, fuseau, nom_de_fichier, type_mime)
  values (p_cabinet, p_client, p_format, p_jour, p_jour, p_lignes, p_taille, p_empreinte,
          p_pack, p_numero, p_ecritures, p_contre_passees, p_fuseau, p_nom_de_fichier, p_type_mime)
  returning id into v_id;

  insert into audit.event_log
    (tenant_id, actor, action, object_schema, object_table, object_id, pack_version_id, payload)
  values (p_cabinet, auth.uid(), 'export.genere', 'collab', 'exports', v_id, p_pack,
          jsonb_build_object('format', p_format, 'client', p_client, 'jour', p_jour,
                             'numero', p_numero, 'lignes', p_lignes, 'taille', p_taille,
                             'empreinte', p_empreinte, 'fuseau', p_fuseau, 'ecart', p_ecart));
  return v_id;
end $$;
revoke all on function public.journal_export_journaliser(uuid, uuid, date, text, integer, integer, bigint, text, uuid, uuid[], uuid[], jsonb, text, text, text) from public, anon;
grant execute on function public.journal_export_journaliser(uuid, uuid, date, text, integer, integer, bigint, text, uuid, uuid[], uuid[], jsonb, text, text, text) to authenticated;

commit;
