-- Un motif qui retire, un motif qui remplace.
--
-- « Inscrit en double », « Annulé par la banque » : le règlement n'a pas eu
-- lieu, rien ne le remplace. « Mauvais montant », « mauvais moyen »,
-- « mauvaise date » : il a eu lieu, autrement. L'écran de correction ne peut
-- pas le deviner — le référentiel le dit (relevé par la revue de #102).

alter table ref.paiement_motifs_annulation
  add column if not exists remplace boolean not null default true;

comment on column ref.paiement_motifs_annulation.remplace is
  'Vrai : la correction réinscrit un règlement (paiement_corriger). Faux : le règlement est seulement retiré (paiement_annuler).';

update ref.paiement_motifs_annulation
   set remplace = false
 where code in ('inscrit_en_double', 'paiement_annule_par_la_banque', 'pas_exact', 'regle_depuis');

-- Corriger avec un motif qui retire serait affirmer un règlement qui n'existe pas.
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
  if not coalesce((select m.remplace from ref.paiement_motifs_annulation m where m.id = p_motif), false) then
    raise exception 'paiement.motif_qui_retire' using errcode = 'check_violation';
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
