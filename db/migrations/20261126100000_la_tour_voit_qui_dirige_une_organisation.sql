-- La Tour voit qui appartient à une organisation, et qui est titulaire de sa licence.
--
-- Recette du 4 novembre 2026 : la Tour refusait de confier « Algoria Factory »
-- (« déjà dirigée »), mais personne ne voyait qui la dirigeait — ni le
-- dirigeant d'ALGORIA, qui n'en est pas membre, ni la Tour, dont la liste des
-- licences ne nomme pas le titulaire. Une décision de plateforme se prenait
-- donc à l'aveugle.
--
-- `plateforme_organisation_membres(org)` : en lecture seule, pour la seule
-- plateforme, les membres (adresse, nom, rôle, depuis) et le titulaire de la
-- licence de l'organisation. Rien ne s'écrit.

begin;

create or replace function public.plateforme_organisation_membres(p_org uuid)
returns table(user_id uuid, email text, nom text, role text, depuis timestamptz,
              titulaire_licence boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  if not exists (select 1 from identity.organizations o where o.id = p_org) then
    raise exception 'refus.introuvable.organisation' using errcode = '42501';
  end if;

  return query
    with titulaire as (
      select l.titulaire as user_id
        from facturation.licence_organisations lo
        join facturation.licences l on l.id = lo.licence_id
       where lo.tenant_id = p_org
    ),
    personnes as (
      select m.user_id, m.role::text as role, m.created_at as depuis
        from identity.memberships m where m.tenant_id = p_org
      union all
      -- Un titulaire qui ne serait plus membre se voit aussi : c'est lui qui paie.
      select t.user_id, null, null from titulaire t
       where not exists (select 1 from identity.memberships m
                          where m.tenant_id = p_org and m.user_id = t.user_id)
    )
    select p.user_id, u.email::text, pr.display_name::text, p.role, p.depuis,
           exists (select 1 from titulaire t where t.user_id = p.user_id)
      from personnes p
      left join auth.users u on u.id = p.user_id
      left join identity.profiles pr on pr.user_id = p.user_id
     order by p.depuis nulls last, u.email;
end
$$;
revoke all on function public.plateforme_organisation_membres(uuid) from public, anon;
grant execute on function public.plateforme_organisation_membres(uuid) to authenticated;

comment on function public.plateforme_organisation_membres(uuid) is
  'Pour la plateforme seule, en lecture : les membres d''une organisation (adresse, nom, '
  'rôle, depuis) et le titulaire de sa licence, même s''il n''en est plus membre.';

commit;
