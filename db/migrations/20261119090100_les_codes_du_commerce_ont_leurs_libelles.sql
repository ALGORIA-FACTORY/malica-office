-- ======================================================================
--  Les codes du commerce ont leurs libellés (moteur commercial, 2/9 — plan
--  du 2 novembre 2026, annexe R3 ; décisions du dirigeant n° 1, 10, 14).
--
--  Tout ce que le moteur commercial nomme est un CODE du référentiel, avec
--  son libellé en fr, en et ar (R12) — jamais un littéral français dans une
--  fonction. Une facture dit « Abonnement Solo — novembre 2026 » dans la
--  langue de son destinataire parce que le gabarit de la ligne et le nom du
--  mois sont lus ici, pas dans la locale de PostgreSQL (`TMMonth` rendait le
--  mois dans la langue du serveur).
--
--    ref.actes_intervention      les gestes de la tour : unité, visibilité
--                                client, encore ouvert à une porte ou non ;
--    ref.natures_ligne_facture   le sens comptable d'une ligne (+1 / −1) ;
--    ref.gabarits_de_ligne       le libellé d'une ligne, par gabarit ;
--    ref.natures_document        facture, avoir (série propre, décision 10) ;
--    ref.natures_lecture_due     le registre des lectures dues ;
--    ref.regles_report           aucun, un mois, à vie ;
--    ref.resultats_passe         ce que la passe mensuelle dit d'une cible ;
--    ref.decisions_facture       irrécouvrable, recouvrable ;
--    ref.essais_par_canal        la durée de l'essai par canal (décision 1) ;
--    ref.mois                    les douze mois, nommés dans les trois langues ;
--    ref.rubriques_facture       les rubriques du PDF de facture.
--
--  `ref.droits` reçoit `commerce.lire` (décision 14) : le droit nommé du
--  CHEF DE LA COMPTABILITÉ, accordé personne par personne par le
--  propriétaire principal (20261119090300). Le rôle n'existait pas ; il n'est
--  pas détourné d'un rôle d'adhésion.
--
--  REJEU (R11) : aucune horloge ; les dates d'effet sont des littéraux.
-- ======================================================================

-- ------------------------------------------------------------ 1. Les tables

create table ref.actes_intervention (
  code           text primary key check (code ~ '^[a-z_]+$'),
  rang           smallint not null,
  unite          text not null
                 check (unite in ('aucune', 'pourcentage', 'montant', 'lectures', 'mois', 'jours')),
  visible_client boolean not null,
  ouvert         boolean not null
);
comment on table ref.actes_intervention is
  'Les gestes de la tour (plateforme.interventions.acte). `visible_client` : la PME et son cabinet '
  'le lisent ; `ouvert` : une porte peut encore l''écrire (les actes historiques restent lisibles).';

create table ref.natures_ligne_facture (
  code text primary key check (code ~ '^[a-z_]+$'),
  rang smallint not null,
  sens smallint not null check (sens in (-1, 1))
);

create table ref.gabarits_de_ligne (
  code   text primary key check (code ~ '^[a-z_]+$'),
  nature text not null references ref.natures_ligne_facture (code),
  rang   smallint not null
);
create index gabarits_de_ligne_nature_idx on ref.gabarits_de_ligne (nature);
comment on table ref.gabarits_de_ligne is
  'Le libellé d''une ligne de facture : un gabarit à jetons {x} (ref.labels, espace facture_ligne), '
  'rendu dans la langue de la facture par facturation.libelle_rendu.';

create table ref.natures_document (
  code           text primary key check (code ~ '^[a-z_]+$'),
  rang           smallint not null,
  prefixe_defaut text not null check (prefixe_defaut ~ '^[A-Z]{1,6}$')
);

create table ref.natures_lecture_due (
  code text primary key check (code ~ '^[a-z_]+$'),
  rang smallint not null,
  sens smallint not null check (sens in (-1, 1))
);

create table ref.regles_report (
  code text primary key check (code ~ '^[a-z_]+$'),
  rang smallint not null
);

create table ref.resultats_passe (
  code text primary key check (code ~ '^[a-z_]+$'),
  rang smallint not null
);

create table ref.decisions_facture (
  code text primary key check (code ~ '^[a-z_]+$'),
  rang smallint not null
);

create table ref.essais_par_canal (
  canal          text not null references ref.canaux (code),
  effective_from date not null,
  essai_mois     smallint not null check (essai_mois between 0 and 3),
  primary key (canal, effective_from)
);
comment on table ref.essais_par_canal is
  'La durée de l''essai gratuit par canal, datée (décision du dirigeant n° 1 du 2 novembre 2026 : '
  'un mois sur le canal direct, aucun quand un cabinet dote). Lue par facturation.licence_naitre.';

create table ref.mois (
  numero smallint primary key check (numero between 1 and 12)
);

create table ref.rubriques_facture (
  code text primary key check (code ~ '^[a-z_]+$'),
  rang smallint not null
);
comment on table ref.rubriques_facture is
  'Les rubriques du PDF de facture et d''avoir (ref.labels, espace facture_rubrique) : aucun texte '
  'de la facture n''est écrit dans le code qui la rend.';

do $$
declare t text;
begin
  foreach t in array array['actes_intervention', 'natures_ligne_facture', 'gabarits_de_ligne',
                           'natures_document', 'natures_lecture_due', 'regles_report',
                           'resultats_passe', 'decisions_facture', 'essais_par_canal', 'mois',
                           'rubriques_facture'] loop
    execute format('alter table ref.%I enable row level security', t);
    execute format('alter table ref.%I force row level security', t);
    execute format('revoke all on table ref.%I from public, anon', t);
    execute format('grant select on table ref.%I to authenticated', t);
    execute format('create policy ref_%s_sel on ref.%I for select to authenticated using (true)', t, t);
    execute format('create trigger ref_%s_ajout_seul before update or delete on ref.%I '
                   'for each row execute function app.deny_mutation()', t, t);
  end loop;
end
$$;

-- ------------------------------------------------------------ 2. Les codes

insert into ref.actes_intervention (code, rang, unite, visible_client, ouvert) values
  ('suspension',          10, 'aucune',      true,  true),
  ('reprise',             20, 'aucune',      true,  true),
  ('remise_pourcentage',  30, 'pourcentage', true,  true),
  ('remise_montant',      40, 'montant',     true,  true),
  ('mois_offerts',        50, 'mois',        true,  true),
  ('lectures_offertes',   60, 'lectures',    true,  true),
  ('prolongation_essai',  70, 'jours',       true,  true),
  ('annulation',          80, 'aucune',      true,  true),
  ('note',                90, 'aucune',      false, false),
  ('changement_offre',   100, 'aucune',      true,  false),
  ('supplement_lectures',110, 'lectures',    true,  false);

insert into ref.natures_ligne_facture (code, rang, sens) values
  ('abonnement',          10,  1),
  ('places_et_societes',  20,  1),
  ('annuel',              30,  1),
  ('recharge',            40,  1),
  ('remise',              50, -1),
  ('mois_offert',         60, -1);

insert into ref.gabarits_de_ligne (code, nature, rang) values
  ('abonnement',            'abonnement',         10),
  ('abonnement_cabinet',    'abonnement',         20),
  ('places_et_societes',    'places_et_societes', 30),
  ('annuel',                'annuel',             40),
  ('recharge',              'recharge',           50),
  ('recharge_automatique',  'recharge',           60),
  ('remise_pourcentage',    'remise',             70),
  ('remise_montant',        'remise',             80),
  ('mois_offert',           'mois_offert',        90),
  ('avoir_partiel',         'abonnement',        100);

insert into ref.natures_document (code, rang, prefixe_defaut) values
  ('facture', 10, 'FA'),
  ('avoir',   20, 'AV');

insert into ref.natures_lecture_due (code, rang, sens) values
  ('report_forfait', 10,  1),
  ('offerte',        20,  1),
  ('puisement',      30, -1);

insert into ref.regles_report (code, rang) values
  ('aucun', 10), ('un_mois', 20), ('a_vie', 30);

insert into ref.resultats_passe (code, rang) values
  ('prevue', 10), ('emise', 20), ('deja_emise', 30), ('couverte', 40),
  ('offerte', 50), ('essai', 60), ('rien', 70), ('refus', 80);

insert into ref.decisions_facture (code, rang) values
  ('irrecouvrable', 10), ('recouvrable', 20);

-- Décision n° 1 : un mois sur le canal direct, aucun quand un cabinet dote.
insert into ref.essais_par_canal (canal, effective_from, essai_mois) values
  ('direct',  date '2026-11-02', 1),
  ('cabinet', date '2026-11-02', 0);

insert into ref.mois (numero) select generate_series(1, 12);

insert into ref.rubriques_facture (code, rang) values
  ('facture', 10), ('avoir', 20), ('numero', 30), ('date_emission', 40),
  ('date_echeance', 50), ('periode', 60), ('emetteur', 70), ('client', 80),
  ('matricule_fiscal', 90), ('reference_abonne', 100), ('designation', 110),
  ('quantite', 120), ('prix_unitaire', 130), ('montant_ht', 140), ('total_ht', 150),
  ('tva_au_taux', 160), ('droit_de_timbre', 170), ('total_ttc', 180), ('deja_paye', 190),
  ('reste_a_payer', 200), ('paiement', 210), ('payer_en_ligne', 220), ('a_regler_avant', 230),
  ('payee', 240), ('en_retard', 250), ('page', 260), ('avoir_sur', 270), ('motif', 280),
  ('montants_en', 290), ('numerotation', 300), ('produit', 310);

-- Le droit du chef de la comptabilité (décision n° 14).
alter table ref.droits add column personnel boolean not null default false;
comment on column ref.droits.personnel is
  'Un droit PERSONNEL s''accorde à une personne, pas à un rôle d''adhésion '
  '(identity.droits_personnels, 20261119090300).';
insert into ref.droits (code, sort_order, personnel) values ('commerce.lire', 70, true);

-- ------------------------------------------------------------ 3. Le geste « remise_commerciale » disparaît

-- Il figurait dans la liste autorisée, aucune porte ne l'écrivait : la remise
-- a désormais deux actes nommés, en pourcentage ou en montant.
do $$
begin
  if exists (select 1 from plateforme.interventions where acte = 'remise_commerciale') then
    raise exception 'refus.referentiel.manquant' using errcode = 'check_violation';
  end if;
end
$$;

alter table plateforme.interventions drop constraint interventions_acte_check;
alter table plateforme.interventions
  add constraint interventions_acte_fkey foreign key (acte) references ref.actes_intervention (code);
create index interventions_acte_fk_idx on plateforme.interventions (acte);

-- ------------------------------------------------------------ 4. Les libellés

insert into ref.labels (ns, key, locale, value) values
  -- les gestes de la tour
  ('acte_intervention', 'suspension', 'fr', 'Suspension'),
  ('acte_intervention', 'suspension', 'en', 'Suspension'),
  ('acte_intervention', 'suspension', 'ar', 'إيقاف'),
  ('acte_intervention', 'reprise', 'fr', 'Reprise'),
  ('acte_intervention', 'reprise', 'en', 'Resumption'),
  ('acte_intervention', 'reprise', 'ar', 'استئناف'),
  ('acte_intervention', 'remise_pourcentage', 'fr', 'Remise en pourcentage'),
  ('acte_intervention', 'remise_pourcentage', 'en', 'Percentage discount'),
  ('acte_intervention', 'remise_pourcentage', 'ar', 'تخفيض بنسبة مئوية'),
  ('acte_intervention', 'remise_montant', 'fr', 'Remise en montant'),
  ('acte_intervention', 'remise_montant', 'en', 'Fixed-amount discount'),
  ('acte_intervention', 'remise_montant', 'ar', 'تخفيض بمبلغ'),
  ('acte_intervention', 'mois_offerts', 'fr', 'Mois offerts'),
  ('acte_intervention', 'mois_offerts', 'en', 'Free months'),
  ('acte_intervention', 'mois_offerts', 'ar', 'أشهر مجانية'),
  ('acte_intervention', 'lectures_offertes', 'fr', 'Lectures offertes'),
  ('acte_intervention', 'lectures_offertes', 'en', 'Free readings'),
  ('acte_intervention', 'lectures_offertes', 'ar', 'قراءات مجانية'),
  ('acte_intervention', 'prolongation_essai', 'fr', 'Prolongation d''essai'),
  ('acte_intervention', 'prolongation_essai', 'en', 'Trial extension'),
  ('acte_intervention', 'prolongation_essai', 'ar', 'تمديد الفترة التجريبية'),
  ('acte_intervention', 'annulation', 'fr', 'Annulation d''un geste'),
  ('acte_intervention', 'annulation', 'en', 'Cancellation of a gesture'),
  ('acte_intervention', 'annulation', 'ar', 'إلغاء إجراء'),
  ('acte_intervention', 'note', 'fr', 'Note interne'),
  ('acte_intervention', 'note', 'en', 'Internal note'),
  ('acte_intervention', 'note', 'ar', 'ملاحظة داخلية'),
  ('acte_intervention', 'changement_offre', 'fr', 'Changement d''offre'),
  ('acte_intervention', 'changement_offre', 'en', 'Plan change'),
  ('acte_intervention', 'changement_offre', 'ar', 'تغيير العرض'),
  ('acte_intervention', 'supplement_lectures', 'fr', 'Supplément de lectures (historique)'),
  ('acte_intervention', 'supplement_lectures', 'en', 'Reading supplement (legacy)'),
  ('acte_intervention', 'supplement_lectures', 'ar', 'قراءات إضافية (سابق)'),
  -- le sens d'une ligne
  ('nature_ligne_facture', 'abonnement', 'fr', 'Abonnement'),
  ('nature_ligne_facture', 'abonnement', 'en', 'Subscription'),
  ('nature_ligne_facture', 'abonnement', 'ar', 'اشتراك'),
  ('nature_ligne_facture', 'places_et_societes', 'fr', 'Places et sociétés en plus'),
  ('nature_ligne_facture', 'places_et_societes', 'en', 'Extra seats and companies'),
  ('nature_ligne_facture', 'places_et_societes', 'ar', 'مقاعد وشركات إضافية'),
  ('nature_ligne_facture', 'annuel', 'fr', 'Abonnement annuel'),
  ('nature_ligne_facture', 'annuel', 'en', 'Annual subscription'),
  ('nature_ligne_facture', 'annuel', 'ar', 'اشتراك سنوي'),
  ('nature_ligne_facture', 'recharge', 'fr', 'Recharge de lectures'),
  ('nature_ligne_facture', 'recharge', 'en', 'Reading top-up'),
  ('nature_ligne_facture', 'recharge', 'ar', 'شحن قراءات'),
  ('nature_ligne_facture', 'remise', 'fr', 'Remise commerciale'),
  ('nature_ligne_facture', 'remise', 'en', 'Commercial discount'),
  ('nature_ligne_facture', 'remise', 'ar', 'تخفيض تجاري'),
  ('nature_ligne_facture', 'mois_offert', 'fr', 'Mois offert'),
  ('nature_ligne_facture', 'mois_offert', 'en', 'Free month'),
  ('nature_ligne_facture', 'mois_offert', 'ar', 'شهر مجاني'),
  -- le libellé d'une ligne : jetons {x}, rendus par facturation.libelle_rendu
  ('facture_ligne', 'abonnement', 'fr', 'Abonnement {offre} — {mois} {annee} ({jours}/{jours_du_mois} jours)'),
  ('facture_ligne', 'abonnement', 'en', '{offre} subscription — {mois} {annee} ({jours}/{jours_du_mois} days)'),
  ('facture_ligne', 'abonnement', 'ar', 'اشتراك {offre} — {mois} {annee} ({jours}/{jours_du_mois} يومًا)'),
  ('facture_ligne', 'abonnement_cabinet', 'fr', 'Abonnement {offre} — {organisation}{reference} — {mois} {annee} ({jours}/{jours_du_mois} jours)'),
  ('facture_ligne', 'abonnement_cabinet', 'en', '{offre} subscription — {organisation}{reference} — {mois} {annee} ({jours}/{jours_du_mois} days)'),
  ('facture_ligne', 'abonnement_cabinet', 'ar', 'اشتراك {offre} — {organisation}{reference} — {mois} {annee} ({jours}/{jours_du_mois} يومًا)'),
  ('facture_ligne', 'places_et_societes', 'fr', 'Places et sociétés en plus — {mois} {annee} (l''offre est couverte par l''abonnement annuel)'),
  ('facture_ligne', 'places_et_societes', 'en', 'Extra seats and companies — {mois} {annee} (the plan is covered by the annual subscription)'),
  ('facture_ligne', 'places_et_societes', 'ar', 'مقاعد وشركات إضافية — {mois} {annee} (العرض مشمول بالاشتراك السنوي)'),
  ('facture_ligne', 'annuel', 'fr', 'Abonnement annuel {offre} — du {du} au {au} (12 mois, {mois_offerts} offerts)'),
  ('facture_ligne', 'annuel', 'en', 'Annual {offre} subscription — {du} to {au} (12 months, {mois_offerts} free)'),
  ('facture_ligne', 'annuel', 'ar', 'اشتراك سنوي {offre} — من {du} إلى {au} (12 شهرًا، منها {mois_offerts} مجانًا)'),
  ('facture_ligne', 'recharge', 'fr', 'Recharge de {lectures} lectures — {le}'),
  ('facture_ligne', 'recharge', 'en', 'Top-up of {lectures} readings — {le}'),
  ('facture_ligne', 'recharge', 'ar', 'شحن {lectures} قراءة — {le}'),
  ('facture_ligne', 'recharge_automatique', 'fr', 'Recharge de {lectures} lectures (automatique) — {le}'),
  ('facture_ligne', 'recharge_automatique', 'en', 'Top-up of {lectures} readings (automatic) — {le}'),
  ('facture_ligne', 'recharge_automatique', 'ar', 'شحن {lectures} قراءة (تلقائي) — {le}'),
  ('facture_ligne', 'remise_pourcentage', 'fr', 'Remise commerciale de {taux} % — {mois} {annee}'),
  ('facture_ligne', 'remise_pourcentage', 'en', 'Commercial discount of {taux}% — {mois} {annee}'),
  ('facture_ligne', 'remise_pourcentage', 'ar', 'تخفيض تجاري بنسبة {taux}٪ — {mois} {annee}'),
  ('facture_ligne', 'remise_montant', 'fr', 'Remise commerciale — {mois} {annee}'),
  ('facture_ligne', 'remise_montant', 'en', 'Commercial discount — {mois} {annee}'),
  ('facture_ligne', 'remise_montant', 'ar', 'تخفيض تجاري — {mois} {annee}'),
  ('facture_ligne', 'mois_offert', 'fr', 'Mois offert — {mois} {annee}'),
  ('facture_ligne', 'mois_offert', 'en', 'Free month — {mois} {annee}'),
  ('facture_ligne', 'mois_offert', 'ar', 'شهر مجاني — {mois} {annee}'),
  ('facture_ligne', 'avoir_partiel', 'fr', 'Avoir partiel sur la facture {numero}'),
  ('facture_ligne', 'avoir_partiel', 'en', 'Partial credit on invoice {numero}'),
  ('facture_ligne', 'avoir_partiel', 'ar', 'تعديل جزئي للفاتورة {numero}'),
  -- facture, avoir
  ('nature_document', 'facture', 'fr', 'Facture'),
  ('nature_document', 'facture', 'en', 'Invoice'),
  ('nature_document', 'facture', 'ar', 'فاتورة'),
  ('nature_document', 'avoir', 'fr', 'Avoir'),
  ('nature_document', 'avoir', 'en', 'Credit note'),
  ('nature_document', 'avoir', 'ar', 'فاتورة تعديلية دائنة'),
  -- les lectures dues
  ('nature_lecture_due', 'report_forfait', 'fr', 'Lectures du forfait non consommées'),
  ('nature_lecture_due', 'report_forfait', 'en', 'Unused plan readings'),
  ('nature_lecture_due', 'report_forfait', 'ar', 'قراءات الباقة غير المستهلكة'),
  ('nature_lecture_due', 'offerte', 'fr', 'Lectures offertes'),
  ('nature_lecture_due', 'offerte', 'en', 'Free readings'),
  ('nature_lecture_due', 'offerte', 'ar', 'قراءات مجانية'),
  ('nature_lecture_due', 'puisement', 'fr', 'Lectures prises dans le stock'),
  ('nature_lecture_due', 'puisement', 'en', 'Readings drawn from the balance'),
  ('nature_lecture_due', 'puisement', 'ar', 'قراءات مأخوذة من الرصيد'),
  -- le report
  ('regle_report', 'aucun', 'fr', 'Aucun report'),
  ('regle_report', 'aucun', 'en', 'No carry-over'),
  ('regle_report', 'aucun', 'ar', 'دون ترحيل'),
  ('regle_report', 'un_mois', 'fr', 'Report d''un mois'),
  ('regle_report', 'un_mois', 'en', 'One-month carry-over'),
  ('regle_report', 'un_mois', 'ar', 'ترحيل لشهر واحد'),
  ('regle_report', 'a_vie', 'fr', 'Gardées à vie'),
  ('regle_report', 'a_vie', 'en', 'Kept for life'),
  ('regle_report', 'a_vie', 'ar', 'محفوظة مدى الحياة'),
  -- la passe mensuelle
  ('resultat_passe', 'prevue', 'fr', 'Prévue'),
  ('resultat_passe', 'prevue', 'en', 'Planned'),
  ('resultat_passe', 'prevue', 'ar', 'مبرمجة'),
  ('resultat_passe', 'emise', 'fr', 'Émise'),
  ('resultat_passe', 'emise', 'en', 'Issued'),
  ('resultat_passe', 'emise', 'ar', 'صادرة'),
  ('resultat_passe', 'deja_emise', 'fr', 'Déjà émise'),
  ('resultat_passe', 'deja_emise', 'en', 'Already issued'),
  ('resultat_passe', 'deja_emise', 'ar', 'صادرة سابقًا'),
  ('resultat_passe', 'couverte', 'fr', 'Couverte par l''abonnement annuel'),
  ('resultat_passe', 'couverte', 'en', 'Covered by the annual subscription'),
  ('resultat_passe', 'couverte', 'ar', 'مشمولة بالاشتراك السنوي'),
  ('resultat_passe', 'offerte', 'fr', 'Offerte'),
  ('resultat_passe', 'offerte', 'en', 'Free of charge'),
  ('resultat_passe', 'offerte', 'ar', 'مجانية'),
  ('resultat_passe', 'essai', 'fr', 'En essai'),
  ('resultat_passe', 'essai', 'en', 'On trial'),
  ('resultat_passe', 'essai', 'ar', 'في الفترة التجريبية'),
  ('resultat_passe', 'rien', 'fr', 'Rien à facturer'),
  ('resultat_passe', 'rien', 'en', 'Nothing to invoice'),
  ('resultat_passe', 'rien', 'ar', 'لا شيء للفوترة'),
  ('resultat_passe', 'refus', 'fr', 'Refusée'),
  ('resultat_passe', 'refus', 'en', 'Refused'),
  ('resultat_passe', 'refus', 'ar', 'مرفوضة'),
  -- les décisions sur facture
  ('decision_facture', 'irrecouvrable', 'fr', 'Irrécouvrable'),
  ('decision_facture', 'irrecouvrable', 'en', 'Uncollectible'),
  ('decision_facture', 'irrecouvrable', 'ar', 'غير قابلة للاستخلاص'),
  ('decision_facture', 'recouvrable', 'fr', 'De nouveau recouvrable'),
  ('decision_facture', 'recouvrable', 'en', 'Collectible again'),
  ('decision_facture', 'recouvrable', 'ar', 'قابلة للاستخلاص من جديد'),
  -- le droit du chef de la comptabilité
  ('droit_personnel', 'commerce.lire', 'fr', 'Chef de la comptabilité : voit l''abonnement, les factures et les gestes commerciaux'),
  ('droit_personnel', 'commerce.lire', 'en', 'Head of accounting: sees the subscription, invoices and commercial gestures'),
  ('droit_personnel', 'commerce.lire', 'ar', 'رئيس المحاسبة: يطّلع على الاشتراك والفواتير والإجراءات التجارية'),
  -- les mois
  ('mois', '1', 'fr', 'janvier'),   ('mois', '1', 'en', 'January'),   ('mois', '1', 'ar', 'جانفي'),
  ('mois', '2', 'fr', 'février'),   ('mois', '2', 'en', 'February'),  ('mois', '2', 'ar', 'فيفري'),
  ('mois', '3', 'fr', 'mars'),      ('mois', '3', 'en', 'March'),     ('mois', '3', 'ar', 'مارس'),
  ('mois', '4', 'fr', 'avril'),     ('mois', '4', 'en', 'April'),     ('mois', '4', 'ar', 'أفريل'),
  ('mois', '5', 'fr', 'mai'),       ('mois', '5', 'en', 'May'),       ('mois', '5', 'ar', 'ماي'),
  ('mois', '6', 'fr', 'juin'),      ('mois', '6', 'en', 'June'),      ('mois', '6', 'ar', 'جوان'),
  ('mois', '7', 'fr', 'juillet'),   ('mois', '7', 'en', 'July'),      ('mois', '7', 'ar', 'جويلية'),
  ('mois', '8', 'fr', 'août'),      ('mois', '8', 'en', 'August'),    ('mois', '8', 'ar', 'أوت'),
  ('mois', '9', 'fr', 'septembre'), ('mois', '9', 'en', 'September'), ('mois', '9', 'ar', 'سبتمبر'),
  ('mois', '10', 'fr', 'octobre'),  ('mois', '10', 'en', 'October'),  ('mois', '10', 'ar', 'أكتوبر'),
  ('mois', '11', 'fr', 'novembre'), ('mois', '11', 'en', 'November'), ('mois', '11', 'ar', 'نوفمبر'),
  ('mois', '12', 'fr', 'décembre'), ('mois', '12', 'en', 'December'), ('mois', '12', 'ar', 'ديسمبر'),
  -- les rubriques du PDF
  ('facture_rubrique', 'facture', 'fr', 'Facture'),
  ('facture_rubrique', 'facture', 'en', 'Invoice'),
  ('facture_rubrique', 'facture', 'ar', 'فاتورة'),
  ('facture_rubrique', 'avoir', 'fr', 'Avoir'),
  ('facture_rubrique', 'avoir', 'en', 'Credit note'),
  ('facture_rubrique', 'avoir', 'ar', 'فاتورة تعديلية دائنة'),
  ('facture_rubrique', 'numero', 'fr', 'N°'),
  ('facture_rubrique', 'numero', 'en', 'No.'),
  ('facture_rubrique', 'numero', 'ar', 'عدد'),
  ('facture_rubrique', 'date_emission', 'fr', 'Émise le'),
  ('facture_rubrique', 'date_emission', 'en', 'Issued on'),
  ('facture_rubrique', 'date_emission', 'ar', 'تاريخ الإصدار'),
  ('facture_rubrique', 'date_echeance', 'fr', 'Échéance'),
  ('facture_rubrique', 'date_echeance', 'en', 'Due date'),
  ('facture_rubrique', 'date_echeance', 'ar', 'تاريخ الاستحقاق'),
  ('facture_rubrique', 'periode', 'fr', 'Période'),
  ('facture_rubrique', 'periode', 'en', 'Period'),
  ('facture_rubrique', 'periode', 'ar', 'الفترة'),
  ('facture_rubrique', 'emetteur', 'fr', 'Émetteur'),
  ('facture_rubrique', 'emetteur', 'en', 'From'),
  ('facture_rubrique', 'emetteur', 'ar', 'المُصدِر'),
  ('facture_rubrique', 'client', 'fr', 'Client'),
  ('facture_rubrique', 'client', 'en', 'Bill to'),
  ('facture_rubrique', 'client', 'ar', 'الحريف'),
  ('facture_rubrique', 'matricule_fiscal', 'fr', 'Matricule fiscal'),
  ('facture_rubrique', 'matricule_fiscal', 'en', 'Tax ID'),
  ('facture_rubrique', 'matricule_fiscal', 'ar', 'المعرّف الجبائي'),
  ('facture_rubrique', 'reference_abonne', 'fr', 'Référence abonné'),
  ('facture_rubrique', 'reference_abonne', 'en', 'Subscriber reference'),
  ('facture_rubrique', 'reference_abonne', 'ar', 'مرجع المشترك'),
  ('facture_rubrique', 'designation', 'fr', 'Désignation'),
  ('facture_rubrique', 'designation', 'en', 'Description'),
  ('facture_rubrique', 'designation', 'ar', 'البيان'),
  ('facture_rubrique', 'quantite', 'fr', 'Qté'),
  ('facture_rubrique', 'quantite', 'en', 'Qty'),
  ('facture_rubrique', 'quantite', 'ar', 'الكمية'),
  ('facture_rubrique', 'prix_unitaire', 'fr', 'Prix unitaire HT'),
  ('facture_rubrique', 'prix_unitaire', 'en', 'Unit price excl. VAT'),
  ('facture_rubrique', 'prix_unitaire', 'ar', 'سعر الوحدة دون أداء'),
  ('facture_rubrique', 'montant_ht', 'fr', 'Montant HT'),
  ('facture_rubrique', 'montant_ht', 'en', 'Amount excl. VAT'),
  ('facture_rubrique', 'montant_ht', 'ar', 'المبلغ دون أداء'),
  ('facture_rubrique', 'total_ht', 'fr', 'Total HT'),
  ('facture_rubrique', 'total_ht', 'en', 'Total excl. VAT'),
  ('facture_rubrique', 'total_ht', 'ar', 'المجموع دون أداء'),
  ('facture_rubrique', 'tva_au_taux', 'fr', 'TVA {taux} %'),
  ('facture_rubrique', 'tva_au_taux', 'en', 'VAT {taux}%'),
  ('facture_rubrique', 'tva_au_taux', 'ar', 'الأداء على القيمة المضافة {taux}٪'),
  ('facture_rubrique', 'droit_de_timbre', 'fr', 'Droit de timbre'),
  ('facture_rubrique', 'droit_de_timbre', 'en', 'Stamp duty'),
  ('facture_rubrique', 'droit_de_timbre', 'ar', 'معلوم الطابع الجبائي'),
  ('facture_rubrique', 'total_ttc', 'fr', 'Total TTC'),
  ('facture_rubrique', 'total_ttc', 'en', 'Total incl. VAT'),
  ('facture_rubrique', 'total_ttc', 'ar', 'المجموع باعتبار الأداءات'),
  ('facture_rubrique', 'deja_paye', 'fr', 'Déjà payé'),
  ('facture_rubrique', 'deja_paye', 'en', 'Already paid'),
  ('facture_rubrique', 'deja_paye', 'ar', 'المبلغ المدفوع'),
  ('facture_rubrique', 'reste_a_payer', 'fr', 'Reste à payer'),
  ('facture_rubrique', 'reste_a_payer', 'en', 'Balance due'),
  ('facture_rubrique', 'reste_a_payer', 'ar', 'المتبقي للدفع'),
  ('facture_rubrique', 'paiement', 'fr', 'Paiement'),
  ('facture_rubrique', 'paiement', 'en', 'Payment'),
  ('facture_rubrique', 'paiement', 'ar', 'الدفع'),
  ('facture_rubrique', 'payer_en_ligne', 'fr', 'Payer en ligne depuis votre espace :'),
  ('facture_rubrique', 'payer_en_ligne', 'en', 'Pay online from your account:'),
  ('facture_rubrique', 'payer_en_ligne', 'ar', 'ادفعوا عبر الإنترنت من فضائكم:'),
  ('facture_rubrique', 'a_regler_avant', 'fr', 'À régler avant le {date}.'),
  ('facture_rubrique', 'a_regler_avant', 'en', 'Payable by {date}.'),
  ('facture_rubrique', 'a_regler_avant', 'ar', 'يُدفع قبل {date}.'),
  ('facture_rubrique', 'payee', 'fr', 'Payée'),
  ('facture_rubrique', 'payee', 'en', 'Paid'),
  ('facture_rubrique', 'payee', 'ar', 'مدفوعة'),
  ('facture_rubrique', 'en_retard', 'fr', 'En retard'),
  ('facture_rubrique', 'en_retard', 'en', 'Overdue'),
  ('facture_rubrique', 'en_retard', 'ar', 'متأخرة'),
  ('facture_rubrique', 'page', 'fr', 'Page {n} sur {total}'),
  ('facture_rubrique', 'page', 'en', 'Page {n} of {total}'),
  ('facture_rubrique', 'page', 'ar', 'الصفحة {n} من {total}'),
  ('facture_rubrique', 'avoir_sur', 'fr', 'Avoir sur la facture {numero} du {date}'),
  ('facture_rubrique', 'avoir_sur', 'en', 'Credit note on invoice {numero} of {date}'),
  ('facture_rubrique', 'avoir_sur', 'ar', 'تعديل للفاتورة {numero} بتاريخ {date}'),
  ('facture_rubrique', 'motif', 'fr', 'Motif'),
  ('facture_rubrique', 'motif', 'en', 'Reason'),
  ('facture_rubrique', 'motif', 'ar', 'السبب'),
  ('facture_rubrique', 'montants_en', 'fr', 'Montants en {devise}'),
  ('facture_rubrique', 'montants_en', 'en', 'Amounts in {devise}'),
  ('facture_rubrique', 'montants_en', 'ar', 'المبالغ بـ{devise}'),
  ('facture_rubrique', 'numerotation', 'fr', 'Numérotée sans interruption par émetteur, par année et par série.'),
  ('facture_rubrique', 'numerotation', 'en', 'Numbered without gaps per issuer, year and series.'),
  ('facture_rubrique', 'numerotation', 'ar', 'مرقّمة دون انقطاع حسب المُصدِر والسنة والسلسلة.'),
  ('facture_rubrique', 'produit', 'fr', 'Établie avec Malica Office'),
  ('facture_rubrique', 'produit', 'en', 'Prepared with Malica Office'),
  ('facture_rubrique', 'produit', 'ar', 'أُعدّت بواسطة Malica Office');
