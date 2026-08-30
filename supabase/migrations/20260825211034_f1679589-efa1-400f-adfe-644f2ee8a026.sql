create policy ecritures_upd_cabinet on socle.ecritures for update to authenticated
  using (vis = 'partage'::app.vis_t and tenant_id in (select app.engaged_orgs()))
  with check (vis = 'partage'::app.vis_t and tenant_id in (select app.engaged_orgs()));

create policy ecritures_ins_contrepassation on socle.ecritures for insert to authenticated
  with check (
    reverses_id is not null
    and vis = 'partage'::app.vis_t
    and tenant_id in (select app.engaged_orgs())
  );

create policy lignes_ins_cabinet on socle.ecriture_lignes for insert to authenticated
  with check (
    tenant_id in (select app.engaged_orgs())
    and exists (
      select 1 from socle.ecritures e
      where e.id = ecriture_id and e.reverses_id is not null
    )
  );

create policy pieces_upd_cabinet on capture.pieces for update to authenticated
  using (vis = 'partage'::app.vis_t and tenant_id in (select app.engaged_orgs()))
  with check (vis = 'partage'::app.vis_t and tenant_id in (select app.engaged_orgs()));

create policy conformite_ins_cabinet on capture.conformite for insert to authenticated
  with check (tenant_id in (select app.engaged_orgs()));

create policy event_log_ins_cabinet on audit.event_log for insert to authenticated
  with check (tenant_id in (select app.engaged_orgs()));

create policy notifications_ins_cabinet on collab.notifications for insert to authenticated
  with check (tenant_id in (select app.engaged_orgs()));

create or replace view public.notifications_v
with (security_invoker = true) as
select id, tenant_id, user_id, kind, payload, read_at, created_at
from collab.notifications;

create or replace view public.echeances_v
with (security_invoker = true) as
select id, tenant_id, entity_id, kind, label, period, due_date, pack_version_id,
       status, created_at, updated_at
from schedule.echeances;

create or replace view public.event_log_v
with (security_invoker = true) as
select id, tenant_id, actor, action, object_schema, object_table, object_id,
       motif_id, pack_version_id, payload, at
from audit.event_log;

do $$
declare v text;
begin
  foreach v in array array['notifications_v','echeances_v','event_log_v']
  loop
    execute format('revoke all on public.%I from public, anon, service_role', v);
    execute format('grant select on public.%I to authenticated', v);
  end loop;
  execute 'grant insert, update on public.notifications_v to authenticated';
  execute 'grant insert, update on public.echeances_v to authenticated';
end $$;

create or replace function public.socle_ecriture_review(
  p_ecriture uuid,
  p_outcome  app.review_outcome_t,
  p_motif    uuid default null,
  p_note     text default null
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tenant  uuid;
  v_entity  uuid;
  v_piece   uuid;
  v_pack    uuid;
  v_journal text;
  v_libelle text;
  v_devise  text;
  v_status  text;
  v_rev     uuid;
  v_i       smallint := 0;
  v_l       record;
  v_requires_note boolean;
begin
  select tenant_id, entity_id, piece_id, pack_version_id, journal, libelle, devise, status
    into v_tenant, v_entity, v_piece, v_pack, v_journal, v_libelle, v_devise, v_status
    from socle.ecritures where id = p_ecriture;

  if v_tenant is null then
    raise exception 'ecriture introuvable ou non autorisee' using errcode = '42501';
  end if;
  if v_status <> 'booked' then
    raise exception 'seule une ecriture comptabilisee est supervisable'
      using errcode = 'check_violation';
  end if;

  if p_outcome = 'retourne' then
    if p_motif is null then
      raise exception 'un retour exige un motif gouverne' using errcode = 'check_violation';
    end if;
    select requires_note into v_requires_note from ref.rejet_motifs where id = p_motif;
    if v_requires_note is null then
      raise exception 'motif inconnu' using errcode = 'check_violation';
    end if;
    if v_requires_note and coalesce(btrim(p_note), '') = '' then
      raise exception 'ce motif exige une note' using errcode = 'check_violation';
    end if;
  end if;

  update socle.ecritures
     set reviewed_by = auth.uid(),
         reviewed_at = now(),
         review_outcome = p_outcome,
         review_motif_id = p_motif,
         review_note = p_note,
         updated_at = now()
   where id = p_ecriture;

  insert into capture.conformite (tenant_id, piece_id, verdict, motif_id, note,
                                  pack_version_id, decided_by)
  values (v_tenant, v_piece,
          case when p_outcome = 'valide' then 'conforme'::app.verdict_t
               else 'a_corriger'::app.verdict_t end,
          p_motif, p_note, v_pack, auth.uid());

  if p_outcome = 'valide' then
    update capture.pieces set status = 'supervisee', updated_at = now()
     where id = v_piece;
  else
    insert into socle.ecritures (tenant_id, entity_id, piece_id, vis, journal,
                                 date_ecriture, devise, libelle, pack_version_id,
                                 status, reverses_id, reversal_reason_id)
    values (v_tenant, v_entity, v_piece, 'partage', v_journal,
            current_date, v_devise, 'Contre-passation — ' || v_libelle, v_pack,
            'proposee', p_ecriture, p_motif)
    returning id into v_rev;

    for v_l in
      select ordinal, account_code, libelle, debit, credit, tax_code
        from socle.ecriture_lignes where ecriture_id = p_ecriture order by ordinal
    loop
      v_i := v_i + 1;
      insert into socle.ecriture_lignes (tenant_id, ecriture_id, ordinal, account_code,
                                         libelle, debit, credit, tax_code)
      values (v_tenant, v_rev, v_i, v_l.account_code,
              'Contre-passation — ' || v_l.libelle,
              v_l.credit, v_l.debit, v_l.tax_code);
    end loop;

    update socle.ecritures
       set status = 'booked', booked_by = auth.uid(), booked_at = now(), updated_at = now()
     where id = v_rev;

    update capture.pieces set status = 'retournee', updated_at = now()
     where id = v_piece;
  end if;

  insert into collab.notifications (tenant_id, kind, payload)
  values (v_tenant,
          case when p_outcome = 'valide' then 'piece.validee' else 'piece.retournee' end,
          jsonb_build_object('piece_id', v_piece, 'ecriture_id', p_ecriture,
                             'motif_id', p_motif, 'note', p_note));

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, motif_id, pack_version_id, payload)
  values (v_tenant, auth.uid(),
          case when p_outcome = 'valide' then 'ecriture.validee' else 'ecriture.retournee' end,
          'socle', 'ecritures', p_ecriture, p_motif, v_pack,
          jsonb_build_object('piece_id', v_piece, 'reversal_id', v_rev, 'note', p_note));

  return v_rev;
end $$;

revoke execute on function public.socle_ecriture_review(uuid, app.review_outcome_t, uuid, text)
  from public, anon, service_role;
grant execute on function public.socle_ecriture_review(uuid, app.review_outcome_t, uuid, text)
  to authenticated;