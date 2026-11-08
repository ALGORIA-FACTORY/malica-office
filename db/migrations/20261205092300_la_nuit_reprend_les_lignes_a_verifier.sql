-- La relecture de nuit reprend aussi les LIGNES lues sans preuve.
--
-- ================================================================== POURQUOI
--
-- Décision du dirigeant (5 novembre 2026) : les lignes d'articles qu'aucune somme ne prouve
-- se montrent « lu, non vérifié » le jour ; la nuit les reprend, avec l'autre lecteur (le
-- modèle de vision pour une lecture OCR), et le moteur les prouve au matin — l'IA ne rend
-- jamais de verdict : sa lecture n'est retenue que si la somme des lignes la prouve.
--
-- Jusqu'ici, une relecture n'était inscrite que pour une lecture imparfaite (contrat
-- partiel, arithmétique incohérente), et retenue seulement si sa QUALITÉ montait. Une
-- pièce aux totaux justes mais aux lignes non prouvées n'était jamais relue.
--
-- ================================================================== CE QUI CHANGE
--
-- La consigne d'une relecture (`fabrique.travaux.consigne`) peut porter `lignes` (booléen)
-- : la première lecture laissait des lignes à vérifier. La relecture la lit
-- (`relirePiece`) et retient une lecture dont les lignes sont PROUVÉES, à qualité égale.
--
-- REJEU (R11) : aucune horloge n'écrit dans `ref`.

create or replace function fabrique.relecture_inscrire(p_piece uuid, p_consigne jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v_tenant uuid;
  v_extraction uuid;
  v_lue_le timestamptz;
  v_heures numeric;
  v_id uuid;
  v_pas_avant timestamptz;
begin
  if coalesce(current_setting('malica.origine', true), '') <> 'serveur' then
    raise exception 'refus.reserve.serveur' using errcode = '42501';
  end if;
  select p.tenant_id into v_tenant from capture.pieces p where p.id = p_piece;
  if v_tenant is null or not app.piece_modifiable(p_piece) then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;
  if p_consigne is null or jsonb_typeof(p_consigne) <> 'object'
     or jsonb_typeof(p_consigne -> 'lecteur') is distinct from 'string'
     or jsonb_typeof(p_consigne -> 'paddleTente') is distinct from 'boolean'
     or (p_consigne ? 'lignes'
         and jsonb_typeof(p_consigne -> 'lignes') is distinct from 'boolean') then
    raise exception 'refus.saisie.mal_formee' using errcode = '22023';
  end if;

  select x.id, x.created_at into v_extraction, v_lue_le
    from capture.extractions x
   where x.piece_id = p_piece
   order by x.created_at desc, x.id desc
   limit 1;
  if v_extraction is null then
    raise exception 'refus.relecture.sans_lecture' using errcode = 'check_violation';
  end if;

  v_heures := app.relecture_de_nuit(v_tenant);
  if v_heures is null then
    raise exception 'refus.relecture.coupee' using errcode = 'check_violation';
  end if;
  v_pas_avant := v_lue_le + v_heures * interval '1 hour';

  -- La priorité la plus basse que la file admette (`travaux_priorite_check`,
  -- 1 à 9) : la file se prend par priorité, puis par ancienneté, et une
  -- relecture due depuis la nuit passerait sinon AVANT la lecture d'une pièce
  -- que le client vient de déposer — quinze secondes de modèle de vision par
  -- relecture, devant lui. Ce n'est pas un seuil métier : c'est l'ordre de la
  -- file, et la relecture est par définition ce qui peut attendre.
  insert into fabrique.travaux
    (tenant_id, piece_id, nature, cle_idempotence, priorite, extraction_id, pas_avant, consigne)
  values (v_tenant, p_piece, 'relecture_piece', 'relecture_piece:' || v_extraction::text,
          9, v_extraction, v_pas_avant,
          jsonb_build_object('lecteur', p_consigne -> 'lecteur',
                             'paddleTente', p_consigne -> 'paddleTente')
          || case when p_consigne ? 'lignes'
                  then jsonb_build_object('lignes', p_consigne -> 'lignes') else '{}'::jsonb end)
  on conflict (tenant_id, cle_idempotence) do nothing
  returning id into v_id;
  if v_id is not null then
    return jsonb_build_object('travail_id', v_id, 'deja', false, 'pas_avant', v_pas_avant);
  end if;
  select t.id, t.pas_avant into v_id, v_pas_avant from fabrique.travaux t
   where t.tenant_id = v_tenant and t.cle_idempotence = 'relecture_piece:' || v_extraction::text;
  if v_id is null then
    raise exception 'refus.introuvable.travail' using errcode = '42501';
  end if;
  return jsonb_build_object('travail_id', v_id, 'deja', true, 'pas_avant', v_pas_avant);
end
$$;
