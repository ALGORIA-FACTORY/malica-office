-- ======================================================================
--  Plus d'une société, seulement avec une offre qui en accueille plusieurs
--  (décision du dirigeant, 15 novembre 2026, sur la revue de #388).
--
--  `create_organization` rattachait la société neuve à une licence de son
--  propriétaire qui avait de la place ; sans place, une licence Basic NEUVE
--  naissait à côté. Le titulaire d'une offre à une société (Basic, Solo, Team)
--  gardait donc deux abonnements au lieu de monter d'offre.
--
--  Désormais, un titulaire dont aucune licence n'accueille une société de plus
--  est refusé (`refus.organisation.offre_multisociete_requise`) : la société
--  n'est pas créée, et l'écran « Ajouter une société » le dit avant le geste.
--  Quelles offres accueillent plusieurs sociétés n'est écrit nulle part ici :
--  c'est `ref.offres.organisations_max` (R4), lu par `licence_d_accueil`.
--  La première société d'une personne, elle, naît toujours avec sa licence.
--
--  `societe_en_plus_devis` le dit à l'écran : `{"offre_multisociete_requise":
--  true}` quand l'appelant est titulaire et qu'aucune licence ne l'accueille.
--
--  Repris de leur définition en vigueur (20261222110000, 20261228100000) ;
--  seule cette branche change. REJEU (R11) : aucune donnée de référence écrite.
-- ======================================================================

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
    -- Plus d'une société, seulement avec une offre qui en accueille plusieurs : un titulaire dont
    -- aucune licence n'a de place (son offre plafonne à une société) ne reçoit PAS une seconde
    -- licence à côté — il monte d'offre d'abord (20261228110000).
    if facturation.societe_rejoint_la_licence_du_dirigeant(v_org, true, 'societe_en_plus') is null
       and exists (select 1 from facturation.droits_v dv where dv.titulaire = v_uid) then
      raise exception 'refus.organisation.offre_multisociete_requise' using errcode = '22023';
    end if;
  end if;
  perform facturation.licence_naitre(v_org, v_uid, null, current_date);

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                              object_id, payload)
  values (v_org, v_uid, 'organization.created', 'identity', 'organizations', v_org,
          jsonb_build_object('kind', p_kind, 'role', v_role));

  return v_org;
end
$function$;

create or replace function public.societe_en_plus_devis()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object(
              'offre', dv.offre_code,
              'organisations', dv.organisations,
              'organisations_incluses', dv.organisations_incluses,
              'prix_organisation_sup', o.prix_organisation_sup)
       from facturation.droits_v dv
       cross join lateral ref.offre_a(dv.offre_code, dv.offre_depuis) o
      where dv.licence_id = facturation.licence_d_accueil(true)),
    -- Titulaire sans licence qui l'accueille : la porte refuserait (create_organization).
    case when exists (select 1 from facturation.droits_v dv where dv.titulaire = auth.uid())
         then jsonb_build_object('offre_multisociete_requise', true) end)
$$;

comment on function public.societe_en_plus_devis() is
  'La licence qui accueillerait une société de plus (la même règle que la porte `create_organization`), son offre, ses sociétés, son inclus et le prix d''une société en plus. {"offre_multisociete_requise": true} : l''appelant est titulaire et aucune de ses licences ne l''accueille (la porte refuserait). Null : la société aura sa propre licence.';

