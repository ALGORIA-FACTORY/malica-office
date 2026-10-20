-- Les gardes de la saisie (20 octobre 2026).
--
-- Recette PME :
--   1. un nom de société fait d'espaces rendait une erreur interne (500) ;
--   2. reprendre l'inscription après l'avoir quittée créait un DOUBLON de la
--      société — et, depuis `20261022290000`, le second essai serait refusé
--      par « Demandez l'accès à son dirigeant » alors que la personne EST le
--      dirigeant ;
--   3. une pièce comptabilisée, restée dans la société (`entite`, PME
--      autonome), pouvait passer en espace personnel : l'écriture restait aux
--      livres, la pièce qui la justifie quittait la société.
--
-- Réponses :
--   1. le nom est nettoyé ; vide, il est refusé avec un motif lisible (22023) ;
--   2. si la personne est déjà membre d'une société ACTIVE qui porte ce
--      matricule, `create_organization` rend CETTE société au lieu d'en créer
--      une autre — reprendre une inscription n'est pas en créer une seconde ;
--   3. une pièce comptabilisée ou supervisée ne va plus jamais en personnel,
--      d'où qu'elle vienne.
--
-- REJEU (R11) : `create or replace`.

begin;

create or replace function public.create_organization(
  p_kind text, p_name text,
  p_validation_mode app.validation_mode_t default 'mandate'::app.validation_mode_t,
  p_legal_id text default null, p_jurisdiction text default null, p_currency text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid  uuid := auth.uid();
  v_org  uuid;
  v_role text;
  v_refus text;
begin
  if v_uid is null then
    raise exception 'authentification requise' using errcode = '42501';
  end if;
  if p_kind not in ('pme','cabinet') then
    raise exception 'kind invalide' using errcode = '22023';
  end if;

  -- Un nom fait d'espaces n'est pas un nom.
  p_name := nullif(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), '');
  if p_name is null then
    raise exception 'Le nom de la société est requis.' using errcode = '22023',
      hint = 'organisation.nom_requis';
  end if;

  -- À juridiction connue, la devise se déduit du pack : pas de constante ici.
  if p_jurisdiction is null then
    raise exception 'juridiction requise' using errcode = '22023';
  end if;
  if p_currency is null then
    select p.currency into p_currency
      from ref.jurisdiction_packs p
     where p.jurisdiction = p_jurisdiction
       and p.effective_from <= current_date
     order by p.effective_from desc
     limit 1;
    if p_currency is null then
      raise exception 'aucun pack en vigueur pour la juridiction %', p_jurisdiction
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

  -- Une PME naît avec sa licence ; un cabinet n'en a pas (rend vide, sans lever).
  perform facturation.licence_naitre(v_org, v_uid, null, current_date);

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                              object_id, payload)
  values (v_org, v_uid, 'organization.created', 'identity', 'organizations', v_org,
          jsonb_build_object('kind', p_kind, 'role', v_role));

  return v_org;
end
$function$;

create or replace function public.capture_piece_set_vis(
  p_piece uuid, p_vis app.vis_t, p_par_accord boolean default false)
returns jsonb
language plpgsql
set search_path = ''
as $function$
declare
  v_tenant uuid;
  v_old    app.vis_t;
  v_status text;
  v_auteur uuid;
begin
  select tenant_id, vis, status, created_by
    into v_tenant, v_old, v_status, v_auteur
    from capture.pieces where id = p_piece for update;
  if v_tenant is null then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;
  if v_old = p_vis then
    return jsonb_build_object('piece_id', p_piece, 'vis', p_vis, 'changed', false);
  end if;

  -- Une pièce qui justifie une écriture ne va pas en espace personnel, d'où
  -- qu'elle vienne (recette du 20 octobre 2026 : depuis `entite`, elle y
  -- allait). Comptabilisée par le statut, ou par une écriture vivante.
  if p_vis = 'personnel'::app.vis_t
     and (v_status in ('comptabilisee','supervisee')
          or exists (select 1 from socle.ecritures e
                      where e.piece_id = p_piece and e.status = 'booked'
                        and e.reverses_id is null
                        and not exists (select 1 from socle.ecritures r
                                         where r.reverses_id = e.id and r.status = 'booked')))
  then
    raise exception 'une piece comptabilisee reste dans la societe' using errcode = 'check_violation';
  end if;

  -- Quitter `partage`, c'est retirer au cabinet ce qu'il a reçu.
  if v_old = 'partage'::app.vis_t then
    if v_status in ('comptabilisee','supervisee') then
      raise exception 'une piece comptabilisee reste partagee' using errcode = 'check_violation';
    end if;
    -- L'accord se dérive de la donnée, pas d'un drapeau.
    if not app.accord_donne(p_piece, 'rappel') then
      raise exception 'une piece transmise ne revient que par accord du cabinet'
        using errcode = 'check_violation';
    end if;
  end if;

  -- Après la capture, sortir une pièce de la société relève du propriétaire.
  if p_vis = 'personnel'::app.vis_t
     and v_old = 'entite'::app.vis_t
     and not app.has_org_role(v_tenant, array['dirigeant'])
  then
    raise exception 'sortir une piece de la societe releve du proprietaire'
      using errcode = 'check_violation';
  end if;

  update capture.pieces
     set vis = p_vis,
         -- Seul `partage` est une transmission.
         transmise_le = case when p_vis = 'partage'::app.vis_t then now() else null end,
         -- La décision de la garder est à reprendre.
         gardee_le = null,
         updated_at = now()
   where id = p_piece;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'piece.vis_changed', 'capture', 'pieces', p_piece,
          jsonb_build_object('from', v_old, 'to', p_vis, 'status', v_status,
                             'par_accord', p_par_accord, 'auteur', v_auteur));

  if p_vis = 'partage'::app.vis_t then
    insert into collab.notifications (tenant_id, kind, payload)
    values (v_tenant, 'piece.partagee', jsonb_build_object('piece_id', p_piece));
  elsif p_vis = 'entite'::app.vis_t then
    insert into collab.notifications (tenant_id, kind, payload)
    values (v_tenant, 'piece.a_valider',
            jsonb_build_object('piece_id', p_piece, 'auteur', v_auteur));
  end if;

  return jsonb_build_object('piece_id', p_piece, 'vis', p_vis, 'changed', true);
end
$function$;

commit;
