-- Malica Office émet ses propres factures, sous sa série : MO-TN-I11-AAAA-000000.
--
-- Décision du dirigeant, 23 novembre 2026 : les factures d'abonnement que Malica Office adresse
-- à ses sociétés clientes ne passent pas par El Fatoora (TTN). L'émetteur désigné
-- (`facturation.emetteurs`, aujourd'hui ALGORIA FACTORY) les émet lui-même, sous une série
-- dédiée : `MO-TN-I11-2026-000001`, un compteur de six chiffres qui repart à 1 chaque année et
-- ne se réutilise jamais.
--
-- Jusqu'ici, le numéro s'écrivait EN DUR dans trois fonctions d'émission
-- ('ALG-' || to_char(periode, 'YYYYMM') || '-' || lpad(nextval(séquence globale), 5, '0')) :
-- un préfixe dans le code, une séquence globale qui laisse un trou à chaque transaction annulée.
--
-- Ce qui change :
--   1. `plateforme.reglages_factures` : ce que la tour règle des factures — la série d'abord,
--      puis (20261231210000) ce que la facture imprimée porte de l'émetteur et de sa banque.
--      Daté, motivé, en ajout seul, comme les autres réglages de la tour. Semée ici :
--      la série `MO-TN-I11` en vigueur le 23 novembre 2026 (défaut livré : `decide_par` nul).
--   2. `facturation.compteurs_factures` : un compteur par série et par année, verrouillé par
--      la mise à jour qui le tire. Deux émissions simultanées s'attendent ; une émission
--      annulée rend son numéro avec elle. Aucun trou, aucun doublon.
--   3. `facturation.numero_de_facture` tire le numéro ; les trois fonctions d'émission
--      (reprises de leur définition EN VIGUEUR, `pg_get_functiondef` d'une base migrée :
--      20261218110000, 20261128090000, 20261127090000) l'appellent au lieu d'écrire le leur.
--      Rien d'autre ne change dans leur corps, sauf l'avis au titulaire (point 4).
--   4. Chaque facture d'une PME avertit son titulaire (`facturation.avertir_de_la_facture`) :
--      une ligne dans l'application et un courriel, sous un genre PROPRE,
--      `facture.emise.pme`. `facture.emise` reste celui de la facture du mois du cabinet,
--      qui n'a pas de courriel (20261226140000 §2bis) et dont la charge est plus petite :
--      lui ouvrir le courriel aurait envoyé au cabinet le gabarit de la PME, troué.
--
-- Les numéros déjà émis (ALG-202611-00001…) ne sont pas touchés : aucune ligne de
-- `facturation.factures` n'est réécrite (R7). La séquence globale, que plus rien ne tire, part.
--
-- L'année du numéro est celle du jour d'émission de la facture ; la série est celle en vigueur
-- le jour où le numéro se tire (un rattrapage tire aujourd'hui, sous la série d'aujourd'hui).
--
-- _Gardé par_ apps/api/src/facturation/la-facture-malica-a-sa-serie.test.ts.

begin;

-- --------------------------------------------------------------- 1. Les réglages
create table plateforme.reglages_factures (
  id                  uuid primary key default gen_random_uuid(),
  -- Le préfixe de la série : lettres capitales et chiffres, par segments séparés d'un tiret.
  serie               text not null
                      check (serie ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$' and length(serie) <= 32),
  -- Les chiffres du compteur annuel (6 : 000001).
  chiffres            smallint not null check (chiffres between 4 and 9),
  valide_des          date not null,
  motif               text not null check (length(btrim(motif)) > 0),
  -- Nul : le défaut livré par une migration (R10, « un défaut se dit »).
  decide_par          uuid,
  decide_le           timestamptz not null default now(),
  rang                bigint generated always as identity
);

comment on table plateforme.reglages_factures is
  'Ce que la tour règle des factures de la plateforme : la série et, à partir de '
  '20261231210000, l''adresse, le RNE, le site, les conditions de paiement et les coordonnées '
  'bancaires imprimées. Daté, motivé, en ajout seul ; decide_par nul = défaut livré.';

create index reglages_factures_en_vigueur_idx
  on plateforme.reglages_factures (valide_des desc, rang desc);

alter table plateforme.reglages_factures enable row level security;
create policy reglages_factures_lire on plateforme.reglages_factures
  for select to authenticated using ((select app.is_platform()));
revoke all on plateforme.reglages_factures from public, anon, authenticated;
grant select on plateforme.reglages_factures to authenticated;

create trigger reglages_factures_ne_se_reecrivent_pas
  before update or delete on plateforme.reglages_factures
  for each row execute function app.deny_mutation();

insert into plateforme.reglages_factures (serie, chiffres, valide_des, motif, decide_par, decide_le)
values ('MO-TN-I11', 6, date '2026-11-23',
        'Décision du dirigeant du 23 novembre 2026 : Malica Office émet ses propres factures, '
        'série MO-TN-I11-AAAA-000000, hors El Fatoora.',
        null, timestamptz '2026-11-23 00:00:00+00');

-- --------------------------------------------------------------- 2. Les compteurs
create table facturation.compteurs_factures (
  serie   text not null,
  annee   smallint not null check (annee between 2000 and 2999),
  dernier integer not null check (dernier >= 0),
  primary key (serie, annee)
);

comment on table facturation.compteurs_factures is
  'Le dernier numéro tiré, par série et par année. Tiré par facturation.numero_de_facture, '
  'sous le verrou de la ligne : sans trou ni doublon, une émission annulée rend le sien.';

alter table facturation.compteurs_factures enable row level security;
alter table facturation.compteurs_factures force row level security;
revoke all on facturation.compteurs_factures from public, anon, authenticated;

-- --------------------------------------------------------------- 3. Le numéro
create function facturation.numero_de_facture(p_emise_le date)
returns text
language plpgsql
set search_path = ''
as $$
declare
  r       record;
  v_annee smallint := extract(year from p_emise_le)::smallint;
  v_n     integer;
begin
  select x.serie, x.chiffres into r
    from plateforme.reglages_factures x
   where x.valide_des <= current_date
   order by x.valide_des desc, x.rang desc
   limit 1;
  -- R4 : sans série en vigueur, aucune facture — jamais un préfixe de repli.
  if r.serie is null then
    raise exception 'refus.facturation.serie_absente' using errcode = 'no_data_found';
  end if;

  insert into facturation.compteurs_factures (serie, annee, dernier)
  values (r.serie, v_annee, 0)
  on conflict (serie, annee) do nothing;
  -- La mise à jour verrouille la ligne : une émission concurrente attend la fin de celle-ci,
  -- puis relit le compteur validé (ou intact, si celle-ci a été annulée).
  update facturation.compteurs_factures k
     set dernier = k.dernier + 1
   where k.serie = r.serie and k.annee = v_annee
  returning k.dernier into v_n;

  if length(v_n::text) > r.chiffres then
    raise exception 'refus.facturation.serie_epuisee' using errcode = 'check_violation';
  end if;
  return r.serie || '-' || v_annee::text || '-' || lpad(v_n::text, r.chiffres, '0');
end
$$;
revoke all on function facturation.numero_de_facture(date) from public, anon, authenticated;

comment on function facturation.numero_de_facture(date) is
  'Le numéro suivant de la série en vigueur, pour l''année du jour d''émission donné : '
  '<série>-<année>-<compteur>. Sans trou ni doublon (verrou de ligne du compteur).';

-- --------------------------------------------------------------- 4. L'avis au titulaire
create function facturation.avertir_de_la_facture(
  p_facture uuid,
  p_fenetre interval default interval '24 hours')
returns integer
language plpgsql
set search_path = ''
as $$
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
    v_tenant, 'facture.emise.pme',
    jsonb_build_object(
      'facture_id', f.id,
      'numero',     f.numero,
      'offre',      f.offre_code,
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
$$;
revoke all on function facturation.avertir_de_la_facture(uuid, interval)
  from public, anon, authenticated;

comment on function facturation.avertir_de_la_facture(uuid, interval) is
  'Avertit le titulaire d''une facture de PME (application et courriel, genre facture.emise.pme). '
  'Le sujet est la facture : un second avis dans la fenêtre est un doublon (notif.poster).';

-- Le genre `facture.emise.pme` : sa ligne dans l'application, son courriel, sa diffusion.
insert into notif.gabarits
  (code, canal, locale, sujet, titre, corps, action_libelle, action_route, effective_from, ton)
values
  ('facture.emise.pme', 'app', 'fr', null,
   'Facture {{numero}}',
   '{{ttc}} {{devise}} TTC, à régler avant le {{echeance}}.',
   null, null, date '2026-11-23', 'neutre'),
  ('facture.emise.pme', 'app', 'en', null,
   'Invoice {{numero}}',
   '{{ttc}} {{devise}} incl. VAT, due by {{echeance}}.',
   null, null, date '2026-11-23', 'neutre'),
  ('facture.emise.pme', 'app', 'ar', null,
   'الفاتورة {{numero}}',
   '{{ttc}} {{devise}} شامل الأداء، تُدفع قبل {{echeance}}.',
   null, null, date '2026-11-23', 'neutre'),
  ('facture.emise.pme', 'email', 'fr', 'Malica Office — facture {{numero}}',
   'Votre facture {{numero}}',
   'Votre abonnement {{offre}} du {{du_longue}} au {{au_longue}} : {{ttc}} {{devise}} TTC, '
   'à régler avant le {{echeance_longue}}. La facture PDF se télécharge dans vos réglages, '
   'rubrique Abonnement.',
   'Télécharger la facture', '/pme/reglages?page=abonnement', date '2026-11-23', 'neutre'),
  ('facture.emise.pme', 'email', 'en', 'Malica Office — invoice {{numero}}',
   'Your invoice {{numero}}',
   'Your {{offre}} subscription from {{du_longue}} to {{au_longue}}: {{ttc}} {{devise}} '
   'incl. VAT, due by {{echeance_longue}}. The PDF invoice can be downloaded from your settings, '
   'under Subscription.',
   'Download the invoice', '/pme/reglages?page=abonnement', date '2026-11-23', 'neutre'),
  ('facture.emise.pme', 'email', 'ar', 'Malica Office — الفاتورة {{numero}}',
   'فاتورتكم {{numero}}',
   'اشتراككم {{offre}} من {{du_longue}} إلى {{au_longue}}: {{ttc}} {{devise}} شامل الأداء، '
   'يُدفع قبل {{echeance_longue}}. تُنزَّل الفاتورة بصيغة PDF من إعداداتكم، قسم الاشتراك.',
   'تنزيل الفاتورة', '/pme/reglages?page=abonnement', date '2026-11-23', 'neutre');

insert into notif.diffusions (code, canal, gabarit, valid_from)
values ('facture.emise.pme', 'email', 'facture.emise.pme', date '2026-11-23');

-- La carte du courriel : la somme, puis le numéro et l'échéance.
insert into notif.cartes_courriel (code, rang, genre, libelle_cle, valeur_cle) values
  ('facture.emise.pme', 1, 'montant', 'unite.factureTtc', 'valeur.ttc'),
  ('facture.emise.pme', 2, 'ligne',   'donnee.facture',   'valeur.numero'),
  ('facture.emise.pme', 3, 'ligne',   'donnee.echeance',  'valeur.echeanceLongue');

insert into notif.libelles_courriel (cle, locale, texte, effective_from) values
  ('etiquette.facture', 'fr', 'Facture', date '2026-11-23'),
  ('etiquette.facture', 'en', 'Invoice', date '2026-11-23'),
  ('etiquette.facture', 'ar', 'فاتورة', date '2026-11-23'),
  ('raison.facture', 'fr',
   'Vous recevez ce message parce que vous tenez cet abonnement Malica Office.', date '2026-11-23'),
  ('raison.facture', 'en',
   'You are receiving this message because you hold this Malica Office subscription.',
   date '2026-11-23'),
  ('raison.facture', 'ar', 'تصلكم هذه الرسالة لأنكم صاحب هذا الاشتراك في Malica Office.',
   date '2026-11-23'),
  ('apercu.facture.emise.pme', 'fr', '{{ttc}} {{devise}} TTC, à régler avant le {{echeance_longue}}.',
   date '2026-11-23'),
  ('apercu.facture.emise.pme', 'en', '{{ttc}} {{devise}} incl. VAT, due by {{echeance_longue}}.',
   date '2026-11-23'),
  ('apercu.facture.emise.pme', 'ar', '{{ttc}} {{devise}} شامل الأداء، تُدفع قبل {{echeance_longue}}.',
   date '2026-11-23'),
  ('unite.factureTtc', 'fr', '{{devise}} TTC', date '2026-11-23'),
  ('unite.factureTtc', 'en', '{{devise}} incl. VAT', date '2026-11-23'),
  ('unite.factureTtc', 'ar', '{{devise}} شامل الأداء', date '2026-11-23'),
  ('valeur.ttc', 'fr', '{{ttc}}', date '2026-11-23'),
  ('valeur.ttc', 'en', '{{ttc}}', date '2026-11-23'),
  ('valeur.ttc', 'ar', '{{ttc}}', date '2026-11-23'),
  ('donnee.facture', 'fr', 'Facture', date '2026-11-23'),
  ('donnee.facture', 'en', 'Invoice', date '2026-11-23'),
  ('donnee.facture', 'ar', 'الفاتورة', date '2026-11-23'),
  ('valeur.numero', 'fr', '{{numero}}', date '2026-11-23'),
  ('valeur.numero', 'en', '{{numero}}', date '2026-11-23'),
  ('valeur.numero', 'ar', '{{numero}}', date '2026-11-23'),
  ('donnee.echeance', 'fr', 'À régler avant le', date '2026-11-23'),
  ('donnee.echeance', 'en', 'Due by', date '2026-11-23'),
  ('donnee.echeance', 'ar', 'تُدفع قبل', date '2026-11-23'),
  ('valeur.echeanceLongue', 'fr', '{{echeance_longue}}', date '2026-11-23'),
  ('valeur.echeanceLongue', 'en', '{{echeance_longue}}', date '2026-11-23'),
  ('valeur.echeanceLongue', 'ar', '{{echeance_longue}}', date '2026-11-23');

-- --------------------------------------------------------------- 5. Les émissions
-- Reprises telles quelles ; seuls changent le numéro et l'avis au titulaire.

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
            'Complément d''abonnement ' || p_offre
              || ' (offre, places ou sociétés en plus) — ' || v_dates,
            1, v_abo, v_abo);
  elsif v_annuel.id is null and v_par_an = 0 then
    v_ordinal := 1;
    insert into facturation.facture_lignes
      (facture_id, ordinal, libelle, quantite, prix_unitaire, montant_ht)
    values (v_id, 1, 'Abonnement ' || p_offre || ' — ' || v_dates, 1, v_abo, v_abo);
  elsif v_abo > 0 then
    v_ordinal := 1;
    insert into facturation.facture_lignes
      (facture_id, ordinal, libelle, quantite, prix_unitaire, montant_ht)
    values (v_id, 1,
            case when v_annuel.id is not null
                 then 'Places et sociétés en plus — ' || v_dates
                      || ' (l''offre est couverte par l''abonnement annuel)'
                 else 'Abonnement ' || p_offre || ' — ' || v_dates
                      || ' (hors jours couverts par l''abonnement annuel)' end,
            1, v_abo, v_abo);
  end if;

  if p_nature = 'base' then
    if v_debut.id is not null then
      v_ordinal := v_ordinal + 1;
      insert into facturation.facture_lignes
        (facture_id, ordinal, libelle, quantite, prix_unitaire, montant_ht)
      values (v_id, v_ordinal,
              'Abonnement annuel ' || v_debut.offre_code || ' — du '
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

CREATE OR REPLACE FUNCTION facturation.emission_de_la_licence(p_licence uuid, p_periode date, p_jours_echeance integer DEFAULT 15)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c          record;
  v_emetteur record;
  v_pack     uuid;
  v_taux     numeric(8,6);
  v_timbre   app.money_t;
  v_sieges   smallint;
  l          record;
  v_tva      app.money_t;
  v_nom      text;
  v_legal    text;
  v_numero   text;
  v_id       uuid;
  v_faites   jsonb := '[]'::jsonb;
  v_premiere uuid;
  v_premier  text;
  v_ttc      app.money_t := 0;
  v_ht       app.money_t;
  v_recharge record;
  v_montee   record;
  v_ordinal  smallint;
  v_paiement record;
  v_enc      uuid;
  v_annuel   facturation.engagements_annuels;
  v_debut    facturation.engagements_annuels;
  v_mois     app.money_t;
  v_couvert  boolean := false;
  v_par_cabinet boolean := false;
begin
  if extract(day from p_periode) <> 1 then
    raise exception 'refus.facturation.premier_du_mois' using errcode = 'check_violation';
  end if;

  select * into c from facturation.consommation_v where licence_id = p_licence;
  if c.licence_id is null then
    raise exception 'refus.introuvable.licence' using errcode = 'no_data_found';
  end if;

  select o.currency, o.jurisdiction into v_emetteur
    from facturation.emetteurs e
    join identity.organizations o on o.id = e.organisation_id
   where e.valide_des <= current_date
   order by e.valide_des desc limit 1;
  if not found then
    raise exception 'refus.referentiel.manquant'
      using errcode = 'no_data_found';
  end if;

  select p.id into v_pack
    from ref.jurisdiction_packs p
   where p.jurisdiction = v_emetteur.jurisdiction
     and p.effective_from <= current_date
     and (p.effective_to is null or p.effective_to >= current_date)
   order by p.effective_from desc limit 1;
  if v_pack is null then
    raise exception 'refus.referentiel.manquant'
      using errcode = 'no_data_found';
  end if;

  select r.rate into v_taux
    from ref.tva_rates r
   where r.pack_version_id = v_pack
     and r.code = 'TVA19'
     and r.valid_from <= current_date
     and (r.valid_to is null or r.valid_to >= current_date)
   order by r.valid_from desc limit 1;

  select coalesce(sp.value_num, sp.value_text::numeric) into v_timbre
    from ref.socle_params sp
   where sp.pack_version_id = v_pack
     and sp.code = 'facture.droit_de_timbre'
     and sp.valid_from <= current_date
     and (sp.valid_to is null or sp.valid_to >= current_date)
   order by sp.valid_from desc limit 1;

  if v_taux is null then
    raise exception 'refus.referentiel.manquant'
      using errcode = 'no_data_found';
  end if;
  if v_timbre is null then
    raise exception
      'refus.referentiel.manquant'
      using errcode = 'no_data_found';
  end if;

  v_sieges := greatest(0, c.sieges_occupes - c.sieges_inclus)::smallint;

  for l in
    select * from facturation.lignes_a_facturer(p_licence, p_periode)
     order by payeur_type
  loop
    -- La part d'un CABINET ne se facture plus licence par licence : elle
    -- entre dans la facture mensuelle unique du cabinet
    -- (`facturation.emettre_cabinet`, 20 octobre 2026), un seul timbre.
    if l.payeur_type = 'cabinet' then
      v_par_cabinet := true;
      continue;
    end if;
    if l.payeur_type = 'cabinet' then
      select o.name, o.legal_id into v_nom, v_legal
        from identity.organizations o where o.id = l.payeur_tenant_id;
    else
      select p.display_name, null::text into v_nom, v_legal
        from identity.profiles p where p.user_id = l.payeur_personne;
    end if;

    if v_nom is null or length(btrim(v_nom)) = 0 then
      raise exception
        '%', app.refus_avec_valeurs('refus.facturation.destinataire_sans_nom', 'destinataire', (coalesce(l.payeur_tenant_id, l.payeur_personne))::text)
        using errcode = 'no_data_found';
    end if;

    -- L'ANNÉE (20261022190000). La part de l'offre d'un mois couvert est
    -- payée par l'engagement : il ne reste au mois que les places et sociétés
    -- en plus. Le mois où l'année commence porte sa ligne, une fois.
    v_mois   := l.montant_ht;
    v_annuel := null;
    v_debut  := null;
    if l.payeur_type = 'titulaire' then
      v_annuel := facturation.annuel_de(p_licence, p_periode);
      if v_annuel.id is not null then
        -- Jour par jour : une montée pendant l'année change le prix couvert (7.5).
        v_mois := greatest(0, l.montant_ht
                              - (select round(sum((facturation.annuel_de(p_licence, j::date)).prix_mensuel_ht)
                                              / l.jours_du_mois, 3)
                                   from generate_series(p_periode, (p_periode + interval '1 month')::date - 1,
                                                        interval '1 day') j))::app.money_t;
      end if;
      select e.* into v_debut from facturation.engagements_annuels e
       where e.licence_id = p_licence and e.du = p_periode
         and not exists (select 1 from facturation.facture_annuels fa where fa.engagement_id = e.id)
       order by e.souscrit_le limit 1;
    end if;

    v_ht := v_mois;
    if l.payeur_type = 'titulaire' then
      select (v_mois + coalesce(v_debut.montant_ht, 0) + coalesce(sum(x.prix_ht), 0))::app.money_t into v_ht
        from facturation.recharges x
       where x.licence_id = p_licence
         and x.achetee_le < (p_periode + interval '1 month')::date
         and not exists (select 1 from facturation.facture_recharges fr where fr.recharge_id = x.id);
      v_ht := (v_ht + facturation.annuel_montees_a_facturer(
                        p_licence, (p_periode + interval '1 month')::date))::app.money_t;
    end if;

    -- Un mois couvert par l'année, sans rien d'autre : aucune facture. Une
    -- facture à zéro ne porterait qu'un timbre, sans opération.
    if l.payeur_type = 'titulaire' and v_annuel.id is not null and v_ht = 0 then
      v_couvert := true;
      continue;
    end if;

    v_tva    := round(v_ht * v_taux, 3);
    v_numero := facturation.numero_de_facture(current_date);

    insert into facturation.factures
      (licence_id, numero, periode, emise_le, echeance_le, offre_code,
       organisations, sieges_payants, montant_ht, taux_tva, montant_tva,
       timbre, montant_ttc, devise,
       payeur_type, payeur_tenant_id, payeur_personne,
       destinataire_nom, destinataire_legal_id, reference_abonne)
    values
      (p_licence, v_numero, p_periode, current_date,
       current_date + p_jours_echeance, l.offre_code,
       c.organisations, v_sieges, v_ht, v_taux, v_tva, v_timbre,
       v_ht + v_tva + v_timbre, v_emetteur.currency,
       l.payeur_type, l.payeur_tenant_id, l.payeur_personne,
       v_nom, v_legal, l.acces_reference)
    returning id into v_id;

    v_ordinal := 0;
    if v_annuel.id is null then
      v_ordinal := 1;
      insert into facturation.facture_lignes
        (facture_id, ordinal, libelle, quantite, prix_unitaire, montant_ht)
      values (v_id, 1,
              'Abonnement ' || l.offre_code || ' — '
              || to_char(p_periode, 'TMMonth YYYY')
              || ' (' || l.jours || '/' || l.jours_du_mois || ' jours)',
              1, l.montant_ht, l.montant_ht);
    elsif v_mois > 0 then
      v_ordinal := 1;
      insert into facturation.facture_lignes
        (facture_id, ordinal, libelle, quantite, prix_unitaire, montant_ht)
      values (v_id, 1,
              'Places et sociétés en plus — ' || to_char(p_periode, 'TMMonth YYYY')
              || ' (l''offre est couverte par l''abonnement annuel)',
              1, v_mois, v_mois);
    end if;

    if v_debut.id is not null then
      v_ordinal := v_ordinal + 1;
      insert into facturation.facture_lignes
        (facture_id, ordinal, libelle, quantite, prix_unitaire, montant_ht)
      values (v_id, v_ordinal,
              'Abonnement annuel ' || v_debut.offre_code || ' — du '
              || to_char(v_debut.du, 'DD/MM/YYYY') || ' au ' || to_char(v_debut.au, 'DD/MM/YYYY')
              || ' (12 mois, ' || v_debut.mois_offerts || ' offerts)',
              1, v_debut.montant_ht, v_debut.montant_ht);
      insert into facturation.facture_annuels (facture_id, engagement_id) values (v_id, v_debut.id);
    end if;

    if l.payeur_type = 'titulaire' then
      for v_montee in
        select m.id, m.libelle, m.montant_ht
          from facturation.engagement_montees m
         where m.licence_id = p_licence and m.le < (p_periode + interval '1 month')::date
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
         where x.licence_id = p_licence
           and x.achetee_le < (p_periode + interval '1 month')::date
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

      for v_paiement in
        select p.id, p.montant_ttc, e.reference, e.prestataire, e.le::date as le,
               facturation.moyen_encaissement_du_paiement(p.id) as moyen
          from facturation.paiements_en_ligne p
          join facturation.paiement_evenements e on e.paiement_id = p.id and e.etat = 'paye'
          -- Seul un prestataire qui fait entrer de l'argent s'impute (la table le dit).
          join facturation.prestataires_paiement pp on pp.code = e.prestataire
                                                   and pp.fait_entrer_argent
         where p.licence_id = p_licence
           -- Le paiement d'une facture s'est inscrit sur ELLE, à la confirmation.
           and p.objet <> 'facture'
           and not exists (select 1 from facturation.paiement_imputations i where i.paiement_id = p.id)
         order by e.le, p.id
      loop
        insert into facturation.encaissements (facture_id, montant, moyen, reference, encaisse_le)
        values (v_id, v_paiement.montant_ttc, v_paiement.moyen,
                v_paiement.prestataire || ' ' || coalesce(v_paiement.reference, v_paiement.id::text),
                v_paiement.le)
        returning id into v_enc;
        insert into facturation.paiement_imputations (paiement_id, encaissement_id)
        values (v_paiement.id, v_enc);
      end loop;
    end if;

    if l.payeur_type = 'titulaire' then
      perform facturation.avertir_de_la_facture(v_id);
    end if;

    if v_premiere is null then
      v_premiere := v_id;
      v_premier  := v_numero;
    end if;
    v_ttc    := v_ttc + v_ht + v_tva + v_timbre;
    v_faites := v_faites || jsonb_build_object(
                  'facture_id', v_id, 'numero', v_numero,
                  'payeur_type', l.payeur_type,
                  'payeur', coalesce(l.payeur_tenant_id, l.payeur_personne),
                  'destinataire', v_nom,
                  'offre_code', l.offre_code,
                  'jours', l.jours, 'jours_du_mois', l.jours_du_mois,
                  'ht', v_ht,
                  'ttc', v_ht + v_tva + v_timbre);
  end loop;

  if jsonb_array_length(v_faites) = 0 then
    if v_couvert then
      return jsonb_build_object('facture_id', null, 'numero', null, 'ttc', 0,
                                'factures', '[]'::jsonb, 'couvert_par', 'annuel');
    end if;
    if v_par_cabinet then
      return jsonb_build_object('facture_id', null, 'numero', null, 'ttc', 0,
                                'factures', '[]'::jsonb, 'couvert_par', 'cabinet');
    end if;
    raise exception
      '%', app.refus_avec_valeurs('refus.facturation.rien_a_facturer', 'periode', (p_periode)::text)
      using errcode = 'no_data_found';
  end if;

  return jsonb_build_object(
    'facture_id', v_premiere, 'numero', v_premier, 'ttc', v_ttc,
    'factures', v_faites);
end
$function$;

CREATE OR REPLACE FUNCTION facturation.emission_du_cabinet(p_cabinet uuid, p_periode date, p_acteur uuid, p_jours_echeance integer DEFAULT 15)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emetteur record;
  v_pack     uuid;
  v_taux     numeric(8,6);
  v_timbre   app.money_t;
  v_ht       app.money_t;
  v_tva      app.money_t;
  v_nb       integer;
  v_nom      text;
  v_legal    text;
  v_numero   text;
  v_id       uuid;
  l          record;
  v_ordinal  smallint := 0;
begin
  if extract(day from p_periode) <> 1 then
    raise exception 'refus.facturation.premier_du_mois' using errcode = 'check_violation';
  end if;
  if exists (select 1 from facturation.factures f
              where f.payeur_tenant_id = p_cabinet and f.periode = p_periode
                and f.licence_id is null and f.avoir_de is null) then
    raise exception '%', app.refus_avec_valeurs('refus.facturation.deja_emise', 'periode', (p_periode)::text)
      using errcode = 'unique_violation';
  end if;

  select o.name, o.legal_id into v_nom, v_legal
    from identity.organizations o where o.id = p_cabinet and o.kind = 'cabinet';
  if v_nom is null then
    raise exception 'refus.introuvable.cabinet' using errcode = 'no_data_found';
  end if;

  select o.currency, o.jurisdiction into v_emetteur
    from facturation.emetteurs e
    join identity.organizations o on o.id = e.organisation_id
   where e.valide_des <= current_date
   order by e.valide_des desc limit 1;
  if not found then
    raise exception 'refus.referentiel.manquant' using errcode = 'no_data_found';
  end if;
  select p.id into v_pack
    from ref.jurisdiction_packs p
   where p.jurisdiction = v_emetteur.jurisdiction
     and p.effective_from <= current_date
     and (p.effective_to is null or p.effective_to >= current_date)
   order by p.effective_from desc limit 1;
  select r.rate into v_taux
    from ref.tva_rates r
   where r.pack_version_id = v_pack and r.code = 'TVA19'
     and r.valid_from <= current_date and (r.valid_to is null or r.valid_to >= current_date)
   order by r.valid_from desc limit 1;
  select coalesce(sp.value_num, sp.value_text::numeric) into v_timbre
    from ref.socle_params sp
   where sp.pack_version_id = v_pack and sp.code = 'facture.droit_de_timbre'
     and sp.valid_from <= current_date and (sp.valid_to is null or sp.valid_to >= current_date)
   order by sp.valid_from desc limit 1;
  if v_taux is null or v_timbre is null then
    raise exception 'refus.referentiel.manquant' using errcode = 'no_data_found';
  end if;

  select coalesce(sum(a.montant_ht), 0), count(*) into v_ht, v_nb
    from facturation.lignes_a_facturer_cabinet(p_cabinet, p_periode) a
   where a.montant_ht > 0;
  if v_nb = 0 then
    raise exception '%', app.refus_avec_valeurs('refus.facturation.rien_a_facturer', 'periode', (p_periode)::text) using errcode = 'no_data_found';
  end if;

  v_tva    := round(v_ht * v_taux, 3);
  v_numero := facturation.numero_de_facture(current_date);

  insert into facturation.factures
    (licence_id, numero, periode, emise_le, echeance_le, offre_code, organisations, sieges_payants,
     montant_ht, taux_tva, montant_tva, timbre, montant_ttc, devise,
     payeur_type, payeur_tenant_id, payeur_personne, destinataire_nom, destinataire_legal_id)
  values
    (null, v_numero, p_periode, current_date, current_date + p_jours_echeance, null, v_nb, 0,
     v_ht, v_taux, v_tva, v_timbre, v_ht + v_tva + v_timbre, v_emetteur.currency,
     'cabinet', p_cabinet, null, v_nom, v_legal)
  returning id into v_id;

  for l in
    select * from facturation.lignes_a_facturer_cabinet(p_cabinet, p_periode) a
     where a.montant_ht > 0 order by a.organisation, a.licence_id
  loop
    v_ordinal := v_ordinal + 1;
    insert into facturation.facture_lignes
      (facture_id, ordinal, libelle, quantite, prix_unitaire, montant_ht, licence_id, tenant_id)
    values (v_id, v_ordinal,
            'Abonnement ' || l.offre_code || ' — ' || l.organisation
              || coalesce(' (' || l.reference || ')', '') || ' — '
              || to_char(p_periode, 'TMMonth YYYY')
              || ' (' || l.jours || '/' || l.jours_du_mois || ' jours)',
            1, l.montant_ht, l.montant_ht, l.licence_id, l.tenant_id);
  end loop;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_cabinet, p_acteur, 'facture.emise', 'facturation', 'factures', v_id,
          jsonb_build_object('numero', v_numero, 'periode', p_periode, 'lignes', v_nb,
                             'ttc', v_ht + v_tva + v_timbre));
  perform notif.emettre(p_cabinet, 'facture.emise', jsonb_build_object('facture_id', v_id, 'numero', v_numero, 'ttc', v_ht + v_tva + v_timbre));

  return jsonb_build_object('facture_id', v_id, 'numero', v_numero, 'lignes', v_nb,
                            'ht', v_ht, 'ttc', v_ht + v_tva + v_timbre);
end
$function$;

-- --------------------------------------------------------------- 6. La séquence globale part
-- Plus aucune fonction ne la tire (vérifié : aucun corps ne la nomme après les trois reprises).
drop sequence facturation.numero_facture_seq;

commit;
