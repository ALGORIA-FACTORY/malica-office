-- Rien ne s'inscrit sous un rappel en attente (décision du 29 octobre 2026).
--
-- « Rappeler et inscrire se contredisent » ne visait que l'écriture de la
-- FACTURE : un règlement s'inscrivait sous un rappel en attente, et un rappel
-- accordé ensuite sortait du cabinet une pièce qu'une écriture vivante porte.
--   1. sous un rappel en attente sur la pièce — n'importe laquelle de ses
--      versions —, AUCUNE écriture rattachée ne se propose ni ne s'inscrit,
--      règlements compris ; une contre-passation reste permise ;
--   2. une pièce qu'une écriture vivante porte (toutes versions) ne quitte pas
--      le cabinet, même sur accord : le rappel ne s'accorde pas.

CREATE OR REPLACE FUNCTION app.pas_d_inscription_sous_rappel()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.piece_id is not null
     and new.reverses_id is null
     and (tg_op = 'INSERT' or (old.status = 'proposee' and new.status = 'booked'))
     and exists (
       select 1 from app.versions_de_la_piece(new.piece_id) v(id)
        where (select d.fait from collab.demandes_sur_piece d
                where d.piece_id = v.id and d.objet = 'rappel'
                order by d.created_at desc limit 1) = 'demandee') then
    raise exception 'refus.piece.rappelEnAttente' using errcode = 'check_violation';
  end if;
  return new;
end
$function$
;

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
  v_rendue boolean := false;
  v_derive record;
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
                      where e.piece_id in (select app.versions_de_la_piece(p_piece))
                        and e.status = 'booked'
                        and e.reverses_id is null
                        and not exists (select 1 from socle.ecritures r
                                         where r.reverses_id = e.id and r.status = 'booked')))
  then
    raise exception 'une piece comptabilisee reste dans la societe' using errcode = 'check_violation';
  end if;

  -- Défaut de paiement : la garde vit sur la table (déclencheur
  -- `une_piece_transmise_exige_une_licence_active`, à l'insertion ET au
  -- passage en `partage`) — une seule règle, écrite une fois.

  -- Quitter `partage`, c'est retirer au cabinet ce qu'il a reçu : sur son
  -- accord, ou parce qu'il l'a lui-même retournée au client — vers la SOCIÉTÉ
  -- seulement : une pièce retournée ne part jamais dans un espace privé
  -- (décision du 28 octobre 2026).
  if v_old = 'partage'::app.vis_t then
    -- Comptabilisée par le statut, ou par une écriture vivante sur l'une de
    -- ses versions (un règlement inscrit ne fait pas bouger le statut).
    if v_status in ('comptabilisee','supervisee')
       or exists (select 1 from socle.ecritures e
                   where e.piece_id in (select app.versions_de_la_piece(p_piece))
                     and e.status = 'booked'
                     and app.ecriture_vivante(e.id)) then
      raise exception 'une piece comptabilisee reste partagee' using errcode = 'check_violation';
    end if;
    v_rendue := v_status = 'retournee' and p_vis = 'entite'::app.vis_t;
    -- L'accord se dérive de la donnée, pas d'un drapeau.
    if not v_rendue and not app.accord_donne(p_piece, 'rappel') then
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

  -- Le retour est clos : la pièce n'est plus chez le cabinet, ce qu'il avait
  -- proposé sur elle n'a plus d'objet.
  if v_rendue then
    perform app.piece_oublie_ses_propositions(p_piece);
  end if;

  update capture.pieces
     set vis = p_vis,
         -- Seul `partage` est une transmission.
         transmise_le = case when p_vis = 'partage'::app.vis_t then now() else null end,
         -- La décision de la garder est à reprendre.
         gardee_le = null,
         status = case when v_rendue then app.statut_hors_retour(p_piece) else status end,
         updated_at = now()
   where id = p_piece;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'piece.vis_changed', 'capture', 'pieces', p_piece,
          jsonb_build_object('from', v_old, 'to', p_vis, 'status', v_status,
                             'par_accord', p_par_accord, 'auteur', v_auteur));

  -- Ce qui est issu de la pièce (reçu, justificatif) n'est jamais partagé si
  -- elle ne l'est pas : il la suit hors du cabinet. Une pièce dérivée
  -- comptabilisée, si elle existait, resterait.
  --
  -- La pièce, c'est toutes ses versions : les reçus de CHACUNE la suivent. Ses
  -- photos précédentes, elles, n'ont rien à suivre — elles se lisent à travers
  -- la photo courante (`app.piece_lisible`).
  if v_old = 'partage'::app.vis_t then
    for v_derive in
      update capture.pieces
         set vis = p_vis,
             transmise_le = null,
             gardee_le = null,
             updated_at = now()
       where tenant_id = v_tenant
         and source_piece_id in (select app.versions_de_la_piece(p_piece))
         and vis = 'partage'::app.vis_t
         and status not in ('comptabilisee', 'supervisee')
      returning id
    loop
      insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                                   object_id, payload)
      values (v_tenant, auth.uid(), 'piece.vis_changed', 'capture', 'pieces', v_derive.id,
              jsonb_build_object('from', 'partage', 'to', p_vis,
                                 'par_accord', p_par_accord, 'suit_la_source', p_piece));
    end loop;
  end if;

  if p_vis = 'partage'::app.vis_t then
    insert into collab.notifications (tenant_id, kind, payload)
    values (v_tenant, 'piece.partagee', jsonb_build_object('piece_id', p_piece));
  elsif p_vis = 'entite'::app.vis_t and v_old = 'personnel'::app.vis_t then
    insert into collab.notifications (tenant_id, kind, payload)
    values (v_tenant, 'piece.a_valider',
            jsonb_build_object('piece_id', p_piece, 'auteur', v_auteur));
  end if;

  -- Le client garde ce que le cabinet lui avait retourné : le cabinet le sait.
  if v_rendue and not p_par_accord then
    insert into collab.notifications (tenant_id, kind, payload)
    values (v_tenant, 'piece.gardee', jsonb_build_object('piece_id', p_piece, 'vis', p_vis));
  end if;

  return jsonb_build_object('piece_id', p_piece, 'vis', p_vis, 'changed', true);
end
$function$
;

