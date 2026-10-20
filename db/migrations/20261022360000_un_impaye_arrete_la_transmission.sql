-- Un défaut de paiement arrête la transmission au cabinet (20 octobre 2026).
--
-- Règle de Wissem Barouni : en défaut de paiement, la lecture s'arrête (déjà
-- tenu par `lecture_verdict` : `licence_<statut>`) ET le dossier ne part
-- plus au cabinet. `capture_piece_set_vis` refuse donc le passage en
-- `partage` tant que la licence de la société n'est pas active. Ce qui est
-- déjà transmis reste au cabinet.
--
-- Une société sans licence (cas d'un cabinet) n'est pas concernée : le
-- `coalesce` à `active` ne bloque que ce que la base sait impayé.
-- Corps repris de la base vivante ; seul ce bloc s'ajoute.
-- REJEU (R11) : `create or replace`.

begin;

CREATE OR REPLACE FUNCTION public.capture_piece_set_vis(p_piece uuid, p_vis app.vis_t, p_par_accord boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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

  -- Défaut de paiement (règle du 20 octobre 2026) : la lecture s'arrête, et
  -- la transmission au cabinet aussi. Ce qui est déjà parti reste parti ;
  -- rien de nouveau ne part tant que la licence n'est pas active.
  if p_vis = 'partage'::app.vis_t
     and coalesce((select c.statut from facturation.licence_organisations lo
                     join facturation.consommation_v c on c.licence_id = lo.licence_id
                    where lo.tenant_id = v_tenant), 'active') <> 'active'
  then
    raise exception 'Transmission suspendue : un paiement de votre abonnement est en retard. Réglez-le pour transmettre de nouveau.'
      using errcode = 'check_violation', hint = 'licence.impayee';
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
