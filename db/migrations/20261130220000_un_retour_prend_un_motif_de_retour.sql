-- ======================================================================
--  Un retour de pièce prend un motif de retour (6 novembre 2026).
--
--  20261130180000 a séparé les motifs de délettrage des motifs de retour, et
--  la porte du délettrage refuse un motif de retour. L'inverse restait
--  ouvert en base : l'écran ne propose jamais un motif de délettrage pour
--  rendre une pièce, mais les portes du retour l'auraient accepté — le
--  client aurait lu « Rapprochement erroné » sur sa pièce.
--
--  `app.exiger_un_motif_de_retour` (le retour par le circuit) et
--  `socle_ecriture_review` (le retour d'une écriture) n'acceptent plus qu'un
--  motif d'usage `retour` ; un autre est inconnu (`refus.motif.inconnu`).
-- ======================================================================

begin;

CREATE OR REPLACE FUNCTION app.exiger_un_motif_de_retour(p_motif uuid, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_note_requise boolean;
begin
  select requires_note into v_note_requise
    from ref.rejet_motifs where id = p_motif and active and usage = 'retour';
  if v_note_requise is null then
    raise exception 'refus.motif.inconnu' using errcode = 'check_violation';
  end if;
  if v_note_requise and coalesce(btrim(p_note), '') = '' then
    raise exception 'refus.motif.note_requise' using errcode = 'check_violation';
  end if;
end
$function$;

CREATE OR REPLACE FUNCTION public.socle_ecriture_review(p_ecriture uuid, p_outcome app.review_outcome_t, p_motif uuid DEFAULT NULL::uuid, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant  uuid;
  v_piece   uuid;
  v_pack    uuid;
  v_status  text;
  v_rev     uuid;
  v_requires_note boolean;
  v_courante uuid;
begin
  select tenant_id, piece_id, pack_version_id, status
    into v_tenant, v_piece, v_pack, v_status
    from socle.ecritures where id = p_ecriture;
  -- Le verdict porte sur la pièce, donc sur sa version courante ; la
  -- contre-passation, elle, garde la pièce de l'écriture qu'elle annule.
  v_courante := app.version_courante(v_piece);

  if v_tenant is null then
    raise exception 'refus.introuvable.ecriture' using errcode = '42501';
  end if;
  -- La supervision est le second regard : elle revient à l'expert ou au
  -- collaborateur du cabinet engagé, jamais à l'assistant (ANO-CAB-006). Un
  -- membre de la société la garde seulement quand elle tient ses livres
  -- (dossier autonome, ou sans cabinet) : en mandat, elle ne valide ni ne
  -- contre-passe l'écriture du cabinet.
  if not app.peut_superviser(v_tenant) then
    raise exception 'refus.supervision.reservee'
      using errcode = '42501', hint = 'supervision.role';
  end if;
  if v_status <> 'booked' then
    raise exception 'refus.supervision.comptabilisee_seulement'
      using errcode = 'check_violation';
  end if;

  if p_outcome = 'retourne' then
    if p_motif is null then
      raise exception 'refus.motif.requis' using errcode = 'check_violation';
    end if;
    select requires_note into v_requires_note from ref.rejet_motifs
     where id = p_motif and usage = 'retour';
    if v_requires_note is null then
      raise exception 'refus.motif.inconnu' using errcode = 'check_violation';
    end if;
    if v_requires_note and coalesce(btrim(p_note), '') = '' then
      raise exception 'refus.motif.note_requise' using errcode = 'check_violation';
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
  values (v_tenant, v_courante,
          case when p_outcome = 'valide' then 'conforme'::app.verdict_t
               else 'a_corriger'::app.verdict_t end,
          p_motif, p_note, v_pack, auth.uid());

  if p_outcome = 'valide' then
    update capture.pieces set status = 'supervisee', updated_at = now()
     where id = v_courante;
  else
    v_rev := public.socle_ecriture_contre_passer(p_ecriture, p_motif);
    update capture.pieces set status = 'retournee', updated_at = now()
     where id = v_courante;
  end if;

  insert into collab.notifications (tenant_id, kind, payload)
  values (v_tenant,
          case when p_outcome = 'valide' then 'piece.validee' else 'piece.retournee' end,
          jsonb_build_object('piece_id', v_courante, 'ecriture_id', p_ecriture,
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
