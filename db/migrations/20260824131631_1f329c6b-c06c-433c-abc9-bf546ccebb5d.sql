-- ============================================================================
-- 005 — Couche d'accès Data API : vues security_invoker + amorçage
-- Aucune table, colonne ou policy nouvelle sur les données métier.
-- Les vues sont security_invoker : les policies des tables de base s'appliquent
-- telles quelles. Aucun accès anon / service_role.
-- ============================================================================

-- ---------------------------------------------------------------- vues
create or replace view public.organizations_v
with (security_invoker = true) as
select id, kind, name, legal_id, jurisdiction, currency, validation_mode,
       created_by, created_at, updated_at
from identity.organizations;

create or replace view public.entities_v
with (security_invoker = true) as
select * from identity.entities;

create or replace view public.memberships_v
with (security_invoker = true) as
select id, tenant_id, user_id, role, created_at
from identity.memberships;

create or replace view public.engagements_v
with (security_invoker = true) as
select id, pme_org_id, cabinet_org_id, status, starts_on, ends_on,
       created_by, created_at, updated_at
from identity.engagements;

create or replace view public.pieces_v
with (security_invoker = true) as
select id, tenant_id, entity_id, vis, source, storage_path, sha256,
       page_count, status, idempotency_key, created_by, created_at, updated_at
from capture.pieces;

do $$
declare v text;
begin
  foreach v in array array['organizations_v','entities_v','memberships_v','engagements_v','pieces_v']
  loop
    execute format('revoke all on public.%I from public, anon, service_role', v);
    execute format('grant select, insert, update, delete on public.%I to authenticated', v);
  end loop;
end $$;

-- ------------------------------------------------- amorçage : organisation
create or replace function public.create_organization(
  p_kind text,
  p_name text,
  p_validation_mode app.validation_mode_t default 'mandate',
  p_legal_id text default null,
  p_jurisdiction text default 'TN',
  p_currency text default 'TND'
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
  v_role text;
begin
  if v_uid is null then
    raise exception 'authentification requise' using errcode = '42501';
  end if;
  if p_kind not in ('pme','cabinet') then
    raise exception 'kind invalide' using errcode = '22023';
  end if;

  insert into identity.organizations (kind, name, legal_id, jurisdiction, currency,
                                     validation_mode, created_by)
  values (p_kind, p_name, p_legal_id, p_jurisdiction, p_currency,
          p_validation_mode, v_uid)
  returning id into v_org;

  v_role := case when p_kind = 'cabinet' then 'expert' else 'dirigeant' end;

  insert into identity.memberships (tenant_id, user_id, role)
  values (v_org, v_uid, v_role);

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                              object_id, payload)
  values (v_org, v_uid, 'organization.created', 'identity', 'organizations', v_org,
          jsonb_build_object('kind', p_kind, 'role', v_role));

  return v_org;
end $$;

revoke execute on function public.create_organization(text, text, app.validation_mode_t, text, text, text) from public, anon, service_role;
grant execute on function public.create_organization(text, text, app.validation_mode_t, text, text, text) to authenticated;

-- ---------------------------------------------------- mandat : statut
create or replace function public.set_engagement_status(
  p_engagement uuid,
  p_status text
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_pme uuid;
begin
  if p_status not in ('propose','actif','suspendu','termine') then
    raise exception 'statut invalide' using errcode = '22023';
  end if;

  update identity.engagements
     set status = p_status,
         ends_on = case when p_status = 'termine' then current_date else ends_on end
   where id = p_engagement
  returning pme_org_id into v_pme;

  if v_pme is null then
    raise exception 'mandat introuvable ou non autorisé' using errcode = '42501';
  end if;

  insert into audit.event_log (tenant_id, action, object_schema, object_table,
                              object_id, payload)
  values (v_pme, 'engagement.status_changed', 'identity', 'engagements',
          p_engagement, jsonb_build_object('status', p_status));
end $$;

revoke execute on function public.set_engagement_status(uuid, text) from public, anon, service_role;
grant execute on function public.set_engagement_status(uuid, text) to authenticated;