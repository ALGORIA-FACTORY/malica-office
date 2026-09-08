-- ============================================================================
-- Le type de la pièce se confirme.
--
-- POURQUOI
--
-- Le verrou R2 (20260902180000) refuse toute écriture sur une pièce dont le
-- type n'est pas « confirme ». Mais depuis « une précision est une entrée
-- nouvelle » (20260904100000), plus rien ne posait ce statut : la lecture
-- laissait la pièce « a_determiner », et la précision de la personne
-- s'ajoutait à côté sans jamais remonter sur la pièce. Toute pièce capturée
-- depuis le 4 septembre était donc incomptabilisable — le jeu de données le
-- disait à chaque passage (« R2 : le type de la piece n'est pas confirme »),
-- et l'écran du dirigeant l'aurait dit au premier « Oui ».
--
-- CE QUE DIT CETTE MIGRATION
--
-- 1. Une lecture qui reconnaît le type le pose sur la pièce, en
--    « a_confirmer » : Malica a lu, la personne n'a pas encore tranché. Le
--    désignateur ne rend un type que lorsqu'il a reconnu le dossier comme
--    émetteur ou destinataire ; sinon il rend null, et la pièce reste
--    « a_determiner ».
-- 2. La précision de la personne (document_kind) fait foi : elle pose le
--    type et le statut « confirme ». La précision reste une entrée nouvelle,
--    datée et signée ; la pièce en porte le résultat.
-- 3. Les pièces déjà lues avec un type, encore « a_determiner » ou sans
--    type, sont reprises en « a_confirmer » ; celles qui ont une précision
--    passent « confirme ». Rien n'est deviné : seul ce qui a été lu ou dit
--    est repris.
-- ============================================================================

-- ------------------------------------------------ 1. la lecture pose le type
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
  v_kind text;
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
  insert into capture.extractions (tenant_id, piece_id, contract, payload, flags)
  values (v_tenant, p_piece, p_contract, p_extract, p_flags);

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

  return jsonb_build_object('piece_id', p_piece, 'citations', v_count,
                            'document_kind', v_kind);
end
$function$;

-- --------------------------------------- 2. la précision de la personne fait foi
create or replace function public.capture_precision_persist(
  p_piece  uuid,
  p_champ  text,
  p_valeur text
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_status text;
  v_id uuid;
begin
  select tenant_id, status into v_tenant, v_status
    from capture.pieces where id = p_piece for update;
  if v_tenant is null then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;
  if v_status not in ('capturee', 'lue', 'retournee') then
    raise exception 'une piece engagee ne se precise plus : elle se corrige par ecriture'
      using errcode = 'check_violation';
  end if;
  if p_champ = 'document_kind' and p_valeur not in ('facture_achat', 'facture_vente') then
    raise exception 'sens de facture inconnu : %', p_valeur using errcode = 'check_violation';
  end if;
  if p_champ <> 'document_kind' then
    raise exception 'champ non precisable : %', p_champ using errcode = 'check_violation';
  end if;

  insert into capture.precisions (tenant_id, piece_id, champ, valeur)
  values (v_tenant, p_piece, p_champ, p_valeur)
  returning id into v_id;

  -- La personne a tranché : la pièce porte le type, confirmé. C'est ce que
  -- le verrou R2 attend avant toute écriture.
  update capture.pieces
     set document_kind = p_valeur,
         document_kind_statut = 'confirme',
         updated_at = now()
   where id = p_piece;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'piece.precisee', 'capture', 'precisions', v_id,
          jsonb_build_object('piece_id', p_piece, 'champ', p_champ, 'valeur', p_valeur));

  return jsonb_build_object('id', v_id, 'piece_id', p_piece, 'champ', p_champ, 'valeur', p_valeur);
end $$;

revoke all on function public.capture_precision_persist(uuid, text, text) from public, anon;
grant execute on function public.capture_precision_persist(uuid, text, text) to authenticated;

-- ------------------------------------------- 3. la pièce dit son type à l'écran
-- L'écran du dirigeant doit savoir si le type est encore à confirmer : son
-- « Oui » vaut alors confirmation, et la précision est posée avant l'écriture.
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
       document_kind_statut
  from capture.pieces;
grant select on public.pieces_v to authenticated;
revoke delete on public.pieces_v from authenticated;

-- ---------------------------------------------------- 4. la reprise de l'existant
-- Ce qui a été lu avec un type et jamais rangé : lu, à confirmer.
update capture.pieces p
   set document_kind = e.payload->>'document_kind',
       document_kind_statut = 'a_confirmer',
       updated_at = now()
  from capture.extractions e
 where e.piece_id = p.id
   and p.document_kind_statut = 'a_determiner'
   and e.payload->>'document_kind' in (select code from ref.document_types);

-- Ce que la personne a déjà précisé : confirmé, avec sa dernière parole.
update capture.pieces p
   set document_kind = q.valeur,
       document_kind_statut = 'confirme',
       updated_at = now()
  from (
    select distinct on (piece_id) piece_id, valeur
      from capture.precisions
     where champ = 'document_kind'
     order by piece_id, decided_at desc
  ) q
 where q.piece_id = p.id
   and p.document_kind_statut <> 'confirme';
