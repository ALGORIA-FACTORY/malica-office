-- ======================================================================
--  « Ajouter une société » dit la licence qui l'accueillera VRAIMENT
--  (revue de #388).
--
--  L'écran décrivait la licence de la société ouverte ; or la base rattache
--  la société neuve à une licence dont l'appelant est titulaire — d'abord
--  celle qui a de la place dans son inclus, puis la plus haute offre — qui
--  n'est pas forcément celle de la société ouverte. Un propriétaire de Basic
--  qui possède aussi un Premium lisait « sa propre licence » et rejoignait le
--  Premium.
--
--  Le choix sort donc en UNE fonction (`licence_d_accueil`), lue par la porte
--  qui rattache (`societe_rejoint_la_licence_du_dirigeant`) ET par ce que dit
--  l'écran (`public.societe_en_plus_devis`) : une seule règle, deux lecteurs.
--  Le devis ne calcule rien : l'offre, les sociétés, l'inclus et le prix d'une
--  société en plus sont lus dans la licence et dans la grille de son offre.
--
--  REJEU (R11) : `create or replace`, aucune donnée de référence écrite.
-- ======================================================================

create or replace function facturation.licence_d_accueil(p_au_dela boolean)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  -- La licence dont l'appelant est titulaire : d'abord celle qui a de la place dans son inclus,
  -- puis (si demandé) celle dont le plafond de l'offre n'est pas atteint ; la plus haute offre d'abord.
  select dv.licence_id
    from facturation.droits_v dv
   where dv.titulaire = auth.uid()
     and (dv.organisations < dv.organisations_incluses
          or (p_au_dela and dv.organisations < coalesce(dv.organisations_max, 2147483647)))
   order by (dv.organisations < dv.organisations_incluses) desc, dv.offre_rang desc nulls last
   limit 1
$$;

revoke all on function facturation.licence_d_accueil(boolean) from public, anon, authenticated;

comment on function facturation.licence_d_accueil(boolean) is
  'La licence de l''appelant qui accueillerait une société de plus : dans son inclus, puis (si demandé) jusqu''au plafond de l''offre ; la plus haute offre d''abord. Null : aucune, la société aura sa propre licence.';

create or replace function facturation.societe_rejoint_la_licence_du_dirigeant(
  p_tenant uuid, p_au_dela boolean, p_par text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lic uuid;
begin
  select lo.licence_id into v_lic
    from facturation.licence_organisations lo where lo.tenant_id = p_tenant;
  if v_lic is not null then
    return v_lic;   -- déjà rattachée : on ne la déplace pas.
  end if;
  v_lic := facturation.licence_d_accueil(p_au_dela);
  if v_lic is null then
    return null;
  end if;
  insert into facturation.licence_organisations (licence_id, tenant_id)
  values (v_lic, p_tenant);
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (p_tenant, auth.uid(), 'licence.rattachee', 'facturation', 'licences', v_lic,
          jsonb_build_object('par', p_par));
  return v_lic;
end
$$;

create or replace function public.societe_en_plus_devis()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'offre', dv.offre_code,
           'organisations', dv.organisations,
           'organisations_incluses', dv.organisations_incluses,
           'prix_organisation_sup', o.prix_organisation_sup)
    from facturation.droits_v dv
    cross join lateral ref.offre_a(dv.offre_code, dv.offre_depuis) o
   where dv.licence_id = facturation.licence_d_accueil(true)
$$;

revoke all on function public.societe_en_plus_devis() from public, anon;
grant execute on function public.societe_en_plus_devis() to authenticated;

comment on function public.societe_en_plus_devis() is
  'La licence qui accueillerait une société de plus (la même règle que la porte `create_organization`), son offre, ses sociétés, son inclus et le prix d''une société en plus. Null : la société aura sa propre licence.';
