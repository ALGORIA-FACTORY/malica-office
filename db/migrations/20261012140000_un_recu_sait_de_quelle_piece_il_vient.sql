-- Un reçu sait de quelle pièce il vient.
--
-- ================================================================= POURQUOI
--
-- 10 octobre 2026 : « Malica génère le reçu de dépense ou de revenu », et le
-- 11 : « le cabinet peut faire le download de la facture ou n'importe quel
-- document partagé, aussi du reçu de dépense ou revenu ».
--
-- Un reçu est donc une PIÈCE : même capture, même archive, même chiffrement,
-- même transmission. Il lui manquait seulement de savoir d'où il vient.
--
-- ===================================================== POURQUOI UNE COLONNE
--
-- Un reçu vient d'UNE pièce, et cela ne change jamais : le lien est posé à la
-- naissance et n'est plus touché. Une table de liens serait un historique de
-- quelque chose qui n'a pas d'histoire.
--
-- Elle sert aussi au justificatif de paiement, qui a le même besoin : savoir
-- à quelle facture il appartient sans passer par la table des paiements.
--
-- Sans ce lien, l'écran du cabinet montre un reçu flottant, et personne ne
-- peut dire quelle facture il atteste.

alter table capture.pieces
  add column if not exists source_piece_id uuid references capture.pieces(id) on delete set null;

comment on column capture.pieces.source_piece_id is
  'La pièce dont celle-ci est issue : la facture, pour un reçu de paiement ou '
  'un justificatif. Posée à la naissance et jamais modifiée. Sans elle, le '
  'cabinet voit un reçu flottant et personne ne peut dire ce qu''il atteste.';

-- R6 : l'index mène par `tenant_id`, sans quoi retrouver les pièces filles
-- d'une facture parcourt la table entière, tous tenants confondus.
create index if not exists pieces_source_piece_idx
  on capture.pieces (tenant_id, source_piece_id)
  where source_piece_id is not null;

-- --- La porte de création apprend le lien ------------------------------------------------
--
-- Corps repris de `20261012080000`, un paramètre en plus. Il est en dernier et
-- a un défaut : tous les appels existants restent valables, et une pièce sans
-- parent — le cas courant — n'a rien à dire.

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
          case when p_document_kind is null then 'a_determiner' else 'a_confirmer' end,
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

revoke all on function public.capture_piece_register(uuid, text, text, text, uuid, app.vis_t, text, smallint, text, uuid)
  from public, anon;
grant execute on function public.capture_piece_register(uuid, text, text, text, uuid, app.vis_t, text, smallint, text, uuid)
  to authenticated;

-- L'ancienne signature disparaît : deux surcharges pour une seule porte, et
-- la prochaine correction irait dans celle qu'on aura sous les yeux.
drop function if exists public.capture_piece_register(uuid, text, text, text, uuid, app.vis_t, text, smallint, text);

-- --- La vue -------------------------------------------------------------------------------
--
-- Corps repris de `20261012100000`, une colonne de plus. Une colonne que la
-- vue ne montre pas n'existe pas pour l'application.

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
       gardee_le,
       source_piece_id
  from capture.pieces;

revoke all on table public.pieces_v from public, anon, service_role;
grant select on table public.pieces_v to authenticated;
