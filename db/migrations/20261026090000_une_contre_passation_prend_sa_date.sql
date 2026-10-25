-- Une contre-passation prend la date de l'écriture qu'elle annule, tant que
-- le mois de celle-ci n'est pas déclaré.
--
-- Audit du 25 octobre 2026 : le cabinet retourne une facture du 10/09 ; la
-- contre-passation était datée du jour (25/10). Septembre gardait la charge,
-- octobre en recevait l'opposé : l'accueil disait « Vos charges : en baisse
-- de 150 % », et la TVA de deux mois était faussée.
--
-- Règle (déterministe, validée par Wissem le 25/10, à confirmer par l'expert) :
--   * le mois d'origine n'est pas déclaré → la contre-passation est datée du
--     jour de l'écriture annulée : le mois s'annule proprement ;
--   * le mois d'origine est déclaré (son échéance TVA porte `fait_le`) → la
--     contre-passation est datée du jour : on ne réécrit pas un mois déposé,
--     la correction passe sur la période ouverte.
-- Texte : Code de la TVA, art. 9 (imputation mensuelle, report du reliquat) ;
-- délais de dépôt : ref.fiscal_obligations (TVA_*). La date d'une
-- contre-passation n'est fixée par aucun texte trouvé : INCERTAIN.

-- Un mois est DÉCLARÉ quand son échéance TVA porte `fait_le`. La famille TVA
-- est celle du référentiel (TVA_PP, TVA_PM, TVA_PM_EDI) : le code porte
-- l'impôt, le suffixe la modalité.
create or replace function app.mois_tva_declare(p_tenant uuid, p_jour date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from schedule.echeances e
      join ref.fiscal_obligations o on o.code = e.kind and o.code like 'TVA%'
     where e.tenant_id = p_tenant
       and e.period = to_char(p_jour, 'YYYY-MM')
       and e.fait_le is not null)
$$;

revoke all on function app.mois_tva_declare(uuid, date) from public, anon;
grant execute on function app.mois_tva_declare(uuid, date) to authenticated;

-- Le jour où une pièce pèse dans la TVA : celui de son écriture (la date de
-- la facture), sauf si ce mois est déjà déclaré — elle passe alors au jour où
-- elle est arrivée (transmise, ou inscrite), sur une période ouverte. C'est le
-- report du reliquat de l'art. 9 du Code de la TVA, et c'est la MÊME règle
-- pour la PME et pour le cabinet : leurs deux chiffres ne peuvent plus
-- diverger (audit du 25 octobre 2026 ; décision de Wissem du même jour, qui
-- remplace l'imputation à la date de transmission du 10 octobre).
create or replace function app.jour_d_imputation_tva(p_tenant uuid, p_ecriture date, p_arrivee date)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when app.mois_tva_declare(p_tenant, p_ecriture) then coalesce(p_arrivee, p_ecriture)
    else p_ecriture
  end
$$;

revoke all on function app.jour_d_imputation_tva(uuid, date, date) from public, anon;
grant execute on function app.jour_d_imputation_tva(uuid, date, date) to authenticated;

create or replace function app.date_de_contre_passation(p_tenant uuid, p_date_origine date)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when app.mois_tva_declare(p_tenant, p_date_origine) then current_date
    else p_date_origine
  end
$$;

revoke all on function app.date_de_contre_passation(uuid, date) from public, anon;
grant execute on function app.date_de_contre_passation(uuid, date) to authenticated;

-- Corps repris de 20261022580000 ; seule la date de la contre-passation change.
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
  v_date    date;
  v_rev     uuid;
  v_i       smallint := 0;
  v_l       record;
  v_requires_note boolean;
begin
  select tenant_id, entity_id, piece_id, pack_version_id, journal, libelle, devise, status,
         date_ecriture
    into v_tenant, v_entity, v_piece, v_pack, v_journal, v_libelle, v_devise, v_status, v_date
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
            app.date_de_contre_passation(v_tenant, v_date), v_devise,
            'Contre-passation — ' || v_libelle, v_pack,
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
