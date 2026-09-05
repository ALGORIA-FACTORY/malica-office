-- ============================================================================
-- Une pièce se lit une fois. On ne réécrit pas une lecture, on redépose.
-- ============================================================================
--
-- CE QUI SE PASSAIT AVANT
--
-- Plus aucune pièce ne pouvait être lue. Photographier une facture aboutissait
-- à « droit refusé pour la table citations », et la pièce restait au statut
-- « capturée » pour toujours. L'écran des charges n'affichait rien, la TVA
-- n'avait aucune ligne à montrer, et le cabinet ne recevait jamais de
-- proposition d'écriture.
--
-- CE QUI CAUSAIT CELA
--
-- La fonction de lecture commençait par effacer les relevés de la pièce :
--
--     delete from capture.citations  where piece_id = ...
--     delete from capture.token_plan where piece_id = ...
--
-- Ces deux tables portent la PREUVE de ce qui a été lu : le mot exact relevé
-- sur le papier, et l'endroit précis où il se trouvait. C'est ce qui permet
-- de rouvrir la facture six ans plus tard et de montrer d'où vient chaque
-- montant. Le droit de les effacer leur a donc été retiré, à juste titre.
--
-- Mais l'effacement est resté dans la fonction. Or PostgreSQL vérifie le droit
-- d'effacer AVANT de regarder s'il y a quelque chose à effacer : même sur une
-- pièce jamais lue, où ces deux ordres ne touchent aucune ligne, la lecture
-- était refusée. Le produit se contredisait lui-même.
--
-- CE QUE CETTE MIGRATION FAIT
--
-- Elle retire les deux effacements, et elle dit clairement ce qui se passe
-- quand une pièce a déjà été lue : on refuse, avec un message qui nomme le
-- geste juste. C'est la règle R7 — une correction est une écriture nouvelle.
-- Une facture mal cadrée ne se relit pas par-dessus : on la rephotographie,
-- ce qui crée une nouvelle pièce, et l'ancienne garde sa trace.
--
-- Aucun droit n'est accordé ici. La preuve reste ineffaçable.
-- ============================================================================

create or replace function public.capture_read_persist(
  p_piece uuid,
  p_tokens jsonb,
  p_contract text,
  p_extract jsonb,
  p_citations jsonb,
  p_flags jsonb default '[]'::jsonb
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
begin
  select tenant_id into v_tenant from capture.pieces where id = p_piece;
  if v_tenant is null then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;

  -- R7 : une lecture est un fait. On ne la remplace pas.
  --
  -- Le refus est explicite et il nomme le geste : redéposer la pièce. Un
  -- échec muet, ou pire un écrasement silencieux, ferait disparaître la
  -- preuve de ce qui avait été lu la première fois.
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
end $function$;
