-- Trois rôles autour d'une licence, décidés le 19 octobre 2026 :
--
--   * le PROPRIÉTAIRE PRINCIPAL : le titulaire de la licence. Lui seul touche
--     l'abonnement — forfait, places, sociétés, recharges. Il n'occupe pas de
--     place : il est dans le prix de l'offre.
--   * le PROPRIÉTAIRE : un autre dirigeant de la société. Il est OPTIONNEL, il
--     a les droits du dirigeant sur la société, mais il OCCUPE UNE PLACE PAYÉE,
--     comme un utilisateur. Il ne touche pas l'abonnement.
--   * l'UTILISATEUR : le collaborateur (et l'assistant). Il occupe une place.
--
-- Avant cette migration, tout dirigeant entrait gratuitement : un second
-- dirigeant était une place offerte, et `places_v` (qui ne comptait que les
-- collaborateurs) ne disait pas la même chose que `places_occupees` (qui
-- comptait aussi les assistants). Les deux comptent désormais la même chose :
-- toute personne de la société, sauf le titulaire et le cabinet.
--
-- Le titulaire se transmet : `public.licence_transmettre`, par le titulaire
-- seul, à un propriétaire de la société. La naissance d'une licence reste
-- immuable (`naissance_immuable`) ; la transmission est la seule écriture du
-- titulaire qu'elle admet, et chaque transmission s'inscrit
-- (`facturation.transmissions`, R7 : on n'efface pas qui a été titulaire).

-- --- 1. Ce qui occupe une place ----------------------------------------------

create or replace view facturation.places_v with (security_invoker = true) as
select
  l.id as licence_id,
  (select count(distinct lo.tenant_id)
     from facturation.licence_organisations lo
    where lo.licence_id = l.id)::int as organisations,
  (select count(distinct m.user_id)
     from facturation.licence_organisations lo
     join identity.memberships m on m.tenant_id = lo.tenant_id
    where lo.licence_id = l.id
      and m.role in ('dirigeant', 'collaborateur', 'assistant')
      and m.user_id <> l.titulaire)::int as sieges_occupes
from facturation.licences l;

create or replace function facturation.places_occupees(p_licence uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(distinct m.user_id)::int
  from facturation.licence_organisations lo
  join facturation.licences l on l.id = lo.licence_id
  join identity.memberships m on m.tenant_id = lo.tenant_id
  where lo.licence_id = p_licence
    and m.role in ('dirigeant', 'collaborateur', 'assistant')
    and m.user_id <> l.titulaire
$$;

comment on function facturation.places_occupees(uuid) is
  'Les places prises sur une licence : toute personne de ses sociétés (propriétaire, '
  'utilisateur, assistant), une fois chacune, sauf le titulaire et le cabinet.';

-- --- 2. La porte de la place, à l'entrée d'un membre ------------------------

create or replace function facturation.place_disponible()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_licence   uuid;
  v_titulaire uuid;
  v_max       smallint;
begin
  -- Un membre de cabinet (`expert`) n'est pas un siège du client : il entre
  -- par le mandat, pas par le forfait de la PME.
  if new.role = 'expert' then
    return new;
  end if;

  v_licence := facturation.licence_de(new.tenant_id);

  -- Une organisation sans licence est une organisation en cours de création,
  -- ou un cabinet : son créateur y entre, la licence naît juste après
  -- (`20261022100000`).
  if v_licence is null then
    return new;
  end if;

  -- Le propriétaire principal est dans le prix de l'offre.
  select l.titulaire into v_titulaire from facturation.licences l where l.id = v_licence;
  if new.user_id = v_titulaire then
    return new;
  end if;

  -- La personne déjà présente ailleurs dans le groupe n'occupe pas une place
  -- de plus : on ne compte que les personnes nouvelles.
  if exists (
    select 1
    from facturation.licence_organisations lo
    join identity.memberships m on m.tenant_id = lo.tenant_id
    where lo.licence_id = v_licence
      and m.user_id = new.user_id
      and m.role in ('dirigeant', 'collaborateur', 'assistant')
  ) then
    return new;
  end if;

  select sieges_max into v_max from facturation.droits_v where licence_id = v_licence;

  -- `sieges_max` vide : sans plafond (20261022090000).
  if v_max is not null and facturation.places_occupees(v_licence) >= v_max then
    raise exception
      'cette offre porte % place(s) ; elles sont prises', v_max
      using errcode = 'check_violation',
            hint = 'Passer à l''offre supérieure, ou libérer une place.';
  end if;

  return new;
end
$$;

-- --- 3. Les places se donnent par le propriétaire principal seul ------------

create or replace function facturation.place_offrir(p_tenant uuid, p_email text, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_licence uuid;
  v_max     smallint;
begin
  -- La porte nommée d'abord (le contrat de `schema.test.ts`), puis la règle du
  -- 19 octobre : parmi les dirigeants, seul le titulaire donne une place.
  if not app.has_org_role(p_tenant, array['dirigeant']) then
    raise exception 'seul le proprietaire principal donne une place' using errcode = '42501';
  end if;

  v_licence := facturation.licence_de(p_tenant);

  if v_licence is not null then
    if not exists (select 1 from facturation.licences l
                    where l.id = v_licence and l.titulaire = auth.uid()) then
      raise exception 'seul le proprietaire principal donne une place' using errcode = '42501';
    end if;
    select sieges_max into v_max from facturation.droits_v where licence_id = v_licence;
    if v_max is not null and facturation.places_occupees(v_licence) >= v_max then
      raise exception 'cette offre porte % place(s) ; elles sont prises', v_max
        using errcode = 'check_violation',
              hint = 'Passer à l''offre supérieure, ou libérer une place.';
    end if;
  end if;

  return public.cabinet_inviter(p_tenant, p_email, p_role);
end
$$;

revoke all on function facturation.place_offrir(uuid, text, text) from public, anon, authenticated;

create or replace function public.siege_inviter(p_tenant uuid, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.has_org_role(p_tenant, array['dirigeant']) then
    raise exception 'seul le proprietaire principal invite un siege' using errcode = '42501';
  end if;
  return facturation.place_offrir(p_tenant, p_email, 'collaborateur');
end
$$;

create or replace function public.proprietaire_inviter(p_tenant uuid, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.has_org_role(p_tenant, array['dirigeant']) then
    raise exception 'seul le proprietaire principal invite un proprietaire' using errcode = '42501';
  end if;
  return facturation.place_offrir(p_tenant, p_email, 'dirigeant');
end
$$;

revoke all on function public.proprietaire_inviter(uuid, text) from public, anon;
grant execute on function public.proprietaire_inviter(uuid, text) to authenticated;

comment on function public.proprietaire_inviter(uuid, text) is
  'Le propriétaire principal invite un propriétaire : un dirigeant de plus, qui '
  'occupe une place payée et ne touche pas l''abonnement.';

-- L'autre chemin d'invitation (`collab.inviter` -> `cabinet_inviter`) disait
-- la même chose à tout dirigeant. Sur une PME licenciée, une personne de plus
-- est une place : seul le titulaire l'invite. Un cabinet, ou une société sans
-- licence, garde la règle d'avant. Corps repris tel quel de la base, plus la
-- seule porte ajoutée.
create or replace function public.cabinet_inviter(p_tenant uuid, p_email text, p_role text)
returns jsonb
language plpgsql
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
    raise exception 'seul le proprietaire principal donne une place' using errcode = '42501';
  end if;

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

-- --- 4. Le propriétaire principal se transmet -------------------------------

create table facturation.transmissions (
  id          uuid primary key default gen_random_uuid(),
  licence_id  uuid not null references facturation.licences (id),
  de          uuid not null,
  a           uuid not null,
  le          timestamptz not null default now(),
  constraint transmissions_a_un_autre check (de <> a)
);

comment on table facturation.transmissions is
  'Qui a été propriétaire principal, et quand cela a changé. On n''efface pas un '
  'titulaire : on inscrit sa transmission (R7).';

alter table facturation.transmissions enable row level security;

create policy transmissions_lire on facturation.transmissions
  for select to authenticated
  using ((select app.is_platform()) or (select auth.uid()) in (de, a));

grant select on facturation.transmissions to authenticated;

create trigger transmissions_ne_se_reecrivent_pas
  before update or delete on facturation.transmissions
  for each row execute function app.deny_mutation();

-- La naissance reste immuable ; seule la transmission, ouverte par la fonction
-- qui l'inscrit, change le titulaire.
create or replace function facturation.naissance_immuable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.origine is distinct from old.origine
     or new.origine_cabinet is distinct from old.origine_cabinet
     or new.offre_code is distinct from old.offre_code
     or new.offre_depuis is distinct from old.offre_depuis
     or (new.titulaire is distinct from old.titulaire
         and coalesce(current_setting('facturation.transmission', true), '') <> old.id::text)
  then
    raise exception
      'la naissance d''une licence ne se reecrit pas : un changement de forfait s''inscrit dans facturation.forfait_historique'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

create or replace function public.licence_transmettre(p_tenant uuid, p_nouveau uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_licence uuid;
  v_ancien  uuid;
begin
  if not app.has_org_role(p_tenant, array['dirigeant']) then
    raise exception 'seul le proprietaire principal transmet la licence' using errcode = '42501';
  end if;

  select l.id, l.titulaire into v_licence, v_ancien
    from facturation.licences l
    join facturation.licence_organisations lo on lo.licence_id = l.id
   where lo.tenant_id = p_tenant;

  if v_licence is null then
    raise exception 'cette societe n''a pas de licence' using errcode = '22023';
  end if;
  if v_ancien is distinct from auth.uid() then
    raise exception 'seul le proprietaire principal transmet la licence' using errcode = '42501';
  end if;
  if p_nouveau = v_ancien then
    raise exception 'la licence est deja a cette personne' using errcode = '22023';
  end if;
  -- On transmet à un propriétaire : quelqu'un qui dirige déjà une société de
  -- la licence. Pas à un inconnu, pas à un utilisateur.
  if not exists (
    select 1 from facturation.licence_organisations lo
    join identity.memberships m on m.tenant_id = lo.tenant_id
    where lo.licence_id = v_licence and m.user_id = p_nouveau and m.role = 'dirigeant'
  ) then
    raise exception 'on ne transmet qu''a un proprietaire de la societe' using errcode = '22023';
  end if;

  perform set_config('facturation.transmission', v_licence::text, true);
  update facturation.licences set titulaire = p_nouveau where id = v_licence;
  perform set_config('facturation.transmission', '', true);

  insert into facturation.transmissions (licence_id, de, a) values (v_licence, v_ancien, p_nouveau);

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_tenant, auth.uid(), 'licence.transmise', 'facturation', 'licences', v_licence,
          jsonb_build_object('de', v_ancien, 'a', p_nouveau));

  return v_licence;
end
$$;

revoke all on function public.licence_transmettre(uuid, uuid) from public, anon;
grant execute on function public.licence_transmettre(uuid, uuid) to authenticated;

comment on function public.licence_transmettre(uuid, uuid) is
  'Le propriétaire principal transmet la licence à un propriétaire de la société. '
  'L''ancien titulaire reste propriétaire : il occupe désormais une place, celle '
  'que le nouveau libère.';
