-- Sept dossiers, les mêmes de la capture à la bibliothèque (25 octobre 2026).
--
-- Wissem, maquette validée (« ok sans modification de design ») : « Achats,
-- Ventes, Banque, Tickets et reçus, Gouvernance, Fiscal et social, Autres ;
-- même style, et cohérent lors du parcours de lecture ».
--
-- ================================================================== POURQUOI
--
-- L'accueil montrait une carte PAR TYPE, et seulement pour un type qui avait
-- des pièces : « Gouvernance » disparaissait dès qu'aucun PV n'était rangé, sa
-- couleur dépendait de sa place, et la capture proposait six types qui
-- n'étaient pas ceux de l'accueil. Le mot « dossier » voulait dire trois
-- choses.
--
-- Désormais un DOSSIER est une ligne de `ref.dossiers` : son rang, sa teinte,
-- sa période (le mois pour le quotidien, l'année pour un PV ou une
-- déclaration) et le type qu'il donne à une pièce quand on le choisit à la
-- capture. Chaque type de pièce appartient à un dossier (R4 : la règle vit en
-- table). Un avoir suit le sens lu : `dossier_si_vente`.
--
-- R7 : aucune date du jour. R11 : référentiel en lecture seule pour les
-- comptes connectés.

create table ref.dossiers (
  code            text primary key,
  rang            integer not null unique,
  -- Le nom d'une teinte du dessin (`styles-pme.css`), jamais une couleur.
  teinte          text not null,
  periode         text not null check (periode in ('mois', 'annee')),
  type_par_defaut text not null references ref.document_types (code),
  created_at      timestamptz not null default now()
);

alter table ref.dossiers enable row level security;
alter table ref.dossiers force row level security;
grant select on table ref.dossiers to authenticated;
create policy ref_dossiers_sel on ref.dossiers for select to authenticated using (true);

insert into ref.dossiers (code, rang, teinte, periode, type_par_defaut) values
  ('achats',        10, 'achats',        'mois',  'facture_achat'),
  ('ventes',        20, 'ventes',        'mois',  'facture_vente'),
  ('banque',        30, 'banque',        'mois',  'releve_bancaire'),
  ('tickets_recus', 40, 'tickets',       'mois',  'ticket_caisse'),
  ('gouvernance',   50, 'gouvernance',   'annee', 'pv_ago'),
  ('fiscal_social', 60, 'fiscal',        'annee', 'declaration_tva'),
  ('autres',        70, 'autres',        'mois',  'autre_document');

alter table ref.document_types
  add column dossier text references ref.dossiers (code),
  add column dossier_si_vente text references ref.dossiers (code);

update ref.document_types set dossier = v.dossier
  from (values
    ('facture_achat', 'achats'),
    ('bon_livraison', 'achats'),
    ('avoir', 'achats'),
    ('facture_vente', 'ventes'),
    ('releve_bancaire', 'banque'),
    ('ticket_caisse', 'tickets_recus'),
    ('recu_de_paiement', 'tickets_recus'),
    ('justificatif_paiement', 'tickets_recus'),
    ('note_frais', 'tickets_recus'),
    ('pv_ago', 'gouvernance'),
    ('pv_age', 'gouvernance'),
    ('statuts', 'gouvernance'),
    ('extrait_rne', 'gouvernance'),
    ('contrat', 'gouvernance'),
    ('bail', 'gouvernance'),
    ('declaration_tva', 'fiscal_social'),
    ('declaration_impot', 'fiscal_social'),
    ('declaration_cnss', 'fiscal_social'),
    ('acompte_provisionnel', 'fiscal_social'),
    ('bulletin_paie', 'fiscal_social'),
    ('carte_identification_fiscale', 'fiscal_social'),
    ('autre_document', 'autres'),
    ('non_comptable', 'autres')
  ) as v (code, dossier)
 where ref.document_types.code = v.code;

-- Un avoir émis est une vente.
update ref.document_types set dossier_si_vente = 'ventes' where code = 'avoir';

-- Un type nouveau sans dossier ne passe pas inaperçu : il échoue ici.
alter table ref.document_types alter column dossier set not null;

-- La capture propose les dossiers ; ce qu'elle écrit, c'est le type par
-- défaut de chacun. Ces sept types sont donc ceux qu'une pièce reçoit à la
-- capture et ceux qu'une correction accepte (`capture_precision_persist`).
update ref.document_types d
   set propose_a_la_capture = exists (select 1 from ref.dossiers x where x.type_par_defaut = d.code);

insert into ref.labels (ns, key, locale, value) values
  ('dossier', 'achats', 'fr', 'Achats'),
  ('dossier', 'achats', 'en', 'Purchases'),
  ('dossier', 'achats', 'ar', 'المشتريات'),
  ('dossier', 'ventes', 'fr', 'Ventes'),
  ('dossier', 'ventes', 'en', 'Sales'),
  ('dossier', 'ventes', 'ar', 'المبيعات'),
  ('dossier', 'banque', 'fr', 'Banque'),
  ('dossier', 'banque', 'en', 'Bank'),
  ('dossier', 'banque', 'ar', 'البنك'),
  ('dossier', 'tickets_recus', 'fr', 'Tickets et reçus'),
  ('dossier', 'tickets_recus', 'en', 'Tickets and receipts'),
  ('dossier', 'tickets_recus', 'ar', 'التذاكر والوصولات'),
  ('dossier', 'gouvernance', 'fr', 'Gouvernance'),
  ('dossier', 'gouvernance', 'en', 'Governance'),
  ('dossier', 'gouvernance', 'ar', 'الحوكمة'),
  ('dossier', 'fiscal_social', 'fr', 'Fiscal et social'),
  ('dossier', 'fiscal_social', 'en', 'Tax and payroll'),
  ('dossier', 'fiscal_social', 'ar', 'الجباية والشؤون الاجتماعية'),
  ('dossier', 'autres', 'fr', 'Autres'),
  ('dossier', 'autres', 'en', 'Other'),
  ('dossier', 'autres', 'ar', 'أخرى')
on conflict (ns, key, locale) do update set value = excluded.value;

-- Le PV d'AGO s'appelait « Gouvernance » parce que la capture nommait des
-- types ; elle nomme désormais des dossiers. La fiche dit « Gouvernance · PV
-- d'AGO », pas « Gouvernance · Gouvernance ».
insert into ref.labels (ns, key, locale, value) values
  ('document_type', 'pv_ago', 'fr', 'PV d''AGO'),
  ('document_type', 'pv_ago', 'en', 'AGM minutes'),
  ('document_type', 'pv_ago', 'ar', 'محضر جلسة عامة عادية')
on conflict (ns, key, locale) do update set value = excluded.value;
