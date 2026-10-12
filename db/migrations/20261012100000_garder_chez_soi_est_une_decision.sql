-- Garder une pièce chez soi est une DÉCISION, pas un défaut.
--
-- ================================================================= POURQUOI
--
-- 11 octobre 2026 : « et le choix entre transmettre au cabinet ou espace
-- privé ? S'il n'est pas fait, fais-le. »
--
-- Il ne l'était pas. L'écran de la pièce portait un commentaire affirmant
-- « deux boutons de même poids », et il n'y en avait qu'UN : « Transmettre à
-- {cabinet} », suivi d'une ligne de 12,5 px disant « sinon elle reste chez
-- vous ». Garder n'était pas un choix qu'on fait — c'était ce qui arrivait
-- quand on ne faisait rien.
--
-- ============================================= POURQUOI UNE COLONNE, ET PAS RIEN
--
-- `vis = 'personnel'` ne pouvait pas porter la décision : c'est aussi l'état
-- de départ de toute pièce. L'écran ne pouvait donc pas distinguer « j'ai
-- décidé de la garder » de « je n'ai pas encore répondu », et reposait la
-- question à chaque visite, sur toutes les pièces, pour toujours. Un écran
-- qui redemande ce qu'on vient de lui dire apprend à ne plus répondre.
--
-- La date, et pas un booléen : « qui a décidé quoi, et quand » est la
-- question qu'on pose six mois plus tard, et un `true` n'y répond pas.
--
-- ============================================== CE QUE CETTE PORTE NE FAIT PAS
--
-- Elle ne ferme rien. La règle du commanditaire, mot pour mot : « la seule
-- action qui demande l'autorisation du cabinet est celle d'une pièce
-- transmise ». Une pièce gardée part donc au cabinet quand son dirigeant le
-- veut — « j'ai classé dans mon coffre, j'aurai toujours la possibilité de
-- transmettre au cabinet » — et c'est `capture_piece_set_vis` qui s'en
-- charge, inchangée de ce côté-là.
--
-- En revanche une pièce DÉJÀ transmise ne se « garde » pas : ce serait le
-- retrait unilatéral que la base refuse depuis `20261011220000`, repeint en
-- décision d'espace privé.

alter table capture.pieces
  add column if not exists gardee_le timestamptz;

comment on column capture.pieces.gardee_le is
  'Quand le dirigeant a décidé de garder la pièce chez lui, plutôt que de la '
  'transmettre. NULL signifie « pas encore répondu », et c''est à cela que '
  'l''écran reconnaît qu''il doit poser la question. Remise à NULL si la pièce '
  'part finalement au cabinet : deux dates feraient deux vérités sur un seul fait.';

-- --- La porte -----------------------------------------------------------------------------

create or replace function public.capture_piece_garder(p_piece uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_vis app.vis_t;
  v_deja timestamptz;
begin
  select tenant_id, vis, gardee_le into v_tenant, v_vis, v_deja
    from capture.pieces where id = p_piece for update;
  if v_tenant is null then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;

  -- Le chemin du retour existe, et il passe par l'accord du cabinet. Sans ce
  -- refus, un bouton « garder » contournerait la seule règle qui en exige un.
  if v_vis = 'partage'::app.vis_t then
    raise exception 'une piece transmise ne revient que par accord du cabinet'
      using errcode = 'check_violation';
  end if;

  -- Le doigt ripe, l'écran revient : la date de la décision est celle du jour
  -- où elle a été prise, pas celle du dernier tap.
  if v_deja is not null then
    return jsonb_build_object('piece_id', p_piece, 'gardee_le', v_deja, 'changed', false);
  end if;

  update capture.pieces
     set gardee_le = now(),
         updated_at = now()
   where id = p_piece;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'piece.gardee', 'capture', 'pieces', p_piece,
          jsonb_build_object('vis', v_vis));

  return jsonb_build_object('piece_id', p_piece, 'changed', true);
end
$$;

revoke all on function public.capture_piece_garder(uuid) from public, anon;
grant execute on function public.capture_piece_garder(uuid) to authenticated;

comment on function public.capture_piece_garder(uuid) is
  'Inscrit la décision de garder une pièce dans l''espace privé. Ne change pas '
  'la visibilité : il la CONFIRME, et c''est cette confirmation qui fait taire '
  'la question. Refusée sur une pièce déjà transmise — ce retour-là demande '
  'l''accord du cabinet.';

-- --- Et la porte de la visibilité oublie la décision quand elle la contredit ---------------
--
-- Corps repris de `20261011220000`, à une ligne près : la remise à NULL de
-- `gardee_le` quand la pièce part. La laisser renseignée sur une pièce
-- transmise donnerait deux vérités sur le même fait, et l'écran choisirait
-- celle qu'il a sous les yeux.

create or replace function public.capture_piece_set_vis(
  p_piece uuid,
  p_vis app.vis_t,
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
    if v_status in ('comptabilisee','supervisee') then
      raise exception 'une piece comptabilisee reste partagee' using errcode = 'check_violation';
    end if;
    if v_old = 'partage'::app.vis_t and not p_par_accord then
      raise exception 'une piece transmise ne revient que par accord du cabinet'
        using errcode = 'check_violation';
    end if;
  end if;

  update capture.pieces
     set vis = p_vis,
         transmise_le = case when p_vis = 'partage'::app.vis_t then now() else null end,
         -- Partie au cabinet : elle n'est plus « gardée ». Revenue par accord :
         -- la décision est à reprendre, donc à vide.
         gardee_le = null,
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

revoke all on function public.capture_piece_set_vis(uuid, app.vis_t, boolean) from public, anon;
grant execute on function public.capture_piece_set_vis(uuid, app.vis_t, boolean) to authenticated;

-- --- La vue, sans laquelle la colonne n'existe pas pour l'application ---------------------
--
-- C'est l'oubli exact du 11 octobre sur `transmise_le` : la colonne était là
-- et `pieces_v`, seule porte de lecture, ne la montrait pas. Corps repris de
-- `20261011140000`, une colonne de plus.

create or replace view public.pieces_v with (security_invoker = true) as
select id,
       tenant_id,
       entity_id,
       vis,
       source,
       storage_path,
       sha256,
       page_count,
       status,
       idempotency_key,
       created_by,
       created_at,
       updated_at,
       content_type,
       document_kind,
       document_kind_statut,
       transmise_le,
       -- Quand le dirigeant a décidé de la garder. NULL = question encore ouverte.
       gardee_le
  from capture.pieces;

revoke all on table public.pieces_v from public, anon, service_role;
grant select on table public.pieces_v to authenticated;
