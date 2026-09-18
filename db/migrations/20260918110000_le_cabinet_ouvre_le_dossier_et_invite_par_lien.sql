-- L'entrée en relation : le cabinet ouvre le dossier d'une PME qui n'existe pas
-- encore, invite son contact par un lien, et le contact le rejoint.
--
-- Jusqu'ici, un cabinet ne pouvait que PROPOSER un mandat à une PME déjà
-- inscrite (mandat_proposer), et une invitation ne produisait ni courriel ni
-- lien : son jeton était haché puis jeté. Le parcours « Cabinet d'Expertises
-- CADG ouvre le dossier d'ALGORIA FACTORY SARL » n'était pas possible.
--
-- ============================================================ LE JETON
--
-- • IMPRÉVISIBLE : 32 octets de extensions.gen_random_bytes (pgcrypto, le
--   générateur cryptographique du serveur), rendus en 64 caractères
--   hexadécimaux — ni identifiant de ligne, ni horodatage.
-- • RENDU UNE FOIS, au seul cabinet qui l'émet : la base n'en garde que
--   l'empreinte SHA-256 ; ni l'audit ni aucune vue ne le portent.
-- • À USAGE UNIQUE : accepté, il ne sert plus.
-- • VALABLE 7 JOURS : le cabinet transmet le lien le jour même, le contact
--   répond dans la semaine ; au-delà, le cabinet en émet un autre en un geste.
--   Un lien qui vit un mois dans une messagerie est un mois d'exposition pour
--   rien. (Les invitations de cabinet, cabinet_inviter, gardent leurs 30 jours.)
-- • RÉVOCABLE avant usage, et son ÉTAT SE LIT : en_attente, acceptee, expiree,
--   revoquee. Émettre une nouvelle invitation révoque la précédente : un seul
--   lien vivant par dossier.
-- • LIÉ À UNE ADRESSE : le compte qui accepte doit porter l'adresse invitée.
--
-- Ajouts seulement : trois colonnes facultatives, une vue réécrite en
-- AJOUTANT une colonne à la fin, des fonctions. Rien n'est renommé ni retiré.

-- --- 1. L'adresse de l'organisation -------------------------------------------------------
-- Mention obligatoire de facturation, avec le matricule fiscal (legal_id) :
-- telle que le cabinet la saisit, texte libre, facultative en base.
alter table identity.organizations add column if not exists adresse text;

-- --- 2. La révocation d'une invitation ----------------------------------------------------
alter table identity.invitations add column if not exists revoked_at timestamptz;
alter table identity.invitations add column if not exists revoked_by uuid;

-- La vue des invitations d'un tenant expose désormais la révocation (colonne
-- ajoutée à la fin : les lecteurs existants ne voient rien changer).
create or replace view public.invitations_v with (security_invoker = true) as
select id, tenant_id, email, role, invited_by, expires_at, accepted_at, created_at, revoked_at
from identity.invitations;

-- L'état d'une invitation, en un seul endroit.
create or replace function app.statut_invitation(
  p_accepted_at timestamptz, p_revoked_at timestamptz, p_expires_at timestamptz
) returns text
language sql
stable
set search_path = ''
as $$
  select case
           when p_accepted_at is not null then 'acceptee'
           when p_revoked_at is not null then 'revoquee'
           when p_expires_at <= now() then 'expiree'
           else 'en_attente'
         end
$$;

-- --- 3. Le cabinet ouvre le dossier ------------------------------------------------------
-- Le mandat naît ACTIF : c'est le cabinet qui ouvre le dossier pour son client,
-- sur la foi de sa lettre de mission, et le dossier est vide — il n'y a rien à
-- lire, et personne n'en est membre. Le contact, en rejoignant, devient
-- dirigeant : il peut terminer le mandat comme toute PME.
--
-- Un matricule qui a déjà un dossier actif n'en ouvre pas un second : la PME
-- existe, on lui PROPOSE un mandat (mandat_proposer), on ne la duplique pas.
create or replace function public.cabinet_ouvrir_dossier(
  p_cabinet uuid,
  p_nom text,
  p_legal_id text,
  p_adresse text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_nom text := nullif(trim(coalesce(p_nom, '')), '');
  v_mf text := nullif(trim(coalesce(p_legal_id, '')), '');
  v_adresse text := nullif(trim(coalesce(p_adresse, '')), '');
  v_cab record;
  v_pme uuid;
begin
  if v_uid is null then
    raise exception 'authentification requise' using errcode = '42501';
  end if;
  select id, kind, jurisdiction, currency into v_cab
    from identity.organizations
   where id = p_cabinet and archived_at is null;
  if v_cab.id is null or v_cab.kind <> 'cabinet'
     or not app.has_org_role(p_cabinet, array['expert']) then
    raise exception 'Seul un expert du cabinet ouvre un dossier en son nom.' using errcode = '42501';
  end if;
  if v_nom is null then
    raise exception 'La raison sociale est requise.' using errcode = '22023';
  end if;
  if v_mf is null then
    raise exception 'Le matricule fiscal est requis.' using errcode = '22023';
  end if;
  if exists (select 1 from identity.organizations o
              where o.archived_at is null and upper(trim(o.legal_id)) = upper(v_mf)) then
    raise exception 'Ce matricule fiscal a déjà un dossier : proposez-lui un mandat.'
      using errcode = '23505';
  end if;

  insert into identity.organizations (kind, name, legal_id, jurisdiction, currency,
                                      validation_mode, created_by, adresse)
  values ('pme', v_nom, v_mf, v_cab.jurisdiction, v_cab.currency, 'mandate', v_uid, v_adresse)
  returning id into v_pme;

  -- Comme createOrganization côté API : une organisation sans établissement
  -- principal serait inutilisable.
  insert into identity.entities (tenant_id, code, name, is_default)
  values (v_pme, 'PRINCIPAL', v_nom, true);

  insert into identity.engagements (pme_org_id, cabinet_org_id, status, created_by)
  values (v_pme, p_cabinet, 'actif', v_uid);

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_pme, v_uid, 'dossier.ouvert', 'identity', 'organizations', v_pme,
          jsonb_build_object('cabinet', p_cabinet, 'legalId', v_mf));

  return jsonb_build_object('id', v_pme, 'name', v_nom, 'legalId', v_mf, 'adresse', v_adresse);
end $$;

revoke all on function public.cabinet_ouvrir_dossier(uuid, text, text, text) from public, anon;
grant execute on function public.cabinet_ouvrir_dossier(uuid, text, text, text) to authenticated;

-- Le cabinet qui parle pour un dossier : un expert d'un cabinet qui a un mandat
-- ACTIF sur lui.
create or replace function app.expert_mandate_sur(p_pme uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from identity.engagements e
      join identity.memberships m on m.tenant_id = e.cabinet_org_id
     where e.pme_org_id = p_pme and e.status = 'actif'
       and m.user_id = auth.uid() and m.role = 'expert')
$$;

revoke all on function app.expert_mandate_sur(uuid) from public, anon;
grant execute on function app.expert_mandate_sur(uuid) to authenticated;

-- --- 4. Le cabinet invite le contact du dossier -----------------------------------------
-- Seulement tant que le dossier n'a AUCUN membre : un cabinet ne fait pas
-- entrer un dirigeant chez une PME qui en a déjà un.
create or replace function public.dossier_inviter_contact(p_pme uuid, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(trim(coalesce(p_email, '')));
  v_jeton text;
  v_id uuid;
  v_expire timestamptz;
begin
  if v_uid is null then
    raise exception 'authentification requise' using errcode = '42501';
  end if;
  if not app.expert_mandate_sur(p_pme) then
    raise exception 'Seul un expert du cabinet mandaté invite le contact du dossier.'
      using errcode = '42501';
  end if;
  if exists (select 1 from identity.memberships where tenant_id = p_pme) then
    raise exception 'Ce dossier a déjà son dirigeant.' using errcode = '22023';
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Cette adresse ne ressemble pas à une adresse e-mail.' using errcode = '22023';
  end if;

  -- Un seul lien vivant par dossier : le précédent est révoqué.
  update identity.invitations
     set revoked_at = now(), revoked_by = v_uid
   where tenant_id = p_pme and accepted_at is null and revoked_at is null
     and expires_at > now();

  v_jeton := encode(extensions.gen_random_bytes(32), 'hex');
  insert into identity.invitations (tenant_id, email, role, token_hash, invited_by, expires_at)
  values (p_pme, v_email, 'dirigeant',
          encode(sha256(convert_to(v_jeton, 'UTF8')), 'hex'),
          v_uid, now() + interval '7 days')
  returning id, expires_at into v_id, v_expire;

  -- L'audit dit qui a invité qui ; le jeton n'y entre pas.
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (p_pme, v_uid, 'contact.invite', 'identity', 'invitations', v_id,
          jsonb_build_object('email', v_email, 'role', 'dirigeant', 'par', 'lien'));

  return jsonb_build_object('id', v_id, 'email', v_email, 'jeton', v_jeton,
                            'expiresAt', v_expire);
end $$;

revoke all on function public.dossier_inviter_contact(uuid, text) from public, anon;
grant execute on function public.dossier_inviter_contact(uuid, text) to authenticated;

-- --- 5. Le cabinet lit l'état de ses invitations, et en révoque ---------------------------
create or replace function public.dossier_invitations_lire(p_pme uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.expert_mandate_sur(p_pme) then
    raise exception 'Seul un expert du cabinet mandaté lit les invitations du dossier.'
      using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', i.id,
             'email', i.email,
             'statut', app.statut_invitation(i.accepted_at, i.revoked_at, i.expires_at),
             'expiresAt', i.expires_at,
             'createdAt', i.created_at,
             'acceptedAt', i.accepted_at,
             'revokedAt', i.revoked_at)
           order by i.created_at desc)
      from identity.invitations i
     where i.tenant_id = p_pme), '[]'::jsonb);
end $$;

revoke all on function public.dossier_invitations_lire(uuid) from public, anon;
grant execute on function public.dossier_invitations_lire(uuid) to authenticated;

create or replace function public.dossier_revoquer_invitation(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v record;
begin
  select id, tenant_id, accepted_at, revoked_at, expires_at into v
    from identity.invitations where id = p_id;
  if v.id is null or not app.expert_mandate_sur(v.tenant_id) then
    raise exception 'invitation introuvable ou non autorisee' using errcode = '42501';
  end if;
  if app.statut_invitation(v.accepted_at, v.revoked_at, v.expires_at) <> 'en_attente' then
    raise exception 'Seule une invitation en attente se révoque.' using errcode = '22023';
  end if;
  update identity.invitations set revoked_at = now(), revoked_by = auth.uid() where id = p_id;
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v.tenant_id, auth.uid(), 'contact.invitation_revoquee', 'identity', 'invitations',
          p_id, '{}'::jsonb);
  return jsonb_build_object('id', p_id, 'statut', 'revoquee');
end $$;

revoke all on function public.dossier_revoquer_invitation(uuid) from public, anon;
grant execute on function public.dossier_revoquer_invitation(uuid) to authenticated;

-- --- 6. Le contact lit ce qu'il rejoint --------------------------------------------------
-- Le jeton vaut lecture de ce seul dossier : son nom, celui du cabinet,
-- l'adresse invitée, l'état. Un jeton inconnu rend null.
create or replace function public.invitation_par_lien_lire(p_jeton text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'pme', o.name,
           'cabinet', (select c.name
                         from identity.engagements e
                         join identity.organizations c on c.id = e.cabinet_org_id
                        where e.pme_org_id = i.tenant_id and e.status = 'actif'
                        order by e.created_at limit 1),
           'email', i.email,
           'statut', app.statut_invitation(i.accepted_at, i.revoked_at, i.expires_at),
           'valable', app.statut_invitation(i.accepted_at, i.revoked_at, i.expires_at) = 'en_attente')
    from identity.invitations i
    join identity.organizations o on o.id = i.tenant_id
   where auth.uid() is not null
     and i.token_hash = encode(sha256(convert_to(coalesce(p_jeton, ''), 'UTF8')), 'hex')
$$;

revoke all on function public.invitation_par_lien_lire(text) from public, anon;
grant execute on function public.invitation_par_lien_lire(text) to authenticated;

-- --- 7. Le contact accepte ---------------------------------------------------------------
-- Le lien seul ne suffit pas : le compte qui accepte doit porter l'adresse
-- invitée. Un lien transmis à la mauvaise personne ne lui ouvre rien. Il
-- n'ouvre que le tenant de l'invitation.
create or replace function public.invitation_par_lien_accepter(p_jeton text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v record;
begin
  if auth.uid() is null then
    raise exception 'authentification requise' using errcode = '42501';
  end if;
  select id, tenant_id, email, role, expires_at, accepted_at, revoked_at into v
    from identity.invitations
   where token_hash = encode(sha256(convert_to(coalesce(p_jeton, ''), 'UTF8')), 'hex');
  if v.id is null or lower(v.email) <> lower(coalesce(app.mon_email(), '')) then
    raise exception 'invitation introuvable ou non autorisee' using errcode = '42501';
  end if;
  if app.statut_invitation(v.accepted_at, v.revoked_at, v.expires_at) <> 'en_attente' then
    raise exception 'Cette invitation n''est plus valable.' using errcode = '22023';
  end if;

  insert into identity.memberships (tenant_id, user_id, role)
  values (v.tenant_id, auth.uid(), v.role)
  on conflict (tenant_id, user_id) do nothing;
  update identity.invitations
     set accepted_at = now(), accepted_by = auth.uid()
   where id = v.id;
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v.tenant_id, auth.uid(), 'membre.rejoint', 'identity', 'memberships', v.id,
          jsonb_build_object('role', v.role, 'par', 'lien'));

  return jsonb_build_object('tenantId', v.tenant_id, 'role', v.role);
end $$;

revoke all on function public.invitation_par_lien_accepter(text) from public, anon;
grant execute on function public.invitation_par_lien_accepter(text) to authenticated;

-- --- 8. Le chemin par adresse ne contourne pas la révocation -----------------------------
-- invitations_pour_moi et invitation_repondre (l'écran /office) acceptent une
-- invitation par la seule adresse du compte. Sans ceci, une invitation révoquée
-- resterait acceptable par ce chemin-là. Corps repris du 4 septembre ; seule
-- la condition de révocation s'ajoute.
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
       and i.revoked_at is null
       and i.expires_at > now()
       and not exists (select 1 from identity.memberships m
                        where m.tenant_id = i.tenant_id and m.user_id = auth.uid())),
    '[]'::jsonb);
$$;

create or replace function public.invitation_repondre(p_id uuid, p_accepte boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v record;
begin
  select id, tenant_id, email, role, expires_at, accepted_at, revoked_at into v
    from identity.invitations where id = p_id;
  if v.id is null
     or lower(v.email) <> lower(coalesce(app.mon_email(), '')) then
    raise exception 'invitation introuvable ou non autorisee' using errcode = '42501';
  end if;
  if v.accepted_at is not null or v.revoked_at is not null or v.expires_at <= now() then
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

  update identity.invitations set expires_at = now() where id = p_id;
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (v.tenant_id, auth.uid(), 'membre.decline', 'identity', 'invitations', p_id,
          jsonb_build_object('role', v.role));
  return jsonb_build_object('id', p_id, 'tenantId', v.tenant_id, 'role', v.role, 'rejoint', false);
end $$;
