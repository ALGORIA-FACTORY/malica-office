-- Supprimer une pièce — mais seulement celle qui n'est encore partie nulle part.
--
-- ============================================================== POURQUOI
--
-- Un dirigeant photographie. Parfois c'est raté, parfois c'est un reçu
-- personnel, parfois ce n'est pas une pièce comptable du tout. Il n'avait
-- aucun moyen de l'effacer : rien, côté base ni côté API, ne supprimait une
-- pièce. Le coffre accumulait donc les brouillons sans issue.
--
-- ==================================================== POURQUOI PAS TOUT EFFACER
--
-- Parce qu'une pièce cesse très vite d'être un brouillon.
--
--   socle.ecritures.piece_id   → on delete SET NULL
--   immo.assets.piece_id       → on delete SET NULL
--   stocks.mouvements.piece_id → on delete SET NULL
--   identity.fiches_fiscales   → on delete SET NULL
--
-- Ces liens SURVIVENT à la suppression, en perdant leur pièce. Une écriture
-- comptable sans justificatif est exactement ce qu'un contrôle fiscal cherche,
-- et ce que la règle R7 interdit : on ne fait pas disparaître une trace, on
-- ajoute une écriture qui corrige.
--
-- ============================================================== LA LIMITE
--
-- On supprime une pièce si, et seulement si :
--
--   1. elle n'a PAS été transmise au cabinet (vis = 'personnel') ;
--   2. elle n'est ni proposée, ni comptabilisée, ni retournée ;
--   3. rien d'autre ne s'y accroche — écriture, immobilisation, mouvement de
--      stock, fiche fiscale.
--
-- Les trois sont vérifiées ICI, dans la base. Un écran se contourne ; un
-- déclencheur non.
--
-- Le reste part en cascade : citations, extractions, plan de tokens, articles,
-- versions, conformité. Ils n'ont de sens que par leur pièce.

create or replace function public.capture_piece_supprimer(p_piece uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_vis text;
  v_status text;
  v_chemin text;
begin
  -- `security invoker` : la RLS décide déjà de ce que l'appelant peut voir.
  -- Une pièce d'un autre dossier n'existe tout simplement pas pour lui.
  select p.vis::text, p.status, p.storage_path
    into v_vis, v_status, v_chemin
    from capture.pieces p
   where p.id = p_piece;

  if v_vis is null then
    raise exception 'piece introuvable'
      using errcode = 'no_data_found';
  end if;

  if v_vis <> 'personnel' then
    raise exception 'Cette pièce a été transmise à votre cabinet : elle ne peut plus être supprimée.'
      using errcode = 'check_violation';
  end if;

  if v_status not in ('capturee', 'lue') then
    raise exception 'Cette pièce est engagée dans votre comptabilité : elle ne peut plus être supprimée.'
      using errcode = 'check_violation';
  end if;

  -- La ceinture, en plus des bretelles : un lien peut exister sans que le
  -- statut l'ait suivi. On préfère refuser une suppression légitime que
  -- laisser une écriture sans justificatif.
  if exists (select 1 from socle.ecritures e where e.piece_id = p_piece)
     or exists (select 1 from immo.assets a where a.piece_id = p_piece)
     or exists (select 1 from stocks.mouvements m where m.piece_id = p_piece)
     or exists (select 1 from identity.fiches_fiscales f where f.piece_id = p_piece)
  then
    raise exception 'Cette pièce sert de justificatif : elle ne peut plus être supprimée.'
      using errcode = 'check_violation';
  end if;

  delete from capture.pieces where id = p_piece;

  return true;
end;
$$;

comment on function public.capture_piece_supprimer(uuid) is
  'Supprime une pièce non transmise et non engagée. Refuse dans tous les autres cas.';

revoke all on function public.capture_piece_supprimer(uuid) from public;
grant execute on function public.capture_piece_supprimer(uuid) to authenticated;
