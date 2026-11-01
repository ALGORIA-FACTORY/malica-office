-- Les réglages comptables du cabinet (31 octobre 2026).
--
-- Onze arbitrages comptables et fiscaux ont été tranchés par le dirigeant le
-- 31 octobre 2026 (« tout ceci on peut les paramétrer dans la partie réglages
-- comptabilité »). Chacun est un DÉFAUT du pack (R10), décidé par le CEO et à
-- faire valider par un expert-comptable : le cabinet le confirme ou le change,
-- pour lui ou pour un dossier, sans migration.
--
-- ==================================================================== LE MÉCANISME
--
-- Un seul, pour tous les réglages, sur le modèle de la règle de change (#148)
-- et de la déclaration de TVA (#145) :
--
--   ref.reglages_comptables_sujets    les onze sujets, dans l'ordre de l'écran ;
--                                     leur texte, leur pratique, leur risque et
--                                     leur point INCERTAIN vivent dans ref.labels
--                                     (fr, en, ar), leurs sources datées dans
--                                     ref.reglages_comptables_sources ;
--   ref.reglages_comptables           les réglages d'un sujet : une option ou un
--                                     nombre, et la PORTE où une décision
--                                     s'écrit ;
--   ref.reglages_comptables_options   les options d'un réglage, et si le Socle
--                                     l'applique déjà (« Enregistré — pas encore
--                                     appliqué par le Socle » sinon) ;
--   ref.baremes_des_droits            le barème par tranches d'un droit hors TVA
--                                     (le timbre des grandes surfaces, LF 2026) ;
--   ref.taux_d_amortissement_maximaux les plafonds du décret 2008-492 ;
--   ref.socle_params                  le défaut du pack, daté, avec sa
--                                     `legal_reference` — la même table que les
--                                     défauts de la règle de change (`change.*`) ;
--   parametrage.reglages_comptables   ce que le cabinet arrête : en ajout seul,
--                                     daté, signé ; une valeur nulle rend au pack ;
--   app.reglage_comptable             LE résolveur : le dossier, puis le cabinet
--                                     qui le tient, puis le pack — et d'où vient
--                                     chaque valeur ;
--   app.reglages_comptables_arreter   LA porte d'écriture, au `portier`, droits
--                                     vérifiés par `app.peut_arreter_le_parametrage`
--                                     (#149).
--
-- ============================================ CE QUI N'EST PAS DUPLIQUÉ, ET POURQUOI
--
-- La règle de change a déjà sa table (`parametrage.regles_de_change`), son
-- résolveur et sa porte, que lisent le jugement d'une pièce en devise, la
-- péremption d'un jugement (`app.cours_du_jugement_a_jour`) et la proposition.
-- Ses quatre codes sont INSCRITS ici avec la porte `regles_de_change` : le
-- résolveur générique les rend en appelant `app.regle_de_change`, la porte
-- générique les transmet à `app.regle_de_change_arreter`, et leurs valeurs ne
-- s'écrivent qu'à un endroit. Les migrer aurait réécrit un chemin chaud fusionné
-- la veille (#148, #151) pour un comportement identique.
--
-- Les lignes de la déclaration de TVA ne sont pas un réglage à une valeur (une
-- ligne par sens et nature) : elles restent dans `parametrage.tva_affectations`,
-- arrêtées sur la fiche du dossier. Les comptes des rôles restent dans
-- `parametrage.role_bindings` (Plan comptable). Les comptes du timbre et du
-- FODEC restent dans `ref.fiscal_charges`, ceux des immobilisations dans
-- `ref.immo_categories` : l'écran les MONTRE, il ne les recopie pas.
--
-- ============================================================= LES ONZE CHOIX DU CEO
--
--   immobilisation  seuil200_actif           → traitement actif_amorti, seuil 200 (HT)
--   comptes_immo    nc01_2282_43662
--   fodec           par_article_4374_cout
--   timbre          bareme_date
--   change          bct_jour_facture         → change.source BCT, change.date_retenue
--                                              date_facture (les défauts de #148)
--   non_residents   au_paiement
--   prorata         affectation_puis_prorata
--   avoirs          lie_facture
--   ventes          par_nature_article
--   conservation    10ans_cloture_teif
--   mois_tva        exigibilite_calculee
--
-- Le choix « seuil200_actif » se décompose en deux réglages : le seuil (un
-- nombre, que le cabinet peut porter à 500 si un texte modificatif est
-- confirmé) et le traitement d'un bien sous le seuil. Les quatre options de la
-- recherche s'y expriment toutes.
--
-- ============================================================== CE QUI S'APPLIQUE
--
-- Appliqués par le Socle : le seuil et le traitement des immobilisations (la
-- réserve du jugement), le FODEC à l'achat (incorporé au coût, ou 6652), la
-- règle de change. Les autres sont ENREGISTRÉS et le disent à l'écran : la
-- retenue sur les non-résidents au paiement, le prorata, la date d'exigibilité
-- de la TVA, le compte de vente par nature d'article, l'avoir lié à sa facture,
-- le barème des grandes surfaces, la durée de conservation. Aucun n'est un
-- bouchon silencieux : `applique` le dit, ligne par ligne.
--
-- INCERTAIN (à confirmer par un expert-comptable) : chaque point marqué dans
-- `reglage_sujet_incertain`. Les textes, pratiques, risques et sources sont
-- ceux de la recherche du 31 octobre 2026 (« Arbitrages fiscaux Malica ») ;
-- rien n'y est ajouté.
--
-- REJEU (R11) : dates en littéral ; aucune horloge n'écrit dans `ref`.

begin;

-- --- 1. Les sujets, leurs réglages, leurs options, leurs sources ---------------------------------

create table ref.reglages_comptables_sujets (
  code        text primary key check (code ~ '^[a-z][a-z0-9_]*$'),
  ordre       smallint not null unique check (ordre > 0),
  -- Le droit hors TVA que le sujet gouverne (`ref.fiscal_charges.code`) : le
  -- Socle l'applique, et l'écran en montre les comptes et le barème du pack.
  droit_hors_tva text check (droit_hors_tva ~ '^[A-Z][A-Z0-9_]*$'),
  -- Le sujet montre les catégories d'immobilisations du pack, leurs comptes
  -- et leur taux maximal (`ref.immo_categories`, `ref.taux_d_amortissement_maximaux`).
  categories_d_immobilisation boolean not null,
  -- Un point du sujet reste à confirmer (texte, seuil, ligne de formulaire).
  incertain   boolean not null
);

comment on table ref.reglages_comptables_sujets is
  'Les sujets de « Réglages comptabilité », dans l''ordre de l''écran. Texte, pratique, risque '
  'et point INCERTAIN : ref.labels (reglage_sujet*) ; sources datées : '
  'ref.reglages_comptables_sources (31 octobre 2026).';

create table ref.reglages_comptables (
  code     text primary key check (code ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  sujet    text not null references ref.reglages_comptables_sujets (code),
  ordre    smallint not null check (ordre > 0),
  -- Une option de la liste, ou un nombre décimal positif.
  nature   text not null check (nature in ('option', 'nombre')),
  -- Où la décision s'écrit : la table générique, ou celle de la règle de
  -- change, qui existait avant elle (#148) et n'est pas dupliquée.
  porte    text not null check (porte in ('reglages_comptables', 'regles_de_change')),
  -- Le Socle lit-il ce réglage ? Faux : enregistré, pas encore appliqué.
  applique boolean not null,
  unique (sujet, ordre)
);

comment on table ref.reglages_comptables is
  'Les réglages comptables que le cabinet arrête (R10). Défaut : ref.socle_params, même code. '
  'Décision : parametrage.reglages_comptables, ou parametrage.regles_de_change pour la porte '
  '« regles_de_change ». « applique » faux : enregistré, pas encore appliqué par le Socle.';

create table ref.reglages_comptables_options (
  reglage  text not null references ref.reglages_comptables (code),
  code     text not null check (code ~ '^[a-z0-9][a-z0-9_]*$'),
  ordre    smallint not null check (ordre > 0),
  -- Le Socle sait-il appliquer cette option ? Chaque option appliquée a son
  -- implémentation, et une épreuve les confronte (`reglages-comptables.ts`).
  applique boolean not null,
  primary key (reglage, code),
  unique (reglage, ordre)
);

create table ref.reglages_comptables_sources (
  sujet        text not null references ref.reglages_comptables_sujets (code),
  ordre        smallint not null check (ordre > 0),
  titre        text not null check (length(btrim(titre)) > 0),
  url          text not null check (url ~ '^https://'),
  -- La date que porte la source, quand elle en porte une.
  datee_du     date,
  consultee_le date not null,
  primary key (sujet, ordre)
);

-- --- 2. Les barèmes que la recherche nomme ------------------------------------------------------

-- Les taux MAXIMAUX d'amortissement du décret 2008-492, par catégorie du pack
-- (`ref.immo_categories.code`). Un plafond fiscal, pas une durée : la durée
-- d'un bien reste celle de sa catégorie. Seules les catégories que la
-- recherche cite ont un plafond ; les autres n'en ont pas, et rien n'est
-- deviné. Le plafond se compare au taux LINÉAIRE de la catégorie (100 / durée) ;
-- le cas du dégressif est INCERTAIN.
create table ref.taux_d_amortissement_maximaux (
  pack_version_id uuid not null references ref.jurisdiction_packs (id),
  categorie       text not null check (categorie ~ '^[a-z][a-z_]*$'),
  taux_pourcent   numeric(5,2) not null check (taux_pourcent > 0 and taux_pourcent <= 100),
  legal_reference text not null check (length(btrim(legal_reference)) > 0),
  valid_from      date not null,
  valid_to        date,
  check (valid_to is null or valid_to >= valid_from),
  primary key (pack_version_id, categorie, valid_from)
);

insert into ref.taux_d_amortissement_maximaux
  (pack_version_id, categorie, taux_pourcent, legal_reference, valid_from)
select p.id, v.categorie, v.taux,
       'Décret 2008-492 du 25/02/2008 (taux maximaux ; Code IRPP/IS art. 12 bis) : ' || v.libelle,
       date '2008-02-25'
  from ref.jurisdiction_packs p
 cross join (values
   ('informatique', 33.33::numeric, 'informatique 33,33 %'),
   ('mobilier', 20.00, 'mobilier et bureau 20 %'),
   ('vehicules', 20.00, 'transport 20 %'),
   ('materiel', 15.00, 'machines 15 %'),
   ('constructions', 5.00, 'constructions 5 %')
 ) as v(categorie, taux, libelle)
 where p.jurisdiction = 'TN' and p.version = '2026.1';

-- Le barème du droit de timbre des grandes surfaces (LF 2026, loi 2025-17,
-- art. 20). Le droit standard (1 D par facture depuis le 01/01/2023) reste
-- dans `ref.fiscal_charges` (DROIT_TIMBRE), que le Socle applique : il n'est
-- pas recopié ici. INCERTAIN : l'unité exacte du barème (« 1,500 », « 2,000 »)
-- et l'assiette des tranches restent à confirmer au JORT ; le Socle ne sait
-- pas encore qui est une grande surface, et ne l'applique donc pas.
create table ref.baremes_des_droits (
  pack_version_id uuid not null references ref.jurisdiction_packs (id),
  -- Le droit hors TVA que le barème tarife (`ref.fiscal_charges.code`).
  droit           text not null check (droit ~ '^[A-Z][A-Z0-9_]*$'),
  -- À qui la tranche s'applique (les grandes surfaces).
  categorie       text not null check (categorie ~ '^[a-z][a-z_]*$'),
  -- Les bornes de la tranche, dans la devise du pack ; nulle : sans plafond.
  montant_de      numeric(18,3) not null check (montant_de >= 0),
  montant_a       numeric(18,3),
  montant_du_droit numeric(18,3) not null check (montant_du_droit > 0),
  unite_incertaine boolean not null,
  legal_reference text not null check (length(btrim(legal_reference)) > 0),
  valid_from      date not null,
  valid_to        date,
  check (montant_a is null or montant_a > montant_de),
  check (valid_to is null or valid_to >= valid_from),
  primary key (pack_version_id, droit, categorie, montant_de, valid_from)
);

insert into ref.baremes_des_droits
  (pack_version_id, droit, categorie, montant_de, montant_a, montant_du_droit, unite_incertaine,
   legal_reference, valid_from)
select p.id, 'DROIT_TIMBRE', 'grandes_surfaces', v.de, v.a, v.droit, true,
       'LF 2026 (loi 2025-17), art. 20 : nouveau barème pour les grandes surfaces (« 1,500 » de '
       '50 à 100 D, « 2,000 » au-delà). INCERTAIN : unité exacte à confirmer au JORT.',
       date '2026-01-01'
  from ref.jurisdiction_packs p
 cross join (values
   (50.000::numeric, 100.000::numeric, 1.500::numeric),
   (100.000, null, 2.000)
 ) as v(de, a, droit)
 where p.jurisdiction = 'TN' and p.version = '2026.1';

do $$
declare t text;
begin
  foreach t in array array['reglages_comptables_sujets', 'reglages_comptables',
                           'reglages_comptables_options', 'reglages_comptables_sources',
                           'taux_d_amortissement_maximaux', 'baremes_des_droits']
  loop
    execute format('alter table ref.%I enable row level security', t);
    execute format('alter table ref.%I force row level security', t);
    execute format('revoke all on table ref.%I from public, anon', t);
    execute format('grant select on table ref.%I to authenticated', t);
    execute format('create policy %I on ref.%I for select to authenticated using (true)',
                   'ref_' || t || '_sel', t);
  end loop;
end $$;

-- --- 3. Les sujets et leurs réglages ------------------------------------------------------------

insert into ref.reglages_comptables_sujets
  (code, ordre, droit_hors_tva, categories_d_immobilisation, incertain) values
  ('immobilisation', 1, null, true, true),
  ('comptes_immo', 2, null, true, true),
  ('fodec', 3, 'FODEC', false, true),
  ('timbre', 4, 'DROIT_TIMBRE', false, true),
  ('change', 5, null, false, true),
  ('non_residents', 6, null, false, true),
  ('prorata', 7, null, false, true),
  ('avoirs', 8, null, false, true),
  ('ventes', 9, null, false, false),
  ('conservation', 10, null, false, true),
  ('mois_tva', 11, null, false, false);

insert into ref.reglages_comptables (code, sujet, ordre, nature, porte, applique) values
  ('immobilisation.seuil', 'immobilisation', 1, 'nombre', 'reglages_comptables', true),
  ('immobilisation.traitement', 'immobilisation', 2, 'option', 'reglages_comptables', true),
  ('comptes_immo.plan', 'comptes_immo', 1, 'option', 'reglages_comptables', true),
  ('fodec.traitement', 'fodec', 1, 'option', 'reglages_comptables', true),
  ('timbre.bareme', 'timbre', 1, 'option', 'reglages_comptables', true),
  ('change.source', 'change', 1, 'option', 'regles_de_change', true),
  ('change.date_retenue', 'change', 2, 'option', 'regles_de_change', true),
  ('change.recul_jours', 'change', 3, 'nombre', 'regles_de_change', true),
  ('change.ecart', 'change', 4, 'option', 'regles_de_change', true),
  ('non_residents.retenue', 'non_residents', 1, 'option', 'reglages_comptables', false),
  ('prorata.methode', 'prorata', 1, 'option', 'reglages_comptables', false),
  ('avoirs.traitement', 'avoirs', 1, 'option', 'reglages_comptables', true),
  ('ventes.compte', 'ventes', 1, 'option', 'reglages_comptables', false),
  ('conservation.duree', 'conservation', 1, 'option', 'reglages_comptables', false),
  ('mois_tva.date', 'mois_tva', 1, 'option', 'reglages_comptables', false);

-- Les options des réglages de la porte générique. Celles de la règle de change
-- restent dans leurs tables (`ref.sources_de_cours`, `ref.change_dates_retenues`,
-- `ref.change_regles_d_ecart`).
insert into ref.reglages_comptables_options (reglage, code, ordre, applique) values
  ('immobilisation.traitement', 'actif_amorti', 1, true),
  ('immobilisation.traitement', 'charge', 2, true),
  ('comptes_immo.plan', 'nc01_2282_43662', 1, true),
  ('comptes_immo.plan', 'extension_info', 2, false),
  ('fodec.traitement', 'par_article_4374_cout', 1, true),
  ('fodec.traitement', 'par_facture', 2, false),
  ('fodec.traitement', 'achat_6652', 3, true),
  ('timbre.bareme', 'bareme_date', 1, false),
  ('timbre.bareme', 'fixe_1d', 2, true),
  ('non_residents.retenue', 'au_paiement', 1, false),
  ('non_residents.retenue', 'a_la_facture', 2, false),
  ('prorata.methode', 'affectation_puis_prorata', 1, false),
  ('prorata.methode', 'prorata_global', 2, false),
  ('avoirs.traitement', 'lie_facture', 1, false),
  ('avoirs.traitement', 'libre', 2, false),
  ('avoirs.traitement', 'refus_saisie_cabinet', 3, true),
  ('ventes.compte', 'par_nature_article', 1, false),
  ('ventes.compte', 'unique_cabinet', 2, false),
  ('conservation.duree', '10ans_cloture_teif', 1, false),
  ('conservation.duree', 'duree_cabinet', 2, false),
  ('mois_tva.date', 'exigibilite_calculee', 1, false),
  ('mois_tva.date', 'date_facture_alerte', 2, false);

insert into ref.reglages_comptables_sources (sujet, ordre, titre, url, datee_du, consultee_le) values
  ('immobilisation', 1, 'Décret 2008-492 (Jurisite)',
   'https://www.jurisitetunisie.com/tunisie/codes/cirppis/08-0492.htm', date '2008-02-25', date '2026-10-31'),
  ('immobilisation', 2, 'PwC Tunisia, Deductions',
   'https://taxsummaries.pwc.com/tunisia/corporate/deductions', date '2026-06-29', date '2026-10-31'),
  ('immobilisation', 3, 'NC 22/2008',
   'https://farouk-comptable.blogspot.com/2011/05/note-commune-n-222008.html', null, date '2026-10-31'),
  ('comptes_immo', 1, 'Plan NC 01 (OECT, transcrit dans le dépôt)', 'https://oect.org.tn/', null,
   date '2026-10-31'),
  ('fodec', 1, 'Profiscal, TCA ch. 11', 'https://www.profiscal.com/etudiants/TCA/tca_ch11_06.pdf',
   null, date '2026-10-31'),
  ('fodec', 2, 'Code TVA 2022 (chaexpert)',
   'https://chaexpert.com/documents/Code%20de%20la%20taxe%20sur%20la%20valeur%20ajout%C3%A9e%202022.pdf',
   null, date '2026-10-31'),
  ('timbre', 1, 'NC 02/2023', 'https://www.jurisitetunisie.com/download_nc.php?f=NC2023_02F.pdf',
   null, date '2026-10-31'),
  ('timbre', 2, 'PwC, Other taxes', 'https://taxsummaries.pwc.com/tunisia/corporate/other-taxes',
   date '2026-06-29', date '2026-10-31'),
  ('change', 1, 'NC 15 (OECT)', 'https://oect.org.tn/wp-content/uploads/2023/01/NC_15.pdf', null,
   date '2026-10-31'),
  ('non_residents', 1, 'Code TVA 2016 (chaexpert)',
   'https://chaexpert.com/documents/2016%20-%20CODE%20TVA%202016.pdf', null, date '2026-10-31'),
  ('non_residents', 2, 'BKA',
   'https://bkassocies.tn/en/value-added-tax-vat-and-entities-not-established-in-tunisia/',
   date '2024-09-12', date '2026-10-31'),
  ('prorata', 1, 'Code TVA 2022 (chaexpert)',
   'https://chaexpert.com/documents/Code%20de%20la%20taxe%20sur%20la%20valeur%20ajout%C3%A9e%202022.pdf',
   null, date '2026-10-31'),
  ('avoirs', 1, 'Profiscal, TCA ch. 4', 'https://www.profiscal.com/etudiants/TCA/tca_ch4_06.htm',
   null, date '2026-10-31'),
  ('ventes', 1, 'Plan NC 01 (OECT)', 'https://oect.org.tn/', null, date '2026-10-31'),
  ('conservation', 1, 'Code IRPP/IS art. 62 (Jurisite)',
   'https://www.jurisitetunisie.com/tunisie/codes/cirppis/cirppis1205.htm', null, date '2026-10-31'),
  ('conservation', 2, 'Business News',
   'https://businessnews.com.tn/2026/01/23/facturation-electronique-une-note-commune-du-ministere-des-finances-donne-des-precisions/1384817/',
   date '2026-01-23', date '2026-10-31'),
  ('mois_tva', 1, 'Code TVA 2022 (chaexpert)',
   'https://chaexpert.com/documents/Code%20de%20la%20taxe%20sur%20la%20valeur%20ajout%C3%A9e%202022.pdf',
   null, date '2026-10-31');

-- --- 4. Les défauts du pack : les choix du CEO, à confirmer ---------------------------------------

insert into ref.socle_params (pack_version_id, code, value_text, value_num, legal_reference, valid_from)
select p.id, v.code, v.texte, v.nombre,
       'Défaut décidé par le CEO le 31/10/2026, à confirmer par un expert-comptable. ' || v.reference,
       date '2026-01-01'
  from ref.jurisdiction_packs p
 cross join (values
   ('immobilisation.seuil', null, 200::numeric,
    'Décret 2008-492, art. 4 : biens de faible valeur jusqu''à 200 D. INCERTAIN : 200 ou 500 D, '
    'HT ou TTC.'),
   ('immobilisation.traitement', 'actif_amorti', null::numeric,
    'NC 22/2008 : inscrits à l''actif, amortis intégralement l''année d''utilisation '
    '(Code IRPP/IS art. 12 bis).'),
   ('comptes_immo.plan', 'nc01_2282_43662', null::numeric,
    'Plan NC 01 : compte selon la catégorie (ref.immo_categories), TVA en 43662.'),
   ('fodec.traitement', 'par_article_4374_cout', null::numeric,
    'Loi 99-101 (LF 2000), art. 36 et 37 ; Code TVA art. 6-I. Vente en 4374, achat incorporé au coût.'),
   ('timbre.bareme', 'bareme_date', null::numeric,
    'CDET art. 117 n° 6 (LF 2023 art. 69, NC 02/2023) ; LF 2026 art. 20.'),
   ('non_residents.retenue', 'au_paiement', null::numeric,
    'Code TVA art. 19 §1 et art. 5-6.'),
   ('prorata.methode', 'affectation_puis_prorata', null::numeric, 'Code TVA art. 9-II et 9-III.'),
   ('avoirs.traitement', 'lie_facture', null::numeric, 'Code TVA art. 9 (point 5).'),
   ('ventes.compte', 'par_nature_article', null::numeric,
    'Plan NC 01 : 701, 705, 706, 707.'),
   ('conservation.duree', '10ans_cloture_teif', null::numeric,
    'Code IRPP/IS art. 62 ; LF 2026 art. 53 ; NC 02/2026.'),
   ('mois_tva.date', 'exigibilite_calculee', null::numeric, 'Code TVA art. 5.')
 ) as v(code, texte, nombre, reference)
 where p.jurisdiction = 'TN' and p.version = '2026.1';

-- --- 5. Ce que le cabinet arrête -----------------------------------------------------------------

create table parametrage.reglages_comptables (
  id              uuid primary key default gen_random_uuid(),
  -- Le cabinet qui décide.
  tenant_id       uuid not null references identity.organizations (id),
  portee          text not null check (portee in ('cabinet', 'dossier')),
  portee_id       uuid not null references identity.organizations (id),
  pack_version_id uuid not null references ref.jurisdiction_packs (id),
  code            text not null references ref.reglages_comptables (code),
  -- Nulle : rendu au défaut du pack.
  valeur          text,
  valid_from      date not null,
  motif           text,
  decide_par      uuid not null default auth.uid(),
  decide_le       timestamptz not null default clock_timestamp(),
  check (portee <> 'cabinet' or portee_id = tenant_id)
);

comment on table parametrage.reglages_comptables is
  'R10 : les réglages comptables arrêtés par le cabinet pour lui-même ou pour un dossier. Ajout '
  'seulement : la plus récente l''emporte ; une valeur nulle rend au pack ; confirmer, c''est '
  'arrêter la valeur telle qu''elle est (31 octobre 2026).';

create index reglages_comptables_tenant_idx
  on parametrage.reglages_comptables (tenant_id, portee, portee_id);
create index reglages_comptables_resolution_idx
  on parametrage.reglages_comptables (portee, portee_id, pack_version_id, code,
                                      valid_from desc, decide_le desc);
create index reglages_comptables_pack_idx on parametrage.reglages_comptables (pack_version_id);
create index reglages_comptables_portee_id_idx on parametrage.reglages_comptables (portee_id);
create index reglages_comptables_code_idx on parametrage.reglages_comptables (code);

create trigger reglages_comptables_ajout_seulement
  before update or delete on parametrage.reglages_comptables
  for each row execute function app.deny_mutation();

alter table parametrage.reglages_comptables enable row level security;
alter table parametrage.reglages_comptables force row level security;
revoke all on table parametrage.reglages_comptables from public, anon;
grant select on table parametrage.reglages_comptables to authenticated;
create policy reglages_comptables_sel on parametrage.reglages_comptables
  for select to authenticated
  using (tenant_id in (select app.member_orgs())
         or (portee = 'dossier' and portee_id in (select app.member_orgs()))
         or (portee = 'dossier' and portee_id in (select app.engaged_orgs()))
         or (select app.is_platform()));
-- La porte s'exécute sous le portier, membre d'`authenticated` : la politique
-- d'insertion est la règle de droits elle-même, signée de l'appelant.
create policy reglages_comptables_ins on parametrage.reglages_comptables
  for insert to authenticated
  with check (decide_par = (select auth.uid())
              and app.peut_arreter_le_parametrage(tenant_id, portee, portee_id));
grant insert on parametrage.reglages_comptables to portier;

-- Une valeur d'un réglage de la porte générique : une option du référentiel,
-- ou un nombre décimal positif (au plus six décimales).
create or replace function app.valeur_de_reglage_valide(p_code text, p_valeur text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case r.nature
      when 'option' then exists (select 1 from ref.reglages_comptables_options o
                                  where o.reglage = r.code and o.code = p_valeur)
      when 'nombre' then coalesce(p_valeur ~ '^[0-9]{1,12}(\.[0-9]{1,6})?$', false)
      else false
    end
      from ref.reglages_comptables r
     where r.code = p_code and r.porte = 'reglages_comptables'), false)
$$;

revoke all on function app.valeur_de_reglage_valide(text, text) from public, anon;
-- La porte générique appartient au portier : elle valide une saisie par ces
-- deux fonctions, qui ne lisent que le référentiel.
grant execute on function app.valeur_de_reglage_valide(text, text) to portier;
grant execute on function app.valeur_de_change_valide(text, text) to portier;

-- --- 6. Le cabinet qui tient un dossier ; un cabinet se tient lui-même -----------------------------
--
-- Le résolveur de la règle de change ne connaissait que le dossier : appelé
-- pour un cabinet (l'écran des réglages, sans dossier), il ne trouvait aucun
-- engagement et ne rendait que le pack — la décision du cabinet ne se voyait
-- pas. Une règle, pour les deux résolveurs.
create or replace function app.cabinet_du_parametrage(p_org uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select x.id
    from (select g.cabinet_org_id as id, 1 as rang, g.starts_on
            from identity.engagements g
           where g.pme_org_id = p_org and g.status = 'actif'
          union all
          select o.id, 2, null::date
            from identity.organizations o
           where o.id = p_org and o.kind = 'cabinet') x
   order by x.rang, x.starts_on desc nulls last
   limit 1
$$;

revoke all on function app.cabinet_du_parametrage(uuid) from public, anon;

create or replace function app.regle_de_change(p_dossier uuid, p_pack uuid, p_jour date)
returns table (code text, valeur text, origine text, decide_le timestamptz, reference text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_dossier is null
     or not (p_dossier in (select app.member_orgs() union select app.engaged_orgs())
             or app.is_platform()) then
    raise exception 'refus.change.regle.droits' using errcode = '42501';
  end if;
  return query
    with pack as (
      select distinct on (s.code) s.code,
             coalesce(s.value_text, s.value_num::integer::text) as valeur, s.legal_reference
        from ref.socle_params s
       where s.pack_version_id = p_pack and s.code like 'change.%'
         and s.valid_from <= p_jour and (s.valid_to is null or s.valid_to >= p_jour)
       order by s.code, s.valid_from desc
    ),
    decisions as (
      select distinct on (r.portee, r.code) r.portee, r.code, r.valeur, r.decide_le
        from parametrage.regles_de_change r
       where r.pack_version_id = p_pack and r.valid_from <= p_jour
         -- Seules comptent les décisions du cabinet qui tient le dossier
         -- AUJOURD'HUI (ou du cabinet lui-même) : celles d'un ancien cabinet
         -- ne le suivent pas.
         and r.tenant_id = app.cabinet_du_parametrage(p_dossier)
         and ((r.portee = 'dossier' and r.portee_id = p_dossier)
              or (r.portee = 'cabinet' and r.portee_id = r.tenant_id))
       order by r.portee, r.code, r.valid_from desc, r.decide_le desc
    ),
    -- Une décision dont la valeur n'est plus au référentiel ne décide rien.
    valides as (
      select d.* from decisions d
       where d.valeur is not null and app.valeur_de_change_valide(d.code, d.valeur)
    )
    select p.code,
           coalesce(d.valeur, c.valeur, p.valeur),
           case when d.valeur is not null then 'dossier'
                when c.valeur is not null then 'cabinet'
                else 'pack' end,
           coalesce(d.decide_le, c.decide_le),
           p.legal_reference
      from pack p
      left join valides d on d.portee = 'dossier' and d.code = p.code
      left join valides c on c.portee = 'cabinet' and c.code = p.code
     order by p.code;
end
$$;

-- --- 7. Le résolveur ------------------------------------------------------------------------------
--
-- Une ligne par réglage du pack au jour dit : sa valeur, d'où elle vient
-- (dossier, cabinet, pack), quand elle a été décidée, et la référence du
-- défaut. Pour un DOSSIER : le dossier, puis le cabinet qui le tient, puis le
-- pack. Pour un CABINET : le cabinet, puis le pack. La règle de change se lit
-- par son propre résolveur, une seule fois.
create or replace function app.reglage_comptable(p_dossier uuid, p_pack uuid, p_jour date)
returns table (sujet text, code text, valeur text, origine text, decide_le timestamptz,
               reference text)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if p_dossier is null
     or not (p_dossier in (select app.member_orgs() union select app.engaged_orgs())
             or app.is_platform()) then
    raise exception 'refus.reglage_comptable.droits' using errcode = '42501';
  end if;
  return query
    with pack as (
      select distinct on (s.code) s.code,
             coalesce(s.value_text, trim_scale(s.value_num)::text) as valeur, s.legal_reference
        from ref.socle_params s
        join ref.reglages_comptables g on g.code = s.code and g.porte = 'reglages_comptables'
       where s.pack_version_id = p_pack
         and s.valid_from <= p_jour and (s.valid_to is null or s.valid_to >= p_jour)
       order by s.code, s.valid_from desc
    ),
    decisions as (
      select distinct on (r.portee, r.code) r.portee, r.code, r.valeur, r.decide_le
        from parametrage.reglages_comptables r
       where r.pack_version_id = p_pack and r.valid_from <= p_jour
         and r.tenant_id = app.cabinet_du_parametrage(p_dossier)
         and ((r.portee = 'dossier' and r.portee_id = p_dossier)
              or (r.portee = 'cabinet' and r.portee_id = r.tenant_id))
       order by r.portee, r.code, r.valid_from desc, r.decide_le desc
    ),
    -- Une décision dont la valeur n'est plus au référentiel ne décide rien ;
    -- une valeur nulle rend la main à l'étage d'en dessous.
    valides as (
      select d.* from decisions d
       where d.valeur is not null and app.valeur_de_reglage_valide(d.code, d.valeur)
    ),
    generiques as (
      select g.sujet, p.code,
             coalesce(d.valeur, c.valeur, p.valeur) as valeur,
             case when d.valeur is not null then 'dossier'
                  when c.valeur is not null then 'cabinet'
                  else 'pack' end as origine,
             coalesce(d.decide_le, c.decide_le) as decide_le,
             p.legal_reference as reference
        from pack p
        join ref.reglages_comptables g on g.code = p.code
        left join valides d on d.portee = 'dossier' and d.code = p.code
        left join valides c on c.portee = 'cabinet' and c.code = p.code
    ),
    change as (
      select g.sujet, x.code, x.valeur, x.origine, x.decide_le, x.reference
        from app.regle_de_change(p_dossier, p_pack, p_jour) x
        join ref.reglages_comptables g on g.code = x.code and g.porte = 'regles_de_change'
    )
    select u.sujet, u.code, u.valeur, u.origine, u.decide_le, u.reference
      from (select * from generiques union all select * from change) u
     order by u.sujet, u.code;
end
$$;

revoke all on function app.reglage_comptable(uuid, uuid, date) from public, anon;
grant execute on function app.reglage_comptable(uuid, uuid, date) to authenticated;

-- --- 8. La porte ----------------------------------------------------------------------------------
--
-- Arrêter (ou CONFIRMER) des réglages, pour tout le cabinet (son
-- expert-comptable) ou pour un dossier qu'il supervise : la règle de droits
-- de #149. Confirmer, c'est arrêter la valeur telle qu'elle est — une décision
-- même quand rien ne change (#145). Les codes de la règle de change passent
-- par leur porte (`app.regle_de_change_arreter`), inchangée.
create or replace function app.reglages_comptables_arreter(
  p_cabinet uuid, p_portee text, p_portee_id uuid, p_pack uuid, p_valid_from date,
  p_valeurs jsonb, p_motif text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
  v_change jsonb;
begin
  if p_portee is null or p_portee not in ('cabinet', 'dossier') then
    raise exception 'refus.reglage_comptable.saisie' using errcode = '22023';
  end if;
  if not app.peut_arreter_le_parametrage(p_cabinet, p_portee, p_portee_id) then
    raise exception 'refus.reglage_comptable.droits' using errcode = '42501';
  end if;
  if p_valeurs is null or jsonb_typeof(p_valeurs) <> 'array'
     or jsonb_array_length(p_valeurs) = 0
     or p_valid_from is null
     -- Le pack de la juridiction de la portée, jamais celui d'une autre.
     or not exists (select 1 from ref.jurisdiction_packs j
                      join identity.organizations o on o.id = p_portee_id
                     where j.id = p_pack and j.jurisdiction = o.jurisdiction)
     -- Un code connu, une fois ; une valeur que le référentiel connaît.
     or (select count(*) from jsonb_array_elements(p_valeurs))
        <> (select count(distinct e ->> 'code') from jsonb_array_elements(p_valeurs) e)
     or exists (
       select 1
         from jsonb_array_elements(p_valeurs) e
         left join ref.reglages_comptables r on r.code = e ->> 'code'
        where r.code is null
           or (e ->> 'valeur' is not null and r.porte = 'reglages_comptables'
               and not app.valeur_de_reglage_valide(r.code, e ->> 'valeur'))
           or (e ->> 'valeur' is not null and r.porte = 'regles_de_change'
               and not app.valeur_de_change_valide(r.code, e ->> 'valeur'))) then
    raise exception 'refus.reglage_comptable.saisie' using errcode = '22023';
  end if;

  insert into parametrage.reglages_comptables
    (tenant_id, portee, portee_id, pack_version_id, code, valeur, valid_from, motif)
  select p_cabinet, p_portee, p_portee_id, p_pack, r.code, e ->> 'valeur', p_valid_from,
         nullif(btrim(coalesce(p_motif, '')), '')
    from jsonb_array_elements(p_valeurs) e
    join ref.reglages_comptables r on r.code = e ->> 'code' and r.porte = 'reglages_comptables';
  get diagnostics v_n = row_count;

  if v_n > 0 then
    insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                                 object_id, pack_version_id, payload)
    values (p_cabinet, auth.uid(), 'reglage_comptable.arrete', 'parametrage',
            'reglages_comptables', p_portee_id, p_pack,
            jsonb_build_object('portee', p_portee, 'valid_from', p_valid_from,
                               'valeurs', p_valeurs, 'motif', p_motif));
  end if;

  select jsonb_agg(e) into v_change
    from jsonb_array_elements(p_valeurs) e
    join ref.reglages_comptables r on r.code = e ->> 'code' and r.porte = 'regles_de_change';
  if v_change is not null then
    v_n := v_n + app.regle_de_change_arreter(p_cabinet, p_portee, p_portee_id, p_pack,
                                             p_valid_from, v_change, p_motif);
  end if;
  return v_n;
end
$$;

alter function app.reglages_comptables_arreter(uuid, text, uuid, uuid, date, jsonb, text)
  owner to portier;
revoke all on function app.reglages_comptables_arreter(uuid, text, uuid, uuid, date, jsonb, text)
  from public, anon;
grant execute on function app.reglages_comptables_arreter(uuid, text, uuid, uuid, date, jsonb, text)
  to authenticated;

-- --- 9. Les mots ----------------------------------------------------------------------------------
--
-- Le nom des réglages de change quitte l'écran pour le référentiel : un seul
-- endroit pour tous les noms de réglages.

insert into ref.labels (ns, key, locale, value) values
  -- À qui s'applique une tranche d'un barème (`ref.baremes_des_droits.categorie`).
  ('bareme_categorie', 'grandes_surfaces', 'fr', 'Grandes surfaces'),
  ('bareme_categorie', 'grandes_surfaces', 'en', 'Large retailers'),
  ('bareme_categorie', 'grandes_surfaces', 'ar', 'المساحات الكبرى'),
  -- Les sujets.
  ('reglage_sujet', 'immobilisation', 'fr', 'Immobilisation ou charge'),
  ('reglage_sujet', 'immobilisation', 'en', 'Fixed asset or expense'),
  ('reglage_sujet', 'immobilisation', 'ar', 'أصل ثابت أم أعباء'),
  ('reglage_sujet', 'comptes_immo', 'fr', 'Comptes et TVA des immobilisations'),
  ('reglage_sujet', 'comptes_immo', 'en', 'Fixed-asset accounts and VAT'),
  ('reglage_sujet', 'comptes_immo', 'ar', 'حسابات الأصول الثابتة والأداء عليها'),
  ('reglage_sujet', 'fodec', 'fr', 'FODEC 1 %'),
  ('reglage_sujet', 'fodec', 'en', 'FODEC 1%'),
  ('reglage_sujet', 'fodec', 'ar', 'معلوم صندوق تنمية القدرة التنافسية 1 %'),
  ('reglage_sujet', 'timbre', 'fr', 'Droit de timbre sur facture'),
  ('reglage_sujet', 'timbre', 'en', 'Stamp duty on invoices'),
  ('reglage_sujet', 'timbre', 'ar', 'معلوم الطابع الجبائي على الفاتورة'),
  ('reglage_sujet', 'change', 'fr', 'Factures en devise'),
  ('reglage_sujet', 'change', 'en', 'Foreign-currency invoices'),
  ('reglage_sujet', 'change', 'ar', 'الفواتير بالعملة الأجنبية'),
  ('reglage_sujet', 'non_residents', 'fr', 'TVA sur services de non-résidents'),
  ('reglage_sujet', 'non_residents', 'en', 'VAT on services from non-residents'),
  ('reglage_sujet', 'non_residents', 'ar', 'الأداء على خدمات غير المقيمين'),
  ('reglage_sujet', 'prorata', 'fr', 'Prorata de déduction'),
  ('reglage_sujet', 'prorata', 'en', 'Deduction pro-rata'),
  ('reglage_sujet', 'prorata', 'ar', 'نسبة الطرح'),
  ('reglage_sujet', 'avoirs', 'fr', 'Avoirs'),
  ('reglage_sujet', 'avoirs', 'en', 'Credit notes'),
  ('reglage_sujet', 'avoirs', 'ar', 'الإشعارات الدائنة'),
  ('reglage_sujet', 'ventes', 'fr', 'Comptes de ventes'),
  ('reglage_sujet', 'ventes', 'en', 'Sales accounts'),
  ('reglage_sujet', 'ventes', 'ar', 'حسابات المبيعات'),
  ('reglage_sujet', 'conservation', 'fr', 'Conservation et facture électronique'),
  ('reglage_sujet', 'conservation', 'en', 'Retention and e-invoicing'),
  ('reglage_sujet', 'conservation', 'ar', 'الحفظ والفاتورة الإلكترونية'),
  ('reglage_sujet', 'mois_tva', 'fr', 'Mois de TVA d''une pièce'),
  ('reglage_sujet', 'mois_tva', 'en', 'VAT month of a document'),
  ('reglage_sujet', 'mois_tva', 'ar', 'شهر الأداء لوثيقة'),

  -- Ce que dit le texte.
  ('reglage_sujet_texte', 'immobilisation', 'fr',
   'Décret 2008-492 du 25/02/2008, art. 4 : biens de faible valeur jusqu''à 200 D, amortissement '
   'intégral l''année d''utilisation (Code IRPP/IS art. 12 bis). Note commune DGI 22/2008 : à '
   'condition de les inscrire à l''actif. Taux maximaux du décret : informatique 33,33 %, mobilier '
   'et bureau 20 %, transport 20 %, machines 15 %, constructions 5 %.'),
  ('reglage_sujet_texte', 'immobilisation', 'en',
   'Decree 2008-492 of 25/02/2008, art. 4: low-value assets up to TND 200, fully depreciated in '
   'the year of use (IRPP/IS Code art. 12 bis). DGI common note 22/2008: provided they are '
   'recorded as assets. Maximum rates in the decree: IT 33.33%, furniture and office 20%, '
   'transport 20%, machinery 15%, buildings 5%.'),
  ('reglage_sujet_texte', 'immobilisation', 'ar',
   'الأمر عدد 2008-492 المؤرخ في 25/02/2008، الفصل 4: الأصول ذات القيمة الضعيفة إلى حدود 200 د، '
   'تُستهلك كليا في سنة الاستعمال (مجلة الضريبة على الدخل والضريبة على الشركات، الفصل 12 مكرر). '
   'المذكرة العامة 22/2008: شريطة تسجيلها بالأصول. النسب القصوى للأمر: الإعلامية 33,33 %، الأثاث '
   'والمكتب 20 %، النقل 20 %، الآلات 15 %، البناءات 5 %.'),
  ('reglage_sujet_texte', 'comptes_immo', 'fr',
   'Plan NC 01 : 213 logiciels, 2234 matériel industriel, 2241/2244 transport, 2282 équipement de '
   'bureau. Pas de 2283/2284 dans NC 01. TVA : 43662 « TVA sur immobilisations » (43661 n''existe '
   'pas). Code TVA art. 9-IV : en cas de cession, reversement réduit d''un cinquième par année.'),
  ('reglage_sujet_texte', 'comptes_immo', 'en',
   'NC 01 chart: 213 software, 2234 industrial equipment, 2241/2244 transport, 2282 office '
   'equipment. No 2283/2284 in NC 01. VAT: 43662 "VAT on fixed assets" (43661 does not exist). '
   'VAT Code art. 9-IV: on disposal, the repayment is reduced by one fifth per year.'),
  ('reglage_sujet_texte', 'comptes_immo', 'ar',
   'مخطط المعيار المحاسبي 01: 213 البرمجيات، 2234 المعدات الصناعية، 2241/2244 النقل، 2282 '
   'معدات المكتب. لا وجود لـ 2283/2284 في المعيار 01. الأداء: 43662 «الأداء على الأصول الثابتة» '
   '(43661 غير موجود). مجلة الأداء الفصل 9-IV: عند التفويت، يُخفّض الإرجاع بخُمس عن كل سنة.'),
  ('reglage_sujet_texte', 'fodec', 'fr',
   'Loi 99-101 (LF 2000), art. 37 (assiette) et 36 (export exonéré) ; produits listés par le '
   'décret 2000-634. Taux 1 %, à la charge des fabricants et importateurs de certains secteurs. Il '
   'entre dans la base TVA (Code TVA art. 6-I, « tous frais, droits et taxes inclus »). Non '
   'déductible chez l''acheteur.'),
  ('reglage_sujet_texte', 'fodec', 'en',
   'Law 99-101 (2000 Finance Act), art. 37 (base) and 36 (exports exempt); products listed by '
   'decree 2000-634. Rate 1%, borne by manufacturers and importers in certain sectors. It is '
   'part of the VAT base (VAT Code art. 6-I, "all costs, duties and taxes included"). Not '
   'deductible by the buyer.'),
  ('reglage_sujet_texte', 'fodec', 'ar',
   'القانون عدد 99-101 (قانون المالية لسنة 2000)، الفصل 37 (الأساس) و36 (إعفاء التصدير)؛ المنتجات '
   'المضبوطة بالأمر عدد 2000-634. النسبة 1 %، محمولة على الصناعيين والموردين في بعض القطاعات. '
   'يدخل في أساس الأداء على القيمة المضافة (مجلة الأداء، الفصل 6-I). غير قابل للطرح لدى المشتري.'),
  ('reglage_sujet_texte', 'timbre', 'fr',
   'CDET art. 117 n° 6 : 1 dinar par facture depuis le 01/01/2023 (LF 2023 art. 69, NC 02/2023). '
   'LF 2026 (loi 2025-17) art. 20 : nouveau barème pour les grandes surfaces (« 1,500 » de 50 à '
   '100 D, « 2,000 » au-delà).'),
  ('reglage_sujet_texte', 'timbre', 'en',
   'Stamp Duty Code art. 117 no. 6: TND 1 per invoice since 01/01/2023 (2023 Finance Act art. 69, '
   'NC 02/2023). 2026 Finance Act (law 2025-17) art. 20: new scale for large retailers ("1.500" '
   'from 50 to 100 D, "2.000" above).'),
  ('reglage_sujet_texte', 'timbre', 'ar',
   'مجلة معاليم التسجيل والطابع الجبائي، الفصل 117 عدد 6: دينار واحد عن كل فاتورة منذ 01/01/2023 '
   '(قانون المالية لسنة 2023، الفصل 69، المذكرة 02/2023). قانون المالية لسنة 2026 (القانون '
   '2025-17)، الفصل 20: جدول جديد للمساحات الكبرى («1,500» من 50 إلى 100 د، «2,000» فما فوق).'),
  ('reglage_sujet_texte', 'change', 'fr',
   'NC 15 §06 : taux en vigueur à la date de l''opération ; §07 : taux moyen hebdomadaire ou '
   'mensuel admis sauf forte variation ; §10/§15 : écart au règlement en résultat ; §11 : cours de '
   'clôture. Comptes NC 01 : 655 pertes de change, 756 gains de change.'),
  ('reglage_sujet_texte', 'change', 'en',
   'NC 15 §06: rate in force on the transaction date; §07: weekly or monthly average rate allowed '
   'unless rates move sharply; §10/§15: settlement difference to profit or loss; §11: closing '
   'rate. NC 01 accounts: 655 exchange losses, 756 exchange gains.'),
  ('reglage_sujet_texte', 'change', 'ar',
   'المعيار 15 §06: السعر الساري بتاريخ العملية؛ §07: يُقبل المعدل الأسبوعي أو الشهري ما لم يكن '
   'التغير كبيرا؛ §10/§15: فارق الخلاص في النتيجة؛ §11: سعر الإقفال. حسابات المعيار 01: 655 خسائر '
   'الصرف، 756 أرباح الصرف.'),
  ('reglage_sujet_texte', 'non_residents', 'fr',
   'Code TVA art. 19 §1 : le client tunisien retient la TVA due (retenue libératoire, 100 % de la '
   'TVA). Art. 5-6 : fait générateur à l''encaissement (paiement). Art. 19 bis (25 %) ne vise que '
   'l''État et les entreprises publiques.'),
  ('reglage_sujet_texte', 'non_residents', 'en',
   'VAT Code art. 19 §1: the Tunisian customer withholds the VAT due (final withholding, 100% of '
   'the VAT). Art. 5-6: taxable event on collection (payment). Art. 19 bis (25%) only covers the '
   'State and public companies.'),
  ('reglage_sujet_texte', 'non_residents', 'ar',
   'مجلة الأداء، الفصل 19 §1: يخصم الحريف التونسي الأداء المستوجب (خصم تحريري، 100 % من الأداء). '
   'الفصل 5-6: الواقعة المنشئة عند القبض (الخلاص). الفصل 19 مكرر (25 %) لا يهم إلا الدولة '
   'والمنشآت العمومية.'),
  ('reglage_sujet_texte', 'prorata', 'fr',
   'Code TVA art. 9-II : prorata = (recettes taxables + export) / (total des recettes), sur '
   'l''exercice précédent. Art. 9-III : prorata définitif en fin d''année ; régularisation des '
   'biens amortissables si l''écart dépasse 5 points, en janvier.'),
  ('reglage_sujet_texte', 'prorata', 'en',
   'VAT Code art. 9-II: pro-rata = (taxable receipts + exports) / (total receipts), over the '
   'previous financial year. Art. 9-III: final pro-rata at year end; adjustment of depreciable '
   'assets in January if the difference exceeds 5 points.'),
  ('reglage_sujet_texte', 'prorata', 'ar',
   'مجلة الأداء، الفصل 9-II: النسبة = (المداخيل الخاضعة + التصدير) / (مجموع المداخيل)، على السنة '
   'المحاسبية السابقة. الفصل 9-III: نسبة نهائية في آخر السنة؛ تسوية الأصول القابلة للاستهلاك إذا '
   'تجاوز الفارق 5 نقاط، في جانفي.'),
  ('reglage_sujet_texte', 'avoirs', 'fr',
   'Code TVA art. 9 (point 5) : la TVA d''une affaire annulée ou résiliée s''impute sur la TVA due '
   'ensuite, jusqu''à la fin de la 4e année, avec un état justificatif. Une remise exige une '
   'facture d''avoir montrant le HT.'),
  ('reglage_sujet_texte', 'avoirs', 'en',
   'VAT Code art. 9 (point 5): the VAT on a cancelled or terminated transaction is offset against '
   'VAT due later, until the end of the 4th year, with a supporting statement. A discount requires '
   'a credit note showing the amount excluding VAT.'),
  ('reglage_sujet_texte', 'avoirs', 'ar',
   'مجلة الأداء، الفصل 9 (النقطة 5): يُطرح الأداء الموظف على عملية ملغاة أو مفسوخة من الأداء '
   'المستوجب لاحقا، إلى نهاية السنة الرابعة، مع قائمة مبررة. يستوجب التخفيض فاتورة دائنة تبيّن '
   'المبلغ دون اعتبار الأداء.'),
  ('reglage_sujet_texte', 'ventes', 'fr',
   'NC 01 : 701 produits finis, 704 travaux, 705 études et prestations de services, 706 produits '
   'des activités annexes, 707 marchandises, 709 RRR accordés.'),
  ('reglage_sujet_texte', 'ventes', 'en',
   'NC 01: 701 finished products, 704 works, 705 studies and services, 706 ancillary income, 707 '
   'goods, 709 discounts granted.'),
  ('reglage_sujet_texte', 'ventes', 'ar',
   'المعيار 01: 701 المنتجات التامة، 704 الأشغال، 705 الدراسات وإسداء الخدمات، 706 منتجات الأنشطة '
   'الملحقة، 707 البضائع، 709 التخفيضات الممنوحة.'),
  ('reglage_sujet_texte', 'conservation', 'fr',
   'Code IRPP/IS art. 62 : livres et documents conservés dix ans. LF 2026 art. 53 : facturation '
   'électronique étendue aux prestations de services ; NC 02/2026 du 23/01/2026 : El Fatoora (TTN, '
   'format TEIF).'),
  ('reglage_sujet_texte', 'conservation', 'en',
   'IRPP/IS Code art. 62: books and documents kept for ten years. 2026 Finance Act art. 53: '
   'e-invoicing extended to services; NC 02/2026 of 23/01/2026: El Fatoora (TTN, TEIF format).'),
  ('reglage_sujet_texte', 'conservation', 'ar',
   'مجلة الضريبة على الدخل والضريبة على الشركات، الفصل 62: تُحفظ الدفاتر والوثائق عشر سنوات. قانون '
   'المالية لسنة 2026، الفصل 53: تعميم الفوترة الإلكترونية على الخدمات؛ المذكرة 02/2026 المؤرخة في '
   '23/01/2026: الفاتورة الإلكترونية (TTN، صيغة TEIF).'),
  ('reglage_sujet_texte', 'mois_tva', 'fr',
   'Code TVA art. 5 : biens à la livraison ; services à la réalisation, ou à l''encaissement s''il '
   'est antérieur ; opérations sous retenue (art. 19 et 19 bis) à l''encaissement. La date de '
   'facture n''est pas le critère légal.'),
  ('reglage_sujet_texte', 'mois_tva', 'en',
   'VAT Code art. 5: goods on delivery; services on performance, or on collection if earlier; '
   'transactions subject to withholding (art. 19 and 19 bis) on collection. The invoice date is '
   'not the legal criterion.'),
  ('reglage_sujet_texte', 'mois_tva', 'ar',
   'مجلة الأداء، الفصل 5: البضائع عند التسليم؛ الخدمات عند الإنجاز، أو عند القبض إن كان سابقا؛ '
   'العمليات الخاضعة للخصم (الفصلان 19 و19 مكرر) عند القبض. تاريخ الفاتورة ليس المعيار القانوني.'),

  -- La pratique des cabinets.
  ('reglage_sujet_pratique', 'immobilisation', 'fr',
   'Au-dessus du seuil : classe 2 et taux maximaux du décret. Sous le seuil : beaucoup de cabinets '
   'passent en charge directement (606), d''autres inscrivent en 2282 et amortissent à 100 %.'),
  ('reglage_sujet_pratique', 'immobilisation', 'en',
   'Above the threshold: class 2 and the decree''s maximum rates. Below it: many firms expense it '
   'directly (606), others record it in 2282 and depreciate it 100%.'),
  ('reglage_sujet_pratique', 'immobilisation', 'ar',
   'فوق العتبة: الصنف 2 والنسب القصوى للأمر. تحت العتبة: كثير من المكاتب تسجلها مباشرة في الأعباء '
   '(606)، وأخرى تسجلها في 2282 وتستهلكها بنسبة 100 %.'),
  ('reglage_sujet_pratique', 'comptes_immo', 'fr',
   'Informatique souvent en 2282 ou dans un sous-compte du cabinet ; TVA en 43662.'),
  ('reglage_sujet_pratique', 'comptes_immo', 'en',
   'IT often in 2282 or in a firm sub-account; VAT in 43662.'),
  ('reglage_sujet_pratique', 'comptes_immo', 'ar',
   'الإعلامية غالبا في 2282 أو في حساب فرعي للمكتب؛ الأداء في 43662.'),
  ('reglage_sujet_pratique', 'fodec', 'fr',
   'Vente : ligne distincte, crédit 437 (4374 dans Malica, extension non officielle). Achat : '
   'incorporé au coût d''achat ou de l''immobilisation.'),
  ('reglage_sujet_pratique', 'fodec', 'en',
   'Sale: separate line, credit 437 (4374 in Malica, unofficial extension). Purchase: included in '
   'the purchase or fixed-asset cost.'),
  ('reglage_sujet_pratique', 'fodec', 'ar',
   'البيع: سطر مستقل، دائن 437 (4374 في مليكة، تفريع غير رسمي). الشراء: يُدمج في كلفة الشراء أو '
   'الأصل الثابت.'),
  ('reglage_sujet_pratique', 'timbre', 'fr',
   'Pied de facture, hors base TVA. Vente : 437 (4371 dans Malica). Achat : 6654 « droits '
   'd''enregistrement et de timbre » (et non 635).'),
  ('reglage_sujet_pratique', 'timbre', 'en',
   'Invoice footer, outside the VAT base. Sale: 437 (4371 in Malica). Purchase: 6654 '
   '"registration and stamp duties" (not 635).'),
  ('reglage_sujet_pratique', 'timbre', 'ar',
   'أسفل الفاتورة، خارج أساس الأداء. البيع: 437 (4371 في مليكة). الشراء: 6654 «معاليم التسجيل '
   'والطابع» (وليس 635).'),
  ('reglage_sujet_pratique', 'change', 'fr',
   'Cours BCT du jour de la facture ; écart en 655/756 au règlement ; réévaluation à la clôture.'),
  ('reglage_sujet_pratique', 'change', 'en',
   'BCT rate on the invoice date; difference to 655/756 at settlement; revaluation at closing.'),
  ('reglage_sujet_pratique', 'change', 'ar',
   'سعر البنك المركزي يوم الفاتورة؛ الفارق في 655/756 عند الخلاص؛ إعادة التقييم عند الإقفال.'),
  ('reglage_sujet_pratique', 'non_residents', 'fr',
   'Au paiement : débit 6xx et 43666, crédit 401 (HT) et 432 (TVA retenue) ; reversée puis déduite.'),
  ('reglage_sujet_pratique', 'non_residents', 'en',
   'On payment: debit 6xx and 43666, credit 401 (excl. VAT) and 432 (VAT withheld); paid over, '
   'then deducted.'),
  ('reglage_sujet_pratique', 'non_residents', 'ar',
   'عند الخلاص: مدين 6xx و43666، دائن 401 (دون أداء) و432 (الأداء المخصوم)؛ يُدفع ثم يُطرح.'),
  ('reglage_sujet_pratique', 'prorata', 'fr',
   'Affectation réelle d''abord (taxable / exonéré), prorata seulement sur les dépenses communes.'),
  ('reglage_sujet_pratique', 'prorata', 'en',
   'Actual allocation first (taxable / exempt), pro-rata only on shared expenses.'),
  ('reglage_sujet_pratique', 'prorata', 'ar',
   'التخصيص الفعلي أولا (خاضع / معفى)، والنسبة على المصاريف المشتركة فقط.'),
  ('reglage_sujet_pratique', 'avoirs', 'fr',
   'Annulation : extourne de l''écriture. Réduction : 709 (ventes), 609/619/629 (achats).'),
  ('reglage_sujet_pratique', 'avoirs', 'en',
   'Cancellation: reversal of the entry. Reduction: 709 (sales), 609/619/629 (purchases).'),
  ('reglage_sujet_pratique', 'avoirs', 'ar',
   'الإلغاء: عكس القيد. التخفيض: 709 (المبيعات)، 609/619/629 (المشتريات).'),
  ('reglage_sujet_pratique', 'ventes', 'fr',
   'Négoce 707, fabrication 701, services 705, refacturations et locations accessoires 706.'),
  ('reglage_sujet_pratique', 'ventes', 'en',
   'Trading 707, manufacturing 701, services 705, re-invoicing and ancillary rentals 706.'),
  ('reglage_sujet_pratique', 'ventes', 'ar',
   'التجارة 707، التصنيع 701، الخدمات 705، إعادة الفوترة والكراءات الملحقة 706.'),
  ('reglage_sujet_pratique', 'conservation', 'fr',
   'Archivage 10 ans après la clôture ; le XML signé TEIF est l''original.'),
  ('reglage_sujet_pratique', 'conservation', 'en',
   'Archived for 10 years after closing; the signed TEIF XML is the original.'),
  ('reglage_sujet_pratique', 'conservation', 'ar',
   'الأرشفة 10 سنوات بعد الإقفال؛ ملف XML الممضى بصيغة TEIF هو الأصل.'),
  ('reglage_sujet_pratique', 'mois_tva', 'fr',
   'Mois de la facture, en supposant qu''elle est émise à la livraison ou à la fin du service.'),
  ('reglage_sujet_pratique', 'mois_tva', 'en',
   'Month of the invoice, assuming it is issued on delivery or at the end of the service.'),
  ('reglage_sujet_pratique', 'mois_tva', 'ar',
   'شهر الفاتورة، بافتراض أنها تصدر عند التسليم أو عند نهاية الخدمة.'),

  -- Le risque en cas de contrôle.
  ('reglage_sujet_risque', 'immobilisation', 'fr',
   'Réintégration d''un achat de plus de 200 D passé en charge ; dotation au-delà du taux maximal '
   'réintégrée ; passage direct en charge contestable sans inscription à l''actif (NC 22/2008).'),
  ('reglage_sujet_risque', 'immobilisation', 'en',
   'A purchase over TND 200 expensed is added back; depreciation above the maximum rate is added '
   'back; direct expensing is open to challenge without recording as an asset (NC 22/2008).'),
  ('reglage_sujet_risque', 'immobilisation', 'ar',
   'إعادة إدماج شراء يفوق 200 د سُجل في الأعباء؛ إعادة إدماج الاستهلاك الذي يتجاوز النسبة القصوى؛ '
   'التسجيل المباشر في الأعباء قابل للاعتراض دون تسجيل بالأصول (المذكرة 22/2008).'),
  ('reglage_sujet_risque', 'comptes_immo', 'fr',
   'Faible si la TVA est bien isolée ; régularisation oubliée lors d''une cession avant 5 ans.'),
  ('reglage_sujet_risque', 'comptes_immo', 'en',
   'Low if the VAT is properly isolated; adjustment forgotten on a disposal within 5 years.'),
  ('reglage_sujet_risque', 'comptes_immo', 'ar',
   'ضعيف إذا عُزل الأداء جيدا؛ نسيان التسوية عند تفويت قبل 5 سنوات.'),
  ('reglage_sujet_risque', 'fodec', 'fr',
   'Base TVA calculée sans le FODEC ; FODEC oublié sur un produit listé ; FODEC d''achat porté en '
   'déduction.'),
  ('reglage_sujet_risque', 'fodec', 'en',
   'VAT base computed without FODEC; FODEC omitted on a listed product; purchase FODEC deducted.'),
  ('reglage_sujet_risque', 'fodec', 'ar',
   'أساس أداء محتسب دون المعلوم؛ نسيان المعلوم على منتج مدرج؛ طرح معلوم الشراء.'),
  ('reglage_sujet_risque', 'timbre', 'fr',
   'Timbre non perçu ou non reversé ; exonération appliquée sans fondement.'),
  ('reglage_sujet_risque', 'timbre', 'en',
   'Stamp duty not collected or not paid over; exemption applied without basis.'),
  ('reglage_sujet_risque', 'timbre', 'ar',
   'معلوم طابع غير مستخلص أو غير مدفوع؛ إعفاء مطبق دون سند.'),
  ('reglage_sujet_risque', 'change', 'fr', 'Cours non justifiable.'),
  ('reglage_sujet_risque', 'change', 'en', 'Rate that cannot be justified.'),
  ('reglage_sujet_risque', 'change', 'ar', 'سعر لا يمكن تبريره.'),
  ('reglage_sujet_risque', 'non_residents', 'fr',
   'Retenue oubliée : le client devient redevable ; TVA déduite sans être reversée.'),
  ('reglage_sujet_risque', 'non_residents', 'en',
   'Withholding forgotten: the customer becomes liable; VAT deducted without being paid over.'),
  ('reglage_sujet_risque', 'non_residents', 'ar',
   'نسيان الخصم: يصبح الحريف مدينا؛ أداء مطروح دون أن يُدفع.'),
  ('reglage_sujet_risque', 'prorata', 'fr',
   'Prorata non recalculé ; régularisation de janvier oubliée.'),
  ('reglage_sujet_risque', 'prorata', 'en',
   'Pro-rata not recomputed; January adjustment forgotten.'),
  ('reglage_sujet_risque', 'prorata', 'ar', 'نسبة غير محيّنة؛ نسيان تسوية جانفي.'),
  ('reglage_sujet_risque', 'avoirs', 'fr',
   'Avoir sans référence à la facture d''origine ; TVA réduite sans pièce chez le client.'),
  ('reglage_sujet_risque', 'avoirs', 'en',
   'Credit note without reference to the original invoice; VAT reduced without a document at the '
   'customer''s.'),
  ('reglage_sujet_risque', 'avoirs', 'ar',
   'إشعار دائن دون إحالة على الفاتورة الأصلية؛ تخفيض الأداء دون وثيقة لدى الحريف.'),
  ('reglage_sujet_risque', 'ventes', 'fr',
   'Faible fiscalement ; le type de vente influe sur le fait générateur de la TVA et sur le FODEC.'),
  ('reglage_sujet_risque', 'ventes', 'en',
   'Low for tax purposes; the type of sale affects the VAT taxable event and FODEC.'),
  ('reglage_sujet_risque', 'ventes', 'ar',
   'ضعيف جبائيا؛ نوع البيع يؤثر في الواقعة المنشئة للأداء وفي المعلوم.'),
  ('reglage_sujet_risque', 'conservation', 'fr',
   'Comptabilité rejetée si elle n''est pas présentée ; pièce illisible.'),
  ('reglage_sujet_risque', 'conservation', 'en',
   'Accounts rejected if not produced; unreadable document.'),
  ('reglage_sujet_risque', 'conservation', 'ar', 'رفض المحاسبة إذا لم تُقدَّم؛ وثيقة غير مقروءة.'),
  ('reglage_sujet_risque', 'mois_tva', 'fr',
   'Acompte encaissé sans TVA ; facture tardive rattachée au mauvais mois.'),
  ('reglage_sujet_risque', 'mois_tva', 'en',
   'Advance collected without VAT; late invoice attached to the wrong month.'),
  ('reglage_sujet_risque', 'mois_tva', 'ar', 'تسبقة مقبوضة دون أداء؛ فاتورة متأخرة في شهر خاطئ.'),

  -- Ce qui reste INCERTAIN.
  ('reglage_sujet_incertain', 'immobilisation', 'fr',
   'PwC (revue du 29/06/2026) écrit 500 D. Aucun décret modificatif trouvé : le seuil en vigueur '
   '(200 ou 500 D) et son appréciation HT ou TTC sont INCERTAINS.'),
  ('reglage_sujet_incertain', 'immobilisation', 'en',
   'PwC (review of 29/06/2026) states TND 500. No amending decree found: the threshold in force '
   '(200 or 500 D) and whether it is measured excluding or including VAT are UNCERTAIN.'),
  ('reglage_sujet_incertain', 'immobilisation', 'ar',
   'تذكر PwC (مراجعة 29/06/2026) 500 د. لم يُعثر على أمر معدِّل: العتبة السارية (200 أو 500 د) '
   'واحتسابها دون أداء أو بكامل الأداء غير مؤكدة.'),
  ('reglage_sujet_incertain', 'comptes_immo', 'fr',
   'Pas de sous-compte officiel pour le matériel informatique. Ligne distincte du formulaire de '
   'déclaration TVA : INCERTAIN (formulaire non consulté).'),
  ('reglage_sujet_incertain', 'comptes_immo', 'en',
   'No official sub-account for IT equipment. Separate line on the VAT return form: UNCERTAIN '
   '(form not consulted).'),
  ('reglage_sujet_incertain', 'comptes_immo', 'ar',
   'لا يوجد حساب فرعي رسمي للمعدات الإعلامية. سطر مستقل في نموذج التصريح بالأداء: غير مؤكد '
   '(لم يُطّلع على النموذج).'),
  ('reglage_sujet_incertain', 'fodec', 'fr',
   'Le texte en vigueur aujourd''hui (et la question « le FODEC entre-t-il dans sa propre '
   'assiette ») reste à confirmer par la DGI.'),
  ('reglage_sujet_incertain', 'fodec', 'en',
   'The text in force today (and whether FODEC is part of its own base) remains to be confirmed '
   'by the DGI.'),
  ('reglage_sujet_incertain', 'fodec', 'ar',
   'النص الساري اليوم (ومسألة دخول المعلوم في أساسه) يبقى للتأكيد من الإدارة العامة للأداءات.'),
  ('reglage_sujet_incertain', 'timbre', 'fr',
   'Unité exacte du barème grandes surfaces à confirmer au JORT. Exonérations (export, État) '
   'citées sans article : INCERTAIN.'),
  ('reglage_sujet_incertain', 'timbre', 'en',
   'Exact unit of the large-retailer scale to be confirmed in the Official Journal. Exemptions '
   '(exports, State) cited without an article: UNCERTAIN.'),
  ('reglage_sujet_incertain', 'timbre', 'ar',
   'الوحدة الدقيقة لجدول المساحات الكبرى للتأكيد في الرائد الرسمي. الإعفاءات (التصدير، الدولة) '
   'مذكورة دون فصل: غير مؤكد.'),
  ('reglage_sujet_incertain', 'change', 'fr',
   'La NC 15 ne nomme pas de source de cours (BCT par usage). Traitement fiscal des écarts latents : '
   'INCERTAIN.'),
  ('reglage_sujet_incertain', 'change', 'en',
   'NC 15 does not name a rate source (BCT by custom). Tax treatment of unrealised differences: '
   'UNCERTAIN.'),
  ('reglage_sujet_incertain', 'change', 'ar',
   'لا يحدد المعيار 15 مصدر السعر (البنك المركزي بحكم العرف). المعالجة الجبائية للفوارق الكامنة: '
   'غير مؤكدة.'),
  ('reglage_sujet_incertain', 'non_residents', 'fr',
   'Ligne du formulaire et mois de déduction de la TVA retenue : INCERTAIN.'),
  ('reglage_sujet_incertain', 'non_residents', 'en',
   'Form line and month of deduction of the VAT withheld: UNCERTAIN.'),
  ('reglage_sujet_incertain', 'non_residents', 'ar',
   'سطر النموذج وشهر طرح الأداء المخصوم: غير مؤكد.'),
  ('reglage_sujet_incertain', 'prorata', 'fr', 'Règle d''arrondi du prorata : INCERTAIN.'),
  ('reglage_sujet_incertain', 'prorata', 'en', 'Pro-rata rounding rule: UNCERTAIN.'),
  ('reglage_sujet_incertain', 'prorata', 'ar', 'قاعدة تدوير النسبة: غير مؤكدة.'),
  ('reglage_sujet_incertain', 'avoirs', 'fr',
   'Numérotation exacte de l''article dans le code en vigueur : INCERTAIN.'),
  ('reglage_sujet_incertain', 'avoirs', 'en',
   'Exact numbering of the article in the code in force: UNCERTAIN.'),
  ('reglage_sujet_incertain', 'avoirs', 'ar', 'الترقيم الدقيق للفصل في المجلة السارية: غير مؤكد.'),
  ('reglage_sujet_incertain', 'conservation', 'fr',
   'Point de départ des 10 ans (clôture de l''exercice par usage) et base de l''amende e-facture : '
   'INCERTAIN.'),
  ('reglage_sujet_incertain', 'conservation', 'en',
   'Start of the 10 years (year-end closing by custom) and basis of the e-invoice penalty: '
   'UNCERTAIN.'),
  ('reglage_sujet_incertain', 'conservation', 'ar',
   'نقطة انطلاق السنوات العشر (إقفال السنة المحاسبية بحكم العرف) وأساس خطية الفاتورة الإلكترونية: '
   'غير مؤكد.'),

  -- Le nom de chaque réglage.
  ('reglage_comptable', 'immobilisation.seuil', 'fr', 'Seuil d''immobilisation (HT)'),
  ('reglage_comptable', 'immobilisation.seuil', 'en', 'Capitalisation threshold (excl. VAT)'),
  ('reglage_comptable', 'immobilisation.seuil', 'ar', 'عتبة التثبيت (دون أداء)'),
  ('reglage_comptable', 'immobilisation.traitement', 'fr', 'Bien sous le seuil'),
  ('reglage_comptable', 'immobilisation.traitement', 'en', 'Asset below the threshold'),
  ('reglage_comptable', 'immobilisation.traitement', 'ar', 'أصل تحت العتبة'),
  ('reglage_comptable', 'comptes_immo.plan', 'fr', 'Comptes des immobilisations'),
  ('reglage_comptable', 'comptes_immo.plan', 'en', 'Fixed-asset accounts'),
  ('reglage_comptable', 'comptes_immo.plan', 'ar', 'حسابات الأصول الثابتة'),
  ('reglage_comptable', 'fodec.traitement', 'fr', 'Traitement du FODEC'),
  ('reglage_comptable', 'fodec.traitement', 'en', 'FODEC treatment'),
  ('reglage_comptable', 'fodec.traitement', 'ar', 'معالجة المعلوم'),
  ('reglage_comptable', 'timbre.bareme', 'fr', 'Barème du timbre'),
  ('reglage_comptable', 'timbre.bareme', 'en', 'Stamp duty scale'),
  ('reglage_comptable', 'timbre.bareme', 'ar', 'جدول معلوم الطابع'),
  ('reglage_comptable', 'change.source', 'fr', 'Source du cours'),
  ('reglage_comptable', 'change.source', 'en', 'Rate source'),
  ('reglage_comptable', 'change.source', 'ar', 'مصدر السعر'),
  ('reglage_comptable', 'change.date_retenue', 'fr', 'Jour du cours'),
  ('reglage_comptable', 'change.date_retenue', 'en', 'Rate day'),
  ('reglage_comptable', 'change.date_retenue', 'ar', 'يوم السعر'),
  ('reglage_comptable', 'change.recul_jours', 'fr', 'Recul jusqu’au dernier cours publié (jours)'),
  ('reglage_comptable', 'change.recul_jours', 'en', 'Look-back to the last published rate (days)'),
  ('reglage_comptable', 'change.recul_jours', 'ar', 'الرجوع إلى آخر سعر منشور (أيام)'),
  ('reglage_comptable', 'change.ecart', 'fr', 'Écart d’arrondi de la conversion'),
  ('reglage_comptable', 'change.ecart', 'en', 'Conversion rounding difference'),
  ('reglage_comptable', 'change.ecart', 'ar', 'فارق تقريب التحويل'),
  ('reglage_comptable', 'non_residents.retenue', 'fr', 'Retenue de TVA'),
  ('reglage_comptable', 'non_residents.retenue', 'en', 'VAT withholding'),
  ('reglage_comptable', 'non_residents.retenue', 'ar', 'خصم الأداء'),
  ('reglage_comptable', 'prorata.methode', 'fr', 'Méthode de déduction'),
  ('reglage_comptable', 'prorata.methode', 'en', 'Deduction method'),
  ('reglage_comptable', 'prorata.methode', 'ar', 'طريقة الطرح'),
  ('reglage_comptable', 'avoirs.traitement', 'fr', 'Traitement d''un avoir'),
  ('reglage_comptable', 'avoirs.traitement', 'en', 'Credit note treatment'),
  ('reglage_comptable', 'avoirs.traitement', 'ar', 'معالجة الإشعار الدائن'),
  ('reglage_comptable', 'ventes.compte', 'fr', 'Compte de vente par défaut'),
  ('reglage_comptable', 'ventes.compte', 'en', 'Default sales account'),
  ('reglage_comptable', 'ventes.compte', 'ar', 'حساب المبيعات الافتراضي'),
  ('reglage_comptable', 'conservation.duree', 'fr', 'Durée et forme de conservation'),
  ('reglage_comptable', 'conservation.duree', 'en', 'Retention period and form'),
  ('reglage_comptable', 'conservation.duree', 'ar', 'مدة الحفظ وشكله'),
  ('reglage_comptable', 'mois_tva.date', 'fr', 'Date qui fixe le mois de TVA'),
  ('reglage_comptable', 'mois_tva.date', 'en', 'Date that sets the VAT month'),
  ('reglage_comptable', 'mois_tva.date', 'ar', 'التاريخ الذي يحدد شهر الأداء'),

  -- Les options (clé : réglage:option).
  ('reglage_comptable_option', 'immobilisation.traitement:actif_amorti', 'fr',
   'Inscrit à l''actif puis amorti à 100 % l''année d''utilisation'),
  ('reglage_comptable_option', 'immobilisation.traitement:actif_amorti', 'en',
   'Recorded as an asset, then depreciated 100% in the year of use'),
  ('reglage_comptable_option', 'immobilisation.traitement:actif_amorti', 'ar',
   'يُسجل بالأصول ثم يُستهلك بنسبة 100 % في سنة الاستعمال'),
  ('reglage_comptable_option', 'immobilisation.traitement:charge', 'fr',
   'Passé directement en charge, au compte du paramétrage'),
  ('reglage_comptable_option', 'immobilisation.traitement:charge', 'en',
   'Expensed directly, to the configured account'),
  ('reglage_comptable_option', 'immobilisation.traitement:charge', 'ar',
   'يُسجل مباشرة في الأعباء، في الحساب المضبوط'),
  ('reglage_comptable_option', 'comptes_immo.plan:nc01_2282_43662', 'fr',
   'Compte selon la catégorie (table en base), informatique en 2282, TVA en 43662'),
  ('reglage_comptable_option', 'comptes_immo.plan:nc01_2282_43662', 'en',
   'Account by category (table in the database), IT in 2282, VAT in 43662'),
  ('reglage_comptable_option', 'comptes_immo.plan:nc01_2282_43662', 'ar',
   'الحساب حسب الصنف (جدول في القاعدة)، الإعلامية في 2282، الأداء في 43662'),
  ('reglage_comptable_option', 'comptes_immo.plan:extension_info', 'fr',
   'Créer une extension « matériel informatique » (ex. 22821)'),
  ('reglage_comptable_option', 'comptes_immo.plan:extension_info', 'en',
   'Create an "IT equipment" extension (e.g. 22821)'),
  ('reglage_comptable_option', 'comptes_immo.plan:extension_info', 'ar',
   'إحداث تفريع «معدات إعلامية» (مثلا 22821)'),
  ('reglage_comptable_option', 'fodec.traitement:par_article_4374_cout', 'fr',
   'FODEC par famille de produits, dans la base TVA ; vente en 4374, achat incorporé au coût'),
  ('reglage_comptable_option', 'fodec.traitement:par_article_4374_cout', 'en',
   'FODEC by product family, in the VAT base; sale to 4374, purchase included in cost'),
  ('reglage_comptable_option', 'fodec.traitement:par_article_4374_cout', 'ar',
   'المعلوم حسب عائلة المنتجات، في أساس الأداء؛ البيع في 4374، والشراء مدمج في الكلفة'),
  ('reglage_comptable_option', 'fodec.traitement:par_facture', 'fr',
   'FODEC au niveau de la facture entière'),
  ('reglage_comptable_option', 'fodec.traitement:par_facture', 'en',
   'FODEC at whole-invoice level'),
  ('reglage_comptable_option', 'fodec.traitement:par_facture', 'ar',
   'المعلوم على مستوى الفاتورة كاملة'),
  ('reglage_comptable_option', 'fodec.traitement:achat_6652', 'fr',
   'Comme l''option 1, mais achat en 6652 « taxes non récupérables »'),
  ('reglage_comptable_option', 'fodec.traitement:achat_6652', 'en',
   'As option 1, but purchase to 6652 "non-recoverable taxes"'),
  ('reglage_comptable_option', 'fodec.traitement:achat_6652', 'ar',
   'مثل الخيار 1، لكن الشراء في 6652 «أداءات غير قابلة للاسترجاع»'),
  ('reglage_comptable_option', 'timbre.bareme:bareme_date', 'fr',
   'Barème daté en base (standard et grandes surfaces) ; achat 6654, vente 4371'),
  ('reglage_comptable_option', 'timbre.bareme:bareme_date', 'en',
   'Dated scale in the database (standard and large retailers); purchase 6654, sale 4371'),
  ('reglage_comptable_option', 'timbre.bareme:bareme_date', 'ar',
   'جدول مؤرخ في القاعدة (عادي ومساحات كبرى)؛ الشراء 6654، البيع 4371'),
  ('reglage_comptable_option', 'timbre.bareme:fixe_1d', 'fr', '1 D fixe'),
  ('reglage_comptable_option', 'timbre.bareme:fixe_1d', 'en', 'Fixed TND 1'),
  ('reglage_comptable_option', 'timbre.bareme:fixe_1d', 'ar', 'دينار واحد ثابت'),
  ('reglage_comptable_option', 'non_residents.retenue:au_paiement', 'fr',
   'Fournisseur marqué « non-résident », retenue de 100 % générée au paiement, avec attestation'),
  ('reglage_comptable_option', 'non_residents.retenue:au_paiement', 'en',
   'Supplier flagged "non-resident", 100% withholding generated on payment, with certificate'),
  ('reglage_comptable_option', 'non_residents.retenue:au_paiement', 'ar',
   'مورد مصنف «غير مقيم»، خصم 100 % عند الخلاص، مع شهادة'),
  ('reglage_comptable_option', 'non_residents.retenue:a_la_facture', 'fr',
   'Retenue générée dès la réception de la facture'),
  ('reglage_comptable_option', 'non_residents.retenue:a_la_facture', 'en',
   'Withholding generated on receipt of the invoice'),
  ('reglage_comptable_option', 'non_residents.retenue:a_la_facture', 'ar',
   'خصم عند استلام الفاتورة'),
  ('reglage_comptable_option', 'prorata.methode:affectation_puis_prorata', 'fr',
   'Affectation par ligne, prorata provisoire N-1, régularisation proposée en janvier'),
  ('reglage_comptable_option', 'prorata.methode:affectation_puis_prorata', 'en',
   'Allocation per line, provisional prior-year pro-rata, adjustment proposed in January'),
  ('reglage_comptable_option', 'prorata.methode:affectation_puis_prorata', 'ar',
   'تخصيص حسب السطر، نسبة وقتية للسنة السابقة، تسوية مقترحة في جانفي'),
  ('reglage_comptable_option', 'prorata.methode:prorata_global', 'fr', 'Prorata global unique'),
  ('reglage_comptable_option', 'prorata.methode:prorata_global', 'en', 'Single overall pro-rata'),
  ('reglage_comptable_option', 'prorata.methode:prorata_global', 'ar', 'نسبة إجمالية واحدة'),
  ('reglage_comptable_option', 'avoirs.traitement:lie_facture', 'fr',
   'Avoir obligatoirement lié à sa facture : annulation (extourne) ou remise (709 / 609)'),
  ('reglage_comptable_option', 'avoirs.traitement:lie_facture', 'en',
   'Credit note always linked to its invoice: cancellation (reversal) or discount (709 / 609)'),
  ('reglage_comptable_option', 'avoirs.traitement:lie_facture', 'ar',
   'إشعار دائن مرتبط وجوبا بفاتورته: إلغاء (عكس) أو تخفيض (709 / 609)'),
  ('reglage_comptable_option', 'avoirs.traitement:libre', 'fr', 'Avoir libre, avec avertissement'),
  ('reglage_comptable_option', 'avoirs.traitement:libre', 'en', 'Free credit note, with a warning'),
  ('reglage_comptable_option', 'avoirs.traitement:libre', 'ar', 'إشعار دائن حر، مع تنبيه'),
  ('reglage_comptable_option', 'avoirs.traitement:refus_saisie_cabinet', 'fr',
   'Avoir refusé par le Socle, saisi à la main par le cabinet'),
  ('reglage_comptable_option', 'avoirs.traitement:refus_saisie_cabinet', 'en',
   'Credit note refused by the engine, entered by hand by the firm'),
  ('reglage_comptable_option', 'avoirs.traitement:refus_saisie_cabinet', 'ar',
   'إشعار دائن يرفضه المحرك، ويُدخله المكتب يدويا'),
  ('reglage_comptable_option', 'ventes.compte:par_nature_article', 'fr',
   'Compte par défaut selon la nature de l''article (bien, service, annexe)'),
  ('reglage_comptable_option', 'ventes.compte:par_nature_article', 'en',
   'Default account by item nature (goods, service, ancillary)'),
  ('reglage_comptable_option', 'ventes.compte:par_nature_article', 'ar',
   'حساب افتراضي حسب طبيعة الفصل (بضاعة، خدمة، ملحق)'),
  ('reglage_comptable_option', 'ventes.compte:unique_cabinet', 'fr',
   'Un compte unique choisi par le cabinet'),
  ('reglage_comptable_option', 'ventes.compte:unique_cabinet', 'en',
   'A single account chosen by the firm'),
  ('reglage_comptable_option', 'ventes.compte:unique_cabinet', 'ar', 'حساب واحد يختاره المكتب'),
  ('reglage_comptable_option', 'conservation.duree:10ans_cloture_teif', 'fr',
   '10 ans après la clôture, archive immuable avec empreinte, XML TEIF gardé tel quel'),
  ('reglage_comptable_option', 'conservation.duree:10ans_cloture_teif', 'en',
   '10 years after closing, immutable archive with fingerprint, TEIF XML kept as is'),
  ('reglage_comptable_option', 'conservation.duree:10ans_cloture_teif', 'ar',
   '10 سنوات بعد الإقفال، أرشيف غير قابل للتغيير ببصمة، وملف TEIF محفوظ كما هو'),
  ('reglage_comptable_option', 'conservation.duree:duree_cabinet', 'fr',
   'Durée choisie par le cabinet, jamais moins de 10 ans'),
  ('reglage_comptable_option', 'conservation.duree:duree_cabinet', 'en',
   'Period chosen by the firm, never less than 10 years'),
  ('reglage_comptable_option', 'conservation.duree:duree_cabinet', 'ar',
   'مدة يختارها المكتب، لا تقل أبدا عن 10 سنوات'),
  ('reglage_comptable_option', 'mois_tva.date:exigibilite_calculee', 'fr',
   'Date d''exigibilité calculée (bien : livraison ; service : réalisation ou encaissement ; '
   'public : encaissement), modifiable avec motif'),
  ('reglage_comptable_option', 'mois_tva.date:exigibilite_calculee', 'en',
   'Computed due date (goods: delivery; service: performance or collection; public: '
   'collection), editable with a reason'),
  ('reglage_comptable_option', 'mois_tva.date:exigibilite_calculee', 'ar',
   'تاريخ استحقاق محتسب (بضاعة: التسليم؛ خدمة: الإنجاز أو القبض؛ عمومي: القبض)، قابل للتعديل '
   'بتعليل'),
  ('reglage_comptable_option', 'mois_tva.date:date_facture_alerte', 'fr',
   'Date de facture par défaut, alerte si livraison ou encaissement antérieur'),
  ('reglage_comptable_option', 'mois_tva.date:date_facture_alerte', 'en',
   'Invoice date by default, warning if delivery or collection is earlier'),
  ('reglage_comptable_option', 'mois_tva.date:date_facture_alerte', 'ar',
   'تاريخ الفاتورة افتراضيا، مع تنبيه إذا سبقه التسليم أو القبض');

commit;
