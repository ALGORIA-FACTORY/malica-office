-- ============================================================
-- 007 — couche d'accès applicatif du pipeline de la pièce
-- (vues security_invoker + RPC gouvernées ; aucune table nouvelle)
-- ============================================================

-- ---------------------------------------------- storage : bucket « pieces »
-- Chemin imposé : <tenant_id>/<piece_uuid>.<ext>
-- La visibilité est décidée par RLS sur capture.pieces, jamais par le front.

create policy "pieces_storage_read_membre"
on storage.objects for select to authenticated
using (
  bucket_id = 'pieces'
  and (
    (split_part(name, '/', 1))::uuid in (select app.member_orgs())
    or exists (
      select 1 from capture.pieces p
      where p.tenant_id = (split_part(name, '/', 1))::uuid
        and p.storage_path = name
        and p.vis = 'partage'
        and p.tenant_id in (select app.engaged_orgs())
    )
  )
);

create policy "pieces_storage_insert_membre"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'pieces'
  and (split_part(name, '/', 1))::uuid in (select app.member_orgs())
);

create policy "pieces_storage_delete_membre"
on storage.objects for delete to authenticated
using (
  bucket_id = 'pieces'
  and (split_part(name, '/', 1))::uuid in (select app.member_orgs())
);

-- ---------------------------------------------------------------- vues
create or replace view public.token_plan_v
with (security_invoker = true) as
select id, tenant_id, piece_id, page, ordinal, text, x0, y0, x1, y1, confidence, created_at
from capture.token_plan;

create or replace view public.citations_v
with (security_invoker = true) as
select id, tenant_id, piece_id, field, token_id, page, bbox, zone, created_at
from capture.citations;

create or replace view public.extractions_v
with (security_invoker = true) as
select id, tenant_id, piece_id, contract, payload, flags, created_at
from capture.extractions;

create or replace view public.conformite_v
with (security_invoker = true) as
select id, tenant_id, piece_id, verdict, motif_id, note, legal_version_id,
       pack_version_id, decided_by, decided_at
from capture.conformite;

create or replace view public.ecritures_v
with (security_invoker = true) as
select id, tenant_id, entity_id, piece_id, vis, journal, date_ecriture, devise,
       libelle, pack_version_id, status, booked_by, booked_at, booked_autonome,
       reviewed_by, reviewed_at, review_outcome, review_motif_id, review_note,
       reverses_id, reversal_reason_id, created_by, created_at, updated_at
from socle.ecritures;

create or replace view public.ecriture_lignes_v
with (security_invoker = true) as
select id, tenant_id, ecriture_id, ordinal, account_code, libelle,
       debit, credit, tax_code, created_at
from socle.ecriture_lignes;

do $$
declare v text;
begin
  foreach v in array array['token_plan_v','citations_v','extractions_v','conformite_v',
                           'ecritures_v','ecriture_lignes_v']
  loop
    execute format('revoke all on public.%I from public, anon, service_role', v);
    execute format('grant select on public.%I to authenticated', v);
  end loop;
end $$;

-- ------------------------------------------------ 1. enregistrer une pièce
create or replace function public.capture_piece_register(
  p_tenant uuid,
  p_source text,
  p_storage_path text,
  p_idempotency_key text,
  p_entity uuid default null,
  p_vis app.vis_t default 'partage',
  p_sha256 text default null,
  p_page_count smallint default null
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare v_id uuid;
begin
  insert into capture.pieces (tenant_id, entity_id, vis, source, storage_path,
                              sha256, page_count, idempotency_key)
  values (p_tenant, p_entity, p_vis, p_source, p_storage_path,
          p_sha256, p_page_count, p_idempotency_key)
  on conflict (tenant_id, idempotency_key)
    do update set updated_at = now()
  returning id into v_id;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                              object_id, payload)
  values (p_tenant, auth.uid(), 'piece.captured', 'capture', 'pieces', v_id,
          jsonb_build_object('source', p_source, 'vis', p_vis));

  return v_id;
end $$;

-- --------------------------------- 2. lecture citée : tokens + extraction
-- R2 : toute valeur émise est vérifiée contre le plan de tokens de la pièce.
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

    insert into capture.citations (tenant_id, piece_id, field, token_id, page, bbox, zone)
    select v_tenant, p_piece, v_cit->>'field', v_token_id, t.page,
           jsonb_build_object('x0', t.x0, 'y0', t.y0, 'x1', t.x1, 'y1', t.y1),
           nullif(v_cit->>'zone','')
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

-- --------------------------------------------- 3. écriture proposée (Socle)
create or replace function public.socle_ecriture_propose(
  p_piece uuid,
  p_journal text,
  p_date date,
  p_libelle text,
  p_pack_version uuid,
  p_lignes jsonb,
  p_devise text default 'TND'
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_entity uuid;
  v_vis app.vis_t;
  v_ecr uuid;
  v_l jsonb;
  v_i smallint := 0;
begin
  select tenant_id, entity_id, vis into v_tenant, v_entity, v_vis
    from capture.pieces where id = p_piece;
  if v_tenant is null then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;

  delete from socle.ecritures
   where piece_id = p_piece and status = 'proposee';

  insert into socle.ecritures (tenant_id, entity_id, piece_id, vis, journal,
                               date_ecriture, devise, libelle, pack_version_id)
  values (v_tenant, v_entity, p_piece, v_vis, p_journal, p_date, p_devise,
          p_libelle, p_pack_version)
  returning id into v_ecr;

  for v_l in select * from jsonb_array_elements(p_lignes)
  loop
    v_i := v_i + 1;
    insert into socle.ecriture_lignes (tenant_id, ecriture_id, ordinal, account_code,
                                       libelle, debit, credit, tax_code)
    values (v_tenant, v_ecr, v_i, v_l->>'account_code', v_l->>'libelle',
            coalesce((v_l->>'debit')::numeric, 0),
            coalesce((v_l->>'credit')::numeric, 0),
            nullif(v_l->>'tax_code',''));
  end loop;

  update capture.pieces
     set status = case when status in ('capturee','lue','retournee') then 'proposee' else status end,
         updated_at = now()
   where id = p_piece;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                              object_id, payload)
  values (v_tenant, auth.uid(), 'ecriture.proposed', 'socle', 'ecritures', v_ecr,
          jsonb_build_object('piece_id', p_piece, 'pack_version_id', p_pack_version,
                             'lignes', jsonb_array_length(p_lignes)));

  return v_ecr;
end $$;

-- ------------------------------------------- 4. confirmation par la PME
create or replace function public.socle_ecriture_book(p_ecriture uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_piece uuid;
begin
  update socle.ecritures
     set status = 'booked',
         booked_by = auth.uid(),
         booked_at = now(),
         updated_at = now()
   where id = p_ecriture and status = 'proposee'
  returning tenant_id, piece_id into v_tenant, v_piece;

  if v_tenant is null then
    raise exception 'ecriture introuvable, deja comptabilisee ou non autorisee'
      using errcode = '42501';
  end if;

  update capture.pieces
     set status = 'comptabilisee', updated_at = now()
   where id = v_piece;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                              object_id, payload)
  values (v_tenant, auth.uid(), 'ecriture.booked', 'socle', 'ecritures', p_ecriture,
          jsonb_build_object('piece_id', v_piece));
end $$;

-- --------------------- 5. lignes comptabilisées d'une période (le Socle calcule)
create or replace function public.socle_periode_lignes(
  p_tenant uuid,
  p_from date,
  p_to date
) returns table (
  ecriture_id uuid,
  date_ecriture date,
  journal text,
  libelle text,
  account_code text,
  debit numeric(38,3),
  credit numeric(38,3),
  tax_code text
)
language sql
security invoker
stable
set search_path = ''
as $$
  select e.id, e.date_ecriture, e.journal, l.libelle, l.account_code,
         l.debit, l.credit, l.tax_code
    from socle.ecritures e
    join socle.ecriture_lignes l on l.ecriture_id = e.id
   where e.tenant_id = p_tenant
     and e.status = 'booked'
     and e.date_ecriture between p_from and p_to
   order by e.date_ecriture, e.id, l.ordinal
$$;

revoke all on function public.capture_piece_register(uuid, text, text, text, uuid, app.vis_t, text, smallint) from public, anon;
revoke all on function public.capture_read_persist(uuid, jsonb, text, jsonb, jsonb, jsonb) from public, anon;
revoke all on function public.socle_ecriture_propose(uuid, text, date, text, uuid, jsonb, text) from public, anon;
revoke all on function public.socle_ecriture_book(uuid) from public, anon;
revoke all on function public.socle_periode_lignes(uuid, date, date) from public, anon;

grant execute on function public.capture_piece_register(uuid, text, text, text, uuid, app.vis_t, text, smallint) to authenticated;
grant execute on function public.capture_read_persist(uuid, jsonb, text, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.socle_ecriture_propose(uuid, text, date, text, uuid, jsonb, text) to authenticated;
grant execute on function public.socle_ecriture_book(uuid) to authenticated;
grant execute on function public.socle_periode_lignes(uuid, date, date) to authenticated;