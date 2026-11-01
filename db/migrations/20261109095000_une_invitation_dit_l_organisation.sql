-- Une invitation dit l'organisation, pas « le cabinet » (1er novembre 2026).
--
-- La recette sur le staging : inviter une seconde fois le siège d'une PME
-- répondait « Cette personne fait déjà partie du cabinet. » — une phrase
-- écrite pour le cabinet, servie à toute organisation par `cabinet_inviter`
-- (PME comprises, `facturation.place_offrir`), et en français seulement.
--
-- Les trois refus de cette porte deviennent des clés du référentiel des
-- messages (`refus.invitation.*`, fr/en/ar) ; le reste du corps est repris
-- tel quel de 20261022110000. `create or replace` garde le propriétaire et
-- les droits que le lot 6 a posés (#149) ; `security definer` est restaté,
-- car un `create or replace` sans lui le retirerait.

create or replace function public.cabinet_inviter(p_tenant uuid, p_email text, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(trim(p_email));
  v_id uuid;
  v_expire timestamptz;
begin
  if p_role in ('dirigeant', 'collaborateur', 'assistant')
     and facturation.licence_de(p_tenant) is not null
     and not exists (select 1 from facturation.licences l
                      where l.id = facturation.licence_de(p_tenant)
                        and l.titulaire = auth.uid()) then
    raise exception 'refus.invitation.titulaire' using errcode = '42501';
  end if;

  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'refus.invitation.adresse' using errcode = '22023';
  end if;
  -- L'adresse d'un membre ne se lit que par app.email_du_membre : auth.users
  -- reste fermée à l'appelant, comme partout.
  if exists (select 1 from identity.memberships m
             where m.tenant_id = p_tenant
               and lower(coalesce(app.email_du_membre(m.user_id), '')) = v_email) then
    raise exception 'refus.invitation.deja_membre' using errcode = '22023';
  end if;

  -- Une invitation en attente pour la même adresse est rendue telle quelle.
  select id, expires_at into v_id, v_expire
    from identity.invitations
   where tenant_id = p_tenant and lower(email) = v_email
     and accepted_at is null and expires_at > now()
   order by created_at desc limit 1;
  if v_id is not null then
    return jsonb_build_object('id', v_id, 'email', v_email, 'role', p_role,
                              'expiresAt', v_expire, 'deja', true);
  end if;

  insert into identity.invitations (tenant_id, email, role, token_hash, invited_by, expires_at)
  values (p_tenant, v_email, p_role,
          encode(sha256(convert_to(gen_random_uuid()::text || clock_timestamp()::text, 'UTF8')), 'hex'),
          auth.uid(), now() + interval '30 days')
  returning id, expires_at into v_id, v_expire;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_tenant, auth.uid(), 'membre.invite', 'identity', 'invitations', v_id,
          jsonb_build_object('email', v_email, 'role', p_role));

  return jsonb_build_object('id', v_id, 'email', v_email, 'role', p_role,
                            'expiresAt', v_expire, 'deja', false);
end $$;
