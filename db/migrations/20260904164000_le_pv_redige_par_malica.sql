-- =====================================================================================
--  Malica Office — Le PV rédigé par Malica, et la mise en route du cabinet.
--
--  POURQUOI : le procès-verbal de restitution est le seul artefact qu'un modèle
--  rédige (R3). Le texte est de lui ; chaque chiffre vient d'un moteur du Socle
--  et porte son nom. Une fois envoyé au client, le PV est un fait : il ne se
--  réécrit pas (R7), on en rédige un autre.
--
--  La mise en route est un parcours en quatre étapes, rejouable ; son
--  achèvement se note dans les réglages du cabinet.
--
--  Idempotent.
-- =====================================================================================

-- --- 1. Ce que le PV porte ---------------------------------------------------------------
alter table collab.pv_reunions
  add column if not exists sections jsonb not null default '[]'::jsonb,
  add column if not exists chiffres jsonb not null default '[]'::jsonb,
  add column if not exists ton text
    check (ton is null or ton in ('sobre', 'chaleureux')),
  add column if not exists statut text not null default 'brouillon'
    check (statut in ('brouillon', 'envoye')),
  add column if not exists envoye_le timestamptz,
  add column if not exists redige_par_malica boolean not null default false;

comment on column collab.pv_reunions.sections is
  'Le texte, par section : [{kicker, corps}]. Rédigé par Malica ou repris par le cabinet.';
comment on column collab.pv_reunions.chiffres is
  'Les chiffres cités, et le moteur qui les a produits : [{label, valeur, source, genre}]. Jamais un modèle.';

grant update on table collab.pv_reunions to authenticated;

drop policy if exists pv_upd_cabinet on collab.pv_reunions;
create policy pv_upd_cabinet on collab.pv_reunions for update to authenticated
  using (cabinet_tenant_id in (select app.member_orgs()))
  with check (cabinet_tenant_id in (select app.member_orgs()));

-- Un PV envoyé est figé : ni retouche, ni suppression (R7). Et l'envoi ne se
-- fait que par le geste d'envoi, qui journalise et prévient le client.
create or replace function collab.pv_figer()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.statut = 'envoye' then
    raise exception 'Ce procès-verbal a été envoyé au client : il ne se modifie plus. Rédigez-en un nouveau.'
      using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.statut = 'envoye'
     and coalesce(current_setting('app.pv_envoi', true), '') <> 'oui' then
    raise exception 'Un procès-verbal s''envoie par le geste d''envoi, pas par une simple mise à jour.'
      using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists pv_reunions_fige on collab.pv_reunions;
create trigger pv_reunions_fige before update or delete on collab.pv_reunions
  for each row execute function collab.pv_figer();

-- La vue suit la table, colonne pour colonne : rejouable quel que soit ce
-- qu'une migration voisine aura ajouté entre-temps.
do $$
declare
  v_colonnes text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into v_colonnes
    from information_schema.columns
   where table_schema = 'collab' and table_name = 'pv_reunions';
  execute 'drop view if exists public.collab_pv_v';
  execute 'create view public.collab_pv_v with (security_invoker = true) as select '
          || v_colonnes || ' from collab.pv_reunions';
  execute 'revoke all on public.collab_pv_v from public, anon, service_role';
  execute 'grant select, insert, update on public.collab_pv_v to authenticated';
end $$;

-- --- 2. L'envoi --------------------------------------------------------------------------
create or replace function public.pv_envoyer(p_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v collab.pv_reunions%rowtype;
  v_cabinet text;
begin
  select * into v from collab.pv_reunions where id = p_id for update;
  if v.id is null then
    raise exception 'Procès-verbal introuvable.' using errcode = 'P0002';
  end if;
  if v.cabinet_tenant_id not in (select app.member_orgs()) then
    raise exception 'Procès-verbal introuvable.' using errcode = 'P0002';
  end if;
  if v.statut = 'envoye' then
    return jsonb_build_object('id', v.id, 'statut', v.statut, 'envoyeLe', v.envoye_le);
  end if;
  if v.client_tenant_id is null then
    raise exception 'Ce procès-verbal n''est rattaché à aucun client : rien à envoyer.'
      using errcode = '22023';
  end if;
  if not exists (select 1 from identity.engagements e
                  where e.cabinet_org_id = v.cabinet_tenant_id
                    and e.pme_org_id = v.client_tenant_id
                    and e.status = 'actif') then
    raise exception 'Le mandat avec ce client n''est pas actif : le procès-verbal ne peut pas lui être envoyé.'
      using errcode = '22023';
  end if;
  if jsonb_array_length(v.sections) = 0 then
    raise exception 'Ce procès-verbal n''a pas encore de texte : rédigez-le avant de l''envoyer.'
      using errcode = '22023';
  end if;

  select name into v_cabinet from identity.organizations where id = v.cabinet_tenant_id;

  perform set_config('app.pv_envoi', 'oui', true);
  update collab.pv_reunions
     set statut = 'envoye', envoye_le = now()
   where id = p_id;

  -- Le journal du cabinet, et celui du mandat : les deux parties le voient.
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (v.cabinet_tenant_id, auth.uid(), 'pv.envoye', 'collab', 'pv_reunions', v.id,
          jsonb_build_object('client_tenant_id', v.client_tenant_id, 'at', v.at,
                             'redige_par_malica', v.redige_par_malica));
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (v.client_tenant_id, auth.uid(), 'pv.envoye', 'collab', 'pv_reunions', v.id,
          jsonb_build_object('cabinet_tenant_id', v.cabinet_tenant_id, 'at', v.at));

  insert into collab.notifications (tenant_id, kind, payload)
  values (v.client_tenant_id, 'pv.envoye',
          jsonb_build_object('pv_id', v.id, 'titre', v.titre, 'at', v.at, 'cabinet', v_cabinet));

  return jsonb_build_object('id', v.id, 'statut', 'envoye', 'envoyeLe', now());
end $$;

revoke all on function public.pv_envoyer(uuid) from public, anon;
grant execute on function public.pv_envoyer(uuid) to authenticated;

-- --- 3. La mise en route -----------------------------------------------------------------
alter table collab.reglages_cabinet
  add column if not exists mise_en_route_terminee_le timestamptz;

-- La vue suit la table, colonne pour colonne, dans l'ordre du catalogue.
-- Plusieurs migrations du même jour ajoutent chacune la leur : une liste
-- figée ne survivrait pas à leur ordre d'exécution, et `create or replace
-- view` refuse de retirer ou de déplacer une colonne. On relit le catalogue.
do $$
declare
  v_colonnes text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into v_colonnes
    from information_schema.columns
   where table_schema = 'collab' and table_name = 'reglages_cabinet';
  execute 'drop view if exists public.reglages_cabinet_v';
  execute 'create view public.reglages_cabinet_v with (security_invoker = true) as select '
          || v_colonnes || ' from collab.reglages_cabinet';
  execute 'grant select on public.reglages_cabinet_v to authenticated';
end $$;

create or replace function public.cabinet_mise_en_route_lire(p_tenant uuid)
returns timestamptz
language sql
stable
security invoker
set search_path = ''
as $$
  select r.mise_en_route_terminee_le
    from collab.reglages_cabinet r
   where r.tenant_id = p_tenant and r.tenant_id in (select app.member_orgs());
$$;

create or replace function public.cabinet_mise_en_route_terminer(p_tenant uuid)
returns timestamptz
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_quand timestamptz := now();
begin
  if p_tenant not in (select app.member_orgs()) then
    raise exception 'cabinet introuvable ou non autorise' using errcode = '42501';
  end if;
  -- Sans ligne de réglages, les défauts du schéma s'appliquent : on n'en pose aucun ici.
  insert into collab.reglages_cabinet (tenant_id, mise_en_route_terminee_le)
  values (p_tenant, v_quand)
  on conflict (tenant_id) do update
    set mise_en_route_terminee_le = excluded.mise_en_route_terminee_le,
        updated_by = auth.uid(),
        updated_at = now();

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_tenant, auth.uid(), 'cabinet.mise_en_route', 'collab', 'reglages_cabinet', p_tenant,
          jsonb_build_object('terminee_le', v_quand));
  return v_quand;
end $$;

revoke all on function public.cabinet_mise_en_route_lire(uuid) from public, anon;
grant execute on function public.cabinet_mise_en_route_lire(uuid) to authenticated;
revoke all on function public.cabinet_mise_en_route_terminer(uuid) from public, anon;
grant execute on function public.cabinet_mise_en_route_terminer(uuid) to authenticated;

-- --- 4. Inviter un collaborateur ---------------------------------------------------------
-- La table existe depuis l'origine (identity.invitations) ; il lui manquait un
-- geste pour y écrire et une vue pour la lire. Le jeton ne se stocke que haché.
create or replace view public.invitations_v with (security_invoker = true) as
select id, tenant_id, email, role, invited_by, expires_at, accepted_at, created_at
from identity.invitations;
revoke all on public.invitations_v from public, anon, service_role;
grant select on public.invitations_v to authenticated;

create or replace function public.cabinet_inviter(p_tenant uuid, p_email text, p_role text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_email text := lower(trim(p_email));
  v_id uuid;
  v_expire timestamptz;
begin
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Cette adresse ne ressemble pas à une adresse e-mail.' using errcode = '22023';
  end if;
  -- L'adresse d'un membre ne se lit que par app.email_du_membre : auth.users
  -- reste fermée à l'appelant, comme partout.
  if exists (select 1 from identity.memberships m
             where m.tenant_id = p_tenant
               and lower(coalesce(app.email_du_membre(m.user_id), '')) = v_email) then
    raise exception 'Cette personne fait déjà partie du cabinet.' using errcode = '22023';
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

revoke all on function public.cabinet_inviter(uuid, text, text) from public, anon;
grant execute on function public.cabinet_inviter(uuid, text, text) to authenticated;

-- --- 5. Proposer un mandat à une PME, par son identifiant fiscal --------------------------
-- Le cabinet ne voit pas les PME qu'il ne mandate pas : la recherche par
-- identifiant passe donc sous définisseur, et ne rend que le nom de celle
-- qu'il vient de solliciter. Le mandat naît « proposé » ; la PME l'accepte.
create or replace function public.mandat_proposer(p_cabinet uuid, p_legal_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_legal text := trim(p_legal_id);
  v_pme uuid;
  v_nom text;
  v_id uuid;
  v_status text;
  v_cabinet text;
begin
  if not app.has_org_role(p_cabinet, array['expert']) then
    raise exception 'Seul un expert du cabinet peut proposer un mandat.' using errcode = '42501';
  end if;
  if v_legal = '' then
    raise exception 'Indiquez l''identifiant fiscal de la PME.' using errcode = '22023';
  end if;
  select id, name into v_pme, v_nom
    from identity.organizations
   where kind = 'pme' and archived_at is null and legal_id = v_legal
   order by created_at limit 1;
  if v_pme is null then
    raise exception 'Aucune PME ne porte cet identifiant fiscal dans Malica Office.'
      using errcode = 'P0002';
  end if;

  select id, status into v_id, v_status
    from identity.engagements where pme_org_id = v_pme and cabinet_org_id = p_cabinet;
  if v_id is not null then
    return jsonb_build_object('id', v_id, 'pmeTenantId', v_pme, 'pmeName', v_nom,
                              'status', v_status, 'deja', true);
  end if;

  insert into identity.engagements (pme_org_id, cabinet_org_id, status, created_by)
  values (v_pme, p_cabinet, 'propose', auth.uid())
  returning id into v_id;

  select name into v_cabinet from identity.organizations where id = p_cabinet;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_cabinet, auth.uid(), 'engagement.propose', 'identity', 'engagements', v_id,
          jsonb_build_object('pme_org_id', v_pme));
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (v_pme, auth.uid(), 'engagement.propose', 'identity', 'engagements', v_id,
          jsonb_build_object('cabinet_org_id', p_cabinet));
  insert into collab.notifications (tenant_id, kind, payload)
  values (v_pme, 'mandat.propose',
          jsonb_build_object('engagement_id', v_id, 'cabinet', v_cabinet));

  return jsonb_build_object('id', v_id, 'pmeTenantId', v_pme, 'pmeName', v_nom,
                            'status', 'propose', 'deja', false);
end $$;

revoke all on function public.mandat_proposer(uuid, text) from public, anon;
grant execute on function public.mandat_proposer(uuid, text) to authenticated;

-- --- 6. Le cabinet se décrit --------------------------------------------------------------
-- La juridiction doit exister dans le référentiel ; la devise suit le pack, on
-- ne la demande pas (R4 : aucun repli, aucune devise saisie).
create or replace function public.organisation_definir(
  p_org uuid, p_name text, p_legal_id text, p_jurisdiction text
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_currency text;
  v_name text := trim(p_name);
  v_legal text := nullif(trim(coalesce(p_legal_id, '')), '');
begin
  if not app.has_org_role(p_org, array['dirigeant', 'expert']) then
    raise exception 'organisation introuvable ou non autorisee' using errcode = '42501';
  end if;
  if v_name = '' then
    raise exception 'Le nom de l''organisation ne peut pas être vide.' using errcode = '22023';
  end if;
  select p.currency into v_currency
    from ref.jurisdiction_packs p
   where p.jurisdiction = p_jurisdiction and p.effective_from <= current_date
   order by p.effective_from desc limit 1;
  if v_currency is null then
    raise exception 'Aucun pack n''est en vigueur pour cette juridiction.' using errcode = '22023';
  end if;

  update identity.organizations
     set name = v_name, legal_id = v_legal, jurisdiction = p_jurisdiction, currency = v_currency
   where id = p_org;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_org, auth.uid(), 'organization.updated', 'identity', 'organizations', p_org,
          jsonb_build_object('name', v_name, 'legal_id', v_legal, 'jurisdiction', p_jurisdiction));

  return jsonb_build_object('id', p_org, 'name', v_name, 'legalId', v_legal,
                            'jurisdiction', p_jurisdiction, 'currency', v_currency);
end $$;

revoke all on function public.organisation_definir(uuid, text, text, text) from public, anon;
grant execute on function public.organisation_definir(uuid, text, text, text) to authenticated;
