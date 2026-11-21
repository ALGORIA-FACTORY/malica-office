-- Les refus du règlement se disent par une clé `refus.*` (21 novembre 2026).
--
-- Au pilote, un règlement par virement a répondu « Ce geste n'a pas abouti »,
-- deux fois. La base avait pourtant dit pourquoi — `paiement.montant_requis`
-- —, mais la frontière de l'API (`apps/api/src/refus.ts`) ne reconnaît une clé
-- que si elle commence par `refus.` : tout le reste devient `refus.inattendu`.
-- Les clés `paiement.*` étaient donc toutes tues, et le règlement groupé, qui
-- devait SAUTER une facture déjà soldée (`paiement.deja_solde`), s'arrêtait.
--
-- La migration 20261110090100 avait converti les gardes en clés `refus.*` ;
-- celles du règlement, levées sous `paiement.*`, étaient restées. Chaque
-- fonction est recréée depuis sa définition EN VIGUEUR (nommée au-dessus de
-- chacune), seul le message changeant : même corps, même `security definer`,
-- même `set search_path`. `create or replace` garde propriétaire et droits.
-- Les messages suivent sous `refus.paiement.*` en fr, en et ar.
--
-- REJEU (R11) : aucune donnée de référence n'est écrite.

begin;

-- capture.un_reglement_dit_vrai — définition en vigueur : 20261111100000_le_mois_de_tva_suit_l_exigibilite.sql
create or replace function capture.un_reglement_dit_vrai()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_ttc  bigint;
  v_paye bigint;
  v_courante uuid;
  v_versions uuid[];
begin
  -- Une annulation n'est pas un règlement : elle a ses propres gardes, et elle
  -- reste sur la pièce du règlement qu'elle annule.
  if new.annule_paiement_id is not null then
    return new;
  end if;

  -- La pièce appartient au dossier inscrit : la politique d'insertion vérifie
  -- le dossier, pas la pièce, et cette fonction lit (et éteint) au-delà de la
  -- RLS de l'appelant (revue Codex de #101).
  if not exists (select 1 from capture.pieces x
                  where x.id = new.piece_id and x.tenant_id = new.tenant_id) then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;

  v_courante := app.version_courante(new.piece_id);
  select array_agg(v) into v_versions from app.versions_de_la_piece(new.piece_id) v;

  -- Un règlement nouveau ne s'inscrit pas sur une version gelée : c'est la
  -- même facture, il va à sa version courante — avec son établissement et son
  -- côté. La file hors ligne peut porter un identifiant d'avant la reprise ;
  -- la refuser ferait perdre un règlement réel (« rien ne bloque »).
  if new.piece_id <> v_courante then
    select c.id, c.entity_id, c.vis into new.piece_id, new.entity_id, new.vis
      from capture.pieces c where c.id = v_courante;
  end if;

  -- Une seule inscription à la fois par pièce — toutes versions : deux appuis
  -- simultanés, sur l'ancienne et la nouvelle photo, ne passent pas tous deux
  -- la règle du dépassement.
  perform pg_advisory_xact_lock(hashtextextended(v_courante::text, 0));

  if new.moyen_code = 'non_paye' then
    if exists (select 1 from capture.paiements p
                where p.piece_id = any (v_versions) and p.annule_paiement_id is null
                  and p.moyen_code <> 'non_paye'
                  and not exists (select 1 from capture.paiements a where a.annule_paiement_id = p.id)) then
      raise exception 'refus.paiement.deja_regle' using errcode = 'check_violation';
    end if;
    if exists (select 1 from capture.paiements p
                where p.piece_id = any (v_versions) and p.annule_paiement_id is null
                  and p.moyen_code = 'non_paye'
                  and not exists (select 1 from capture.paiements a where a.annule_paiement_id = p.id)) then
      raise exception 'refus.paiement.deja_non_paye' using errcode = 'check_violation';
    end if;
    new.montant_mineur := null;
    new.paye_le := null;
    return new;
  end if;

  v_ttc := capture.ttc_mineur(v_courante);
  -- Ce qui est DÉJÀ éteint (`app.reglements_vivants`).
  select coalesce(sum(r.eteint_mineur), 0) into v_paye from app.reglements_vivants(v_versions) r;

  if new.montant_mineur is null then
    if v_ttc is null then
      raise exception 'refus.paiement.montant_requis' using errcode = 'check_violation';
    end if;
    new.montant_mineur := v_ttc - v_paye;
    if new.montant_mineur <= 0 then
      raise exception 'refus.paiement.deja_solde' using errcode = 'check_violation';
    end if;
  end if;

  if new.montant_mineur <= 0 then
    raise exception 'refus.paiement.montant_positif' using errcode = 'check_violation';
  end if;

  if v_ttc is not null and v_paye + new.montant_mineur > v_ttc then
    raise exception 'refus.paiement.depasse_le_total' using errcode = 'check_violation';
  end if;

  if new.paye_le is null then
    new.paye_le := current_date;
  end if;
  if new.paye_le > current_date + 1 then
    raise exception 'refus.paiement.date_future' using errcode = 'check_violation';
  end if;

  if exists (select 1 from capture.paiements p
              where p.piece_id = any (v_versions) and p.annule_paiement_id is null
                and p.moyen_code = new.moyen_code
                and p.montant_mineur = new.montant_mineur
                and p.paye_le is not distinct from new.paye_le
                and p.created_at > now() - interval '10 seconds'
                and not exists (select 1 from capture.paiements a where a.annule_paiement_id = p.id)) then
    raise exception 'refus.paiement.en_double' using errcode = 'check_violation';
  end if;

  return new;
end
$function$;

-- facturation.reste_du_payable — définition en vigueur : 20261110090200_les_refus_se_disent_par_une_cle_facturation.sql
CREATE OR REPLACE FUNCTION facturation.reste_du_payable(p_facture uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v record;
begin
  select f.payeur_type, f.licence_id, f.payeur_tenant_id, e.etat, e.reste_du into v
    from facturation.factures f
    join facturation.encours_v e on e.facture_id = f.id
   where f.id = p_facture;
  if not found
     or not facturation.peut_payer(
          case when v.payeur_type = 'titulaire' then v.licence_id end,
          case when v.payeur_type = 'cabinet' then v.payeur_tenant_id end) then
    raise exception 'refus.introuvable.facture' using errcode = '42501';
  end if;
  if v.etat not in ('a_echoir', 'en_retard', 'partielle') or v.reste_du <= 0 then
    raise exception 'refus.paiement.facture_rien_a_regler' using errcode = 'check_violation';
  end if;
  return v.reste_du;
end
$function$;

-- public.paiement_corriger — définition en vigueur : 20261110090100_les_refus_se_disent_par_une_cle_public.sql
CREATE OR REPLACE FUNCTION public.paiement_corriger(p_paiement uuid, p_motif uuid, p_moyen text, p_montant bigint, p_paye_le date, p_reference text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_ancien  capture.paiements;
  v_nouveau uuid;
begin
  select * into v_ancien from capture.paiements where id = p_paiement;
  if v_ancien.id is null then
    raise exception 'refus.introuvable.paiement' using errcode = '42501';
  end if;
  if v_ancien.moyen_code = 'non_paye' then
    raise exception 'refus.paiement.non_paye_ne_se_corrige_pas' using errcode = 'check_violation';
  end if;
  if not coalesce((select m.remplace from ref.paiement_motifs_annulation m where m.id = p_motif), false) then
    raise exception 'refus.paiement.motif_qui_retire' using errcode = 'check_violation';
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
$function$;

-- public.paiement_encore_du — définition en vigueur : 20261023130000_une_facture_se_paie_en_ligne.sql
create or replace function public.paiement_encore_du(p_paiement uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p facturation.paiements_en_ligne;
begin
  select * into p from facturation.paiements_en_ligne where id = p_paiement;
  if p.objet is distinct from 'facture' then
    return true;
  end if;
  if facturation.reste_du_payable(p.facture_id) <> p.montant_ttc then
    raise exception 'refus.paiement.montant_perime' using errcode = 'check_violation';
  end if;
  return true;
end
$$;

-- public.paiement_moyen_admis — définition en vigueur : 20261228120000_flouci_ouvre_le_paiement_en_ligne.sql
CREATE OR REPLACE FUNCTION public.paiement_moyen_admis(p_moyen text, p_prestataire text, p_devise text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v jsonb;
begin
  if not facturation.moyen_admis(p_moyen, p_prestataire) then
    raise exception 'refus.paiement.moyen_indisponible' using errcode = 'check_violation';
  end if;
  select jsonb_build_object('iso_numerique', d.iso_numerique, 'exposant', d.exposant) into v
    from ref.devises d where d.code = p_devise;
  if v is null then
    raise exception '%', app.refus_avec_valeurs('refus.referentiel.devise_inconnue', 'devise', (p_devise)::text) using errcode = 'no_data_found';
  end if;
  if not exists (select 1 from facturation.devises_par_prestataire dp
                  where dp.prestataire = p_prestataire and dp.devise = p_devise) then
    raise exception 'refus.paiement.moyen_indisponible' using errcode = 'check_violation';
  end if;
  return v;
end
$function$;

-- public.paiement_inscrire (paiement en ligne, 7 arguments) — définition en vigueur : 20261110090100_les_refus_se_disent_par_une_cle_public.sql
CREATE OR REPLACE FUNCTION public.paiement_inscrire(p_paiement uuid, p_etat text, p_prestataire text, p_reference text DEFAULT NULL::text, p_lien text DEFAULT NULL::text, p_detail jsonb DEFAULT '{}'::jsonb, p_moyen text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_licence uuid;
  v_payeur  uuid;
  v_presta  facturation.prestataires_paiement;
begin
  select p.licence_id, p.payeur_tenant_id into v_licence, v_payeur
    from facturation.paiements_en_ligne p where p.id = p_paiement;
  if not found or not facturation.peut_payer(v_licence, v_payeur) then
    raise exception 'refus.introuvable.paiement' using errcode = '42501';
  end if;
  select * into v_presta from facturation.prestataires_paiement where code = p_prestataire;
  if not found or not v_presta.ouvre_le_paiement then
    raise exception 'refus.paiement.prestataire_inconnu' using errcode = 'check_violation';
  end if;
  -- Un prestataire qui ne fait entrer aucun argent n'est admis que si l'API l'a
  -- déclaré pour la transaction, ce qu'elle ne fait que si la tour l'a ouvert.
  if not v_presta.fait_entrer_argent
     and coalesce(current_setting('malica.paiement_simulateur', true), '') <> 'oui' then
    raise exception 'refus.paiement.simulateur_ferme' using errcode = '42501';
  end if;
  -- Le lien se crée pour un moyen choisi, actif, que ce prestataire accepte.
  if p_etat = 'lien_cree' and not facturation.moyen_admis(p_moyen, p_prestataire) then
    raise exception 'refus.paiement.moyen_indisponible' using errcode = 'check_violation';
  end if;
  -- « Payé » ou « refusé » se constate chez le prestataire qui a créé le lien,
  -- et chez lui seul : un simulateur ouvert après coup ne solde pas un
  -- paiement parti chez un prestataire réel (dont le vrai « payé » serait
  -- ensuite refusé par l'index « payé une fois »).
  if p_etat in ('paye', 'refuse') and p_prestataire is distinct from (
       select e.prestataire from facturation.paiement_evenements e
        where e.paiement_id = p_paiement and e.etat = 'lien_cree'
        order by e.le desc, e.id desc limit 1) then
    raise exception 'refus.paiement.prestataire_du_lien' using errcode = 'check_violation';
  end if;
  if p_etat = 'paye' and exists (select 1 from facturation.paiement_evenements e
                                  where e.paiement_id = p_paiement and e.etat = 'paye') then
    -- Déjà constaté : on ne le compte pas deux fois, on le rend.
    return (select to_jsonb(v) from facturation.paiements_en_ligne_v v where v.paiement_id = p_paiement);
  end if;

  insert into facturation.paiement_evenements
    (paiement_id, etat, prestataire, reference, lien, detail, moyen)
  values (p_paiement, p_etat, p_prestataire, p_reference, p_lien, coalesce(p_detail, '{}'::jsonb),
          case when p_etat = 'lien_cree' then p_moyen end);

  if p_etat = 'paye' then
    insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
    select coalesce(v_payeur, lo.tenant_id), auth.uid(), 'paiement.recu', 'facturation',
           'paiements_en_ligne', p_paiement,
           jsonb_build_object('prestataire', p_prestataire, 'reference', p_reference)
      from (select 1) un
      left join lateral (
        select x.tenant_id from facturation.licence_organisations x
         where x.licence_id = v_licence order by x.tenant_id limit 1) lo on true
     where coalesce(v_payeur, lo.tenant_id) is not null;
  end if;

  return (select to_jsonb(v) from facturation.paiements_en_ligne_v v where v.paiement_id = p_paiement);
end
$function$;

commit;
