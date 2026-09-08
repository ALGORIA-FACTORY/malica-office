-- Une pièce LUE ne s'efface pas — et il faut le dire, pas le subir.
--
-- ============================================================== CE QUI SE PASSAIT
--
-- `capture_piece_supprimer` vérifiait la transmission, le statut et les liens
-- comptables. Elle laissait ensuite la cascade faire son travail. Or le plan de
-- tokens est protégé :
--
--   capture_token_plan_no_upd  BEFORE DELETE OR UPDATE ON capture.token_plan
--                              EXECUTE FUNCTION app.deny_mutation()
--
-- La suppression d'une pièce lue butait donc sur ce déclencheur, l'API rendait
-- « erreur interne », et l'utilisateur n'apprenait rien. Un refus qu'on ne
-- comprend pas est vécu comme une panne.
--
-- ============================================================== POURQUOI CE REFUS
--
-- Le plan de tokens EST la preuve de ce que Malica a lu sur la pièce : chaque
-- mot, sa position, et les citations qui s'y accrochent. C'est ce qui permet,
-- des mois plus tard, de montrer d'où venait un montant. L'effacer reviendrait
-- à retirer la pièce justificative d'un raisonnement déjà tenu — exactement ce
-- que R7 interdit : une correction est une écriture nouvelle, jamais une
-- disparition.
--
-- La règle ne change pas. Ce qui change, c'est qu'on l'ANNONCE, avec la phrase
-- que l'utilisateur peut comprendre et le geste qui reste possible : reprendre
-- la photo, et laisser la pièce lue là où elle est.

create or replace function public.capture_piece_supprimer(p_piece uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_vis text;
  v_status text;
begin
  select p.vis::text, p.status
    into v_vis, v_status
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

  if exists (select 1 from socle.ecritures e where e.piece_id = p_piece)
     or exists (select 1 from immo.assets a where a.piece_id = p_piece)
     or exists (select 1 from stocks.mouvements m where m.piece_id = p_piece)
     or exists (select 1 from identity.fiches_fiscales f where f.piece_id = p_piece)
  then
    raise exception 'Cette pièce sert de justificatif : elle ne peut plus être supprimée.'
      using errcode = 'check_violation';
  end if;

  -- Le refus qui manquait, dit AVANT de heurter le déclencheur.
  if exists (select 1 from capture.token_plan tp where tp.piece_id = p_piece) then
    raise exception 'Cette pièce a déjà été lue : ce qui en a été relevé ne s''efface pas. Vous pouvez reprendre la photo.'
      using errcode = 'check_violation';
  end if;

  delete from capture.pieces where id = p_piece;

  return true;
end;
$$;

comment on function public.capture_piece_supprimer(uuid) is
  'Supprime une pièce non transmise, non lue et non engagée. Refuse en disant pourquoi.';

revoke all on function public.capture_piece_supprimer(uuid) from public;
grant execute on function public.capture_piece_supprimer(uuid) to authenticated;
