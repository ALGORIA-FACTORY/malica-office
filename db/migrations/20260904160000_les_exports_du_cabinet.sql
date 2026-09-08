-- =====================================================================================
--  Malica Office — Les exports du cabinet : FEC et CSV.
--
--  POURQUOI : un cabinet qui ne peut pas partir n'est pas un client, c'est un
--  otage. Les écritures COMPTABILISÉES sortent telles que le Socle les tient,
--  avec le pack sous lequel elles ont été arrêtées. Chaque fichier produit est
--  journalisé — format, période, nombre de lignes, taille, empreinte — et ce
--  journal ne se corrige pas : un export est un fait daté (R7).
--
--  Ce que la base fait ici : lire les lignes (une seule définition de
--  « comptabilisé », la sienne), calculer les exercices depuis la clôture de
--  la fiche, journaliser. Le formatage — colonnes, séparateurs, dates — est
--  une affaire de fichier, il vit dans l'API.
--
--  Idempotent.
-- =====================================================================================

-- --- 1. Le journal des exports -------------------------------------------------------
create table if not exists collab.exports (
  id               uuid primary key default gen_random_uuid(),
  -- Le cabinet qui exporte.
  tenant_id        uuid not null references identity.organizations(id) on delete cascade,
  -- Le mandat exporté ; nul quand l'export couvre tous les mandats.
  client_tenant_id uuid references identity.organizations(id) on delete set null,
  format           text not null check (format in ('fec', 'csv_ecritures', 'csv_plan')),
  du               date not null,
  au               date not null,
  lignes           integer not null check (lignes >= 0),
  taille_octets    bigint not null check (taille_octets >= 0),
  -- SHA-256 du contenu produit, en hexadécimal.
  empreinte        text not null check (empreinte ~ '^[0-9a-f]{64}$'),
  pack_version_id  uuid references ref.jurisdiction_packs(id),
  created_by       uuid not null default auth.uid(),
  created_at       timestamptz not null default now(),
  check (au >= du)
);
create index if not exists exports_tenant_idx on collab.exports (tenant_id, created_at desc);
-- Append-only : un export généré ne se réécrit pas.
select app.enable_tenant_rls('collab', 'exports', false, true);

create or replace view public.exports_v with (security_invoker = true) as
select id, tenant_id, client_tenant_id, format, du, au, lignes, taille_octets, empreinte,
       pack_version_id, created_by, created_at
  from collab.exports;
revoke all on public.exports_v from public, anon, service_role;
grant select on public.exports_v to authenticated;

-- --- 2. Les mandats qu'un cabinet peut exporter ---------------------------------------
-- Même définition que la RLS : les engagements actifs, en cours, du cabinet
-- dont l'appelant est membre. Un client demandé hors de ce périmètre lève.
create or replace function app.export_mandats(p_cabinet uuid, p_client uuid)
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_cabinet not in (select app.member_orgs()) then
    raise exception 'cabinet introuvable ou non autorise' using errcode = '42501';
  end if;
  if p_client is not null and not exists (
    select 1 from identity.engagements e
     where e.cabinet_org_id = p_cabinet and e.pme_org_id = p_client
       and e.status = 'actif' and e.starts_on <= current_date
       and (e.ends_on is null or e.ends_on >= current_date)) then
    raise exception 'dossier introuvable ou non autorise' using errcode = '42501';
  end if;
  return query
    select e.pme_org_id
      from identity.engagements e
     where e.cabinet_org_id = p_cabinet
       and (p_client is null or e.pme_org_id = p_client)
       and e.status = 'actif' and e.starts_on <= current_date
       and (e.ends_on is null or e.ends_on >= current_date);
end $$;
revoke all on function app.export_mandats(uuid, uuid) from public, anon, service_role;
grant execute on function app.export_mandats(uuid, uuid) to authenticated;

-- --- 3. Les exercices exportables ------------------------------------------------------
-- Un exercice N se termine à la clôture de l'année N, telle que la fiche du
-- dossier l'écrit (« 06-30 »). Sans fiche, ou pour tous les mandats à la fois,
-- c'est l'année civile — et le drapeau `clotureConnue` le dit à l'écran.
-- On liste depuis la première écriture comptabilisée jusqu'à l'exercice en
-- cours ; un exercice sans écriture n'apparaît que s'il est en cours.
create or replace function public.export_exercices_lire(p_cabinet uuid, p_client uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cloture  text;
  v_mois     integer;
  v_jour     integer;
  v_premiere date;
  v_courant  integer;
  v_premier  integer;
  v_n        integer;
  v_du       date;
  v_au       date;
  v_nb       integer;
  v_res      jsonb := '[]'::jsonb;
  -- La garde est dans app.export_mandats : elle lève si le cabinet ou le
  -- dossier n'est pas accessible.
  v_mandats  uuid[] := array(select app.export_mandats(p_cabinet, p_client));
begin

  if p_client is not null then
    select f.cloture_exercice into v_cloture
      from identity.fiches_fiscales f
     where f.tenant_id = p_client and f.valid_to is null
     order by f.valid_from desc limit 1;
  end if;
  if v_cloture is null then
    v_mois := 12; v_jour := 31;
  else
    v_mois := split_part(v_cloture, '-', 1)::integer;
    v_jour := split_part(v_cloture, '-', 2)::integer;
  end if;

  select min(e.date_ecriture) into v_premiere
    from socle.ecritures e
   where e.status = 'booked' and e.tenant_id = any(v_mandats);

  -- La clôture de l'année N, bornée à la fin du mois (« 02-30 » n'existe pas).
  v_courant := extract(year from current_date)::integer;
  if least(make_date(v_courant, v_mois, 1) + (v_jour - 1),
           (make_date(v_courant, v_mois, 1) + interval '1 month' - interval '1 day')::date)
     < current_date then
    v_courant := v_courant + 1;
  end if;

  v_premier := v_courant;
  if v_premiere is not null then
    v_premier := extract(year from v_premiere)::integer;
    if least(make_date(v_premier, v_mois, 1) + (v_jour - 1),
             (make_date(v_premier, v_mois, 1) + interval '1 month' - interval '1 day')::date)
       < v_premiere then
      v_premier := v_premier + 1;
    end if;
  end if;

  for v_n in reverse v_courant .. v_premier loop
    v_au := least(make_date(v_n, v_mois, 1) + (v_jour - 1),
                  (make_date(v_n, v_mois, 1) + interval '1 month' - interval '1 day')::date);
    v_du := least(make_date(v_n - 1, v_mois, 1) + (v_jour - 1),
                  (make_date(v_n - 1, v_mois, 1) + interval '1 month' - interval '1 day')::date) + 1;
    select count(*) into v_nb
      from socle.ecritures e
     where e.status = 'booked' and e.tenant_id = any(v_mandats)
       and e.date_ecriture between v_du and v_au;
    if v_nb > 0 or v_n = v_courant then
      v_res := v_res || jsonb_build_object(
        'exercice', v_n,
        'du', v_du,
        'au', v_au,
        'clos', v_au < current_date,
        'clotureConnue', v_cloture is not null,
        'ecritures', v_nb);
    end if;
  end loop;
  return v_res;
end $$;
revoke all on function public.export_exercices_lire(uuid, uuid) from public, anon;
grant execute on function public.export_exercices_lire(uuid, uuid) to authenticated;

-- --- 4. Les lignes comptabilisées, prêtes à sortir ------------------------------------
-- Une ligne par ligne d'écriture, avec ce qu'un fichier légal demande : le
-- libellé du journal, celui du compte (le cabinet d'abord, le pack ensuite),
-- la pièce et sa date, la date de comptabilisation. Le numéro d'écriture est
-- un rang par dossier et par journal, dans l'ordre de comptabilisation : le
-- même contenu donne le même fichier.
create or replace function public.export_lignes_lire(p_cabinet uuid, p_client uuid, p_du date, p_au date)
returns table (
  client_tenant_id uuid,
  client_nom       text,
  client_legal_id  text,
  ecriture_id      uuid,
  numero           bigint,
  journal          text,
  journal_libelle  text,
  date_ecriture    date,
  ordinal          smallint,
  compte           text,
  compte_libelle   text,
  piece_ref        text,
  piece_date       date,
  ecriture_libelle text,
  ligne_libelle    text,
  debit            numeric,
  credit           numeric,
  tax_code         text,
  valide_le        date,
  devise           text,
  pack_version_id  uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_mandats uuid[] := array(select app.export_mandats(p_cabinet, p_client));
begin
  return query
    select e.tenant_id,
           o.name,
           o.legal_id,
           e.id,
           dense_rank() over (partition by e.tenant_id, e.journal
                              order by e.date_ecriture, e.booked_at, e.id),
           e.journal,
           coalesce(j.libelle, e.journal),
           e.date_ecriture,
           l.ordinal,
           l.account_code,
           coalesce(
             (select pa.label from parametrage.accounts pa
               where pa.tenant_id = p_cabinet and pa.account_code = l.account_code),
             (select ra.label from ref.accounts ra
               where ra.pack_version_id = e.pack_version_id and ra.account_code = l.account_code),
             ''),
           e.piece_id::text,
           coalesce(
             (select case when x.payload ->> 'document_date' ~ '^\d{4}-\d{2}-\d{2}$'
                          then (x.payload ->> 'document_date')::date end
                from capture.extractions x
               where x.piece_id = e.piece_id and x.contract = 'extract.v1'
               order by x.created_at desc limit 1),
             p.created_at::date,
             e.date_ecriture),
           e.libelle,
           l.libelle,
           l.debit::numeric,
           l.credit::numeric,
           l.tax_code,
           coalesce(e.booked_at::date, e.date_ecriture),
           e.devise,
           e.pack_version_id
      from socle.ecritures e
      join socle.ecriture_lignes l on l.ecriture_id = e.id
      join identity.organizations o on o.id = e.tenant_id
      left join ref.journals j on j.code = e.journal
      left join capture.pieces p on p.id = e.piece_id
     where e.status = 'booked'
       and e.tenant_id = any(v_mandats)
       and e.date_ecriture between p_du and p_au
     order by o.name, e.tenant_id, e.date_ecriture, e.booked_at, e.id, l.ordinal;
end $$;
revoke all on function public.export_lignes_lire(uuid, uuid, date, date) from public, anon;
grant execute on function public.export_lignes_lire(uuid, uuid, date, date) to authenticated;

-- --- 5. Journaliser un export --------------------------------------------------------
create or replace function public.export_journaliser(
  p_cabinet uuid, p_client uuid, p_format text, p_du date, p_au date,
  p_lignes integer, p_taille bigint, p_empreinte text, p_pack uuid
) returns uuid
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
  insert into collab.exports
    (tenant_id, client_tenant_id, format, du, au, lignes, taille_octets, empreinte, pack_version_id)
  values (p_cabinet, p_client, p_format, p_du, p_au, p_lignes, p_taille, p_empreinte, p_pack)
  returning id into v_id;

  insert into audit.event_log
    (tenant_id, actor, action, object_schema, object_table, object_id, pack_version_id, payload)
  values (p_cabinet, auth.uid(), 'export.genere', 'collab', 'exports', v_id, p_pack,
          jsonb_build_object('format', p_format, 'client', p_client, 'du', p_du, 'au', p_au,
                             'lignes', p_lignes, 'taille', p_taille, 'empreinte', p_empreinte));
  return v_id;
end $$;
revoke all on function public.export_journaliser(uuid, uuid, text, date, date, integer, bigint, text, uuid) from public, anon;
grant execute on function public.export_journaliser(uuid, uuid, text, date, date, integer, bigint, text, uuid) to authenticated;
