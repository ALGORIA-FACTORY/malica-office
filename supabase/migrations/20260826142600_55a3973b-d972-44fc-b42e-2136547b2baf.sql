-- 020 : citations par champ sur les articles projetes + reponses append-only.

alter table capture.piece_articles
  add column if not exists citation_quantity text,
  add column if not exists citation_unit_price_ht text,
  add column if not exists citation_unit_price_ttc text,
  add column if not exists citation_total_ht text;

drop view if exists public.piece_articles_v;
create view public.piece_articles_v
  with (security_invoker = true) as
  select id, tenant_id, piece_id, ordinal, designation, quantity, unit_price_ht,
         unit_price_ttc, total_ht, famille_code, famille_source, period, document_date,
         citation_field, citation_quantity, citation_unit_price_ht,
         citation_unit_price_ttc, citation_total_ht, pack_version_id, vis, created_at
    from capture.piece_articles;

grant select on public.piece_articles_v to authenticated;

create or replace function public.capture_articles_persist(
  p_piece uuid, p_pack uuid, p_document_date date, p_account text, p_articles jsonb)
returns jsonb
language plpgsql
set search_path to ''
as $$
declare
  v_tenant uuid;
  v_entity uuid;
  v_vis app.vis_t;
  v_a jsonb;
  v_i smallint := 0;
  v_fam text;
  v_src text;
  v_idx text;
  v_period text := to_char(coalesce(p_document_date, current_date), 'YYYY-MM');
begin
  select tenant_id, entity_id, vis into v_tenant, v_entity, v_vis
    from capture.pieces where id = p_piece;
  if v_tenant is null then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;

  -- Projection reconstruite depuis l'extraction, elle-meme immuable et historisee :
  -- aucune donnee d'origine n'est effacee ici.
  delete from capture.piece_articles where piece_id = p_piece;

  for v_a in select * from jsonb_array_elements(coalesce(p_articles, '[]'::jsonb))
  loop
    if coalesce(btrim(v_a->>'designation'), '') = '' then
      continue;
    end if;
    v_i := v_i + 1;
    v_idx := 'articles[' || (v_i - 1)::text || ']';
    select r.famille_code, r.famille_source into v_fam, v_src
      from public.charge_famille_resolve(p_pack, p_account, v_a->>'designation',
                                         coalesce(p_document_date, current_date)) r;
    if v_fam is null then
      raise exception 'aucune famille au pack pour « % » — referentiel incomplet',
        v_a->>'designation' using errcode = 'check_violation';
    end if;

    insert into capture.piece_articles (tenant_id, entity_id, vis, piece_id, ordinal,
      designation, quantity, unit_price_ht, unit_price_ttc, total_ht,
      famille_code, famille_source, period, document_date, citation_field,
      citation_quantity, citation_unit_price_ht, citation_unit_price_ttc,
      citation_total_ht, pack_version_id)
    values (v_tenant, v_entity, v_vis, p_piece, v_i,
      v_a->>'designation',
      nullif(v_a->>'quantity','')::numeric,
      nullif(v_a->>'unit_price_ht','')::numeric,
      nullif(v_a->>'unit_price_ttc','')::numeric,
      nullif(v_a->>'total_ht','')::numeric,
      v_fam, v_src, v_period, p_document_date,
      v_idx || '.designation',
      case when nullif(v_a->>'quantity','') is null then null else v_idx || '.quantity' end,
      case when nullif(v_a->>'unit_price_ht','') is null then null else v_idx || '.unit_price_ht' end,
      case when nullif(v_a->>'unit_price_ttc','') is null then null else v_idx || '.unit_price_ttc' end,
      case when nullif(v_a->>'total_ht','') is null then null else v_idx || '.total_ht' end,
      p_pack);
  end loop;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, pack_version_id, payload)
  values (v_tenant, auth.uid(), 'piece.articles_projected', 'capture', 'piece_articles',
          p_piece, p_pack,
          jsonb_build_object('articles', v_i, 'period', v_period, 'account', p_account));

  return jsonb_build_object('piece_id', p_piece, 'articles', v_i, 'period', v_period);
end $$;

-- Reponses append-only (R7 : rien ne s'efface).
alter table collab.charge_questions
  drop constraint if exists charge_questions_tenant_id_period_famille_code_key;
alter table collab.charge_questions
  add column if not exists seq integer not null default 1;
create unique index if not exists charge_questions_seq_uq
  on collab.charge_questions (tenant_id, period, famille_code, seq);

drop view if exists public.charge_questions_v;
create view public.charge_questions_v
  with (security_invoker = true) as
  select q.id, q.tenant_id, q.period, q.famille_code, q.observed, q.baseline,
         q.deviation_ratio, q.threshold_code, q.pack_version_id, q.answer,
         q.answered_at, q.seq, q.vis, q.created_at,
         (q.seq = max(q.seq) over (partition by q.tenant_id, q.period, q.famille_code))
           as courante
    from collab.charge_questions q;

grant select on public.charge_questions_v to authenticated;

create or replace function public.charge_question_answer(
  p_tenant uuid, p_period text, p_famille text, p_observed numeric,
  p_baseline numeric, p_ratio numeric, p_threshold text, p_pack uuid, p_answer text)
returns uuid
language plpgsql
set search_path to ''
as $$
declare
  v_id uuid;
  v_seq integer;
begin
  if p_tenant not in (select app.member_orgs()) then
    raise exception 'organisation non autorisee' using errcode = '42501';
  end if;
  if p_answer not in ('exceptionnel','a_verifier') then
    raise exception 'reponse invalide' using errcode = '22023';
  end if;

  select coalesce(max(seq), 0) + 1 into v_seq
    from collab.charge_questions
   where tenant_id = p_tenant and period = p_period and famille_code = p_famille;

  insert into collab.charge_questions (tenant_id, period, famille_code, observed, baseline,
    deviation_ratio, threshold_code, pack_version_id, answer, answered_by, answered_at, seq)
  values (p_tenant, p_period, p_famille, p_observed, p_baseline, p_ratio, p_threshold,
          p_pack, p_answer, auth.uid(), now(), v_seq)
  returning id into v_id;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, pack_version_id, payload)
  values (p_tenant, auth.uid(), 'charge.question_answered', 'collab', 'charge_questions',
          v_id, p_pack,
          jsonb_build_object('period', p_period, 'famille_code', p_famille,
                             'answer', p_answer, 'observed', p_observed,
                             'baseline', p_baseline, 'deviation_ratio', p_ratio,
                             'seq', v_seq));

  return v_id;
end $$;
