-- 018 — audit de la zone surlignée et du champ confié à l'UI.
alter table capture.citations
  add column if not exists ui_field text,
  add column if not exists ui_role  text
    check (ui_role is null or ui_role in ('montant','texte','date')),
  add column if not exists bbox_page_px jsonb;

create index if not exists citations_ui_field_idx
  on capture.citations (piece_id, ui_field);

drop view if exists public.citations_v;
create view public.citations_v
with (security_invoker = true) as
select id, tenant_id, piece_id, field, token_id, page, bbox, zone,
       ui_field, ui_role, created_at
from capture.citations;

grant select on public.citations_v to authenticated;

create or replace function public.capture_read_persist(
  p_piece uuid,
  p_tokens jsonb,
  p_contract text,
  p_extract jsonb,
  p_citations jsonb,
  p_flags jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_tok jsonb;
  v_cit jsonb;
  v_token_id uuid;
  v_count int := 0;
begin
  select tenant_id into v_tenant from capture.pieces where id = p_piece;
  if v_tenant is null then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;

  delete from capture.citations where piece_id = p_piece;
  delete from capture.token_plan where piece_id = p_piece;

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

  insert into capture.extractions (tenant_id, piece_id, contract, payload, flags)
  values (v_tenant, p_piece, p_contract, p_extract, p_flags);

  update capture.pieces
     set status = case when status in ('capturee','retournee') then 'lue' else status end,
         updated_at = now()
   where id = p_piece;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                              object_id, payload)
  values (v_tenant, auth.uid(), 'piece.read', 'capture', 'pieces', p_piece,
          jsonb_build_object('contract', p_contract, 'citations', v_count,
                             'flags', p_flags));

  return jsonb_build_object('piece_id', p_piece, 'citations', v_count);
end $$;
