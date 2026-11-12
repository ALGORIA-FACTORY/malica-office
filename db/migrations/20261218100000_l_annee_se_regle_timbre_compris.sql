-- ======================================================================
--  L'année se règle timbre compris : une seule vérité TTC (recette du
--  11 novembre 2026, point 1.8).
--
--  LE DÉFAUT. L'écran annonçait « 227,100 TND TTC pour l'année »
--  (`mon_annuel`, par `public.prix_ttc` : HT + TVA + timbre) ; la ligne
--  « À régler » portait 226,100 (`annuel_souscrire` : HT + TVA, sans timbre).
--  Deux calculs du même montant, et deux résultats.
--
--  LA RÈGLE. Le TTC d'une année est celui de `public.prix_ttc` sur son montant
--  HT, le jour de la souscription : HT + TVA + le droit de timbre de la
--  facture qui la porte. L'acompte de l'année le porte en entier ; `mon_annuel`
--  le rend, proposé comme en cours, depuis la même fonction. L'écran n'en
--  calcule aucun.
--
--  CE QUE ÇA CHANGE. Un paiement en ligne porte désormais son `timbre` (zéro
--  pour tout ce qui n'est pas l'année : la montée et la recharge s'imputent sur
--  une facture qui porte déjà le sien). La cohérence devient HT + TVA + timbre.
--
--  REJEU (R11) : colonne au défaut constant (zéro), aucune donnée de
--  référence écrite.
-- ======================================================================

alter table facturation.paiements_en_ligne
  add column timbre app.money_t not null default 0
    constraint paiements_en_ligne_timbre_check check (timbre >= 0);

comment on column facturation.paiements_en_ligne.timbre is
  'Le droit de timbre que ce paiement règle d''avance : celui de la facture qui portera l''année. '
  'Zéro pour une montée ou une recharge, qui s''imputent sur une facture portant déjà le sien.';

alter table facturation.paiements_en_ligne drop constraint paiements_ttc_coherent;
alter table facturation.paiements_en_ligne
  add constraint paiements_ttc_coherent
    check (objet = 'facture' or montant_ttc = montant_ht + montant_tva + timbre);

/*
 * Repris de sa définition en vigueur (20261110090100) ; seul change l'acompte :
 * son TTC est celui de `public.prix_ttc`, timbre compris.
 */
create or replace function public.annuel_souscrire(p_tenant uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_etat     jsonb := public.mon_annuel(p_tenant);
  v_licence  uuid;
  v_prop     jsonb;
  v_id       uuid;
  v_pid      uuid;
  v_ht       numeric;
  v_ttc      jsonb;
begin
  if p_tenant is null then
    select l.id into v_licence from facturation.licences l
     where l.titulaire = auth.uid() order by l.id limit 1;
  else
    select l.id into v_licence
      from facturation.licences l
      join facturation.licence_organisations lo on lo.licence_id = l.id
     where lo.tenant_id = p_tenant and l.titulaire = auth.uid();
  end if;
  if v_licence is null
     or not facturation.titulaire_de(v_licence)
     or not exists (select 1 from facturation.licence_organisations lo
                     where lo.licence_id = v_licence
                       and app.has_org_role(lo.tenant_id, array['dirigeant'])) then
    raise exception 'refus.reserve.proprietaire_principal' using errcode = '42501';
  end if;
  if v_etat -> 'en_cours' <> 'null'::jsonb then
    raise exception '%', app.refus_avec_valeurs('refus.annuel.ferme', 'motif', 'deja_engage') using errcode = 'check_violation';
  end if;
  if v_etat ->> 'ferme' is not null then
    raise exception '%', app.refus_avec_valeurs('refus.annuel.ferme', 'motif', (v_etat ->> 'ferme')::text) using errcode = 'check_violation';
  end if;

  v_prop := v_etat -> 'proposition';
  insert into facturation.engagements_annuels
    (licence_id, offre_code, du, au, prix_mensuel_ht, mois_offerts, montant_ht, souscrit_par)
  values
    (v_licence, v_prop ->> 'offre', (v_prop ->> 'du')::date, (v_prop ->> 'au')::date,
     (v_prop ->> 'prix_mensuel_ht')::numeric, (v_prop ->> 'mois_offerts')::smallint,
     (v_prop ->> 'montant_ht')::numeric, auth.uid())
  returning id into v_id;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  select lo.tenant_id, auth.uid(), 'abonnement.annuel', 'facturation', 'engagements_annuels', v_id, v_prop
    from facturation.licence_organisations lo
   where lo.licence_id = v_licence
   order by lo.tenant_id limit 1;

  -- Le paiement : seulement s'il y a un émetteur (R4) ; sinon la facture du
  -- premier mois portera la ligne, et le paiement suivra la facture.
  if exists (select 1 from facturation.emetteurs e where e.valide_des <= current_date) then
    v_ht  := (v_prop ->> 'montant_ht')::numeric;
    v_ttc := public.prix_ttc(v_ht, current_date);
    insert into facturation.paiements_en_ligne
      (licence_id, objet, engagement_id, libelle, montant_ht, taux_tva, montant_tva, timbre,
       montant_ttc, devise, cree_par)
    values
      (v_licence, 'annuel', v_id,
       'Abonnement annuel ' || initcap(v_prop ->> 'offre') || ' — du '
         || to_char((v_prop ->> 'du')::date, 'DD/MM/YYYY') || ' au '
         || to_char((v_prop ->> 'au')::date, 'DD/MM/YYYY'),
       v_ht, (v_ttc ->> 'taux')::numeric, (v_ttc ->> 'tva')::numeric,
       (v_ttc ->> 'timbre')::numeric, (v_ttc ->> 'ttc')::numeric, v_ttc ->> 'devise', auth.uid())
    returning id into v_pid;
  end if;

  return jsonb_build_object(
    'engagement', v_id,
    'paiement', (select to_jsonb(v) from facturation.paiements_en_ligne_v v where v.paiement_id = v_pid));
end
$function$

;

/*
 * Repris de sa définition en vigueur ; l'année en cours dit aussi son TTC,
 * relu sur l'acompte qui la règle (sinon recalculé par `public.prix_ttc` au
 * jour de la souscription).
 */
create or replace function public.mon_annuel(p_tenant uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_licence  uuid;
  v_regle    jsonb := public.abonnement_reglage();
  v_offerts  smallint := (v_regle ->> 'annuel_mois_offerts')::smallint;
  v_courant  record;
  v_en_cours facturation.engagements_annuels;
  v_du       date;
  v_prix     numeric;
  v_ferme    text;
begin
  if p_tenant is null then
    select l.id into v_licence from facturation.licences l
     where l.titulaire = auth.uid() order by l.id limit 1;
  else
    select l.id into v_licence
      from facturation.licences l
      join facturation.licence_organisations lo on lo.licence_id = l.id
     where lo.tenant_id = p_tenant and l.titulaire = auth.uid();
  end if;
  if v_licence is null then
    return null;   -- seul le propriétaire principal voit l'année : c'est lui qui paie.
  end if;

  -- L'échéance suivante d'une PME payée d'avance ; sinon le mois prochain.
  select x.couvre_au into v_du
    from facturation.factures x
   where x.licence_id = v_licence and x.payeur_type = 'titulaire' and x.ancre is not null
     and x.avoir_de is null and x.statut <> 'annulee'
     and x.couvre_du <= current_date and x.couvre_au > current_date
   order by x.couvre_au desc limit 1;
  v_du := coalesce(v_du, (date_trunc('month', current_date) + interval '1 month')::date);

  -- L'engagement en cours, ou celui qui commencera à la prochaine échéance.
  select e.* into v_en_cours from facturation.engagements_annuels e
   where e.licence_id = v_licence and e.au >= current_date
   order by e.du desc limit 1;
  if v_en_cours.id is not null then
    return jsonb_build_object(
      'en_cours', jsonb_build_object(
        'du', v_en_cours.du, 'au', v_en_cours.au, 'offre', v_en_cours.offre_code,
        'montant_ht', v_en_cours.montant_ht, 'mois_offerts', v_en_cours.mois_offerts,
        'ttc', coalesce(
          (select p.montant_ttc::numeric from facturation.paiements_en_ligne p
            where p.engagement_id = v_en_cours.id),
          (public.prix_ttc(v_en_cours.montant_ht, v_en_cours.souscrit_le::date) ->> 'ttc')::numeric)));
  end if;

  select h.offre_code, h.offre_depuis into v_courant
    from facturation.forfait_courant_v h where h.licence_id = v_licence;
  select o.prix_mensuel_ht into v_prix from ref.offre_a(v_courant.offre_code, v_courant.offre_depuis) o;

  v_ferme := case
    when not coalesce((v_regle ->> 'annuel_ouvert')::boolean, false) then 'annuel_ferme'
    when v_prix is null or v_prix <= 0 then 'offre_sans_prix'
    when exists (select 1 from facturation.payeurs_v pv
                  where pv.licence_id = v_licence and pv.payeur_type = 'cabinet'
                    and (pv.au_exclu is null or pv.au_exclu > current_date)) then 'paye_par_un_cabinet'
    when exists (select 1 from facturation.licences l
                  where l.id = v_licence and l.statut <> 'active') then 'licence_inactive'
    else null end;

  -- La comptabilité paie : aucune proposition, donc aucun prix.
  if v_ferme = 'paye_par_un_cabinet' then
    return jsonb_build_object('en_cours', null, 'ferme', v_ferme, 'proposition', null);
  end if;

  return jsonb_build_object(
    'en_cours', null,
    'ferme', v_ferme,
    'proposition', case when v_prix is null then null else jsonb_build_object(
      'offre', v_courant.offre_code,
      'du', v_du,
      'au', (v_du + interval '12 months - 1 day')::date,
      'prix_mensuel_ht', v_prix,
      'mois_offerts', v_offerts,
      'montant_ht', v_prix * (12 - v_offerts),
      'ttc', (public.prix_ttc(v_prix * (12 - v_offerts)) ->> 'ttc')::numeric) end);
end
$function$

;
