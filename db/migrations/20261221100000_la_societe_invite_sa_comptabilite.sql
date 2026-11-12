-- ======================================================================
--  La société invite sa comptabilité par e-mail (décision du dirigeant du
--  12 novembre 2026, point 7.1, règle A5).
--
--  Le propriétaire invite une adresse. L'invitation est une ligne de
--  `identity.invitations` au rôle `expert`, posée sur la SOCIÉTÉ : elle ne
--  fait entrer personne dans la société — les portes d'adhésion la refusent
--  (`refus.invitation.choisir_la_comptabilite`). Elle s'accepte par
--  `comptabilite_invitation_accepter`, sous l'identité de l'expert, avec la
--  comptabilité qu'il choisit (ou qu'il vient de créer) : le mandat devient
--  ACTIF à cette acceptation. La société garde sa licence et continue de
--  payer : rien de la facturation ne change ici.
--
--  Une adresse déjà inscrite comme expert la reçoit aussi dans « Invitations
--  pour moi » (`invitations_pour_moi`, qui dit désormais le type de
--  l'organisation) : la même demande, sans lien.
--
--  Relancer réémet le lien (l'ancien est révoqué) : le jeton n'est jamais
--  gardé en clair, il n'est rendu qu'à l'émission.
--
--  Lecture sans session : NON. `invitation_par_lien_lire` exige toujours une
--  session (décision de sécurité ouverte 4.5) ; l'adresse n'est donc pas
--  préremplie à la création de l'accès.
--
--  REJEU (R11) : aucune donnée de référence écrite.
-- ======================================================================

create function public.comptabilite_inviter(p_pme uuid, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_jeton text;
  v_id uuid;
  v_expire timestamptz;
  v_relance boolean;
begin
  if not app.has_org_role(p_pme, array['dirigeant']) then
    raise exception 'refus.reserve.proprietaire' using errcode = '42501';
  end if;
  if not exists (select 1 from identity.organizations o
                  where o.id = p_pme and o.kind = 'pme' and o.archived_at is null) then
    raise exception 'refus.introuvable.organisation' using errcode = '42501';
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'refus.invitation.adresse' using errcode = '22023';
  end if;
  if app.mandat_externe_en_vigueur(p_pme) then
    raise exception 'refus.mandat.un_seul_actif' using errcode = '22023';
  end if;

  -- Un seul lien vivant : relancer révoque le précédent et en émet un neuf.
  with revoquees as (
    update identity.invitations
       set revoked_at = now(), revoked_by = v_uid
     where tenant_id = p_pme and role = 'expert'
       and accepted_at is null and revoked_at is null and expires_at > now()
    returning 1)
  select exists (select 1 from revoquees) into v_relance;

  v_jeton := encode(extensions.gen_random_bytes(32), 'hex');
  insert into identity.invitations (tenant_id, email, role, token_hash, invited_by, expires_at)
  values (p_pme, v_email, 'expert', encode(sha256(convert_to(v_jeton, 'UTF8')), 'hex'),
          v_uid, now() + interval '30 days')
  returning id, expires_at into v_id, v_expire;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (p_pme, v_uid, 'comptabilite.invitee', 'identity', 'invitations', v_id,
          jsonb_build_object('email', v_email, 'relance', v_relance));

  return jsonb_build_object('id', v_id, 'email', v_email, 'jeton', v_jeton,
                            'expiresAt', v_expire, 'relance', v_relance);
end
$$;
revoke all on function public.comptabilite_inviter(uuid, text) from public;
grant execute on function public.comptabilite_inviter(uuid, text) to authenticated;

-- Le suivi côté société : la dernière invitation de sa comptabilité et son
-- état. Jamais le jeton.
create function public.comptabilite_invitation_lire(p_pme uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select (
    select jsonb_build_object(
             'id', i.id,
             'email', i.email,
             'envoyeeLe', i.created_at,
             'expiresAt', i.expires_at,
             'statut', app.statut_invitation(i.accepted_at, i.revoked_at, i.expires_at))
      from identity.invitations i
     where i.tenant_id = p_pme and i.role = 'expert'
       and i.revoked_at is null
     order by i.created_at desc
     limit 1)
   where app.has_org_role(p_pme, array['dirigeant'])
$$;
revoke all on function public.comptabilite_invitation_lire(uuid) from public;
grant execute on function public.comptabilite_invitation_lire(uuid) to authenticated;

-- L'expert accepte, avec SA comptabilité : le mandat devient actif. Par le
-- lien (`p_jeton`) ou depuis ses invitations (`p_invitation`).
create function public.comptabilite_invitation_accepter(p_jeton text, p_invitation uuid,
                                                         p_cabinet uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v record;
  v_engagement uuid;
  v_cabinet text;
  v_pme text;
begin
  if auth.uid() is null then
    raise exception 'refus.authentification_requise' using errcode = '42501';
  end if;
  select i.id, i.tenant_id, i.email, i.accepted_at, i.revoked_at, i.expires_at into v
    from identity.invitations i
    join identity.organizations o on o.id = i.tenant_id and o.kind = 'pme'
   where i.role = 'expert'
     and ((p_jeton is not null
           and i.token_hash = encode(sha256(convert_to(p_jeton, 'UTF8')), 'hex'))
          or (p_jeton is null and i.id = p_invitation));
  if v.id is null or lower(v.email) <> lower(coalesce(app.mon_email(), '')) then
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
  if exists (select 1 from identity.engagements g
              where g.pme_org_id = v.tenant_id and g.cabinet_org_id <> p_cabinet
                and app.engagement_en_vigueur(g.status, g.starts_on, g.ends_on)) then
    raise exception 'refus.mandat.un_seul_actif' using errcode = '22023';
  end if;

  insert into identity.engagements (pme_org_id, cabinet_org_id, status, starts_on, created_by)
  values (v.tenant_id, p_cabinet, 'actif', current_date, auth.uid())
  on conflict (pme_org_id, cabinet_org_id) do update
    set status = 'actif', starts_on = current_date, ends_on = null
  returning id into v_engagement;

  update identity.invitations
     set accepted_at = now(), accepted_by = auth.uid()
   where id = v.id;

  select name into v_cabinet from identity.organizations where id = p_cabinet;
  select name into v_pme from identity.organizations where id = v.tenant_id;
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (v.tenant_id, auth.uid(), 'engagement.accepte', 'identity', 'engagements', v_engagement,
          jsonb_build_object('cabinet_org_id', p_cabinet, 'par', 'invitation')),
         (p_cabinet, auth.uid(), 'engagement.accepte', 'identity', 'engagements', v_engagement,
          jsonb_build_object('pme_org_id', v.tenant_id, 'par', 'invitation'));
  insert into collab.notifications (tenant_id, kind, payload)
  values (v.tenant_id, 'mandat.accepte',
          jsonb_build_object('engagement_id', v_engagement, 'cabinet', v_cabinet, 'client', v_pme));

  return jsonb_build_object('engagementId', v_engagement, 'pmeTenantId', v.tenant_id,
                            'cabinetTenantId', p_cabinet);
end
$$;
revoke all on function public.comptabilite_invitation_accepter(text, uuid, uuid) from public;
grant execute on function public.comptabilite_invitation_accepter(text, uuid, uuid) to authenticated;

-- Les portes d'adhésion ne font pas entrer la comptabilité invitée dans la
-- société ; les lectures disent de quelle invitation il s'agit.

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
  -- Une invitation de la société à SA comptabilité ne fait entrer personne
  -- dans la société : elle s'accepte par sa porte, qui choisit la comptabilité
  -- (`comptabilite_invitation_accepter`).
  if v.role = 'expert' and exists (select 1 from identity.organizations o
                                    where o.id = v.tenant_id and o.kind = 'pme') then
    raise exception 'refus.invitation.choisir_la_comptabilite' using errcode = '22023';
  end if;
  if p_accepte then
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

CREATE OR REPLACE FUNCTION public.invitation_par_lien_accepter(p_jeton text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v record;
begin
  if auth.uid() is null then
    raise exception 'refus.authentification_requise' using errcode = '42501';
  end if;
  select id, tenant_id, email, role, expires_at, accepted_at, revoked_at into v
    from identity.invitations
   where token_hash = encode(sha256(convert_to(coalesce(p_jeton, ''), 'UTF8')), 'hex');
  if v.id is null or lower(v.email) <> lower(coalesce(app.mon_email(), '')) then
    raise exception 'refus.introuvable.invitation' using errcode = '42501';
  end if;
  if app.statut_invitation(v.accepted_at, v.revoked_at, v.expires_at) <> 'en_attente' then
    raise exception 'refus.invitation.expiree' using errcode = '22023';
  end if;
  -- Une invitation de la société à SA comptabilité ne fait entrer personne
  -- dans la société : elle s'accepte par sa porte, qui choisit la comptabilité
  -- (`comptabilite_invitation_accepter`).
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
   where id = v.id;
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v.tenant_id, auth.uid(), 'membre.rejoint', 'identity', 'memberships', v.id,
          jsonb_build_object('role', v.role, 'par', 'lien'));
  return jsonb_build_object('tenantId', v.tenant_id, 'role', v.role);
end
$function$;

CREATE OR REPLACE FUNCTION public.invitations_pour_moi()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', i.id,
             'cabinetTenantId', i.tenant_id,
             'cabinet', o.name,
             'role', i.role,
             'kind', o.kind,
             'expiresAt', i.expires_at)
           order by i.created_at desc)
      from identity.invitations i
      join identity.organizations o on o.id = i.tenant_id
     where lower(i.email) = lower(coalesce(app.mon_email(), ''))
       and i.accepted_at is null
       and i.revoked_at is null
       and i.expires_at > now()
       and not exists (select 1 from identity.memberships m
                        where m.tenant_id = i.tenant_id and m.user_id = auth.uid())),
    '[]'::jsonb);
$function$;

CREATE OR REPLACE FUNCTION public.invitation_par_lien_lire(p_jeton text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
           'pme', o.name,
           'cabinet', (select c.name
                         from identity.engagements e
                         join identity.organizations c on c.id = e.cabinet_org_id
                        where e.pme_org_id = i.tenant_id and e.status = 'actif'
                        order by e.created_at limit 1),
           'email', i.email,
           -- La société invite sa comptabilité : l'écran choisit la comptabilité.
           'pourLaComptabilite', i.role = 'expert' and o.kind = 'pme',
           'statut', app.statut_invitation(i.accepted_at, i.revoked_at, i.expires_at),
           'valable', app.statut_invitation(i.accepted_at, i.revoked_at, i.expires_at) = 'en_attente')
    from identity.invitations i
    join identity.organizations o on o.id = i.tenant_id
   where auth.uid() is not null
     and i.token_hash = encode(sha256(convert_to(coalesce(p_jeton, ''), 'UTF8')), 'hex')
$function$;
