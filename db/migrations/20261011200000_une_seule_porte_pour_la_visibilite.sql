-- Une seule porte pour la visibilité d'une pièce.
--
-- ============================================= LE DOUBLON QUE J'AI CRÉÉ MOI-MÊME
--
-- `20261011100000` déclare, en toutes lettres :
--
--   « `piece_definir_visibilite` est la SEULE porte par laquelle `vis`
--     change : la date s'y pose, dans la même transaction. Deux écritures
--     séparées finiraient par diverger, et une pièce partagée sans date de
--     transmission disparaîtrait de toutes les déclarations. »
--
-- La phrase était juste. Le nom était faux.
--
-- La vraie porte s'appelle `capture_piece_set_vis`, et elle existe depuis le
-- 25 août. En recopiant son corps, je l'ai réécrite SOUS UN AUTRE NOM — donc
-- j'ai créé une seconde fonction que rien n'appelle, et laissé la première
-- inchangée. Le dépôt portait deux portes, l'application passait par celle
-- que je n'avais pas corrigée.
--
-- Conséquence exacte : AUCUNE transmission faite depuis l'application ne
-- posait de date. La reprise de `20261011180000` masquait le défaut pour les
-- pièces anciennes, et toute pièce transmise ENSUITE serait retombée hors de
-- toute déclaration de TVA.
--
-- Trouvé par l'épreuve `une-piece-partie-revient-par-accord`, qui transmet
-- une pièce par le vrai chemin et vérifie la date. Sans elle, le défaut
-- serait apparu dans un mois, sous la forme d'une TVA inexplicablement vide.
--
-- ===================================================== CE QUE FAIT CETTE MIGRATION
--
--   1. la date part avec le drapeau, DANS LA PORTE RÉELLE ;
--   2. la fonction que j'ai inventée est supprimée — un doublon qu'on garde
--      « au cas où » est une divergence programmée ;
--   3. `piece_repondre` appelle la porte réelle.
--
-- ===================================================================== R11
--
-- Aucune donnée de référence n'est touchée. `now()` est ici le fait
-- lui-même — l'instant où la pièce passe au cabinet — dans le corps d'une
-- fonction, ce que R11 autorise nommément.

-- --- 1. La porte réelle date la transmission --------------------------------------------------
--
-- Corps repris de `20260825223452`, la seule modification étant la date.

create or replace function public.capture_piece_set_vis(
  p_piece uuid, p_vis app.vis_t)
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
  if p_vis = 'personnel'::app.vis_t and v_status in ('comptabilisee','supervisee') then
    raise exception 'une piece comptabilisee reste partagee' using errcode = 'check_violation';
  end if;

  -- La date part avec le drapeau. Un retour chez le dirigeant l'efface : une
  -- pièce revenue n'est transmise nulle part, et la laisser datée la
  -- compterait dans une déclaration qu'elle n'a pas rejointe.
  update capture.pieces
     set vis = p_vis,
         transmise_le = case when p_vis = 'partage'::app.vis_t then now() else null end,
         updated_at = now()
   where id = p_piece;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'piece.vis_changed', 'capture', 'pieces', p_piece,
          jsonb_build_object('from', v_old, 'to', p_vis, 'status', v_status));

  if p_vis = 'partage'::app.vis_t then
    insert into collab.notifications (tenant_id, kind, payload)
    values (v_tenant, 'piece.partagee',
            jsonb_build_object('piece_id', p_piece));
  end if;

  return jsonb_build_object('piece_id', p_piece, 'vis', p_vis, 'changed', true);
end
$$;

revoke all on function public.capture_piece_set_vis(uuid, app.vis_t) from public, anon;
grant execute on function public.capture_piece_set_vis(uuid, app.vis_t) to authenticated;

-- --- 2. L'accord passe par la porte réelle ----------------------------------------------------

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
    perform public.capture_piece_set_vis(p_piece, 'personnel'::app.vis_t);
  end if;

  insert into collab.notifications (tenant_id, kind, payload)
  values (v_tenant, 'piece.demande_tranchee',
          jsonb_build_object('piece_id', p_piece, 'objet', p_objet, 'accorde', p_accorde));

  return jsonb_build_object('piece_id', p_piece, 'objet', p_objet, 'accorde', p_accorde);
end
$$;

revoke all on function public.piece_repondre(uuid, text, boolean, text) from public, anon;
grant execute on function public.piece_repondre(uuid, text, boolean, text) to authenticated;

-- --- 3. Et le doublon disparaît ----------------------------------------------------------------
--
-- Le garder « au cas où » serait garder une divergence programmée : la
-- prochaine correction irait, comme la mienne, dans celle des deux qu'on
-- aura sous les yeux.

drop function if exists public.piece_definir_visibilite(uuid, app.vis_t);

comment on function public.capture_piece_set_vis(uuid, app.vis_t) is
  'LA SEULE porte par laquelle la visibilité d''une pièce change. Elle pose '
  'aussi la date de transmission, dans la même transaction : le drapeau dit '
  'SI, la date dit QUAND, et sans le quand aucune TVA ne peut être rangée. '
  'Le 11 octobre 2026, une seconde fonction avait été écrite à côté — '
  'l''application passait par celle-ci, la correction était dans l''autre, et '
  'plus aucune transmission ne se datait.';
