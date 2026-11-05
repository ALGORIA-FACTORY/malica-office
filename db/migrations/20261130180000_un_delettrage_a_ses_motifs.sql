-- ======================================================================
--  Un délettrage a ses propres motifs (5 novembre 2026).
--
--  Relevé sur staging : pour délettrer une ligne bancaire, l'écran du
--  rapprochement proposait les motifs de RETOUR d'une pièce au client —
--  « Pièce illisible », « Mention légale absente », « Doublon »… Aucun ne dit
--  pourquoi un rapprochement est défait. `ref.rejet_motifs` ne distinguait pas
--  l'usage d'un motif.
--
--  `usage` le dit : `retour` (une pièce rendue au client, les motifs d'avant)
--  ou `delettrage` (un rapprochement défait). Quatre motifs de délettrage,
--  avec leurs mots en trois langues ; la porte `banque_delettrer` refuse un
--  motif qui n'est pas de délettrage (`refus.motif.inconnu`), et
--  l'API ne rend à chaque écran que les motifs de son usage.
--
--  REJEU (R11) : `valid_from` en littéral.
-- ======================================================================

begin;

alter table ref.rejet_motifs
  add column usage text not null default 'retour' check (usage in ('retour', 'delettrage'));

comment on column ref.rejet_motifs.usage is
  'À quoi sert le motif : rendre une pièce au client (retour) ou défaire un rapprochement '
  'bancaire (delettrage).';

create or replace view public.ref_rejet_motifs_v with (security_invoker = true) as
  select id, code, severity, requires_note, sort_order, active, valid_from, valid_to, geste,
         preuve, usage
    from ref.rejet_motifs;

-- Le geste et la preuve sont ceux d'un retour : un délettrage n'en demande
-- aucun au client.
insert into ref.rejet_motifs (code, severity, requires_note, sort_order, active, valid_from,
                              geste, preuve, usage)
values
  ('lettrage_errone', 'avertissement', false, 200, true, date '2026-01-01', 'repondre', 'aucune',
   'delettrage'),
  ('montant_ou_date_a_revoir', 'avertissement', false, 210, true, date '2026-01-01', 'repondre',
   'aucune', 'delettrage'),
  ('ecriture_contre_passee', 'avertissement', false, 220, true, date '2026-01-01', 'repondre',
   'aucune', 'delettrage'),
  ('autre_motif_de_delettrage', 'avertissement', true, 230, true, date '2026-01-01', 'repondre',
   'aucune', 'delettrage');

insert into ref.labels (ns, key, locale, value)
select 'rejet_motif', t.code, t.locale, t.valeur
  from (values
    ('lettrage_errone', 'fr', 'Rapprochement erroné : ce n''est pas cette écriture'),
    ('lettrage_errone', 'en', 'Wrong match: not this entry'),
    ('lettrage_errone', 'ar', 'مطابقة خاطئة: ليس هذا القيد'),
    ('montant_ou_date_a_revoir', 'fr', 'Montant ou date à revoir'),
    ('montant_ou_date_a_revoir', 'en', 'Amount or date to review'),
    ('montant_ou_date_a_revoir', 'ar', 'المبلغ أو التاريخ يجب مراجعته'),
    ('ecriture_contre_passee', 'fr', 'L''écriture a été contre-passée'),
    ('ecriture_contre_passee', 'en', 'The entry has been reversed'),
    ('ecriture_contre_passee', 'ar', 'تم إلغاء القيد بقيد عكسي'),
    ('autre_motif_de_delettrage', 'fr', 'Autre motif (à préciser)'),
    ('autre_motif_de_delettrage', 'en', 'Other reason (to be specified)'),
    ('autre_motif_de_delettrage', 'ar', 'سبب آخر (يجب تحديده)')
  ) as t (code, locale, valeur)
on conflict (ns, key, locale) do nothing;

-- La porte refuse un motif qui n'est pas de délettrage.
CREATE OR REPLACE FUNCTION public.banque_delettrer(p_ligne uuid, p_motif uuid, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid;
  v_ecriture uuid;
  v_pack uuid;
  v_seq integer;
  v_id uuid;
  v_requires_note boolean;
begin
  select tenant_id, ecriture_id, pack_version_id
    into v_tenant, v_ecriture, v_pack
    from banque.lettrage_etat where ligne_id = p_ligne and active for update;
  if v_tenant is null then
    raise exception 'refus.banque.aucun_lettrage' using errcode = 'check_violation';
  end if;
  if p_motif is null then
    raise exception 'refus.motif.requis' using errcode = 'check_violation';
  end if;
  -- Un motif de délettrage, pas un motif de retour d'une pièce (5 novembre 2026).
  select requires_note into v_requires_note
    from ref.rejet_motifs where id = p_motif and usage = 'delettrage';
  if v_requires_note is null then
    raise exception 'refus.motif.inconnu' using errcode = 'check_violation';
  end if;
  if v_requires_note and coalesce(btrim(p_note), '') = '' then
    raise exception 'refus.motif.note_requise' using errcode = 'check_violation';
  end if;

  select coalesce(max(seq), 0) + 1 into v_seq
    from banque.lettrages where ligne_id = p_ligne and ecriture_id = v_ecriture;

  insert into banque.lettrages (tenant_id, ligne_id, ecriture_id, action, seq,
                                motif_id, note, pack_version_id, decided_by)
  values (v_tenant, p_ligne, v_ecriture, 'delettre', v_seq, p_motif, p_note,
          v_pack, auth.uid())
  returning id into v_id;

  update banque.lettrage_etat
     set active = false, updated_at = now()
   where ligne_id = p_ligne;

  update banque.releve_lignes
     set status = 'ouverte', updated_at = now()
   where id = p_ligne;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, motif_id, pack_version_id, payload)
  values (v_tenant, auth.uid(), 'banque.delettre', 'banque', 'lettrages', v_id,
          p_motif, v_pack,
          jsonb_build_object('ligne_id', p_ligne, 'ecriture_id', v_ecriture,
                             'note', p_note, 'seq', v_seq));

  return jsonb_build_object('lettrage_id', v_id, 'seq', v_seq);
end $function$;

commit;
