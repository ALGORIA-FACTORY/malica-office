-- =====================================================================================
--  Malica Office — Accepter un mandat, rejoindre un cabinet.
--
--  POURQUOI : un cabinet PROPOSE un mandat (mandat_proposer) et INVITE un
--  collaborateur (cabinet_inviter) — mais personne ne pouvait dire oui. Ce
--  fichier ferme les deux boucles, du côté de celui qui reçoit :
--
--    · la PME voit les mandats qu'on lui propose et répond ; un oui rend le
--      mandat actif à compter d'aujourd'hui, un non le termine ;
--    · une personne connectée voit les invitations adressées à SON adresse
--      et rejoint le cabinet avec le rôle qu'on lui a réservé, ou décline.
--
--  L'invitation se reconnaît par l'adresse du compte, pas par un lien : le
--  produit n'envoie pas de courriel, il ne fait pas semblant d'en envoyer.
--
--  Idempotent.
-- =====================================================================================

-- --- 1. Les mandats proposés à une PME ---------------------------------------------------
create or replace function public.mandats_proposes_lire(p_pme uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_pme not in (select app.member_orgs()) then
      (select null::jsonb where false)
    else coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id,
               'cabinetTenantId', e.cabinet_org_id,
               'cabinet', c.name,
               'proposeLe', e.created_at)
             order by e.created_at desc)
        from identity.engagements e
        join identity.organizations c on c.id = e.cabinet_org_id
       where e.pme_org_id = p_pme and e.status = 'propose'), '[]'::jsonb)
  end;
$$;

revoke all on function public.mandats_proposes_lire(uuid) from public, anon;
grant execute on function public.mandats_proposes_lire(uuid) to authenticated;

-- --- 2. Répondre à un mandat -------------------------------------------------------------
create or replace function public.mandat_repondre(p_engagement uuid, p_accepte boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v record;
  v_status text;
  v_cabinet text;
  v_pme text;
begin
  select id, pme_org_id, cabinet_org_id, status into v
    from identity.engagements where id = p_engagement;
  if v.id is null or v.pme_org_id not in (select app.member_orgs()) then
    raise exception 'mandat introuvable ou non autorise' using errcode = '42501';
  end if;
  if v.status <> 'propose' then
    raise exception 'Ce mandat a déjà reçu une réponse.' using errcode = '22023';
  end if;

  v_status := case when p_accepte then 'actif' else 'termine' end;
  update identity.engagements
     set status = v_status,
         starts_on = case when p_accepte then current_date else starts_on end,
         ends_on = case when p_accepte then null else current_date end
   where id = p_engagement;

  select name into v_cabinet from identity.organizations where id = v.cabinet_org_id;
  select name into v_pme from identity.organizations where id = v.pme_org_id;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (v.pme_org_id, auth.uid(),
          case when p_accepte then 'engagement.accepte' else 'engagement.refuse' end,
          'identity', 'engagements', p_engagement,
          jsonb_build_object('cabinet_org_id', v.cabinet_org_id));
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (v.cabinet_org_id, auth.uid(),
          case when p_accepte then 'engagement.accepte' else 'engagement.refuse' end,
          'identity', 'engagements', p_engagement,
          jsonb_build_object('pme_org_id', v.pme_org_id));
  -- Le cabinet lit les notifications de ses mandats : celle-ci lui dit la réponse.
  insert into collab.notifications (tenant_id, kind, payload)
  values (v.pme_org_id,
          case when p_accepte then 'mandat.accepte' else 'mandat.refuse' end,
          jsonb_build_object('engagement_id', p_engagement, 'cabinet', v_cabinet, 'client', v_pme));

  return jsonb_build_object('id', p_engagement, 'status', v_status);
end $$;

revoke all on function public.mandat_repondre(uuid, boolean) from public, anon;
grant execute on function public.mandat_repondre(uuid, boolean) to authenticated;

-- --- 3. Mon adresse ------------------------------------------------------------------------
-- `app.email_du_membre` ne rend l'adresse que d'une personne qui partage déjà
-- une organisation avec l'appelant : une personne invitée n'en partage
-- encore aucune. Sa propre adresse, elle, lui appartient.
create or replace function app.mon_email()
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select u.email::text from auth.users u where u.id = auth.uid()
$$;

revoke all on function app.mon_email() from public, anon, service_role;
grant execute on function app.mon_email() to authenticated;

-- --- 4. Les invitations adressées à mon adresse ------------------------------------------
create or replace function public.invitations_pour_moi()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', i.id,
             'cabinetTenantId', i.tenant_id,
             'cabinet', o.name,
             'role', i.role,
             'expiresAt', i.expires_at)
           order by i.created_at desc)
      from identity.invitations i
      join identity.organizations o on o.id = i.tenant_id
     where lower(i.email) = lower(coalesce(app.mon_email(), ''))
       and i.accepted_at is null
       and i.expires_at > now()
       and not exists (select 1 from identity.memberships m
                        where m.tenant_id = i.tenant_id and m.user_id = auth.uid())),
    '[]'::jsonb);
$$;

revoke all on function public.invitations_pour_moi() from public, anon;
grant execute on function public.invitations_pour_moi() to authenticated;

-- --- 4. Rejoindre, ou décliner -----------------------------------------------------------
create or replace function public.invitation_repondre(p_id uuid, p_accepte boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v record;
begin
  select id, tenant_id, email, role, expires_at, accepted_at into v
    from identity.invitations where id = p_id;
  if v.id is null
     or lower(v.email) <> lower(coalesce(app.mon_email(), '')) then
    raise exception 'invitation introuvable ou non autorisee' using errcode = '42501';
  end if;
  if v.accepted_at is not null or v.expires_at <= now() then
    raise exception 'Cette invitation n''est plus valable.' using errcode = '22023';
  end if;

  if p_accepte then
    insert into identity.memberships (tenant_id, user_id, role)
    values (v.tenant_id, auth.uid(), v.role)
    on conflict (tenant_id, user_id) do nothing;
    update identity.invitations
       set accepted_at = now(), accepted_by = auth.uid()
     where id = p_id;
    insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
    values (v.tenant_id, auth.uid(), 'membre.rejoint', 'identity', 'memberships', p_id,
            jsonb_build_object('role', v.role));
    return jsonb_build_object('id', p_id, 'tenantId', v.tenant_id, 'role', v.role, 'rejoint', true);
  end if;

  -- Décliner : l'invitation cesse d'être valable, et le journal le garde.
  update identity.invitations set expires_at = now() where id = p_id;
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (v.tenant_id, auth.uid(), 'membre.decline', 'identity', 'invitations', p_id,
          jsonb_build_object('role', v.role));
  return jsonb_build_object('id', p_id, 'tenantId', v.tenant_id, 'role', v.role, 'rejoint', false);
end $$;

revoke all on function public.invitation_repondre(uuid, boolean) from public, anon;
grant execute on function public.invitation_repondre(uuid, boolean) to authenticated;

-- --- 6. La PME lit son cabinet ---------------------------------------------------------------
-- `app.engaged_orgs()` rend les PME d'un cabinet, jamais le cabinet d'une
-- PME : une fois le mandat accepté, le dirigeant ne pouvait pas lire le nom
-- de qui tient ses comptes. Le miroir manquait ; le voici.
create or replace function app.cabinets_de_mes_orgs()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.cabinet_org_id
    from identity.engagements e
   where e.pme_org_id in (select app.member_orgs())
     and e.status in ('actif', 'propose')
$$;

revoke all on function app.cabinets_de_mes_orgs() from public, anon;
grant execute on function app.cabinets_de_mes_orgs() to authenticated;

drop policy if exists organizations_sel on identity.organizations;
create policy organizations_sel on identity.organizations
  for select to authenticated
  using (
    id in (select app.member_orgs())
    or id in (select app.engaged_orgs())
    or id in (select app.cabinets_de_mes_orgs())
    or (select app.is_platform())
  );
