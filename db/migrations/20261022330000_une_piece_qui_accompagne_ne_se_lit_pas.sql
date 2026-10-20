-- Une pièce qui en accompagne une autre ne se lit pas (20 octobre 2026).
--
-- Recette PME : le reçu généré et le justificatif photographié d'un paiement
-- retombaient dans la file « à lire », étaient lus, consommaient deux
-- lectures, et le reçu était rangé en « facture d'achat ». Un doublon strict
-- d'une pièce déjà lue était lu et décompté lui aussi.
--
-- `lecture_verdict` refuse désormais, AVANT de compter :
--   • `piece_accompagnante` — issue d'une pièce (`source_piece_id`) ou
--     justificatif d'un paiement ;
--   • `piece_en_double` — mêmes octets qu'une pièce déjà lue.
-- `lecture_consommer` s'appuie sur ce verdict : rien n'est décompté.
--
-- Corps repris de la base vivante ; seul le bloc daté du 20 octobre s'ajoute.
-- REJEU (R11) : `create or replace`.

begin;

CREATE OR REPLACE FUNCTION public.lecture_verdict(p_piece uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant   uuid;
  v_vis      app.vis_t;
  v_licence  uuid;
  v_conso    record;
  v_deja     boolean;
  v_recharge integer;
  v_auto     text;
begin
  -- La RLS de `capture.pieces` ne s'applique plus ici : la lisibilité de la
  -- pièce pour l'appelant se demande à la fonction qui la porte.
  if not app.piece_lisible(p_piece) then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;

  select tenant_id, vis into v_tenant, v_vis
    from capture.pieces where id = p_piece;
  if v_tenant is null then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;

  -- B6 : une pièce personnelle n'est jamais lue.
  if v_vis = 'personnel'::app.vis_t then
    return jsonb_build_object(
      'autorisee', false, 'motif', 'piece_personnelle',
      'restantes', null, 'droit', null);
  end if;

  -- 20 octobre 2026 : le reçu qu'on génère et le justificatif d'un paiement
  -- ACCOMPAGNENT une pièce, ils n'en sont pas une. Les lire consommait le
  -- forfait et rangeait le reçu en « facture d'achat ».
  if exists (select 1 from capture.pieces where id = p_piece and source_piece_id is not null)
     or exists (select 1 from capture.paiements where justificatif_piece_id = p_piece)
  then
    return jsonb_build_object(
      'autorisee', false, 'motif', 'piece_accompagnante',
      'restantes', null, 'droit', null);
  end if;

  -- Le doublon strict d'une pièce déjà lue n'apprend rien : même octets,
  -- même lecture. Il ne coûte pas une lecture de plus.
  if exists (select 1 from capture.pieces d
              where d.id = p_piece and d.doublon_de is not null
                and exists (select 1 from facturation.lectures l where l.piece_id = d.doublon_de))
  then
    return jsonb_build_object(
      'autorisee', false, 'motif', 'piece_en_double',
      'restantes', null, 'droit', null);
  end if;

  select licence_id into v_licence
    from facturation.licence_organisations where tenant_id = v_tenant;
  if v_licence is null then
    return jsonb_build_object(
      'autorisee', false, 'motif', 'organisation_sans_licence',
      'restantes', null, 'droit', null);
  end if;

  select * into v_conso from facturation.consommation_v where licence_id = v_licence;
  if v_conso.licence_id is null then
    -- Pas de ligne : on ne sait pas, donc on refuse. Jamais `true` par défaut.
    return jsonb_build_object(
      'autorisee', false, 'motif', 'organisation_sans_licence',
      'restantes', null, 'droit', null);
  end if;

  -- Une pièce déjà comptée se relit sans rien coûter. C'est la correction
  -- gratuite, et c'est volontaire.
  select exists (select 1 from facturation.lectures where piece_id = p_piece)
    into v_deja;
  if v_deja then
    return jsonb_build_object(
      'autorisee', true, 'motif', 'relecture_gratuite',
      'restantes', v_conso.lectures_restantes, 'droit', v_conso.lectures_droit,
      'licence_id', v_licence);
  end if;

  -- Une licence suspendue n'arrête pas la caméra, elle arrête l'œil.
  if v_conso.statut <> 'active' then
    return jsonb_build_object(
      'autorisee', false, 'motif', 'licence_' || v_conso.statut,
      'restantes', v_conso.lectures_restantes, 'droit', v_conso.lectures_droit,
      'licence_id', v_licence);
  end if;

  if v_conso.lectures_restantes <= 0 then
    v_recharge := facturation.recharge_disponible(v_licence);
    if v_recharge > 0 then
      return jsonb_build_object(
        'autorisee', true, 'motif', 'sur_recharge',
        'restantes', 0, 'droit', v_conso.lectures_droit,
        'recharge', v_recharge, 'licence_id', v_licence);
    end if;

    v_auto := facturation.recharge_automatique_possible(v_licence);
    if v_auto is not null then
      return jsonb_build_object(
        'autorisee', true, 'motif', 'recharge_automatique',
        'restantes', 0, 'droit', v_conso.lectures_droit,
        'recharge', 0, 'palier', v_auto, 'licence_id', v_licence);
    end if;

    return jsonb_build_object(
      'autorisee', false, 'motif', 'plafond_atteint',
      'restantes', 0, 'droit', v_conso.lectures_droit,
      'recharge', 0,
      'gelees', (select coalesce(sum(greatest(0, r.restantes)), 0)::int
                   from facturation.recharges_v r
                  where r.licence_id = v_licence and r.gelee),
      'licence_id', v_licence);
  end if;

  return jsonb_build_object(
    'autorisee', true, 'motif', 'dans_le_forfait',
    'restantes', v_conso.lectures_restantes, 'droit', v_conso.lectures_droit,
    'licence_id', v_licence);
end
$function$;

commit;
