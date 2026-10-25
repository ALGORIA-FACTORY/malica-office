-- Un règlement dit vrai — la base refuse le faux, quel que soit l'écran
-- (25 octobre 2026).
--
-- ================================================================== POURQUOI
--
-- Relevé sur le staging, chez Wissem, le 25 octobre :
--   • COMPTOIR, facture de 1 969,610 : espèces 1 969,610 ET chèque 1 969,610
--     ET carte 0 — payée deux fois, plus un règlement à zéro ;
--   • une facture « payée par chèque » sans montant ET « pas encore payée »
--     deux fois, inscrite à une seconde d'intervalle ;
--   • une pièce « CASH » réglée en espèces sans montant : le règlement groupé
--     de la capture n'envoie pas de montant, et rien ne le complétait.
-- Aucune de ces lignes n'était refusée : `capture.paiements` acceptait tout.
--
-- Maquette validée par Wissem (« Go ») : l'écran ne propose plus le faux, et
-- la BASE le refuse — un écran se contourne, une règle en base non.
--
-- ============================================================ CE QUI EST REFUSÉ
--
-- À l'inscription d'un règlement (pas d'une annulation) :
--   1. un montant nul ou négatif ;
--   2. un total réglé qui dépasse le TTC lu de la pièce (au millime, aux
--      décimales de la devise) ;
--   3. une date de règlement dans l'avenir (un jour de marge pour le fuseau) ;
--   4. le même règlement inscrit deux fois en dix secondes (double appui) ;
--   5. « pas encore payé » à côté d'un règlement vivant, ou deux fois.
-- Un règlement SANS montant prend ce qui reste dû quand le TTC est lu (le
-- règlement groupé de la capture) ; sans TTC lu, il est refusé : on ne
-- devine pas un montant.
--
-- Inscrire un vrai règlement éteint « pas encore payé » : par une
-- annulation datée et motivée (`regle_depuis`), jamais par une rature (R7).
--
-- Une date AVANT la facture n'est pas refusée — un acompte la précède
-- souvent ; l'écran la signale.
--
-- ============================================================ CORRIGER D'UN GESTE
--
-- `paiement_corriger` annule l'ancien et inscrit le nouveau dans la même
-- transaction : la pièce n'est jamais, même un instant, sans règlement ou
-- réglée deux fois.

-- --- Les motifs : à qui ils s'appliquent ------------------------------------------------------

alter table ref.paiement_motifs_annulation
  add column pour text not null default 'reglement'
    check (pour in ('reglement', 'non_paye', 'systeme'));

insert into ref.paiement_motifs_annulation (code, requires_note, rang, valid_from, pour) values
  ('inscrit_en_double', false, 15, date '2026-10-25', 'reglement'),
  ('date_erronee',      false, 25, date '2026-10-25', 'reglement'),
  ('pas_exact',         false, 10, date '2026-10-25', 'non_paye'),
  ('regle_depuis',      false, 90, date '2026-10-25', 'systeme')
on conflict do nothing;

-- « Autre raison » exigeait une note que rien n'enregistrait : le motif
-- n'apprenait rien. Il n'est plus proposé ; les annulations passées le
-- gardent.
update ref.paiement_motifs_annulation set valid_to = date '2026-10-25'
 where code = 'autre' and valid_to is null;

insert into ref.labels (ns, key, locale, value) values
  ('paiement_motif_annulation', 'inscrit_en_double', 'fr', 'Inscrit en double'),
  ('paiement_motif_annulation', 'inscrit_en_double', 'en', 'Recorded twice'),
  ('paiement_motif_annulation', 'inscrit_en_double', 'ar', 'مسجّل مرّتين'),
  ('paiement_motif_annulation', 'date_erronee', 'fr', 'Ce n''est pas la bonne date'),
  ('paiement_motif_annulation', 'date_erronee', 'en', 'Wrong date'),
  ('paiement_motif_annulation', 'date_erronee', 'ar', 'التاريخ غير صحيح'),
  ('paiement_motif_annulation', 'pas_exact', 'fr', 'Ce n''était pas exact'),
  ('paiement_motif_annulation', 'pas_exact', 'en', 'That was not right'),
  ('paiement_motif_annulation', 'pas_exact', 'ar', 'لم يكن ذلك صحيحًا'),
  ('paiement_motif_annulation', 'regle_depuis', 'fr', 'Réglé depuis'),
  ('paiement_motif_annulation', 'regle_depuis', 'en', 'Paid since'),
  ('paiement_motif_annulation', 'regle_depuis', 'ar', 'سُدّد منذ ذلك الحين')
on conflict (ns, key, locale) do update set value = excluded.value;

-- --- Le TTC lu d'une pièce, en unités mineures --------------------------------------------------

create or replace function capture.ttc_mineur(p_piece uuid, p_devise text)
returns bigint
language sql
stable
security invoker
set search_path = ''
as $$
  -- La dernière lecture, partielle ou entière ; un TTC illisible vaut « inconnu ».
  select round((e.payload -> 'totals' ->> 'ttc')::numeric * power(10, d.exposant))::bigint
    from capture.extractions e
    join ref.devises d on d.code = p_devise
   where e.piece_id = p_piece
     and e.contract like 'extract.v1%'
     and (e.payload -> 'totals' ->> 'ttc') ~ '^[0-9]+(\.[0-9]+)?$'
   order by e.created_at desc
   limit 1
$$;

-- --- Les règles, à l'inscription -------------------------------------------------------------

create or replace function capture.un_reglement_dit_vrai()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ttc  bigint;
  v_paye bigint;
begin
  -- Une annulation n'est pas un règlement : elle a ses propres gardes.
  if new.annule_paiement_id is not null then
    return new;
  end if;

  -- Une seule inscription à la fois par pièce : deux appuis simultanés ne
  -- passent pas tous deux la règle du dépassement.
  perform pg_advisory_xact_lock(hashtextextended(new.piece_id::text, 0));

  if new.moyen_code = 'non_paye' then
    if exists (select 1 from capture.paiements p
                where p.piece_id = new.piece_id and p.annule_paiement_id is null
                  and p.moyen_code <> 'non_paye'
                  and not exists (select 1 from capture.paiements a where a.annule_paiement_id = p.id)) then
      raise exception 'paiement.deja_regle' using errcode = 'check_violation';
    end if;
    if exists (select 1 from capture.paiements p
                where p.piece_id = new.piece_id and p.annule_paiement_id is null
                  and p.moyen_code = 'non_paye'
                  and not exists (select 1 from capture.paiements a where a.annule_paiement_id = p.id)) then
      raise exception 'paiement.deja_non_paye' using errcode = 'check_violation';
    end if;
    new.montant_mineur := null;
    new.paye_le := null;
    return new;
  end if;

  v_ttc := capture.ttc_mineur(new.piece_id, new.devise);
  select coalesce(sum(p.montant_mineur), 0) into v_paye
    from capture.paiements p
   where p.piece_id = new.piece_id and p.annule_paiement_id is null
     and p.moyen_code <> 'non_paye'
     and not exists (select 1 from capture.paiements a where a.annule_paiement_id = p.id);

  if new.montant_mineur is null then
    if v_ttc is null then
      raise exception 'paiement.montant_requis' using errcode = 'check_violation';
    end if;
    new.montant_mineur := v_ttc - v_paye;
    if new.montant_mineur <= 0 then
      raise exception 'paiement.deja_solde' using errcode = 'check_violation';
    end if;
  end if;

  if new.montant_mineur <= 0 then
    raise exception 'paiement.montant_positif' using errcode = 'check_violation';
  end if;

  if v_ttc is not null and v_paye + new.montant_mineur > v_ttc then
    raise exception 'paiement.depasse_le_total' using errcode = 'check_violation';
  end if;

  if new.paye_le is null then
    new.paye_le := current_date;
  end if;
  if new.paye_le > current_date + 1 then
    raise exception 'paiement.date_future' using errcode = 'check_violation';
  end if;

  if exists (select 1 from capture.paiements p
              where p.piece_id = new.piece_id and p.annule_paiement_id is null
                and p.moyen_code = new.moyen_code
                and p.montant_mineur = new.montant_mineur
                and p.paye_le is not distinct from new.paye_le
                and p.created_at > now() - interval '10 seconds'
                and not exists (select 1 from capture.paiements a where a.annule_paiement_id = p.id)) then
    raise exception 'paiement.en_double' using errcode = 'check_violation';
  end if;

  return new;
end
$$;

drop trigger if exists un_reglement_dit_vrai on capture.paiements;
create trigger un_reglement_dit_vrai before insert on capture.paiements
  for each row execute function capture.un_reglement_dit_vrai();

-- --- Un vrai règlement éteint « pas encore payé » ----------------------------------------------

create or replace function capture.un_reglement_eteint_le_non_paye()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.annule_paiement_id is not null or new.moyen_code = 'non_paye' then
    return null;
  end if;
  insert into capture.paiements
    (tenant_id, entity_id, vis, piece_id, moyen_code, pack_version_id,
     montant_mineur, devise, paye_le, annule_paiement_id, annulation_motif_id)
  select p.tenant_id, p.entity_id, p.vis, p.piece_id, p.moyen_code, p.pack_version_id,
         p.montant_mineur, p.devise, p.paye_le, p.id,
         (select m.id from ref.paiement_motifs_annulation m where m.code = 'regle_depuis')
    from capture.paiements p
   where p.piece_id = new.piece_id and p.annule_paiement_id is null
     and p.moyen_code = 'non_paye'
     and not exists (select 1 from capture.paiements a where a.annule_paiement_id = p.id);
  return null;
end
$$;

drop trigger if exists un_reglement_eteint_le_non_paye on capture.paiements;
create trigger un_reglement_eteint_le_non_paye after insert on capture.paiements
  for each row execute function capture.un_reglement_eteint_le_non_paye();

-- --- Corriger d'un geste ----------------------------------------------------------------------

create or replace function public.paiement_corriger(
  p_paiement  uuid,
  p_motif     uuid,
  p_moyen     text,
  p_montant   bigint,
  p_paye_le   date,
  p_reference text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ancien  capture.paiements;
  v_nouveau uuid;
begin
  select * into v_ancien from capture.paiements where id = p_paiement;
  if v_ancien.id is null then
    raise exception 'paiement introuvable ou non autorise' using errcode = '42501';
  end if;
  if v_ancien.moyen_code = 'non_paye' then
    raise exception 'paiement.non_paye_ne_se_corrige_pas' using errcode = 'check_violation';
  end if;

  -- L'ancien d'abord : le total réglé est jugé sans lui, et rien n'existe
  -- entre les deux écritures pour un autre lecteur.
  perform public.paiement_annuler(p_paiement, p_motif);

  insert into capture.paiements
    (tenant_id, entity_id, vis, piece_id, moyen_code, pack_version_id,
     montant_mineur, devise, paye_le, reference)
  values
    (v_ancien.tenant_id, v_ancien.entity_id, v_ancien.vis, v_ancien.piece_id, p_moyen,
     v_ancien.pack_version_id, p_montant, v_ancien.devise, p_paye_le, nullif(trim(p_reference), ''))
  returning id into v_nouveau;

  return v_nouveau;
end
$$;

revoke all on function public.paiement_corriger(uuid, uuid, text, bigint, date, text) from public, anon;
grant execute on function public.paiement_corriger(uuid, uuid, text, bigint, date, text) to authenticated;
