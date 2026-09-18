-- 3B-2 et suite — La lecture se journalise, et la pièce se juge.
--
-- Trois dettes du scan, relevées le 11 septembre (20260911160000) et dans
-- l'état des lieux (D9) :
--   • le MODE d'extraction (couche de texte d'un PDF, vision Qwen, PDF scanné)
--     n'était gardé nulle part — seulement dans la réponse HTTP ;
--   • `capture.extractions.confiance_par_champ` restait « {} » : la colonne et
--     sa contrainte existaient, personne ne les remplissait ;
--   • l'événement d'audit `piece.read` avait disparu dans la réécriture du
--     8 septembre : on ne savait plus qui avait lu quoi.
--
-- Et ce qui manquait pour juger une pièce : un endroit où poser la
-- normalisation des montants, les contrôles motivés et le verdict — append-only,
-- comme la lecture elle-même.
--
-- Ajouts seulement : deux colonnes facultatives, une table, trois paramètres
-- datés ; `capture_read_persist` garde ses six premiers paramètres, et les
-- appels existants continuent de fonctionner.

-- --- 1. Le mode d'extraction ----------------------------------------------------------------
alter table capture.extractions add column if not exists mode_lecture text;
comment on column capture.extractions.mode_lecture is
  'Comment la pièce a été relevée : pdf-text (couche de texte, sans modèle), le modèle de vision, ou le modèle de vision sur PDF scanné.';

-- --- 2. La lecture persistée, avec son mode, sa confiance par champ, et son audit ---------
-- Corps repris de 20260908120000 ; ajouts : p_mode, p_confiance, et l'événement
-- `piece.read`. La signature change (deux paramètres à défaut) : l'ancienne est
-- retirée pour qu'aucun appel à six arguments ne tombe sur une ambiguïté.
drop function if exists public.capture_read_persist(uuid, jsonb, text, jsonb, jsonb, jsonb);

create or replace function public.capture_read_persist(
  p_piece uuid,
  p_tokens jsonb,
  p_contract text,
  p_extract jsonb,
  p_citations jsonb,
  p_flags jsonb default '[]'::jsonb,
  p_mode text default null,
  p_confiance jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
set search_path to ''
as $function$
declare
  v_tenant uuid;
  v_tok jsonb;
  v_cit jsonb;
  v_token_id uuid;
  v_count int := 0;
  v_kind text;
  v_extraction uuid;
begin
  select tenant_id into v_tenant from capture.pieces where id = p_piece;
  if v_tenant is null then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;
  -- R7 : une lecture est un fait. On ne la remplace pas.
  if exists (select 1 from capture.extractions where piece_id = p_piece) then
    raise exception 'R7 : cette piece a deja ete lue — rephotographiez-la pour en creer une nouvelle'
      using errcode = 'restrict_violation';
  end if;
  for v_tok in select * from jsonb_array_elements(p_tokens)
  loop
    insert into capture.token_plan (tenant_id, piece_id, page, ordinal, text,
                                    x0, y0, x1, y1, confidence)
    values (v_tenant, p_piece,
            (v_tok->>'page')::smallint, (v_tok->>'ordinal')::int, v_tok->>'text',
            (v_tok->>'x0')::numeric, (v_tok->>'y0')::numeric,
            (v_tok->>'x1')::numeric, (v_tok->>'y1')::numeric,
            nullif(v_tok->>'confidence','')::numeric);
  end loop;
  for v_cit in select * from jsonb_array_elements(p_citations)
  loop
    select t.id into v_token_id
      from capture.token_plan t
     where t.piece_id = p_piece
       and t.page = (v_cit->>'page')::smallint
       and t.ordinal = (v_cit->>'ordinal')::int;
    if v_token_id is null then
      raise exception 'R2 : citation orpheline pour le champ % — aucun token lu a cet emplacement',
        v_cit->>'field' using errcode = 'check_violation';
    end if;
    insert into capture.citations (tenant_id, piece_id, field, token_id, page, bbox, zone,
                                   ui_field, ui_role, bbox_page_px)
    select v_tenant, p_piece, v_cit->>'field', v_token_id, t.page,
           jsonb_build_object('x0', t.x0, 'y0', t.y0, 'x1', t.x1, 'y1', t.y1),
           nullif(v_cit->>'zone',''),
           nullif(v_cit->>'ui_field',''),
           nullif(v_cit->>'ui_role',''),
           case when v_cit ? 'bbox' then v_cit->'bbox' else null end
      from capture.token_plan t where t.id = v_token_id;
    v_count := v_count + 1;
  end loop;
  insert into capture.extractions (tenant_id, piece_id, contract, payload, flags,
                                   mode_lecture, confiance_par_champ)
  values (v_tenant, p_piece, p_contract, p_extract, p_flags,
          nullif(trim(coalesce(p_mode, '')), ''), coalesce(p_confiance, '{}'::jsonb))
  returning id into v_extraction;

  -- Le type lu, s'il fait partie du vocabulaire, monte sur la pièce : lu,
  -- pas encore confirmé. Un type déjà confirmé par la personne n'est jamais
  -- écrasé par une lecture.
  select t.code into v_kind
    from ref.document_types t
   where t.code = p_extract->>'document_kind';

  update capture.pieces
     set status = case when status in ('capturee','retournee') then 'lue' else status end,
         document_kind = case when document_kind_statut = 'confirme' then document_kind
                              else coalesce(v_kind, document_kind) end,
         document_kind_statut = case when document_kind_statut = 'confirme' then 'confirme'
                                     when v_kind is not null then 'a_confirmer'
                                     else document_kind_statut end,
         updated_at = now()
   where id = p_piece;

  -- Qui a lu quoi, comment : l'audit de la lecture, rétabli.
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'piece.read', 'capture', 'extractions', v_extraction,
          jsonb_build_object('piece', p_piece, 'contract', p_contract,
                             'mode', nullif(trim(coalesce(p_mode, '')), ''),
                             'citations', v_count,
                             'flags', jsonb_array_length(coalesce(p_flags, '[]'::jsonb))));

  return jsonb_build_object('piece_id', p_piece, 'citations', v_count,
                            'document_kind', v_kind, 'extraction_id', v_extraction);
end
$function$;

revoke all on function public.capture_read_persist(uuid, jsonb, text, jsonb, jsonb, jsonb, text, jsonb)
  from public, anon;
grant execute on function public.capture_read_persist(uuid, jsonb, text, jsonb, jsonb, jsonb, text, jsonb)
  to authenticated;

-- --- 3. Les seuils de la lecture, sortis du code ----------------------------------------
-- 0,7 et 0,4 étaient écrits en dur dans le navigateur (propose-ecriture.ts) ;
-- une unité mineure d'arrondi y était déduite des décimales. Mêmes valeurs,
-- désormais datées et lues par le serveur.
insert into ref.socle_params (pack_version_id, code, value_text, value_num, legal_reference, valid_from)
select p.id, s.code, null, s.vnum, s.ref, date '2026-01-01'
from ref.jurisdiction_packs p,
  (values
    ('lecture.confiance_reserve',        0.7::numeric, 'Convention de lecture — sous ce seuil, un champ est à relire'),
    ('lecture.confiance_bloquante',      0.4::numeric, 'Convention de lecture — sous ce seuil, la lecture est une anomalie'),
    ('lecture.tolerance_arrondi_mineure', 1::numeric,  'Convention de lecture — écart d''arrondi admis, en unités mineures')
  ) as s(code, vnum, ref)
where p.jurisdiction = 'TN' and p.version = '2026.1'
on conflict (pack_version_id, code, valid_from) do nothing;

-- --- 4. Le jugement d'une pièce ---------------------------------------------------------
-- Une analyse par lecture et par passage : la normalisation des montants, les
-- contrôles motivés, le verdict et ses motifs. Append-only : un nouveau passage
-- s'ajoute, le dernier fait foi.
create table if not exists capture.analyses (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references identity.organizations(id) on delete cascade,
  piece_id        uuid not null references capture.pieces(id) on delete cascade,
  extraction_id   uuid not null references capture.extractions(id) on delete cascade,
  pack_version_id uuid not null references ref.jurisdiction_packs(id),
  normalisation   jsonb not null,
  controles       jsonb not null,
  verdict         text not null,
  motifs          jsonb not null,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  constraint analyses_verdict_connu check (verdict in (
    'à comptabiliser', 'à comptabiliser avec réserve', 'à rapprocher',
    'à rejeter', 'anomalie à signaler')),
  -- Un verdict sans justification est un bug : la base le refuse aussi.
  constraint analyses_verdict_motive check (
    jsonb_typeof(motifs) = 'array' and jsonb_array_length(motifs) > 0),
  constraint analyses_controles_liste check (
    jsonb_typeof(controles) = 'array' and jsonb_array_length(controles) > 0)
);
create index if not exists analyses_piece_idx on capture.analyses (piece_id, created_at desc);

select app.enable_tenant_rls('capture', 'analyses', false, true);
revoke all on table capture.analyses from public, anon, service_role;
grant select, insert on table capture.analyses to authenticated;

drop trigger if exists capture_analyses_no_upd on capture.analyses;
create trigger capture_analyses_no_upd
  before delete or update on capture.analyses
  for each row execute function app.deny_mutation_hors_effacement_de_piece();
