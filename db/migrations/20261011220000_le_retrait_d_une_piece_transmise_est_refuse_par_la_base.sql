-- Le retrait d'une pièce transmise est refusé PAR LA BASE, pas par un écran.
--
-- ================================================================= POURQUOI
--
-- 11 octobre 2026, la règle : « le rappel de la pièce doit être approuvé par
-- le cabinet ». J'ai livré la demande, le bouton PME, puis l'écran du
-- cabinet — et la règle ne tenait toujours que par un FILTRE D'AFFICHAGE.
--
-- `capture_piece_set_vis` n'interdisait `partage → personnel` que pour les
-- statuts `comptabilisee` et `supervisee`. Une pièce `capturee`, `lue`,
-- `proposee` ou `retournee` déjà chez le cabinet pouvait donc en être retirée
-- sans aucun accord — et `pme.coffre.tsx` composait encore explicitement cet
-- appel, masqué seulement parce que sa liste filtre les pièces personnelles.
--
-- Un onglet « tout voir », un filtre modifié, un appel direct : la règle
-- tombait. C'est exactement ce que R6 dit de l'isolation, et c'est vrai de
-- toute règle : **ce que seul l'écran tient n'est pas tenu.**
--
-- =============================================== POURQUOI UN PARAMÈTRE, ET PAS DEUX PORTES
--
-- La tentation serait de laisser `piece_repondre` faire l'écriture lui-même.
-- Ce serait recréer le doublon que `20261011200000` vient de supprimer : deux
-- endroits qui posent `vis` et `transmise_le`, et la prochaine correction
-- irait dans celui qu'on aura sous les yeux.
--
-- Une seule porte, donc, et un paramètre qui dit par quelle autorité on
-- passe. Son défaut est `false` : un appel qui ne dit rien n'a pas d'accord,
-- et l'API publique l'appelle à deux arguments.
--
-- ====================================================== CE QUI RESTE PERMIS
--
--   personnel → partage    toujours, et autant de fois qu'on veut. C'est
--                          l'exemple du commanditaire : « j'ai classé dans
--                          mon coffre, j'aurai toujours la possibilité de
--                          transmettre au cabinet ».
--   partage → personnel    par accord du cabinet seulement.
--   sur une pièce comptabilisée ou supervisée : jamais, accord compris — une
--                          écriture s'appuie dessus.

create or replace function public.capture_piece_set_vis(
  p_piece uuid,
  p_vis app.vis_t,
  -- Vrai uniquement quand l'appel vient de `piece_repondre`, c'est-à-dire
  -- d'un accord du cabinet inscrit et daté. Jamais depuis un écran.
  p_par_accord boolean default false)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_old app.vis_t;
  v_status text;
begin
  select tenant_id, vis, status into v_tenant, v_old, v_status
    from capture.pieces where id = p_piece for update;
  if v_tenant is null then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;
  if v_old = p_vis then
    return jsonb_build_object('piece_id', p_piece, 'vis', p_vis, 'changed', false);
  end if;

  if p_vis = 'personnel'::app.vis_t then
    -- Une écriture s'appuie dessus : même un accord ne la détache pas.
    if v_status in ('comptabilisee','supervisee') then
      raise exception 'une piece comptabilisee reste partagee' using errcode = 'check_violation';
    end if;
    -- Et une pièce que le cabinet a reçue ne se retire pas sans son accord.
    if v_old = 'partage'::app.vis_t and not p_par_accord then
      raise exception 'une piece transmise ne revient que par accord du cabinet'
        using errcode = 'check_violation';
    end if;
  end if;

  update capture.pieces
     set vis = p_vis,
         transmise_le = case when p_vis = 'partage'::app.vis_t then now() else null end,
         updated_at = now()
   where id = p_piece;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'piece.vis_changed', 'capture', 'pieces', p_piece,
          jsonb_build_object('from', v_old, 'to', p_vis, 'status', v_status,
                             'par_accord', p_par_accord));

  if p_vis = 'partage'::app.vis_t then
    insert into collab.notifications (tenant_id, kind, payload)
    values (v_tenant, 'piece.partagee',
            jsonb_build_object('piece_id', p_piece));
  end if;

  return jsonb_build_object('piece_id', p_piece, 'vis', p_vis, 'changed', true);
end
$$;

-- L'ancienne signature à deux arguments disparaît : la laisser vivre à côté
-- rendrait la garde contournable par le simple choix de la surcharge.
drop function if exists public.capture_piece_set_vis(uuid, app.vis_t);

revoke all on function public.capture_piece_set_vis(uuid, app.vis_t, boolean) from public, anon;
grant execute on function public.capture_piece_set_vis(uuid, app.vis_t, boolean) to authenticated;

-- --- L'accord du cabinet est la seule autorité qui lève la garde ------------------------------

create or replace function public.piece_repondre(
  p_piece uuid, p_objet text, p_accorde boolean, p_note text default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_dernier text;
begin
  select tenant_id into v_tenant from capture.pieces where id = p_piece for update;
  if v_tenant is null then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;

  select d.fait into v_dernier
    from collab.demandes_sur_piece d
   where d.piece_id = p_piece and d.objet = p_objet
   order by d.created_at desc limit 1;
  if v_dernier is distinct from 'demandee' then
    raise exception 'aucune demande en attente sur cette piece'
      using errcode = 'check_violation';
  end if;

  insert into collab.demandes_sur_piece (tenant_id, piece_id, objet, fait, note, auteur)
  values (v_tenant, p_piece, p_objet,
          case when p_accorde then 'accordee' else 'refusee' end, p_note, auth.uid());

  if p_accorde and p_objet = 'rappel' then
    perform public.capture_piece_set_vis(p_piece, 'personnel'::app.vis_t, true);
  end if;

  insert into collab.notifications (tenant_id, kind, payload)
  values (v_tenant, 'piece.demande_tranchee',
          jsonb_build_object('piece_id', p_piece, 'objet', p_objet, 'accorde', p_accorde));

  return jsonb_build_object('piece_id', p_piece, 'objet', p_objet, 'accorde', p_accorde);
end
$$;

revoke all on function public.piece_repondre(uuid, text, boolean, text) from public, anon;
grant execute on function public.piece_repondre(uuid, text, boolean, text) to authenticated;

comment on function public.capture_piece_set_vis(uuid, app.vis_t, boolean) is
  'LA SEULE porte par laquelle la visibilité d''une pièce change, et elle pose '
  'la date de transmission dans la même transaction. Le retour d''une pièce '
  'transmise exige `p_par_accord`, que seul `piece_repondre` passe — un accord '
  'du cabinet inscrit et daté. Jusqu''au 11 octobre 2026, la règle ne tenait '
  'que par un filtre d''affichage : ce que seul l''écran tient n''est pas tenu.';
