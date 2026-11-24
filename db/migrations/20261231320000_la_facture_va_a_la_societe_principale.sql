-- La facture va à la société principale de l'abonnement, pas à la première venue par identifiant.
--
-- Recette du pilote (24 novembre 2026) : un dirigeant qui crée une deuxième société la rattache à
-- SON abonnement. La page de paiement affichait alors « Facturé à : » la société de test qu'il
-- venait de créer — l'ordre retenu partout était `order by lo.tenant_id limit 1`, c'est-à-dire le
-- hasard des identifiants. La société principale d'un abonnement est la première rattachée
-- (`rattachee_le`), l'identifiant ne départageant que deux rattachements simultanés.
--
-- Une seule règle, la même partout où une facture, un paiement ou un avis désigne LA société d'une
-- licence. Les fonctions sont reprises de leur définition EN VIGUEUR ; seul l'ordre change.
-- _Gardé par_ apps/api/src/facturation/la-facture-dit-a-qui-elle-s-adresse.test.ts.

begin;

CREATE OR REPLACE FUNCTION facturation.recharge_inscrire(p_licence uuid, p_code text, p_origine text, p_par uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_palier ref.recharges;
  v_id     uuid;
begin
  v_palier := ref.recharge_a(p_code, current_date);
  if v_palier.code is null then
    raise exception 'refus.recharge.palier_inconnu' using errcode = 'check_violation';
  end if;

  insert into facturation.recharges
    (licence_id, recharge_code, lectures, prix_ht, achetee_le, expire_le, origine, achetee_par)
  values
    (p_licence, v_palier.code, v_palier.lectures, v_palier.prix_ht, current_date,
     case when v_palier.validite_mois is null then 'infinity'::date
          else (current_date + make_interval(months => v_palier.validite_mois))::date end, p_origine, p_par)
  returning id into v_id;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  select lo.tenant_id, p_par, 'recharge.achetee', 'facturation', 'recharges', v_id,
         jsonb_build_object('palier', v_palier.code, 'origine', p_origine,
                            'lectures', v_palier.lectures, 'prix_ht', v_palier.prix_ht)
    from facturation.licence_organisations lo
   where lo.licence_id = p_licence
   order by lo.rattachee_le, lo.tenant_id
   limit 1;

  return v_id;
end
$function$

;

CREATE OR REPLACE FUNCTION public.annuel_souscrire(p_tenant uuid DEFAULT NULL::uuid)
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
   order by lo.rattachee_le, lo.tenant_id limit 1;

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

CREATE OR REPLACE FUNCTION notif.relancer_les_impayes()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r          record;
  v_reglage  jsonb := plateforme.relances_reglage();
  v_susp     numeric;
  v_tenant   uuid;
  v_n        integer;
  v_cle      text;
  v_donnees  jsonb;
  d          record;
  v_postes   integer := 0;
  v_retenues integer := 0;
  v_suspendues integer := 0;
  v_erreurs  integer := 0;
begin
  if not (v_reglage ->> 'actives')::boolean then
    return jsonb_build_object('actives', false);
  end if;
  -- Un seul ordonnanceur à la fois, même si deux API tournent.
  if not pg_try_advisory_xact_lock(hashtext('notif.relancer_les_impayes')) then
    return jsonb_build_object('actives', true, 'deja_en_cours', true);
  end if;

  select sp.value_num into v_susp from ref.socle_params sp
   where sp.code = 'recouvrement.suspension_jours'
     and sp.valid_from <= current_date and (sp.valid_to is null or sp.valid_to >= current_date)
   order by sp.valid_from desc limit 1;

  for r in
    select a.*, f.devise
      from facturation.a_relancer_v a
      join facturation.factures f on f.id = a.facture_id
     where a.palier is not null
  loop
    v_cle := r.facture_id::text || ':' || r.palier;
    -- Une fois par facture et par palier, pour toujours : ce qui est décidé
    -- ne se redit pas, et un passage horaire n'inscrit rien de plus. Le
    -- courriel est décidé quand une ligne `email` existe, quelle que soit la
    -- décision des verrous (envoyé, retenu par le silence ou la préférence).
    if exists (select 1 from notif.envois e
                where e.destinataire = r.titulaire
                  and e.code = 'impaye.' || r.palier
                  and e.sujet_cle = v_cle
                  and e.canal = 'email') then
      continue;
    end if;

    -- Au dernier palier, l'annonce dit que la licence EST suspendue : elle ne
    -- part que si c'est vrai — suspendue ici par la machine, ou déjà par la
    -- tour. Sinon la suspension reste le geste de la tour, et l'avis déjà
    -- envoyé suffit.
    if r.palier = 'suspension' then
      if r.statut_licence = 'active' and (v_reglage ->> 'suspension_automatique')::boolean then
        update facturation.licences
           set statut = 'suspendue', suspendue_le = now(), motif_suspension = 'impaye',
               updated_at = now()
         where id = r.licence_id and statut = 'active';
        insert into plateforme.interventions (licence_id, acte, motif, avant, operateur)
        values (r.licence_id, 'suspension',
                'Suspension automatique : facture ' || r.numero || ' due depuis '
                  || r.jours_de_retard || ' jours',
                'active', null);
        v_suspendues := v_suspendues + 1;
      elsif r.statut_licence <> 'suspendue' then
        v_retenues := v_retenues + 1;
        continue;
      end if;
    end if;

    select lo.tenant_id into v_tenant
      from facturation.licence_organisations lo
      join identity.memberships m on m.tenant_id = lo.tenant_id and m.user_id = r.titulaire
     where lo.licence_id = r.licence_id
     order by lo.rattachee_le, lo.tenant_id limit 1;

    v_donnees := jsonb_build_object(
          'numero', r.numero,
          'echeance', to_char(r.echeance_le, 'DD/MM/YYYY'),
          'reste', to_char(r.reste_du, 'FM999G999G990D000'),
          'devise', r.devise,
          'jours', r.jours_de_retard,
          'date_suspension', to_char(r.echeance_le + coalesce(v_susp, 0)::int, 'DD/MM/YYYY'),
          'en_attente', (select count(*) from capture.pieces p
                           join facturation.licence_organisations lo on lo.tenant_id = p.tenant_id
                          where lo.licence_id = r.licence_id and p.status = 'capturee'
                            and p.vis <> 'personnel'::app.vis_t));

    -- Revue de #402 (Codex, P2) : la ligne de l'application déjà remise, seul le
    -- courriel manque — un canal qui avait échoué (gabarit absent, par exemple)
    -- et que `notif.emettre` a laissé au journal. Il se reposte seul, sans
    -- seconde ligne dans l'application ; avant, la ligne de l'application
    -- suffisait à taire le courriel pour toujours.
    if exists (select 1 from notif.envois e
                where e.destinataire = r.titulaire
                  and e.code = 'impaye.' || r.palier
                  and e.sujet_cle = v_cle
                  and e.canal = 'app'
                  and e.decision = 'a_remettre') then
      for d in select x.canal, x.gabarit from notif.diffusions x
                where x.code = 'impaye.' || r.palier
                  and x.canal = 'email'
                  and x.valid_from <= current_date
                  and (x.valid_to is null or x.valid_to > current_date) loop
        begin
          perform notif.poster(r.titulaire, d.gabarit, v_cle, v_donnees, v_tenant, d.canal,
                               interval '400 days');
          v_postes := v_postes + 1;
        exception when others then
          v_erreurs := v_erreurs + 1;
        end;
      end loop;
      continue;
    end if;

    -- Par courriel si la personne le veut ; sinon, dans l'application seule.
    begin
      -- Une seule porte : la ligne de l'application, et le courriel que la
      -- table des diffusions prévoit pour ce palier — avec les mêmes verrous.
      v_n := notif.emettre(
        v_tenant,
        'impaye.' || r.palier,
        v_donnees,
        r.titulaire,
        v_cle,
        interval '400 days');
      if v_n > 0 then
        v_postes := v_postes + 1;
      else
        v_retenues := v_retenues + 1;
      end if;
    exception when others then
      v_erreurs := v_erreurs + 1;
    end;
  end loop;

  return jsonb_build_object('actives', true, 'postes', v_postes, 'retenues', v_retenues,
                            'suspendues', v_suspendues, 'erreurs', v_erreurs);
end
$function$

;

CREATE OR REPLACE FUNCTION facturation.emission_du_titulaire(p_licence uuid, p_nature text, p_du date, p_au date, p_periode_du date, p_ancre date, p_tarif_mensuel numeric, p_inclut_la_base boolean, p_offre text, p_reference text, p_jour date, p_acteur uuid, p_jours_echeance integer DEFAULT 15)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c          record;
  f          record;
  v_jours    integer := p_au - p_du;
  v_jdp      integer := p_au - p_periode_du;
  v_nom      text;
  v_part     numeric := p_tarif_mensuel;
  v_abo      numeric := round(p_tarif_mensuel * (p_au - p_du) / (p_au - p_periode_du), 3);
  v_par_an   numeric := 0;
  v_annuel   facturation.engagements_annuels;
  v_debut    facturation.engagements_annuels;
  v_recharge record;
  v_montee   record;
  v_paiement record;
  v_ht       numeric;
  v_tva      numeric;
  v_numero   text;
  v_id       uuid;
  v_enc      uuid;
  v_ordinal  smallint := 0;
  v_dates    text := 'du ' || to_char(p_du, 'DD/MM/YYYY') || ' au '
                     || to_char(p_au - 1, 'DD/MM/YYYY')
                     || case when p_au - p_du <> p_au - p_periode_du
                             then ' (' || (p_au - p_du) || '/' || (p_au - p_periode_du) || ' jours)'
                             else '' end;
begin
  select * into c from facturation.consommation_v where licence_id = p_licence;
  if c.licence_id is null then
    raise exception 'refus.introuvable.licence' using errcode = 'no_data_found';
  end if;

  if exists (select 1 from facturation.factures x
              where x.licence_id = p_licence and x.payeur_type = 'titulaire'
                and x.payeur_personne = c.titulaire and x.nature = p_nature
                and x.couvre_du = p_du and x.avoir_de is null)
     or (p_nature = 'base' and exists (
           select 1 from facturation.factures x
            where x.licence_id = p_licence and x.payeur_type = 'titulaire'
              and x.payeur_personne = c.titulaire and x.nature = 'base'
              and x.avoir_de is null and x.statut <> 'annulee'
              and daterange(x.couvre_du, x.couvre_au, '[)') && daterange(p_du, p_au, '[)'))) then
    return jsonb_build_object('deja', true);
  end if;
  -- Une licence sans société n'est pas encore servie : rien à facturer.
  if coalesce(c.organisations, 0) < 1 then
    return jsonb_build_object('rien', true);
  end if;

  select p.display_name into v_nom from identity.profiles p where p.user_id = c.titulaire;
  if v_nom is null or length(btrim(v_nom)) = 0 then
    raise exception '%', app.refus_avec_valeurs('refus.facturation.destinataire_sans_nom',
                                                'destinataire', (c.titulaire)::text)
      using errcode = 'no_data_found';
  end if;

  select * into f from facturation.fiscalite_en_vigueur(p_jour);
  if f.timbre is null then
    raise exception 'refus.referentiel.manquant' using errcode = 'no_data_found';
  end if;

  if p_nature = 'base' then
    -- L'ANNÉE (20261022190000) : l'offre des jours couverts est payée par
    -- l'engagement ; il ne reste que les places et sociétés en plus.
    v_annuel := facturation.annuel_de(p_licence, p_du);
    if v_annuel.id is not null then
      v_part := greatest(0, p_tarif_mensuel - v_annuel.prix_mensuel_ht);
    end if;
    -- Jour par jour : une montée pendant l'année change le prix couvert (7.5).
    select coalesce(round(sum((facturation.annuel_de(p_licence, j::date)).prix_mensuel_ht) / v_jdp, 3), 0)
      into v_par_an
      from generate_series(p_du, p_au - 1, interval '1 day') j;
    v_abo := greatest(0, v_abo - v_par_an);
    select e.* into v_debut from facturation.engagements_annuels e
     where e.licence_id = p_licence and e.du < p_au
       and not exists (select 1 from facturation.facture_annuels fa where fa.engagement_id = e.id)
     order by e.souscrit_le limit 1;
    select (v_abo + coalesce(v_debut.montant_ht, 0) + coalesce(sum(x.prix_ht), 0)) into v_ht
      from facturation.recharges x
     where x.licence_id = p_licence and x.achetee_le <= p_jour
       and not exists (select 1 from facturation.facture_recharges fr where fr.recharge_id = x.id);
    v_ht := v_ht + facturation.annuel_montees_a_facturer(p_licence, p_jour + 1);
  else
    v_ht := v_abo;
  end if;

  -- Rien à payer (l'année couvre tout, ou un écart qui s'arrondit à zéro) :
  -- aucune facture, qui ne porterait qu'un timbre.
  if v_ht <= 0 then
    return jsonb_build_object('couvert', case when v_annuel.id is not null then 'annuel' end);
  end if;

  v_tva    := round(v_ht * f.taux, 3);
  v_numero := facturation.numero_de_facture(p_jour);

  insert into facturation.factures
    (licence_id, numero, periode, emise_le, echeance_le, offre_code, organisations,
     sieges_payants, montant_ht, taux_tva, montant_tva, timbre, montant_ttc, devise,
     payeur_type, payeur_tenant_id, payeur_personne, destinataire_nom, destinataire_legal_id,
     reference_abonne, nature, couvre_du, couvre_au, ancre, part_mensuelle_ht, inclut_la_base)
  values
    (p_licence, v_numero, date_trunc('month', p_du)::date, p_jour, p_jour + p_jours_echeance,
     p_offre, c.organisations, greatest(0, c.sieges_occupes - c.sieges_inclus), v_ht, f.taux,
     v_tva, f.timbre, v_ht + v_tva + f.timbre, f.devise,
     'titulaire', null, c.titulaire, v_nom, null,
     p_reference, p_nature, p_du, p_au, p_ancre, v_part, p_inclut_la_base)
  returning id into v_id;

  if p_nature = 'complement' then
    v_ordinal := 1;
    insert into facturation.facture_lignes
      (facture_id, ordinal, libelle, quantite, prix_unitaire, montant_ht)
    values (v_id, 1,
            'Complément d''abonnement ' || coalesce((ref.offre_a(p_offre, p_du)).libelle, p_offre)
              || ' (offre, places ou sociétés en plus) — ' || v_dates,
            1, v_abo, v_abo);
  elsif v_annuel.id is null and v_par_an = 0 then
    v_ordinal := 1;
    insert into facturation.facture_lignes
      (facture_id, ordinal, libelle, quantite, prix_unitaire, montant_ht)
    values (v_id, 1, 'Abonnement ' || coalesce((ref.offre_a(p_offre, p_du)).libelle, p_offre) || ' — ' || v_dates, 1, v_abo, v_abo);
  elsif v_abo > 0 then
    v_ordinal := 1;
    insert into facturation.facture_lignes
      (facture_id, ordinal, libelle, quantite, prix_unitaire, montant_ht)
    values (v_id, 1,
            case when v_annuel.id is not null
                 then 'Places et sociétés en plus — ' || v_dates
                      || ' (l''offre est couverte par l''abonnement annuel)'
                 else 'Abonnement ' || coalesce((ref.offre_a(p_offre, p_du)).libelle, p_offre) || ' — ' || v_dates
                      || ' (hors jours couverts par l''abonnement annuel)' end,
            1, v_abo, v_abo);
  end if;

  if p_nature = 'base' then
    if v_debut.id is not null then
      v_ordinal := v_ordinal + 1;
      insert into facturation.facture_lignes
        (facture_id, ordinal, libelle, quantite, prix_unitaire, montant_ht)
      values (v_id, v_ordinal,
              'Abonnement annuel ' || coalesce((ref.offre_a(v_debut.offre_code, v_debut.du)).libelle, v_debut.offre_code) || ' — du '
                || to_char(v_debut.du, 'DD/MM/YYYY') || ' au ' || to_char(v_debut.au, 'DD/MM/YYYY')
                || ' (12 mois, ' || v_debut.mois_offerts || ' offerts)',
              1, v_debut.montant_ht, v_debut.montant_ht);
      insert into facturation.facture_annuels (facture_id, engagement_id) values (v_id, v_debut.id);
    end if;

    for v_montee in
      select m.id, m.libelle, m.montant_ht
        from facturation.engagement_montees m
       where m.licence_id = p_licence and m.le <= p_jour
         and not exists (select 1 from facturation.facture_engagement_montees fm
                          where fm.montee_id = m.id)
       order by m.le, m.created_at
    loop
      v_ordinal := v_ordinal + 1;
      insert into facturation.facture_lignes
        (facture_id, ordinal, libelle, quantite, prix_unitaire, montant_ht)
      values (v_id, v_ordinal, v_montee.libelle, 1, v_montee.montant_ht, v_montee.montant_ht);
      insert into facturation.facture_engagement_montees (facture_id, montee_id)
      values (v_id, v_montee.id);
    end loop;

    for v_recharge in
      select x.id, x.lectures, x.prix_ht, x.achetee_le, x.origine
        from facturation.recharges x
       where x.licence_id = p_licence and x.achetee_le <= p_jour
         and not exists (select 1 from facturation.facture_recharges fr where fr.recharge_id = x.id)
       order by x.achetee_le, x.id
    loop
      v_ordinal := v_ordinal + 1;
      insert into facturation.facture_lignes
        (facture_id, ordinal, libelle, quantite, prix_unitaire, montant_ht)
      values (v_id, v_ordinal,
              'Recharge ' || v_recharge.lectures || ' lectures'
                || case when v_recharge.origine = 'automatique' then ' (automatique)' else '' end
                || ' — ' || to_char(v_recharge.achetee_le, 'DD/MM/YYYY'),
              1, v_recharge.prix_ht, v_recharge.prix_ht);
      insert into facturation.facture_recharges (facture_id, recharge_id) values (v_id, v_recharge.id);
    end loop;

    -- Les acomptes payés en ligne (montée d'avant, recharge, année) s'imputent
    -- ici ; le paiement d'une facture s'est inscrit sur ELLE, à la confirmation.
    for v_paiement in
      select p.id, p.montant_ttc, e.reference, e.prestataire, e.le::date as le,
             facturation.moyen_encaissement_du_paiement(p.id) as moyen
        from facturation.paiements_en_ligne p
        join facturation.paiement_evenements e on e.paiement_id = p.id and e.etat = 'paye'
        join facturation.prestataires_paiement pp on pp.code = e.prestataire
                                                 and pp.fait_entrer_argent
       where p.licence_id = p_licence
         and p.objet <> 'facture'
         and not exists (select 1 from facturation.paiement_imputations i where i.paiement_id = p.id)
       order by e.le, p.id
    loop
      insert into facturation.encaissements
        (facture_id, montant, moyen, reference, encaisse_le, saisi_par)
      values (v_id, v_paiement.montant_ttc, v_paiement.moyen,
              v_paiement.prestataire || ' ' || coalesce(v_paiement.reference, v_paiement.id::text),
              v_paiement.le, coalesce(auth.uid(), p_acteur))
      returning id into v_enc;
      insert into facturation.paiement_imputations (paiement_id, encaissement_id)
      values (v_paiement.id, v_enc);
    end loop;
  end if;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  select lo.tenant_id, p_acteur, 'facture.emise', 'facturation', 'factures', v_id,
         jsonb_build_object('numero', v_numero, 'nature', p_nature, 'du', p_du, 'au', p_au,
                            'ttc', v_ht + v_tva + f.timbre, 'par', 'facturation_automatique')
    from facturation.licence_organisations lo
   where lo.licence_id = p_licence
   order by lo.rattachee_le, lo.tenant_id limit 1;
  perform facturation.avertir_de_la_facture(v_id);

  return jsonb_build_object('facture_id', v_id, 'numero', v_numero, 'nature', p_nature,
                            'du', p_du, 'au', p_au, 'ht', v_ht, 'ttc', v_ht + v_tva + f.timbre);
end
$function$

;

CREATE OR REPLACE FUNCTION facturation.avertir_de_la_facture(p_facture uuid, p_fenetre interval DEFAULT '24:00:00'::interval)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  f          facturation.factures;
  v_tenant   uuid;
  v_exposant smallint;
  v_ttc      text;
  v_reglee   boolean;
  v_expert   uuid;
  v_n        integer := 0;
begin
  select x.* into f from facturation.factures x where x.id = p_facture;
  if f.id is null or f.payeur_type not in ('titulaire', 'cabinet') then
    return 0;
  end if;
  select d.exposant into v_exposant from ref.devises d where d.code = f.devise;
  v_ttc := to_char(f.montant_ttc, 'FM999G999G990'
                     || case when coalesce(v_exposant, 0) > 0
                             then 'D' || repeat('0', v_exposant) else '' end);

  -- La facture du mois d'une comptabilité : à chacun de ses experts, en application et par
  -- courriel. Une ligne par société et par offre ; on dit combien d'abonnements elle porte.
  if f.payeur_type = 'cabinet' then
    for v_expert in
      select m.user_id from identity.memberships m
       where m.tenant_id = f.payeur_tenant_id and m.role = 'expert'
       order by m.created_at
    loop
      v_n := v_n + notif.emettre(
        f.payeur_tenant_id,
        'facture.emise.cabinet',
        jsonb_build_object(
          'facture_id',  f.id,
          'numero',      f.numero,
          'periode',     to_char(f.periode, 'MM/YYYY'),
          'abonnements', f.organisations::text,
          'ttc',         v_ttc,
          'devise',      f.devise,
          'echeance',    to_char(f.echeance_le, 'DD/MM/YYYY')),
        v_expert,
        'facture:' || f.id::text,
        p_fenetre);
    end loop;
    return v_n;
  end if;

  select lo.tenant_id into v_tenant
    from facturation.licence_organisations lo
   where lo.licence_id = f.licence_id
   order by lo.rattachee_le, lo.tenant_id limit 1;

  -- Réglée : payée d'abord (une montée, 20261231240000 : la facture naît réglée par le paiement
  -- qui l'a fait émettre), ou déjà entièrement encaissée (un renvoi). Elle le dit, au lieu de
  -- « à régler avant ».
  v_reglee := (coalesce(current_setting('malica.paye_d_abord_le', true), '') = f.emise_le::text
               and f.couvre_du <= f.emise_le and f.couvre_au > f.emise_le)
              or exists (select 1 from facturation.encours_v e
                          where e.facture_id = f.id and e.etat = 'payee');

  -- Les jetons de ses gabarits (app et courriel, fr/en/ar) : tous, et rien d'autre.
  return notif.emettre(
    v_tenant,
    case when v_reglee then 'facture.reglee.pme' else 'facture.emise.pme' end,
    jsonb_build_object(
      'facture_id', f.id,
      'numero',     f.numero,
      'offre',      coalesce((ref.offre_a(f.offre_code, f.couvre_du)).libelle, f.offre_code),
      'periode',    to_char(f.periode, 'MM/YYYY'),
      'du',         to_char(f.couvre_du, 'DD/MM/YYYY'),
      'au',         to_char(f.couvre_au - 1, 'DD/MM/YYYY'),
      'ttc',        v_ttc,
      'devise',     f.devise,
      'echeance',   to_char(f.echeance_le, 'DD/MM/YYYY')),
    f.payeur_personne,
    'facture:' || f.id::text,
    p_fenetre);
end
$function$

;

CREATE OR REPLACE FUNCTION plateforme.facture_renvoyer(p_facture uuid, p_motif text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  -- La fenêtre du doublon : celle du moteur (`notif.poster`), dite une fois ici.
  v_fenetre interval := interval '24 hours';
  f         record;
  v_cle     text := 'facture:' || p_facture::text;
  v_avant   uuid[];
  v_envoi   record;
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  p_motif := nullif(btrim(coalesce(p_motif, '')), '');
  if p_motif is null then
    raise exception 'refus.motif.a_dire' using errcode = 'check_violation';
  end if;
  select x.id, x.numero, x.payeur_type, x.payeur_personne, x.licence_id into f
    from facturation.factures x where x.id = p_facture;
  if f.id is null then
    raise exception 'refus.introuvable.facture' using errcode = 'no_data_found';
  end if;
  if f.payeur_type <> 'titulaire' then
    raise exception 'refus.facturation.renvoi_pme_seulement' using errcode = 'check_violation';
  end if;

  -- Déjà décidé dans la fenêtre (parti, ou en attente du travailleur) : rien de plus.
  if exists (select 1 from notif.envois_v e
              where e.destinataire = f.payeur_personne and e.code in ('facture.emise.pme', 'facture.reglee.pme')
                and e.canal = 'email' and e.sujet_cle = v_cle
                and e.decision = 'a_remettre' and e.etat <> 'refuse'
                and e.cree_le > now() - v_fenetre) then
    return jsonb_build_object('facture_id', f.id, 'numero', f.numero, 'deja', true);
  end if;

  -- Les envois d'avant : celui que ce renvoi pose est le seul qui n'y est pas (dans une même
  -- transaction, `cree_le` ne les départage pas).
  select coalesce(array_agg(e.id), '{}') into v_avant
    from notif.envois e
   where e.destinataire = f.payeur_personne and e.code in ('facture.emise.pme', 'facture.reglee.pme')
     and e.canal = 'email' and e.sujet_cle = v_cle;

  perform facturation.avertir_de_la_facture(f.id, v_fenetre);

  select e.decision, e.motif_abandon into v_envoi
    from notif.envois e
   where e.destinataire = f.payeur_personne and e.code in ('facture.emise.pme', 'facture.reglee.pme')
     and e.canal = 'email' and e.sujet_cle = v_cle
     and e.id <> all (v_avant)
   limit 1;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id,
                               payload)
  select lo.tenant_id, auth.uid(), 'facture.renvoyee', 'facturation', 'factures', f.id,
         jsonb_build_object('numero', f.numero, 'motif', p_motif,
                            'decision', v_envoi.decision, 'abandon', v_envoi.motif_abandon)
    from facturation.licence_organisations lo
   where lo.licence_id = f.licence_id
   order by lo.rattachee_le, lo.tenant_id limit 1;

  return jsonb_build_object('facture_id', f.id, 'numero', f.numero, 'deja', false,
                            'poste', coalesce(v_envoi.decision = 'a_remettre', false),
                            'abandon', v_envoi.motif_abandon);
end
$function$

;

CREATE OR REPLACE FUNCTION facturation.descentes_dues_appliquer(p_licence uuid, p_jour date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r        record;
  v_rendu  text := coalesce(current_setting('request.jwt.claim.sub', true), '');
  v_n      integer := 0;
begin
  for r in
    select d.id, d.licence_id, d.offre_code, d.effet_le, l.titulaire,
           (select lo.tenant_id from facturation.licence_organisations lo
             where lo.licence_id = d.licence_id order by lo.rattachee_le, lo.tenant_id limit 1) as tenant
      from facturation.descentes_programmees d
      join facturation.licences l on l.id = d.licence_id
     where d.statut = 'programmee' and d.effet_le <= p_jour
       and (p_licence is null or d.licence_id = p_licence)
     order by d.effet_le, d.id
     for update of d skip locked
  loop
    perform set_config('request.jwt.claim.sub', r.titulaire::text, true);
    begin
      perform public.forfait_changer(r.offre_code, r.tenant, r.effet_le);
      update facturation.descentes_programmees
         set statut = 'appliquee', traitee_le = now() where id = r.id;
      v_n := v_n + 1;
    exception when others then
      update facturation.descentes_programmees
         set statut = 'refusee', traitee_le = now(), motif_fin = sqlerrm where id = r.id;
    end;
  end loop;
  perform set_config('request.jwt.claim.sub', v_rendu, true);
  return v_n;
end
$function$

;

CREATE OR REPLACE FUNCTION facturation.avertir_du_paiement()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  p          facturation.paiements_en_ligne;
  v_tenant   uuid;
  v_exposant smallint;
begin
  if new.etat <> 'paye'
     or not exists (select 1 from facturation.prestataires_paiement pp
                     where pp.code = new.prestataire and pp.fait_entrer_argent) then
    return new;
  end if;
  select * into p from facturation.paiements_en_ligne where id = new.paiement_id;
  v_tenant := coalesce(p.payeur_tenant_id,
                       (select lo.tenant_id from facturation.licence_organisations lo
                         where lo.licence_id = p.licence_id order by lo.rattachee_le, lo.tenant_id limit 1));
  select d.exposant into v_exposant from ref.devises d where d.code = p.devise;
  perform notif.emettre(
    v_tenant,
    -- La comptabilité qui paie la facture de ses clients : son bouton mène à SA facturation.
    case when p.payeur_tenant_id is not null then 'paiement.recu.cabinet' else 'paiement.recu' end,
    jsonb_build_object(
      'paiement_id', p.id,
      'objet',       p.libelle,
      'ttc',         to_char(p.montant_ttc, 'FM999G999G990'
                       || case when coalesce(v_exposant, 0) > 0
                               then 'D' || repeat('0', v_exposant) else '' end),
      'devise',      p.devise,
      'reference',   coalesce(new.reference, p.id::text),
      'le',          to_char(new.le, 'DD/MM/YYYY')),
    p.cree_par,
    'paiement:' || p.id::text);
  return new;
end
$function$

;

CREATE OR REPLACE FUNCTION public.paiement_facture_a(p_paiement uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  p facturation.paiements_en_ligne;
  o identity.organizations;
begin
  select * into p from facturation.paiements_en_ligne where id = p_paiement;
  if p.id is null or not facturation.peut_payer(p.licence_id, p.payeur_tenant_id) then
    raise exception 'refus.introuvable.paiement' using errcode = '42501';
  end if;
  -- Le payeur : la comptabilité qui paie, sinon la société de la licence (celle que
  -- `factureDetail` imprime).
  select x.* into o from identity.organizations x
   where x.id = coalesce(p.payeur_tenant_id,
                         (select lo.tenant_id from facturation.licence_organisations lo
                           where lo.licence_id = p.licence_id order by lo.rattachee_le, lo.tenant_id limit 1));
  return jsonb_build_object(
    'tenant_id',   o.id,
    'nom',         o.name,
    'matricule',   o.legal_id,
    'adresse',     o.adresse,
    'juridiction', o.jurisdiction,
    'complet',     nullif(btrim(coalesce(o.legal_id, '')), '') is not null
                   and nullif(btrim(coalesce(o.adresse, '')), '') is not null);
end
$function$

;

commit;
