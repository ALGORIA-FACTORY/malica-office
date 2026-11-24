-- Le paiement reçu se dit ; la facture payée d'abord se dit réglée ; l'offre a son nom.
--
-- Recette Flouci du 24 novembre 2026, audit des courriels automatiques contre les CGV publiées :
--
--   1. CGV, art. 5 : « La commande est conclue quand le paiement est confirmé par le prestataire
--      de paiement ; une confirmation est envoyée par courriel. » Aucun courriel ne partait au
--      paiement. Désormais, chaque paiement confirmé par un prestataire qui fait entrer l'argent
--      avertit celui qui a payé (`paiement.recu`) : l'objet, le montant TTC, la référence du
--      prestataire. Le simulateur, qui ne fait entrer aucun argent, n'avertit de rien.
--   2. Une montée payée d'abord (20261231240000) fait émettre sa facture AU paiement : elle naît
--      réglée. Son courriel disait « à régler avant le … ». Il dit maintenant qu'elle est
--      réglée (`facture.reglee.pme`), avec le même bouton vers le PDF. Le déclencheur du
--      paiement le signale à la transaction (`malica.paye_d_abord_le`) ; seule la facture qui
--      couvre ce jour-là, émise ce jour-là, en profite.
--   3. Les lignes de facture et les courriels écrivaient le CODE de l'offre (« Abonnement
--      premium ») : ils écrivent son nom tel que la grille le porte (« Abonnement Premium »).
--
-- REJEU (R11) : les gabarits et libellés portent leur date en littéral ; les fonctions sont
-- reprises de leur définition EN VIGUEUR.
-- _Gardé par_ apps/api/src/facturation/le-paiement-recu-se-dit.test.ts.

begin;

-- ---------------------------------------------------------------- 1. Les genres et leurs textes
insert into notif.gabarits
  (code, canal, locale, sujet, titre, corps, action_libelle, action_route, effective_from, ton)
values
  ('paiement.recu', 'app', 'fr', null,
   'Paiement reçu',
   '{{ttc}} {{devise}} TTC — {{objet}}.',
   null, null, date '2026-11-24', 'succes'),
  ('paiement.recu', 'app', 'en', null,
   'Payment received',
   '{{ttc}} {{devise}} incl. VAT — {{objet}}.',
   null, null, date '2026-11-24', 'succes'),
  ('paiement.recu', 'app', 'ar', null,
   'تم استلام الدفع',
   '{{ttc}} {{devise}} شامل الأداء — {{objet}}.',
   null, null, date '2026-11-24', 'succes'),
  ('paiement.recu', 'email', 'fr', 'Malica Office — paiement reçu',
   'Nous avons bien reçu votre paiement',
   'Merci. {{ttc}} {{devise}} TTC, réglés en ligne le {{le_longue}} : {{objet}}. '
   'Référence du paiement : {{reference}}. La facture correspondante se télécharge dans vos '
   'réglages, rubrique Abonnement.',
   'Voir mon abonnement', '/pme/reglages?page=abonnement', date '2026-11-24', 'succes'),
  ('paiement.recu', 'email', 'en', 'Malica Office — payment received',
   'We have received your payment',
   'Thank you. {{ttc}} {{devise}} incl. VAT, paid online on {{le_longue}}: {{objet}}. '
   'Payment reference: {{reference}}. The matching invoice can be downloaded from your '
   'settings, under Subscription.',
   'View my subscription', '/pme/reglages?page=abonnement', date '2026-11-24', 'succes'),
  ('paiement.recu', 'email', 'ar', 'Malica Office — تم استلام الدفع',
   'تسلّمنا دفعتكم',
   'شكرًا. {{ttc}} {{devise}} شامل الأداء، دُفعت عبر الإنترنت يوم {{le_longue}}: {{objet}}. '
   'مرجع الدفع: {{reference}}. تُنزَّل الفاتورة المقابلة من إعداداتكم، قسم الاشتراك.',
   'عرض اشتراكي', '/pme/reglages?page=abonnement', date '2026-11-24', 'succes'),
  ('paiement.recu.cabinet', 'app', 'fr', null,
   'Paiement reçu',
   '{{ttc}} {{devise}} TTC — {{objet}}.',
   null, null, date '2026-11-24', 'succes'),
  ('paiement.recu.cabinet', 'app', 'en', null,
   'Payment received',
   '{{ttc}} {{devise}} incl. VAT — {{objet}}.',
   null, null, date '2026-11-24', 'succes'),
  ('paiement.recu.cabinet', 'app', 'ar', null,
   'تم استلام الدفع',
   '{{ttc}} {{devise}} شامل الأداء — {{objet}}.',
   null, null, date '2026-11-24', 'succes'),
  ('paiement.recu.cabinet', 'email', 'fr', 'Malica Office — paiement reçu',
   'Nous avons bien reçu votre paiement',
   'Merci. {{ttc}} {{devise}} TTC, réglés en ligne le {{le_longue}} : {{objet}}. '
   'Référence du paiement : {{reference}}. La facture se télécharge dans la facturation de '
   'votre comptabilité.',
   'Voir la facturation', '/cabinet/clients?vue=facturation', date '2026-11-24', 'succes'),
  ('paiement.recu.cabinet', 'email', 'en', 'Malica Office — payment received',
   'We have received your payment',
   'Thank you. {{ttc}} {{devise}} incl. VAT, paid online on {{le_longue}}: {{objet}}. '
   'Payment reference: {{reference}}. The invoice can be downloaded from your firm''s billing.',
   'View billing', '/cabinet/clients?vue=facturation', date '2026-11-24', 'succes'),
  ('paiement.recu.cabinet', 'email', 'ar', 'Malica Office — تم استلام الدفع',
   'تسلّمنا دفعتكم',
   'شكرًا. {{ttc}} {{devise}} شامل الأداء، دُفعت عبر الإنترنت يوم {{le_longue}}: {{objet}}. '
   'مرجع الدفع: {{reference}}. تُنزَّل الفاتورة من فوترة محاسبتكم.',
   'عرض الفوترة', '/cabinet/clients?vue=facturation', date '2026-11-24', 'succes'),
  ('facture.reglee.pme', 'app', 'fr', null,
   'Facture {{numero}} réglée',
   '{{ttc}} {{devise}} TTC, réglée en ligne.',
   null, null, date '2026-11-24', 'succes'),
  ('facture.reglee.pme', 'app', 'en', null,
   'Invoice {{numero}} paid',
   '{{ttc}} {{devise}} incl. VAT, paid online.',
   null, null, date '2026-11-24', 'succes'),
  ('facture.reglee.pme', 'app', 'ar', null,
   'الفاتورة {{numero}} مدفوعة',
   '{{ttc}} {{devise}} شامل الأداء، دُفعت عبر الإنترنت.',
   null, null, date '2026-11-24', 'succes'),
  ('facture.reglee.pme', 'email', 'fr', 'Malica Office — facture {{numero}} réglée',
   'Votre facture {{numero}} est réglée',
   'Votre abonnement {{offre}} du {{du_longue}} au {{au_longue}} : {{ttc}} {{devise}} TTC, '
   'réglés en ligne. Rien ne reste à payer. La facture PDF se télécharge dans vos réglages, '
   'rubrique Abonnement.',
   'Télécharger la facture', '/pme/reglages?page=abonnement', date '2026-11-24', 'succes'),
  ('facture.reglee.pme', 'email', 'en', 'Malica Office — invoice {{numero}} paid',
   'Your invoice {{numero}} is paid',
   'Your {{offre}} subscription from {{du_longue}} to {{au_longue}}: {{ttc}} {{devise}} '
   'incl. VAT, paid online. Nothing is left to pay. The PDF invoice can be downloaded from '
   'your settings, under Subscription.',
   'Download the invoice', '/pme/reglages?page=abonnement', date '2026-11-24', 'succes'),
  ('facture.reglee.pme', 'email', 'ar', 'Malica Office — الفاتورة {{numero}} مدفوعة',
   'فاتورتكم {{numero}} مدفوعة',
   'اشتراككم {{offre}} من {{du_longue}} إلى {{au_longue}}: {{ttc}} {{devise}} شامل الأداء، '
   'دُفعت عبر الإنترنت. لم يبقَ شيء للدفع. تُنزَّل الفاتورة بصيغة PDF من إعداداتكم، قسم الاشتراك.',
   'تنزيل الفاتورة', '/pme/reglages?page=abonnement', date '2026-11-24', 'succes');

insert into notif.diffusions (code, canal, gabarit, valid_from) values
  ('paiement.recu', 'email', 'paiement.recu', date '2026-11-24'),
  ('paiement.recu.cabinet', 'email', 'paiement.recu.cabinet', date '2026-11-24'),
  ('facture.reglee.pme', 'email', 'facture.reglee.pme', date '2026-11-24');

insert into notif.cartes_courriel (code, rang, genre, libelle_cle, valeur_cle) values
  ('paiement.recu', 1, 'montant', 'unite.factureTtc', 'valeur.ttc'),
  ('paiement.recu', 2, 'ligne',   'donnee.objetDuPaiement', 'valeur.objet'),
  ('paiement.recu', 3, 'ligne',   'donnee.reference', 'valeur.reference'),
  ('paiement.recu.cabinet', 1, 'montant', 'unite.factureTtc', 'valeur.ttc'),
  ('paiement.recu.cabinet', 2, 'ligne',   'donnee.objetDuPaiement', 'valeur.objet'),
  ('paiement.recu.cabinet', 3, 'ligne',   'donnee.reference', 'valeur.reference'),
  ('facture.reglee.pme', 1, 'montant', 'unite.factureTtc', 'valeur.ttc'),
  ('facture.reglee.pme', 2, 'ligne',   'donnee.facture',   'valeur.numero'),
  ('facture.reglee.pme', 3, 'ligne',   'donnee.etat',      'valeur.reglee');

insert into notif.libelles_courriel (cle, locale, texte, effective_from) values
  ('etiquette.paiement', 'fr', 'Paiement', date '2026-11-24'),
  ('etiquette.paiement', 'en', 'Payment', date '2026-11-24'),
  ('etiquette.paiement', 'ar', 'دفع', date '2026-11-24'),
  ('raison.paiement', 'fr',
   'Vous recevez ce message parce que vous venez de payer en ligne sur Malica Office.',
   date '2026-11-24'),
  ('raison.paiement', 'en',
   'You are receiving this message because you have just paid online on Malica Office.',
   date '2026-11-24'),
  ('raison.paiement', 'ar', 'تصلكم هذه الرسالة لأنكم دفعتم للتو عبر الإنترنت في Malica Office.',
   date '2026-11-24'),
  ('apercu.paiement.recu', 'fr', 'Merci : {{ttc}} {{devise}} TTC bien reçus.', date '2026-11-24'),
  ('apercu.paiement.recu', 'en', 'Thank you: {{ttc}} {{devise}} incl. VAT received.', date '2026-11-24'),
  ('apercu.paiement.recu', 'ar', 'شكرًا: تسلّمنا {{ttc}} {{devise}} شامل الأداء.', date '2026-11-24'),
  ('apercu.paiement.recu.cabinet', 'fr', 'Merci : {{ttc}} {{devise}} TTC bien reçus.', date '2026-11-24'),
  ('apercu.paiement.recu.cabinet', 'en', 'Thank you: {{ttc}} {{devise}} incl. VAT received.', date '2026-11-24'),
  ('apercu.paiement.recu.cabinet', 'ar', 'شكرًا: تسلّمنا {{ttc}} {{devise}} شامل الأداء.', date '2026-11-24'),
  ('apercu.facture.reglee.pme', 'fr', '{{ttc}} {{devise}} TTC, réglée. Rien ne reste à payer.',
   date '2026-11-24'),
  ('apercu.facture.reglee.pme', 'en', '{{ttc}} {{devise}} incl. VAT, paid. Nothing is left to pay.',
   date '2026-11-24'),
  ('apercu.facture.reglee.pme', 'ar', '{{ttc}} {{devise}} شامل الأداء، مدفوعة. لم يبقَ شيء للدفع.',
   date '2026-11-24'),
  ('donnee.objetDuPaiement', 'fr', 'Objet', date '2026-11-24'),
  ('donnee.objetDuPaiement', 'en', 'For', date '2026-11-24'),
  ('donnee.objetDuPaiement', 'ar', 'الموضوع', date '2026-11-24'),
  ('valeur.objet', 'fr', '{{objet}}', date '2026-11-24'),
  ('valeur.objet', 'en', '{{objet}}', date '2026-11-24'),
  ('valeur.objet', 'ar', '{{objet}}', date '2026-11-24'),
  ('donnee.reference', 'fr', 'Référence', date '2026-11-24'),
  ('donnee.reference', 'en', 'Reference', date '2026-11-24'),
  ('donnee.reference', 'ar', 'المرجع', date '2026-11-24'),
  ('valeur.reference', 'fr', '{{reference}}', date '2026-11-24'),
  ('valeur.reference', 'en', '{{reference}}', date '2026-11-24'),
  ('valeur.reference', 'ar', '{{reference}}', date '2026-11-24'),
  ('donnee.etat', 'fr', 'État', date '2026-11-24'),
  ('donnee.etat', 'en', 'Status', date '2026-11-24'),
  ('donnee.etat', 'ar', 'الحالة', date '2026-11-24'),
  ('valeur.reglee', 'fr', 'Réglée', date '2026-11-24'),
  ('valeur.reglee', 'en', 'Paid', date '2026-11-24'),
  ('valeur.reglee', 'ar', 'مدفوعة', date '2026-11-24')
on conflict do nothing;

-- ---------------------------------------------------------------- 2. Le paiement reçu se dit
create function facturation.avertir_du_paiement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
                         where lo.licence_id = p.licence_id order by lo.tenant_id limit 1));
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
$$;
revoke all on function facturation.avertir_du_paiement() from public, anon, authenticated;
-- Après les déclencheurs qui encaissent et ouvrent (ordre alphabétique des noms) : l'avis part
-- une fois l'argent inscrit.
create trigger zz_le_paiement_recu_se_dit
  after insert on facturation.paiement_evenements
  for each row execute function facturation.avertir_du_paiement();

-- ---------------------------------------------------------------- 3. Les fonctions reprises
CREATE OR REPLACE FUNCTION facturation.avertir_de_la_facture(p_facture uuid, p_fenetre interval DEFAULT '24:00:00'::interval)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  f          facturation.factures;
  v_tenant   uuid;
  v_exposant smallint;
begin
  select x.* into f from facturation.factures x where x.id = p_facture;
  -- Seule la facture d'une PME (payée par son titulaire) part par ce genre.
  if f.id is null or f.payeur_type <> 'titulaire' then
    return 0;
  end if;
  select lo.tenant_id into v_tenant
    from facturation.licence_organisations lo
   where lo.licence_id = f.licence_id
   order by lo.tenant_id limit 1;
  select d.exposant into v_exposant from ref.devises d where d.code = f.devise;

  -- Les jetons de ses gabarits (app et courriel, fr/en/ar) : tous, et rien d'autre.
  return notif.emettre(
    v_tenant,
    -- Payée d'abord (une montée, 20261231240000) : la facture naît réglée par le paiement qui
    -- l'a fait émettre. Elle le dit, au lieu de « à régler avant ».
    case when coalesce(current_setting('malica.paye_d_abord_le', true), '') = f.emise_le::text
              and f.couvre_du <= f.emise_le and f.couvre_au > f.emise_le
         then 'facture.reglee.pme' else 'facture.emise.pme' end,
    jsonb_build_object(
      'facture_id', f.id,
      'numero',     f.numero,
      'offre',      coalesce((ref.offre_a(f.offre_code, f.couvre_du)).libelle, f.offre_code),
      'periode',    to_char(f.periode, 'MM/YYYY'),
      'du',         to_char(f.couvre_du, 'DD/MM/YYYY'),
      'au',         to_char(f.couvre_au - 1, 'DD/MM/YYYY'),
      'ttc',        to_char(f.montant_ttc, 'FM999G999G990'
                      || case when coalesce(v_exposant, 0) > 0
                              then 'D' || repeat('0', v_exposant) else '' end),
      'devise',     f.devise,
      'echeance',   to_char(f.echeance_le, 'DD/MM/YYYY')),
    f.payeur_personne,
    'facture:' || f.id::text,
    p_fenetre);
end
$function$;
revoke all on function facturation.avertir_de_la_facture(uuid, interval) from public, anon, authenticated;

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
   order by lo.tenant_id limit 1;
  perform facturation.avertir_de_la_facture(v_id);

  return jsonb_build_object('facture_id', v_id, 'numero', v_numero, 'nature', p_nature,
                            'du', p_du, 'au', p_au, 'ht', v_ht, 'ttc', v_ht + v_tva + f.timbre);
end
$function$;
revoke all on function facturation.emission_du_titulaire(uuid, text, date, date, date, date, numeric, boolean, text, text, date, uuid, integer)
  from public, anon, authenticated;

commit;
