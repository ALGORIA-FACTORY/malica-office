-- Les réglages lisent la licence de la société OUVERTE, pas celle du compte.
--
-- Recette du 3 novembre 2026. Wissem Barouni est titulaire de la licence
-- d'ALGORIA FACTORY SUARL et propriétaire (non principal) de SOTUMAG SARL,
-- dont la licence appartient à un autre titulaire. SOTUMAG ouverte, la
-- rubrique « Sociétés » de ses réglages montrait ALGORIA FACTORY SUARL, son
-- cabinet AUDICORP, son bouton « Révoquer » et « Votre abonnement Premium est
-- payé par AUDICORP » — et SOTUMAG nulle part. Le dirigeant a cru que
-- l'abonnement proposé par AUDICORP à ALGORIA était celui de SOTUMAG, et le
-- seul bouton « Révoquer » de l'écran aurait révoqué le mandat d'ALGORIA.
--
-- CAUSE. Le forfait de l'écran se lit pour la société ouverte
-- (`mon_forfait(p_tenant)`), mais la liste des sociétés et celle des sièges
-- se lisaient par `licence_organisations_v` / `licence_sieges_v`, qui rendent
-- les licences dont l'appelant est TITULAIRE (`l.titulaire = auth.uid()`),
-- sans regarder la société ouverte. Deux lectures de deux licences
-- différentes, affichées comme une seule.
--
-- CE QUE CE FICHIER POSE : deux lectures ancrées sur la société ouverte.
--   • `licence_organisations_de(p_tenant)` : la société ouverte y est TOUJOURS.
--     Le titulaire de sa licence voit toutes les sociétés de cette licence ;
--     un autre membre ne voit que la société ouverte — ce que paie un autre
--     titulaire ne le regarde pas (même règle que `mon_forfait`, branche 2).
--   • `licence_sieges_de(p_tenant)` : le titulaire voit les sièges de toute
--     sa licence ; le dirigeant de la société ouverte, ceux de cette société ;
--     un autre membre, aucun (la vue n'en montrait pas davantage).
-- Les vues restent : elles décrivent « mes licences », et rien d'autre ne
-- change de sens.

begin;

create or replace function public.licence_organisations_de(p_tenant uuid)
returns table(tenant_id uuid, nom text, lectures_consommees integer, titulaire boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_licence uuid;
  v_titulaire boolean;
begin
  if p_tenant is null or p_tenant not in (select app.member_orgs()) then
    raise exception 'refus.geste.non_permis' using errcode = '42501';
  end if;

  select lo.licence_id, l.titulaire = auth.uid()
    into v_licence, v_titulaire
    from facturation.licence_organisations lo
    join facturation.licences l on l.id = lo.licence_id
   where lo.tenant_id = p_tenant;

  return query
    select o.id, o.name::text,
           case when v_licence is null then null
                else (select count(*)::integer from facturation.lectures le
                       where le.licence_id = v_licence and le.tenant_id = o.id
                         and le.periode = date_trunc('month', current_date)::date) end,
           coalesce(v_titulaire, false)
      from identity.organizations o
     where o.id = p_tenant
        or (v_titulaire
            and o.id in (select lo.tenant_id from facturation.licence_organisations lo
                          where lo.licence_id = v_licence))
     -- La société ouverte d'abord : c'est d'elle que parle l'écran.
     order by (o.id <> p_tenant), o.name, o.id;
end
$$;
revoke all on function public.licence_organisations_de(uuid) from public, anon;
grant execute on function public.licence_organisations_de(uuid) to authenticated;

comment on function public.licence_organisations_de(uuid) is
  'Les sociétés de la licence qui couvre la société ouverte, et leurs lectures '
  'du mois. La société ouverte y est toujours, en tête. Le titulaire voit toute '
  'sa licence ; un autre membre, la seule société ouverte.';

create or replace function public.licence_sieges_de(p_tenant uuid)
returns table(user_id uuid, nom text, role text, tenant_id uuid, organisation text, email text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_licence uuid;
  v_titulaire boolean;
begin
  if p_tenant is null or p_tenant not in (select app.member_orgs()) then
    raise exception 'refus.geste.non_permis' using errcode = '42501';
  end if;

  select lo.licence_id, l.titulaire = auth.uid()
    into v_licence, v_titulaire
    from facturation.licence_organisations lo
    join facturation.licences l on l.id = lo.licence_id
   where lo.tenant_id = p_tenant;

  return query
    select m.user_id, p.display_name::text, m.role::text, m.tenant_id, o.name::text,
           app.email_du_membre(m.user_id)::text
      from identity.memberships m
      join identity.organizations o on o.id = m.tenant_id
      left join identity.profiles p on p.user_id = m.user_id
     where (coalesce(v_titulaire, false)
            and m.tenant_id in (select lo.tenant_id from facturation.licence_organisations lo
                                 where lo.licence_id = v_licence))
        or (not coalesce(v_titulaire, false)
            and m.tenant_id = p_tenant
            and app.has_org_role(p_tenant, array['dirigeant']))
     order by (m.tenant_id <> p_tenant), o.name, m.role, p.display_name, m.user_id;
end
$$;
revoke all on function public.licence_sieges_de(uuid) from public, anon;
grant execute on function public.licence_sieges_de(uuid) to authenticated;

comment on function public.licence_sieges_de(uuid) is
  'Les sièges vus depuis la société ouverte : toute la licence pour son '
  'titulaire, la société ouverte pour son dirigeant, rien pour un autre membre.';

commit;
