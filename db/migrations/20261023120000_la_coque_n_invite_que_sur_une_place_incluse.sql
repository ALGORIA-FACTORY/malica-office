-- L'application Android invite, sur une place incluse seulement (23 octobre 2026).
--
-- Décision de Wissem : rouvrir l'invitation dans l'application installée depuis
-- un store pour les places COMPRISES dans l'abonnement. Une place au-delà est
-- facturée (`facturation.droits_v`, `prix_siege_sup`) : c'est un achat, et les
-- règles de Google Play le veulent hors de l'application. Le web et la PWA
-- gardent tout.
--
-- La base compte ce qui est déjà ENGAGÉ : les places occupées, et les
-- invitations encore en attente (une invitation acceptée plus tard occupera une
-- place — trois invitations envoyées sur une place libre en feraient deux de
-- payées). L'API déclare, pour la transaction, que l'appel vient d'une coque
-- (`malica.client_coque = oui`) ; elle seule parle à la base.

create or replace function facturation.places_engagees(p_licence uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select facturation.places_occupees(p_licence) + (
    select count(distinct lower(i.email))::int
      from identity.invitations i
      join facturation.licence_organisations lo on lo.tenant_id = i.tenant_id
     where lo.licence_id = p_licence
       and i.role in ('dirigeant', 'collaborateur', 'assistant')
       and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
       -- Une adresse déjà assise sur la licence (dans une autre de ses
       -- sociétés) ou celle du titulaire n'occupera pas une place de plus.
       -- (Lu dans `auth.users` par la fonction elle-même : l'adresse ne sort pas.)
       and lower(i.email) not in (
         select lower(u.email::text)
           from facturation.licence_organisations lo2
           join identity.memberships m on m.tenant_id = lo2.tenant_id
           join auth.users u on u.id = m.user_id
          where lo2.licence_id = p_licence
            and m.role in ('dirigeant', 'collaborateur', 'assistant')
         union all
         select lower(u.email::text)
           from facturation.licences l join auth.users u on u.id = l.titulaire
          where l.id = p_licence))
$$;

revoke all on function facturation.places_engagees(uuid) from public, anon, authenticated;

create or replace function facturation.place_offrir(p_tenant uuid, p_email text, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_licence uuid;
  v_max     smallint;
  v_inclus  smallint;
begin
  -- La porte nommée d'abord (le contrat de `schema.test.ts`), puis la règle du
  -- 19 octobre : parmi les dirigeants, seul le titulaire donne une place.
  if not app.has_org_role(p_tenant, array['dirigeant']) then
    raise exception 'seul le proprietaire principal donne une place' using errcode = '42501';
  end if;

  v_licence := facturation.licence_de(p_tenant);

  if v_licence is not null then
    -- Une place à la fois : deux invitations simultanées liraient le même
    -- compte de places et passeraient toutes les deux.
    perform 1 from facturation.licences l where l.id = v_licence for update;
    if not exists (select 1 from facturation.licences l
                    where l.id = v_licence and l.titulaire = auth.uid()) then
      raise exception 'seul le proprietaire principal donne une place' using errcode = '42501';
    end if;
    select sieges_max, sieges_inclus into v_max, v_inclus
      from facturation.droits_v where licence_id = v_licence;
    if v_max is not null and facturation.places_occupees(v_licence) >= v_max then
      raise exception 'cette offre porte % place(s) ; elles sont prises', v_max
        using errcode = 'check_violation',
              hint = 'Passer à l''offre supérieure, ou libérer une place.';
    end if;
    -- Depuis l'application Android, une place qui serait facturée ne s'offre
    -- pas. Une invitation déjà en attente pour cette adresse est rendue telle
    -- quelle plus bas : elle n'engage rien de plus.
    if coalesce(current_setting('malica.client_coque', true), '') = 'oui'
       and not exists (select 1 from identity.invitations i
                        where i.tenant_id = p_tenant and lower(i.email) = lower(btrim(p_email))
                          and i.accepted_at is null and i.revoked_at is null
                          and i.expires_at > now())
       and facturation.places_engagees(v_licence) >= coalesce(v_inclus, 0) then
      raise exception 'refus.place.incluses_prises' using errcode = 'check_violation';
    end if;
  end if;

  return public.cabinet_inviter(p_tenant, p_email, p_role);
end
$function$;

revoke all on function facturation.place_offrir(uuid, text, text) from public, anon, authenticated;
