-- La supervision revient à l'expert ou au collaborateur (ANO-CAB-006, 21 octobre 2026).
--
-- Recette en direct : l'assistant d'un cabinet validait en lot douze
-- écritures d'un client, dont onze forcées par l'expert. Le quatre-yeux était
-- tenu par le rôle le moins qualifié, alors que le même assistant ne pouvait
-- pas forcer une imputation. La règle devient une : préparer, oui ;
-- superviser (valider ou retourner), non.
-- Corps repris de la base vivante ; seule la garde s'ajoute.
-- REJEU (R11) : create or replace.

begin;
CREATE OR REPLACE FUNCTION public.socle_ecriture_review(p_ecriture uuid, p_outcome app.review_outcome_t, p_motif uuid DEFAULT NULL::uuid, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
  -- La supervision est le second regard : elle revient à l'expert ou au
  -- collaborateur du cabinet engagé, jamais à l'assistant (ANO-CAB-006). Un
  -- membre de la société (dossier autonome) garde la main sur son dossier.
  if v_tenant not in (select app.member_orgs())
     and not exists (
       select 1
         from identity.engagements e
         join identity.memberships m on m.tenant_id = e.cabinet_org_id
        where e.pme_org_id = v_tenant and e.status = 'actif'
          and m.user_id = auth.uid() and m.role in ('expert', 'collaborateur')
     ) then
    raise exception 'La supervision revient à l''expert ou au collaborateur du cabinet.'
      using errcode = '42501', hint = 'supervision.role';
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
end $function$;

commit;
