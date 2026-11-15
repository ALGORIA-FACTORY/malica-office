-- ======================================================================
--  Une société de plus rejoint la licence de son propriétaire (recette du
--  13 novembre 2026, A3).
--
--  « Ajouter une société » ouvrait l'inscription générique, qui faisait
--  naître une licence Basic NEUVE pour la seconde société : le propriétaire
--  de Premium (« 2 sociétés incluses ») payait deux licences, et « N sur M »
--  comptait une société sur deux.
--
--  La logique de rattachement existait, dans `dirigeant_arrive` (le dirigeant
--  qu'une comptabilité invite). Elle devient UNE fonction, lue par les deux
--  chemins : la société que le propriétaire crée lui-même (au-delà de ce que
--  l'offre comprend, au prix de la société en plus — `ref.offres`, déjà lu
--  par la facturation ; l'offre en fixe le plafond) et celle qui arrive par
--  une invitation (jamais au-delà de l'inclus : l'invitation ne fait pas
--  payer en plus sans qu'on le dise).
--
--  Repris de leur définition en vigueur ; seul le rattachement change.
--  REJEU (R11) : aucune donnée de référence écrite.
-- ======================================================================

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
  -- La licence dont l'appelant est titulaire : d'abord celle qui a de la place dans son inclus,
  -- puis (si demandé) celle dont le plafond de l'offre n'est pas atteint ; la plus haute offre d'abord.
  select dv.licence_id into v_lic
    from facturation.droits_v dv
   where dv.titulaire = auth.uid()
     and (dv.organisations < dv.organisations_incluses
          or (p_au_dela and dv.organisations < coalesce(dv.organisations_max, 2147483647)))
   order by (dv.organisations < dv.organisations_incluses) desc, dv.offre_rang desc nulls last
   limit 1;
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

comment on function facturation.societe_rejoint_la_licence_du_dirigeant(uuid, boolean, text) is
  'Rattache une société à la licence dont l''appelant est titulaire, si l''offre l''accueille '
  '(dans son inclus ; au-delà seulement si `p_au_dela`, jusqu''à son plafond). Rend la licence, ou null.';

revoke all on function facturation.societe_rejoint_la_licence_du_dirigeant(uuid, boolean, text)
  from public, anon, authenticated;

create or replace function facturation.dirigeant_arrive(p_tenant uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_lic   uuid;
  v_acces uuid;
begin
  perform facturation.societe_rejoint_la_licence_du_dirigeant(p_tenant, false, 'meme_dirigeant');
  v_lic := facturation.licence_naitre(p_tenant, auth.uid(), null, current_date);
  select a.id into v_acces
    from facturation.acces a
   where a.tenant_id = p_tenant and a.canal = 'cabinet' and a.statut = 'propose';
  if v_acces is null then
    return;
  end if;
  -- Rattachée à une licence qu'une comptabilité paie déjà : la société est
  -- couverte par elle, la proposition à part se retire (pas de double facture).
  if exists (select 1 from facturation.acces a
              where a.licence_id = v_lic and a.statut = 'actif' and a.canal = 'cabinet') then
    update facturation.acces
       set statut = 'termine', effet_du = current_date, effet_au = current_date,
           motif_fin = 'retrait_cabinet'
     where id = v_acces;
    return;
  end if;
  perform public.acces_repondre(v_acces, true);
end
$function$;

create or replace function public.create_organization(p_kind text, p_name text, p_validation_mode app.validation_mode_t DEFAULT 'mandate'::app.validation_mode_t, p_legal_id text DEFAULT NULL::text, p_jurisdiction text DEFAULT NULL::text, p_currency text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid  uuid := auth.uid();
  v_org  uuid;
  v_role text;
  v_refus text;
begin
  if v_uid is null then
    raise exception 'refus.authentification_requise' using errcode = '42501';
  end if;
  if p_kind not in ('pme','cabinet') then
    raise exception 'refus.organisation.type_inconnu' using errcode = '22023';
  end if;

  -- Un nom fait d'espaces n'est pas un nom.
  p_name := nullif(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), '');
  if p_name is null then
    raise exception 'refus.dossier.raison_sociale_requise' using errcode = '22023',
      hint = 'organisation.nom_requis';
  end if;

  -- À juridiction connue, la devise se déduit du pack : pas de constante ici.
  if p_jurisdiction is null then
    raise exception 'refus.organisation.juridiction_requise' using errcode = '22023';
  end if;
  if p_currency is null then
    select p.currency into p_currency
      from ref.jurisdiction_packs p
     where p.jurisdiction = p_jurisdiction
       and p.effective_from <= current_date
     order by p.effective_from desc
     limit 1;
    if p_currency is null then
      raise exception 'refus.referentiel.pack_absent'
        using errcode = '22023';
    end if;
  end if;

  -- Les espaces autour viennent du copier-coller : on nettoie, on ne refuse pas.
  p_legal_id := nullif(btrim(coalesce(p_legal_id, '')), '');

  v_refus := public.identifiant_verifier(p_jurisdiction, 'matricule_fiscal', p_legal_id);
  if v_refus is not null then
    raise exception '%', v_refus using errcode = '22023';
  end if;

  -- On accepte large, on range net : la pièce imprime des capitales.
  p_legal_id := upper(p_legal_id);

  -- Reprendre une inscription n'est pas créer une seconde société : si la
  -- personne est déjà membre d'une société active qui porte ce matricule,
  -- c'est celle-là.
  if p_legal_id is not null then
    select o.id into v_org
      from identity.organizations o
      join identity.memberships m on m.tenant_id = o.id and m.user_id = v_uid
     where o.jurisdiction = p_jurisdiction
       and upper(o.legal_id) = p_legal_id
       and o.kind = p_kind
       and o.archived_at is null
     order by o.created_at
     limit 1;
    if v_org is not null then
      return v_org;
    end if;
  end if;

  insert into identity.organizations (kind, name, legal_id, jurisdiction, currency,
                                      validation_mode, created_by)
  values (p_kind, p_name, p_legal_id, p_jurisdiction, p_currency,
          p_validation_mode, v_uid)
  returning id into v_org;

  v_role := case when p_kind = 'cabinet' then 'expert' else 'dirigeant' end;

  insert into identity.memberships (tenant_id, user_id, role)
  values (v_org, v_uid, v_role);

  -- Une PME de plus du même propriétaire rejoint SA licence (et la paie au prix de la société en
  -- plus au-delà de ce que l'offre comprend) ; sans licence qui l'accueille, une licence naît.
  -- Un cabinet n'en a pas (rend vide, sans lever).
  if p_kind = 'pme' then
    perform facturation.societe_rejoint_la_licence_du_dirigeant(v_org, true, 'societe_en_plus');
  end if;
  perform facturation.licence_naitre(v_org, v_uid, null, current_date);

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                              object_id, payload)
  values (v_org, v_uid, 'organization.created', 'identity', 'organizations', v_org,
          jsonb_build_object('kind', p_kind, 'role', v_role));

  return v_org;
end
$function$;
