-- ======================================================================
--  Un propriétaire qui n'est pas titulaire lit ses places (recette du
--  11 novembre 2026, point 3.9).
--
--  Après la transmission du rôle de propriétaire principal, l'ancienne
--  titulaire lisait « Utilisateurs — / — » et une publicité pour Team alors
--  que la société y est déjà : `mon_forfait` ne rendait aux membres que
--  l'offre et les lectures. Un propriétaire (dirigeant d'une société de la
--  licence) reçoit désormais aussi les sociétés et les places — jamais un
--  prix. Un utilisateur, rien de plus qu'avant.
--
--  Repris de sa définition en vigueur ; seule la branche des membres change.
--  REJEU (R11) : aucune donnée de référence écrite.
-- ======================================================================

create or replace function public.mon_forfait(p_tenant uuid DEFAULT NULL::uuid)
 RETURNS TABLE(licence_id uuid, tenant_id uuid, offre text, statut text, lectures_droit integer, lectures_consommees integer, lectures_restantes integer, organisations integer, sieges_occupes integer, sieges_inclus integer, sieges_max integer, prix_mensuel_ht numeric, titulaire boolean, pris_en_charge_par text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_licence uuid;
  v_n       bigint;
  v_choisie record;
  v_proprietaire boolean;
begin
  -- 1. TITULAIRE : la ligne entière — sauf ce que la comptabilité paie pour lui.
  if p_tenant is null then
    select count(*), (array_agg(l.id))[1] into v_n, v_licence
      from facturation.licences l
     where l.titulaire = auth.uid();
  else
    select count(*), (array_agg(l.id))[1] into v_n, v_licence
      from facturation.licences l
      join facturation.licence_organisations lo on lo.licence_id = l.id
     where l.titulaire = auth.uid() and lo.tenant_id = p_tenant;
  end if;

  if v_n > 1 then
    raise exception
      'plusieurs licences pour ce titulaire : precisez l''organisation (public.mon_forfait(p_tenant))'
      using errcode = '21000';
  end if;

  if v_n = 1 then
    select p.offre_code, p.comptabilite, p.offre_depuis into v_choisie
      from facturation.prise_en_charge_de(v_licence) p;
    return query
      select v_licence, p_tenant,
             c.offre_code, c.statut, c.lectures_droit, c.lectures_consommees,
             c.lectures_restantes, c.organisations, c.sieges_occupes,
             c.sieges_inclus::integer, c.sieges_max::integer,
             case
               when v_choisie.offre_code is null then c.prix_mensuel_ht::numeric
               else nullif(greatest(
                      c.prix_mensuel_ht::numeric
                        - coalesce((ref.offre_a(v_choisie.offre_code, v_choisie.offre_depuis)).prix_mensuel_ht::numeric, 0),
                      0), 0)
             end,
             true,
             v_choisie.comptabilite
        from facturation.consommation_v c
       where c.licence_id = v_licence;
    return;
  end if;

  -- 2. MEMBRE d'une organisation rattachée : le nom de l'offre et le compteur
  -- de lectures. Ce qui limite son travail le concerne ; ce que son employeur
  -- paie, non. Un membre de cabinet n'est membre que du cabinet : il ne lit
  -- pas le compteur de sa cliente.
  if p_tenant is null then
    select count(distinct lo.licence_id), (array_agg(distinct lo.licence_id))[1]
      into v_n, v_licence
      from facturation.licence_organisations lo
     where lo.tenant_id in (select app.member_orgs());
  else
    select count(distinct lo.licence_id), (array_agg(distinct lo.licence_id))[1]
      into v_n, v_licence
      from facturation.licence_organisations lo
     where lo.tenant_id = p_tenant
       and lo.tenant_id in (select app.member_orgs());
  end if;

  v_proprietaire := exists (
    select 1 from facturation.licence_organisations lo
     where lo.licence_id = v_licence and app.has_org_role(lo.tenant_id, array['dirigeant']));

  if v_n > 1 then
    raise exception
      'plusieurs licences pour ce membre : precisez l''organisation (public.mon_forfait(p_tenant))'
      using errcode = '21000';
  end if;

  if v_n = 1 then
    -- Un PROPRIÉTAIRE (dirigeant) qui n'est pas le titulaire — un co-propriétaire,
    -- ou l'ancienne titulaire après une transmission — lit aussi les comptes :
    -- sociétés et places. Aucun prix : ce que la licence coûte reste au
    -- titulaire (recette du 11 novembre 2026, 3.9 : « Utilisateurs — / — » et
    -- une offre à vendre alors que la société l'a déjà).
    return query
      select v_licence, p_tenant,
             c.offre_code, null::text, c.lectures_droit, c.lectures_consommees,
             c.lectures_restantes,
             case when v_proprietaire then c.organisations end,
             case when v_proprietaire then c.sieges_occupes end,
             case when v_proprietaire then c.sieges_inclus::integer end,
             case when v_proprietaire then c.sieges_max::integer end,
             null::numeric, false, null::text
        from facturation.consommation_v c
       where c.licence_id = v_licence;
  end if;

  return;
end
$function$;
