-- Relecture de #114 (26 octobre 2026) : trois défauts, corrigés ici.
--
-- 1. « Inscrire l'écriture proposée » échouait sur la plupart des pièces que
--    le client n'a pas confirmées : le verrou R2 (`socle.assert_bookable`)
--    exige un type « confirme », et ces pièces sont justement « a_confirmer ».
--    Le cabinet engagé confirme désormais le type LU, en son nom, tracé
--    (`piece_confirmer_le_type_lu`). Un type que la lecture n'a pas reconnu
--    ne se devine pas : le cabinet demande au client.
-- 2. La preuve « document joint » restait vraie après un détachement, et ne
--    voyait pas un rattachement fait depuis l'autre pièce : elle lit l'état
--    courant de la paire (`rattachements_v`), dans les deux sens.
-- 3. « Corriger la date » se prouvait par n'importe quelle précision, le
--    type compris : seule une date précisée après le retour compte.
--    `piece_retourner` lit aussi les écritures (pas seulement le statut) et
--    refuse un motif retiré du référentiel.

-- --- 1. Le cabinet confirme le type lu ------------------------------------------------------------

create or replace function public.piece_confirmer_le_type_lu(p_piece uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_vis    app.vis_t;
  v_status text;
  v_type   text;
  v_statut text;
  v_id     uuid;
begin
  select tenant_id, vis, status, document_kind, document_kind_statut
    into v_tenant, v_vis, v_status, v_type, v_statut
    from capture.pieces where id = p_piece for update;
  if v_tenant is null then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;
  if not exists (
       select 1
         from identity.engagements e
         join identity.memberships m on m.tenant_id = e.cabinet_org_id
        where e.pme_org_id = v_tenant and e.status = 'actif'
          and m.user_id = auth.uid() and m.role in ('expert', 'collaborateur')) then
    raise exception 'La supervision revient à l''expert ou au collaborateur du cabinet.'
      using errcode = '42501', hint = 'supervision.role';
  end if;
  if v_vis <> 'partage'::app.vis_t or v_status not in ('lue', 'proposee') then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;
  if v_statut = 'confirme' then
    return jsonb_build_object('piece_id', p_piece, 'deja', true);
  end if;
  if v_type is null or v_statut is distinct from 'a_confirmer' then
    raise exception 'refus.inscription.type_inconnu' using errcode = 'check_violation';
  end if;

  insert into capture.precisions (tenant_id, piece_id, champ, valeur)
  values (v_tenant, p_piece, 'document_kind', v_type)
  returning id into v_id;

  update capture.pieces
     set document_kind_statut = 'confirme', updated_at = now()
   where id = p_piece;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'piece.precisee', 'capture', 'precisions', v_id,
          jsonb_build_object('piece_id', p_piece, 'champ', 'document_kind', 'valeur', v_type,
                             'avant', v_type, 'par_le_cabinet', true));

  return jsonb_build_object('piece_id', p_piece, 'deja', false);
end
$$;

revoke all on function public.piece_confirmer_le_type_lu(uuid) from public, anon;
grant execute on function public.piece_confirmer_le_type_lu(uuid) to authenticated;

-- --- 2 et 3. Les preuves d'un retour, et le retour lui-même ---------------------------------------

create or replace function public.piece_retourner(p_piece uuid, p_motif uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_vis    app.vis_t;
  v_status text;
  v_pack   uuid;
  v_note_requise boolean;
begin
  select tenant_id, vis, status into v_tenant, v_vis, v_status
    from capture.pieces where id = p_piece for update;
  if v_tenant is null then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;
  -- Le second regard revient à l'expert ou au collaborateur du cabinet engagé.
  if not exists (
       select 1
         from identity.engagements e
         join identity.memberships m on m.tenant_id = e.cabinet_org_id
        where e.pme_org_id = v_tenant and e.status = 'actif'
          and m.user_id = auth.uid() and m.role in ('expert', 'collaborateur')) then
    raise exception 'La supervision revient à l''expert ou au collaborateur du cabinet.'
      using errcode = '42501', hint = 'supervision.role';
  end if;
  if v_vis <> 'partage'::app.vis_t then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;
  -- Le statut peut retarder sur les écritures : on lit aussi les écritures.
  if v_status not in ('lue', 'proposee', 'confirmee')
     or exists (select 1 from socle.ecritures e
                 where e.piece_id = p_piece and e.status = 'booked'
                   and app.ecriture_vivante(e.id)) then
    raise exception 'refus.retour.inscrite' using errcode = 'check_violation';
  end if;

  -- Un motif retiré du référentiel ne se choisit plus.
  select requires_note into v_note_requise
    from ref.rejet_motifs where id = p_motif and active;
  if v_note_requise is null then
    raise exception 'motif inconnu' using errcode = 'check_violation';
  end if;
  if v_note_requise and coalesce(btrim(p_note), '') = '' then
    raise exception 'ce motif exige une note' using errcode = 'check_violation';
  end if;

  select a.pack_version_id into v_pack
    from capture.analyses a where a.piece_id = p_piece order by a.created_at desc limit 1;
  if v_pack is null then
    select jp.id into v_pack
      from ref.jurisdiction_packs jp
      join identity.organizations o on o.jurisdiction = jp.jurisdiction
     where o.id = v_tenant and jp.effective_from <= current_date
     order by jp.effective_from desc limit 1;
  end if;

  insert into capture.conformite (tenant_id, piece_id, verdict, motif_id, note,
                                  pack_version_id, decided_by)
  values (v_tenant, p_piece, 'a_corriger'::app.verdict_t, p_motif, nullif(btrim(p_note), ''),
          v_pack, auth.uid());

  update capture.pieces set status = 'retournee', updated_at = now() where id = p_piece;

  insert into collab.notifications (tenant_id, kind, payload)
  values (v_tenant, 'piece.retournee',
          jsonb_build_object('piece_id', p_piece, 'motif_id', p_motif,
                             'note', nullif(btrim(p_note), '')));

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, motif_id, pack_version_id, payload)
  values (v_tenant, auth.uid(), 'piece.retournee', 'capture', 'pieces', p_piece, p_motif, v_pack,
          jsonb_build_object('note', nullif(btrim(p_note), ''), 'sans_ecriture', true));

  return jsonb_build_object('piece_id', p_piece, 'motif_id', p_motif);
end
$$;

revoke all on function public.piece_retourner(uuid, uuid, text) from public, anon;
grant execute on function public.piece_retourner(uuid, uuid, text) to authenticated;

create or replace function public.piece_retour(p_piece uuid, p_locale text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with p as (
    select id, tenant_id, status from capture.pieces
     where id = p_piece and tenant_id in (select app.member_orgs())
  ),
  c as (
    select c.decided_at, c.note, c.motif_id, c.decided_by
      from capture.conformite c join p on p.id = c.piece_id
     where c.verdict = 'a_corriger'::app.verdict_t
     order by c.decided_at desc limit 1
  )
  select case when (select status from p) = 'retournee' and exists (select 1 from c) then
    jsonb_build_object(
      'le', (select decided_at from c),
      'note', (select note from c),
      'motif', m.code,
      'motifLibelle', coalesce(l.value, lf.value, m.code),
      'geste', m.geste,
      'cabinet', (select o.name
                    from identity.engagements e
                    join identity.organizations o on o.id = e.cabinet_org_id
                   where e.pme_org_id = (select tenant_id from p) and e.status = 'actif'
                   order by e.starts_on desc nulls last limit 1),
      'fait', case m.preuve
        when 'aucune' then true
        when 'rattachement' then exists (
          select 1 from public.rattachements_v r
           where (r.piece_id = p_piece or r.piece_liee_id = p_piece)
             and r.fait = 'rattache'
             and r.created_at > (select decided_at from c))
        when 'precision' then exists (
          select 1 from capture.precisions pr
           where pr.piece_id = p_piece and pr.champ = 'document_date'
             and pr.decided_at > (select decided_at from c))
        when 'reponse' then exists (
          select 1 from audit.event_log ev
           where ev.object_id = p_piece and ev.action = 'piece.reponse_client'
             and ev.at > (select decided_at from c))
        else false end)
  end
    from c
    join ref.rejet_motifs m on m.id = c.motif_id
    left join ref.labels l on l.ns = 'rejet_motif' and l.key = m.code and l.locale = p_locale
    left join ref.labels lf on lf.ns = 'rejet_motif' and lf.key = m.code and lf.locale = 'fr'
$$;

revoke all on function public.piece_retour(uuid, text) from public, anon;
grant execute on function public.piece_retour(uuid, text) to authenticated;
