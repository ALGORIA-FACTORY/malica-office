-- =====================================================================================
--  Regalica Office — Les clés d'API du cabinet.
--
--  POURQUOI : une intégration parle au Socle avec une clé, pas avec un compte.
--  La clé désigne un cabinet et des portées ; elle ne PORTE aucune frontière.
--  Quand elle est présente, `app.member_orgs()` rend exactement ce cabinet —
--  et rien d'autre, même si la personne qui l'a créée est membre de dix
--  organisations. La RLS fait le reste, comme pour une session : une clé volée
--  ne voit rien de plus qu'un membre du cabinet, et rien hors du cabinet.
--
--  La clé en clair n'est ni stockée ni relue : seule son empreinte SHA-256 l'est.
--  Elle est rendue UNE fois, à la création, par `api_key_creer`.
--
--  Une clé ne s'efface pas : elle se révoque. Le journal d'audit garde sa
--  création, sa révocation, et la ligne reste lisible avec son préfixe.
--
--  Idempotent.
-- =====================================================================================

-- --- 1. La table ---------------------------------------------------------------------
create table if not exists identity.api_keys (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references identity.organizations(id) on delete cascade,
  libelle      text not null check (length(btrim(libelle)) > 0),
  -- Les huit premiers caractères après « rgo_live_ », et les quatre derniers :
  -- de quoi reconnaître une clé sans jamais la reconstituer.
  prefixe      text not null check (length(prefixe) = 8),
  suffixe      text not null check (length(suffixe) = 4),
  -- SHA-256 de la clé complète, en hexadécimal.
  empreinte    text not null unique check (empreinte ~ '^[0-9a-f]{64}$'),
  portees      text[] not null
               check (cardinality(portees) > 0
                      and portees <@ array['ecritures.lire', 'pieces.deposer']::text[]),
  created_by   uuid not null default auth.uid(),
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
create index if not exists api_keys_tenant_idx on identity.api_keys (tenant_id, created_at desc);
select app.enable_tenant_rls('identity', 'api_keys', false, false);

-- Une clé ne se modifie pas et ne s'efface pas : seuls « révoquée le » (une
-- fois) et « dernier usage » bougent. Le reste de la ligne est un fait.
create or replace function identity.api_keys_garde()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'une cle ne s''efface pas : elle se revoque' using errcode = '42501';
  end if;
  if new.tenant_id  is distinct from old.tenant_id
     or new.libelle    is distinct from old.libelle
     or new.prefixe    is distinct from old.prefixe
     or new.suffixe    is distinct from old.suffixe
     or new.empreinte  is distinct from old.empreinte
     or new.portees    is distinct from old.portees
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at
     or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at)
  then
    raise exception 'une cle ne se modifie pas : elle se revoque' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists api_keys_garde on identity.api_keys;
create trigger api_keys_garde
  before update or delete on identity.api_keys
  for each row execute function identity.api_keys_garde();

-- La vue ne montre jamais l'empreinte : elle ne sert à rien à l'écran, et une
-- colonne qu'on n'expose pas ne fuit pas.
create or replace view public.api_keys_v with (security_invoker = true) as
select id, tenant_id, libelle, prefixe, suffixe, portees, created_by, created_at,
       last_used_at, revoked_at
  from identity.api_keys;
grant select on public.api_keys_v to authenticated;

-- --- 2. Le contexte d'une clé ----------------------------------------------------------
-- L'API pose ce claim quand l'appelant est une clé, à côté de `sub` (la
-- personne qui a créé la clé, pour l'attribution des écritures d'audit).
create or replace function app.api_tenant()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(current_setting('request.jwt.claim.api_tenant', true), '')::uuid
$$;
revoke all on function app.api_tenant() from public, anon;
grant execute on function app.api_tenant() to authenticated;

-- Sous une clé, les organisations de l'appelant sont EXACTEMENT le cabinet de
-- la clé. Sans clé, rien ne change : les appartenances de la personne.
create or replace function app.member_orgs()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.tenant_id
    from identity.memberships m
   where app.api_tenant() is null
     and m.user_id = auth.uid()
  union all
  select app.api_tenant()
   where app.api_tenant() is not null
$$;

-- Les mandats se déduisent des organisations de l'appelant, quelle que soit
-- la façon dont il les tient — session ou clé.
create or replace function app.engaged_orgs()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.pme_org_id
    from identity.engagements e
   where e.cabinet_org_id in (select app.member_orgs())
     and e.status = 'actif'
     and e.starts_on <= current_date
     and (e.ends_on is null or e.ends_on >= current_date)
$$;

-- Une clé n'est jamais la plateforme, même créée par un opérateur.
create or replace function app.is_platform()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.api_tenant() is null
     and exists (select 1 from app.platform_operators po where po.user_id = auth.uid())
$$;

-- --- 3. Créer une clé ------------------------------------------------------------------
-- Rend la clé en clair, une seule fois. Ce qui reste en base n'en permet pas la
-- reconstitution.
create or replace function public.api_key_creer(p_tenant uuid, p_libelle text, p_portees text[])
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_secret text;
  v_cle    text;
  v_id     uuid;
begin
  if p_tenant not in (select app.member_orgs()) then
    raise exception 'cabinet introuvable ou non autorise' using errcode = '42501';
  end if;
  if app.api_tenant() is not null then
    raise exception 'une cle ne cree pas de cle' using errcode = '42501';
  end if;
  if not exists (select 1 from identity.organizations o
                  where o.id = p_tenant and o.kind = 'cabinet' and o.archived_at is null) then
    raise exception 'seul un cabinet porte une cle d''API' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_libelle, ''))) = 0 then
    raise exception 'la cle doit porter un nom' using errcode = '22023';
  end if;

  v_secret := encode(extensions.gen_random_bytes(24), 'hex');
  v_cle    := 'rgo_live_' || v_secret;

  insert into identity.api_keys (tenant_id, libelle, prefixe, suffixe, empreinte, portees)
  values (p_tenant, btrim(p_libelle), left(v_secret, 8), right(v_secret, 4),
          encode(sha256(convert_to(v_cle, 'UTF8')), 'hex'), p_portees)
  returning id into v_id;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_tenant, auth.uid(), 'api_key.creee', 'identity', 'api_keys', v_id,
          jsonb_build_object('libelle', btrim(p_libelle), 'prefixe', left(v_secret, 8),
                             'portees', to_jsonb(p_portees)));

  return jsonb_build_object('id', v_id, 'cle', v_cle,
                            'prefixe', left(v_secret, 8), 'suffixe', right(v_secret, 4));
end $$;

revoke all on function public.api_key_creer(uuid, text, text[]) from public, anon;
grant execute on function public.api_key_creer(uuid, text, text[]) to authenticated;

-- --- 4. Révoquer une clé ---------------------------------------------------------------
create or replace function public.api_key_revoquer(p_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tenant  uuid;
  v_prefixe text;
begin
  if app.api_tenant() is not null then
    raise exception 'une cle ne revoque pas de cle' using errcode = '42501';
  end if;

  update identity.api_keys
     set revoked_at = now()
   where id = p_id and revoked_at is null
  returning tenant_id, prefixe into v_tenant, v_prefixe;
  if not found then
    raise exception 'cle introuvable ou deja revoquee' using errcode = 'P0002';
  end if;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (v_tenant, auth.uid(), 'api_key.revoquee', 'identity', 'api_keys', p_id,
          jsonb_build_object('prefixe', v_prefixe));

  return jsonb_build_object('id', p_id, 'revoquee', true);
end $$;

revoke all on function public.api_key_revoquer(uuid) from public, anon;
grant execute on function public.api_key_revoquer(uuid) to authenticated;

-- --- 5. Résoudre une clé ---------------------------------------------------------------
-- Appelée par l'API avant toute identité : rend le cabinet et les portées si
-- l'empreinte correspond, que la clé n'est pas révoquée et que le cabinet n'est
-- pas archivé ; `null` sinon, sans distinguer les causes. Note le dernier usage,
-- sans réécrire la ligne à chaque appel.
create or replace function public.api_key_resoudre(p_cle text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  select k.id, k.tenant_id, k.portees, k.created_by
    into r
    from identity.api_keys k
    join identity.organizations o on o.id = k.tenant_id and o.archived_at is null
   where k.empreinte = encode(sha256(convert_to(coalesce(p_cle, ''), 'UTF8')), 'hex')
     and k.revoked_at is null;
  if not found then
    return null;
  end if;

  update identity.api_keys
     set last_used_at = now()
   where id = r.id
     and (last_used_at is null or last_used_at < now() - interval '1 minute');

  return jsonb_build_object('id', r.id, 'tenantId', r.tenant_id,
                            'portees', to_jsonb(r.portees), 'auNomDe', r.created_by);
end $$;

revoke all on function public.api_key_resoudre(text) from public, anon;
grant execute on function public.api_key_resoudre(text) to authenticated;
