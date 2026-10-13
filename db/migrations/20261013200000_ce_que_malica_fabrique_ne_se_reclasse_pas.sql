-- Ce que Malica fabrique ne se reclasse pas.
--
-- ================================================= LE DÉFAUT QUI L'A FAIT NAÎTRE
--
-- 13 octobre 2026. Le dirigeant : « le reçu ne se génère pas ». Il se
-- générait. Trois reçus sont en base — `91243f02`, `f88e32fc`, `c6e40a3e` —
-- rendus, déposés, et leur contenu le dit mot pour mot : « Reçu de dépense ·
-- ALGORIA FACTORY SUARL · Total payé 3 939,220 TND ».
--
-- Ce qui a échoué vient après. Le reçu a été envoyé à la lecture comme
-- n'importe quelle photo, et il en est revenu classé `facture_vente`.
--
-- Deux conséquences, et la seconde est grave :
--
--   — il réapparaissait dans la liste comme un document à classer, sous
--     « Émetteur non trouvé », et personne ne comprenait d'où il sortait ;
--   — un reçu compté comme une VENTE double le chiffre d'affaires.
--
-- ============================================================ LA CAUSE EXACTE
--
-- `capture_piece_register` inscrit le type déclaré avec le statut
-- `a_confirmer`, et la lecture a le droit de remplacer un type tant qu'il
-- n'est pas `confirme`. Cette règle est juste pour une PHOTO : la personne
-- déclare « une facture », la lecture voit un relevé bancaire, et la lecture
-- a raison.
--
-- Elle est fausse pour ce que le logiciel a lui-même fabriqué. Malica n'a pas
-- à confirmer ce qu'elle vient de dessiner, et aucun modèle ne lui apprendra
-- ce qu'elle savait déjà.
--
-- ========================================================= LA RÈGLE AJOUTÉE
--
-- Une pièce DÉRIVÉE — celle qui sait de quelle autre elle vient — et dont le
-- type est déclaré naît `confirme`. C'est le cas du reçu, et c'est aussi le
-- cas du talon de chèque photographié : dans les deux cas, ce n'est pas une
-- supposition à vérifier, c'est un fait connu à l'instant du dépôt.
--
-- Une pièce sans parent ne change pas : elle reste `a_confirmer`, et la
-- lecture garde le dernier mot. Tout le reste de cette fonction est repris
-- mot pour mot de `20261012140000` — une seule expression change.

begin;

create or replace function public.capture_piece_register(
  p_tenant uuid,
  p_source text,
  p_storage_path text,
  p_idempotency_key text,
  p_entity uuid default null,
  p_vis app.vis_t default 'partage',
  p_sha256 text default null,
  p_page_count smallint default null,
  p_document_kind text default null,
  p_source_piece uuid default null
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_tenant_source uuid;
begin
  if p_document_kind is not null
     and not exists (select 1 from ref.document_types d where d.code = p_document_kind) then
    raise exception 'type de document inconnu au referentiel : %', p_document_kind
      using errcode = 'foreign_key_violation';
  end if;

  -- La pièce source doit être du MÊME dossier. Sinon le lien pointerait hors
  -- du dossier et la RLS rendrait un reçu orphelin sans dire pourquoi.
  if p_source_piece is not null then
    select tenant_id into v_tenant_source from capture.pieces where id = p_source_piece;
    if v_tenant_source is null or v_tenant_source <> p_tenant then
      raise exception 'piece source introuvable ou non autorisee dans ce dossier'
        using errcode = '42501';
    end if;
  end if;

  insert into capture.pieces (tenant_id, entity_id, vis, source, storage_path,
                              sha256, page_count, idempotency_key,
                              document_kind, document_kind_statut, source_piece_id)
  values (p_tenant, p_entity, p_vis, p_source, p_storage_path,
          p_sha256, p_page_count, p_idempotency_key,
          p_document_kind,
          -- LA SEULE LIGNE QUI CHANGE, et toute la correction tient ici.
          --
          -- Sans type déclaré : à déterminer, la lecture tranchera.
          -- Type déclaré sur une pièce DÉRIVÉE : confirmé — Malica l'a faite.
          -- Type déclaré sur une pièce autonome : à confirmer, et la lecture
          -- a le dernier mot, parce qu'une personne qui déclare « une
          -- facture » devant un relevé bancaire se trompe de bonne foi.
          case
            when p_document_kind is null then 'a_determiner'
            when p_source_piece is not null then 'confirme'
            else 'a_confirmer'
          end,
          p_source_piece)
  on conflict (tenant_id, idempotency_key) do update
     set updated_at = now()
  returning id into v_id;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (p_tenant, auth.uid(), 'piece.captured', 'capture', 'pieces', v_id,
          jsonb_build_object('source', p_source, 'document_kind', p_document_kind,
                             'source_piece_id', p_source_piece));

  return v_id;
end
$$;

comment on function public.capture_piece_register(uuid, text, text, text, uuid, app.vis_t, text, smallint, text, uuid) is
  'Inscrit une piece. Le type declare d''une piece DERIVEE naît confirme : '
  'Malica n''a pas a confirmer ce qu''elle vient de fabriquer, et la lecture '
  'ne peut donc plus reclasser un recu en facture de vente.';

commit;
