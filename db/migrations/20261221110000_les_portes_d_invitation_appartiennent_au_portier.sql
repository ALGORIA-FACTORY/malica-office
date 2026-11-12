-- ======================================================================
--  Les portes de l'invitation de la comptabilité appartiennent au portier
--  (revue de #369, trois constats ; R6).
--
--  1. Les portes 7.1 et 7.2 qui écrivent ou lisent les mandats de la société
--     appartenaient au propriétaire d'administration, qui a `bypassrls` : elles
--     contournaient les politiques de l'appelant. Elles passent au portier. Ce
--     qu'elles écrivent sous son identité est ouvert par des politiques
--     étroites, et ces politiques ne lisent que par des fonctions `security
--     definer` qui ne rendent que ce qu'il faut (R6, « une valeur qui en est
--     nécessaire sort par une fonction qui ne rend qu'elle »).
--
--  2. Le garde « choisir la comptabilité » ne s'applique qu'à l'ACCEPTATION :
--     décliner une invitation de sa comptabilité doit réussir et n'ajoute aucune
--     appartenance.
--
--  REJEU (R11) : aucune donnée de référence écrite.
-- ======================================================================

-- Lectures bornées ----------------------------------------------------------

-- L'invitation d'une comptabilité encore ouverte, pour l'adresse de la personne
-- connectée et une société donnée : la politique d'écriture la lit.
create function app.invitation_expert_ouverte(p_pme uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from identity.invitations i
     where i.tenant_id = p_pme and i.role = 'expert'
       and lower(i.email) = lower(coalesce(app.mon_email(), ''))
       and i.accepted_at is null and i.revoked_at is null and i.expires_at > now())
$$;
revoke all on function app.invitation_expert_ouverte(uuid) from public;
grant execute on function app.invitation_expert_ouverte(uuid) to authenticated;

-- L'invitation de comptabilité que la personne connectée peut lire, par son
-- jeton ou par son identifiant, et seulement la sienne. Rend aussi le nom de la
-- société, que la politique de l'organisation ne montre pas à l'expert.
create function app.invitation_expert_lire(p_jeton text, p_invitation uuid)
returns table(id uuid, tenant_id uuid, email text, accepted_at timestamptz,
              revoked_at timestamptz, expires_at timestamptz, pme_name text, pme_kind text)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.tenant_id, i.email, i.accepted_at, i.revoked_at, i.expires_at,
         o.name, o.kind
    from identity.invitations i
    join identity.organizations o on o.id = i.tenant_id
   where i.role = 'expert'
     and lower(i.email) = lower(coalesce(app.mon_email(), ''))
     and ((p_jeton is not null
           and i.token_hash = encode(sha256(convert_to(p_jeton, 'UTF8')), 'hex'))
          or (p_jeton is null and i.id = p_invitation))
$$;
revoke all on function app.invitation_expert_lire(text, uuid) from public;
grant execute on function app.invitation_expert_lire(text, uuid) to authenticated;

-- Un autre mandat en vigueur que celui de cette comptabilité. La lecture de
-- `engagements` est fermée à l'expert invité : elle se fait ici.
create function app.autre_mandat_en_vigueur(p_pme uuid, p_cabinet uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from identity.engagements g
                  where g.pme_org_id = p_pme and g.cabinet_org_id <> p_cabinet
                    and app.engagement_en_vigueur(g.status, g.starts_on, g.ends_on))
$$;
revoke all on function app.autre_mandat_en_vigueur(uuid, uuid) from public;
grant execute on function app.autre_mandat_en_vigueur(uuid, uuid) to authenticated;

-- Politiques étroites : l'expert invité n'écrit que le mandat, l'événement, la
-- notification et l'acceptation de SON invitation, tant qu'elle est ouverte. --

create policy invitations_sel_expert_invite on identity.invitations
  for select to authenticated
  using (role = 'expert' and lower(email) = lower(coalesce(app.mon_email(), '')));

create policy invitations_upd_expert_invite on identity.invitations
  for update to authenticated
  using (role = 'expert' and app.invitation_expert_ouverte(tenant_id))
  with check (role = 'expert' and lower(email) = lower(coalesce(app.mon_email(), '')));

create policy engagements_ins_expert_invite on identity.engagements
  for insert to authenticated
  with check (status = 'actif'
              and app.has_org_role(cabinet_org_id, array['expert'])
              and app.invitation_expert_ouverte(pme_org_id));

create policy engagements_upd_expert_invite on identity.engagements
  for update to authenticated
  using (app.has_org_role(cabinet_org_id, array['expert'])
         and app.invitation_expert_ouverte(pme_org_id))
  with check (status = 'actif'
              and app.has_org_role(cabinet_org_id, array['expert'])
              and app.invitation_expert_ouverte(pme_org_id));

create policy audit_event_log_ins_expert_invite on audit.event_log
  for insert to authenticated
  with check (actor = auth.uid()
              and object_schema = 'identity' and object_table = 'engagements'
              and app.invitation_expert_ouverte(tenant_id));

create policy collab_notifications_ins_expert_invite on collab.notifications
  for insert to authenticated
  with check (user_id is null and kind = 'mandat.accepte'
              and app.invitation_expert_ouverte(tenant_id));

-- Privilèges de colonnes du portier : ce que ses portes écrivent. ------------

grant update (accepted_at, accepted_by, revoked_at, revoked_by)
  on identity.invitations to portier;

-- L'acceptation par l'expert ------------------------------------------------

create or replace function public.comptabilite_invitation_accepter(
  p_jeton text, p_invitation uuid, p_cabinet uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v record;
  v_engagement uuid;
  v_cabinet text;
begin
  if auth.uid() is null then
    raise exception 'refus.authentification_requise' using errcode = '42501';
  end if;
  select * into v from app.invitation_expert_lire(p_jeton, p_invitation);
  if v.id is null or v.pme_kind <> 'pme' then
    raise exception 'refus.introuvable.invitation' using errcode = '42501';
  end if;
  if app.statut_invitation(v.accepted_at, v.revoked_at, v.expires_at) <> 'en_attente' then
    raise exception 'refus.invitation.expiree' using errcode = '22023';
  end if;
  if not exists (select 1 from identity.organizations c
                  where c.id = p_cabinet and c.kind = 'cabinet' and c.archived_at is null)
     or not app.has_org_role(p_cabinet, array['expert']) then
    raise exception 'refus.reserve.expert' using errcode = '42501';
  end if;
  if app.autre_mandat_en_vigueur(v.tenant_id, p_cabinet) then
    raise exception 'refus.mandat.un_seul_actif' using errcode = '22023';
  end if;

  -- Le mandat, puis ce qu'il dit ; l'invitation est encore ouverte à cet
  -- instant, c'est elle qui autorise ces écritures (politiques ci-dessus).
  insert into identity.engagements (pme_org_id, cabinet_org_id, status, starts_on, created_by)
  values (v.tenant_id, p_cabinet, 'actif', current_date, auth.uid())
  on conflict (pme_org_id, cabinet_org_id) do update
    set status = 'actif', starts_on = current_date, ends_on = null
  returning id into v_engagement;

  select name into v_cabinet from identity.organizations where id = p_cabinet;
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (v.tenant_id, auth.uid(), 'engagement.accepte', 'identity', 'engagements', v_engagement,
          jsonb_build_object('cabinet_org_id', p_cabinet, 'par', 'invitation')),
         (p_cabinet, auth.uid(), 'engagement.accepte', 'identity', 'engagements', v_engagement,
          jsonb_build_object('pme_org_id', v.tenant_id, 'par', 'invitation'));
  insert into collab.notifications (tenant_id, kind, payload)
  values (v.tenant_id, 'mandat.accepte',
          jsonb_build_object('engagement_id', v_engagement, 'cabinet', v_cabinet,
                             'client', v.pme_name));

  update identity.invitations
     set accepted_at = now(), accepted_by = auth.uid()
   where id = v.id;

  return jsonb_build_object('engagementId', v_engagement, 'pmeTenantId', v.tenant_id,
                            'cabinetTenantId', p_cabinet);
end
$$;

-- Le refus d'une invitation de comptabilité hors de sa porte ----------------
-- Décliner (`p_accepte = false`) reste permis : il expire l'invitation, sans
-- aucune appartenance. Le garde ne vaut que pour l'acceptation.

CREATE OR REPLACE FUNCTION public.invitation_repondre(p_id uuid, p_accepte boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v record;
begin
  select id, tenant_id, email, role, expires_at, accepted_at, revoked_at into v
    from identity.invitations where id = p_id;
  if v.id is null
     or lower(v.email) <> lower(coalesce(app.mon_email(), '')) then
    raise exception 'refus.introuvable.invitation' using errcode = '42501';
  end if;
  if v.accepted_at is not null or v.revoked_at is not null or v.expires_at <= now() then
    raise exception 'refus.invitation.expiree' using errcode = '22023';
  end if;
  if p_accepte then
    -- Une invitation de la société à SA comptabilité ne fait entrer personne
    -- dans la société : elle s'accepte par sa porte (7.1). Décliner reste permis.
    if v.role = 'expert' and exists (select 1 from identity.organizations o
                                      where o.id = v.tenant_id and o.kind = 'pme') then
      raise exception 'refus.invitation.choisir_la_comptabilite' using errcode = '22023';
    end if;
    insert into identity.memberships (tenant_id, user_id, role)
    values (v.tenant_id, auth.uid(), v.role)
    on conflict (tenant_id, user_id) do nothing;
    if v.role = 'dirigeant' then
      perform facturation.dirigeant_arrive(v.tenant_id);
    end if;
    update identity.invitations
       set accepted_at = now(), accepted_by = auth.uid()
     where id = p_id;
    insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
    values (v.tenant_id, auth.uid(), 'membre.rejoint', 'identity', 'memberships', p_id,
            jsonb_build_object('role', v.role));
    return jsonb_build_object('id', p_id, 'tenantId', v.tenant_id, 'role', v.role, 'rejoint', true);
  end if;
  update identity.invitations set expires_at = now() where id = p_id;
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (v.tenant_id, auth.uid(), 'membre.decline', 'identity', 'invitations', p_id,
          jsonb_build_object('role', v.role));
  return jsonb_build_object('id', p_id, 'tenantId', v.tenant_id, 'role', v.role, 'rejoint', false);
end
$function$;


-- Les portes de l'invitation : elles appartiennent au portier --------------

alter function public.comptabilite_invitation_accepter(text, uuid, uuid) owner to portier;
alter function public.comptabilite_inviter(uuid, text) owner to portier;
alter function public.comptabilite_invitation_lire(uuid) owner to portier;
alter function public.comptable_interne_inviter(uuid, text) owner to portier;
alter function public.place_comptable_lire(uuid) owner to portier;
