-- Le sudoku lit toutes les pièces : les grilles des 77 documents en base.
--
-- `docs/sudoku/contrat-du-moteur.md`, section 1. Le moteur ne porte aucune
-- constante (R4) : la grille d'un type de document, ses champs, ses relations
-- et ses preuves vivent ici, rattachés au pack de juridiction tunisien en cours
-- et datés en littéral (R11). Tout ce que Malica livre ici est un DÉFAUT
-- (`statut = 'defaut_a_valider'`, R10) ; seule l'expertise le passe à `arrete`.
--
-- Ce que cette migration fait :
--   1. les quatre tables `ref.grille*`, leurs droits (modèle de
--      `ref.fiscal_charges`) et leurs vues `public.ref_grille*_v` ;
--   2. `public.ref_fiscal_charges_v` gagne `rate` et `basis`, À LA FIN, pour
--      que l'adaptateur lise le taux du FODEC sans le connaître ;
--   3. `capture.champs_lus` : ce que le moteur a lu, champ par champ, sous RLS
--      de tenant (modèle de `capture.piece_articles`) et en écriture seule (R7) ;
--   4. le semis, GÉNÉRÉ depuis `docs/sudoku/grille_tunisie.json`.
--
-- Ce qui n'est pas traduit le dit : une preuve sans `expression` porte
-- `statut = 'a_traduire'` et n'est pas exécutée. On ne force aucune traduction
-- approximative — une somme sur des lignes répétées, un signe porté par un
-- autre champ (solde débiteur/créditeur), un taux imprimé en pourcentage ou
-- une division n'ont pas de forme exacte dans le langage de la section 2.

-- ======================================================== 1. LES QUATRE TABLES

create table if not exists ref.grilles (
  id               uuid primary key default gen_random_uuid(),
  pack_version_id  uuid not null references ref.jurisdiction_packs(id) on delete cascade,
  code             text not null,
  famille          text not null,
  nom              text not null,
  -- Le type de pièce que Malica sait déjà classer, quand il existe. Une grille
  -- sans type (bilan détaillé, carte grise...) se lit quand même.
  document_type    text references ref.document_types(code),
  statut           text not null check (statut in ('defaut_a_valider', 'arrete')),
  -- Pas de défaut : une date de validité s'écrit (R11).
  valid_from       date not null,
  valid_to         date check (valid_to is null or valid_to >= valid_from),
  unique (pack_version_id, code, valid_from)
);

create index if not exists grilles_document_type_idx on ref.grilles (document_type);

comment on table ref.grilles is
  'Un type de document que le sudoku sait lire, par pack et par date d''effet '
  '(contrat du moteur, section 1). Défaut livré par Malica (R10).';

create table if not exists ref.grille_champs (
  id               uuid primary key default gen_random_uuid(),
  grille_id        uuid not null references ref.grilles(id) on delete cascade,
  parcelle         text not null,
  code             text not null,
  libelle          text not null,
  type             text not null check (type in ('texte', 'montant', 'identifiant', 'liste', 'date',
                                                 'booleen', 'nombre', 'adresse', 'periode', 'taux')),
  obligatoire      text not null check (obligatoire in ('oui', 'non', 'selon_cas')),
  condition        text,
  reperes_fr       text[] not null default '{}',
  reperes_ar       text[] not null default '{}',
  -- Le nom d'un motif fourni par le pack (`ref.identifiant_formats.kind`).
  format_code      text,
  -- Les champs d'un même groupe se répètent ensemble (base et montant par taux).
  groupe           text,
  fondement        text not null,
  source_fondement text not null check (source_fondement in ('texte', 'pratique', 'incertain')),
  statut           text not null check (statut in ('defaut_a_valider', 'arrete')),
  unique (grille_id, code)
);

comment on table ref.grille_champs is
  'Couche 1 du sudoku : les champs d''une grille, leurs repères et leur fondement. '
  '`source_fondement` dit si le champ repose sur un texte, sur la pratique, ou '
  'si sa base est INCERTAINE.';

create table if not exists ref.grille_relations (
  id               uuid primary key default gen_random_uuid(),
  grille_id        uuid not null references ref.grilles(id) on delete cascade,
  vers             text not null,
  nature           text not null,
  cle              text not null,
  unique (grille_id, vers, nature, cle)
);

comment on table ref.grille_relations is
  'Couche 2 du sudoku : vers quel autre document une pièce renvoie, et par quelle clé.';

create table if not exists ref.grille_preuves (
  id               uuid primary key default gen_random_uuid(),
  grille_id        uuid not null references ref.grilles(id) on delete cascade,
  code             text not null,
  -- Le texte d'origine du catalogue : il reste lisible même traduit.
  regle            text not null,
  genre            text not null check (genre in ('arithmetique', 'recoupement', 'seuil', 'unicite',
                                                  'format', 'continuite')),
  expression       jsonb check (
                     expression is null
                     or (jsonb_typeof(expression) = 'object'
                         and expression ->> 'op' in ('somme', 'produit', 'taux', 'groupe_taux',
                                                     'charge', 'egal', 'format', 'ordre'))),
  statut           text not null check (statut in ('defaut_a_valider', 'arrete', 'a_traduire')),
  -- Nulle : la preuve vaut pour toute la grille. Nommée : elle n'appartient qu'à
  -- cette variante (une même pièce s'imprime de deux façons, par exemple le
  -- timbre dans le TTC ou après lui) ; le sudoku joue chaque variante.
  variante         text check (variante is null or variante ~ '^[a-z][a-z0-9_]*$'),
  -- Une preuve sans expression n'est pas exécutée, et le dit.
  constraint grille_preuves_traduite_ou_dite check ((expression is null) = (statut = 'a_traduire')),
  unique (grille_id, code)
);

comment on table ref.grille_preuves is
  'Couche 3 du sudoku : les preuves d''une grille. `expression` suit le langage de '
  'la section 2 du contrat ; nulle, la preuve est `a_traduire` et n''est pas exécutée. '
  'Codes : Pnn = règle n du catalogue ; Pnnb, Pnnc = expressions supplémentaires de la '
  'même règle (ou partie exacte d''une règle restée a_traduire) ; Mnn = preuve ajoutée par Malica.';

-- Les droits : ceux de `ref.fiscal_charges` (20260830120000), à l'identique.
do $$
declare
  t text;
begin
  foreach t in array array['grilles', 'grille_champs', 'grille_relations', 'grille_preuves'] loop
    execute format('alter table ref.%I enable row level security', t);
    execute format('alter table ref.%I force row level security', t);
    execute format('revoke all on table ref.%I from public, anon, service_role', t);
    execute format('grant select on table ref.%I to authenticated', t);
    execute format('drop policy if exists %I on ref.%I', 'ref_' || t || '_sel', t);
    execute format(
      'create policy %I on ref.%I for select to authenticated using (true)',
      'ref_' || t || '_sel', t);
  end loop;
end $$;

create or replace view public.ref_grilles_v with (security_invoker = true) as
  select id, pack_version_id, code, famille, nom, document_type, statut, valid_from, valid_to
    from ref.grilles;

create or replace view public.ref_grille_champs_v with (security_invoker = true) as
  select id, grille_id, parcelle, code, libelle, type, obligatoire, condition, reperes_fr,
         reperes_ar, format_code, groupe, fondement, source_fondement, statut
    from ref.grille_champs;

create or replace view public.ref_grille_relations_v with (security_invoker = true) as
  select id, grille_id, vers, nature, cle
    from ref.grille_relations;

create or replace view public.ref_grille_preuves_v with (security_invoker = true) as
  select id, grille_id, code, regle, genre, expression, statut, variante
    from ref.grille_preuves;

revoke all on table public.ref_grilles_v from public, anon, service_role;
grant select on table public.ref_grilles_v to authenticated;
revoke all on table public.ref_grille_champs_v from public, anon, service_role;
grant select on table public.ref_grille_champs_v to authenticated;
revoke all on table public.ref_grille_relations_v from public, anon, service_role;
grant select on table public.ref_grille_relations_v to authenticated;
revoke all on table public.ref_grille_preuves_v from public, anon, service_role;
grant select on table public.ref_grille_preuves_v to authenticated;

-- ======================================== 2. LE TAUX DU FODEC SE LIT PAR LA VUE
--
-- `rate` et `basis` existent depuis 20261019150000 ; la vue ne les rendait pas.
-- Ajoutées À LA FIN : `create or replace view` refuse tout autre changement.

create or replace view public.ref_fiscal_charges_v with (security_invoker = true) as
  select id, pack_version_id, code, label, document_kind, account_code, fixed_amount,
         taxable, legal_reference, valid_from, valid_to, rate, basis
    from ref.fiscal_charges;

revoke all on table public.ref_fiscal_charges_v from public, anon, service_role;
grant select on table public.ref_fiscal_charges_v to authenticated;

-- ============================================== 3. CE QUE LE MOTEUR A LU (capture)

create table if not exists capture.champs_lus (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references identity.organizations(id) on delete cascade,
  piece_id    uuid not null references capture.pieces(id) on delete cascade,
  grille_code text,
  champ_code  text,
  valeur      text,
  statut      text check (statut in ('prouve', 'conforme', 'signale', 'absent')),
  -- Les jetons qui portent la valeur ({page, ordinal}) : jamais de valeur sans citation (R2).
  citations   jsonb,
  -- L'issue du sudoku pour la pièce : prouvee, ambigue, aucune.
  issue       text,
  created_at  timestamptz not null default now()
);

-- R6 : l'index mène par tenant_id. Le second sert la cascade depuis la pièce.
create index if not exists champs_lus_tenant_piece_idx
  on capture.champs_lus (tenant_id, piece_id, grille_code, champ_code);
create index if not exists champs_lus_piece_id_fk_idx on capture.champs_lus (piece_id);

-- Le helper pose RLS, révocations (public, anon, service_role), lecture et
-- insertion ; `true` en dernier : pas de politique de mise à jour ni d'effacement.
select app.enable_tenant_rls('capture', 'champs_lus', false, true);

-- Lecture : celle de `capture.piece_articles`, à l'identique — élargie aux
-- mandats, et alignée sur la pièce (une pièce personnelle ne se lit pas par
-- ses champs).
drop policy if exists capture_champs_lus_sel on capture.champs_lus;
create policy capture_champs_lus_sel on capture.champs_lus
  for select to authenticated
  using (
    (tenant_id in (select app.member_orgs())
     or tenant_id in (select app.engaged_orgs())
     or app.plateforme_requise(tenant_id)
     or exists (select 1 from capture.pieces pc
                 where pc.id = champs_lus.piece_id
                   and pc.created_by = auth.uid()))
    and app.piece_lisible(piece_id));

-- R7 : une lecture ne se réécrit pas, elle se refait. Comme `capture.analyses`,
-- `citations`, `precisions` : la ligne ne part qu'avec sa pièce, quand
-- `capture_piece_supprimer` l'efface. Sans droit update/delete pour
-- `authenticated` (le garde d'effacement n'est sûr qu'à cette condition).
revoke update, delete on table capture.champs_lus from authenticated;
drop trigger if exists capture_champs_lus_no_upd on capture.champs_lus;
create trigger capture_champs_lus_no_upd
  before update or delete on capture.champs_lus
  for each row execute function app.deny_mutation_hors_effacement_de_piece();

-- Rien de nouveau ne s'écrit sur une version remplacée (20261029190000).
drop trigger if exists pas_de_geste_sur_une_version_precedente on capture.champs_lus;
create trigger pas_de_geste_sur_une_version_precedente
  before insert on capture.champs_lus
  for each row execute function app.pas_de_geste_sur_une_version_precedente();

-- Une lecture s'écrit par le serveur, jamais par un client (ANO-002) : la même
-- garde que `capture.extractions`, `citations` et `token_plan`.
drop trigger if exists champs_lus_origine_serveur on capture.champs_lus;
create trigger champs_lus_origine_serveur
  before insert on capture.champs_lus
  for each row execute function app.exiger_origine_serveur();

-- Seules les portes écrivent (20261104130000) : aucun droit d'écriture direct
-- au client. La lecture du sudoku s'inscrit par cette porte, que le serveur
-- seul appelle, pour une pièce que l'appelant peut modifier.
revoke insert on table capture.champs_lus from authenticated;

create or replace function public.capture_champs_lus_inscrire(
  p_piece uuid, p_grille text, p_issue text, p_champs jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_n integer;
begin
  if coalesce(current_setting('malica.origine', true), '') <> 'serveur' then
    raise exception 'reserve au serveur : capture.champs_lus' using errcode = '42501';
  end if;
  if not app.piece_modifiable(p_piece) then
    raise exception 'piece.inaccessible' using errcode = '42501';
  end if;
  if p_issue not in ('prouvee', 'ambigue', 'aucune') then
    raise exception 'issue inconnue : %', p_issue using errcode = '22023';
  end if;
  insert into capture.champs_lus
    (tenant_id, piece_id, grille_code, champ_code, valeur, statut, citations, issue)
  select p.tenant_id, p.id, p_grille, c.champ, c.valeur, c.statut, c.citations, p_issue
    from capture.pieces p
   cross join jsonb_to_recordset(p_champs)
        as c(champ text, valeur text, statut text, citations jsonb)
   where p.id = p_piece;
  get diagnostics v_n = row_count;
  return v_n;
end
$function$;

revoke all on function public.capture_champs_lus_inscrire(uuid, text, text, jsonb)
  from public, anon;
grant execute on function public.capture_champs_lus_inscrire(uuid, text, text, jsonb)
  to authenticated;

comment on table capture.champs_lus is
  'Ce que le sudoku a lu sur une pièce, champ par champ : valeur, statut, citations '
  '(contrat du moteur, section 5). Écriture seule (R7).';

-- Le pack en cours doit exister, et être unique : sans lui, rien ne se sème et
-- la migration le dit au lieu de passer à vide.
do $$
declare n integer;
begin
  select count(*) into n from ref.jurisdiction_packs p
   where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01'
     and (p.effective_to is null or p.effective_to >= date '2026-01-01');
  if n <> 1 then
    raise exception 'pack TN en cours au 2026-01-01 : % trouvé(s), 1 attendu', n;
  end if;
end $$;

-- ================================================= 3. LES GRILLES (généré)
--
-- Généré depuis docs/sudoku/grille_tunisie.json (genere_le 2026-10-30) par
-- generer.py : 77 grilles, 2132 champs, 362 relations, 468 preuves dont 25 traduites.

insert into ref.grilles (pack_version_id, code, famille, nom, document_type, statut, valid_from, valid_to)
select p.id, v.code, v.famille, v.nom, dt.code, 'defaut_a_valider', date '2026-01-01', null
  from ref.jurisdiction_packs p
  cross join (values
    ('facture', 'Achats et ventes', 'Facture (achat ou vente) et note d''honoraires', 'facture_achat'::text),
    ('facture_electronique', 'Achats et ventes', 'Facture électronique (El Fatoora / TTN, format TEIF)', 'facture_achat'::text),
    ('avoir', 'Achats et ventes', 'Facture rectificative ou facture d''avoir', 'avoir'::text),
    ('devis_proforma', 'Achats et ventes', 'Devis et facture proforma', null::text),
    ('bon_commande', 'Achats et ventes', 'Bon de commande', null::text),
    ('bon_livraison', 'Achats et ventes', 'Bon de livraison (et bon de sortie)', 'bon_livraison'::text),
    ('bon_reception', 'Achats et ventes', 'Bon de réception', null::text),
    ('ticket_caisse', 'Achats et ventes', 'Ticket de caisse', 'ticket_caisse'::text),
    ('recu_quittance', 'Achats et ventes', 'Reçu et quittance (dont quittance de loyer)', 'recu_de_paiement'::text),
    ('note_frais', 'Achats et ventes', 'Note de frais', 'note_frais'::text),
    ('facture_service_public', 'Achats et ventes', 'Facture de services publics (STEG, SONEDE, Tunisie Télécom et opérateurs)', 'facture_achat'::text),
    ('bilan', 'Comptable et patrimoine', 'Bilan (état de la situation financière) — modèle normalisé SCE', 'autre_document'::text),
    ('etat_resultat', 'Comptable et patrimoine', 'État de résultat — modèle normalisé SCE', 'autre_document'::text),
    ('etat_flux_tresorerie', 'Comptable et patrimoine', 'État des flux de trésorerie', 'autre_document'::text),
    ('notes_etats_financiers', 'Comptable et patrimoine', 'Notes aux états financiers', 'autre_document'::text),
    ('balance_tiers', 'Comptable et patrimoine', 'Balance générale (et balances auxiliaires) reçue d''un tiers (cabinet, logiciel, filiale)', 'autre_document'::text),
    ('grand_livre_tiers', 'Comptable et patrimoine', 'Grand livre (général ou auxiliaire) reçu d''un tiers', 'autre_document'::text),
    ('facture_acquisition_immobilisation', 'Comptable et patrimoine', 'Facture d''acquisition d''immobilisation (corporelle ou incorporelle)', 'autre_document'::text),
    ('contrat_acquisition_immobilisation', 'Comptable et patrimoine', 'Contrat / acte d''acquisition d''immobilisation (immeuble, fonds de commerce, équipement important)', 'contrat'::text),
    ('fiche_immobilisation', 'Comptable et patrimoine', 'Fiche d''immobilisation et tableau d''amortissement', 'autre_document'::text),
    ('pv_inventaire_stocks', 'Comptable et patrimoine', 'Procès-verbal d''inventaire physique des stocks (avec fiches de comptage)', 'autre_document'::text),
    ('declaration_douane_import', 'Comptable et patrimoine', 'Déclaration en douane à l''importation (déclaration en détail / DDM)', 'document_fiscal_social'::text),
    ('declaration_douane_export', 'Comptable et patrimoine', 'Déclaration en douane à l''exportation', 'document_fiscal_social'::text),
    ('document_dedouanement', 'Comptable et patrimoine', 'Documents de dédouanement : quittance des droits, bon à enlever, bon de sortie', 'document_fiscal_social'::text),
    ('certificat_origine', 'Comptable et patrimoine', 'Certificat d''origine (préférentiel type EUR.1 / EUR-MED, ou non préférentiel délivré par chambre de commerce) et déclaration d''origine', 'autre_document'::text),
    ('contrat_assurance', 'Comptable et patrimoine', 'Contrat (police) d''assurance — conditions générales et particulières, avenants, attestation', 'contrat'::text),
    ('avis_echeance_assurance', 'Comptable et patrimoine', 'Avis d''échéance / quittance de prime d''assurance', 'autre_document'::text),
    ('carte_grise', 'Comptable et patrimoine', 'Carte grise (certificat d''immatriculation) d''un véhicule de société', 'autre_document'::text),
    ('vignette', 'Comptable et patrimoine', 'Vignette / quittance de la taxe de circulation d''un véhicule de société', 'document_fiscal_social'::text),
    ('contrat_leasing', 'Comptable et patrimoine', 'Contrat de leasing (crédit-bail) mobilier ou immobilier, avec échéancier', 'contrat'::text),
    ('declaration_mensuelle', 'Fiscal', 'Déclaration mensuelle des impôts (TVA, retenues à la source, TCL, TFP, FOPROLOS, droit de timbre, autres taxes)', 'declaration_impot'::text),
    ('acompte_provisionnel', 'Fiscal', 'Déclaration et paiement de l''acompte provisionnel', 'acompte_provisionnel'::text),
    ('declaration_annuelle_is_irpp', 'Fiscal', 'Déclaration annuelle de l''impôt sur les sociétés (et de l''IRPP pour les personnes physiques)', 'declaration_impot'::text),
    ('declaration_employeur', 'Fiscal', 'Déclaration de l''employeur (annuelle) — récapitulatif et annexes I à VII', 'document_fiscal_social'::text),
    ('certificat_retenue_source', 'Fiscal', 'Certificat (attestation) de retenue à la source', 'document_fiscal_social'::text),
    ('quittance_paiement', 'Fiscal', 'Quittance / récépissé de paiement de la recette des finances, ou reçu de télépaiement', null::text),
    ('carte_identification_fiscale', 'Fiscal', 'Carte d''identification fiscale (anciennement « patente ») / attestation d''immatriculation fiscale', 'carte_identification_fiscale'::text),
    ('attestation_situation_fiscale', 'Fiscal', 'Attestation de situation fiscale / de régularité fiscale', null::text),
    ('avis_verification', 'Fiscal', 'Avis de vérification fiscale (approfondie ou ponctuelle)', null::text),
    ('notification_resultats_verification', 'Fiscal', 'Notification des résultats de la vérification fiscale (redressement)', null::text),
    ('arrete_taxation_office', 'Fiscal', 'Arrêté de taxation d''office (suite de redressement)', null::text),
    ('attestation_suspension_tva', 'Fiscal', 'Attestation (décision) d''achat en suspension de TVA — régime suspensif', null::text),
    ('attestation_exoneration_non_retenue', 'Fiscal', 'Attestation d''exonération (TVA) ou de non-soumission / dispense de retenue à la source', null::text),
    ('statuts', 'Juridique et gouvernance', 'Statuts (acte constitutif) - SARL, SUARL, SA - version initiale ou mise à jour', 'statuts'::text),
    ('extrait_rne', 'Juridique et gouvernance', 'Extrait du Registre national des entreprises (RNE)', 'extrait_rne'::text),
    ('pv_ago', 'Juridique et gouvernance', 'Procès-verbal d''assemblée générale ordinaire (annuelle ou réunie extraordinairement)', 'pv_ago'::text),
    ('pv_age', 'Juridique et gouvernance', 'Procès-verbal d''assemblée générale extraordinaire', 'pv_age'::text),
    ('feuille_presence', 'Juridique et gouvernance', 'Feuille de présence d''assemblée générale', 'document_gouvernance'::text),
    ('pv_conseil_administration', 'Juridique et gouvernance', 'Procès-verbal de réunion du conseil d''administration (SA)', 'document_gouvernance'::text),
    ('decision_associe_unique', 'Juridique et gouvernance', 'Décision de l''associé unique (SUARL)', 'document_gouvernance'::text),
    ('decision_gerant', 'Juridique et gouvernance', 'Décision du gérant (SARL/SUARL)', 'document_gouvernance'::text),
    ('rapport_gestion', 'Juridique et gouvernance', 'Rapport de gestion (rapport annuel du gérant / du conseil d''administration)', 'document_gouvernance'::text),
    ('rapport_cac', 'Juridique et gouvernance', 'Rapport du commissaire aux comptes (rapport général et rapport spécial)', 'document_gouvernance'::text),
    ('contrat_commercial', 'Juridique et gouvernance', 'Contrat commercial (vente, prestation de services, distribution, sous-traitance, partenariat, licence)', 'contrat'::text),
    ('bail_commercial', 'Juridique et gouvernance', 'Bail commercial ou professionnel (location de locaux)', 'bail'::text),
    ('procuration', 'Juridique et gouvernance', 'Procuration / pouvoir (pouvoir pour assemblée, délégation de pouvoirs, mandat spécial ou général)', 'document_gouvernance'::text),
    ('bulletin_paie', 'Social', 'Bulletin de paie (fiche de paie)', 'bulletin_paie'::text),
    ('declaration_cnss_trimestrielle', 'Social', 'Déclaration trimestrielle des salaires à la CNSS (DS)', 'declaration_cnss'::text),
    ('recepisse_quittance_cnss', 'Social', 'Récépissé de dépôt et quittance de paiement des cotisations CNSS', 'declaration_cnss'::text),
    ('contrat_cdi', 'Social', 'Contrat de travail à durée indéterminée (CDI)', 'contrat'::text),
    ('contrat_cdd', 'Social', 'Contrat de travail à durée déterminée (CDD, régime de l''article 6-4 nouveau)', 'contrat'::text),
    ('contrat_insertion_civp', 'Social', 'Contrat d''insertion (CIVP, ex-SIVP) et autres programmes ANETI', 'contrat'::text),
    ('attestation_travail', 'Social', 'Attestation de travail / certificat de travail', 'document_fiscal_social'::text),
    ('attestation_salaire', 'Social', 'Attestation de salaire', 'document_fiscal_social'::text),
    ('certificat_affiliation_cnss', 'Social', 'Certificat / attestation d''affiliation (immatriculation) de l''employeur à la CNSS', 'document_fiscal_social'::text),
    ('recu_solde_tout_compte', 'Social', 'Reçu pour solde de tout compte', 'document_fiscal_social'::text),
    ('registre_personnel', 'Social', 'Registre ou état du personnel (registre d''employeur)', 'document_fiscal_social'::text),
    ('releve_bancaire', 'Trésorerie et banque', 'Relevé de compte bancaire (et relevé de compte courant postal CCP)', 'releve_bancaire'::text),
    ('avis_debit', 'Trésorerie et banque', 'Avis de débit', 'justificatif_paiement'::text),
    ('avis_credit', 'Trésorerie et banque', 'Avis de crédit', 'justificatif_paiement'::text),
    ('cheque', 'Trésorerie et banque', 'Chèque (formule) et son talon (souche)', 'justificatif_paiement'::text),
    ('lettre_change', 'Trésorerie et banque', 'Lettre de change / traite (formule normalisée à lecture électronique)', 'justificatif_paiement'::text),
    ('billet_ordre', 'Trésorerie et banque', 'Billet à ordre', 'justificatif_paiement'::text),
    ('virement', 'Trésorerie et banque', 'Ordre de virement (émis) et avis de virement reçu', 'justificatif_paiement'::text),
    ('ticket_tpe', 'Trésorerie et banque', 'Ticket de terminal de paiement électronique (TPE) — copie commerçant / copie client', 'justificatif_paiement'::text),
    ('tableau_amortissement_emprunt', 'Trésorerie et banque', 'Tableau d''amortissement d''emprunt bancaire', null::text),
    ('echeancier_leasing', 'Trésorerie et banque', 'Échéancier de leasing (crédit-bail mobilier ou immobilier)', null::text)
  ) as v(code, famille, nom, code_malica)
  left join ref.document_types dt on dt.code = v.code_malica
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (pack_version_id, code, valid_from) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('facture', 'En-tête émetteur', 'raison_sociale_emetteur', 'Nom ou raison sociale de l''émetteur', 'texte', 'non', null::text, array['Raison sociale', 'Société', 'Dénomination']::text[], '{}'::text[], null::text, null::text, 'pratique (non listé à l''art. 18-II ; autre base légale INCERTAIN)', 'incertain'),
    ('facture', 'En-tête émetteur', 'forme_juridique_capital_emetteur', 'Forme juridique et capital', 'texte', 'non', null::text, array['SARL au capital de', 'SA au capital de', 'SUARL']::text[], '{}'::text[], null::text, null::text, 'pratique (obligation éventuelle Code des sociétés commerciales : INCERTAIN)', 'incertain'),
    ('facture', 'En-tête émetteur', 'adresse_emetteur', 'Adresse de l''émetteur', 'adresse', 'non', null::text, array['Adresse', 'Siège social']::text[], array['العنوان']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('facture', 'En-tête émetteur', 'matricule_fiscal_emetteur', 'Numéro de carte d''identification fiscale TVA (matricule fiscal) de l''émetteur', 'identifiant', 'oui', null::text, array['MF', 'Matricule fiscal', 'M.F.', 'Identifiant fiscal', 'Code TVA']::text[], array['المعرف الجبائي']::text[], 'matricule_fiscal'::text, null::text, 'Code TVA art. 18-II ; art. 18-II bis pour les notes d''honoraires (documents sans MF non retenus, depuis le 01/04/2017)', 'texte'),
    ('facture', 'En-tête émetteur', 'registre_commerce_emetteur', 'Identifiant au registre national des entreprises (RNE / RC)', 'identifiant', 'non', null::text, array['RNE', 'RC', 'Registre de commerce', 'Identifiant unique']::text[], '{}'::text[], null::text, null::text, 'pratique (obligation d''affichage sur documents commerciaux : INCERTAIN)', 'incertain'),
    ('facture', 'En-tête émetteur', 'telephone_email_emetteur', 'Téléphone, fax, e-mail, site', 'texte', 'non', null::text, array['Tél', 'Fax', 'E-mail']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('facture', 'En-tête émetteur', 'rib_emetteur', 'Coordonnées bancaires de l''émetteur (banque, RIB/IBAN)', 'identifiant', 'non', null::text, array['RIB', 'IBAN', 'Banque', 'Compte']::text[], '{}'::text[], null::text, null::text, 'pratique (donnée sensible : stocker chiffrée, ne jamais afficher en clair)', 'pratique'),
    ('facture', 'En-tête émetteur', 'code_tva_categorie_etablissement', 'Décomposition du matricule fiscal (clé, code TVA, catégorie, n° d''établissement secondaire)', 'identifiant', 'selon_cas', 'dérivé du matricule fiscal ; utile au recoupement des déclarations'::text, array['Code TVA', 'Code catégorie', 'N° établissement']::text[], '{}'::text[], null::text, null::text, 'Cahier des charges DGI 2007 (structure MF : matricule, clé, catégorie, établissement secondaire)', 'texte'),
    ('facture', 'Destinataire (client)', 'nom_client', 'Identification du client (nom et prénom ou raison sociale)', 'texte', 'oui', null::text, array['Client', 'Doit', 'Facturé à', 'M.', 'Société']::text[], array['الحريف']::text[], null::text, null::text, 'Code TVA art. 18-II (« identification du client »)', 'texte'),
    ('facture', 'Destinataire (client)', 'adresse_client', 'Adresse du client', 'adresse', 'oui', null::text, array['Adresse']::text[], array['العنوان']::text[], null::text, null::text, 'Code TVA art. 18-II', 'texte'),
    ('facture', 'Destinataire (client)', 'matricule_fiscal_client', 'Matricule fiscal du client', 'identifiant', 'selon_cas', 'client soumis à l''obligation de déclaration d''existence (art. 56 Code IRPP/IS)'::text, array['MF client', 'Matricule fiscal', 'Code TVA client']::text[], array['المعرف الجبائي']::text[], 'matricule_fiscal'::text, null::text, 'Code TVA art. 18-II (modifié art. 17 LFC 2014-54)', 'texte'),
    ('facture', 'Destinataire (client)', 'type_identifiant_client', 'Type d''identifiant du client (MF, CIN, carte de séjour, non-résident)', 'liste', 'selon_cas', 'listes déposées à la DGI (ventes en suspension) et facture électronique'::text, array['CIN', 'Carte de séjour', 'Passeport']::text[], '{}'::text[], null::text, null::text, 'Cahier des charges DGI 2007 (types 1 à 4) ; TEIF (INCERTAIN)', 'incertain'),
    ('facture', 'Destinataire (client)', 'code_client', 'Code client interne de l''émetteur', 'identifiant', 'non', null::text, array['Code client', 'Réf. client', 'N° client']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('facture', 'Destinataire (client)', 'adresse_livraison', 'Adresse de livraison si différente', 'adresse', 'non', null::text, array['Livré à', 'Adresse de livraison']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('facture', 'Références', 'numero_facture', 'Numéro de facture, dans une série ininterrompue', 'identifiant', 'oui', null::text, array['Facture N°', 'N°', 'Numéro', 'Réf.']::text[], array['رقم الفاتورة']::text[], null::text, null::text, 'Code TVA art. 18-III', 'texte'),
    ('facture', 'Références', 'type_document', 'Intitulé du document (Facture, Note d''honoraires, Facture globale)', 'liste', 'oui', null::text, array['FACTURE', 'NOTE D''HONORAIRES', 'FACTURE GLOBALE']::text[], array['فاتورة']::text[], null::text, null::text, 'Code TVA art. 18-II, 18-II bis', 'texte'),
    ('facture', 'Références', 'date_operation', 'Date de l''opération', 'date', 'oui', null::text, array['Date', 'Date de livraison', 'Date de prestation']::text[], array['التاريخ']::text[], null::text, null::text, 'Code TVA art. 18-II (« la date de l''opération »)', 'texte'),
    ('facture', 'Références', 'date_emission', 'Date d''émission de la facture', 'date', 'selon_cas', 'en pratique confondue avec la date de l''opération ; la loi vise la date de l''opération'::text, array['Date facture', 'Tunis, le', 'Le']::text[], array['التاريخ']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('facture', 'Références', 'periode_prestation', 'Période couverte (prestations continues)', 'periode', 'non', null::text, array['Période', 'Du ... au ...']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('facture', 'Références', 'ref_bon_commande', 'Référence du bon de commande client', 'identifiant', 'non', null::text, array['BC N°', 'Votre commande', 'Réf. commande']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('facture', 'Références', 'ref_bon_livraison', 'Référence(s) du ou des bons de livraison', 'identifiant', 'non', null::text, array['BL N°', 'Bon de livraison']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('facture', 'Références', 'ref_devis_marche', 'Référence du devis, contrat ou marché public', 'identifiant', 'non', null::text, array['Devis N°', 'Marché N°', 'Contrat N°']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('facture', 'Références', 'ref_attestation_suspension', 'Numéro et date du bon de commande visé / attestation d''achat en suspension de TVA', 'identifiant', 'selon_cas', 'vente en suspension de TVA (export, régime suspensif)'::text, array['Attestation d''achat en suspension', 'Bon de commande visé', 'Autorisation n°']::text[], '{}'::text[], null::text, null::text, 'Code TVA art. 18-II (liste des factures en suspension) et art. 11', 'texte'),
    ('facture', 'Lignes', 'designation', 'Désignation du bien ou du service', 'texte', 'oui', null::text, array['Désignation', 'Description', 'Libellé', 'Article']::text[], '{}'::text[], null::text, null::text, 'Code TVA art. 18-II', 'texte'),
    ('facture', 'Lignes', 'reference_article', 'Code article / référence produit', 'identifiant', 'non', null::text, array['Réf', 'Code', 'Code article']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('facture', 'Lignes', 'quantite', 'Quantité', 'nombre', 'non', null::text, array['Qté', 'Quantité', 'Nbre']::text[], array['الكمية']::text[], null::text, null::text, 'pratique (la loi exige la désignation et le prix HT)', 'pratique'),
    ('facture', 'Lignes', 'unite', 'Unité de mesure', 'liste', 'non', null::text, array['U', 'Unité', 'Kg', 'M²', 'H']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('facture', 'Lignes', 'prix_unitaire_ht', 'Prix unitaire hors taxe', 'montant', 'non', null::text, array['P.U. HT', 'PU', 'Prix unitaire']::text[], array['السعر']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('facture', 'Lignes', 'remise_ligne', 'Remise ou rabais sur ligne (taux ou montant)', 'montant', 'non', null::text, array['Remise', 'Rem. %', 'Rabais']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('facture', 'Lignes', 'montant_ligne_ht', 'Prix hors taxe de la ligne', 'montant', 'oui', null::text, array['Montant HT', 'Total HT', 'PT HT']::text[], '{}'::text[], null::text, null::text, 'Code TVA art. 18-II (« prix hors taxe »)', 'texte'),
    ('facture', 'Lignes', 'taux_tva_ligne', 'Taux de TVA de la ligne', 'taux', 'oui', null::text, array['TVA %', 'Taux TVA', 'TVA']::text[], array['الأداء على القيمة المضافة']::text[], null::text, null::text, 'Code TVA art. 18-II (taux et montants de la taxe) ; valeurs des taux à lire en base (non relues ici)', 'texte'),
    ('facture', 'Lignes', 'fodec_applicable_ligne', 'Ligne soumise au FODEC', 'booleen', 'selon_cas', 'produits industriels soumis (champ exact INCERTAIN)'::text, array['FODEC']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('facture', 'Lignes', 'droit_consommation_ligne', 'Droit de consommation (taux et montant)', 'montant', 'selon_cas', 'produits soumis au droit de consommation'::text, array['DC', 'Droit de consommation']::text[], '{}'::text[], null::text, null::text, 'Cahier des charges DGI 2007 (zones droit de consommation) ; texte de fond INCERTAIN', 'incertain'),
    ('facture', 'Totaux', 'total_brut_ht', 'Total brut HT avant remise', 'montant', 'non', null::text, array['Total brut', 'Total HT brut']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('facture', 'Totaux', 'remise_globale', 'Remise globale', 'montant', 'non', null::text, array['Remise', 'Escompte']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('facture', 'Totaux', 'total_ht', 'Total hors taxe (net)', 'montant', 'oui', null::text, array['Total HT', 'Net HT', 'Montant HT']::text[], array['المبلغ دون اعتبار الأداءات']::text[], null::text, null::text, 'Code TVA art. 18-II (prix hors taxe)', 'texte'),
    ('facture', 'Totaux', 'total_ttc', 'Total toutes taxes comprises', 'montant', 'non', null::text, array['Total TTC', 'Net TTC', 'TTC']::text[], array['المبلغ الجملي']::text[], null::text, null::text, 'pratique universelle (non listé à l''art. 18-II) ; montant TEIF I-180 selon S_TEIF_VALIDATOR (INCERTAIN)', 'incertain'),
    ('facture', 'Totaux', 'net_a_payer', 'Net à payer (après timbre, avances, retenues éventuelles)', 'montant', 'non', null::text, array['Net à payer', 'Reste à payer']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('facture', 'Totaux', 'montant_en_lettres', 'Montant arrêté en toutes lettres', 'texte', 'non', null::text, array['Arrêtée la présente facture à la somme de']::text[], '{}'::text[], null::text, null::text, 'pratique tunisienne courante (« Arrêtée la présente facture à la somme de »)', 'pratique'),
    ('facture', 'Totaux', 'devise', 'Devise (TND par défaut ; devise étrangère à l''export)', 'liste', 'non', null::text, array['DT', 'TND', 'EUR', 'USD']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('facture', 'Totaux', 'acomptes_deduits', 'Avances ou acomptes déjà facturés et déduits', 'montant', 'non', null::text, array['Acompte', 'Avance']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('facture', 'Taxes', 'base_tva_par_taux', 'Base imposable par taux de TVA', 'montant', 'oui', null::text, array['Base', 'Assiette', 'Base TVA']::text[], '{}'::text[], null::text, 'taux_tva'::text, 'Code TVA art. 18-II (taux et montants) ; détail par taux = pratique', 'pratique'),
    ('facture', 'Taxes', 'montant_tva_par_taux', 'Montant de TVA par taux', 'montant', 'oui', null::text, array['TVA', 'Montant TVA']::text[], array['الأداء على القيمة المضافة']::text[], null::text, 'taux_tva'::text, 'Code TVA art. 18-II', 'texte'),
    ('facture', 'Taxes', 'montant_fodec', 'FODEC (montant)', 'montant', 'selon_cas', 'produits soumis ; taux et inclusion dans l''assiette TVA INCERTAIN'::text, array['FODEC', 'F.O.D.E.C']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN (paramétrage Malica : 1 % de la base HT, entrant dans l''assiette TVA, non vérifié)', 'incertain'),
    ('facture', 'Taxes', 'montant_tva_suspendue', 'Montant de TVA suspendu', 'montant', 'selon_cas', 'vente en suspension de TVA'::text, array['TVA suspendue', 'En suspension de TVA']::text[], '{}'::text[], null::text, null::text, 'Code TVA art. 18-II', 'texte'),
    ('facture', 'Taxes', 'droit_timbre', 'Droit de timbre', 'montant', 'selon_cas', 'facture soumise au timbre ; montant variable (grandes surfaces : 1,5 DT de 50 à 100 DT, 2 DT au-delà, depuis le 01/01/2026 selon KPMG)'::text, array['Timbre', 'Timbre fiscal', 'Droit de timbre']::text[], array['معلوم الطابع']::text[], null::text, null::text, 'Code des droits d''enregistrement et de timbre, art. 117 : INCERTAIN (montant 1,000 D du paramétrage non relu) ; LF 2026 (loi 2025-17) via KPMG', 'incertain'),
    ('facture', 'Règlement', 'mode_reglement', 'Mode de règlement (espèces, chèque, virement, traite, effet)', 'liste', 'non', null::text, array['Mode de paiement', 'Règlement', 'Chèque', 'Virement', 'Traite']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('facture', 'Règlement', 'date_echeance', 'Date d''échéance / délai de paiement', 'date', 'non', null::text, array['Échéance', 'Payable le', 'À 30 jours', 'Conditions de paiement']::text[], '{}'::text[], null::text, null::text, 'pratique (encadrement légal des délais de paiement : INCERTAIN)', 'incertain'),
    ('facture', 'Règlement', 'retenue_source_mention', 'Mention ou montant de retenue à la source', 'montant', 'non', 'si le client est tenu d''opérer une retenue ; justifiée par un certificat de retenue distinct'::text, array['Retenue à la source', 'RS', 'RAS']::text[], array['الخصم من المورد']::text[], null::text, null::text, 'Code IRPP/IS art. 52 : INCERTAIN (taux et seuils non relus)', 'incertain'),
    ('facture', 'Règlement', 'penalites_retard', 'Pénalités ou intérêts de retard', 'texte', 'non', null::text, array['Pénalités de retard']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('facture', 'Mentions', 'mention_suspension_exoneration', 'Mention de vente en suspension ou en exonération de TVA (avec base légale)', 'texte', 'selon_cas', 'opération en suspension (art. 11) ou exonérée (tableau A)'::text, array['Vente en suspension de TVA', 'Exonéré de TVA', 'Exonération', 'Article 11']::text[], '{}'::text[], null::text, null::text, 'Code TVA art. 11 (mention obligatoire en régime suspensif) ; tableau A pour l''exonération : mention facultative en pratique', 'pratique'),
    ('facture', 'Mentions', 'mention_export', 'Mention export (vente hors taxes à l''exportation)', 'texte', 'selon_cas', 'vente à l''export'::text, array['Export', 'Exonéré export', 'Suspension TVA - export']::text[], '{}'::text[], null::text, null::text, 'Code TVA art. 11 (portée exacte INCERTAIN)', 'incertain'),
    ('facture', 'Mentions', 'mention_regime_forfaitaire', 'Mention de non-assujettissement / régime forfaitaire', 'texte', 'non', 'émetteur non assujetti'::text, array['Non assujetti à la TVA', 'Forfaitaire']::text[], '{}'::text[], null::text, null::text, 'pratique ; attention art. 2-I-2 : faire figurer la TVA rend redevable', 'pratique'),
    ('facture', 'Mentions', 'conditions_generales', 'Conditions générales de vente, clause de réserve de propriété', 'texte', 'non', null::text, array['Conditions générales', 'Réserve de propriété']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('facture', 'Signature et cachet', 'cachet_emetteur', 'Cachet commercial de l''émetteur', 'booleen', 'selon_cas', 'obligatoire sur la copie papier d''une facture électronique (art. 18-II ter) ; ailleurs pratique'::text, array['Cachet', 'Cachet et signature']::text[], array['ختم']::text[], null::text, null::text, 'Code TVA art. 18-II ter ; pratique', 'pratique'),
    ('facture', 'Signature et cachet', 'signature_emetteur', 'Signature de l''émetteur', 'booleen', 'selon_cas', 'obligatoire sur la copie papier d''une facture électronique ; ailleurs pratique'::text, array['Signature', 'Le gérant', 'Visa']::text[], array['إمضاء']::text[], null::text, null::text, 'Code TVA art. 18-II ter ; pratique', 'pratique'),
    ('facture', 'Signature et cachet', 'visa_client', 'Signature ou cachet de réception client', 'booleen', 'non', null::text, array['Bon pour accord', 'Reçu le']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('facture', 'Code structuré', 'reference_ttn', 'Référence unique d''enregistrement TTN', 'identifiant', 'selon_cas', 'facture électronique (voir document facture_electronique)'::text, array['Référence TTN', 'Réf. El Fatoora']::text[], '{}'::text[], null::text, null::text, 'Code TVA art. 18-II ter', 'texte'),
    ('facture', 'Code structuré', 'qr_code', 'QR code / cachet électronique visible', 'texte', 'selon_cas', 'facture électronique'::text, array['QR']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN (pratique TTN, voir facture_electronique)', 'incertain')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('facture_electronique', 'Mentions de la facture (identiques à la facture papier)', 'mentions_art18_II', 'Toutes les mentions de l''art. 18-II (voir document facture)', 'texte', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'Code TVA art. 18-II ter (« comportant les mentions obligatoires » du paragraphe II)', 'texte'),
    ('facture_electronique', 'En-tête TEIF', 'version_teif', 'Version du schéma TEIF', 'texte', 'oui', null::text, array['TEIF', 'version']::text[], '{}'::text[], null::text, null::text, 'spécification TTN ; XSD 1.8.8 et Guide TEIF V2.0 selon S_TEIF_VALIDATOR (INCERTAIN)', 'incertain'),
    ('facture_electronique', 'En-tête TEIF', 'identifiant_emetteur_message', 'Matricule fiscal de l''expéditeur du message', 'identifiant', 'oui', null::text, array['MessageSenderIdentifier']::text[], '{}'::text[], null::text, null::text, 'spécification TTN (INCERTAIN : code type identifiant I-01 selon S_TEIF_VALIDATOR)', 'incertain'),
    ('facture_electronique', 'En-tête TEIF', 'identifiant_destinataire_message', 'Identifiant du destinataire du message', 'identifiant', 'oui', null::text, array['MessageRecieverIdentifier']::text[], '{}'::text[], null::text, null::text, 'spécification TTN (INCERTAIN)', 'incertain'),
    ('facture_electronique', 'En-tête TEIF', 'type_document_teif', 'Code du type de document (facture, avoir…)', 'liste', 'oui', null::text, array['DocumentType']::text[], '{}'::text[], null::text, null::text, 'spécification TTN, chemin /TEIF/InvoiceBody/Bgm/DocumentType/@code (valeurs INCERTAIN)', 'incertain'),
    ('facture_electronique', 'En-tête TEIF', 'code_fonction_partenaire', 'Code de fonction de chaque partenaire (vendeur, acheteur…)', 'liste', 'oui', null::text, array['functionCode']::text[], '{}'::text[], null::text, null::text, 'spécification TTN, PartnerDetails/@functionCode obligatoire (valeurs INCERTAIN)', 'incertain'),
    ('facture_electronique', 'En-tête TEIF', 'format_date_teif', 'Format et code fonction des dates', 'texte', 'oui', null::text, array['DateText']::text[], '{}'::text[], null::text, null::text, 'spécification TTN (référentiel I-31 cité, INCERTAIN)', 'incertain'),
    ('facture_electronique', 'Taxes et montants TEIF', 'code_taxe_tva', 'Code de taxe TVA', 'liste', 'oui', null::text, array['I-1602']::text[], '{}'::text[], null::text, null::text, 'I-1602 « TVA » sous le référentiel I-16 selon S_TEIF_VALIDATOR (INCERTAIN)', 'incertain'),
    ('facture_electronique', 'Taxes et montants TEIF', 'code_taxe_timbre', 'Code de taxe droit de timbre', 'liste', 'selon_cas', 'facture soumise au timbre'::text, array['Droit de timbre']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN (code non cité par la source lue)', 'incertain'),
    ('facture_electronique', 'Taxes et montants TEIF', 'code_taxe_fodec', 'Code de taxe FODEC', 'liste', 'selon_cas', 'produits soumis'::text, array['FODEC']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('facture_electronique', 'Taxes et montants TEIF', 'code_retenue_source', 'Code retenue à la source', 'liste', 'non', null::text, array['I-1604']::text[], '{}'::text[], null::text, null::text, 'I-1604 selon S_TEIF_VALIDATOR, signalé absent du XSD (INCERTAIN)', 'incertain'),
    ('facture_electronique', 'Taxes et montants TEIF', 'montant_total_ht_teif', 'Montant total HT', 'montant', 'oui', null::text, array['I-176']::text[], '{}'::text[], null::text, null::text, 'I-176 selon S_TEIF_VALIDATOR (INCERTAIN)', 'incertain'),
    ('facture_electronique', 'Taxes et montants TEIF', 'base_taxe_teif', 'Base de taxe', 'montant', 'oui', null::text, array['I-177']::text[], '{}'::text[], null::text, null::text, 'I-177 selon S_TEIF_VALIDATOR (INCERTAIN)', 'incertain'),
    ('facture_electronique', 'Taxes et montants TEIF', 'montant_taxe_teif', 'Montant de taxe', 'montant', 'oui', null::text, array['I-178']::text[], '{}'::text[], null::text, null::text, 'I-178 selon S_TEIF_VALIDATOR (INCERTAIN)', 'incertain'),
    ('facture_electronique', 'Taxes et montants TEIF', 'montant_total_ttc_teif', 'Montant total TTC', 'montant', 'oui', null::text, array['I-180']::text[], '{}'::text[], null::text, null::text, 'I-180 selon S_TEIF_VALIDATOR (INCERTAIN)', 'incertain'),
    ('facture_electronique', 'Taxes et montants TEIF', 'moyen_paiement_teif', 'Moyen et conditions de paiement', 'liste', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'référentiels I-11 à I-13 / I-131 à I-137 selon S_TEIF_VALIDATOR (INCERTAIN)', 'incertain'),
    ('facture_electronique', 'Signature et enregistrement', 'signature_electronique_vendeur', 'Signature électronique du vendeur ou du prestataire', 'texte', 'oui', null::text, array['Signature électronique']::text[], '{}'::text[], null::text, null::text, 'Code TVA art. 18-II ter ; format XAdES-B selon S_TEIF_VALIDATOR (INCERTAIN)', 'incertain'),
    ('facture_electronique', 'Signature et enregistrement', 'certificat_signature', 'Certificat utilisé (personne physique ou cachet électronique de personne morale)', 'texte', 'oui', null::text, array['Certificat']::text[], '{}'::text[], null::text, null::text, 'KPMG Tunisie 02/2026 (Digigo, ID-Trust, Enterprise-ID cités) ; pratique', 'pratique'),
    ('facture_electronique', 'Signature et enregistrement', 'reference_unique_ttn', 'Référence unique délivrée par l''organisme autorisé (TTN)', 'identifiant', 'oui', null::text, array['Référence TTN', 'Réf. d''enregistrement']::text[], '{}'::text[], null::text, null::text, 'Code TVA art. 18-II ter', 'texte'),
    ('facture_electronique', 'Signature et enregistrement', 'signature_ttn', 'Signature ou cachet électronique de TTN après enregistrement', 'texte', 'selon_cas', 'selon la spécification TTN'::text, '{}'::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('facture_electronique', 'Signature et enregistrement', 'date_enregistrement_ttn', 'Date et heure d''enregistrement TTN', 'date', 'selon_cas', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('facture_electronique', 'Copie papier ou PDF', 'reference_enregistrement_copie', 'Référence d''enregistrement portée sur la copie papier', 'identifiant', 'selon_cas', 'si une copie papier est remise'::text, array['Référence TTN']::text[], '{}'::text[], null::text, null::text, 'Code TVA art. 18-II ter', 'texte'),
    ('facture_electronique', 'Copie papier ou PDF', 'signature_cachet_copie', 'Signature et cachet de l''émetteur sur la copie papier', 'booleen', 'selon_cas', 'si une copie papier est remise'::text, array['Cachet et signature']::text[], array['ختم', 'إمضاء']::text[], null::text, null::text, 'Code TVA art. 18-II ter', 'texte'),
    ('facture_electronique', 'Copie papier ou PDF', 'qr_code_visible', 'QR code (cachet électronique visible) sur la représentation', 'texte', 'selon_cas', 'selon spécification TTN'::text, array['QR code']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN (non relu dans un texte officiel ; S_NOQTA décrit un QR non concordant avec S_TEIF_VALIDATOR)', 'incertain')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('avoir', 'En-tête émetteur', 'matricule_fiscal_emetteur', 'Matricule fiscal de l''émetteur', 'identifiant', 'oui', null::text, array['MF', 'Matricule fiscal']::text[], array['المعرف الجبائي']::text[], 'matricule_fiscal'::text, null::text, 'par analogie Code TVA art. 18-II (INCERTAIN)', 'incertain'),
    ('avoir', 'En-tête émetteur', 'raison_sociale_emetteur', 'Raison sociale et adresse de l''émetteur', 'texte', 'non', null::text, array['Raison sociale']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avoir', 'Destinataire', 'nom_client', 'Identification du client', 'texte', 'oui', null::text, array['Client']::text[], array['الحريف']::text[], null::text, null::text, 'par analogie Code TVA art. 18-II (INCERTAIN)', 'incertain'),
    ('avoir', 'Destinataire', 'adresse_client', 'Adresse du client', 'adresse', 'oui', null::text, array['Adresse']::text[], array['العنوان']::text[], null::text, null::text, 'par analogie Code TVA art. 18-II (INCERTAIN)', 'incertain'),
    ('avoir', 'Destinataire', 'matricule_fiscal_client', 'Matricule fiscal du client', 'identifiant', 'selon_cas', 'client soumis à la déclaration d''existence'::text, array['MF client']::text[], '{}'::text[], 'matricule_fiscal'::text, null::text, 'par analogie Code TVA art. 18-II (INCERTAIN)', 'incertain'),
    ('avoir', 'Références', 'numero_avoir', 'Numéro de l''avoir', 'identifiant', 'oui', null::text, array['Avoir N°', 'Facture d''avoir N°']::text[], '{}'::text[], null::text, null::text, 'pratique ; série propre ou commune avec les factures : INCERTAIN', 'incertain'),
    ('avoir', 'Références', 'date_avoir', 'Date de l''avoir', 'date', 'oui', null::text, array['Date']::text[], array['التاريخ']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avoir', 'Références', 'intitule', 'Intitulé (Avoir, Facture d''avoir, Facture rectificative, Note de crédit)', 'liste', 'oui', null::text, array['AVOIR', 'FACTURE D''AVOIR', 'FACTURE RECTIFICATIVE', 'NOTE DE CRÉDIT']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avoir', 'Références', 'ref_facture_origine', 'Numéro et date de la facture d''origine', 'identifiant', 'oui', null::text, array['Réf. facture', 'Suivant facture N°', 'Annule et remplace']::text[], '{}'::text[], null::text, null::text, 'pratique indispensable à la régularisation de TVA (base légale INCERTAIN)', 'incertain'),
    ('avoir', 'Références', 'motif', 'Motif (retour, remise, ristourne, erreur de prix, annulation)', 'liste', 'non', null::text, array['Motif', 'Retour marchandise', 'Remise', 'Ristourne']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avoir', 'Références', 'ref_bon_retour', 'Référence du bon de retour', 'identifiant', 'non', null::text, array['Bon de retour N°']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avoir', 'Lignes', 'designation', 'Désignation des éléments crédités', 'texte', 'oui', null::text, array['Désignation']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avoir', 'Lignes', 'quantite', 'Quantité retournée ou corrigée', 'nombre', 'non', null::text, array['Qté']::text[], array['الكمية']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avoir', 'Lignes', 'montant_ligne_ht', 'Montant HT crédité', 'montant', 'oui', null::text, array['Montant HT']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avoir', 'Lignes', 'taux_tva_ligne', 'Taux de TVA (celui de la facture d''origine)', 'taux', 'oui', null::text, array['TVA %']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avoir', 'Totaux et taxes', 'total_ht', 'Total HT de l''avoir', 'montant', 'oui', null::text, array['Total HT']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avoir', 'Totaux et taxes', 'montant_tva', 'TVA à régulariser', 'montant', 'oui', null::text, array['TVA']::text[], array['الأداء على القيمة المضافة']::text[], null::text, null::text, 'pratique (base légale de la régularisation INCERTAIN)', 'incertain'),
    ('avoir', 'Totaux et taxes', 'montant_fodec', 'FODEC régularisé', 'montant', 'selon_cas', 'si la facture d''origine en portait'::text, array['FODEC']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('avoir', 'Totaux et taxes', 'droit_timbre', 'Droit de timbre', 'montant', 'selon_cas', 'traitement du timbre sur un avoir INCERTAIN'::text, array['Timbre']::text[], array['معلوم الطابع']::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('avoir', 'Totaux et taxes', 'total_ttc', 'Total TTC de l''avoir', 'montant', 'non', null::text, array['Total TTC', 'Net à déduire']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avoir', 'Code structuré et signature', 'reference_ttn', 'Référence TTN si avoir électronique', 'identifiant', 'selon_cas', 'émetteur soumis à la facturation électronique'::text, array['Référence TTN']::text[], '{}'::text[], null::text, null::text, 'Code TVA art. 18-II ter par extension (INCERTAIN)', 'incertain'),
    ('avoir', 'Code structuré et signature', 'cachet_signature', 'Cachet et signature', 'booleen', 'non', null::text, array['Cachet']::text[], array['ختم']::text[], null::text, null::text, 'pratique', 'pratique')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('devis_proforma', 'En-tête émetteur', 'raison_sociale_emetteur', 'Raison sociale et adresse du fournisseur', 'texte', 'non', null::text, array['Raison sociale']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('devis_proforma', 'En-tête émetteur', 'matricule_fiscal_emetteur', 'Matricule fiscal du fournisseur', 'identifiant', 'non', null::text, array['MF']::text[], array['المعرف الجبائي']::text[], 'matricule_fiscal'::text, null::text, 'pratique', 'pratique'),
    ('devis_proforma', 'Destinataire', 'nom_client', 'Nom du prospect ou client', 'texte', 'non', null::text, array['Client', 'À l''attention de']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('devis_proforma', 'Destinataire', 'adresse_client', 'Adresse', 'adresse', 'non', null::text, array['Adresse']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('devis_proforma', 'Références', 'intitule', 'Intitulé (Devis, Offre de prix, Facture proforma)', 'liste', 'non', null::text, array['DEVIS', 'OFFRE DE PRIX', 'FACTURE PROFORMA', 'PRO FORMA']::text[], '{}'::text[], null::text, null::text, 'pratique ; la mention « proforma » distingue le document d''une facture', 'pratique'),
    ('devis_proforma', 'Références', 'numero_devis', 'Numéro du devis ou de la proforma', 'identifiant', 'non', null::text, array['Devis N°', 'Proforma N°']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('devis_proforma', 'Références', 'date_devis', 'Date', 'date', 'non', null::text, array['Date']::text[], array['التاريخ']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('devis_proforma', 'Références', 'duree_validite', 'Durée ou date limite de validité', 'periode', 'non', null::text, array['Validité', 'Offre valable']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('devis_proforma', 'Références', 'ref_appel_offres', 'Référence de la consultation ou de l''appel d''offres', 'identifiant', 'non', null::text, array['Consultation N°', 'AO N°']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('devis_proforma', 'Lignes et totaux', 'designation', 'Désignation', 'texte', 'non', null::text, array['Désignation']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('devis_proforma', 'Lignes et totaux', 'quantite', 'Quantité', 'nombre', 'non', null::text, array['Qté']::text[], array['الكمية']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('devis_proforma', 'Lignes et totaux', 'prix_unitaire_ht', 'Prix unitaire HT', 'montant', 'non', null::text, array['P.U. HT']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('devis_proforma', 'Lignes et totaux', 'total_ht', 'Total HT', 'montant', 'non', null::text, array['Total HT']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('devis_proforma', 'Lignes et totaux', 'montant_tva', 'TVA estimée', 'montant', 'non', null::text, array['TVA']::text[], '{}'::text[], null::text, null::text, 'pratique (ce document ne rend pas la TVA exigible)', 'pratique'),
    ('devis_proforma', 'Lignes et totaux', 'total_ttc', 'Total TTC', 'montant', 'non', null::text, array['Total TTC']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('devis_proforma', 'Lignes et totaux', 'devise_incoterm', 'Devise et Incoterm (proforma import/export)', 'texte', 'non', null::text, array['FOB', 'CIF', 'EXW', 'Devise']::text[], '{}'::text[], null::text, null::text, 'pratique du commerce international', 'pratique'),
    ('devis_proforma', 'Conditions et acceptation', 'delai_livraison', 'Délai de livraison ou d''exécution', 'periode', 'non', null::text, array['Délai de livraison']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('devis_proforma', 'Conditions et acceptation', 'conditions_paiement', 'Conditions de paiement, acompte demandé', 'texte', 'non', null::text, array['Conditions de paiement', 'Acompte']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('devis_proforma', 'Conditions et acceptation', 'bon_pour_accord', 'Acceptation du client (bon pour accord, signature, date)', 'booleen', 'non', null::text, array['Bon pour accord', 'Lu et approuvé']::text[], '{}'::text[], null::text, null::text, 'pratique ; vaut alors engagement contractuel', 'pratique'),
    ('devis_proforma', 'Conditions et acceptation', 'cachet_signature_emetteur', 'Cachet et signature du fournisseur', 'booleen', 'non', null::text, array['Cachet']::text[], array['ختم']::text[], null::text, null::text, 'pratique', 'pratique')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('bon_commande', 'En-tête acheteur', 'raison_sociale_acheteur', 'Raison sociale et adresse de l''acheteur', 'texte', 'non', null::text, array['Raison sociale']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bon_commande', 'En-tête acheteur', 'matricule_fiscal_acheteur', 'Matricule fiscal de l''acheteur', 'identifiant', 'non', null::text, array['MF']::text[], array['المعرف الجبائي']::text[], 'matricule_fiscal'::text, null::text, 'pratique', 'pratique'),
    ('bon_commande', 'En-tête acheteur', 'service_demandeur', 'Service ou centre de coût demandeur', 'texte', 'non', null::text, array['Service', 'Demandeur']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bon_commande', 'Fournisseur', 'nom_fournisseur', 'Nom du fournisseur', 'texte', 'non', null::text, array['Fournisseur']::text[], array['المزود']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bon_commande', 'Fournisseur', 'matricule_fiscal_fournisseur', 'Matricule fiscal du fournisseur', 'identifiant', 'non', null::text, array['MF fournisseur']::text[], '{}'::text[], 'matricule_fiscal'::text, null::text, 'pratique', 'pratique'),
    ('bon_commande', 'Références', 'numero_commande', 'Numéro du bon de commande', 'identifiant', 'non', null::text, array['BC N°', 'Commande N°', 'PO']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bon_commande', 'Références', 'date_commande', 'Date de commande', 'date', 'non', null::text, array['Date']::text[], array['التاريخ']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bon_commande', 'Références', 'ref_devis', 'Référence du devis fournisseur', 'identifiant', 'non', null::text, array['Votre devis N°']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bon_commande', 'Références', 'visa_suspension_tva', 'Visa de l''administration fiscale (achat en suspension de TVA)', 'booleen', 'selon_cas', 'achat en suspension de TVA par un bénéficiaire autorisé'::text, array['Bon de commande visé', 'Visa']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN (art. 11 Code TVA et textes d''application non lus en détail)', 'incertain'),
    ('bon_commande', 'Lignes et totaux', 'designation', 'Désignation', 'texte', 'non', null::text, array['Désignation']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bon_commande', 'Lignes et totaux', 'reference_article', 'Référence article', 'identifiant', 'non', null::text, array['Réf']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bon_commande', 'Lignes et totaux', 'quantite_commandee', 'Quantité commandée', 'nombre', 'non', null::text, array['Qté']::text[], array['الكمية']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bon_commande', 'Lignes et totaux', 'prix_unitaire_ht', 'Prix unitaire convenu', 'montant', 'non', null::text, array['P.U.']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bon_commande', 'Lignes et totaux', 'total_ht', 'Montant total HT', 'montant', 'non', null::text, array['Total HT']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bon_commande', 'Conditions et validation', 'date_livraison_souhaitee', 'Date ou délai de livraison', 'date', 'non', null::text, array['Livraison le', 'Délai']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bon_commande', 'Conditions et validation', 'lieu_livraison', 'Lieu de livraison', 'adresse', 'non', null::text, array['Lieu de livraison']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bon_commande', 'Conditions et validation', 'conditions_paiement', 'Conditions de paiement', 'texte', 'non', null::text, array['Paiement']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bon_commande', 'Conditions et validation', 'signature_approbateur', 'Signature et cachet de l''acheteur, nom de l''approbateur', 'booleen', 'non', null::text, array['Approuvé par', 'Cachet']::text[], array['ختم', 'إمضاء']::text[], null::text, null::text, 'pratique de contrôle interne', 'pratique')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('bon_livraison', 'Expéditeur', 'nom_expediteur', 'Nom de l''expéditeur', 'texte', 'oui', null::text, array['Expéditeur', 'Fournisseur']::text[], array['المزود']::text[], null::text, null::text, 'Code TVA art. 18-III', 'texte'),
    ('bon_livraison', 'Expéditeur', 'adresse_expediteur', 'Adresse de l''expéditeur', 'adresse', 'oui', null::text, array['Adresse']::text[], array['العنوان']::text[], null::text, null::text, 'Code TVA art. 18-III', 'texte'),
    ('bon_livraison', 'Expéditeur', 'matricule_fiscal_expediteur', 'Matricule fiscal de l''expéditeur', 'identifiant', 'selon_cas', '« toutes les dispositions relatives à la facture » s''appliquent au BL : portée exacte INCERTAIN'::text, array['MF']::text[], array['المعرف الجبائي']::text[], 'matricule_fiscal'::text, null::text, 'Code TVA art. 18-III renvoyant à 18-II', 'texte'),
    ('bon_livraison', 'Destinataire', 'nom_destinataire', 'Nom du destinataire', 'texte', 'oui', null::text, array['Destinataire', 'Client', 'Livré à']::text[], array['الحريف']::text[], null::text, null::text, 'Code TVA art. 18-III', 'texte'),
    ('bon_livraison', 'Destinataire', 'adresse_destinataire', 'Adresse du destinataire', 'adresse', 'oui', null::text, array['Adresse de livraison']::text[], array['العنوان']::text[], null::text, null::text, 'Code TVA art. 18-III', 'texte'),
    ('bon_livraison', 'Destinataire', 'matricule_fiscal_destinataire', 'Matricule fiscal du destinataire', 'identifiant', 'selon_cas', 'par renvoi aux règles de la facture (INCERTAIN)'::text, array['MF client']::text[], '{}'::text[], 'matricule_fiscal'::text, null::text, 'Code TVA art. 18-III', 'texte'),
    ('bon_livraison', 'Références', 'numero_bl', 'Numéro du bon de livraison', 'identifiant', 'selon_cas', 'série ininterrompue par renvoi aux règles de la facture (portée INCERTAIN)'::text, array['BL N°', 'Bon de livraison N°']::text[], '{}'::text[], null::text, null::text, 'Code TVA art. 18-III', 'texte'),
    ('bon_livraison', 'Références', 'date_bl', 'Date du bon de livraison', 'date', 'oui', null::text, array['Date']::text[], array['التاريخ']::text[], null::text, null::text, 'Code TVA art. 18-III (« daté »)', 'texte'),
    ('bon_livraison', 'Références', 'ref_commande', 'Référence du bon de commande', 'identifiant', 'non', null::text, array['BC N°', 'Votre commande']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bon_livraison', 'Références', 'ref_facture', 'Référence de la facture (si déjà émise)', 'identifiant', 'non', null::text, array['Facture N°']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bon_livraison', 'Références', 'ref_facture_electronique_transport', 'Référence de la facture électronique accompagnant le transport', 'identifiant', 'selon_cas', 'émetteur soumis à la facturation électronique (sanction transport sans copie e-facture depuis 01/07/2025 selon KPMG US)'::text, array['Référence TTN']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN (Note 10/2025 non lue)', 'incertain'),
    ('bon_livraison', 'Lignes', 'designation', 'Désignation (nature) des marchandises', 'texte', 'oui', null::text, array['Désignation']::text[], '{}'::text[], null::text, null::text, 'Code TVA art. 18-III par renvoi ; explicite pour le bon de sortie', 'texte'),
    ('bon_livraison', 'Lignes', 'quantite_livree', 'Quantité livrée', 'nombre', 'selon_cas', 'explicite pour le bon de sortie ; pour le BL par renvoi (INCERTAIN)'::text, array['Qté', 'Quantité livrée']::text[], array['الكمية']::text[], null::text, null::text, 'Code TVA art. 18-III', 'texte'),
    ('bon_livraison', 'Lignes', 'unite', 'Unité, colisage, poids', 'texte', 'non', null::text, array['Colis', 'Poids', 'Unité']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bon_livraison', 'Lignes', 'prix_ht', 'Prix HT (BL valorisé)', 'montant', 'selon_cas', 'BL tenant lieu de facture pour le transport : renvoi aux mentions de la facture (INCERTAIN)'::text, array['P.U.', 'Montant']::text[], '{}'::text[], null::text, null::text, 'Code TVA art. 18-III', 'texte'),
    ('bon_livraison', 'Lignes', 'numero_lot_serie', 'Numéro de lot ou de série', 'identifiant', 'non', null::text, array['Lot', 'N° série']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bon_livraison', 'Transport', 'immatriculation_vehicule', 'Numéro d''immatriculation du véhicule', 'identifiant', 'selon_cas', 'obligatoire sur le bon de sortie (colportage) ; pratique sur le BL'::text, array['Véhicule', 'Immatriculation', 'Matricule véhicule']::text[], '{}'::text[], null::text, null::text, 'Code TVA art. 18-III', 'texte'),
    ('bon_livraison', 'Transport', 'transporteur_chauffeur', 'Transporteur ou chauffeur', 'texte', 'non', null::text, array['Transporteur', 'Chauffeur']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bon_livraison', 'Signature et cachet', 'signature_livreur', 'Signature du livreur', 'booleen', 'non', null::text, array['Livreur']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bon_livraison', 'Signature et cachet', 'signature_cachet_receptionnaire', 'Signature, cachet et date de réception par le client (réserves éventuelles)', 'booleen', 'non', null::text, array['Reçu conforme', 'Réserves', 'Cachet client']::text[], array['ختم', 'إمضاء']::text[], null::text, null::text, 'pratique ; preuve de livraison', 'pratique')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('bon_reception', 'En-tête', 'numero_br', 'Numéro du bon de réception', 'identifiant', 'non', null::text, array['BR N°', 'Bon de réception N°']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bon_reception', 'En-tête', 'date_reception', 'Date de réception', 'date', 'non', null::text, array['Date', 'Reçu le']::text[], array['التاريخ']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bon_reception', 'En-tête', 'magasin_depot', 'Magasin ou dépôt de réception', 'texte', 'non', null::text, array['Magasin', 'Dépôt']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bon_reception', 'Fournisseur et références', 'nom_fournisseur', 'Fournisseur', 'texte', 'non', null::text, array['Fournisseur']::text[], array['المزود']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bon_reception', 'Fournisseur et références', 'ref_bl_fournisseur', 'Numéro du BL fournisseur', 'identifiant', 'non', null::text, array['BL fournisseur N°']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bon_reception', 'Fournisseur et références', 'ref_commande', 'Numéro du bon de commande', 'identifiant', 'non', null::text, array['BC N°']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bon_reception', 'Lignes', 'designation', 'Désignation', 'texte', 'non', null::text, array['Désignation']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bon_reception', 'Lignes', 'quantite_recue', 'Quantité reçue', 'nombre', 'non', null::text, array['Qté reçue']::text[], array['الكمية']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bon_reception', 'Lignes', 'quantite_acceptee_refusee', 'Quantité acceptée / refusée et motif', 'nombre', 'non', null::text, array['Accepté', 'Refusé', 'Non conforme']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bon_reception', 'Lignes', 'etat_reserves', 'État, réserves, contrôle qualité', 'texte', 'non', null::text, array['Observations', 'Réserves']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bon_reception', 'Signature', 'signature_magasinier', 'Nom et signature du réceptionnaire', 'booleen', 'non', null::text, array['Magasinier', 'Réceptionné par']::text[], array['إمضاء']::text[], null::text, null::text, 'pratique', 'pratique')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('ticket_caisse', 'En-tête émetteur', 'enseigne', 'Enseigne et raison sociale', 'texte', 'non', null::text, array['Enseigne']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('ticket_caisse', 'En-tête émetteur', 'adresse_magasin', 'Adresse du point de vente', 'adresse', 'non', null::text, array['Adresse']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('ticket_caisse', 'En-tête émetteur', 'matricule_fiscal_emetteur', 'Matricule fiscal', 'identifiant', 'non', null::text, array['MF', 'Code TVA']::text[], array['المعرف الجبائي']::text[], 'matricule_fiscal'::text, null::text, 'pratique', 'pratique'),
    ('ticket_caisse', 'Références', 'numero_ticket', 'Numéro du ticket', 'identifiant', 'non', null::text, array['Ticket N°', 'N°']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('ticket_caisse', 'Références', 'date_heure', 'Date et heure', 'date', 'non', null::text, array['Date', 'Heure']::text[], array['التاريخ']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('ticket_caisse', 'Références', 'caisse_caissier', 'Numéro de caisse et caissier', 'texte', 'non', null::text, array['Caisse', 'Caissier']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('ticket_caisse', 'Lignes et totaux', 'designation', 'Article', 'texte', 'non', null::text, array['Article']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('ticket_caisse', 'Lignes et totaux', 'quantite', 'Quantité', 'nombre', 'non', null::text, array['Qté']::text[], array['الكمية']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('ticket_caisse', 'Lignes et totaux', 'prix_ttc_ligne', 'Prix TTC de la ligne', 'montant', 'non', null::text, array['Prix', 'Montant']::text[], array['السعر']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('ticket_caisse', 'Lignes et totaux', 'total_ttc', 'Total TTC', 'montant', 'non', null::text, array['TOTAL', 'Total TTC', 'À payer']::text[], array['المبلغ الجملي']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('ticket_caisse', 'Lignes et totaux', 'ventilation_tva', 'Ventilation de la TVA par taux', 'montant', 'non', null::text, array['Dont TVA', 'TVA']::text[], '{}'::text[], null::text, null::text, 'pratique (TVA non déductible sur simple ticket, faute de facture conforme)', 'pratique'),
    ('ticket_caisse', 'Lignes et totaux', 'droit_timbre', 'Droit de timbre', 'montant', 'selon_cas', 'grandes surfaces : timbre sur factures de plus de 50 DT depuis 2026 (application aux tickets INCERTAIN)'::text, array['Timbre']::text[], array['معلوم الطابع']::text[], null::text, null::text, 'LF 2026 via KPMG ; INCERTAIN', 'incertain'),
    ('ticket_caisse', 'Règlement', 'mode_reglement', 'Mode de paiement (espèces, carte, chèque)', 'liste', 'non', null::text, array['Espèces', 'Carte', 'CB', 'Rendu']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('ticket_caisse', 'Règlement', 'montant_recu_rendu', 'Montant reçu et monnaie rendue', 'montant', 'non', null::text, array['Reçu', 'Rendu']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('ticket_caisse', 'Règlement', 'ref_transaction_carte', 'Référence de la transaction carte (4 derniers chiffres seulement)', 'identifiant', 'non', null::text, array['Autorisation', 'TPE']::text[], '{}'::text[], null::text, null::text, 'pratique ; ne jamais stocker un numéro de carte complet', 'pratique')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('recu_quittance', 'Créancier (bailleur)', 'nom_creancier', 'Nom du créancier ou bailleur', 'texte', 'non', null::text, array['Reçu de', 'Bailleur', 'Propriétaire']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('recu_quittance', 'Créancier (bailleur)', 'matricule_fiscal_creancier', 'Matricule fiscal du bailleur (si professionnel)', 'identifiant', 'selon_cas', 'bailleur assujetti (location soumise à TVA) : facture alors exigée'::text, array['MF']::text[], array['المعرف الجبائي']::text[], 'matricule_fiscal'::text, null::text, 'Code TVA art. 18-II si la location est une opération imposable ; sinon pratique', 'pratique'),
    ('recu_quittance', 'Créancier (bailleur)', 'identifiant_bailleur_personne_physique', 'Identifiant du bailleur personne physique (CIN masquée)', 'identifiant', 'non', null::text, array['CIN']::text[], '{}'::text[], null::text, null::text, 'pratique ; donnée personnelle sensible, ne stocker que masquée ou chiffrée', 'pratique'),
    ('recu_quittance', 'Débiteur (locataire)', 'nom_debiteur', 'Nom du payeur ou locataire', 'texte', 'non', null::text, array['Reçu de M.', 'Locataire']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('recu_quittance', 'Débiteur (locataire)', 'matricule_fiscal_debiteur', 'Matricule fiscal du locataire', 'identifiant', 'non', null::text, array['MF']::text[], '{}'::text[], 'matricule_fiscal'::text, null::text, 'pratique', 'pratique'),
    ('recu_quittance', 'Objet et références', 'intitule', 'Intitulé (Reçu, Quittance, Quittance de loyer)', 'liste', 'non', null::text, array['REÇU', 'QUITTANCE', 'QUITTANCE DE LOYER']::text[], array['وصل']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('recu_quittance', 'Objet et références', 'numero_recu', 'Numéro du reçu (carnet à souches)', 'identifiant', 'non', null::text, array['N°']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('recu_quittance', 'Objet et références', 'date_paiement', 'Date du paiement', 'date', 'non', null::text, array['Date', 'Le']::text[], array['التاريخ']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('recu_quittance', 'Objet et références', 'objet_paiement', 'Objet du paiement', 'texte', 'non', null::text, array['Pour', 'En règlement de']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('recu_quittance', 'Objet et références', 'adresse_bien_loue', 'Adresse du local loué', 'adresse', 'non', 'quittance de loyer'::text, array['Local sis', 'Adresse des lieux']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('recu_quittance', 'Objet et références', 'periode_loyer', 'Période couverte', 'periode', 'non', 'quittance de loyer'::text, array['Loyer du mois de', 'Période']::text[], array['كراء']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('recu_quittance', 'Objet et références', 'ref_contrat_bail', 'Référence du contrat de bail', 'identifiant', 'non', null::text, array['Contrat du', 'Bail']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('recu_quittance', 'Objet et références', 'ref_facture_reglee', 'Facture(s) réglée(s)', 'identifiant', 'non', 'reçu de règlement de facture'::text, array['Facture N°']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('recu_quittance', 'Montants', 'montant_loyer_principal', 'Loyer principal', 'montant', 'non', 'quittance de loyer'::text, array['Loyer']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('recu_quittance', 'Montants', 'charges', 'Charges locatives', 'montant', 'non', null::text, array['Charges', 'Syndic']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('recu_quittance', 'Montants', 'tva_loyer', 'TVA sur loyer', 'montant', 'selon_cas', 'location soumise à TVA (champ exact INCERTAIN)'::text, array['TVA']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('recu_quittance', 'Montants', 'retenue_source_loyer', 'Retenue à la source sur loyer', 'montant', 'selon_cas', 'locataire tenu de retenir (taux INCERTAIN)'::text, array['Retenue à la source', 'RS']::text[], array['الخصم من المورد']::text[], null::text, null::text, 'Code IRPP/IS art. 52 : INCERTAIN', 'incertain'),
    ('recu_quittance', 'Montants', 'montant_recu', 'Montant reçu (chiffres et lettres)', 'montant', 'non', null::text, array['La somme de', 'Montant']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('recu_quittance', 'Montants', 'mode_reglement', 'Mode de paiement (espèces, chèque n°, virement)', 'liste', 'non', null::text, array['Espèces', 'Chèque N°', 'Virement']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('recu_quittance', 'Montants', 'droit_timbre', 'Timbre sur quittance', 'montant', 'selon_cas', 'INCERTAIN'::text, array['Timbre']::text[], array['معلوم الطابع']::text[], null::text, null::text, 'Code des droits d''enregistrement et de timbre : INCERTAIN', 'incertain'),
    ('recu_quittance', 'Signature', 'signature_creancier', 'Signature du créancier (et cachet si professionnel)', 'booleen', 'non', null::text, array['Signature', 'Pour acquit']::text[], array['إمضاء']::text[], null::text, null::text, 'pratique ; la signature fait la valeur probante de la quittance', 'pratique')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('note_frais', 'Bénéficiaire', 'nom_salarie', 'Nom du salarié', 'texte', 'non', null::text, array['Nom', 'Collaborateur']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('note_frais', 'Bénéficiaire', 'matricule_salarie', 'Matricule interne, service', 'identifiant', 'non', null::text, array['Matricule', 'Service']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('note_frais', 'Références', 'periode_ou_mission', 'Période ou mission', 'periode', 'non', null::text, array['Mission', 'Période', 'Déplacement à']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('note_frais', 'Références', 'date_note', 'Date de la note', 'date', 'non', null::text, array['Date']::text[], array['التاريخ']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('note_frais', 'Références', 'objet_professionnel', 'Objet professionnel de la dépense', 'texte', 'non', null::text, array['Objet', 'Motif']::text[], '{}'::text[], null::text, null::text, 'pratique ; justifie l''intérêt de l''entreprise', 'pratique'),
    ('note_frais', 'Lignes de dépense', 'date_depense', 'Date de la dépense', 'date', 'non', null::text, array['Date']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('note_frais', 'Lignes de dépense', 'categorie_depense', 'Catégorie (transport, hébergement, repas, carburant, péage, divers)', 'liste', 'non', null::text, array['Transport', 'Hôtel', 'Repas', 'Carburant']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('note_frais', 'Lignes de dépense', 'montant_ttc_ligne', 'Montant TTC', 'montant', 'non', null::text, array['Montant']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('note_frais', 'Lignes de dépense', 'tva_recuperable_ligne', 'TVA récupérable (si facture conforme jointe)', 'montant', 'non', null::text, array['TVA']::text[], '{}'::text[], null::text, null::text, 'Code TVA art. 9-I-2 a (facture conforme requise) ; exclusions éventuelles INCERTAIN', 'incertain'),
    ('note_frais', 'Lignes de dépense', 'kilometrage', 'Kilomètres parcourus et barème', 'nombre', 'non', 'véhicule personnel'::text, array['Km', 'Indemnité kilométrique']::text[], '{}'::text[], null::text, null::text, 'pratique ; barème INCERTAIN', 'incertain'),
    ('note_frais', 'Lignes de dépense', 'justificatif_joint', 'Justificatif joint (facture, ticket, reçu)', 'booleen', 'non', null::text, array['Justificatif', 'PJ']::text[], '{}'::text[], null::text, null::text, 'pratique ; preuve de la charge', 'pratique'),
    ('note_frais', 'Lignes de dépense', 'devise_taux_change', 'Devise et taux de change (mission à l''étranger)', 'taux', 'non', null::text, array['Devise', 'Taux']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('note_frais', 'Totaux et règlement', 'total_frais', 'Total des frais', 'montant', 'non', null::text, array['Total']::text[], array['المبلغ الجملي']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('note_frais', 'Totaux et règlement', 'avance_recue', 'Avance déjà perçue', 'montant', 'non', null::text, array['Avance']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('note_frais', 'Totaux et règlement', 'net_a_rembourser', 'Net à rembourser', 'montant', 'non', null::text, array['À rembourser', 'Solde']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('note_frais', 'Signatures', 'signature_salarie', 'Signature du salarié', 'booleen', 'non', null::text, array['Signature']::text[], array['إمضاء']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('note_frais', 'Signatures', 'visa_responsable', 'Visa du responsable hiérarchique', 'booleen', 'non', null::text, array['Approuvé par', 'Visa']::text[], '{}'::text[], null::text, null::text, 'pratique de contrôle interne', 'pratique')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('facture_service_public', 'En-tête émetteur', 'nom_operateur', 'Opérateur (STEG, SONEDE, TT, Ooredoo, Orange…)', 'liste', 'oui', null::text, array['STEG', 'SONEDE', 'Tunisie Telecom', 'Ooredoo', 'Orange']::text[], '{}'::text[], null::text, null::text, 'pratique (identification du fournisseur)', 'pratique'),
    ('facture_service_public', 'En-tête émetteur', 'matricule_fiscal_operateur', 'Matricule fiscal de l''opérateur', 'identifiant', 'oui', null::text, array['MF', 'Matricule fiscal']::text[], array['المعرف الجبائي']::text[], 'matricule_fiscal'::text, null::text, 'Code TVA art. 18-II', 'texte'),
    ('facture_service_public', 'En-tête émetteur', 'agence_district', 'District ou agence de rattachement', 'texte', 'non', null::text, array['District', 'Agence']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('facture_service_public', 'Abonné', 'nom_abonne', 'Nom de l''abonné', 'texte', 'oui', null::text, array['Abonné', 'Client']::text[], '{}'::text[], null::text, null::text, 'Code TVA art. 18-II (identification du client)', 'texte'),
    ('facture_service_public', 'Abonné', 'adresse_abonne', 'Adresse du point de consommation / de facturation', 'adresse', 'oui', null::text, array['Adresse']::text[], array['العنوان']::text[], null::text, null::text, 'Code TVA art. 18-II', 'texte'),
    ('facture_service_public', 'Abonné', 'matricule_fiscal_abonne', 'Matricule fiscal de l''abonné', 'identifiant', 'selon_cas', 'abonné soumis à la déclaration d''existence ; souvent absent en pratique (abonnement au nom d''une personne physique) : déduction de TVA à risque'::text, array['MF']::text[], '{}'::text[], 'matricule_fiscal'::text, null::text, 'Code TVA art. 18-II', 'texte'),
    ('facture_service_public', 'Abonné', 'reference_contrat', 'Référence client / numéro de contrat / police', 'identifiant', 'non', null::text, array['Référence', 'Réf. client', 'N° police', 'N° contrat']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('facture_service_public', 'Abonné', 'numero_compteur_ligne', 'Numéro de compteur ou de ligne', 'identifiant', 'non', null::text, array['Compteur', 'N° ligne', 'N° d''appel']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('facture_service_public', 'Abonné', 'tarif_puissance', 'Tarif, puissance souscrite, catégorie d''usage', 'texte', 'non', null::text, array['Tarif', 'Puissance', 'Usage']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('facture_service_public', 'Références', 'numero_facture', 'Numéro de facture', 'identifiant', 'oui', null::text, array['Facture N°']::text[], array['رقم الفاتورة']::text[], null::text, null::text, 'Code TVA art. 18-III', 'texte'),
    ('facture_service_public', 'Références', 'date_facture', 'Date de facture', 'date', 'oui', null::text, array['Date']::text[], array['التاريخ']::text[], null::text, null::text, 'Code TVA art. 18-II', 'texte'),
    ('facture_service_public', 'Références', 'periode_facturee', 'Période de consommation', 'periode', 'non', null::text, array['Période', 'Du ... au ...']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('facture_service_public', 'Références', 'type_releve', 'Relevé réel ou estimé', 'liste', 'non', null::text, array['Relevé', 'Estimation']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('facture_service_public', 'Consommation', 'index_ancien_nouveau', 'Index ancien et nouveau', 'nombre', 'non', 'électricité, gaz, eau'::text, array['Ancien index', 'Nouvel index']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('facture_service_public', 'Consommation', 'quantite_consommee', 'Consommation (kWh, m³, minutes, data)', 'nombre', 'non', null::text, array['Consommation', 'kWh', 'm3']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('facture_service_public', 'Consommation', 'tranches_tarifaires', 'Détail par tranche tarifaire', 'montant', 'non', null::text, array['Tranche']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('facture_service_public', 'Consommation', 'redevances_fixes', 'Redevances fixes, location compteur, abonnement', 'montant', 'non', null::text, array['Redevance', 'Abonnement', 'Location compteur']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('facture_service_public', 'Taxes et totaux', 'total_ht', 'Montant hors taxes', 'montant', 'oui', null::text, array['Montant HT', 'Total HT']::text[], '{}'::text[], null::text, null::text, 'Code TVA art. 18-II', 'texte'),
    ('facture_service_public', 'Taxes et totaux', 'montant_tva', 'TVA (taux et montant)', 'montant', 'oui', null::text, array['TVA']::text[], array['الأداء على القيمة المضافة']::text[], null::text, null::text, 'Code TVA art. 18-II', 'texte'),
    ('facture_service_public', 'Taxes et totaux', 'taxes_specifiques', 'Autres taxes et contributions (contributions, taxes au profit des collectivités ou fonds)', 'montant', 'selon_cas', 'nature et taux INCERTAIN'::text, array['Contribution', 'Taxe', 'Redevance']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('facture_service_public', 'Taxes et totaux', 'droit_timbre', 'Droit de timbre', 'montant', 'selon_cas', 'INCERTAIN'::text, array['Timbre']::text[], array['معلوم الطابع']::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('facture_service_public', 'Taxes et totaux', 'arrieres_regularisations', 'Arriérés, régularisations, avances sur consommation', 'montant', 'non', null::text, array['Arriéré', 'Régularisation', 'Report']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('facture_service_public', 'Taxes et totaux', 'montant_a_payer', 'Montant total à payer', 'montant', 'non', null::text, array['Net à payer', 'Montant à payer', 'Total à payer']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('facture_service_public', 'Règlement', 'date_limite_paiement', 'Date limite de paiement', 'date', 'non', null::text, array['Date limite', 'À payer avant le']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('facture_service_public', 'Règlement', 'reference_paiement', 'Référence de paiement (e-dinar, paiement en ligne, poste, code-barres)', 'identifiant', 'non', null::text, array['Code paiement', 'Référence de paiement']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('facture_service_public', 'Règlement', 'code_barres', 'Code-barres ou QR de paiement', 'texte', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('bilan', 'entete', 'raison_sociale', 'Dénomination de l''entreprise', 'texte', 'oui', null::text, array['Société', 'Raison sociale', 'Dénomination']::text[], '{}'::text[], null::text, null::text, 'pratique (identification indispensable ; mention précise dans NC 01 INCERTAIN)', 'incertain'),
    ('bilan', 'entete', 'matricule_fiscal', 'Identifiant unique / matricule fiscal', 'identifiant', 'selon_cas', 'souvent en en-tête ou sur la liasse de dépôt fiscal'::text, array['Matricule fiscal', 'MF', 'Identifiant unique']::text[], array['المعرف الجبائي']::text[], 'matricule_fiscal'::text, null::text, 'pratique', 'pratique'),
    ('bilan', 'entete', 'titre_etat', 'Titre de l''état', 'texte', 'oui', null::text, array['Bilan', 'Bilan arrêté au']::text[], array['الموازنة']::text[], null::text, null::text, 'Loi 96-112 art. 18', 'texte'),
    ('bilan', 'entete', 'date_cloture', 'Date d''arrêté du bilan', 'date', 'oui', null::text, array['Arrêté au', 'Au 31 décembre', 'Exercice clos le']::text[], '{}'::text[], null::text, null::text, 'Loi 96-112 art. 20 et 22', 'texte'),
    ('bilan', 'entete', 'colonne_exercice_n', 'Montants de l''exercice N', 'montant', 'oui', null::text, array['N', 'Exercice', '31/12/N']::text[], '{}'::text[], null::text, null::text, 'Loi 96-112 art. 18', 'texte'),
    ('bilan', 'entete', 'colonne_exercice_n_1', 'Montants comparatifs de l''exercice N−1', 'montant', 'oui', 'sauf premier exercice'::text, array['N-1', 'Exercice précédent', '31/12/N-1']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN (obligation de comparatif posée par NC 01 — à vérifier ; constante dans la pratique)', 'incertain'),
    ('bilan', 'entete', 'monnaie', 'Monnaie de présentation', 'liste', 'oui', 'dinar tunisien sauf exceptions de l''art. 3'::text, array['En dinars', 'DT', 'TND']::text[], array['بالدينار']::text[], null::text, null::text, 'Loi 96-112 art. 23', 'texte'),
    ('bilan', 'entete', 'unite_presentation', 'Unité (dinar, millier de dinars)', 'liste', 'selon_cas', 'si arrondi'::text, array['En dinars', 'En milliers de dinars', 'mDT', 'KDT']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bilan', 'entete', 'colonne_notes', 'Renvoi au numéro de note', 'identifiant', 'selon_cas', 'pratique générale'::text, array['Notes', 'Note n°', 'Réf.']::text[], '{}'::text[], null::text, null::text, 'pratique (EF CNT 2024, Air Liquide 2020)', 'pratique'),
    ('bilan', 'actifs_non_courants', 'immob_incorporelles_brut', 'Immobilisations incorporelles (brut)', 'montant', 'selon_cas', 'si détenues'::text, array['Immobilisations incorporelles']::text[], '{}'::text[], null::text, null::text, 'pratique (modèle NC 01 non lu)', 'pratique'),
    ('bilan', 'actifs_non_courants', 'immob_incorporelles_amort', 'Moins : amortissements des immobilisations incorporelles', 'montant', 'selon_cas', null::text, array['Moins : amortissements', 'Amortissements']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bilan', 'actifs_non_courants', 'immob_corporelles_brut', 'Immobilisations corporelles (brut)', 'montant', 'selon_cas', 'si détenues ou prises en leasing (NCT 41)'::text, array['Immobilisations corporelles']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bilan', 'actifs_non_courants', 'immob_corporelles_amort', 'Moins : amortissements des immobilisations corporelles', 'montant', 'selon_cas', null::text, array['Moins : amortissements']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bilan', 'actifs_non_courants', 'immob_financieres_brut', 'Immobilisations financières', 'montant', 'selon_cas', null::text, array['Immobilisations financières']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bilan', 'actifs_non_courants', 'immob_financieres_prov', 'Moins : provisions sur immobilisations financières', 'montant', 'selon_cas', null::text, array['Moins : provisions']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bilan', 'actifs_non_courants', 'total_actifs_immobilises', 'Total des actifs immobilisés', 'montant', 'oui', null::text, array['Total des actifs immobilisés']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bilan', 'actifs_non_courants', 'autres_actifs_non_courants', 'Autres actifs non courants (charges reportées, etc.)', 'montant', 'selon_cas', null::text, array['Autres actifs non courants']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bilan', 'actifs_non_courants', 'total_actifs_non_courants', 'Total des actifs non courants', 'montant', 'oui', null::text, array['Total des actifs non courants', 'Actifs non courants']::text[], array['الأصول غير الجارية']::text[], null::text, null::text, 'NC 01 distinction courant/non courant (INCERTAIN § exact)', 'incertain'),
    ('bilan', 'actifs_courants', 'stocks', 'Stocks (net ou brut moins provisions)', 'montant', 'selon_cas', null::text, array['Stocks', 'Moins : provisions']::text[], array['المخزونات']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bilan', 'actifs_courants', 'clients', 'Clients et comptes rattachés', 'montant', 'selon_cas', null::text, array['Clients et comptes rattachés']::text[], array['الحرفاء والحسابات المتصلة بهم']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bilan', 'actifs_courants', 'clients_provisions', 'Moins : provisions clients', 'montant', 'selon_cas', null::text, array['Moins : provisions']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bilan', 'actifs_courants', 'autres_actifs_courants', 'Autres actifs courants', 'montant', 'selon_cas', null::text, array['Autres actifs courants']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bilan', 'actifs_courants', 'placements', 'Placements et autres actifs financiers', 'montant', 'selon_cas', null::text, array['Placements et autres actifs financiers', 'Placement et autres']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bilan', 'actifs_courants', 'liquidites', 'Liquidités et équivalents de liquidités', 'montant', 'selon_cas', null::text, array['Liquidités et équivalents de liquidités']::text[], array['السيولة وما يعادلها']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bilan', 'actifs_courants', 'total_actifs_courants', 'Total des actifs courants', 'montant', 'oui', null::text, array['Total des actifs courants']::text[], array['الأصول الجارية']::text[], null::text, null::text, 'NC 01 (INCERTAIN § exact)', 'incertain'),
    ('bilan', 'actifs_courants', 'total_actifs', 'Total des actifs', 'montant', 'oui', null::text, array['Total des actifs', 'Total actif']::text[], array['مجموع الأصول']::text[], null::text, null::text, 'pratique / équilibre comptable', 'pratique'),
    ('bilan', 'capitaux_propres', 'capital_social', 'Capital social', 'montant', 'selon_cas', 'sociétés'::text, array['Capital social']::text[], array['رأس المال']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bilan', 'capitaux_propres', 'reserves', 'Réserves', 'montant', 'selon_cas', null::text, array['Réserves']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bilan', 'capitaux_propres', 'autres_capitaux_propres', 'Autres capitaux propres (subventions d''investissement, réserves spéciales de réévaluation, compte spécial d''investissement…)', 'montant', 'selon_cas', null::text, array['Autres capitaux propres', 'Réserves spéciales de réévaluation', 'Compte spécial d''investissement']::text[], '{}'::text[], null::text, null::text, 'pratique (EF CNT 2024)', 'pratique'),
    ('bilan', 'capitaux_propres', 'resultats_reportes', 'Résultats reportés', 'montant', 'selon_cas', null::text, array['Résultats reportés']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bilan', 'capitaux_propres', 'cp_avant_resultat', 'Total des capitaux propres avant résultat de l''exercice', 'montant', 'oui', null::text, array['Total des capitaux propres avant résultat de l''exercice']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bilan', 'capitaux_propres', 'resultat_exercice', 'Résultat de l''exercice', 'montant', 'oui', null::text, array['Résultat de l''exercice', 'Résultat net de l''exercice']::text[], array['نتيجة السنة المحاسبية']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bilan', 'capitaux_propres', 'total_capitaux_propres', 'Total des capitaux propres avant affectation', 'montant', 'oui', null::text, array['Total des capitaux propres avant affectation', 'Capitaux propres']::text[], array['الأموال الذاتية']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bilan', 'passifs', 'emprunts_non_courants', 'Emprunts (part à plus d''un an), y compris dettes de leasing', 'montant', 'selon_cas', null::text, array['Emprunts']::text[], '{}'::text[], null::text, null::text, 'pratique ; NCT 41 pour le leasing', 'pratique'),
    ('bilan', 'passifs', 'autres_passifs_financiers_nc', 'Autres passifs financiers non courants', 'montant', 'selon_cas', null::text, array['Autres passifs financiers']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bilan', 'passifs', 'provisions_risques', 'Provisions (pour risques et charges)', 'montant', 'selon_cas', null::text, array['Provisions']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bilan', 'passifs', 'total_passifs_non_courants', 'Total des passifs non courants', 'montant', 'oui', null::text, array['Total des passifs non courants']::text[], array['الخصوم غير الجارية']::text[], null::text, null::text, 'NC 01 (INCERTAIN § exact)', 'incertain'),
    ('bilan', 'passifs', 'fournisseurs', 'Fournisseurs et comptes rattachés', 'montant', 'selon_cas', null::text, array['Fournisseurs et comptes rattachés']::text[], array['المزودون والحسابات المتصلة بهم']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bilan', 'passifs', 'autres_passifs_courants', 'Autres passifs courants', 'montant', 'selon_cas', null::text, array['Autres passifs courants']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bilan', 'passifs', 'concours_bancaires', 'Concours bancaires et autres passifs financiers (dont échéances à moins d''un an des emprunts et du leasing)', 'montant', 'selon_cas', null::text, array['Concours bancaires et autres passifs financiers']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bilan', 'passifs', 'total_passifs_courants', 'Total des passifs courants', 'montant', 'oui', null::text, array['Total des passifs courants']::text[], array['الخصوم الجارية']::text[], null::text, null::text, 'NC 01 (INCERTAIN § exact)', 'incertain'),
    ('bilan', 'passifs', 'total_passifs', 'Total des passifs', 'montant', 'oui', null::text, array['Total des passifs']::text[], array['مجموع الخصوم']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bilan', 'passifs', 'total_cp_et_passifs', 'Total des capitaux propres et des passifs', 'montant', 'oui', null::text, array['Total des capitaux propres et des passifs']::text[], array['مجموع الأموال الذاتية والخصوم']::text[], null::text, null::text, 'pratique / équilibre comptable', 'pratique'),
    ('bilan', 'validation', 'date_arrete_par_organe', 'Date d''arrêté par le conseil / la gérance', 'date', 'selon_cas', 'sociétés commerciales ; souvent en note'::text, array['Arrêtés par le conseil d''administration le']::text[], '{}'::text[], null::text, null::text, 'pratique (Code des sociétés commerciales non consulté : INCERTAIN)', 'incertain'),
    ('bilan', 'validation', 'signataire', 'Signature / cachet du dirigeant', 'texte', 'non', null::text, array['Le Gérant', 'Le Directeur général']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('etat_resultat', 'entete', 'raison_sociale', 'Dénomination', 'texte', 'oui', null::text, array['Société']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('etat_resultat', 'entete', 'titre_etat', 'Titre', 'texte', 'oui', null::text, array['État de résultat', 'Etat de résultats']::text[], array['قائمة النتائج']::text[], null::text, null::text, 'Loi 96-112 art. 18', 'texte'),
    ('etat_resultat', 'entete', 'periode', 'Période couverte', 'periode', 'oui', null::text, array['Période du … au …', 'Exercice clos le']::text[], '{}'::text[], null::text, null::text, 'Loi 96-112 art. 22', 'texte'),
    ('etat_resultat', 'entete', 'modele', 'Modèle utilisé (par nature / par destination)', 'liste', 'oui', 'déduit de la structure si non indiqué'::text, array['Modèle de référence', 'Modèle autorisé']::text[], '{}'::text[], null::text, null::text, 'NC 01 (INCERTAIN libellés exacts)', 'incertain'),
    ('etat_resultat', 'entete', 'monnaie_unite', 'Monnaie et unité', 'liste', 'oui', null::text, array['En dinars', 'En mDT']::text[], '{}'::text[], null::text, null::text, 'Loi 96-112 art. 23', 'texte'),
    ('etat_resultat', 'entete', 'colonnes_n_n1', 'Colonnes N et N−1', 'montant', 'oui', 'N−1 sauf premier exercice'::text, array['N', 'N-1']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN (comparatif) / pratique', 'incertain'),
    ('etat_resultat', 'produits_exploitation', 'revenus', 'Revenus (chiffre d''affaires)', 'montant', 'oui', null::text, array['Revenus', 'Ventes', 'Chiffre d''affaires']::text[], array['الإيرادات']::text[], null::text, null::text, 'pratique (EF CNT 2024)', 'pratique'),
    ('etat_resultat', 'produits_exploitation', 'autres_produits_exploitation', 'Autres produits d''exploitation', 'montant', 'selon_cas', null::text, array['Autres produits d''exploitation']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('etat_resultat', 'produits_exploitation', 'production_immobilisee', 'Production immobilisée', 'montant', 'selon_cas', null::text, array['Production immobilisée']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('etat_resultat', 'produits_exploitation', 'total_produits_exploitation', 'Total des produits d''exploitation', 'montant', 'oui', null::text, array['Total des produits d''exploitation']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('etat_resultat', 'charges_exploitation_par_nature', 'variation_stocks_pf_encours', 'Variation des stocks de produits finis et des encours', 'montant', 'selon_cas', 'entreprises de production'::text, array['Variation des stocks des produits finis et des encours']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('etat_resultat', 'charges_exploitation_par_nature', 'achats_marchandises_consommes', 'Achats de marchandises consommés', 'montant', 'selon_cas', null::text, array['Achats de marchandises consommés', 'Achats de marchandises consommées']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('etat_resultat', 'charges_exploitation_par_nature', 'achats_approvisionnements_consommes', 'Achats d''approvisionnements consommés', 'montant', 'selon_cas', null::text, array['Achats d''approvisionnements consommés']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('etat_resultat', 'charges_exploitation_par_nature', 'charges_personnel', 'Charges de personnel', 'montant', 'selon_cas', null::text, array['Charges de personnel', 'Charges du personnel']::text[], array['أعباء الأعوان']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('etat_resultat', 'charges_exploitation_par_nature', 'dotations_amort_prov', 'Dotations aux amortissements et aux provisions', 'montant', 'selon_cas', null::text, array['Dotations aux amortissements et aux provisions']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('etat_resultat', 'charges_exploitation_par_nature', 'autres_charges_exploitation', 'Autres charges d''exploitation', 'montant', 'selon_cas', null::text, array['Autres charges d''exploitation']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('etat_resultat', 'charges_exploitation_par_nature', 'total_charges_exploitation', 'Total des charges d''exploitation', 'montant', 'oui', null::text, array['Total des charges d''exploitation']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('etat_resultat', 'charges_par_destination', 'cout_des_ventes', 'Coût des ventes', 'montant', 'selon_cas', 'si présentation par destination ; ventilation par nature à fournir en note (selon mémoire)'::text, array['Coût des ventes']::text[], '{}'::text[], null::text, null::text, 'NC 01 (INCERTAIN)', 'incertain'),
    ('etat_resultat', 'charges_par_destination', 'marge_brute', 'Marge brute', 'montant', 'selon_cas', 'idem'::text, array['Marge brute']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('etat_resultat', 'charges_par_destination', 'frais_distribution', 'Frais de distribution', 'montant', 'selon_cas', 'idem'::text, array['Frais de distribution']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('etat_resultat', 'charges_par_destination', 'frais_administration', 'Frais d''administration', 'montant', 'selon_cas', 'idem'::text, array['Frais d''administration']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('etat_resultat', 'resultats', 'resultat_exploitation', 'Résultat d''exploitation', 'montant', 'oui', null::text, array['Résultat d''exploitation']::text[], array['نتيجة الاستغلال']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('etat_resultat', 'resultats', 'charges_financieres_nettes', 'Charges financières nettes (dont intérêts de leasing, pertes de change)', 'montant', 'selon_cas', null::text, array['Charges financières nettes']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('etat_resultat', 'resultats', 'produits_placements', 'Produits des placements / produits financiers', 'montant', 'selon_cas', null::text, array['Produits des placements', 'Produits financiers']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('etat_resultat', 'resultats', 'autres_gains_ordinaires', 'Autres gains ordinaires (dont plus-values de cession d''immobilisations)', 'montant', 'selon_cas', null::text, array['Autres gains ordinaires']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('etat_resultat', 'resultats', 'autres_pertes_ordinaires', 'Autres pertes ordinaires', 'montant', 'selon_cas', null::text, array['Autres pertes ordinaires']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('etat_resultat', 'resultats', 'resultat_ao_avant_impot', 'Résultat des activités ordinaires avant impôt', 'montant', 'oui', null::text, array['Résultat des activités ordinaires avant impôt']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('etat_resultat', 'resultats', 'impot_benefices', 'Impôt sur les bénéfices', 'montant', 'oui', null::text, array['Impôt sur les bénéfices', 'Impôts sur les sociétés']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('etat_resultat', 'resultats', 'resultat_ao_apres_impot', 'Résultat des activités ordinaires après impôt', 'montant', 'oui', null::text, array['Résultat des activités ordinaires après impôt']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('etat_resultat', 'resultats', 'elements_extraordinaires', 'Éléments extraordinaires (gains / pertes)', 'montant', 'selon_cas', 'mention séparée si existants'::text, array['Éléments extraordinaires']::text[], '{}'::text[], null::text, null::text, 'NC 01 (mémoire 2004 ; § INCERTAIN)', 'incertain'),
    ('etat_resultat', 'resultats', 'resultat_net', 'Résultat net de l''exercice', 'montant', 'oui', null::text, array['Résultat net de l''exercice', 'Résultat net']::text[], array['النتيجة الصافية للسنة المحاسبية']::text[], null::text, null::text, 'Loi 96-112 art. 18', 'texte'),
    ('etat_resultat', 'resultats', 'effets_modifications_comptables', 'Effets des modifications comptables (net d''impôt)', 'montant', 'selon_cas', 'si changement de méthode / correction d''erreur'::text, array['Effets des modifications comptables']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN (norme sur les modifications comptables non lue)', 'incertain'),
    ('etat_resultat', 'resultats', 'resultat_apres_modifications', 'Résultat après modifications comptables', 'montant', 'selon_cas', 'idem'::text, array['Résultat après modifications comptables']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('etat_flux_tresorerie', 'entete', 'titre_etat', 'Titre', 'texte', 'oui', null::text, array['État des flux de trésorerie', 'Tableau des flux de trésorerie']::text[], array['جدول التدفقات النقدية']::text[], null::text, null::text, 'Loi 96-112 art. 18', 'texte'),
    ('etat_flux_tresorerie', 'entete', 'periode', 'Période', 'periode', 'oui', null::text, array['Exercice clos le']::text[], '{}'::text[], null::text, null::text, 'Loi 96-112 art. 22', 'texte'),
    ('etat_flux_tresorerie', 'entete', 'methode', 'Méthode (directe / indirecte)', 'liste', 'oui', 'déduite si non indiquée'::text, array['Modèle de référence', 'Modèle autorisé']::text[], '{}'::text[], null::text, null::text, 'NC 01 (INCERTAIN)', 'incertain'),
    ('etat_flux_tresorerie', 'entete', 'monnaie_unite', 'Monnaie / unité', 'liste', 'oui', null::text, array['En dinars']::text[], '{}'::text[], null::text, null::text, 'Loi 96-112 art. 23', 'texte'),
    ('etat_flux_tresorerie', 'exploitation_methode_directe', 'encaissements_clients', 'Encaissements reçus des clients', 'montant', 'selon_cas', 'méthode directe'::text, array['Encaissements reçus des clients']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN (libellé du modèle NC 01 ; pratique)', 'incertain'),
    ('etat_flux_tresorerie', 'exploitation_methode_directe', 'sommes_versees_fournisseurs_personnel', 'Sommes versées aux fournisseurs et au personnel', 'montant', 'selon_cas', 'méthode directe'::text, array['Sommes versées aux fournisseurs et au personnel']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('etat_flux_tresorerie', 'exploitation_methode_directe', 'interets_payes', 'Intérêts payés', 'montant', 'selon_cas', null::text, array['Intérêts payés']::text[], '{}'::text[], null::text, null::text, 'pratique (Air Liquide notes 22-30)', 'pratique'),
    ('etat_flux_tresorerie', 'exploitation_methode_directe', 'impots_payes', 'Impôts et taxes payés', 'montant', 'selon_cas', null::text, array['Impôts payés', 'Impôts sur les bénéfices payés']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('etat_flux_tresorerie', 'exploitation_methode_directe', 'autres_flux_exploitation', 'Autres encaissements / décaissements d''exploitation', 'montant', 'selon_cas', null::text, array['Autres flux']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('etat_flux_tresorerie', 'exploitation_methode_indirecte', 'resultat_net', 'Résultat net', 'montant', 'selon_cas', 'méthode indirecte'::text, array['Résultat net']::text[], '{}'::text[], null::text, null::text, 'pratique (CNT 2024)', 'pratique'),
    ('etat_flux_tresorerie', 'exploitation_methode_indirecte', 'ajust_amortissements_provisions', 'Ajustements : amortissements et provisions', 'montant', 'selon_cas', 'méthode indirecte'::text, array['Amortissements et provisions']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('etat_flux_tresorerie', 'exploitation_methode_indirecte', 'ajust_variation_stocks', 'Variation des stocks', 'montant', 'selon_cas', null::text, array['Variation des stocks']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('etat_flux_tresorerie', 'exploitation_methode_indirecte', 'ajust_variation_creances', 'Variation des créances', 'montant', 'selon_cas', null::text, array['Variation des créances']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('etat_flux_tresorerie', 'exploitation_methode_indirecte', 'ajust_variation_autres_actifs', 'Variation des autres actifs', 'montant', 'selon_cas', null::text, array['Variation des autres actifs']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('etat_flux_tresorerie', 'exploitation_methode_indirecte', 'ajust_variation_fournisseurs_dettes', 'Variation des fournisseurs et autres dettes', 'montant', 'selon_cas', null::text, array['Variation des fournisseurs et autres dettes']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('etat_flux_tresorerie', 'exploitation_methode_indirecte', 'ajust_plus_moins_values', 'Plus ou moins-values de cession', 'montant', 'selon_cas', null::text, array['Plus ou moins-values de cession']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('etat_flux_tresorerie', 'exploitation_methode_indirecte', 'ajust_reprises_provisions', 'Reprises sur provisions', 'montant', 'selon_cas', null::text, array['Reprises sur provisions']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('etat_flux_tresorerie', 'flux_synthese', 'flux_exploitation', 'Flux de trésorerie provenant de (affectés à) l''exploitation', 'montant', 'oui', null::text, array['Flux de trésorerie liés à l''exploitation', 'Flux de trésorerie provenant de l''exploitation']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('etat_flux_tresorerie', 'flux_synthese', 'decaissements_acquisitions_immob_corp_incorp', 'Décaissements provenant de l''acquisition d''immobilisations corporelles et incorporelles', 'montant', 'selon_cas', null::text, array['Décaissements provenant de l''acquisition d''immobilisations corporelles et incorporelles']::text[], '{}'::text[], null::text, null::text, 'pratique (Air Liquide note 20 ; CNT)', 'pratique'),
    ('etat_flux_tresorerie', 'flux_synthese', 'encaissements_cessions_immob', 'Encaissements provenant de la cession d''immobilisations', 'montant', 'selon_cas', null::text, array['Encaissements provenant de la cession d''immobilisations']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('etat_flux_tresorerie', 'flux_synthese', 'flux_immob_financieres', 'Décaissements / encaissements sur immobilisations financières', 'montant', 'selon_cas', null::text, array['Immobilisations financières']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('etat_flux_tresorerie', 'flux_synthese', 'flux_investissement', 'Flux de trésorerie liés aux activités d''investissement', 'montant', 'oui', null::text, array['Flux de trésorerie liés aux activités d''investissement']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('etat_flux_tresorerie', 'flux_synthese', 'encaissements_emission_actions', 'Encaissements suite à l''émission d''actions', 'montant', 'selon_cas', null::text, array['Encaissements suite à l''émission d''actions']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('etat_flux_tresorerie', 'flux_synthese', 'dividendes_verses', 'Dividendes et autres distributions', 'montant', 'selon_cas', null::text, array['Dividendes et autres distributions', 'Distribution de dividendes']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('etat_flux_tresorerie', 'flux_synthese', 'encaissements_emprunts', 'Encaissements provenant des emprunts', 'montant', 'selon_cas', null::text, array['Encaissements provenant des emprunts']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('etat_flux_tresorerie', 'flux_synthese', 'remboursements_emprunts', 'Remboursements d''emprunts (dont part capital du leasing)', 'montant', 'selon_cas', null::text, array['Remboursements d''emprunts']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('etat_flux_tresorerie', 'flux_synthese', 'flux_financement', 'Flux de trésorerie liés aux activités de financement', 'montant', 'oui', null::text, array['Flux de trésorerie liés aux activités de financement']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('etat_flux_tresorerie', 'flux_synthese', 'incidence_change', 'Incidence des variations des taux de change sur les liquidités', 'montant', 'selon_cas', 'si liquidités en devises'::text, array['Incidence des variations des taux de change']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('etat_flux_tresorerie', 'flux_synthese', 'variation_tresorerie', 'Variation de trésorerie', 'montant', 'oui', null::text, array['Variation de trésorerie']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('etat_flux_tresorerie', 'flux_synthese', 'tresorerie_debut', 'Trésorerie au début de l''exercice', 'montant', 'oui', null::text, array['Trésorerie au début de l''exercice']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('etat_flux_tresorerie', 'flux_synthese', 'tresorerie_cloture', 'Trésorerie à la clôture de l''exercice', 'montant', 'oui', null::text, array['Trésorerie à la clôture de l''exercice']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('notes_etats_financiers', 'generalites', 'presentation_entreprise', 'Présentation de l''entreprise (forme, objet, capital, siège)', 'texte', 'selon_cas', null::text, array['Présentation de la société']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('notes_etats_financiers', 'generalites', 'referentiel', 'Déclaration de conformité au système comptable des entreprises', 'texte', 'oui', null::text, array['Référentiel comptable', 'Déclaration de conformité', 'système comptable des entreprises']::text[], array['النظام المحاسبي للمؤسسات']::text[], null::text, null::text, 'pratique (Air Liquide note 1) ; exigence textuelle INCERTAIN', 'incertain'),
    ('notes_etats_financiers', 'generalites', 'bases_mesure', 'Bases de mesure (coût historique, réévaluation)', 'texte', 'oui', null::text, array['Bases de mesure', 'Coût historique']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('notes_etats_financiers', 'generalites', 'faits_marquants', 'Faits marquants de l''exercice', 'texte', 'non', null::text, array['Faits marquants']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('notes_etats_financiers', 'principes_comptables', 'methode_immobilisations', 'Méthode et taux d''amortissement par catégorie, point de départ (mise en service, prorata temporis)', 'texte', 'oui', 'si immobilisations'::text, array['Immobilisations', 'Taux d''amortissement', 'Prorata temporis']::text[], '{}'::text[], null::text, null::text, 'pratique (Air Liquide note 1 : linéaire, prorata temporis)', 'pratique'),
    ('notes_etats_financiers', 'principes_comptables', 'taux_par_categorie', 'Tableau des taux (constructions, matériel, transport, informatique…)', 'taux', 'selon_cas', null::text, array['Constructions', 'Matériel de transport', 'Matériel informatique']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('notes_etats_financiers', 'principes_comptables', 'methode_stocks', 'Évaluation des stocks (coût d''acquisition/production, méthode de sortie, dépréciation à la valeur de réalisation nette)', 'texte', 'selon_cas', 'si stocks'::text, array['Stocks', 'Coût moyen pondéré', 'Premier entré premier sorti', 'Valeur de réalisation nette']::text[], '{}'::text[], null::text, null::text, 'pratique ; norme stocks (NC 04) INCERTAIN', 'incertain'),
    ('notes_etats_financiers', 'principes_comptables', 'methode_inventaire', 'Inventaire permanent ou intermittent', 'liste', 'selon_cas', null::text, array['Inventaire permanent', 'Inventaire intermittent']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('notes_etats_financiers', 'principes_comptables', 'conversion_devises', 'Conversion des opérations en devises (cours du jour de l''opération ; éléments monétaires au cours de clôture ; écarts en résultat financier)', 'texte', 'selon_cas', 'si opérations en devises'::text, array['Opérations en monnaies étrangères', 'Cours de clôture', 'Différences de change']::text[], '{}'::text[], null::text, null::text, 'pratique (Air Liquide 2020) ; norme opérations en monnaies étrangères INCERTAIN (numéro non lu)', 'incertain'),
    ('notes_etats_financiers', 'principes_comptables', 'traitement_leasing', 'Traitement des contrats de location-financement chez le preneur', 'texte', 'selon_cas', 'si leasing'::text, array['Contrats de location', 'Leasing', 'Location-financement']::text[], '{}'::text[], null::text, null::text, 'NCT 41 (mémoire 2006 ; paragraphes INCERTAIN)', 'incertain'),
    ('notes_etats_financiers', 'principes_comptables', 'definition_tresorerie', 'Définition de la trésorerie retenue', 'texte', 'selon_cas', null::text, array['Liquidités et équivalents de liquidités']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('notes_etats_financiers', 'tableau_immobilisations', 'rubrique', 'Rubrique (terrains, constructions, matériel et outillage, matériel de transport, MMB & AAI, immobilisations en cours, logiciels, fonds de commerce)', 'liste', 'oui', 'si immobilisations'::text, array['Rubriques', 'Terrains', 'Constructions', 'Matériel de transport', 'M.M.B & A.A.I', 'Immobilisations en cours']::text[], '{}'::text[], null::text, null::text, 'pratique (Air Liquide note 1)', 'pratique'),
    ('notes_etats_financiers', 'tableau_immobilisations', 'brut_ouverture', 'Valeurs brutes à l''ouverture', 'montant', 'oui', null::text, array['Valeurs brutes au 31.12.N-1']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('notes_etats_financiers', 'tableau_immobilisations', 'acquisitions', 'Acquisitions', 'montant', 'oui', null::text, array['Acquisitions']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('notes_etats_financiers', 'tableau_immobilisations', 'reclassements', 'Reclassements / transferts', 'montant', 'selon_cas', null::text, array['Reclassement']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('notes_etats_financiers', 'tableau_immobilisations', 'cessions', 'Cessions / mises au rebut', 'montant', 'selon_cas', null::text, array['Cession', 'Sorties']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('notes_etats_financiers', 'tableau_immobilisations', 'reevaluation', 'Écart de réévaluation', 'montant', 'selon_cas', 'si modèle de réévaluation'::text, array['Réévaluation']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN (NC 05 révisée, cité CNT)', 'incertain'),
    ('notes_etats_financiers', 'tableau_immobilisations', 'brut_cloture', 'Valeurs brutes à la clôture', 'montant', 'oui', null::text, array['Valeurs brutes au 31.12.N']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('notes_etats_financiers', 'tableau_immobilisations', 'amort_ouverture', 'Amortissements cumulés à l''ouverture', 'montant', 'oui', null::text, array['Amortissements au 31.12.N-1']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('notes_etats_financiers', 'tableau_immobilisations', 'dotations', 'Dotations de l''exercice', 'montant', 'oui', null::text, array['Dotations']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('notes_etats_financiers', 'tableau_immobilisations', 'amort_autres_variations', 'Reprises / autres variations (cessions)', 'montant', 'selon_cas', null::text, array['Autres variations', 'Reprises']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('notes_etats_financiers', 'tableau_immobilisations', 'amort_cloture', 'Amortissements cumulés à la clôture', 'montant', 'oui', null::text, array['Amortissements au 31.12.N']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('notes_etats_financiers', 'tableau_immobilisations', 'vnc_cloture', 'Valeur comptable nette', 'montant', 'oui', null::text, array['VCN', 'VNC', 'Valeur nette']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('notes_etats_financiers', 'autres_notes', 'variation_capitaux_propres', 'Tableau de variation des capitaux propres', 'montant', 'oui', null::text, array['Tableau de variation des capitaux propres']::text[], '{}'::text[], null::text, null::text, 'NC 01 selon mémoire (INCERTAIN §)', 'incertain'),
    ('notes_etats_financiers', 'autres_notes', 'detail_postes', 'Détail de chaque poste du bilan et de l''état de résultat (clients, stocks, emprunts, échéances < 1 an…)', 'montant', 'selon_cas', null::text, array['Note n°']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('notes_etats_financiers', 'autres_notes', 'tableau_emprunts', 'Tableau des emprunts et dettes de leasing (solde début, nouveaux, remboursements, solde fin, part < 1 an)', 'montant', 'selon_cas', null::text, array['Emprunts', 'Échéances à moins d''un an']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('notes_etats_financiers', 'autres_notes', 'engagements_hors_bilan', 'Engagements hors bilan (hypothèques, nantissements, cautions, engagements de leasing)', 'texte', 'selon_cas', null::text, array['Engagements hors bilan']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('notes_etats_financiers', 'autres_notes', 'parties_liees', 'Informations sur les parties liées', 'texte', 'selon_cas', 'si transactions avec parties liées'::text, array['Parties liées']::text[], '{}'::text[], null::text, null::text, 'NCT 39 (§ non lus)', 'texte'),
    ('notes_etats_financiers', 'autres_notes', 'evenements_posterieurs', 'Événements postérieurs à la date de clôture', 'texte', 'selon_cas', null::text, array['Événements postérieurs à la date de clôture']::text[], '{}'::text[], null::text, null::text, 'NCT 14 (§ non lus)', 'texte'),
    ('notes_etats_financiers', 'autres_notes', 'soldes_intermediaires_gestion', 'État des soldes intermédiaires de gestion', 'montant', 'selon_cas', null::text, array['Soldes intermédiaires de gestion']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN (pratique courante)', 'incertain'),
    ('notes_etats_financiers', 'autres_notes', 'affectation_resultat', 'Proposition d''affectation du résultat', 'montant', 'non', null::text, array['Affectation du résultat']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('balance_tiers', 'entete', 'raison_sociale', 'Entreprise concernée', 'texte', 'oui', null::text, array['Société', 'Dossier']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('balance_tiers', 'entete', 'type_balance', 'Type (générale, clients, fournisseurs, âgée)', 'liste', 'oui', null::text, array['Balance générale', 'Balance auxiliaire', 'Balance âgée']::text[], array['ميزان المراجعة']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('balance_tiers', 'entete', 'periode', 'Période (du … au …)', 'periode', 'oui', null::text, array['Période du', 'Du … au …', 'Arrêtée au']::text[], '{}'::text[], null::text, null::text, 'Loi 96-112 art. 16', 'texte'),
    ('balance_tiers', 'entete', 'exercice', 'Exercice comptable', 'periode', 'oui', null::text, array['Exercice']::text[], '{}'::text[], null::text, null::text, 'Loi 96-112 art. 22', 'texte'),
    ('balance_tiers', 'entete', 'date_edition', 'Date d''édition', 'date', 'non', null::text, array['Édité le', 'Date d''impression']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('balance_tiers', 'entete', 'statut_provisoire', 'Provisoire / définitive (avant ou après écritures d''inventaire)', 'liste', 'non', null::text, array['Provisoire', 'Définitive', 'Après inventaire']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('balance_tiers', 'entete', 'emetteur_tiers', 'Cabinet / logiciel émetteur', 'texte', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('balance_tiers', 'entete', 'monnaie', 'Monnaie', 'liste', 'oui', null::text, array['DT', 'TND']::text[], '{}'::text[], null::text, null::text, 'Loi 96-112 art. 23 (par analogie)', 'texte'),
    ('balance_tiers', 'lignes_compte', 'numero_compte', 'Numéro de compte (plan des comptes SCE, classes 1 à 7 ; ou compte auxiliaire)', 'identifiant', 'oui', null::text, array['Compte', 'N° compte']::text[], array['رقم الحساب']::text[], null::text, null::text, 'pratique ; nomenclature du plan des comptes SCE non relue (INCERTAIN détail)', 'incertain'),
    ('balance_tiers', 'lignes_compte', 'intitule_compte', 'Intitulé du compte / nom du tiers', 'texte', 'oui', null::text, array['Intitulé', 'Libellé']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('balance_tiers', 'lignes_compte', 'matricule_tiers', 'Matricule fiscal du tiers (balances auxiliaires)', 'identifiant', 'non', 'balance auxiliaire'::text, array['MF']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('balance_tiers', 'lignes_compte', 'solde_ouverture_debit', 'Solde à nouveau débiteur', 'montant', 'selon_cas', 'balance à 6 ou 8 colonnes'::text, array['À nouveau débit', 'Report débit', 'Solde initial débit']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('balance_tiers', 'lignes_compte', 'solde_ouverture_credit', 'Solde à nouveau créditeur', 'montant', 'selon_cas', 'idem'::text, array['À nouveau crédit', 'Report crédit']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('balance_tiers', 'lignes_compte', 'mouvements_debit', 'Mouvements débit de la période', 'montant', 'oui', null::text, array['Mouvements débit', 'Débit', 'Total débit']::text[], array['مدين']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('balance_tiers', 'lignes_compte', 'mouvements_credit', 'Mouvements crédit de la période', 'montant', 'oui', null::text, array['Mouvements crédit', 'Crédit', 'Total crédit']::text[], array['دائن']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('balance_tiers', 'lignes_compte', 'cumul_debit', 'Cumul débit (ouverture + mouvements)', 'montant', 'selon_cas', null::text, array['Cumul débit']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('balance_tiers', 'lignes_compte', 'cumul_credit', 'Cumul crédit', 'montant', 'selon_cas', null::text, array['Cumul crédit']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('balance_tiers', 'lignes_compte', 'solde_final_debit', 'Solde débiteur', 'montant', 'oui', null::text, array['Solde débiteur', 'Solde débit']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('balance_tiers', 'lignes_compte', 'solde_final_credit', 'Solde créditeur', 'montant', 'oui', null::text, array['Solde créditeur', 'Solde crédit']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('balance_tiers', 'lignes_compte', 'tranches_anciennete', 'Tranches d''ancienneté (0-30, 31-60, 61-90, > 90 jours)', 'montant', 'selon_cas', 'balance âgée'::text, array['Non échu', '> 90 jours']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('balance_tiers', 'totaux', 'totaux_classe', 'Totaux par classe', 'montant', 'non', null::text, array['Total classe']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('balance_tiers', 'totaux', 'total_general_debit', 'Total général débit (par colonne)', 'montant', 'oui', null::text, array['Total général']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('balance_tiers', 'totaux', 'total_general_credit', 'Total général crédit (par colonne)', 'montant', 'oui', null::text, array['Total général']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('grand_livre_tiers', 'entete', 'raison_sociale', 'Entreprise', 'texte', 'oui', null::text, array['Société']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('grand_livre_tiers', 'entete', 'type_grand_livre', 'Général / auxiliaire clients / auxiliaire fournisseurs', 'liste', 'oui', null::text, array['Grand livre général', 'Grand livre auxiliaire']::text[], array['دفتر الأستاذ']::text[], null::text, null::text, 'Loi 96-112 art. 13-14', 'texte'),
    ('grand_livre_tiers', 'entete', 'periode', 'Période', 'periode', 'oui', null::text, array['Du … au …']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('grand_livre_tiers', 'entete', 'date_edition', 'Date d''édition', 'date', 'non', null::text, array['Édité le']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('grand_livre_tiers', 'compte', 'numero_compte', 'Numéro de compte', 'identifiant', 'oui', null::text, array['Compte']::text[], '{}'::text[], null::text, null::text, 'Loi 96-112 art. 13', 'texte'),
    ('grand_livre_tiers', 'compte', 'intitule_compte', 'Intitulé du compte', 'texte', 'oui', null::text, array['Intitulé']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('grand_livre_tiers', 'compte', 'report_a_nouveau', 'Solde reporté / à nouveau', 'montant', 'selon_cas', 'comptes de bilan'::text, array['À nouveau', 'Report', 'Solde antérieur']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('grand_livre_tiers', 'lignes_ecriture', 'date_ecriture', 'Date de l''écriture', 'date', 'oui', null::text, array['Date']::text[], array['التاريخ']::text[], null::text, null::text, 'Loi 96-112 art. 12', 'texte'),
    ('grand_livre_tiers', 'lignes_ecriture', 'code_journal', 'Code journal (achats, ventes, banque, OD…)', 'identifiant', 'oui', null::text, array['Jnl', 'Journal', 'JL']::text[], '{}'::text[], null::text, null::text, 'Loi 96-112 art. 12 (origine de l''écriture)', 'texte'),
    ('grand_livre_tiers', 'lignes_ecriture', 'numero_ecriture', 'Numéro d''écriture / de mouvement', 'identifiant', 'selon_cas', 'logiciels'::text, array['N° écriture', 'N° mvt']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('grand_livre_tiers', 'lignes_ecriture', 'reference_piece', 'Référence de la pièce justificative', 'identifiant', 'oui', null::text, array['Pièce', 'N° pièce', 'Réf.']::text[], '{}'::text[], null::text, null::text, 'Loi 96-112 art. 12', 'texte'),
    ('grand_livre_tiers', 'lignes_ecriture', 'libelle_ecriture', 'Libellé', 'texte', 'oui', null::text, array['Libellé']::text[], '{}'::text[], null::text, null::text, 'Loi 96-112 art. 12 (contenu)', 'texte'),
    ('grand_livre_tiers', 'lignes_ecriture', 'compte_contrepartie', 'Compte de contrepartie', 'identifiant', 'non', null::text, array['Contrepartie', 'C/P']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('grand_livre_tiers', 'lignes_ecriture', 'debit', 'Débit', 'montant', 'oui', null::text, array['Débit']::text[], array['مدين']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('grand_livre_tiers', 'lignes_ecriture', 'credit', 'Crédit', 'montant', 'oui', null::text, array['Crédit']::text[], array['دائن']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('grand_livre_tiers', 'lignes_ecriture', 'solde_progressif', 'Solde progressif', 'montant', 'non', null::text, array['Solde']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('grand_livre_tiers', 'lignes_ecriture', 'lettrage', 'Code de lettrage', 'identifiant', 'non', 'comptes de tiers'::text, array['Let.', 'Lettrage']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('grand_livre_tiers', 'lignes_ecriture', 'echeance', 'Date d''échéance', 'date', 'non', 'comptes de tiers'::text, array['Échéance']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('grand_livre_tiers', 'lignes_ecriture', 'devise_montant', 'Montant en devise et cours', 'montant', 'selon_cas', 'opération en devises'::text, array['Devise', 'Cours']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('grand_livre_tiers', 'totaux_compte', 'total_debit_compte', 'Total débit du compte', 'montant', 'oui', null::text, array['Total compte']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('grand_livre_tiers', 'totaux_compte', 'total_credit_compte', 'Total crédit du compte', 'montant', 'oui', null::text, array['Total compte']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('grand_livre_tiers', 'totaux_compte', 'solde_compte', 'Solde final du compte', 'montant', 'oui', null::text, array['Solde']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('facture_acquisition_immobilisation', 'fournisseur', 'fournisseur_nom', 'Raison sociale du fournisseur', 'texte', 'oui', null::text, array['Fournisseur', 'Vendeur']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN (Code TVA)', 'incertain'),
    ('facture_acquisition_immobilisation', 'fournisseur', 'fournisseur_mf', 'Matricule fiscal du fournisseur', 'identifiant', 'selon_cas', 'fournisseur tunisien'::text, array['MF', 'Matricule fiscal', 'Code TVA']::text[], array['المعرف الجبائي']::text[], null::text, null::text, 'INCERTAIN (Code TVA)', 'incertain'),
    ('facture_acquisition_immobilisation', 'fournisseur', 'fournisseur_adresse', 'Adresse', 'adresse', 'oui', null::text, array['Adresse']::text[], array['العنوان']::text[], null::text, null::text, 'INCERTAIN (Code TVA)', 'incertain'),
    ('facture_acquisition_immobilisation', 'fournisseur', 'fournisseur_rne', 'Identifiant RNE / registre', 'identifiant', 'non', null::text, array['RNE', 'RC']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('facture_acquisition_immobilisation', 'client', 'client_nom', 'Raison sociale de l''acquéreur', 'texte', 'oui', null::text, array['Client', 'Doit']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN (Code TVA)', 'incertain'),
    ('facture_acquisition_immobilisation', 'client', 'client_mf', 'Matricule fiscal de l''acquéreur', 'identifiant', 'selon_cas', null::text, array['MF client']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN (Code TVA)', 'incertain'),
    ('facture_acquisition_immobilisation', 'client', 'client_adresse', 'Adresse de l''acquéreur', 'adresse', 'oui', null::text, array['Adresse']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('facture_acquisition_immobilisation', 'facture', 'numero_facture', 'Numéro de facture', 'identifiant', 'oui', null::text, array['Facture n°']::text[], array['فاتورة عدد']::text[], null::text, null::text, 'INCERTAIN (Code TVA)', 'incertain'),
    ('facture_acquisition_immobilisation', 'facture', 'date_facture', 'Date de facture', 'date', 'oui', null::text, array['Date']::text[], array['التاريخ']::text[], null::text, null::text, 'INCERTAIN (Code TVA)', 'incertain'),
    ('facture_acquisition_immobilisation', 'facture', 'reference_commande_bl', 'Bon de commande / bon de livraison / PV de réception', 'identifiant', 'non', null::text, array['BC', 'BL', 'PV de réception']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('facture_acquisition_immobilisation', 'facture', 'date_livraison', 'Date de livraison / installation', 'date', 'non', null::text, array['Date de livraison']::text[], '{}'::text[], null::text, null::text, 'pratique (sert à la date de mise en service)', 'pratique'),
    ('facture_acquisition_immobilisation', 'facture', 'devise', 'Devise de facturation', 'liste', 'selon_cas', 'fournisseur étranger'::text, array['EUR', 'USD', 'Devise']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('facture_acquisition_immobilisation', 'lignes_bien', 'designation_bien', 'Désignation précise du bien', 'texte', 'oui', null::text, array['Désignation']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN (Code TVA)', 'incertain'),
    ('facture_acquisition_immobilisation', 'lignes_bien', 'marque_modele', 'Marque / modèle', 'texte', 'non', null::text, array['Marque', 'Modèle', 'Type']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('facture_acquisition_immobilisation', 'lignes_bien', 'numero_serie', 'Numéro de série / châssis (VIN)', 'identifiant', 'selon_cas', 'matériel, véhicules'::text, array['N° série', 'N° châssis', 'VIN']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('facture_acquisition_immobilisation', 'lignes_bien', 'quantite', 'Quantité', 'nombre', 'oui', null::text, array['Qté']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN (Code TVA)', 'incertain'),
    ('facture_acquisition_immobilisation', 'lignes_bien', 'prix_unitaire_ht', 'Prix unitaire HT', 'montant', 'oui', null::text, array['P.U. HT']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN (Code TVA)', 'incertain'),
    ('facture_acquisition_immobilisation', 'lignes_bien', 'remise', 'Remise', 'montant', 'non', null::text, array['Remise']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('facture_acquisition_immobilisation', 'lignes_bien', 'montant_ht_ligne', 'Montant HT', 'montant', 'oui', null::text, array['Montant HT', 'Total HT']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN (Code TVA)', 'incertain'),
    ('facture_acquisition_immobilisation', 'lignes_bien', 'garantie', 'Durée de garantie', 'texte', 'non', null::text, array['Garantie']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('facture_acquisition_immobilisation', 'totaux', 'total_ht', 'Total HT', 'montant', 'oui', null::text, array['Total HT']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN (Code TVA)', 'incertain'),
    ('facture_acquisition_immobilisation', 'totaux', 'taux_tva', 'Taux de TVA', 'taux', 'selon_cas', 'opération taxable'::text, array['TVA %']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN (Code TVA)', 'incertain'),
    ('facture_acquisition_immobilisation', 'totaux', 'montant_tva', 'Montant TVA', 'montant', 'selon_cas', null::text, array['TVA']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN (Code TVA)', 'incertain'),
    ('facture_acquisition_immobilisation', 'totaux', 'mention_suspension_exoneration', 'Mention de suspension / exonération de TVA et référence de l''attestation', 'texte', 'selon_cas', 'achat en suspension'::text, array['En suspension de TVA', 'Exonéré']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('facture_acquisition_immobilisation', 'totaux', 'droit_timbre', 'Droit de timbre', 'montant', 'selon_cas', null::text, array['Timbre fiscal']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN (montant et texte à vérifier — famille fiscale)', 'incertain'),
    ('facture_acquisition_immobilisation', 'totaux', 'total_ttc', 'Total TTC / net à payer', 'montant', 'oui', null::text, array['Total TTC', 'Net à payer']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN (Code TVA)', 'incertain'),
    ('facture_acquisition_immobilisation', 'totaux', 'montant_en_lettres', 'Montant en toutes lettres', 'texte', 'non', null::text, array['Arrêtée la présente facture à la somme de']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('facture_acquisition_immobilisation', 'totaux', 'conditions_paiement', 'Conditions et échéances de paiement', 'texte', 'non', null::text, array['Conditions de paiement', 'Échéance']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('contrat_acquisition_immobilisation', 'parties', 'vendeur', 'Vendeur (nom / raison sociale, identifiant)', 'texte', 'oui', null::text, array['Le vendeur', 'D''une part']::text[], array['البائع']::text[], null::text, null::text, 'pratique (droit des contrats)', 'pratique'),
    ('contrat_acquisition_immobilisation', 'parties', 'acquereur', 'Acquéreur (raison sociale, MF, représentant)', 'texte', 'oui', null::text, array['L''acquéreur', 'D''autre part']::text[], array['المشتري']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_acquisition_immobilisation', 'parties', 'representant_pouvoir', 'Représentant légal et pouvoir', 'texte', 'selon_cas', 'personne morale'::text, array['Représentée par', 'En vertu de']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_acquisition_immobilisation', 'objet', 'nature_bien', 'Nature du bien (terrain, construction, fonds de commerce, matériel)', 'liste', 'oui', null::text, array['Objet', 'Désignation']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_acquisition_immobilisation', 'objet', 'titre_foncier', 'Numéro de titre foncier', 'identifiant', 'selon_cas', 'immeuble immatriculé'::text, array['Titre foncier n°', 'TF']::text[], array['رسم عقاري']::text[], null::text, null::text, 'INCERTAIN (droit foncier non lu)', 'incertain'),
    ('contrat_acquisition_immobilisation', 'objet', 'situation_superficie', 'Situation et superficie', 'adresse', 'selon_cas', 'immeuble'::text, array['Sis à', 'Superficie']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_acquisition_immobilisation', 'objet', 'quote_part_terrain', 'Ventilation terrain / construction', 'montant', 'selon_cas', 'immeuble bâti (le terrain n''est pas amorti)'::text, array['Terrain', 'Construction']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_acquisition_immobilisation', 'objet', 'elements_fonds_commerce', 'Éléments du fonds (clientèle, droit au bail, matériel)', 'texte', 'selon_cas', 'fonds de commerce'::text, array['Fonds de commerce']::text[], array['الأصل التجاري']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_acquisition_immobilisation', 'conditions_financieres', 'prix', 'Prix de cession', 'montant', 'oui', null::text, array['Prix', 'Moyennant le prix de']::text[], array['الثمن']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_acquisition_immobilisation', 'conditions_financieres', 'modalites_paiement', 'Modalités et échéancier de paiement', 'texte', 'oui', null::text, array['Payable']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_acquisition_immobilisation', 'conditions_financieres', 'frais_acte_droits', 'Frais d''acte, droits d''enregistrement, honoraires (capitalisables)', 'montant', 'selon_cas', null::text, array['Droits d''enregistrement', 'Frais']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN (taux d''enregistrement non vérifiés)', 'incertain'),
    ('contrat_acquisition_immobilisation', 'conditions_financieres', 'garanties_suretes', 'Garanties / privilèges / hypothèques', 'texte', 'non', null::text, array['Hypothèque', 'Privilège']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_acquisition_immobilisation', 'dates_formalites', 'date_signature', 'Date de signature', 'date', 'oui', null::text, array['Fait à … le']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_acquisition_immobilisation', 'dates_formalites', 'date_transfert_propriete', 'Date de transfert de propriété / jouissance', 'date', 'selon_cas', null::text, array['Entrée en jouissance']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_acquisition_immobilisation', 'dates_formalites', 'enregistrement', 'Mentions d''enregistrement (recette, date, numéro, droits payés)', 'texte', 'selon_cas', null::text, array['Enregistré à', 'Recette des finances']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('contrat_acquisition_immobilisation', 'dates_formalites', 'signatures_legalisees', 'Signatures légalisées', 'booleen', 'selon_cas', null::text, array['Signature légalisée']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('fiche_immobilisation', 'identification', 'code_immobilisation', 'Code / numéro d''inventaire', 'identifiant', 'oui', null::text, array['N° inventaire', 'Code immo']::text[], '{}'::text[], null::text, null::text, 'pratique (inventaire art. 17)', 'pratique'),
    ('fiche_immobilisation', 'identification', 'designation', 'Désignation', 'texte', 'oui', null::text, array['Désignation']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('fiche_immobilisation', 'identification', 'categorie_compte', 'Catégorie / compte d''immobilisation', 'liste', 'oui', null::text, array['Compte', 'Famille']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('fiche_immobilisation', 'identification', 'localisation', 'Localisation / site', 'texte', 'non', null::text, array['Emplacement']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('fiche_immobilisation', 'identification', 'numero_serie_immatriculation', 'N° série / immatriculation', 'identifiant', 'selon_cas', 'matériel, véhicule'::text, array['N° série', 'Immatriculation']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('fiche_immobilisation', 'identification', 'mode_detention', 'Propriété / leasing (NCT 41)', 'liste', 'oui', null::text, array['Leasing', 'Crédit-bail']::text[], '{}'::text[], null::text, null::text, 'NCT 41 (mémoire) ; pratique', 'pratique'),
    ('fiche_immobilisation', 'acquisition', 'fournisseur', 'Fournisseur', 'texte', 'non', null::text, array['Fournisseur']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('fiche_immobilisation', 'acquisition', 'reference_facture', 'Référence facture / acte / déclaration en douane', 'identifiant', 'oui', null::text, array['Facture']::text[], '{}'::text[], null::text, null::text, 'Loi 96-112 art. 12', 'texte'),
    ('fiche_immobilisation', 'acquisition', 'date_acquisition', 'Date d''acquisition', 'date', 'oui', null::text, array['Date d''acquisition']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('fiche_immobilisation', 'acquisition', 'date_mise_en_service', 'Date de mise en service (départ de l''amortissement)', 'date', 'oui', null::text, array['Date de mise en service']::text[], '{}'::text[], null::text, null::text, 'pratique (Air Liquide 2020)', 'pratique'),
    ('fiche_immobilisation', 'acquisition', 'prix_achat_ht', 'Prix d''achat HT', 'montant', 'oui', null::text, array['Prix d''achat']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('fiche_immobilisation', 'acquisition', 'frais_accessoires', 'Frais accessoires (transport, installation, droits de douane, droits d''enregistrement)', 'montant', 'selon_cas', null::text, array['Frais accessoires']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('fiche_immobilisation', 'acquisition', 'tva_non_recuperable', 'TVA non récupérable capitalisée', 'montant', 'selon_cas', 'ex. voiture de tourisme (règle de déduction INCERTAIN)'::text, array['TVA non récupérable']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('fiche_immobilisation', 'acquisition', 'valeur_origine', 'Valeur d''origine (coût d''entrée)', 'montant', 'oui', null::text, array['Valeur d''origine', 'Valeur brute', 'VO']::text[], '{}'::text[], null::text, null::text, 'pratique ; norme immobilisations corporelles INCERTAIN', 'incertain'),
    ('fiche_immobilisation', 'acquisition', 'subvention_liee', 'Subvention d''investissement liée', 'montant', 'non', null::text, array['Subvention']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('fiche_immobilisation', 'plan_amortissement', 'methode', 'Méthode (linéaire)', 'liste', 'oui', null::text, array['Linéaire', 'Mode']::text[], '{}'::text[], null::text, null::text, 'PwC (linéaire fiscal) ; autres méthodes : INCERTAIN', 'incertain'),
    ('fiche_immobilisation', 'plan_amortissement', 'duree', 'Durée d''utilité (années)', 'nombre', 'oui', null::text, array['Durée']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('fiche_immobilisation', 'plan_amortissement', 'taux_comptable', 'Taux comptable', 'taux', 'oui', null::text, array['Taux']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('fiche_immobilisation', 'plan_amortissement', 'taux_fiscal_max', 'Taux fiscal maximum (paramètre en base, issu du décret)', 'taux', 'selon_cas', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'Décret 2008-492 (via PwC : constructions 5 %, matériel et outillage 15 %) — INCERTAIN pour les autres catégories', 'incertain'),
    ('fiche_immobilisation', 'plan_amortissement', 'base_amortissable', 'Base amortissable (VO − valeur résiduelle)', 'montant', 'oui', null::text, array['Base amortissable']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('fiche_immobilisation', 'plan_amortissement', 'valeur_residuelle', 'Valeur résiduelle', 'montant', 'non', null::text, array['Valeur résiduelle']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('fiche_immobilisation', 'tableau_amortissement', 'exercice', 'Exercice', 'periode', 'oui', null::text, array['Exercice', 'Année']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('fiche_immobilisation', 'tableau_amortissement', 'vnc_debut', 'VNC début d''exercice', 'montant', 'oui', null::text, array['VNC début']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('fiche_immobilisation', 'tableau_amortissement', 'prorata_jours', 'Prorata temporis (jours ou mois)', 'nombre', 'selon_cas', 'année d''entrée / sortie'::text, array['Prorata']::text[], '{}'::text[], null::text, null::text, 'pratique (Air Liquide 2020)', 'pratique'),
    ('fiche_immobilisation', 'tableau_amortissement', 'dotation', 'Dotation de l''exercice', 'montant', 'oui', null::text, array['Dotation', 'Annuité']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('fiche_immobilisation', 'tableau_amortissement', 'cumul_amortissements', 'Amortissements cumulés', 'montant', 'oui', null::text, array['Cumul', 'Amortissements cumulés']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('fiche_immobilisation', 'tableau_amortissement', 'vnc_fin', 'VNC fin d''exercice', 'montant', 'oui', null::text, array['VNC', 'Valeur nette comptable']::text[], array['القيمة المحاسبية الصافية']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('fiche_immobilisation', 'tableau_amortissement', 'reintegration_fiscale', 'Excédent sur l''amortissement fiscal réintégré', 'montant', 'selon_cas', 'taux comptable > taux fiscal max'::text, array['Réintégration']::text[], '{}'::text[], null::text, null::text, 'PwC (décret 2008-492) — INCERTAIN', 'incertain'),
    ('fiche_immobilisation', 'tableau_amortissement', 'depreciation', 'Dépréciation / provision', 'montant', 'selon_cas', null::text, array['Provision pour dépréciation']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('fiche_immobilisation', 'tableau_amortissement', 'reevaluation', 'Réévaluation (écart, nouvelle base)', 'montant', 'selon_cas', 'modèle de réévaluation'::text, array['Réévaluation']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN (NC 05 révisée citée par CNT)', 'incertain'),
    ('fiche_immobilisation', 'sortie', 'date_sortie', 'Date de cession / mise au rebut', 'date', 'selon_cas', 'si sortie'::text, array['Date de cession']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('fiche_immobilisation', 'sortie', 'motif_sortie', 'Motif (cession, rebut, sinistre)', 'liste', 'selon_cas', null::text, array['Cession', 'Mise au rebut', 'Sinistre']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('fiche_immobilisation', 'sortie', 'prix_cession', 'Prix de cession / indemnité d''assurance', 'montant', 'selon_cas', null::text, array['Prix de cession']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('fiche_immobilisation', 'sortie', 'plus_moins_value', 'Plus ou moins-value', 'montant', 'selon_cas', null::text, array['Plus-value', 'Moins-value']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('pv_inventaire_stocks', 'entete', 'raison_sociale', 'Entreprise', 'texte', 'oui', null::text, array['Société']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_inventaire_stocks', 'entete', 'titre', 'Titre', 'texte', 'oui', null::text, array['Procès-verbal d''inventaire', 'PV d''inventaire physique']::text[], array['محضر جرد']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_inventaire_stocks', 'entete', 'date_inventaire', 'Date (et heure) du comptage', 'date', 'oui', null::text, array['Date de l''inventaire']::text[], '{}'::text[], null::text, null::text, 'Loi 96-112 art. 17', 'texte'),
    ('pv_inventaire_stocks', 'entete', 'date_reference', 'Date de référence (clôture) si inventaire décalé', 'date', 'selon_cas', 'inventaire tournant ou décalé'::text, array['Arrêté au']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_inventaire_stocks', 'entete', 'site_depot', 'Site / dépôt / magasin', 'texte', 'oui', null::text, array['Dépôt', 'Magasin', 'Site']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_inventaire_stocks', 'entete', 'nature_stocks', 'Nature (marchandises, matières premières, encours, produits finis, emballages)', 'liste', 'oui', null::text, array['Marchandises', 'Matières premières', 'Produits finis', 'Encours']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_inventaire_stocks', 'organisation', 'equipes_comptage', 'Membres des équipes (nom, fonction)', 'texte', 'oui', null::text, array['Équipe de comptage', 'Compteur', 'Contrôleur']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_inventaire_stocks', 'organisation', 'observateur_cac', 'Présence du commissaire aux comptes / observateur', 'texte', 'non', null::text, array['En présence de']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_inventaire_stocks', 'organisation', 'methode_comptage', 'Méthode (comptage simple, double comptage, pesée)', 'liste', 'non', null::text, array['Double comptage']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_inventaire_stocks', 'organisation', 'plage_fiches', 'Plage des fiches de comptage numérotées (émises, utilisées, annulées)', 'identifiant', 'non', null::text, array['Fiches n° … à …']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_inventaire_stocks', 'organisation', 'cut_off_entrees', 'Dernier bon de réception / entrée avant comptage', 'identifiant', 'selon_cas', null::text, array['Dernier bon de réception']::text[], '{}'::text[], null::text, null::text, 'pratique (séparation des exercices)', 'pratique'),
    ('pv_inventaire_stocks', 'organisation', 'cut_off_sorties', 'Dernier bon de livraison / sortie avant comptage', 'identifiant', 'selon_cas', null::text, array['Dernier bon de livraison']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_inventaire_stocks', 'lignes_articles', 'code_article', 'Code article', 'identifiant', 'oui', null::text, array['Code', 'Réf. article']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_inventaire_stocks', 'lignes_articles', 'designation_article', 'Désignation', 'texte', 'oui', null::text, array['Désignation']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_inventaire_stocks', 'lignes_articles', 'emplacement', 'Emplacement / allée', 'texte', 'non', null::text, array['Emplacement']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_inventaire_stocks', 'lignes_articles', 'unite', 'Unité de mesure', 'liste', 'oui', null::text, array['Unité', 'U', 'Kg']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_inventaire_stocks', 'lignes_articles', 'lot_peremption', 'N° de lot / date de péremption', 'texte', 'selon_cas', 'denrées, produits pharmaceutiques'::text, array['Lot', 'DLC']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_inventaire_stocks', 'lignes_articles', 'quantite_comptee', 'Quantité comptée', 'nombre', 'oui', null::text, array['Quantité comptée', 'Qté physique']::text[], '{}'::text[], null::text, null::text, 'Loi 96-112 art. 17 (existence)', 'texte'),
    ('pv_inventaire_stocks', 'lignes_articles', 'quantite_theorique', 'Quantité théorique (inventaire permanent)', 'nombre', 'selon_cas', 'inventaire permanent'::text, array['Qté théorique', 'Stock informatique']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_inventaire_stocks', 'lignes_articles', 'ecart_quantite', 'Écart', 'nombre', 'selon_cas', null::text, array['Écart']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_inventaire_stocks', 'lignes_articles', 'etat_article', 'État (bon, endommagé, obsolète, à rotation lente)', 'liste', 'non', null::text, array['Obsolète', 'Détérioré']::text[], '{}'::text[], null::text, null::text, 'pratique (base de la dépréciation)', 'pratique'),
    ('pv_inventaire_stocks', 'lignes_articles', 'cout_unitaire', 'Coût unitaire retenu', 'montant', 'selon_cas', 'PV valorisé'::text, array['P.U.', 'Coût unitaire', 'CUMP']::text[], '{}'::text[], null::text, null::text, 'pratique (Loi 96-112 art. 17 : valeur)', 'pratique'),
    ('pv_inventaire_stocks', 'lignes_articles', 'valeur_ligne', 'Valeur', 'montant', 'selon_cas', 'PV valorisé'::text, array['Valeur', 'Montant']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_inventaire_stocks', 'stocks_particuliers', 'stocks_chez_tiers', 'Stocks détenus chez des tiers (dépôt, consignation, sous-traitants)', 'montant', 'selon_cas', null::text, array['Stocks chez tiers']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_inventaire_stocks', 'stocks_particuliers', 'stocks_de_tiers', 'Stocks appartenant à des tiers détenus (à exclure)', 'montant', 'selon_cas', null::text, array['Marchandises en dépôt']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_inventaire_stocks', 'stocks_particuliers', 'stocks_en_transit', 'Marchandises en cours de route / sous douane', 'montant', 'selon_cas', null::text, array['En transit', 'En cours de route']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_inventaire_stocks', 'cloture_pv', 'total_quantites_valeur', 'Totaux (par famille et général)', 'montant', 'oui', null::text, array['Total général']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_inventaire_stocks', 'cloture_pv', 'observations_reserves', 'Observations / réserves', 'texte', 'non', null::text, array['Observations', 'Réserves']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_inventaire_stocks', 'cloture_pv', 'signatures', 'Signatures des participants et du responsable', 'texte', 'oui', null::text, array['Signatures']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('declaration_douane_import', 'identification_declaration', 'numero_enregistrement', 'Numéro d''enregistrement de la déclaration', 'identifiant', 'oui', null::text, array['N° déclaration', 'N° d''enregistrement']::text[], '{}'::text[], null::text, null::text, 'Code des douanes (enregistrement : art. 33, 125)', 'texte'),
    ('declaration_douane_import', 'identification_declaration', 'date_enregistrement', 'Date d''enregistrement (fait générateur du taux et du cours)', 'date', 'oui', null::text, array['Date d''enregistrement']::text[], '{}'::text[], null::text, null::text, 'Code des douanes art. 33 et 125', 'texte'),
    ('declaration_douane_import', 'identification_declaration', 'bureau_douane', 'Bureau de dédouanement', 'texte', 'oui', null::text, array['Bureau', 'Bureau de douane']::text[], array['مكتب الديوانة']::text[], null::text, null::text, 'INCERTAIN (énonciations fixées par arrêté non lu)', 'incertain'),
    ('declaration_douane_import', 'identification_declaration', 'regime_douanier', 'Régime (mise à la consommation, entrepôt, admission temporaire, perfectionnement actif…) et code', 'liste', 'oui', null::text, array['Régime', 'Mise à la consommation', 'Admission temporaire']::text[], '{}'::text[], null::text, null::text, 'Manuel import 2022 (régimes) ; codes numériques INCERTAIN', 'incertain'),
    ('declaration_douane_import', 'identification_declaration', 'type_declaration', 'Type / code de déclaration (ex. DDM, DAE)', 'liste', 'selon_cas', null::text, array['DDM', 'DAE']::text[], '{}'::text[], null::text, null::text, 'Manuel import 2022', 'texte'),
    ('declaration_douane_import', 'operateurs', 'importateur_nom', 'Importateur / destinataire réel', 'texte', 'oui', null::text, array['Importateur', 'Destinataire']::text[], array['المورد']::text[], null::text, null::text, 'INCERTAIN (arrêté art. 111)', 'incertain'),
    ('declaration_douane_import', 'operateurs', 'importateur_mf_code', 'Matricule fiscal / code en douane de l''importateur', 'identifiant', 'oui', null::text, array['Code en douane', 'MF']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('declaration_douane_import', 'operateurs', 'declarant', 'Déclarant / commissionnaire en douane (n° d''agrément)', 'texte', 'oui', null::text, array['Déclarant', 'Commissionnaire en douane', 'Transitaire']::text[], '{}'::text[], null::text, null::text, 'Code des douanes art. 101 et 111 §3 (signature)', 'texte'),
    ('declaration_douane_import', 'operateurs', 'expediteur', 'Expéditeur / fournisseur étranger', 'texte', 'oui', null::text, array['Expéditeur', 'Fournisseur']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('declaration_douane_import', 'transport_origine', 'pays_provenance', 'Pays de provenance / d''expédition', 'liste', 'oui', null::text, array['Pays de provenance']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('declaration_douane_import', 'transport_origine', 'pays_origine', 'Pays d''origine (par article)', 'liste', 'oui', null::text, array['Pays d''origine', 'Origine']::text[], array['بلد المنشأ']::text[], null::text, null::text, 'Code des douanes (règles d''origine, art. 21 environ — INCERTAIN)', 'incertain'),
    ('declaration_douane_import', 'transport_origine', 'mode_transport', 'Mode de transport', 'liste', 'oui', null::text, array['Mode de transport', 'Maritime', 'Aérien', 'Routier']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('declaration_douane_import', 'transport_origine', 'titre_transport', 'Titre de transport (connaissement, LTA, lettre de voiture) et manifeste', 'identifiant', 'oui', null::text, array['Connaissement', 'B/L', 'LTA', 'Manifeste']::text[], '{}'::text[], null::text, null::text, 'Manuel import 2022 (connaissement joint)', 'texte'),
    ('declaration_douane_import', 'transport_origine', 'navire_vol', 'Navire / vol / immatriculation camion', 'texte', 'selon_cas', null::text, array['Navire', 'Vol']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('declaration_douane_import', 'transport_origine', 'incoterm', 'Conditions de livraison (Incoterm)', 'liste', 'selon_cas', null::text, array['Incoterm', 'FOB', 'CFR', 'CIF', 'EXW']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('declaration_douane_import', 'valeur', 'devise_facture', 'Devise de la facture', 'liste', 'oui', null::text, array['Devise', 'Monnaie']::text[], '{}'::text[], null::text, null::text, 'Code des douanes art. 33', 'texte'),
    ('declaration_douane_import', 'valeur', 'montant_facture_devise', 'Montant total facturé en devise', 'montant', 'oui', null::text, array['Montant facture', 'Valeur facture']::text[], '{}'::text[], null::text, null::text, 'Code des douanes art. 22', 'texte'),
    ('declaration_douane_import', 'valeur', 'cours_change', 'Taux de change appliqué', 'taux', 'oui', null::text, array['Cours', 'Taux de change']::text[], array['سعر الصرف']::text[], null::text, null::text, 'Code des douanes art. 33 ; source du cours (BCT) INCERTAIN', 'incertain'),
    ('declaration_douane_import', 'valeur', 'fret', 'Fret jusqu''à la frontière', 'montant', 'selon_cas', 'si non inclus dans le prix'::text, array['Fret']::text[], '{}'::text[], null::text, null::text, 'Manuel import 2022 (valeur majorée transport et assurance)', 'texte'),
    ('declaration_douane_import', 'valeur', 'assurance_transport', 'Assurance transport', 'montant', 'selon_cas', null::text, array['Assurance']::text[], '{}'::text[], null::text, null::text, 'Manuel import 2022', 'texte'),
    ('declaration_douane_import', 'valeur', 'valeur_en_douane_dt', 'Valeur en douane en dinars', 'montant', 'oui', null::text, array['Valeur en douane', 'Valeur CAF']::text[], array['القيمة لدى الديوانة']::text[], null::text, null::text, 'Code des douanes art. 22 et 33', 'texte'),
    ('declaration_douane_import', 'valeur', 'methode_evaluation', 'Méthode d''évaluation (transactionnelle ou substitution)', 'liste', 'selon_cas', null::text, array['Valeur transactionnelle']::text[], '{}'::text[], null::text, null::text, 'Manuel import 2022', 'texte'),
    ('declaration_douane_import', 'articles', 'numero_article', 'N° d''article de la déclaration', 'nombre', 'oui', null::text, array['Article']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('declaration_douane_import', 'articles', 'position_tarifaire', 'Nomenclature / position tarifaire (NGP)', 'identifiant', 'oui', null::text, array['Position tarifaire', 'NGP', 'Code SH', 'Nomenclature']::text[], array['التعريفة الديوانية']::text[], null::text, null::text, 'Manuel import 2022 (nomenclature à préciser)', 'texte'),
    ('declaration_douane_import', 'articles', 'designation_commerciale', 'Désignation commerciale', 'texte', 'oui', null::text, array['Désignation']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('declaration_douane_import', 'articles', 'colis', 'Nombre et nature des colis, marques', 'texte', 'oui', null::text, array['Colis', 'Marques']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('declaration_douane_import', 'articles', 'poids_brut', 'Poids brut', 'nombre', 'oui', null::text, array['Poids brut']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('declaration_douane_import', 'articles', 'poids_net', 'Poids net', 'nombre', 'oui', null::text, array['Poids net']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('declaration_douane_import', 'articles', 'quantite_unite_complementaire', 'Quantité en unité complémentaire', 'nombre', 'selon_cas', null::text, array['Unité complémentaire']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('declaration_douane_import', 'articles', 'valeur_article_dt', 'Valeur en douane de l''article', 'montant', 'oui', null::text, array['Valeur']::text[], '{}'::text[], null::text, null::text, 'Code des douanes art. 22', 'texte'),
    ('declaration_douane_import', 'articles', 'avantage_fiscal', 'Code d''avantage / exonération / suspension et texte de référence', 'texte', 'selon_cas', null::text, array['Avantage', 'Exonération', 'Suspension']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('declaration_douane_import', 'liquidation', 'taux_droit_douane', 'Taux du droit de douane (par article)', 'taux', 'oui', null::text, array['DD', 'Droit de douane']::text[], array['المعاليم الديوانية']::text[], null::text, null::text, 'Tarif douanier (non lu) ; nomenclature détermine le taux (Manuel 2022)', 'texte'),
    ('declaration_douane_import', 'liquidation', 'montant_droit_douane', 'Montant du droit de douane', 'montant', 'oui', null::text, array['Droit de douane']::text[], '{}'::text[], null::text, null::text, 'Code des douanes art. 22 (base ad valorem)', 'texte'),
    ('declaration_douane_import', 'liquidation', 'droit_consommation', 'Droit de consommation', 'montant', 'selon_cas', 'produits soumis'::text, array['DC', 'Droit de consommation']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN (taux et assiette non lus)', 'incertain'),
    ('declaration_douane_import', 'liquidation', 'tva_import', 'TVA à l''importation (taux, base, montant)', 'montant', 'selon_cas', null::text, array['TVA']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN (assiette TVA import non lue)', 'incertain'),
    ('declaration_douane_import', 'liquidation', 'autres_taxes', 'Autres taxes et redevances (par code)', 'montant', 'selon_cas', null::text, array['Redevance', 'Taxe']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('declaration_douane_import', 'liquidation', 'total_liquide', 'Total des droits et taxes liquidés', 'montant', 'oui', null::text, array['Total liquidé', 'Total à payer']::text[], '{}'::text[], null::text, null::text, 'Code des douanes art. 127', 'texte'),
    ('declaration_douane_import', 'liquidation', 'mode_paiement', 'Mode de paiement (comptant, crédit d''enlèvement, obligation cautionnée, consignation)', 'liste', 'oui', null::text, array['Comptant', 'Crédit d''enlèvement', 'Consignation']::text[], '{}'::text[], null::text, null::text, 'Code des douanes art. 127-130 ; Manuel 2022', 'texte'),
    ('declaration_douane_import', 'documents_annexes', 'reference_facture', 'Référence(s) de la facture commerciale', 'identifiant', 'oui', null::text, array['Facture n°']::text[], '{}'::text[], null::text, null::text, 'Manuel import 2022', 'texte'),
    ('declaration_douane_import', 'documents_annexes', 'titre_commerce_exterieur', 'Titre de commerce extérieur (facture définitive domiciliée / autorisation d''importation)', 'identifiant', 'oui', null::text, array['TCE', 'Facture domiciliée', 'Autorisation d''importation']::text[], '{}'::text[], null::text, null::text, 'Manuel import 2022', 'texte'),
    ('declaration_douane_import', 'documents_annexes', 'banque_domiciliataire', 'Banque domiciliataire et n° de domiciliation', 'identifiant', 'oui', null::text, array['Domiciliation', 'Banque']::text[], '{}'::text[], null::text, null::text, 'Manuel import 2022', 'texte'),
    ('declaration_douane_import', 'documents_annexes', 'reference_certificat_origine', 'Référence du certificat d''origine', 'identifiant', 'selon_cas', 'régime préférentiel ou exigence'::text, array['EUR.1', 'Certificat d''origine']::text[], '{}'::text[], null::text, null::text, 'Manuel import 2022', 'texte'),
    ('declaration_douane_import', 'documents_annexes', 'controle_technique', 'Référence contrôle technique (AMC / APE) ou SPS', 'identifiant', 'selon_cas', 'produits soumis'::text, array['AMC', 'APE']::text[], '{}'::text[], null::text, null::text, 'Manuel import 2022', 'texte'),
    ('declaration_douane_import', 'documents_annexes', 'signature_declarant', 'Signature du déclarant', 'texte', 'oui', null::text, array['Signature']::text[], '{}'::text[], null::text, null::text, 'Code des douanes art. 111 §3', 'texte')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('declaration_douane_export', 'identification', 'numero_enregistrement', 'Numéro d''enregistrement', 'identifiant', 'oui', null::text, array['N° déclaration']::text[], '{}'::text[], null::text, null::text, 'Code des douanes', 'texte'),
    ('declaration_douane_export', 'identification', 'date_enregistrement', 'Date d''enregistrement', 'date', 'oui', null::text, array['Date']::text[], '{}'::text[], null::text, null::text, 'Code des douanes art. 33, 125', 'texte'),
    ('declaration_douane_export', 'identification', 'bureau_sortie', 'Bureau de douane / de sortie', 'texte', 'oui', null::text, array['Bureau']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('declaration_douane_export', 'identification', 'regime', 'Régime (export définitif, réexportation, régime totalement exportateur…)', 'liste', 'oui', null::text, array['Régime', 'Exportation définitive']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN (codes)', 'incertain'),
    ('declaration_douane_export', 'operateurs', 'exportateur', 'Exportateur (raison sociale, MF, code en douane)', 'texte', 'oui', null::text, array['Exportateur']::text[], array['المصدر']::text[], null::text, null::text, 'INCERTAIN (arrêté art. 111)', 'incertain'),
    ('declaration_douane_export', 'operateurs', 'destinataire', 'Destinataire étranger', 'texte', 'oui', null::text, array['Destinataire']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('declaration_douane_export', 'operateurs', 'declarant', 'Déclarant / commissionnaire', 'texte', 'oui', null::text, array['Déclarant']::text[], '{}'::text[], null::text, null::text, 'Code des douanes art. 101', 'texte'),
    ('declaration_douane_export', 'marchandises_valeur', 'pays_destination', 'Pays de destination', 'liste', 'oui', null::text, array['Pays de destination']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('declaration_douane_export', 'marchandises_valeur', 'position_tarifaire', 'Position tarifaire', 'identifiant', 'oui', null::text, array['NGP']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('declaration_douane_export', 'marchandises_valeur', 'designation', 'Désignation, colis, poids brut/net', 'texte', 'oui', null::text, array['Désignation', 'Poids']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('declaration_douane_export', 'marchandises_valeur', 'devise_montant', 'Devise et montant facturé', 'montant', 'oui', null::text, array['Valeur facture']::text[], '{}'::text[], null::text, null::text, 'Code des douanes art. 37', 'texte'),
    ('declaration_douane_export', 'marchandises_valeur', 'cours_change', 'Cours de change', 'taux', 'oui', null::text, array['Cours']::text[], '{}'::text[], null::text, null::text, 'Code des douanes art. 33', 'texte'),
    ('declaration_douane_export', 'marchandises_valeur', 'valeur_export_dt', 'Valeur à l''exportation en dinars (FOB / point de sortie)', 'montant', 'oui', null::text, array['Valeur FOB', 'Valeur statistique']::text[], '{}'::text[], null::text, null::text, 'Code des douanes art. 37', 'texte'),
    ('declaration_douane_export', 'marchandises_valeur', 'incoterm', 'Incoterm', 'liste', 'selon_cas', null::text, array['FOB', 'CIF']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('declaration_douane_export', 'marchandises_valeur', 'titre_transport', 'Titre de transport', 'identifiant', 'selon_cas', null::text, array['Connaissement', 'LTA', 'CMR']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('declaration_douane_export', 'change_documents', 'domiciliation_banque', 'Domiciliation bancaire / engagement de rapatriement', 'identifiant', 'selon_cas', null::text, array['Domiciliation', 'Rapatriement']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN (réglementation des changes non lue)', 'incertain'),
    ('declaration_douane_export', 'change_documents', 'reference_certificat_origine', 'Référence certificat d''origine / EUR.1', 'identifiant', 'selon_cas', 'demande du client / accord préférentiel'::text, array['EUR.1']::text[], '{}'::text[], null::text, null::text, 'Code des douanes (visa CO) — INCERTAIN', 'incertain'),
    ('declaration_douane_export', 'change_documents', 'visa_sortie', 'Visa / attestation de sortie effective (embarquement)', 'texte', 'selon_cas', null::text, array['Vu embarquer', 'Bon de sortie']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('document_dedouanement', 'quittance', 'numero_quittance', 'Numéro de quittance', 'identifiant', 'oui', 'si paiement'::text, array['Quittance n°']::text[], array['وصل خلاص']::text[], null::text, null::text, 'Code des douanes art. 127 §2', 'texte'),
    ('document_dedouanement', 'quittance', 'date_paiement', 'Date de paiement', 'date', 'oui', null::text, array['Date']::text[], '{}'::text[], null::text, null::text, 'Code des douanes art. 127', 'texte'),
    ('document_dedouanement', 'quittance', 'numero_declaration', 'Déclaration acquittée', 'identifiant', 'oui', null::text, array['N° déclaration']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('document_dedouanement', 'quittance', 'detail_droits', 'Détail par nature de droit / taxe', 'montant', 'selon_cas', null::text, array['DD', 'TVA', 'DC']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('document_dedouanement', 'quittance', 'montant_paye', 'Montant total payé', 'montant', 'oui', null::text, array['Montant', 'Total payé']::text[], '{}'::text[], null::text, null::text, 'Code des douanes art. 127', 'texte'),
    ('document_dedouanement', 'quittance', 'mode_reglement', 'Mode (espèces, chèque, virement, paiement électronique, crédit d''enlèvement)', 'liste', 'selon_cas', null::text, array['Mode de paiement']::text[], '{}'::text[], null::text, null::text, 'Code des douanes art. 127-130', 'texte'),
    ('document_dedouanement', 'quittance', 'recette', 'Recette des douanes / bureau', 'texte', 'oui', null::text, array['Recette', 'Receveur']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('document_dedouanement', 'bon_a_enlever', 'numero_bae', 'Bon à enlever (référence, date)', 'identifiant', 'oui', null::text, array['BAE', 'Bon à enlever']::text[], '{}'::text[], null::text, null::text, 'Manuel import 2022', 'texte'),
    ('document_dedouanement', 'bon_a_enlever', 'circuit_controle', 'Circuit de contrôle / résultat de visite', 'liste', 'non', null::text, array['Visite', 'Circuit']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('document_dedouanement', 'bon_a_enlever', 'redressement', 'Redressement / liquidation complémentaire', 'montant', 'selon_cas', 'si rectification'::text, array['Liquidation complémentaire']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('document_dedouanement', 'sortie', 'bon_sortie', 'Bon de sortie (n°, date)', 'identifiant', 'selon_cas', null::text, array['Bon de sortie']::text[], '{}'::text[], null::text, null::text, 'Manuel import 2022', 'texte'),
    ('document_dedouanement', 'sortie', 'bon_pesage', 'Bon de pesage', 'identifiant', 'selon_cas', 'si applicable'::text, array['Bon de pesage']::text[], '{}'::text[], null::text, null::text, 'Manuel import 2022', 'texte'),
    ('document_dedouanement', 'sortie', 'frais_annexes', 'Frais portuaires, magasinage, transitaire (factures distinctes)', 'montant', 'non', null::text, array['Magasinage', 'Redevances portuaires', 'Honoraires transitaire']::text[], '{}'::text[], null::text, null::text, 'Manuel import 2022 (redevances portuaires distinctes)', 'texte')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('certificat_origine', 'identification', 'type_certificat', 'Type (EUR.1, EUR-MED, certificat d''origine ordinaire, déclaration d''origine sur facture, ZLECAf, autres accords)', 'liste', 'oui', null::text, array['EUR.1', 'EUR-MED', 'Certificat d''origine', 'Movement certificate']::text[], array['شهادة المنشأ']::text[], null::text, null::text, 'pratique ; liste des formulaires par accord INCERTAIN', 'incertain'),
    ('certificat_origine', 'identification', 'numero_certificat', 'Numéro du certificat', 'identifiant', 'oui', 'certificat (pas déclaration sur facture)'::text, array['N°', 'No']::text[], '{}'::text[], null::text, null::text, 'pratique (modèle EUR.1 de la convention pan-euro-méditerranéenne : INCERTAIN, non lu)', 'incertain'),
    ('certificat_origine', 'identification', 'accord_preferentiel', 'Échanges préférentiels entre … et … (accord)', 'texte', 'selon_cas', 'certificat préférentiel'::text, array['Certificat utilisé dans les échanges préférentiels entre']::text[], '{}'::text[], null::text, null::text, 'pratique (case 2 EUR.1 — INCERTAIN)', 'incertain'),
    ('certificat_origine', 'parties', 'exportateur', 'Exportateur (nom, adresse, pays)', 'texte', 'oui', null::text, array['Exportateur', 'Exporter']::text[], '{}'::text[], null::text, null::text, 'pratique (case 1 EUR.1 — INCERTAIN)', 'incertain'),
    ('certificat_origine', 'parties', 'destinataire', 'Destinataire', 'texte', 'selon_cas', 'facultatif sur certains modèles'::text, array['Destinataire', 'Consignee']::text[], '{}'::text[], null::text, null::text, 'pratique (case 3 EUR.1 — INCERTAIN)', 'incertain'),
    ('certificat_origine', 'parties', 'numero_exportateur_agree', 'N° d''exportateur agréé / enregistré', 'identifiant', 'selon_cas', 'déclaration d''origine'::text, array['Exportateur agréé']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('certificat_origine', 'origine_destination', 'pays_origine', 'Pays, groupe de pays ou territoire d''origine', 'liste', 'oui', null::text, array['Pays d''origine', 'Country of origin']::text[], array['بلد المنشأ']::text[], null::text, null::text, 'Code des douanes (origine) ; case 4 EUR.1 — INCERTAIN', 'incertain'),
    ('certificat_origine', 'origine_destination', 'pays_destination', 'Pays de destination', 'liste', 'oui', null::text, array['Pays de destination']::text[], '{}'::text[], null::text, null::text, 'pratique (case 5 EUR.1 — INCERTAIN)', 'incertain'),
    ('certificat_origine', 'origine_destination', 'transport', 'Informations relatives au transport', 'texte', 'non', null::text, array['Transport details']::text[], '{}'::text[], null::text, null::text, 'pratique (case 6 EUR.1 — INCERTAIN)', 'incertain'),
    ('certificat_origine', 'origine_destination', 'observations', 'Observations (ex. délivré a posteriori, duplicata)', 'texte', 'non', null::text, array['Observations', 'Remarks']::text[], '{}'::text[], null::text, null::text, 'pratique (case 7 EUR.1 — INCERTAIN)', 'incertain'),
    ('certificat_origine', 'marchandises', 'numero_ordre_marques_colis', 'N° d''ordre, marques, numéros, nombre et nature des colis', 'texte', 'oui', null::text, array['Marques et numéros', 'Nombre et nature des colis']::text[], '{}'::text[], null::text, null::text, 'pratique (case 8 EUR.1 — INCERTAIN)', 'incertain'),
    ('certificat_origine', 'marchandises', 'designation_marchandises', 'Désignation des marchandises', 'texte', 'oui', null::text, array['Désignation des marchandises']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('certificat_origine', 'marchandises', 'position_tarifaire', 'Position SH', 'identifiant', 'selon_cas', 'selon accord'::text, array['HS code']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('certificat_origine', 'marchandises', 'masse_brute', 'Masse brute ou autre mesure', 'nombre', 'oui', null::text, array['Masse brute', 'Gross mass']::text[], '{}'::text[], null::text, null::text, 'pratique (case 9 EUR.1 — INCERTAIN)', 'incertain'),
    ('certificat_origine', 'marchandises', 'factures', 'Références des factures', 'identifiant', 'non', null::text, array['Factures', 'Invoices']::text[], '{}'::text[], null::text, null::text, 'pratique (case 10 EUR.1 — INCERTAIN)', 'incertain'),
    ('certificat_origine', 'visas', 'visa_autorite', 'Visa de la douane ou de la chambre de commerce (bureau, date, cachet, signature, référence du document d''exportation)', 'texte', 'oui', 'certificat'::text, array['Visa de la douane', 'Customs endorsement', 'Chambre de commerce']::text[], '{}'::text[], null::text, null::text, 'Code des douanes (visa) ; case 11 EUR.1 — INCERTAIN', 'incertain'),
    ('certificat_origine', 'visas', 'date_visa', 'Date de visa', 'date', 'oui', null::text, array['Date']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('certificat_origine', 'visas', 'declaration_exportateur', 'Déclaration et signature de l''exportateur (lieu, date)', 'texte', 'oui', null::text, array['Déclaration de l''exportateur', 'Declaration by the exporter']::text[], '{}'::text[], null::text, null::text, 'pratique (case 12 EUR.1 — INCERTAIN)', 'incertain')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('contrat_assurance', 'parties', 'assureur', 'Entreprise d''assurances (raison sociale, adresse)', 'texte', 'oui', null::text, array['Assureur', 'Compagnie']::text[], array['شركة التأمين']::text[], null::text, null::text, 'arrêté 22/11/2001 (identification de l''assureur — INCERTAIN)', 'incertain'),
    ('contrat_assurance', 'parties', 'intermediaire', 'Intermédiaire (agent général, courtier) et code', 'texte', 'selon_cas', null::text, array['Agent', 'Courtier', 'Intermédiaire']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_assurance', 'parties', 'souscripteur', 'Souscripteur (débiteur de la prime)', 'texte', 'oui', null::text, array['Souscripteur', 'Preneur d''assurance']::text[], array['المكتتب']::text[], null::text, null::text, 'pratique ; art. 14 CAT (taxes) cité par mémoire', 'pratique'),
    ('contrat_assurance', 'parties', 'assure', 'Assuré (si différent)', 'texte', 'selon_cas', null::text, array['Assuré']::text[], array['المؤمن له']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_assurance', 'parties', 'beneficiaire_delegation', 'Bénéficiaire / délégation / créancier privilégié (bailleur de leasing, banque)', 'texte', 'selon_cas', 'bien en leasing ou nanti'::text, array['Bénéficiaire', 'Délégation', 'Clause de délégation']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_assurance', 'contrat', 'numero_police', 'Numéro de police', 'identifiant', 'oui', null::text, array['Police n°', 'Contrat n°']::text[], array['عقد عدد']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_assurance', 'contrat', 'branche_produit', 'Branche / nom commercial du contrat (automobile, multirisque, incendie, transport, RC, flotte…)', 'liste', 'oui', null::text, array['Multirisque', 'Automobile', 'Incendie', 'Responsabilité civile', 'Facultés']::text[], '{}'::text[], null::text, null::text, 'arrêté 22/11/2001 (nom commercial — INCERTAIN)', 'incertain'),
    ('contrat_assurance', 'contrat', 'reference_conditions_generales', 'Référence et version des conditions générales', 'identifiant', 'oui', null::text, array['Conditions générales', 'CG réf.']::text[], array['الشروط العامة']::text[], null::text, null::text, 'CAT art. 46 (dépôt CG) — INCERTAIN', 'incertain'),
    ('contrat_assurance', 'contrat', 'date_souscription', 'Date de souscription', 'date', 'oui', null::text, array['Fait à … le', 'Date de souscription']::text[], '{}'::text[], null::text, null::text, 'CCMT art. 302 (maritime) ; pratique', 'pratique'),
    ('contrat_assurance', 'contrat', 'date_effet', 'Date d''effet', 'date', 'oui', null::text, array['Date d''effet', 'Prise d''effet']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_assurance', 'contrat', 'echeance_principale', 'Échéance principale / date d''expiration', 'date', 'oui', null::text, array['Échéance', 'Expiration']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_assurance', 'contrat', 'duree_reconduction', 'Durée et tacite reconduction', 'texte', 'oui', null::text, array['Durée', 'Tacite reconduction']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN (articles CAT sur la durée non lus)', 'incertain'),
    ('contrat_assurance', 'contrat', 'langue', 'Langue du contrat', 'liste', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'arrêté 22/11/2001 art. 1 (arabe) selon mémoire', 'texte'),
    ('contrat_assurance', 'risques_garanties', 'biens_risques_assures', 'Biens ou risques assurés (adresse du risque, véhicule : immatriculation, châssis)', 'texte', 'oui', null::text, array['Objet de l''assurance', 'Situation du risque', 'Véhicule assuré']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_assurance', 'risques_garanties', 'garanties', 'Garanties souscrites', 'liste', 'oui', null::text, array['Garanties', 'RC', 'Vol', 'Incendie', 'Dommages collision', 'Bris de glace']::text[], '{}'::text[], null::text, null::text, 'arrêté 22/11/2001 (caractéristiques — INCERTAIN)', 'incertain'),
    ('contrat_assurance', 'risques_garanties', 'capitaux_limites', 'Capitaux assurés / limites par garantie', 'montant', 'oui', null::text, array['Capital assuré', 'Limite', 'Valeur assurée']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_assurance', 'risques_garanties', 'franchises', 'Franchises', 'montant', 'selon_cas', null::text, array['Franchise']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_assurance', 'risques_garanties', 'exclusions', 'Exclusions et déchéances (caractères très apparents)', 'texte', 'oui', null::text, array['Exclusions', 'Déchéance']::text[], '{}'::text[], null::text, null::text, 'CAT art. 12 §3 (via mémoire)', 'texte'),
    ('contrat_assurance', 'risques_garanties', 'regle_proportionnelle', 'Règle proportionnelle / valeur à neuf / indexation', 'texte', 'selon_cas', null::text, array['Règle proportionnelle', 'Valeur à neuf']::text[], '{}'::text[], null::text, null::text, 'arrêté 22/11/2001 (notice règle proportionnelle en annexe — INCERTAIN)', 'incertain'),
    ('contrat_assurance', 'prime', 'prime_nette', 'Prime nette', 'montant', 'oui', null::text, array['Prime nette']::text[], array['القسط الصافي']::text[], null::text, null::text, 'arrêté 22/11/2001 (précisions sur les primes — INCERTAIN)', 'incertain'),
    ('contrat_assurance', 'prime', 'accessoires', 'Accessoires / frais', 'montant', 'selon_cas', null::text, array['Accessoires', 'Frais']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_assurance', 'prime', 'taxes', 'Taxes et contributions sur la prime', 'montant', 'selon_cas', null::text, array['Taxes', 'FGA', 'Timbre']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN (taux non vérifiés)', 'incertain'),
    ('contrat_assurance', 'prime', 'prime_ttc', 'Prime totale TTC', 'montant', 'oui', null::text, array['Prime totale', 'Prime TTC', 'Total à payer']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_assurance', 'prime', 'fractionnement', 'Périodicité / fractionnement', 'liste', 'selon_cas', null::text, array['Annuel', 'Semestriel', 'Trimestriel']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_assurance', 'prime', 'bonus_malus', 'Bonus-malus / réduction', 'taux', 'selon_cas', 'automobile'::text, array['Bonus', 'Malus']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('contrat_assurance', 'avenants_attestation', 'numero_avenant', 'Numéro, date et objet de l''avenant', 'identifiant', 'selon_cas', 'modification'::text, array['Avenant n°']::text[], array['ملحق']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_assurance', 'avenants_attestation', 'prime_avenant', 'Prime ou ristourne d''avenant', 'montant', 'selon_cas', null::text, array['Ristourne', 'Surprime']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_assurance', 'avenants_attestation', 'attestation_assurance', 'Attestation d''assurance automobile (période de validité, véhicule)', 'periode', 'selon_cas', 'véhicule (assurance RC automobile obligatoire)'::text, array['Attestation d''assurance', 'Carte d''assurance']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN (texte d''obligation non lu)', 'incertain'),
    ('contrat_assurance', 'avenants_attestation', 'signatures', 'Signatures assureur et souscripteur', 'texte', 'oui', null::text, array['Lu et approuvé']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('avis_echeance_assurance', 'identification', 'assureur', 'Assureur / intermédiaire', 'texte', 'oui', null::text, array['Assureur', 'Agence']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avis_echeance_assurance', 'identification', 'numero_avis', 'Numéro d''avis / de quittance', 'identifiant', 'oui', null::text, array['Avis n°', 'Quittance n°']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avis_echeance_assurance', 'identification', 'numero_police', 'Numéro de police', 'identifiant', 'oui', null::text, array['Police n°']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avis_echeance_assurance', 'identification', 'souscripteur', 'Souscripteur', 'texte', 'oui', null::text, array['Souscripteur']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avis_echeance_assurance', 'identification', 'risque_concerne', 'Risque / véhicule concerné', 'texte', 'selon_cas', null::text, array['Véhicule', 'Risque']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avis_echeance_assurance', 'periode_montants', 'date_echeance', 'Date d''échéance', 'date', 'oui', null::text, array['Échéance du']::text[], array['تاريخ الاستحقاق']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avis_echeance_assurance', 'periode_montants', 'periode_couverte', 'Période couverte (du … au …)', 'periode', 'oui', null::text, array['Période du … au …']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avis_echeance_assurance', 'periode_montants', 'prime_nette', 'Prime nette', 'montant', 'oui', null::text, array['Prime nette']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avis_echeance_assurance', 'periode_montants', 'accessoires', 'Accessoires', 'montant', 'selon_cas', null::text, array['Accessoires']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avis_echeance_assurance', 'periode_montants', 'taxes', 'Taxes', 'montant', 'selon_cas', null::text, array['Taxes']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('avis_echeance_assurance', 'periode_montants', 'montant_ttc', 'Montant total à payer', 'montant', 'oui', null::text, array['Total à payer', 'Prime TTC']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avis_echeance_assurance', 'periode_montants', 'date_limite_paiement', 'Date limite de paiement', 'date', 'selon_cas', null::text, array['À régler avant le']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avis_echeance_assurance', 'periode_montants', 'modes_paiement', 'Modes de paiement', 'liste', 'non', null::text, array['Mode de règlement']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avis_echeance_assurance', 'periode_montants', 'mention_non_paiement', 'Mention des conséquences du non-paiement', 'texte', 'selon_cas', null::text, array['À défaut de paiement']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('avis_echeance_assurance', 'periode_montants', 'statut_paiement', 'Acquitté (quittance) ou à payer (avis)', 'booleen', 'oui', null::text, array['Acquitté', 'Pour acquit']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('carte_grise', 'immatriculation', 'numero_immatriculation', 'Numéro d''immatriculation (série tunisienne : numéro + TU / تونس + numéro, ou séries spéciales RS, etc.)', 'identifiant', 'oui', null::text, array['Immatriculation', 'N° d''immatriculation', 'TU']::text[], array['رقم التسجيل', 'تونس']::text[], null::text, null::text, 'pratique ; format réglementaire INCERTAIN', 'incertain'),
    ('carte_grise', 'immatriculation', 'date_premiere_mise_circulation', 'Date de première mise en circulation', 'date', 'oui', null::text, array['Date de 1re mise en circulation', 'DPMC']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('carte_grise', 'immatriculation', 'date_delivrance', 'Date de délivrance du certificat', 'date', 'oui', null::text, array['Délivré le']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('carte_grise', 'immatriculation', 'ancienne_immatriculation', 'Immatriculation précédente', 'identifiant', 'selon_cas', 'réimmatriculation / import'::text, array['Ancien n°']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('carte_grise', 'proprietaire', 'proprietaire_nom', 'Nom ou raison sociale du propriétaire', 'texte', 'oui', null::text, array['Propriétaire', 'Nom']::text[], array['المالك']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('carte_grise', 'proprietaire', 'proprietaire_identifiant', 'Identifiant (MF pour une société)', 'identifiant', 'selon_cas', 'ne jamais stocker de CIN en clair ; masquer'::text, array['MF']::text[], '{}'::text[], null::text, null::text, 'pratique (sécurité : pas de CIN en conversation)', 'pratique'),
    ('carte_grise', 'proprietaire', 'proprietaire_adresse', 'Adresse', 'adresse', 'oui', null::text, array['Adresse']::text[], array['العنوان']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('carte_grise', 'proprietaire', 'mention_leasing', 'Mention du bailleur / leasing', 'texte', 'selon_cas', 'véhicule en leasing'::text, array['Leasing']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN (au nom de qui est établie la carte grise en leasing : non confirmé)', 'incertain'),
    ('carte_grise', 'vehicule', 'marque', 'Marque', 'texte', 'oui', null::text, array['Marque']::text[], array['العلامة']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('carte_grise', 'vehicule', 'type_modele', 'Type / modèle commercial', 'texte', 'oui', null::text, array['Type', 'Modèle']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('carte_grise', 'vehicule', 'genre', 'Genre (voiture particulière, camionnette, camion, tracteur…)', 'liste', 'oui', null::text, array['Genre', 'VP', 'Camionnette']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('carte_grise', 'vehicule', 'carrosserie', 'Carrosserie', 'texte', 'selon_cas', null::text, array['Carrosserie']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('carte_grise', 'vehicule', 'numero_serie_vin', 'Numéro dans la série du type (châssis / VIN)', 'identifiant', 'oui', null::text, array['N° de série', 'N° châssis', 'VIN']::text[], array['رقم الهيكل']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('carte_grise', 'vehicule', 'energie', 'Source d''énergie (essence, gasoil, électrique, hybride, GPL)', 'liste', 'oui', null::text, array['Énergie', 'Carburant', 'Essence', 'Gasoil']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('carte_grise', 'vehicule', 'puissance_fiscale', 'Puissance fiscale (CV)', 'nombre', 'oui', null::text, array['Puissance fiscale', 'CV', 'P.F.']::text[], array['القوة الجبائية']::text[], null::text, null::text, 'pratique (base de la vignette selon WMC 2021)', 'pratique'),
    ('carte_grise', 'vehicule', 'places_assises', 'Nombre de places', 'nombre', 'selon_cas', null::text, array['Places assises']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('carte_grise', 'vehicule', 'ptac', 'Poids total autorisé en charge', 'nombre', 'selon_cas', 'utilitaires'::text, array['PTAC', 'Poids total en charge']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('carte_grise', 'vehicule', 'poids_vide', 'Poids à vide', 'nombre', 'selon_cas', null::text, array['Poids à vide']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('carte_grise', 'vehicule', 'charge_utile', 'Charge utile', 'nombre', 'selon_cas', 'utilitaires'::text, array['Charge utile']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('carte_grise', 'vehicule', 'cylindree', 'Cylindrée', 'nombre', 'non', null::text, array['Cylindrée']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('vignette', 'identification', 'numero_quittance', 'Numéro de quittance / référence de paiement en ligne', 'identifiant', 'oui', null::text, array['Quittance n°', 'Référence de paiement']::text[], array['وصل خلاص']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('vignette', 'identification', 'annee', 'Année d''imposition', 'periode', 'oui', null::text, array['Année', 'Vignette 20XX']::text[], array['معلوم الجولان']::text[], null::text, null::text, 'LF 2022 art. 55 (via WMC)', 'texte'),
    ('vignette', 'identification', 'numero_immatriculation', 'Immatriculation', 'identifiant', 'oui', null::text, array['Immatriculation']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('vignette', 'identification', 'redevable', 'Propriétaire / redevable (personne morale ou physique)', 'texte', 'oui', null::text, array['Propriétaire']::text[], '{}'::text[], null::text, null::text, 'LF 2022 art. 55 (tarif selon qualité du redevable)', 'texte'),
    ('vignette', 'identification', 'categorie_redevable', 'Catégorie (personne morale majorée / exonérée, location, leasing)', 'liste', 'oui', null::text, array['Personne morale', 'Location', 'Leasing']::text[], '{}'::text[], null::text, null::text, 'LF 2022 art. 55 (via WMC)', 'texte'),
    ('vignette', 'calcul', 'puissance_fiscale', 'Puissance fiscale (CV)', 'nombre', 'oui', null::text, array['CV', 'Puissance fiscale']::text[], '{}'::text[], null::text, null::text, 'LF 2022 art. 55 (barème par CV)', 'texte'),
    ('vignette', 'calcul', 'energie', 'Énergie (essence / gasoil)', 'liste', 'selon_cas', null::text, array['Gasoil', 'Essence']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN (taxe spécifique « huile lourde » mentionnée)', 'incertain'),
    ('vignette', 'calcul', 'montant_principal', 'Montant de la taxe', 'montant', 'oui', null::text, array['Montant']::text[], '{}'::text[], null::text, null::text, 'barème en base (paramètre par loi de finances)', 'texte'),
    ('vignette', 'calcul', 'penalites', 'Pénalités de retard', 'montant', 'selon_cas', 'paiement après échéance'::text, array['Pénalités']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN (taux non vérifié)', 'incertain'),
    ('vignette', 'calcul', 'total_paye', 'Total payé', 'montant', 'oui', null::text, array['Total']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('vignette', 'calcul', 'date_paiement', 'Date de paiement', 'date', 'oui', null::text, array['Date de paiement']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('vignette', 'calcul', 'date_echeance_legale', 'Échéance légale applicable', 'date', 'oui', null::text, array['Échéance']::text[], '{}'::text[], null::text, null::text, 'LF 2022 art. 55 (5 février / 5 mai selon catégorie — calendrier 2026 à vérifier)', 'texte')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('contrat_leasing', 'parties', 'bailleur', 'Bailleur (société de leasing : raison sociale, MF, agrément)', 'texte', 'oui', null::text, array['Bailleur', 'Le loueur']::text[], array['المؤجر']::text[], null::text, null::text, 'Loi 94-89 art. 1', 'texte'),
    ('contrat_leasing', 'parties', 'preneur', 'Preneur (raison sociale, MF, représentant)', 'texte', 'oui', null::text, array['Preneur', 'Le locataire']::text[], array['المستأجر']::text[], null::text, null::text, 'Loi 94-89 art. 1', 'texte'),
    ('contrat_leasing', 'parties', 'fournisseur_bien', 'Fournisseur du bien', 'texte', 'selon_cas', null::text, array['Fournisseur']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_leasing', 'parties', 'garants', 'Cautions / garants', 'texte', 'non', null::text, array['Caution', 'Garant']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_leasing', 'contrat', 'numero_contrat', 'Numéro de contrat', 'identifiant', 'oui', null::text, array['Contrat n°']::text[], array['عقد عدد']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_leasing', 'contrat', 'type_leasing', 'Mobilier / immobilier', 'liste', 'oui', null::text, array['Leasing mobilier', 'Leasing immobilier']::text[], array['الإيجار المالي']::text[], null::text, null::text, 'Loi 94-89 art. 1', 'texte'),
    ('contrat_leasing', 'contrat', 'date_signature', 'Date de signature', 'date', 'oui', null::text, array['Fait à … le']::text[], '{}'::text[], null::text, null::text, 'Loi 94-89 art. 1 (contrat écrit)', 'texte'),
    ('contrat_leasing', 'contrat', 'date_mise_en_loyer', 'Date de mise en loyer / de livraison du bien (PV de réception)', 'date', 'oui', null::text, array['PV de réception', 'Date de mise en loyer']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_leasing', 'contrat', 'duree_mois', 'Durée (mois)', 'nombre', 'oui', null::text, array['Durée']::text[], '{}'::text[], null::text, null::text, 'Loi 94-89 art. 1 (durée déterminée)', 'texte'),
    ('contrat_leasing', 'contrat', 'signatures_legalisees', 'Signatures légalisées', 'booleen', 'selon_cas', 'véhicule (pratique ATTT)'::text, array['Signature légalisée']::text[], '{}'::text[], null::text, null::text, 'pratique (presse)', 'pratique'),
    ('contrat_leasing', 'contrat', 'publicite_inscription', 'Inscription / publicité du contrat (registre)', 'texte', 'selon_cas', null::text, array['Inscription']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN (loi 94-89 non lue au-delà de l''art. 1)', 'incertain'),
    ('contrat_leasing', 'bien', 'designation_bien', 'Désignation du bien', 'texte', 'oui', null::text, array['Désignation du bien', 'Matériel']::text[], '{}'::text[], null::text, null::text, 'Loi 94-89 art. 1', 'texte'),
    ('contrat_leasing', 'bien', 'identifiant_bien', 'N° série / châssis / titre foncier', 'identifiant', 'selon_cas', null::text, array['N° châssis', 'N° série']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_leasing', 'bien', 'valeur_bien_ht', 'Valeur d''acquisition HT du bien (montant financé)', 'montant', 'oui', null::text, array['Valeur HT', 'Montant financé', 'Prix d''acquisition']::text[], '{}'::text[], null::text, null::text, 'pratique ; base NCT 41', 'pratique'),
    ('contrat_leasing', 'bien', 'reference_facture_fournisseur', 'Facture / pro forma du fournisseur', 'identifiant', 'selon_cas', null::text, array['Facture pro forma']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_leasing', 'conditions_financieres', 'premier_loyer_majore', 'Premier loyer majoré / apport / autofinancement', 'montant', 'selon_cas', null::text, array['Premier loyer majoré', 'Apport', 'Autofinancement']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_leasing', 'conditions_financieres', 'nombre_loyers', 'Nombre de loyers', 'nombre', 'oui', null::text, array['Nombre de loyers']::text[], '{}'::text[], null::text, null::text, 'Loi 94-89 art. 1 (loyer)', 'texte'),
    ('contrat_leasing', 'conditions_financieres', 'periodicite', 'Périodicité (mensuelle, trimestrielle)', 'liste', 'oui', null::text, array['Mensuel', 'Trimestriel']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_leasing', 'conditions_financieres', 'terme', 'Terme à échoir / échu', 'liste', 'selon_cas', null::text, array['À terme échu', 'À terme à échoir']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_leasing', 'conditions_financieres', 'loyer_ht', 'Montant du loyer HT', 'montant', 'oui', null::text, array['Loyer HT']::text[], array['معين الكراء']::text[], null::text, null::text, 'Loi 94-89 art. 1', 'texte'),
    ('contrat_leasing', 'conditions_financieres', 'tva_loyer', 'TVA sur loyer', 'montant', 'selon_cas', null::text, array['TVA']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN (régime TVA du leasing non relu)', 'incertain'),
    ('contrat_leasing', 'conditions_financieres', 'loyer_ttc', 'Loyer TTC', 'montant', 'oui', null::text, array['Loyer TTC']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_leasing', 'conditions_financieres', 'taux', 'Taux du financement (nominal / effectif global)', 'taux', 'selon_cas', null::text, array['Taux', 'TEG']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN (obligation d''affichage du TEG non vérifiée)', 'incertain'),
    ('contrat_leasing', 'conditions_financieres', 'valeur_residuelle', 'Valeur résiduelle / prix de levée d''option', 'montant', 'selon_cas', null::text, array['Valeur résiduelle', 'Option d''achat', 'Levée d''option']::text[], '{}'::text[], null::text, null::text, 'pratique ; option d''achat dans la loi : INCERTAIN', 'incertain'),
    ('contrat_leasing', 'conditions_financieres', 'frais_dossier', 'Frais de dossier', 'montant', 'non', null::text, array['Frais de dossier']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_leasing', 'conditions_financieres', 'mode_prelevement', 'Mode de paiement (prélèvement, traites) et banque', 'liste', 'oui', 'ne jamais stocker le RIB en clair ; référence masquée'::text, array['Prélèvement', 'Domiciliation', 'Traite']::text[], '{}'::text[], null::text, null::text, 'pratique (sécurité)', 'pratique'),
    ('contrat_leasing', 'conditions_financieres', 'penalites_retard', 'Intérêts / pénalités de retard', 'taux', 'non', null::text, array['Intérêts de retard']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_leasing', 'echeancier', 'numero_echeance', 'N° d''échéance', 'nombre', 'oui', null::text, array['N°']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_leasing', 'echeancier', 'date_echeance', 'Date d''échéance', 'date', 'oui', null::text, array['Date d''échéance']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_leasing', 'echeancier', 'loyer_echeance_ht', 'Loyer HT de l''échéance', 'montant', 'oui', null::text, array['Loyer HT']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_leasing', 'echeancier', 'part_capital', 'Part en capital (amortissement financier)', 'montant', 'selon_cas', 'souvent fournie par le bailleur'::text, array['Capital', 'Amortissement financier']::text[], '{}'::text[], null::text, null::text, 'NCT 41 (ventilation) — INCERTAIN §', 'incertain'),
    ('contrat_leasing', 'echeancier', 'part_interet', 'Part intérêts (charge financière)', 'montant', 'selon_cas', null::text, array['Intérêts', 'Marge financière']::text[], '{}'::text[], null::text, null::text, 'NCT 41 — INCERTAIN §', 'incertain'),
    ('contrat_leasing', 'echeancier', 'tva_echeance', 'TVA de l''échéance', 'montant', 'selon_cas', null::text, array['TVA']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('contrat_leasing', 'echeancier', 'loyer_echeance_ttc', 'Loyer TTC', 'montant', 'oui', null::text, array['TTC']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_leasing', 'echeancier', 'capital_restant_du', 'Capital restant dû après échéance', 'montant', 'selon_cas', null::text, array['Capital restant dû', 'Encours']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_leasing', 'clauses', 'assurance_obligatoire', 'Obligation d''assurance tous risques et délégation au bailleur', 'texte', 'selon_cas', null::text, array['Assurance', 'Délégation']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_leasing', 'clauses', 'entretien_charge_preneur', 'Entretien, réparations, taxes à la charge du preneur', 'texte', 'non', null::text, array['Entretien']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_leasing', 'clauses', 'resiliation', 'Résiliation anticipée, indemnité, restitution du bien', 'texte', 'selon_cas', null::text, array['Résiliation', 'Indemnité de résiliation', 'Restitution']::text[], '{}'::text[], null::text, null::text, 'pratique ; texte légal INCERTAIN', 'incertain'),
    ('contrat_leasing', 'clauses', 'sort_fin_contrat', 'Fin de contrat : levée d''option, restitution ou prolongation', 'liste', 'oui', null::text, array['Levée d''option', 'Fin de contrat']::text[], '{}'::text[], null::text, null::text, 'pratique ; option INCERTAIN dans la loi', 'incertain'),
    ('contrat_leasing', 'clauses', 'loi_juridiction', 'Loi applicable et tribunal compétent', 'texte', 'non', null::text, array['Attribution de juridiction']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('declaration_mensuelle', 'identification_et_periode', 'matricule_fiscal', 'Matricule fiscal du déclarant (avec n° d''établissement)', 'identifiant', 'oui', 'Une déclaration par établissement si établissements secondaires déclarants (pratique à confirmer)'::text, array['Matricule fiscal', 'Identifiant fiscal']::text[], array['المعرف الجبائي']::text[], 'matricule_fiscal'::text, null::text, 'pratique ; format dépôt Malica', 'pratique'),
    ('declaration_mensuelle', 'identification_et_periode', 'raison_sociale', 'Raison sociale / nom', 'texte', 'oui', null::text, array['Raison sociale']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('declaration_mensuelle', 'identification_et_periode', 'adresse', 'Adresse', 'adresse', 'oui', null::text, array['Adresse']::text[], array['العنوان']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('declaration_mensuelle', 'identification_et_periode', 'activite', 'Activité', 'texte', 'non', null::text, array['Activité']::text[], array['النشاط']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('declaration_mensuelle', 'identification_et_periode', 'periode', 'Mois et année d''imposition', 'periode', 'oui', null::text, array['Mois', 'Année', 'Période', 'Mois de']::text[], array['الشهر', 'السنة']::text[], null::text, null::text, 'pratique (déclaration mensuelle)', 'pratique'),
    ('declaration_mensuelle', 'identification_et_periode', 'nature_depot', 'Nature : initiale / rectificative / régularisation', 'liste', 'selon_cas', 'Rectificative en cas de correction ; régularisation spontanée hors délai'::text, array['Déclaration rectificative', 'Régularisation']::text[], '{}'::text[], null::text, null::text, 'pratique ; libellés exacts INCERTAIN', 'incertain'),
    ('declaration_mensuelle', 'identification_et_periode', 'mode_depot', 'Mode : papier ou télédéclaration', 'liste', 'oui', 'Détermine l''échéance (20 vs 28 pour PM)'::text, array['Télédéclaration', 'Déclaration en ligne']::text[], '{}'::text[], null::text, null::text, 'PwC Other taxes (LF 2024)', 'texte'),
    ('declaration_mensuelle', 'identification_et_periode', 'date_depot', 'Date de dépôt', 'date', 'oui', null::text, array['Date de dépôt', 'Déposée le']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('declaration_mensuelle', 'identification_et_periode', 'reference_accuse', 'N° d''accusé de réception / référence de télédéclaration', 'identifiant', 'selon_cas', 'Si télédéclaration'::text, array['Accusé de réception', 'Référence']::text[], '{}'::text[], null::text, null::text, 'pratique ; format INCERTAIN', 'incertain'),
    ('declaration_mensuelle', 'tva_collectee', 'ca_taxable_19', 'Chiffre d''affaires HT taxable au taux de 19 %', 'montant', 'selon_cas', 'Si opérations à 19 %'::text, array['Chiffre d''affaires taxable', 'Base imposable', '19 %']::text[], '{}'::text[], null::text, null::text, 'Code TVA art. 7', 'texte'),
    ('declaration_mensuelle', 'tva_collectee', 'tva_19', 'TVA collectée à 19 %', 'montant', 'selon_cas', null::text, array['TVA due', 'TVA collectée']::text[], array['الأداء على القيمة المضافة']::text[], null::text, null::text, 'Code TVA art. 7', 'texte'),
    ('declaration_mensuelle', 'tva_collectee', 'ca_taxable_13', 'CA HT taxable à 13 %', 'montant', 'selon_cas', 'Liste limitative (certains produits pétroliers, électricité BT domestique, logements promoteurs…) ; honoraires professions libérales passés à 19 % depuis 2023 selon PwC'::text, array['13 %']::text[], '{}'::text[], null::text, null::text, 'Code TVA art. 7 ; PwC Other taxes', 'texte'),
    ('declaration_mensuelle', 'tva_collectee', 'tva_13', 'TVA collectée à 13 %', 'montant', 'selon_cas', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'Code TVA art. 7', 'texte'),
    ('declaration_mensuelle', 'tva_collectee', 'ca_taxable_7', 'CA HT taxable à 7 %', 'montant', 'selon_cas', 'Biens et services du tableau B'::text, array['7 %']::text[], '{}'::text[], null::text, null::text, 'Code TVA art. 7', 'texte'),
    ('declaration_mensuelle', 'tva_collectee', 'tva_7', 'TVA collectée à 7 %', 'montant', 'selon_cas', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'Code TVA art. 7', 'texte'),
    ('declaration_mensuelle', 'tva_collectee', 'ca_exonere', 'CA exonéré', 'montant', 'selon_cas', 'Nécessaire au prorata des assujettis partiels'::text, array['Chiffre d''affaires exonéré']::text[], '{}'::text[], null::text, null::text, 'Code TVA art. 9-II (prorata)', 'texte'),
    ('declaration_mensuelle', 'tva_collectee', 'ca_export', 'CA à l''exportation', 'montant', 'selon_cas', 'Ouvre droit à restitution mensuelle du crédit'::text, array['Exportation', 'Chiffre d''affaires à l''export']::text[], '{}'::text[], null::text, null::text, 'Code TVA art. 15-II-1', 'texte'),
    ('declaration_mensuelle', 'tva_collectee', 'ca_suspension', 'CA réalisé en suspension de TVA', 'montant', 'selon_cas', 'Ventes à bénéficiaires d''attestation d''achat en suspension'::text, array['Ventes en suspension']::text[], '{}'::text[], null::text, null::text, 'Code TVA art. 11 et 15-II-1', 'texte'),
    ('declaration_mensuelle', 'tva_collectee', 'tva_autoliquidee', 'TVA due sur services rendus par des non-résidents (autoliquidation / retenue 100 %)', 'montant', 'selon_cas', 'Paiements à non-résidents non établis'::text, '{}'::text[], '{}'::text[], null::text, null::text, 'INCERTAIN (Code TVA art. 19 non lu) ; PwC mentionne une retenue de TVA sur rémunérations versées aux non-résidents sans taux', 'incertain'),
    ('declaration_mensuelle', 'tva_collectee', 'tva_reversements', 'Reversements / régularisations de TVA (prorata, avoirs, cessions)', 'montant', 'selon_cas', 'Régularisation annuelle si écart de prorata > 5 points (biens amortissables)'::text, array['Reversement', 'Régularisation']::text[], '{}'::text[], null::text, null::text, 'Code TVA art. 9-II et III', 'texte'),
    ('declaration_mensuelle', 'tva_collectee', 'total_tva_collectee', 'Total TVA due (brute)', 'montant', 'oui', 'Peut être 0'::text, array['Total TVA due']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('declaration_mensuelle', 'tva_deductible', 'tva_ded_immobilisations', 'TVA déductible sur acquisitions d''immobilisations', 'montant', 'selon_cas', null::text, array['Immobilisations', 'TVA récupérable']::text[], '{}'::text[], null::text, null::text, 'Code TVA art. 9-I ; ventilation exacte du formulaire INCERTAIN', 'incertain'),
    ('declaration_mensuelle', 'tva_deductible', 'tva_ded_biens_services', 'TVA déductible sur autres biens et services (local)', 'montant', 'selon_cas', 'Factures conformes art. 18 ; hors exclusions art. 10'::text, array['TVA déductible', 'Achats locaux']::text[], '{}'::text[], null::text, null::text, 'Code TVA art. 9-I-2 et art. 10', 'texte'),
    ('declaration_mensuelle', 'tva_deductible', 'tva_ded_importations', 'TVA payée à l''importation', 'montant', 'selon_cas', 'Justifiée par les attestations de paiement en douane'::text, array['Importations']::text[], '{}'::text[], null::text, null::text, 'Code TVA art. 9-I-2', 'texte'),
    ('declaration_mensuelle', 'tva_deductible', 'tva_retenue_subie', 'TVA retenue à la source par les clients (imputable)', 'montant', 'selon_cas', 'Couverte par certificats de retenue émis sur la plateforme (TEJ)'::text, array['Retenue à la source TVA']::text[], '{}'::text[], null::text, null::text, 'Code TVA art. 9-I-2 ; PwC WHT (certificat plateforme obligatoire)', 'texte'),
    ('declaration_mensuelle', 'tva_deductible', 'prorata_deduction', 'Pourcentage de déduction (assujetti partiel)', 'taux', 'selon_cas', 'Assujettis partiels'::text, array['Prorata']::text[], '{}'::text[], null::text, null::text, 'Code TVA art. 9-II', 'texte'),
    ('declaration_mensuelle', 'tva_deductible', 'credit_reporte_mois_precedent', 'Crédit de TVA reporté du mois précédent', 'montant', 'selon_cas', 'Si crédit à la fin du mois précédent'::text, array['Report de crédit', 'Crédit du mois précédent']::text[], '{}'::text[], null::text, null::text, 'Code TVA art. 9-I-1 (report sur les mois suivants)', 'texte'),
    ('declaration_mensuelle', 'tva_deductible', 'total_tva_deductible', 'Total TVA déductible', 'montant', 'oui', null::text, array['Total TVA déductible']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('declaration_mensuelle', 'tva_deductible', 'tva_a_payer', 'TVA à payer', 'montant', 'selon_cas', 'Si collectée > déductible'::text, array['TVA à payer', 'Net à payer']::text[], '{}'::text[], null::text, null::text, 'Code TVA art. 9-I-1', 'texte'),
    ('declaration_mensuelle', 'tva_deductible', 'credit_a_reporter', 'Crédit de TVA à reporter', 'montant', 'selon_cas', 'Si déductible > collectée'::text, array['Crédit à reporter']::text[], '{}'::text[], null::text, null::text, 'Code TVA art. 9-I-1', 'texte'),
    ('declaration_mensuelle', 'tva_deductible', 'demande_restitution', 'Montant du crédit dont la restitution est demandée', 'montant', 'selon_cas', 'Exportateurs/suspension/retenue (mensuel) ; 3 ou 6 déclarations consécutives selon les cas'::text, array['Restitution']::text[], '{}'::text[], null::text, null::text, 'Code TVA art. 15', 'texte'),
    ('declaration_mensuelle', 'retenues_a_la_source', 'ras_salaires_base', 'Traitements et salaires — montant brut imposable', 'montant', 'selon_cas', 'Employeurs'::text, array['Traitements et salaires', 'Salaires']::text[], array['الأجور']::text[], null::text, null::text, 'Code IRPP/IS art. 52 (repris dépôt Malica)', 'texte'),
    ('declaration_mensuelle', 'retenues_a_la_source', 'ras_salaires_montant', 'Retenue IRPP sur salaires (barème)', 'montant', 'selon_cas', null::text, array['Retenue sur salaires']::text[], array['الخصم من المورد']::text[], null::text, null::text, 'Code IRPP/IS art. 52', 'texte'),
    ('declaration_mensuelle', 'retenues_a_la_source', 'css_retenue_salaires', 'Contribution sociale de solidarité retenue sur salaires et pensions', 'montant', 'selon_cas', 'Salariés dont revenu net imposable > 5 000 DT (selon presse 2026)'::text, array['Contribution sociale de solidarité', 'CSS']::text[], '{}'::text[], null::text, null::text, 'LF 2026 art. 87 selon La Presse (non relu au JORT)', 'texte'),
    ('declaration_mensuelle', 'retenues_a_la_source', 'ras_honoraires_10', 'Honoraires, commissions, courtages, loyers, activités non commerciales — 10 %', 'montant', 'selon_cas', null::text, array['Honoraires', 'Commissions', 'Loyers']::text[], '{}'::text[], null::text, null::text, 'PwC WHT (taux LF 2021)', 'texte'),
    ('declaration_mensuelle', 'retenues_a_la_source', 'ras_honoraires_3', 'Honoraires à bénéficiaire soumis à l''IS ou PP au régime réel — 3 %', 'montant', 'selon_cas', null::text, array['3 %']::text[], '{}'::text[], null::text, null::text, 'PwC WHT', 'texte'),
    ('declaration_mensuelle', 'retenues_a_la_source', 'ras_achats_1_5', 'Achats de biens et services ≥ 1 000 DT TTC — 1,5 % (1 % / 0,5 % selon taux IS du bénéficiaire)', 'montant', 'selon_cas', 'Paiement > 1 000 DT TTC ; taux 1 % rattaché à l''ancien IS 15 % (à revoir depuis LF 2025)'::text, array['Marchés', 'Acquisitions de biens et services', '1,5 %']::text[], '{}'::text[], null::text, null::text, 'PwC WHT ; articulation avec IS 20 % INCERTAIN', 'incertain'),
    ('declaration_mensuelle', 'retenues_a_la_source', 'ras_interets', 'Intérêts — 20 %', 'montant', 'selon_cas', null::text, array['Intérêts']::text[], '{}'::text[], null::text, null::text, 'PwC WHT', 'texte'),
    ('declaration_mensuelle', 'retenues_a_la_source', 'ras_jetons_presence', 'Jetons de présence — 20 %', 'montant', 'selon_cas', null::text, array['Jetons de présence']::text[], '{}'::text[], null::text, null::text, 'PwC WHT', 'texte'),
    ('declaration_mensuelle', 'retenues_a_la_source', 'ras_dividendes', 'Dividendes — 10 %', 'montant', 'selon_cas', null::text, array['Dividendes', 'Revenus de capitaux mobiliers']::text[], '{}'::text[], null::text, null::text, 'PwC WHT', 'texte'),
    ('declaration_mensuelle', 'retenues_a_la_source', 'ras_plus_value_immobiliere', 'Cession immobilière par personne physique — 2,5 % du prix', 'montant', 'selon_cas', null::text, array['Plus-value immobilière']::text[], '{}'::text[], null::text, null::text, 'PwC WHT', 'texte'),
    ('declaration_mensuelle', 'retenues_a_la_source', 'ras_non_residents', 'Paiements aux non-résidents — 15 % (25 % paradis fiscaux ; taux conventionnel si certificat de résidence)', 'montant', 'selon_cas', null::text, array['Non-résidents']::text[], '{}'::text[], null::text, null::text, 'PwC WHT', 'texte'),
    ('declaration_mensuelle', 'retenues_a_la_source', 'ras_tva', 'Retenue à la source au titre de la TVA (opérée par l''État, collectivités, établissements publics…)', 'montant', 'selon_cas', 'Uniquement si le déclarant est un organisme tenu d''opérer cette retenue'::text, array['Retenue TVA']::text[], '{}'::text[], null::text, null::text, 'Code TVA art. 19 et 19 bis (cités par l''arrêté du 10/05/2024) ; taux 25 % INCERTAIN', 'incertain'),
    ('declaration_mensuelle', 'retenues_a_la_source', 'ras_autres', 'Autres retenues (primes de performance distributeurs 15 %, jeux 25 %, etc.)', 'montant', 'selon_cas', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'PwC WHT', 'texte'),
    ('declaration_mensuelle', 'retenues_a_la_source', 'total_ras', 'Total des retenues à la source', 'montant', 'selon_cas', null::text, array['Total retenues']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('declaration_mensuelle', 'taxes_sur_salaires', 'tfp_base', 'TFP — base : salaires bruts y compris avantages en nature', 'montant', 'selon_cas', 'Entités soumises à l''IS (selon PwC) ; exonérations éventuelles INCERTAIN'::text, array['Taxe de formation professionnelle', 'TFP']::text[], array['الأداء على التكوين المهني']::text[], null::text, null::text, 'Loi 88-145 art. 30 (dépôt Malica) ; PwC Other taxes', 'texte'),
    ('declaration_mensuelle', 'taxes_sur_salaires', 'tfp_taux', 'TFP — taux (2 % ; 1 % industries manufacturières)', 'taux', 'selon_cas', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'PwC Other taxes', 'texte'),
    ('declaration_mensuelle', 'taxes_sur_salaires', 'tfp_montant', 'TFP due', 'montant', 'selon_cas', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'idem', 'texte'),
    ('declaration_mensuelle', 'taxes_sur_salaires', 'tfp_avance_imputee', 'Avance TFP / imputation de dépenses de formation (ristourne)', 'montant', 'non', 'Mécanisme existant en pratique, modalités INCERTAIN'::text, array['Avance TFP']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('declaration_mensuelle', 'taxes_sur_salaires', 'foprolos_base', 'FOPROLOS — base : salaires bruts y compris avantages en nature', 'montant', 'selon_cas', 'Tout employeur établi en Tunisie'::text, array['FOPROLOS', 'Fonds de promotion des logements pour les salariés']::text[], array['صندوق النهوض بالمسكن لفائدة الأجراء']::text[], null::text, null::text, 'Loi 77-54 (dépôt Malica) ; PwC Other taxes', 'texte'),
    ('declaration_mensuelle', 'taxes_sur_salaires', 'foprolos_taux', 'FOPROLOS — taux 1 %', 'taux', 'selon_cas', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'PwC Other taxes', 'texte'),
    ('declaration_mensuelle', 'taxes_sur_salaires', 'foprolos_montant', 'FOPROLOS dû', 'montant', 'selon_cas', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'idem', 'texte'),
    ('declaration_mensuelle', 'tcl', 'tcl_ca_local', 'TCL — chiffre d''affaires brut local (TTC selon pratique, à confirmer)', 'montant', 'selon_cas', 'Activités soumises ; secteur touristique exclu'::text, array['Taxe sur les établissements à caractère industriel, commercial ou professionnel', 'TCL']::text[], array['المعلوم على المؤسسات ذات الصبغة الصناعية أو التجارية أو المهنية']::text[], null::text, null::text, 'CFL art. 39-II (dépôt Malica) ; PwC Other taxes ; base TTC/HT INCERTAIN', 'incertain'),
    ('declaration_mensuelle', 'tcl', 'tcl_ca_export', 'TCL — chiffre d''affaires export', 'montant', 'selon_cas', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'PwC Other taxes', 'texte'),
    ('declaration_mensuelle', 'tcl', 'tcl_taux', 'Taux 0,2 % (local) / 0,1 % (export)', 'taux', 'selon_cas', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'PwC Other taxes', 'texte'),
    ('declaration_mensuelle', 'tcl', 'tcl_montant', 'TCL due', 'montant', 'selon_cas', 'Plafond éventuel INCERTAIN ; régularisation annuelle par rapport au minimum (RET) en pratique'::text, '{}'::text[], '{}'::text[], null::text, null::text, 'PwC Other taxes', 'texte'),
    ('declaration_mensuelle', 'droit_de_timbre_et_autres', 'timbre_nombre_factures', 'Nombre de factures émises soumises au droit de timbre', 'nombre', 'selon_cas', 'Hors factures exonérées (export, clients expressément exonérés)'::text, array['Droit de timbre', 'Nombre de factures']::text[], array['معلوم الطابع الجبائي']::text[], null::text, null::text, 'PwC Other taxes', 'texte'),
    ('declaration_mensuelle', 'droit_de_timbre_et_autres', 'timbre_tarif', 'Tarif unitaire (1 DT depuis 2023)', 'montant', 'selon_cas', 'Tarifs spécifiques grandes surfaces (LF 2022/2026) INCERTAIN'::text, '{}'::text[], '{}'::text[], null::text, null::text, 'PwC Other taxes', 'texte'),
    ('declaration_mensuelle', 'droit_de_timbre_et_autres', 'timbre_montant', 'Droit de timbre dû', 'montant', 'selon_cas', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'PwC Other taxes', 'texte'),
    ('declaration_mensuelle', 'droit_de_timbre_et_autres', 'autres_taxes', 'Autres taxes et fonds (taxes sectorielles, droits de consommation, taxe hôtelière, etc.) : code, base, taux, montant', 'liste', 'selon_cas', 'Selon l''activité ; liste exhaustive des lignes du formulaire INCERTAIN'::text, array['Autres taxes']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN — vérifier sur le formulaire officiel / téléprocédure', 'incertain'),
    ('declaration_mensuelle', 'totaux_et_paiement', 'total_principal', 'Total des impôts et taxes dus', 'montant', 'oui', null::text, array['Total', 'Montant total à payer']::text[], array['المجموع']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('declaration_mensuelle', 'totaux_et_paiement', 'penalites_retard', 'Pénalités de retard', 'montant', 'selon_cas', 'Dépôt/paiement après échéance ; taux CDPF art. 81 INCERTAIN (non relu)'::text, array['Pénalités de retard']::text[], '{}'::text[], null::text, null::text, 'CDPF art. 81 cité, texte non lu', 'texte'),
    ('declaration_mensuelle', 'totaux_et_paiement', 'total_a_payer', 'Net à payer', 'montant', 'oui', null::text, array['Net à payer']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('declaration_mensuelle', 'totaux_et_paiement', 'declaration_neant', 'Déclaration néant (aucun impôt dû)', 'booleen', 'selon_cas', 'Obligation de déposer même sans opération : INCERTAIN (chapitre VIII Code TVA non lu)'::text, array['Néant']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('declaration_mensuelle', 'totaux_et_paiement', 'mode_paiement', 'Mode de paiement (espèces, chèque, virement, télépaiement)', 'liste', 'non', null::text, array['Télépaiement']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('declaration_mensuelle', 'totaux_et_paiement', 'reference_quittance', 'N° de quittance / référence de paiement', 'identifiant', 'selon_cas', 'Si paiement'::text, array['Quittance']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('declaration_mensuelle', 'totaux_et_paiement', 'signature_cachet', 'Signature et cachet du déclarant / date et lieu', 'texte', 'selon_cas', 'Dépôt papier'::text, array['Signature', 'Cachet']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('acompte_provisionnel', 'identification', 'matricule_fiscal', 'Matricule fiscal', 'identifiant', 'oui', null::text, array['Matricule fiscal']::text[], array['المعرف الجبائي']::text[], 'matricule_fiscal'::text, null::text, 'pratique', 'pratique'),
    ('acompte_provisionnel', 'identification', 'raison_sociale', 'Raison sociale / nom', 'texte', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('acompte_provisionnel', 'identification', 'nature_impot', 'Impôt : IS ou IRPP', 'liste', 'oui', null::text, array['Impôt sur les sociétés', 'Impôt sur le revenu']::text[], array['الضريبة على الشركات', 'الضريبة على الدخل']::text[], null::text, null::text, 'art. 51', 'texte'),
    ('acompte_provisionnel', 'identification', 'exercice_reference', 'Exercice de référence (N-1) dont l''impôt sert de base', 'periode', 'oui', null::text, array['Exercice']::text[], '{}'::text[], null::text, null::text, 'art. 51 (PwC)', 'texte'),
    ('acompte_provisionnel', 'identification', 'exercice_imputation', 'Exercice d''imputation (N)', 'periode', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'art. 51', 'texte'),
    ('acompte_provisionnel', 'identification', 'numero_acompte', 'Rang de l''acompte (1er, 2e, 3e)', 'liste', 'oui', null::text, array['Premier acompte', 'Deuxième acompte', 'Troisième acompte']::text[], array['القسط الاحتياطي']::text[], null::text, null::text, 'art. 51', 'texte'),
    ('acompte_provisionnel', 'calcul', 'impot_base_n_1', 'Impôt dû au titre de l''exercice précédent (base)', 'montant', 'oui', 'Montant avant ou après déduction des retenues subies : INCERTAIN (texte de l''art. 51 non relu)'::text, array['Impôt dû au titre de l''exercice précédent']::text[], '{}'::text[], null::text, null::text, 'art. 51 (PwC : « total CIT due for the previous year »)', 'texte'),
    ('acompte_provisionnel', 'calcul', 'taux_acompte', 'Taux 30 %', 'taux', 'oui', null::text, array['30 %']::text[], '{}'::text[], null::text, null::text, 'PwC Tax administration', 'texte'),
    ('acompte_provisionnel', 'calcul', 'montant_brut_acompte', 'Montant de l''acompte = 30 % × base', 'montant', 'oui', null::text, array['Montant de l''acompte']::text[], '{}'::text[], null::text, null::text, 'art. 51', 'texte'),
    ('acompte_provisionnel', 'calcul', 'retenues_imputees', 'Retenues à la source subies imputées sur l''acompte', 'montant', 'selon_cas', 'Imputabilité sur acompte (et non seulement sur l''impôt annuel) : INCERTAIN'::text, array['Retenues à la source']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('acompte_provisionnel', 'calcul', 'excedent_impot_impute', 'Excédent d''impôt antérieur imputé', 'montant', 'selon_cas', null::text, array['Excédent']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('acompte_provisionnel', 'calcul', 'net_a_payer', 'Net à payer', 'montant', 'oui', null::text, array['Net à payer']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('acompte_provisionnel', 'calcul', 'penalites', 'Pénalités de retard', 'montant', 'selon_cas', 'Paiement tardif'::text, '{}'::text[], '{}'::text[], null::text, null::text, 'CDPF art. 81 (non relu)', 'texte'),
    ('acompte_provisionnel', 'depot_paiement', 'date_depot', 'Date de dépôt / paiement', 'date', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('acompte_provisionnel', 'depot_paiement', 'reference_quittance', 'N° de quittance / référence télépaiement', 'identifiant', 'selon_cas', null::text, array['Quittance']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('declaration_annuelle_is_irpp', 'identification', 'matricule_fiscal', 'Matricule fiscal', 'identifiant', 'oui', 'Catégorie M (société) ou P (personne physique) selon dépôt Malica/stdnum'::text, array['Matricule fiscal']::text[], array['المعرف الجبائي']::text[], 'matricule_fiscal'::text, null::text, 'pratique', 'pratique'),
    ('declaration_annuelle_is_irpp', 'identification', 'raison_sociale', 'Raison sociale / nom et prénom', 'texte', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('declaration_annuelle_is_irpp', 'identification', 'forme_juridique', 'Forme juridique', 'liste', 'selon_cas', 'Détermine l''échéance (SA/SARL auditées : 25 juin)'::text, array['Forme juridique']::text[], '{}'::text[], null::text, null::text, 'PwC', 'texte'),
    ('declaration_annuelle_is_irpp', 'identification', 'exercice', 'Exercice (dates de début et de clôture)', 'periode', 'oui', null::text, array['Exercice', 'Exercice clos le']::text[], array['السنة المحاسبية']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('declaration_annuelle_is_irpp', 'identification', 'regime_fiscal', 'Régime / taux d''IS applicable (20, 10, 35, 40 %) ; avantages (zones de développement, export, etc.)', 'liste', 'oui', null::text, array['Taux de l''impôt']::text[], '{}'::text[], null::text, null::text, 'PwC CIT', 'texte'),
    ('declaration_annuelle_is_irpp', 'identification', 'nature_declaration', 'Initiale / rectificative', 'liste', 'selon_cas', null::text, array['Rectificative']::text[], '{}'::text[], null::text, null::text, 'pratique ; CDPF art. 45 (déclaration rectificative en cas d''acquiescement)', 'pratique'),
    ('declaration_annuelle_is_irpp', 'identification', 'commissaire_aux_comptes', 'Soumission au contrôle légal des comptes (oui/non)', 'booleen', 'selon_cas', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'PwC (échéance 25 juin)', 'texte'),
    ('declaration_annuelle_is_irpp', 'chiffre_affaires', 'ca_local_ttc', 'Chiffre d''affaires local TTC (base du minimum d''impôt)', 'montant', 'oui', null::text, array['Chiffre d''affaires local']::text[], array['رقم المعاملات']::text[], null::text, null::text, 'PwC CIT', 'texte'),
    ('declaration_annuelle_is_irpp', 'chiffre_affaires', 'ca_export', 'Chiffre d''affaires à l''export', 'montant', 'selon_cas', null::text, array['Export']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('declaration_annuelle_is_irpp', 'chiffre_affaires', 'ca_total_brut', 'Chiffre d''affaires brut total', 'montant', 'oui', 'Seuils : 20 MDT (prix de transfert, contribution 2025), 1 MDT (télédéclaration)'::text, '{}'::text[], '{}'::text[], null::text, null::text, 'CDPF art. 38 bis ; PwC', 'texte'),
    ('declaration_annuelle_is_irpp', 'resultat_fiscal', 'resultat_comptable', 'Résultat comptable (bénéfice/perte)', 'montant', 'oui', null::text, array['Résultat comptable', 'Résultat net']::text[], '{}'::text[], null::text, null::text, 'pratique (passage comptable-fiscal)', 'pratique'),
    ('declaration_annuelle_is_irpp', 'resultat_fiscal', 'reintegrations', 'Réintégrations (charges non déductibles, dont montants non déclarés dans la déclaration employeur)', 'liste', 'selon_cas', null::text, array['Réintégrations']::text[], '{}'::text[], null::text, null::text, 'PwC (non-déductibilité des montants non déclarés) ; détail des lignes INCERTAIN', 'incertain'),
    ('declaration_annuelle_is_irpp', 'resultat_fiscal', 'deductions', 'Déductions (produits non imposables, provisions admises…)', 'liste', 'selon_cas', null::text, array['Déductions']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN (détail)', 'incertain'),
    ('declaration_annuelle_is_irpp', 'resultat_fiscal', 'resultat_fiscal_avant_deficits', 'Résultat fiscal avant imputation des déficits et amortissements différés', 'montant', 'oui', null::text, array['Résultat fiscal']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('declaration_annuelle_is_irpp', 'resultat_fiscal', 'deficits_reportes', 'Déficits reportés imputés (par exercice d''origine)', 'liste', 'selon_cas', 'Durée de report INCERTAIN'::text, array['Déficits reportables']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('declaration_annuelle_is_irpp', 'resultat_fiscal', 'amortissements_differes', 'Amortissements différés en périodes déficitaires', 'montant', 'selon_cas', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('declaration_annuelle_is_irpp', 'resultat_fiscal', 'deductions_avantages', 'Déductions au titre des avantages fiscaux (réinvestissement, export, zones)', 'liste', 'selon_cas', null::text, array['Bénéfices réinvestis']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN (Code d''incitation / loi investissement)', 'incertain'),
    ('declaration_annuelle_is_irpp', 'resultat_fiscal', 'benefice_imposable', 'Bénéfice imposable', 'montant', 'oui', null::text, array['Bénéfice imposable']::text[], array['الربح الخاضع للضريبة']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('declaration_annuelle_is_irpp', 'liquidation', 'taux_is', 'Taux d''IS', 'taux', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'PwC CIT', 'texte'),
    ('declaration_annuelle_is_irpp', 'liquidation', 'is_calcule', 'Impôt calculé = bénéfice imposable × taux', 'montant', 'oui', null::text, array['Impôt dû']::text[], '{}'::text[], null::text, null::text, 'PwC CIT', 'texte'),
    ('declaration_annuelle_is_irpp', 'liquidation', 'minimum_impot', 'Minimum d''impôt = 0,2 % du CA local TTC (plancher 500 DT) ou 0,1 % (plancher 300 DT)', 'montant', 'oui', 'Non dû en période d''exonération totale'::text, array['Minimum d''impôt']::text[], array['الضريبة الدنيا']::text[], null::text, null::text, 'PwC CIT', 'texte'),
    ('declaration_annuelle_is_irpp', 'liquidation', 'is_du', 'IS dû = max(IS calculé, minimum)', 'montant', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'PwC CIT', 'texte'),
    ('declaration_annuelle_is_irpp', 'liquidation', 'contribution_conjoncturelle', 'Contribution conjoncturelle / permanente (selon secteur et CA)', 'montant', 'selon_cas', 'Banques, assurances, télécoms, concessionnaires… ; 2 % LF 2025 pour CA 2023 ≥ 20 MDT'::text, array['Contribution conjoncturelle']::text[], '{}'::text[], null::text, null::text, 'PwC CIT', 'texte'),
    ('declaration_annuelle_is_irpp', 'liquidation', 'css', 'Contribution sociale de solidarité', 'montant', 'selon_cas', 'Intégration dans la même déclaration INCERTAIN'::text, array['Contribution sociale de solidarité']::text[], '{}'::text[], null::text, null::text, 'LF 2026 art. 87 (presse)', 'texte'),
    ('declaration_annuelle_is_irpp', 'liquidation', 'acomptes_payes', 'Acomptes provisionnels payés au titre de l''exercice', 'montant', 'selon_cas', 'À partir de la 2e année'::text, array['Acomptes provisionnels']::text[], array['الأقساط الاحتياطية']::text[], null::text, null::text, 'PwC (imputation)', 'texte'),
    ('declaration_annuelle_is_irpp', 'liquidation', 'retenues_subies', 'Retenues à la source subies (certificats reçus)', 'montant', 'selon_cas', null::text, array['Retenues à la source']::text[], array['الخصم من المورد']::text[], null::text, null::text, 'PwC (imputation)', 'texte'),
    ('declaration_annuelle_is_irpp', 'liquidation', 'excedent_anterieur', 'Excédent d''impôt antérieur reporté', 'montant', 'selon_cas', null::text, array['Excédent d''impôt']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('declaration_annuelle_is_irpp', 'liquidation', 'reste_a_payer', 'Impôt restant à payer', 'montant', 'selon_cas', null::text, array['Reste à payer']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('declaration_annuelle_is_irpp', 'liquidation', 'excedent_a_reporter', 'Excédent à reporter / à restituer', 'montant', 'selon_cas', null::text, array['Excédent']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('declaration_annuelle_is_irpp', 'annexes_jointes', 'etats_financiers', 'États financiers (bilan, état de résultat, flux, notes) / liasse', 'booleen', 'oui', 'Personnes tenues d''une comptabilité'::text, array['États financiers', 'Bilan']::text[], array['القوائم المالية']::text[], null::text, null::text, 'pratique ; texte INCERTAIN', 'incertain'),
    ('declaration_annuelle_is_irpp', 'annexes_jointes', 'documentation_prix_transfert', 'Déclaration / documentation prix de transfert', 'booleen', 'selon_cas', 'CA brut ≥ 20 MDT ; mise en demeure 40 jours'::text, array['Prix de transfert']::text[], '{}'::text[], null::text, null::text, 'CDPF art. 38 bis', 'texte'),
    ('declaration_annuelle_is_irpp', 'annexes_jointes', 'tableau_amortissements', 'Tableau des amortissements / provisions', 'booleen', 'selon_cas', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('declaration_annuelle_is_irpp', 'depot', 'date_depot', 'Date de dépôt', 'date', 'oui', '≤ 25 mars (ou 25 juin si audit légal)'::text, '{}'::text[], '{}'::text[], null::text, null::text, 'PwC', 'texte'),
    ('declaration_annuelle_is_irpp', 'depot', 'reference_accuse', 'Référence d''accusé / quittance', 'identifiant', 'selon_cas', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('declaration_annuelle_is_irpp', 'specifique_irpp', 'categories_revenus', 'Catégories de revenus (BIC, BNC, salaires, revenus fonciers, capitaux mobiliers…)', 'liste', 'selon_cas', 'Personnes physiques'::text, array['Revenu global']::text[], array['الضريبة على دخل الأشخاص الطبيعيين']::text[], null::text, null::text, 'Code IRPP/IS art. 60 ; détail INCERTAIN', 'incertain'),
    ('declaration_annuelle_is_irpp', 'specifique_irpp', 'deductions_familiales', 'Situation familiale et déductions communes', 'liste', 'selon_cas', null::text, array['Chef de famille', 'Enfants à charge']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('declaration_annuelle_is_irpp', 'specifique_irpp', 'bareme_irpp', 'Impôt selon barème progressif', 'montant', 'selon_cas', 'Barème LF 2025 INCERTAIN — paramètre en base'::text, array['Barème']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('declaration_employeur', 'entete_recapitulatif', 'matricule_fiscal', 'Identifiant (7 chiffres) + clé + catégorie (≠ E) + établissement 000', 'identifiant', 'oui', 'Déclaration au niveau de l''établissement principal'::text, array['Matricule fiscal']::text[], array['المعرف الجبائي']::text[], 'matricule_fiscal'::text, null::text, 'CDC 2025, DECEMP00', 'texte'),
    ('declaration_employeur', 'entete_recapitulatif', 'exercice', 'Exercice (année des paiements)', 'periode', 'oui', null::text, array['Exercice']::text[], '{}'::text[], null::text, null::text, 'CDC 2025', 'texte'),
    ('declaration_employeur', 'entete_recapitulatif', 'indicateurs_annexes', 'Indicateurs de dépôt des annexes I à VII (0 = déposée, 1 = non déposée)', 'liste', 'oui', null::text, array['Annexe']::text[], '{}'::text[], null::text, null::text, 'CDC 2025, DECEMP00', 'texte'),
    ('declaration_employeur', 'entete_recapitulatif', 'code_acte', 'Code acte : 0 spontané, 1 régularisation, 2 redressement', 'liste', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'CDC 2025 (en-têtes d''annexes)', 'texte'),
    ('declaration_employeur', 'entete_recapitulatif', 'raison_sociale_activite_adresse', 'Nom/raison sociale, activité, dernière adresse (ville, rue, n°, code postal)', 'adresse', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'CDC 2025', 'texte'),
    ('declaration_employeur', 'recapitulatif_par_nature', 'lignes_recap', 'Pour chaque nature (DECEMP01 à DECEMP49 : salaires régime commun, étrangers, CSS, commissions, loyers, honoraires, artistes, loyers d''hôtels, performance, intérêts, capitaux mobiliers, jetons, travail occasionnel, plus-values immobilières, acquisitions de biens et services par taux, TVA, non-résidents, établissements stables, etc.) : code type, assiette, taux, total retenues', 'liste', 'oui', 'Seules les natures non nulles'::text, array['Assiette', 'Taux', 'Retenue']::text[], '{}'::text[], null::text, null::text, 'CDC 2025', 'texte'),
    ('declaration_employeur', 'recapitulatif_par_nature', 'total_general_retenues', 'Total général des retenues (DECEMP50)', 'montant', 'oui', null::text, array['Total général']::text[], '{}'::text[], null::text, null::text, 'CDC 2025', 'texte'),
    ('declaration_employeur', 'annexe_I_salaires', 'nombre_beneficiaires', 'Nombre total de bénéficiaires', 'nombre', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'CDC 2025', 'texte'),
    ('declaration_employeur', 'annexe_I_salaires', 'identifiant_beneficiaire', 'Identifiant du salarié et type (CIN ou carte de séjour)', 'identifiant', 'oui', 'Donnée personnelle sensible : chiffrement et masquage dans Malica'::text, array['CIN', 'Carte de séjour']::text[], '{}'::text[], null::text, null::text, 'CDC 2025, ANXBEN01', 'texte'),
    ('declaration_employeur', 'annexe_I_salaires', 'nom_prenom', 'Nom et prénom', 'texte', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'CDC 2025', 'texte'),
    ('declaration_employeur', 'annexe_I_salaires', 'emploi', 'Emploi', 'texte', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'CDC 2025', 'texte'),
    ('declaration_employeur', 'annexe_I_salaires', 'adresse_beneficiaire', 'Dernière adresse', 'adresse', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'CDC 2025', 'texte'),
    ('declaration_employeur', 'annexe_I_salaires', 'situation_familiale', 'Situation familiale (célibataire, marié, divorcé, veuf)', 'liste', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'CDC 2025', 'texte'),
    ('declaration_employeur', 'annexe_I_salaires', 'enfants_a_charge', 'Nombre d''enfants à charge', 'nombre', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'CDC 2025', 'texte'),
    ('declaration_employeur', 'annexe_I_salaires', 'periode_travail', 'Date de début, date de fin, durée en jours', 'periode', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'CDC 2025', 'texte'),
    ('declaration_employeur', 'annexe_I_salaires', 'revenu_imposable', 'Revenu imposable', 'montant', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'CDC 2025', 'texte'),
    ('declaration_employeur', 'annexe_I_salaires', 'avantages_nature', 'Avantages en nature', 'montant', 'selon_cas', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'CDC 2025', 'texte'),
    ('declaration_employeur', 'annexe_I_salaires', 'brut_imposable', 'Total brut imposable', 'montant', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'CDC 2025', 'texte'),
    ('declaration_employeur', 'annexe_I_salaires', 'revenu_reinvesti', 'Revenu réinvesti', 'montant', 'selon_cas', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'CDC 2025', 'texte'),
    ('declaration_employeur', 'annexe_I_salaires', 'retenues_regime_commun', 'Retenues opérées (régime commun)', 'montant', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'CDC 2025', 'texte'),
    ('declaration_employeur', 'annexe_I_salaires', 'retenues_etrangers', 'Retenues (étrangers)', 'montant', 'selon_cas', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'CDC 2025', 'texte'),
    ('declaration_employeur', 'annexe_I_salaires', 'retenue_css', 'Contribution sociale de solidarité retenue', 'montant', 'selon_cas', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'CDC 2025', 'texte'),
    ('declaration_employeur', 'annexe_I_salaires', 'net_servi', 'Net servi', 'montant', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'CDC 2025', 'texte'),
    ('declaration_employeur', 'annexe_II_honoraires_commissions_loyers', 'identifiant_beneficiaire_2', 'Type d''identifiant (matricule fiscal ou CIN) et identifiant', 'identifiant', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'CDC 2025, ANXBEN02', 'texte'),
    ('declaration_employeur', 'annexe_II_honoraires_commissions_loyers', 'nom_raison_sociale', 'Nom ou raison sociale', 'texte', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'CDC 2025', 'texte'),
    ('declaration_employeur', 'annexe_II_honoraires_commissions_loyers', 'activite', 'Activité', 'texte', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'CDC 2025', 'texte'),
    ('declaration_employeur', 'annexe_II_honoraires_commissions_loyers', 'adresse', 'Dernière adresse', 'adresse', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'CDC 2025', 'texte'),
    ('declaration_employeur', 'annexe_II_honoraires_commissions_loyers', 'nature_montant', 'Nature du montant (codes 0 à 6 ; 0 = charge à payer non payée)', 'liste', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'CDC 2025', 'texte'),
    ('declaration_employeur', 'annexe_II_honoraires_commissions_loyers', 'montant_brut', 'Montant brut', 'montant', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'CDC 2025', 'texte'),
    ('declaration_employeur', 'annexe_II_honoraires_commissions_loyers', 'ventilation', 'Sous-totaux : honoraires, conseils, travail occasionnel, plus-value immobilière, loyers d''hôtels, artistes', 'liste', 'selon_cas', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'CDC 2025', 'texte'),
    ('declaration_employeur', 'annexe_II_honoraires_commissions_loyers', 'retenue_tva', 'Retenue au titre de la TVA', 'montant', 'selon_cas', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'CDC 2025', 'texte'),
    ('declaration_employeur', 'annexe_II_honoraires_commissions_loyers', 'retenues_operees', 'Retenues opérées', 'montant', 'oui', '0 si nature 0 (charge à payer)'::text, '{}'::text[], '{}'::text[], null::text, null::text, 'CDC 2025', 'texte'),
    ('declaration_employeur', 'annexe_II_honoraires_commissions_loyers', 'net_servi_2', 'Net servi', 'montant', 'oui', '0 si nature 0'::text, '{}'::text[], '{}'::text[], null::text, null::text, 'CDC 2025', 'texte'),
    ('declaration_employeur', 'annexes_III_a_VII', 'beneficiaires_annexes_3_7', 'Bénéficiaires des annexes III à VII (capitaux mobiliers/intérêts, non-résidents, acquisitions de biens et services, etc.) : identifiant, nom, montants, retenues', 'liste', 'selon_cas', 'Objet exact de chaque annexe et champs : INCERTAIN (cahier des charges lu tronqué)'::text, array['Annexe III', 'Annexe IV', 'Annexe V', 'Annexe VI', 'Annexe VII']::text[], '{}'::text[], null::text, null::text, 'CDC 2025 (partiel)', 'texte')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('certificat_retenue_source', 'payeur', 'payeur_matricule', 'Matricule fiscal du payeur (avec établissement)', 'identifiant', 'oui', null::text, array['Matricule fiscal', 'Payeur', 'Débiteur']::text[], array['المعرف الجبائي']::text[], null::text, null::text, 'Code IRPP/IS art. 55 (présumé) ; TEJ', 'texte'),
    ('certificat_retenue_source', 'payeur', 'payeur_nom', 'Raison sociale du payeur', 'texte', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('certificat_retenue_source', 'payeur', 'payeur_adresse', 'Adresse du payeur', 'adresse', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('certificat_retenue_source', 'payeur', 'debiteur_effectif', 'Débiteur effectif (paiement pour le compte d''autrui)', 'texte', 'selon_cas', 'Paiement pour compte de tiers'::text, '{}'::text[], '{}'::text[], null::text, null::text, 'Arrêté 10/05/2024 art. 6', 'texte'),
    ('certificat_retenue_source', 'beneficiaire', 'beneficiaire_identifiant', 'Matricule fiscal ou CIN / carte de séjour du bénéficiaire', 'identifiant', 'oui', 'CIN = donnée personnelle : chiffrement + masquage'::text, array['Bénéficiaire']::text[], '{}'::text[], null::text, null::text, 'Code IRPP/IS art. 55 (présumé) ; CDC déclaration employeur', 'texte'),
    ('certificat_retenue_source', 'beneficiaire', 'beneficiaire_nom', 'Nom ou raison sociale du bénéficiaire', 'texte', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('certificat_retenue_source', 'beneficiaire', 'beneficiaire_adresse', 'Adresse du bénéficiaire', 'adresse', 'selon_cas', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('certificat_retenue_source', 'operation', 'numero_certificat', 'Numéro / identifiant du certificat généré par la plateforme', 'identifiant', 'oui', 'Format INCERTAIN'::text, array['N° certificat']::text[], '{}'::text[], null::text, null::text, 'pratique TEJ', 'pratique'),
    ('certificat_retenue_source', 'operation', 'date_emission', 'Date d''établissement du certificat', 'date', 'oui', '≤ fin du mois suivant le paiement'::text, '{}'::text[], '{}'::text[], null::text, null::text, 'Arrêté art. 8', 'texte'),
    ('certificat_retenue_source', 'operation', 'date_paiement', 'Date de paiement', 'date', 'oui', null::text, array['Date de paiement']::text[], '{}'::text[], null::text, null::text, 'Arrêté art. 6', 'texte'),
    ('certificat_retenue_source', 'operation', 'reference_paiement', 'Référence de l''opération de paiement chez le payeur (chèque, virement…)', 'identifiant', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'Arrêté art. 6', 'texte'),
    ('certificat_retenue_source', 'operation', 'nature_montant', 'Nature du montant payé (honoraires, loyers, achats, salaires, intérêts…)', 'liste', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'Arrêté art. 6', 'texte'),
    ('certificat_retenue_source', 'operation', 'exercice_facturation', 'Exercice de facturation concerné', 'periode', 'selon_cas', 'Le cas échéant (facture d''un exercice antérieur)'::text, '{}'::text[], '{}'::text[], null::text, null::text, 'Arrêté art. 6', 'texte'),
    ('certificat_retenue_source', 'operation', 'references_factures', 'Références des factures payées', 'liste', 'non', null::text, array['Facture n°']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('certificat_retenue_source', 'montants', 'montant_brut', 'Montant brut payé (TTC pour les achats)', 'montant', 'oui', null::text, array['Montant brut']::text[], '{}'::text[], null::text, null::text, 'Code IRPP/IS art. 55 (présumé) ; PwC (seuil TTC)', 'texte'),
    ('certificat_retenue_source', 'montants', 'taux_retenue', 'Taux de retenue IR/IS', 'taux', 'oui', null::text, array['Taux']::text[], '{}'::text[], null::text, null::text, 'PwC WHT', 'texte'),
    ('certificat_retenue_source', 'montants', 'montant_retenue', 'Montant de la retenue IR/IS', 'montant', 'oui', null::text, array['Montant retenu']::text[], array['مبلغ الخصم']::text[], null::text, null::text, 'idem', 'texte'),
    ('certificat_retenue_source', 'montants', 'retenue_tva', 'Retenue au titre de la TVA', 'montant', 'selon_cas', 'Payeurs tenus (Code TVA art. 19)'::text, array['Retenue TVA']::text[], '{}'::text[], null::text, null::text, 'Code TVA art. 19/19 bis', 'texte'),
    ('certificat_retenue_source', 'montants', 'retenue_css', 'Contribution sociale de solidarité retenue (salaires)', 'montant', 'selon_cas', 'Salaires/pensions'::text, '{}'::text[], '{}'::text[], null::text, null::text, 'LF 2026 (presse)', 'texte'),
    ('certificat_retenue_source', 'montants', 'net_servi', 'Net servi', 'montant', 'oui', null::text, array['Net servi', 'Net payé']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('certificat_retenue_source', 'authentification', 'mode_emission', 'Émis sur plateforme TEJ / manuel', 'liste', 'oui', 'Manuel ⇒ amende et TVA retenue non déductible'::text, array['TEJ']::text[], '{}'::text[], null::text, null::text, 'PwC WHT ; arrêté', 'texte'),
    ('certificat_retenue_source', 'authentification', 'statut_correction', 'Certificat initial / corrigé', 'liste', 'non', 'Correction spontanée jusqu''au 30 avril N+1'::text, '{}'::text[], '{}'::text[], null::text, null::text, 'Arrêté art. 12', 'texte'),
    ('certificat_retenue_source', 'authentification', 'signature_cachet', 'Signature / cachet (version papier)', 'texte', 'selon_cas', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('quittance_paiement', 'emetteur', 'recette', 'Recette des finances (nom, code)', 'texte', 'selon_cas', 'Paiement au guichet'::text, array['Recette des finances']::text[], array['القباضة المالية']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('quittance_paiement', 'emetteur', 'numero_quittance', 'N° de quittance / de reçu / de transaction', 'identifiant', 'oui', null::text, array['Quittance n°', 'Reçu', 'N° de transaction']::text[], array['وصل']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('quittance_paiement', 'emetteur', 'date_paiement', 'Date (et heure) d''encaissement', 'date', 'oui', null::text, array['Date']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('quittance_paiement', 'contribuable', 'matricule_fiscal', 'Matricule fiscal', 'identifiant', 'oui', null::text, array['Matricule fiscal']::text[], array['المعرف الجبائي']::text[], 'matricule_fiscal'::text, null::text, 'pratique', 'pratique'),
    ('quittance_paiement', 'contribuable', 'nom', 'Raison sociale / nom', 'texte', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('quittance_paiement', 'objet_et_montants', 'nature_impot', 'Nature de l''impôt / de la déclaration (mensuelle, acompte n°, IS, taxation, amende)', 'liste', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('quittance_paiement', 'objet_et_montants', 'periode', 'Période / exercice concerné', 'periode', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('quittance_paiement', 'objet_et_montants', 'detail_par_impot', 'Ventilation par impôt (TVA, RAS, TCL, TFP, FOPROLOS, timbre…)', 'liste', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('quittance_paiement', 'objet_et_montants', 'principal', 'Montant en principal', 'montant', 'oui', null::text, array['Principal']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('quittance_paiement', 'objet_et_montants', 'penalites', 'Pénalités', 'montant', 'selon_cas', null::text, array['Pénalités']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('quittance_paiement', 'objet_et_montants', 'total_paye', 'Total payé (chiffres et lettres)', 'montant', 'oui', null::text, array['Total', 'Arrêté la présente quittance à la somme de']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('quittance_paiement', 'objet_et_montants', 'mode_paiement', 'Mode (espèces, chèque n°, virement, carte, télépaiement)', 'liste', 'selon_cas', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('quittance_paiement', 'objet_et_montants', 'visa_cachet', 'Cachet / signature du receveur', 'texte', 'selon_cas', 'Quittance papier'::text, array['Le receveur']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('carte_identification_fiscale', 'identifiant', 'matricule_fiscal_complet', 'Matricule fiscal complet', 'identifiant', 'oui', null::text, array['Matricule fiscal', 'Identifiant fiscal', 'Code TVA', 'Code catégorie', 'N° établissement secondaire']::text[], array['المعرف الجبائي']::text[], 'matricule_fiscal'::text, null::text, 'stdnum ; dépôt Malica', 'texte'),
    ('carte_identification_fiscale', 'identifiant', 'identifiant_unique', 'Identifiant unique (7 chiffres)', 'identifiant', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'stdnum', 'texte'),
    ('carte_identification_fiscale', 'identifiant', 'cle_controle', 'Clé de contrôle (lettre)', 'identifiant', 'oui', 'Lettre hors I, O, U ; algorithme INCERTAIN'::text, '{}'::text[], '{}'::text[], null::text, null::text, 'stdnum', 'texte'),
    ('carte_identification_fiscale', 'identifiant', 'code_tva', 'Code TVA', 'liste', 'oui', 'A, P, B, D, N — signification INCERTAIN'::text, array['Code TVA']::text[], '{}'::text[], null::text, null::text, 'stdnum', 'texte'),
    ('carte_identification_fiscale', 'identifiant', 'code_categorie', 'Code catégorie', 'liste', 'oui', 'M (personne morale), P (personne physique) probables ; C, N, E à confirmer (E = établissement secondaire)'::text, array['Code catégorie']::text[], '{}'::text[], null::text, null::text, 'stdnum ; sens INCERTAIN', 'incertain'),
    ('carte_identification_fiscale', 'identifiant', 'numero_etablissement', 'N° d''établissement secondaire', 'identifiant', 'oui', '000 = principal'::text, '{}'::text[], '{}'::text[], null::text, null::text, 'stdnum', 'texte'),
    ('carte_identification_fiscale', 'titulaire', 'raison_sociale', 'Raison sociale / nom et prénom', 'texte', 'oui', null::text, array['Raison sociale', 'Nom et prénom']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('carte_identification_fiscale', 'titulaire', 'nom_commercial', 'Nom commercial / enseigne', 'texte', 'non', null::text, array['Enseigne']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('carte_identification_fiscale', 'titulaire', 'forme_juridique', 'Forme juridique', 'liste', 'selon_cas', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('carte_identification_fiscale', 'titulaire', 'adresse', 'Adresse du siège / de l''établissement', 'adresse', 'oui', null::text, array['Adresse']::text[], array['العنوان']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('carte_identification_fiscale', 'titulaire', 'activite', 'Activité principale (et secondaires)', 'texte', 'oui', null::text, array['Activité']::text[], array['النشاط']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('carte_identification_fiscale', 'titulaire', 'date_debut_activite', 'Date de début d''activité', 'date', 'selon_cas', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('carte_identification_fiscale', 'titulaire', 'regime_fiscal', 'Régime (IS / IRPP réel / forfait) et obligations fiscales (TVA, TCL, TFP, FOPROLOS…)', 'liste', 'selon_cas', null::text, array['Obligations fiscales', 'Régime']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('carte_identification_fiscale', 'delivrance', 'service_emetteur', 'Bureau / centre de contrôle des impôts', 'texte', 'oui', null::text, array['Bureau de contrôle des impôts']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('carte_identification_fiscale', 'delivrance', 'date_delivrance', 'Date de délivrance', 'date', 'oui', null::text, array['Délivrée le']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('carte_identification_fiscale', 'delivrance', 'identifiant_unique_rne', 'Identifiant unique au Registre national des entreprises (si mentionné)', 'identifiant', 'non', 'Lien MF/RNE INCERTAIN'::text, array['RNE', 'Identifiant unique']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('carte_identification_fiscale', 'delivrance', 'cachet_signature', 'Cachet et signature', 'texte', 'selon_cas', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('attestation_situation_fiscale', 'identification', 'numero_attestation', 'N° de l''attestation', 'identifiant', 'selon_cas', null::text, array['N°']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('attestation_situation_fiscale', 'identification', 'matricule_fiscal', 'Matricule fiscal', 'identifiant', 'oui', null::text, array['Matricule fiscal']::text[], array['المعرف الجبائي']::text[], 'matricule_fiscal'::text, null::text, 'pratique', 'pratique'),
    ('attestation_situation_fiscale', 'identification', 'raison_sociale', 'Raison sociale / nom', 'texte', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('attestation_situation_fiscale', 'identification', 'adresse', 'Adresse', 'adresse', 'selon_cas', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('attestation_situation_fiscale', 'attestation', 'objet', 'Objet / usage (participation marché public, etc.)', 'texte', 'selon_cas', null::text, array['Marché public']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('attestation_situation_fiscale', 'attestation', 'constat_declarations', 'Constat de dépôt des déclarations exigibles', 'booleen', 'oui', null::text, array['a déposé ses déclarations', 'en situation régulière']::text[], '{}'::text[], null::text, null::text, 'pratique ; libellé exact INCERTAIN', 'incertain'),
    ('attestation_situation_fiscale', 'attestation', 'constat_paiements', 'Constat de paiement / absence de dettes fiscales (ou échéancier accordé)', 'booleen', 'oui', null::text, array['n''est redevable d''aucun impôt', 'dette fiscale']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('attestation_situation_fiscale', 'attestation', 'periode_couverte', 'Période / date d''arrêté de la situation', 'date', 'selon_cas', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('attestation_situation_fiscale', 'attestation', 'date_delivrance', 'Date de délivrance', 'date', 'oui', null::text, array['Délivrée le']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('attestation_situation_fiscale', 'attestation', 'date_validite', 'Date de fin de validité', 'date', 'selon_cas', 'Durée INCERTAIN'::text, array['Valable jusqu''au']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('attestation_situation_fiscale', 'attestation', 'service_signataire', 'Service émetteur, cachet, signature', 'texte', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('attestation_situation_fiscale', 'attestation', 'code_verification', 'Code ou QR de vérification (attestation en ligne)', 'identifiant', 'non', 'Existence INCERTAIN'::text, '{}'::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('avis_verification', 'mentions_obligatoires', 'service_cachet', 'Service de contrôle et cachet', 'texte', 'oui', null::text, array['Centre régional de contrôle des impôts', 'Direction des grandes entreprises']::text[], '{}'::text[], null::text, null::text, 'CDPF art. 39', 'texte'),
    ('avis_verification', 'mentions_obligatoires', 'type_verification', 'Type : approfondie / ponctuelle', 'liste', 'oui', null::text, array['Vérification approfondie', 'Vérification ponctuelle']::text[], array['مراجعة معمقة']::text[], null::text, null::text, 'CDPF art. 38-39 ; ponctuelle LF 2022', 'texte'),
    ('avis_verification', 'mentions_obligatoires', 'impots_concernes', 'Impôts et taxes vérifiés', 'liste', 'oui', null::text, array['Impôts concernés']::text[], '{}'::text[], null::text, null::text, 'CDPF art. 39', 'texte'),
    ('avis_verification', 'mentions_obligatoires', 'periode_verifiee', 'Période vérifiée', 'periode', 'oui', 'Dans la limite de la prescription (4 ans ; 10 ans si non déclaré)'::text, array['Période']::text[], '{}'::text[], null::text, null::text, 'CDPF art. 39 ; art. 19-20', 'texte'),
    ('avis_verification', 'mentions_obligatoires', 'agents_verificateurs', 'Noms/qualité des agents chargés', 'liste', 'oui', null::text, array['Vérificateurs']::text[], '{}'::text[], null::text, null::text, 'CDPF art. 39', 'texte'),
    ('avis_verification', 'mentions_obligatoires', 'date_debut', 'Date de début de la vérification', 'date', 'oui', '≥ date de notification + 15 jours'::text, array['Date de début']::text[], '{}'::text[], null::text, null::text, 'CDPF art. 39', 'texte'),
    ('avis_verification', 'mentions_obligatoires', 'droit_assistance', 'Mention du droit d''être assisté ou représenté', 'booleen', 'oui', null::text, array['assisté', 'conseil de votre choix']::text[], '{}'::text[], null::text, null::text, 'CDPF art. 39 et 42', 'texte'),
    ('avis_verification', 'notification', 'date_notification', 'Date de notification (remise, LRAR, huissier…)', 'date', 'oui', null::text, array['Notifié le']::text[], '{}'::text[], null::text, null::text, 'CDPF art. 10', 'texte'),
    ('avis_verification', 'notification', 'reference_avis', 'N° / référence de l''avis', 'identifiant', 'selon_cas', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avis_verification', 'notification', 'report_demande', 'Report demandé/accordé (≤ 60 jours)', 'date', 'non', null::text, array['Report']::text[], '{}'::text[], null::text, null::text, 'CDPF art. 39', 'texte'),
    ('avis_verification', 'notification', 'matricule_fiscal', 'Matricule et identité du contribuable', 'identifiant', 'oui', null::text, '{}'::text[], array['المعرف الجبائي']::text[], 'matricule_fiscal'::text, null::text, 'pratique', 'pratique')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('notification_resultats_verification', 'entete', 'service_emetteur', 'Service émetteur', 'texte', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'CDPF art. 43', 'texte'),
    ('notification_resultats_verification', 'entete', 'reference', 'Référence de la notification', 'identifiant', 'selon_cas', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('notification_resultats_verification', 'entete', 'matricule_fiscal', 'Matricule et identité', 'identifiant', 'oui', null::text, '{}'::text[], array['المعرف الجبائي']::text[], 'matricule_fiscal'::text, null::text, 'pratique', 'pratique'),
    ('notification_resultats_verification', 'entete', 'nature_verification', 'Nature de la vérification (préliminaire / ponctuelle / approfondie)', 'liste', 'oui', null::text, array['Vérification préliminaire', 'Vérification approfondie']::text[], '{}'::text[], null::text, null::text, 'CDPF art. 43', 'texte'),
    ('notification_resultats_verification', 'entete', 'date_notification', 'Date de notification', 'date', 'oui', 'Point de départ des délais de réponse'::text, '{}'::text[], array['الإعلام بنتائج المراجعة']::text[], null::text, null::text, 'CDPF art. 10 et 43', 'texte'),
    ('notification_resultats_verification', 'entete', 'reference_avis', 'Référence de l''avis de vérification', 'identifiant', 'selon_cas', 'Vérification approfondie/ponctuelle'::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('notification_resultats_verification', 'chefs_de_redressement', 'chef_impot', 'Pour chaque chef : impôt concerné', 'liste', 'oui', null::text, array['Chef de redressement']::text[], '{}'::text[], null::text, null::text, 'CDPF art. 43', 'texte'),
    ('notification_resultats_verification', 'chefs_de_redressement', 'chef_periode', 'Période / exercice', 'periode', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'CDPF art. 43', 'texte'),
    ('notification_resultats_verification', 'chefs_de_redressement', 'chef_motif', 'Motif et fondement juridique', 'texte', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'CDPF art. 43', 'texte'),
    ('notification_resultats_verification', 'chefs_de_redressement', 'chef_methode', 'Méthode de détermination (comptabilité, reconstitution, présomptions)', 'texte', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'CDPF art. 43', 'texte'),
    ('notification_resultats_verification', 'chefs_de_redressement', 'chef_base_redressee', 'Base déclarée / base redressée / écart', 'montant', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'CDPF art. 43', 'texte'),
    ('notification_resultats_verification', 'chefs_de_redressement', 'chef_impot_rappele', 'Impôt en principal rappelé', 'montant', 'oui', null::text, array['Principal']::text[], '{}'::text[], null::text, null::text, 'CDPF art. 43', 'texte'),
    ('notification_resultats_verification', 'chefs_de_redressement', 'chef_penalites', 'Pénalités', 'montant', 'oui', null::text, array['Pénalités']::text[], '{}'::text[], null::text, null::text, 'CDPF art. 43', 'texte'),
    ('notification_resultats_verification', 'totaux_et_droits', 'total_principal', 'Total principal', 'montant', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'CDPF art. 43', 'texte'),
    ('notification_resultats_verification', 'totaux_et_droits', 'total_penalites', 'Total pénalités', 'montant', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'CDPF art. 43', 'texte'),
    ('notification_resultats_verification', 'totaux_et_droits', 'total_general', 'Total général', 'montant', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('notification_resultats_verification', 'totaux_et_droits', 'delai_reponse', 'Délai de réponse indiqué (30 jours art. 43 / 45 jours art. 44)', 'nombre', 'oui', null::text, array['Délai de réponse']::text[], '{}'::text[], null::text, null::text, 'CDPF art. 43-44 (articulation INCERTAIN)', 'incertain'),
    ('notification_resultats_verification', 'totaux_et_droits', 'reponse_contribuable', 'Réponse du contribuable : date, acceptation partielle/totale, opposition', 'liste', 'non', 'Document lié'::text, '{}'::text[], '{}'::text[], null::text, null::text, 'CDPF art. 44-45', 'texte'),
    ('notification_resultats_verification', 'totaux_et_droits', 'reponse_administration', 'Réponse de l''administration (date, chefs maintenus/abandonnés)', 'liste', 'non', '≤ 6 mois'::text, '{}'::text[], '{}'::text[], null::text, null::text, 'CDPF art. 44 bis', 'texte')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('arrete_taxation_office', 'mentions_obligatoires', 'services', 'Service ayant procédé à la vérification et autorité signataire', 'texte', 'oui', null::text, array['Arrêté de taxation d''office']::text[], array['قرار التوظيف الإجباري']::text[], null::text, null::text, 'CDPF art. 50', 'texte'),
    ('arrete_taxation_office', 'mentions_obligatoires', 'methode', 'Méthode de détermination', 'texte', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'CDPF art. 50', 'texte'),
    ('arrete_taxation_office', 'mentions_obligatoires', 'fondements_juridiques', 'Fondements juridiques', 'texte', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'CDPF art. 50', 'texte'),
    ('arrete_taxation_office', 'mentions_obligatoires', 'impots_annees', 'Impôts et années concernés', 'liste', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'CDPF art. 50', 'texte'),
    ('arrete_taxation_office', 'mentions_obligatoires', 'montants', 'Montants (principal, pénalités, total)', 'montant', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'CDPF art. 50', 'texte'),
    ('arrete_taxation_office', 'mentions_obligatoires', 'recette_finances', 'Recette des finances chargée du recouvrement', 'texte', 'oui', null::text, array['Recette des finances']::text[], array['القباضة المالية']::text[], null::text, null::text, 'CDPF art. 50', 'texte'),
    ('arrete_taxation_office', 'mentions_obligatoires', 'droit_opposition', 'Mention du droit d''opposition (recours) et délai', 'texte', 'oui', null::text, array['opposition']::text[], '{}'::text[], null::text, null::text, 'CDPF art. 50', 'texte'),
    ('arrete_taxation_office', 'mentions_obligatoires', 'date_signature', 'Date et signature', 'date', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'CDPF art. 50', 'texte'),
    ('arrete_taxation_office', 'mentions_obligatoires', 'date_notification', 'Date de notification', 'date', 'oui', '≤ 30 mois après résultats (désaccord) ou 12 mois après mise en demeure'::text, '{}'::text[], '{}'::text[], null::text, null::text, 'CDPF art. 51 et 51 bis', 'texte')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('attestation_suspension_tva', 'decision', 'numero_attestation', 'N° de l''attestation / décision', 'identifiant', 'oui', null::text, array['Attestation d''achat en suspension']::text[], '{}'::text[], null::text, null::text, 'Code TVA art. 11 (n° repris sur factures)', 'texte'),
    ('attestation_suspension_tva', 'decision', 'date_attestation', 'Date de l''attestation', 'date', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'Code TVA art. 11', 'texte'),
    ('attestation_suspension_tva', 'decision', 'beneficiaire_matricule', 'Matricule fiscal du bénéficiaire', 'identifiant', 'oui', null::text, '{}'::text[], array['المعرف الجبائي']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('attestation_suspension_tva', 'decision', 'beneficiaire_nom', 'Raison sociale', 'texte', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('attestation_suspension_tva', 'decision', 'periode_validite', 'Période de validité', 'periode', 'selon_cas', null::text, array['Valable du … au …']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('attestation_suspension_tva', 'decision', 'plafond_quota', 'Montant plafond des achats en suspension', 'montant', 'selon_cas', null::text, array['Quota']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('attestation_suspension_tva', 'decision', 'objet', 'Biens/services couverts', 'texte', 'selon_cas', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('attestation_suspension_tva', 'decision', 'service_emetteur', 'Service émetteur, cachet, signature', 'texte', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('attestation_suspension_tva', 'bon_commande_lie', 'mention_bc', 'Mention « Achats en suspension de la taxe sur la valeur ajoutée » + référence art. 11 + décision', 'booleen', 'oui', 'Sur chaque bon de commande (double exemplaire)'::text, array['Achats en suspension de la taxe sur la valeur ajoutée']::text[], '{}'::text[], null::text, null::text, 'Code TVA art. 11-I', 'texte'),
    ('attestation_suspension_tva', 'bon_commande_lie', 'fournisseur', 'Fournisseur destinataire de l''original', 'texte', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'Code TVA art. 11-I', 'texte')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('attestation_exoneration_non_retenue', 'attestation', 'numero', 'N° de l''attestation', 'identifiant', 'oui', null::text, array['Attestation de non-retenue', 'Attestation d''exonération']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('attestation_exoneration_non_retenue', 'attestation', 'beneficiaire_matricule', 'Matricule fiscal du bénéficiaire', 'identifiant', 'oui', null::text, '{}'::text[], array['المعرف الجبائي']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('attestation_exoneration_non_retenue', 'attestation', 'beneficiaire_nom', 'Raison sociale', 'texte', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('attestation_exoneration_non_retenue', 'attestation', 'type_avantage', 'Type : exonération TVA / exonération droit de timbre / dispense de retenue IR-IS / réduction de taux', 'liste', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('attestation_exoneration_non_retenue', 'attestation', 'base_legale_citee', 'Base légale citée sur l''attestation (article, loi, décret, convention)', 'texte', 'oui', 'À stocker tel quel et faire valider'::text, array['en application de l''article']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('attestation_exoneration_non_retenue', 'attestation', 'perimetre', 'Opérations / biens / services couverts', 'texte', 'selon_cas', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('attestation_exoneration_non_retenue', 'attestation', 'periode_validite', 'Début et fin de validité', 'periode', 'selon_cas', null::text, array['Valable jusqu''au']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('attestation_exoneration_non_retenue', 'attestation', 'date_delivrance', 'Date de délivrance', 'date', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('attestation_exoneration_non_retenue', 'attestation', 'service_signataire', 'Service émetteur, cachet, signature', 'texte', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('statuts', 'En-tête et nature de l''acte', 'type_acte', 'Nature de l''acte (statuts constitutifs / statuts mis à jour / statuts modifiés)', 'liste', 'oui', null::text, array['Statuts', 'Statuts mis à jour', 'Statuts modifiés', 'Acte constitutif']::text[], array['النظام الأساسي']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('statuts', 'En-tête et nature de l''acte', 'forme_acte', 'Forme de l''acte (sous seing privé / authentique)', 'liste', 'oui', 'SARL : écrit signé par tous les associés ou mandataires munis d''un pouvoir spécial'::text, array['acte sous seing privé', 'acte authentique']::text[], '{}'::text[], null::text, null::text, 'CSC art. 96', 'texte'),
    ('statuts', 'En-tête et nature de l''acte', 'date_acte', 'Date de signature des statuts', 'date', 'oui', null::text, array['Fait à', 'le']::text[], '{}'::text[], null::text, null::text, 'pratique (preuve de la date ; enregistrement)', 'pratique'),
    ('statuts', 'En-tête et nature de l''acte', 'lieu_acte', 'Lieu de signature', 'texte', 'non', null::text, array['Fait à']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('statuts', 'En-tête et nature de l''acte', 'date_mise_a_jour', 'Date de mise à jour et référence de l''AGE ayant modifié les statuts', 'date', 'selon_cas', 'Statuts mis à jour après modification'::text, array['Statuts mis à jour suite à l''AGE du']::text[], '{}'::text[], null::text, null::text, 'pratique ; CSC art. 16 (publicité des modifications)', 'pratique'),
    ('statuts', 'En-tête et nature de l''acte', 'enregistrement_recette', 'Mentions d''enregistrement (recette des finances, date, numéro de quittance, droits payés)', 'texte', 'selon_cas', 'Si l''acte a été présenté à l''enregistrement'::text, array['Enregistré à la recette', 'Quittance n°']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN - Code des droits d''enregistrement et de timbre non consulté', 'incertain'),
    ('statuts', 'Identité des associés / fondateurs', 'associe_type', 'Type d''associé (personne physique / personne morale)', 'liste', 'oui', 'Pour chaque associé'::text, array['Entre les soussignés']::text[], '{}'::text[], null::text, null::text, 'CSC art. 96 (SARL)', 'texte'),
    ('statuts', 'Identité des associés / fondateurs', 'associe_pp_nom_prenom', 'Nom et prénom de l''associé personne physique (donnée personnelle)', 'texte', 'selon_cas', 'Associé personne physique'::text, array['M.', 'Mme', 'né le']::text[], '{}'::text[], null::text, null::text, 'CSC art. 96', 'texte'),
    ('statuts', 'Identité des associés / fondateurs', 'associe_pp_etat_civil', 'État civil (date et lieu de naissance)', 'texte', 'selon_cas', 'Associé personne physique - SARL'::text, array['né le', 'à']::text[], '{}'::text[], null::text, null::text, 'CSC art. 96', 'texte'),
    ('statuts', 'Identité des associés / fondateurs', 'associe_pp_piece_identite', 'Type et numéro de pièce d''identité (CIN / passeport / carte de séjour) - donnée sensible, à masquer', 'identifiant', 'non', 'Pratique quasi constante'::text, array['titulaire de la CIN n°', 'passeport n°']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('statuts', 'Identité des associés / fondateurs', 'associe_pp_domicile', 'Domicile de l''associé', 'adresse', 'selon_cas', 'Associé personne physique - SARL'::text, array['demeurant à']::text[], '{}'::text[], null::text, null::text, 'CSC art. 96', 'texte'),
    ('statuts', 'Identité des associés / fondateurs', 'associe_pp_nationalite', 'Nationalité de l''associé', 'texte', 'selon_cas', 'Associé personne physique - SARL'::text, array['de nationalité']::text[], '{}'::text[], null::text, null::text, 'CSC art. 96', 'texte'),
    ('statuts', 'Identité des associés / fondateurs', 'associe_pm_denomination', 'Dénomination de l''associé personne morale', 'texte', 'selon_cas', 'Associé personne morale'::text, array['la société']::text[], '{}'::text[], null::text, null::text, 'CSC art. 96', 'texte'),
    ('statuts', 'Identité des associés / fondateurs', 'associe_pm_nationalite', 'Nationalité de l''associé personne morale', 'texte', 'selon_cas', 'Associé personne morale'::text, '{}'::text[], '{}'::text[], null::text, null::text, 'CSC art. 96', 'texte'),
    ('statuts', 'Identité des associés / fondateurs', 'associe_pm_siege', 'Siège de l''associé personne morale', 'adresse', 'selon_cas', 'Associé personne morale'::text, array['dont le siège est à']::text[], '{}'::text[], null::text, null::text, 'CSC art. 96', 'texte'),
    ('statuts', 'Identité des associés / fondateurs', 'associe_pm_identifiant', 'Identifiant unique RNE / matricule fiscal de l''associé personne morale', 'identifiant', 'non', 'Associé personne morale tunisienne'::text, array['identifiant unique', 'matricule fiscal']::text[], array['المعرف الجبائي']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('statuts', 'Identité des associés / fondateurs', 'associe_pm_representant', 'Représentant de l''associé personne morale et sa qualité', 'texte', 'selon_cas', 'Associé personne morale'::text, array['représentée par', 'en sa qualité de']::text[], '{}'::text[], null::text, null::text, 'CSC art. 96 (mandataire muni d''un pouvoir spécial)', 'texte'),
    ('statuts', 'Identité des associés / fondateurs', 'nombre_associes', 'Nombre d''associés / actionnaires', 'nombre', 'oui', 'SARL : 2 à 50 ; SUARL : 1 ; SA : minimum lu = 7 (phrase tronquée, INCERTAIN)'::text, '{}'::text[], '{}'::text[], null::text, null::text, 'CSC art. 90, 93 ; art. 160 (INCERTAIN)', 'incertain'),
    ('statuts', 'Caractéristiques de la société', 'forme_juridique', 'Forme juridique (SARL / SUARL / SA)', 'liste', 'oui', null::text, array['Forme', 'société à responsabilité limitée', 'société unipersonnelle à responsabilité limitée', 'société anonyme']::text[], array['شركة ذات مسؤولية محدودة', 'شركة خفية الاسم']::text[], null::text, null::text, 'CSC art. 9 ; art. 91 (mention S.A.R.L / S.U.A.R.L)', 'texte'),
    ('statuts', 'Caractéristiques de la société', 'denomination', 'Dénomination sociale', 'texte', 'oui', 'SARL : précédée ou suivie de ''S.A.R.L'' et de l''énonciation du capital'::text, array['Dénomination', 'Raison sociale']::text[], array['التسمية الاجتماعية']::text[], null::text, null::text, 'CSC art. 9, 91', 'texte'),
    ('statuts', 'Caractéristiques de la société', 'sigle', 'Sigle / nom commercial / enseigne', 'texte', 'non', null::text, array['Sigle', 'Enseigne', 'Nom commercial']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('statuts', 'Caractéristiques de la société', 'objet_social', 'Objet social', 'texte', 'oui', null::text, array['Objet', 'La société a pour objet']::text[], '{}'::text[], null::text, null::text, 'CSC art. 9, 96', 'texte'),
    ('statuts', 'Caractéristiques de la société', 'siege_social', 'Siège social', 'adresse', 'oui', 'SARL tunisienne : siège en Tunisie'::text, array['Siège social', 'Le siège est fixé à']::text[], array['المقر الاجتماعي']::text[], null::text, null::text, 'CSC art. 9, 95', 'texte'),
    ('statuts', 'Caractéristiques de la société', 'clause_transfert_siege', 'Clause de transfert du siège (organe compétent)', 'texte', 'non', null::text, array['Il pourra être transféré']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('statuts', 'Caractéristiques de la société', 'duree_annees', 'Durée de la société (années)', 'nombre', 'oui', null::text, array['Durée', 'années à compter de son immatriculation']::text[], array['المدة']::text[], null::text, null::text, 'CSC art. 9, 96', 'texte'),
    ('statuts', 'Caractéristiques de la société', 'point_depart_duree', 'Point de départ de la durée', 'texte', 'non', null::text, array['à compter de']::text[], '{}'::text[], null::text, null::text, 'pratique (généralement l''immatriculation, cf. CSC art. 4)', 'pratique'),
    ('statuts', 'Caractéristiques de la société', 'nationalite_societe', 'Nationalité de la société', 'texte', 'non', null::text, array['nationalité tunisienne']::text[], '{}'::text[], null::text, null::text, 'CSC art. 95, 132 (changement à l''unanimité en SARL)', 'texte'),
    ('statuts', 'Capital, apports et titres', 'capital_montant', 'Montant du capital social', 'montant', 'oui', 'SA : capital minimum légal INCERTAIN (art. 161 illisible)'::text, array['Capital social', 'Le capital social est fixé à']::text[], array['رأس المال']::text[], null::text, null::text, 'CSC art. 9, 92, 96 ; art. 161 INCERTAIN', 'incertain'),
    ('statuts', 'Capital, apports et titres', 'capital_devise', 'Devise du capital (dinar tunisien)', 'texte', 'oui', null::text, array['dinars', 'DT', 'TND']::text[], array['دينار']::text[], null::text, null::text, 'CSC art. 99 (apport en devises converti en dinars)', 'texte'),
    ('statuts', 'Capital, apports et titres', 'nombre_titres', 'Nombre de parts sociales / actions', 'nombre', 'oui', null::text, array['divisé en', 'parts sociales', 'actions']::text[], array['الحصص', 'الأسهم']::text[], null::text, null::text, 'CSC art. 92, 96', 'texte'),
    ('statuts', 'Capital, apports et titres', 'valeur_nominale', 'Valeur nominale d''une part / action', 'montant', 'oui', 'SARL : valeur nominale égale pour toutes les parts'::text, array['de', 'dinars chacune', 'valeur nominale']::text[], array['القيمة الاسمية']::text[], null::text, null::text, 'CSC art. 92', 'texte'),
    ('statuts', 'Capital, apports et titres', 'repartition_titres', 'Répartition des parts/actions par associé (liste : associé, nombre, numéros)', 'liste', 'oui', 'SARL : obligatoire dans l''acte ; SA : liste des souscripteurs en annexe'::text, array['Répartition', 'attribuées aux associés', 'numérotées de']::text[], '{}'::text[], null::text, null::text, 'CSC art. 96 ; SA art. 167 (déclaration de souscription, lecture partielle)', 'texte'),
    ('statuts', 'Capital, apports et titres', 'apport_numeraire_par_associe', 'Montant de l''apport en numéraire par associé', 'montant', 'selon_cas', 'Apports en numéraire'::text, array['Apports en numéraire', 'a apporté la somme de']::text[], '{}'::text[], null::text, null::text, 'CSC art. 96', 'texte'),
    ('statuts', 'Capital, apports et titres', 'apport_nature_description', 'Description de l''apport en nature', 'texte', 'selon_cas', 'Apports en nature'::text, array['Apports en nature']::text[], '{}'::text[], null::text, null::text, 'CSC art. 96, 100', 'texte'),
    ('statuts', 'Capital, apports et titres', 'apport_nature_evaluation', 'Évaluation de chaque apport en nature', 'montant', 'selon_cas', 'Apports en nature'::text, array['évalué à']::text[], '{}'::text[], null::text, null::text, 'CSC art. 100', 'texte'),
    ('statuts', 'Capital, apports et titres', 'commissaire_aux_apports', 'Identité du commissaire aux apports ou mention de renonciation unanime', 'texte', 'selon_cas', 'Apports en nature ; renonciation possible si chaque apport <= 3 000 dinars (SARL)'::text, array['commissaire aux apports', 'rapport annexé']::text[], '{}'::text[], null::text, null::text, 'CSC art. 100', 'texte'),
    ('statuts', 'Capital, apports et titres', 'apport_industrie', 'Apport en industrie (nature, droits conférés)', 'texte', 'non', 'Si prévu et admis pour la forme'::text, array['apport en industrie']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN - non vérifié pour SARL/SA', 'incertain'),
    ('statuts', 'Capital, apports et titres', 'modalites_liberation', 'Modalités de libération (intégrale / partielle, échéancier)', 'texte', 'oui', 'SARL : libération intégrale requise et mention expresse'::text, array['entièrement libérées', 'libération']::text[], '{}'::text[], null::text, null::text, 'CSC art. 96, 97', 'texte'),
    ('statuts', 'Capital, apports et titres', 'declaration_liberation_integrale', 'Déclaration expresse que les parts sont réparties et intégralement libérées', 'booleen', 'selon_cas', 'SARL / SUARL'::text, array['intégralement libérées', 'réparties entre les associés']::text[], '{}'::text[], null::text, null::text, 'CSC art. 97', 'texte'),
    ('statuts', 'Capital, apports et titres', 'depositaire_fonds', 'Établissement financier dépositaire des fonds et date du certificat de dépôt', 'texte', 'selon_cas', 'Fonds déposés en banque'::text, array['déposées auprès de', 'certificat de dépôt']::text[], '{}'::text[], null::text, null::text, 'CSC art. 98 ; SA art. 167 (mention de l''établissement bancaire, lecture partielle)', 'texte'),
    ('statuts', 'Capital, apports et titres', 'categories_actions', 'Catégories d''actions (ordinaires, à dividende prioritaire, etc.) et droits attachés', 'liste', 'selon_cas', 'SA émettant plusieurs catégories'::text, array['actions ordinaires', 'actions à dividende prioritaire']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN - articles non lus', 'incertain'),
    ('statuts', 'Capital, apports et titres', 'forme_titres', 'Forme des actions (nominatives) et tenue du registre des titres', 'texte', 'non', 'SA'::text, array['nominatives', 'registre']::text[], '{}'::text[], null::text, null::text, 'CSC art. 11 bis (registre des valeurs mobilières)', 'texte'),
    ('statuts', 'Cession et transmission des titres', 'clause_agrement', 'Clause d''agrément des cessions (organe, majorité, délai)', 'texte', 'selon_cas', 'SARL : régime légal de cession à des tiers ; SA : clause facultative'::text, array['Cession des parts', 'agrément']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN - articles SARL sur cession (env. 107-110) non lus', 'incertain'),
    ('statuts', 'Cession et transmission des titres', 'clause_preemption', 'Clause de préemption', 'texte', 'non', null::text, array['droit de préemption']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('statuts', 'Cession et transmission des titres', 'transmission_deces', 'Transmission en cas de décès', 'texte', 'non', 'SARL : non dissoute par le décès d''un associé, clause contraire écartée'::text, array['décès d''un associé']::text[], '{}'::text[], null::text, null::text, 'CSC art. 141 (début lu)', 'texte'),
    ('statuts', 'Cession et transmission des titres', 'registre_associes', 'Référence au registre des associés (identité, parts, versements, cessions)', 'texte', 'non', 'SARL'::text, array['registre des associés']::text[], '{}'::text[], null::text, null::text, 'CSC art. 111', 'texte'),
    ('statuts', 'Direction et administration', 'mode_direction', 'Mode de direction (gérance / conseil d''administration avec PDG ou président + DG / directoire et conseil de surveillance)', 'liste', 'oui', null::text, array['Gérance', 'Conseil d''administration', 'Directoire', 'Conseil de surveillance']::text[], array['مجلس الإدارة']::text[], null::text, null::text, 'CSC art. 112 (SARL) ; art. 189 à 221 (SA à CA) ; art. 245 (conseil de surveillance)', 'texte'),
    ('statuts', 'Direction et administration', 'gerants_designes', 'Gérant(s) statutaire(s) : identité (personne physique obligatoire)', 'liste', 'selon_cas', 'SARL/SUARL si gérant nommé dans les statuts ; le gérant doit être une personne physique'::text, array['est nommé gérant', 'Gérance']::text[], '{}'::text[], null::text, null::text, 'CSC art. 96, 112', 'texte'),
    ('statuts', 'Direction et administration', 'gerant_duree_mandat', 'Durée du mandat de gérant', 'periode', 'non', 'SARL'::text, array['pour une durée de', 'durée illimitée']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN - durée légale par défaut non lue', 'incertain'),
    ('statuts', 'Direction et administration', 'gerant_pouvoirs_limitations', 'Pouvoirs du gérant et limitations statutaires (actes soumis à autorisation)', 'texte', 'non', null::text, array['pouvoirs du gérant', 'ne pourra sans l''autorisation']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('statuts', 'Direction et administration', 'gerant_revocation', 'Règle de révocation du gérant statutaire', 'texte', 'non', 'SARL - légal : 3/4 du capital'::text, array['révocation']::text[], '{}'::text[], null::text, null::text, 'CSC art. 122', 'texte'),
    ('statuts', 'Direction et administration', 'gerant_remuneration', 'Rémunération du gérant', 'texte', 'non', null::text, array['rémunération']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('statuts', 'Direction et administration', 'ca_nombre_administrateurs', 'Nombre d''administrateurs (min / max)', 'nombre', 'selon_cas', 'SA à conseil d''administration'::text, array['Conseil d''administration composé de']::text[], '{}'::text[], null::text, null::text, 'CSC art. 189 (bornes légales INCERTAIN : texte tronqué)', 'incertain'),
    ('statuts', 'Direction et administration', 'ca_premiers_administrateurs', 'Premiers administrateurs désignés', 'liste', 'selon_cas', 'SA - nomination par l''assemblée constitutive ou les statuts'::text, array['premiers administrateurs']::text[], '{}'::text[], null::text, null::text, 'CSC art. 190 (lecture partielle)', 'texte'),
    ('statuts', 'Direction et administration', 'ca_duree_mandat', 'Durée du mandat des administrateurs', 'periode', 'selon_cas', 'SA'::text, array['durée de leurs fonctions']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN - art. 190 non lu intégralement', 'incertain'),
    ('statuts', 'Direction et administration', 'ca_quorum_majorite', 'Quorum et majorité du conseil', 'texte', 'selon_cas', 'SA'::text, array['Le conseil ne délibère valablement que si']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN - règle légale CA non lue (seul le conseil de surveillance art. 245 lu : moitié présents, majorité des présents ou représentés)', 'incertain'),
    ('statuts', 'Direction et administration', 'direction_generale', 'Organisation de la direction générale (PDG ou dissociation président / DG)', 'liste', 'selon_cas', 'SA ; DG personne physique'::text, array['Président Directeur Général', 'Directeur Général']::text[], array['الرئيس المدير العام', 'المدير العام']::text[], null::text, null::text, 'CSC art. 211, 217 (lecture partielle)', 'texte'),
    ('statuts', 'Direction et administration', 'jetons_presence', 'Rémunération des administrateurs (jetons de présence)', 'texte', 'non', 'SA'::text, array['jetons de présence']::text[], '{}'::text[], null::text, null::text, 'pratique (BVMT-TRE-2018, résolution 6)', 'pratique'),
    ('statuts', 'Direction et administration', 'conventions_reglementees', 'Clause sur conventions réglementées', 'texte', 'non', null::text, array['conventions']::text[], '{}'::text[], null::text, null::text, 'CSC art. 115 (SARL) ; art. 200 (SA)', 'texte'),
    ('statuts', 'Contrôle des comptes', 'commissaire_aux_comptes_clause', 'Clause de désignation du commissaire aux comptes (mandat 3 ans)', 'texte', 'selon_cas', 'SA : obligatoire ; SARL : si 2 des 3 seuils (bilan, produits HT, effectif moyen) dépassés, hors premier exercice ; ou à la demande d''1/5 du capital'::text, array['Commissaire aux comptes']::text[], array['مراقب الحسابات']::text[], null::text, null::text, 'CSC art. 13, 13 bis, 123, 124, 125 ; SA art. 260 ; seuils chiffrés par décret INCERTAIN', 'incertain'),
    ('statuts', 'Assemblées et décisions collectives', 'ag_convocation_modalites', 'Modalités et délais de convocation', 'texte', 'non', 'SARL - légal : écrit, 20 jours au moins, avec ordre du jour et texte des résolutions'::text, array['convocation', 'lettre recommandée']::text[], '{}'::text[], null::text, null::text, 'CSC art. 126', 'texte'),
    ('statuts', 'Assemblées et décisions collectives', 'ag_quorum_majorite_statutaires', 'Quorums et majorités statutaires (AGO, AGE, 1re et 2e convocation)', 'texte', 'non', 'SARL : options statutaires AGE (quorum 50 % en 1re, 2/3 des présents) ; SA : à paramétrer'::text, array['quorum', 'majorité']::text[], array['النصاب', 'الأغلبية']::text[], null::text, null::text, 'CSC art. 130, 131 (SARL) ; SA art. 279, 291 INCERTAIN/partiel', 'incertain'),
    ('statuts', 'Assemblées et décisions collectives', 'ag_seuil_admission_actions', 'Nombre minimum d''actions pour assister à l''AGO (et regroupement)', 'nombre', 'non', 'SA - plafond légal INCERTAIN (texte coupé)'::text, array['posséder au moins', 'actions pour assister']::text[], '{}'::text[], null::text, null::text, 'CSC art. 279 (lecture partielle)', 'texte'),
    ('statuts', 'Assemblées et décisions collectives', 'ag_representation', 'Règles de représentation (procuration spéciale, mandataire autorisé)', 'texte', 'non', 'SARL : procuration spéciale'::text, array['se faire représenter', 'procuration']::text[], '{}'::text[], null::text, null::text, 'CSC art. 129', 'texte'),
    ('statuts', 'Assemblées et décisions collectives', 'decisions_associe_unique_registre', 'Consignation des décisions de l''associé unique dans un registre spécial coté et paraphé', 'booleen', 'selon_cas', 'SUARL'::text, array['registre spécial']::text[], '{}'::text[], null::text, null::text, 'CSC art. 154 (lecture partielle)', 'texte'),
    ('statuts', 'Exercice social et résultat', 'exercice_debut', 'Date d''ouverture de l''exercice', 'date', 'oui', null::text, array['L''exercice social commence le']::text[], array['السنة المحاسبية']::text[], null::text, null::text, 'CSC art. 96 (date de clôture)', 'texte'),
    ('statuts', 'Exercice social et résultat', 'exercice_cloture', 'Date de clôture des états financiers annuels', 'date', 'oui', null::text, array['se termine le', 'clôture']::text[], '{}'::text[], null::text, null::text, 'CSC art. 96', 'texte'),
    ('statuts', 'Exercice social et résultat', 'premier_exercice', 'Durée particulière du premier exercice', 'periode', 'non', null::text, array['Par exception, le premier exercice']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('statuts', 'Exercice social et résultat', 'reserve_legale_clause', 'Clause de réserve légale (5 % jusqu''à 10 % du capital)', 'taux', 'non', 'Règle légale SARL applicable même sans clause'::text, array['réserve légale']::text[], array['الاحتياطي القانوني']::text[], null::text, null::text, 'CSC art. 140 (SARL) ; SA INCERTAIN', 'incertain'),
    ('statuts', 'Exercice social et résultat', 'reserves_statutaires', 'Réserves statutaires et règles de répartition des bénéfices', 'texte', 'non', null::text, array['réserves statutaires', 'bénéfice distribuable']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('statuts', 'Dissolution, litiges, formalités', 'clause_dissolution_liquidation', 'Dissolution anticipée et liquidation', 'texte', 'non', null::text, array['Dissolution', 'Liquidation']::text[], '{}'::text[], null::text, null::text, 'pratique ; capitaux propres < moitié du capital : CSC art. 388 cité en pratique (BVMT)', 'pratique'),
    ('statuts', 'Dissolution, litiges, formalités', 'clause_litiges', 'Clause de règlement des litiges (tribunal compétent / arbitrage)', 'texte', 'non', null::text, array['Contestations', 'tribunal']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('statuts', 'Dissolution, litiges, formalités', 'pouvoirs_formalites', 'Pouvoirs pour formalités de constitution / publicité', 'texte', 'non', null::text, array['tous pouvoirs sont donnés au porteur']::text[], '{}'::text[], null::text, null::text, 'CSC art. 14, 15', 'texte'),
    ('statuts', 'Dissolution, litiges, formalités', 'frais_constitution', 'Reprise des frais et des actes accomplis pour la société en formation', 'texte', 'non', null::text, array['actes accomplis pour le compte de la société en formation']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('statuts', 'Dissolution, litiges, formalités', 'signatures', 'Signatures de tous les associés ou mandataires (avec légalisation le cas échéant)', 'liste', 'oui', 'SARL : tous les associés'::text, array['Lu et approuvé', 'Signature légalisée']::text[], '{}'::text[], null::text, null::text, 'CSC art. 96', 'texte'),
    ('statuts', 'Dissolution, litiges, formalités', 'annexes', 'Annexes (rapport du commissaire aux apports, certificat de dépôt, liste des souscripteurs)', 'liste', 'selon_cas', null::text, array['Annexe']::text[], '{}'::text[], null::text, null::text, 'CSC art. 98, 100 ; SA art. 167', 'texte')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('extrait_rne', 'En-tête et authentification', 'type_extrait', 'Type d''extrait (personne morale / personne physique ; simple / complet)', 'liste', 'oui', null::text, array['Extrait du registre national des entreprises']::text[], array['السجل الوطني للمؤسسات']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('extrait_rne', 'En-tête et authentification', 'date_delivrance', 'Date (et heure) de délivrance de l''extrait', 'date', 'oui', null::text, array['Délivré le', 'Date d''édition']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('extrait_rne', 'En-tête et authentification', 'numero_extrait', 'Numéro / référence de l''extrait', 'identifiant', 'non', null::text, array['Référence']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('extrait_rne', 'En-tête et authentification', 'qr_code_verification', 'QR code / code de vérification en ligne', 'identifiant', 'non', null::text, array['QR Code']::text[], '{}'::text[], null::text, null::text, 'pratique (WMC-RNE-2026)', 'pratique'),
    ('extrait_rne', 'En-tête et authentification', 'langue_extrait', 'Langue de l''extrait (arabe / français)', 'liste', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('extrait_rne', 'Identification de l''entreprise', 'identifiant_unique', 'Identifiant unique RNE', 'identifiant', 'oui', null::text, array['Identifiant unique']::text[], array['المعرف الوحيد']::text[], null::text, null::text, 'Loi 2018-52 (article INCERTAIN)', 'incertain'),
    ('extrait_rne', 'Identification de l''entreprise', 'denomination', 'Dénomination sociale (arabe et/ou latin)', 'texte', 'oui', null::text, array['Dénomination']::text[], array['التسمية الاجتماعية']::text[], null::text, null::text, 'Loi 2018-52 (article INCERTAIN)', 'incertain'),
    ('extrait_rne', 'Identification de l''entreprise', 'nom_commercial_enseigne', 'Nom commercial / enseigne', 'texte', 'non', null::text, array['Nom commercial', 'Enseigne']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('extrait_rne', 'Identification de l''entreprise', 'forme_juridique', 'Forme juridique', 'liste', 'oui', null::text, array['Forme juridique']::text[], array['الشكل القانوني']::text[], null::text, null::text, 'Loi 2018-52 (article INCERTAIN)', 'incertain'),
    ('extrait_rne', 'Identification de l''entreprise', 'capital', 'Capital social', 'montant', 'oui', 'Société commerciale'::text, array['Capital']::text[], array['رأس المال']::text[], null::text, null::text, 'Loi 2018-52 (article INCERTAIN)', 'incertain'),
    ('extrait_rne', 'Identification de l''entreprise', 'siege', 'Adresse du siège social', 'adresse', 'oui', null::text, array['Siège social', 'Adresse']::text[], array['المقر الاجتماعي']::text[], null::text, null::text, 'Loi 2018-52 (article INCERTAIN)', 'incertain'),
    ('extrait_rne', 'Identification de l''entreprise', 'etablissements_secondaires', 'Établissements secondaires / succursales', 'liste', 'selon_cas', 'S''il en existe'::text, array['Établissements secondaires']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('extrait_rne', 'Identification de l''entreprise', 'activite_principale', 'Activité principale (et code d''activité)', 'texte', 'oui', null::text, array['Activité principale', 'Objet']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('extrait_rne', 'Identification de l''entreprise', 'activites_secondaires', 'Activités secondaires', 'liste', 'non', null::text, array['Activité secondaire']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('extrait_rne', 'Identification de l''entreprise', 'date_immatriculation', 'Date d''immatriculation', 'date', 'oui', null::text, array['Date d''immatriculation']::text[], '{}'::text[], null::text, null::text, 'CSC art. 4 (personnalité morale à l''immatriculation)', 'texte'),
    ('extrait_rne', 'Identification de l''entreprise', 'date_debut_activite', 'Date de début d''activité', 'date', 'non', null::text, array['Début d''activité']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('extrait_rne', 'Identification de l''entreprise', 'duree', 'Durée de la société', 'nombre', 'non', null::text, array['Durée']::text[], array['المدة']::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('extrait_rne', 'Identification de l''entreprise', 'ancien_numero_rc', 'Ancien numéro du registre du commerce (avant RNE)', 'identifiant', 'non', 'Société immatriculée avant la mise en place du RNE'::text, array['RC', 'Registre du commerce']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('extrait_rne', 'Identification de l''entreprise', 'matricule_fiscal', 'Matricule fiscal (si mentionné)', 'identifiant', 'non', null::text, array['Matricule fiscal']::text[], array['المعرف الجبائي']::text[], 'matricule_fiscal'::text, null::text, 'pratique', 'pratique'),
    ('extrait_rne', 'Identification de l''entreprise', 'statut_entreprise', 'Statut (active, en liquidation, radiée, en difficulté)', 'liste', 'oui', null::text, array['Statut', 'Situation']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('extrait_rne', 'Identification de l''entreprise', 'exercice_cloture', 'Date de clôture de l''exercice', 'date', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('extrait_rne', 'Dirigeants et organes', 'dirigeant_nom', 'Nom et prénom de chaque dirigeant (donnée personnelle)', 'texte', 'oui', null::text, array['Dirigeants', 'Gérant', 'Représentant légal']::text[], '{}'::text[], null::text, null::text, 'CSC art. 16 (nomination des dirigeants soumise à publicité) ; Loi 2018-52 INCERTAIN', 'incertain'),
    ('extrait_rne', 'Dirigeants et organes', 'dirigeant_qualite', 'Qualité (gérant, PDG, DG, président du CA, administrateur, CAC)', 'liste', 'oui', null::text, array['Qualité', 'Fonction']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('extrait_rne', 'Dirigeants et organes', 'dirigeant_nationalite', 'Nationalité du dirigeant', 'texte', 'non', null::text, array['Nationalité']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('extrait_rne', 'Dirigeants et organes', 'dirigeant_identifiant', 'Pièce d''identité du dirigeant (masquée)', 'identifiant', 'non', null::text, array['CIN', 'Passeport']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('extrait_rne', 'Dirigeants et organes', 'dirigeant_date_nomination', 'Date de nomination / prise d''effet', 'date', 'non', null::text, array['depuis le']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('extrait_rne', 'Dirigeants et organes', 'commissaire_aux_comptes', 'Commissaire(s) aux comptes inscrit(s)', 'liste', 'selon_cas', 'Société soumise au CAC'::text, array['Commissaire aux comptes']::text[], array['مراقب الحسابات']::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('extrait_rne', 'Associés et bénéficiaires effectifs', 'associes_liste', 'Associés / répartition du capital (si affichés)', 'liste', 'selon_cas', 'Selon le type d''extrait'::text, array['Associés']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('extrait_rne', 'Associés et bénéficiaires effectifs', 'beneficiaires_effectifs', 'Bénéficiaires effectifs (identité, nature et pourcentage du contrôle) ou mention ''Néant''', 'liste', 'selon_cas', 'Section présente sur l''extrait selon la presse'::text, array['Bénéficiaires effectifs', 'Néant']::text[], '{}'::text[], null::text, null::text, 'Loi 2018-52 (article INCERTAIN) ; WMC-RNE-2026 (presse)', 'incertain'),
    ('extrait_rne', 'Associés et bénéficiaires effectifs', 'be_pourcentage', 'Pourcentage de détention / droits de vote du bénéficiaire effectif', 'taux', 'selon_cas', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'INCERTAIN (seuil de plus de 20 % cité par la presse)', 'incertain'),
    ('extrait_rne', 'Historique des inscriptions', 'inscriptions_modificatives', 'Liste des inscriptions modificatives (date, nature : transfert de siège, changement de dirigeant, augmentation de capital...)', 'liste', 'non', 'Extrait complet / historique'::text, array['Modifications', 'Inscription modificative']::text[], '{}'::text[], null::text, null::text, 'CSC art. 16', 'texte'),
    ('extrait_rne', 'Historique des inscriptions', 'depot_etats_financiers', 'Dernier dépôt des états financiers (exercice, date)', 'periode', 'non', null::text, array['Dépôt des états financiers']::text[], array['القوائم المالية']::text[], null::text, null::text, 'INCERTAIN - obligation et délai de dépôt au RNE à vérifier dans la loi 2018-52', 'incertain'),
    ('extrait_rne', 'Historique des inscriptions', 'suretes_nantissements', 'Nantissements, sûretés, procédures collectives inscrits', 'liste', 'non', null::text, array['Nantissement']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('pv_ago', 'Identification de la société et de la séance', 'denomination', 'Dénomination, forme, capital, siège, identifiant unique', 'texte', 'oui', 'SARL : mention S.A.R.L et capital sur les documents'::text, array['au capital de', 'siège social']::text[], '{}'::text[], null::text, null::text, 'CSC art. 91 ; pratique', 'pratique'),
    ('pv_ago', 'Identification de la société et de la séance', 'identifiant_unique', 'Identifiant unique RNE de la société', 'identifiant', 'non', null::text, array['Identifiant unique', 'RC']::text[], array['المعرف الوحيد']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_ago', 'Identification de la société et de la séance', 'type_assemblee', 'Type d''assemblée (AGO annuelle / AGO réunie extraordinairement / AGO-AGE mixte)', 'liste', 'oui', null::text, array['Assemblée générale ordinaire', 'réunie extraordinairement']::text[], array['الجلسة العامة العادية']::text[], null::text, null::text, 'CSC art. 128, 275', 'texte'),
    ('pv_ago', 'Identification de la société et de la séance', 'date_assemblee', 'Date de la réunion', 'date', 'oui', null::text, array['L''an', 'le']::text[], '{}'::text[], null::text, null::text, 'CSC art. 285 (SA) ; pratique SARL', 'pratique'),
    ('pv_ago', 'Identification de la société et de la séance', 'heure_assemblee', 'Heure d''ouverture et de clôture', 'texte', 'non', null::text, array['à heures', 'la séance est levée à']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_ago', 'Identification de la société et de la séance', 'lieu_assemblee', 'Lieu de la réunion', 'adresse', 'oui', null::text, array['au siège social', 'réunis à']::text[], '{}'::text[], null::text, null::text, 'CSC art. 285 (SA) - INCERTAIN quant à la liste exacte ; pratique', 'incertain'),
    ('pv_ago', 'Identification de la société et de la séance', 'numero_convocation', 'Rang de convocation (1re / 2e)', 'liste', 'oui', 'Détermine le quorum applicable'::text, array['sur première convocation', 'sur deuxième convocation']::text[], '{}'::text[], null::text, null::text, 'CSC art. 130 (SARL) ; SA INCERTAIN', 'incertain'),
    ('pv_ago', 'Identification de la société et de la séance', 'exercice_concerne', 'Exercice dont les comptes sont soumis', 'periode', 'selon_cas', 'AGO annuelle'::text, array['exercice clos le']::text[], '{}'::text[], null::text, null::text, 'CSC art. 128, 275', 'texte'),
    ('pv_ago', 'Convocation', 'auteur_convocation', 'Auteur de la convocation (gérant, conseil d''administration, CAC, mandataire de justice, associés)', 'liste', 'oui', null::text, array['sur convocation du gérant', 'convoquée par le conseil d''administration']::text[], '{}'::text[], null::text, null::text, 'CSC art. 126 (SARL) ; SA INCERTAIN ; pratique (BVMT-BIAT-2010 art. 34 des statuts)', 'incertain'),
    ('pv_ago', 'Convocation', 'mode_convocation', 'Mode de convocation (lettre recommandée, avis JORT et quotidiens)', 'liste', 'oui', 'SARL : écrit ; SA : avis publié (pratique)'::text, array['par lettre recommandée', 'avis publié au JORT']::text[], '{}'::text[], null::text, null::text, 'CSC art. 126 ; pratique SA', 'pratique'),
    ('pv_ago', 'Convocation', 'date_convocation', 'Date d''envoi / publication de la convocation', 'date', 'oui', null::text, array['convoqués le']::text[], '{}'::text[], null::text, null::text, 'CSC art. 126 (20 jours SARL) ; 130 (8 jours pour 2e AG SARL)', 'texte'),
    ('pv_ago', 'Convocation', 'date_premiere_assemblee', 'Date de la 1re assemblée infructueuse', 'date', 'selon_cas', '2e convocation'::text, array['la première assemblée n''ayant pu délibérer']::text[], '{}'::text[], null::text, null::text, 'CSC art. 130 (délai >= 15 jours entre les deux)', 'texte'),
    ('pv_ago', 'Convocation', 'documents_communiques', 'Documents mis à disposition et date (rapport de gestion, états financiers, inventaire, rapports CAC, texte des résolutions)', 'liste', 'selon_cas', 'AGO annuelle - 30 jours avant (SARL)'::text, array['ont été tenus à la disposition']::text[], '{}'::text[], null::text, null::text, 'CSC art. 128', 'texte'),
    ('pv_ago', 'Convocation', 'assemblee_universelle', 'Assemblée tenue sans formalités car tous présents ou représentés', 'booleen', 'non', null::text, array['tous les associés étant présents ou représentés']::text[], '{}'::text[], null::text, null::text, 'pratique (clause statutaire BVMT-BIAT-2010)', 'pratique'),
    ('pv_ago', 'Bureau', 'president_seance', 'Président de séance et qualité', 'texte', 'oui', null::text, array['sous la présidence de', 'préside la séance']::text[], '{}'::text[], null::text, null::text, 'CSC art. 285 (SA : bureau) ; pratique SARL', 'pratique'),
    ('pv_ago', 'Bureau', 'scrutateurs', 'Scrutateurs', 'liste', 'selon_cas', 'SA (pratique de place)'::text, array['scrutateurs']::text[], '{}'::text[], null::text, null::text, 'CSC art. 285 (bureau, composition exacte INCERTAIN)', 'incertain'),
    ('pv_ago', 'Bureau', 'secretaire', 'Secrétaire de séance', 'texte', 'selon_cas', null::text, array['secrétaire de séance']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_ago', 'Bureau', 'cac_present', 'Présence / convocation du commissaire aux comptes', 'booleen', 'selon_cas', 'Société dotée d''un CAC'::text, array['Le commissaire aux comptes, régulièrement convoqué']::text[], '{}'::text[], null::text, null::text, 'CSC art. 266 bis (CAC obligatoirement convoqués)', 'texte'),
    ('pv_ago', 'Bureau', 'autres_presents', 'Autres personnes présentes (administrateurs, experts, représentant de la masse)', 'liste', 'non', null::text, array['Assistent également']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_ago', 'Présence et quorum', 'ref_feuille_presence', 'Référence à la feuille de présence (certifiée par le bureau)', 'texte', 'selon_cas', 'SA (pratique) ; SARL pratique'::text, array['feuille de présence', 'certifiée sincère et véritable']::text[], array['قائمة الحضور']::text[], null::text, null::text, 'INCERTAIN - article exigeant la feuille de présence non lu', 'incertain'),
    ('pv_ago', 'Présence et quorum', 'nb_associes_presents', 'Nombre d''associés présents', 'nombre', 'oui', null::text, array['présents']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_ago', 'Présence et quorum', 'nb_associes_representes', 'Nombre d''associés représentés', 'nombre', 'oui', null::text, array['représentés']::text[], '{}'::text[], null::text, null::text, 'CSC art. 129', 'texte'),
    ('pv_ago', 'Présence et quorum', 'titres_presents_representes', 'Nombre de parts/actions présentes ou représentées', 'nombre', 'oui', null::text, array['parts sociales sur', 'actions sur']::text[], '{}'::text[], null::text, null::text, 'CSC art. 130 (SARL) ; art. 285 (SA : nombre d''actions participant au vote)', 'texte'),
    ('pv_ago', 'Présence et quorum', 'total_titres_droit_vote', 'Nombre total de titres ayant droit de vote', 'nombre', 'oui', null::text, array['composant le capital']::text[], '{}'::text[], null::text, null::text, 'CSC art. 130, 285', 'texte'),
    ('pv_ago', 'Présence et quorum', 'quorum_taux', 'Quorum atteint (pourcentage)', 'taux', 'oui', null::text, array['soit', '% du capital', 'le quorum étant atteint']::text[], array['النصاب']::text[], null::text, null::text, 'CSC art. 285 (SA) ; art. 130 (SARL)', 'texte'),
    ('pv_ago', 'Présence et quorum', 'constat_validite', 'Constat que l''assemblée peut valablement délibérer', 'booleen', 'oui', null::text, array['peut valablement délibérer']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_ago', 'Présence et quorum', 'pouvoirs_deposes', 'Liste ou nombre des pouvoirs déposés', 'liste', 'selon_cas', 'Associés représentés'::text, array['pouvoirs']::text[], '{}'::text[], null::text, null::text, 'CSC art. 129', 'texte'),
    ('pv_ago', 'Ordre du jour et débats', 'ordre_du_jour', 'Ordre du jour (liste des points)', 'liste', 'oui', null::text, array['Ordre du jour']::text[], array['جدول الأعمال']::text[], null::text, null::text, 'CSC art. 126 (SARL) ; pratique SA', 'pratique'),
    ('pv_ago', 'Ordre du jour et débats', 'documents_presentes', 'Documents présentés en séance (rapport de gestion, rapports CAC général et spécial)', 'liste', 'selon_cas', 'AGO annuelle'::text, array['lecture est donnée']::text[], '{}'::text[], null::text, null::text, 'CSC art. 128', 'texte'),
    ('pv_ago', 'Ordre du jour et débats', 'resume_debats', 'Résumé des débats', 'texte', 'non', null::text, array['Après discussion']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_ago', 'Ordre du jour et débats', 'questions_ecrites', 'Questions écrites et réponses du gérant/conseil', 'texte', 'selon_cas', 'Si des questions ont été posées'::text, array['questions écrites']::text[], '{}'::text[], null::text, null::text, 'CSC art. 128 (SARL)', 'texte'),
    ('pv_ago', 'Résolutions (une occurrence par résolution)', 'resolution_numero', 'Numéro de la résolution', 'nombre', 'oui', null::text, array['Première résolution', 'Deuxième résolution']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_ago', 'Résolutions (une occurrence par résolution)', 'resolution_objet', 'Objet normalisé (approbation comptes, quitus, affectation, conventions, nomination, renouvellement, révocation, CAC, jetons, pouvoirs, autre)', 'liste', 'oui', null::text, array['approuve', 'donne quitus', 'décide d''affecter', 'nomme', 'renouvelle']::text[], '{}'::text[], null::text, null::text, 'pratique (BVMT-TRE-2018, BVMT-BIAT-2010)', 'pratique'),
    ('pv_ago', 'Résolutions (une occurrence par résolution)', 'resolution_texte', 'Texte intégral de la résolution', 'texte', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'CSC art. 126 (texte des résolutions joint à la convocation SARL)', 'texte'),
    ('pv_ago', 'Résolutions (une occurrence par résolution)', 'votes_pour', 'Voix pour', 'nombre', 'oui', null::text, array['pour']::text[], '{}'::text[], null::text, null::text, 'CSC art. 129, 130 ; pratique', 'pratique'),
    ('pv_ago', 'Résolutions (une occurrence par résolution)', 'votes_contre', 'Voix contre', 'nombre', 'oui', null::text, array['contre']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_ago', 'Résolutions (une occurrence par résolution)', 'abstentions', 'Abstentions', 'nombre', 'non', null::text, array['abstention']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_ago', 'Résolutions (une occurrence par résolution)', 'voix_exclues', 'Voix exclues du vote (associé intéressé à une convention)', 'nombre', 'selon_cas', 'Vote sur conventions réglementées'::text, array['ne prenant pas part au vote']::text[], '{}'::text[], null::text, null::text, 'CSC art. 115 (SARL) ; art. 200 (SA)', 'texte'),
    ('pv_ago', 'Résolutions (une occurrence par résolution)', 'resultat', 'Résultat (adoptée à l''unanimité / à la majorité / rejetée)', 'liste', 'oui', null::text, array['Cette résolution est adoptée à', 'mise aux voix']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_ago', 'Résolutions (une occurrence par résolution)', 'majorite_requise', 'Majorité requise pour la résolution', 'taux', 'non', 'Calculée par le moteur selon forme/convocation/objet'::text, '{}'::text[], array['الأغلبية']::text[], null::text, null::text, 'CSC art. 130 (SARL : > 1/2 du capital en 1re ; majorité des présents en 2e) ; 122 (3/4 révocation gérant statutaire) ; SA INCERTAIN', 'incertain'),
    ('pv_ago', 'Approbation des comptes et quitus', 'comptes_approuves', 'États financiers approuvés (avec ou sans réserve)', 'booleen', 'selon_cas', 'AGO annuelle'::text, array['approuve les états financiers']::text[], array['القوائم المالية']::text[], null::text, null::text, 'CSC art. 128, 278', 'texte'),
    ('pv_ago', 'Approbation des comptes et quitus', 'total_bilan', 'Total du bilan cité', 'montant', 'non', null::text, array['total bilan']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_ago', 'Approbation des comptes et quitus', 'resultat_exercice', 'Résultat net de l''exercice (bénéfice / perte)', 'montant', 'selon_cas', 'AGO annuelle'::text, array['faisant ressortir un bénéfice', 'une perte de']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_ago', 'Approbation des comptes et quitus', 'capitaux_propres', 'Capitaux propres après affectation', 'montant', 'non', 'Utile pour test capitaux propres < 1/2 capital'::text, array['capitaux propres']::text[], '{}'::text[], null::text, null::text, 'CSC art. 388 (cité en pratique BVMT ; texte non lu)', 'pratique'),
    ('pv_ago', 'Approbation des comptes et quitus', 'quitus', 'Quitus au gérant / aux administrateurs (bénéficiaires, exercice)', 'texte', 'non', null::text, array['donne quitus entier et sans réserve']::text[], '{}'::text[], null::text, null::text, 'pratique (BVMT-TRE-2018 résolution 3)', 'pratique'),
    ('pv_ago', 'Approbation des comptes et quitus', 'approbation_conventions', 'Approbation des conventions réglementées (rapport spécial)', 'texte', 'selon_cas', 'S''il existe des conventions'::text, array['conventions visées à l''article 200']::text[], '{}'::text[], null::text, null::text, 'CSC art. 115 (SARL) ; art. 200 (SA)', 'texte'),
    ('pv_ago', 'Affectation du résultat', 'resultat_a_affecter', 'Résultat de l''exercice à affecter', 'montant', 'selon_cas', 'AGO annuelle'::text, array['Résultat de l''exercice']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_ago', 'Affectation du résultat', 'report_a_nouveau_anterieur', 'Report à nouveau antérieur', 'montant', 'non', null::text, array['Report à nouveau antérieur']::text[], array['النتائج المؤجلة']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_ago', 'Affectation du résultat', 'resultats_reportes_autres', 'Autres réserves rendues disponibles / reprises', 'montant', 'non', null::text, array['réserves disponibles']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_ago', 'Affectation du résultat', 'total_distribuable', 'Total à affecter / bénéfice distribuable', 'montant', 'non', null::text, array['Total', 'bénéfice distribuable']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_ago', 'Affectation du résultat', 'dotation_reserve_legale', 'Dotation à la réserve légale', 'montant', 'selon_cas', 'Bénéfice et réserve < 10 % du capital (SARL)'::text, array['Réserve légale']::text[], array['الاحتياطي القانوني']::text[], null::text, null::text, 'CSC art. 140 (SARL) ; SA INCERTAIN', 'incertain'),
    ('pv_ago', 'Affectation du résultat', 'dotation_reserves_statutaires', 'Réserves statutaires / facultatives / générales', 'montant', 'non', null::text, array['Réserves statutaires', 'réserves facultatives']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_ago', 'Affectation du résultat', 'dotation_reserve_reinvestissement', 'Réserve spéciale pour réinvestissement exonéré', 'montant', 'non', null::text, array['réserve pour réinvestissement exonéré']::text[], '{}'::text[], null::text, null::text, 'pratique (BVMT-TRE-2018) ; base fiscale INCERTAIN', 'incertain'),
    ('pv_ago', 'Affectation du résultat', 'fonds_social', 'Dotation au fonds social', 'montant', 'non', null::text, array['fonds social']::text[], '{}'::text[], null::text, null::text, 'pratique (BVMT-TRE-2018)', 'pratique'),
    ('pv_ago', 'Affectation du résultat', 'dividendes_total', 'Dividendes distribués (total)', 'montant', 'non', null::text, array['Dividendes']::text[], '{}'::text[], null::text, null::text, 'CSC art. 140', 'texte'),
    ('pv_ago', 'Affectation du résultat', 'dividende_par_titre', 'Dividende par part / action', 'montant', 'non', null::text, array['par action', 'par part']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_ago', 'Affectation du résultat', 'date_mise_en_paiement', 'Date de mise en paiement des dividendes', 'date', 'selon_cas', 'Distribution décidée'::text, array['mis en paiement à partir du']::text[], '{}'::text[], null::text, null::text, 'CSC art. 140 (dans les 3 mois de l''AG, SARL)', 'texte'),
    ('pv_ago', 'Affectation du résultat', 'report_a_nouveau_nouveau', 'Nouveau report à nouveau', 'montant', 'non', null::text, array['Report à nouveau']::text[], array['النتائج المؤجلة']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_ago', 'Affectation du résultat', 'imputation_perte', 'Imputation de la perte (report à nouveau déficitaire / réserves)', 'montant', 'selon_cas', 'Exercice déficitaire'::text, array['affecter la perte']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_ago', 'Nominations et mandats', 'nomination_type', 'Type (nomination, renouvellement, révocation, démission constatée, cooptation ratifiée)', 'liste', 'selon_cas', null::text, array['nomme', 'renouvelle le mandat', 'révoque', 'ratifie la cooptation']::text[], '{}'::text[], null::text, null::text, 'CSC art. 122 (SARL) ; art. 190 (SA, partiel)', 'texte'),
    ('pv_ago', 'Nominations et mandats', 'nomination_personne', 'Personne concernée (personne physique ou morale + représentant permanent)', 'texte', 'selon_cas', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_ago', 'Nominations et mandats', 'nomination_fonction', 'Fonction (gérant, administrateur, CAC, représentant des petits porteurs)', 'liste', 'selon_cas', null::text, array['gérant', 'administrateur', 'commissaire aux comptes']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_ago', 'Nominations et mandats', 'nomination_duree', 'Durée / exercices couverts par le mandat', 'periode', 'selon_cas', 'CAC : 3 ans'::text, array['pour une durée de trois ans', 'exercices']::text[], '{}'::text[], null::text, null::text, 'CSC art. 13 bis, 125, 260', 'texte'),
    ('pv_ago', 'Nominations et mandats', 'acceptation_fonction', 'Acceptation des fonctions par l''intéressé', 'booleen', 'non', null::text, array['déclare accepter']::text[], '{}'::text[], null::text, null::text, 'CSC art. 196 (SA, prise d''effet à l''acceptation, lecture partielle)', 'texte'),
    ('pv_ago', 'Nominations et mandats', 'remuneration_dirigeants', 'Rémunération du gérant / jetons de présence (montant)', 'montant', 'non', null::text, array['jetons de présence', 'rémunération']::text[], '{}'::text[], null::text, null::text, 'pratique (BVMT-TRE-2018 résolution 6)', 'pratique'),
    ('pv_ago', 'Clôture et signatures', 'pouvoirs_formalites', 'Pouvoirs pour formalités (dépôt, publicité, enregistrement)', 'texte', 'non', null::text, array['tous pouvoirs sont donnés au porteur']::text[], '{}'::text[], null::text, null::text, 'CSC art. 16', 'texte'),
    ('pv_ago', 'Clôture et signatures', 'heure_cloture', 'Heure de clôture', 'texte', 'non', null::text, array['la séance est levée']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_ago', 'Clôture et signatures', 'signataires', 'Signataires (membres du bureau / gérant / associés)', 'liste', 'oui', null::text, array['Le Président', 'Le Secrétaire', 'Les Scrutateurs']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN - règle légale de signature du PV non lue ; pratique : bureau', 'incertain'),
    ('pv_ago', 'Clôture et signatures', 'mention_enregistrement', 'Mention d''enregistrement fiscal', 'texte', 'selon_cas', null::text, array['Enregistré à la recette']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('pv_ago', 'Clôture et signatures', 'copie_certifiee', 'Mention ''copie certifiée conforme'' et signataire', 'texte', 'non', 'Copie produite à un tiers'::text, array['copie certifiée conforme']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('pv_age', 'Identification de la société et de la séance', 'denomination', 'Dénomination, forme, capital (avant opération), siège, identifiant unique', 'texte', 'oui', null::text, array['au capital de']::text[], '{}'::text[], null::text, null::text, 'CSC art. 91 ; pratique', 'pratique'),
    ('pv_age', 'Identification de la société et de la séance', 'type_assemblee', 'AGE / AGE à caractère mixte', 'liste', 'oui', null::text, array['Assemblée générale extraordinaire']::text[], array['الجلسة العامة الخارقة للعادة']::text[], null::text, null::text, 'CSC art. 131, 291', 'texte'),
    ('pv_age', 'Identification de la société et de la séance', 'date_assemblee', 'Date', 'date', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_age', 'Identification de la société et de la séance', 'lieu_assemblee', 'Lieu', 'adresse', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_age', 'Identification de la société et de la séance', 'numero_convocation', 'Rang de convocation (1re / 2e / 3e)', 'liste', 'oui', null::text, array['sur deuxième convocation']::text[], '{}'::text[], null::text, null::text, 'CSC art. 131 (SARL), 291 (SA)', 'texte'),
    ('pv_age', 'Identification de la société et de la séance', 'date_premiere_assemblee', 'Date de la précédente AGE infructueuse', 'date', 'selon_cas', '2e convocation'::text, '{}'::text[], '{}'::text[], null::text, null::text, 'CSC art. 131 (SARL option : >= 60 jours)', 'texte'),
    ('pv_age', 'Identification de la société et de la séance', 'date_convocation', 'Date et mode de convocation', 'date', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'CSC art. 126 (SARL, 20 jours)', 'texte'),
    ('pv_age', 'Bureau, présence et quorum', 'president_seance', 'Président de séance', 'texte', 'oui', null::text, array['sous la présidence de']::text[], '{}'::text[], null::text, null::text, 'CSC art. 285 (SA) ; pratique', 'pratique'),
    ('pv_age', 'Bureau, présence et quorum', 'scrutateurs_secretaire', 'Scrutateurs et secrétaire', 'liste', 'selon_cas', 'SA'::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_age', 'Bureau, présence et quorum', 'titres_presents_representes', 'Titres présents ou représentés', 'nombre', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'CSC art. 131, 291', 'texte'),
    ('pv_age', 'Bureau, présence et quorum', 'total_titres_droit_vote', 'Total des titres ayant droit de vote', 'nombre', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'CSC art. 131, 291', 'texte'),
    ('pv_age', 'Bureau, présence et quorum', 'quorum_taux', 'Quorum (%)', 'taux', 'oui', null::text, array['quorum']::text[], array['النصاب']::text[], null::text, null::text, 'CSC art. 285', 'texte'),
    ('pv_age', 'Bureau, présence et quorum', 'ref_feuille_presence', 'Référence à la feuille de présence', 'texte', 'selon_cas', null::text, array['feuille de présence']::text[], array['قائمة الحضور']::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('pv_age', 'Bureau, présence et quorum', 'cac_present', 'CAC convoqué / présent', 'booleen', 'selon_cas', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'CSC art. 266 bis', 'texte'),
    ('pv_age', 'Ordre du jour et rapports', 'ordre_du_jour', 'Ordre du jour', 'liste', 'oui', null::text, array['Ordre du jour']::text[], array['جدول الأعمال']::text[], null::text, null::text, 'CSC art. 126', 'texte'),
    ('pv_age', 'Ordre du jour et rapports', 'rapport_gerant_conseil', 'Rapport du gérant / du conseil sur les résolutions', 'texte', 'non', null::text, array['rapport du conseil d''administration']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_age', 'Ordre du jour et rapports', 'rapport_cac_special', 'Rapport spécial du CAC (réduction de capital, suppression DPS, apports)', 'texte', 'selon_cas', 'Réduction de capital avec CAC ; autres cas INCERTAIN'::text, array['rapport du commissaire aux comptes']::text[], '{}'::text[], null::text, null::text, 'CSC art. 136 (projet communiqué au CAC 3 mois avant)', 'texte'),
    ('pv_age', 'Ordre du jour et rapports', 'rapport_commissaire_apports', 'Rapport du commissaire aux apports', 'texte', 'selon_cas', 'Augmentation par apport en nature'::text, array['commissaire aux apports']::text[], '{}'::text[], null::text, null::text, 'CSC art. 100, 135', 'texte'),
    ('pv_age', 'Résolutions (une occurrence par résolution)', 'resolution_numero', 'Numéro', 'nombre', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_age', 'Résolutions (une occurrence par résolution)', 'resolution_objet', 'Objet normalisé (augmentation de capital, réduction, transfert de siège, changement de dénomination, modification d''objet, prorogation, transformation, dissolution anticipée, continuité malgré pertes, refonte des statuts, mise en conformité, nationalité, autre)', 'liste', 'oui', null::text, array['décide d''augmenter le capital', 'décide de transférer le siège', 'décide de modifier l''article']::text[], '{}'::text[], null::text, null::text, 'CSC art. 131-137 ; art. 388 (pratique)', 'pratique'),
    ('pv_age', 'Résolutions (une occurrence par résolution)', 'resolution_texte', 'Texte intégral', 'texte', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'CSC art. 126', 'texte'),
    ('pv_age', 'Résolutions (une occurrence par résolution)', 'articles_statuts_modifies', 'Articles des statuts modifiés et nouvelle rédaction', 'liste', 'selon_cas', 'Modification statutaire'::text, array['L''article', 'des statuts est désormais rédigé comme suit']::text[], '{}'::text[], null::text, null::text, 'CSC art. 16, 131', 'texte'),
    ('pv_age', 'Résolutions (une occurrence par résolution)', 'votes_pour', 'Voix pour', 'nombre', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_age', 'Résolutions (une occurrence par résolution)', 'votes_contre', 'Voix contre', 'nombre', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_age', 'Résolutions (une occurrence par résolution)', 'abstentions', 'Abstentions', 'nombre', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_age', 'Résolutions (une occurrence par résolution)', 'resultat', 'Résultat (adoptée / rejetée, unanimité / majorité)', 'liste', 'oui', null::text, array['adoptée à l''unanimité']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_age', 'Résolutions (une occurrence par résolution)', 'majorite_requise', 'Majorité requise', 'taux', 'non', 'Calcul moteur'::text, '{}'::text[], array['الأغلبية']::text[], null::text, null::text, 'SARL : 3/4 du capital (ou 2/3 des présents si clause) art. 131 ; nationalité : unanimité art. 132 ; incorporation de réserves : > 1/2 du capital art. 133 ; SA : 2/3 des voix art. 291', 'texte'),
    ('pv_age', 'Opérations sur le capital', 'capital_avant', 'Capital avant opération', 'montant', 'selon_cas', 'Opération sur capital'::text, array['de', 'à']::text[], array['رأس المال']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_age', 'Opérations sur le capital', 'capital_apres', 'Capital après opération', 'montant', 'selon_cas', null::text, array['pour le porter à', 'pour le ramener à']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_age', 'Opérations sur le capital', 'montant_variation', 'Montant de l''augmentation / réduction', 'montant', 'selon_cas', null::text, array['d''un montant de']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_age', 'Opérations sur le capital', 'mode_operation', 'Mode (numéraire, compensation de créances, incorporation de réserves, apport en nature, élévation du nominal, réduction par pertes, rachat/annulation)', 'liste', 'selon_cas', null::text, array['par incorporation de réserves', 'par apport en numéraire']::text[], '{}'::text[], null::text, null::text, 'CSC art. 133-136', 'texte'),
    ('pv_age', 'Opérations sur le capital', 'nb_titres_crees_annules', 'Nombre de titres créés / annulés', 'nombre', 'selon_cas', null::text, array['parts nouvelles', 'actions nouvelles']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_age', 'Opérations sur le capital', 'valeur_nominale_avant_apres', 'Valeur nominale avant / après', 'montant', 'selon_cas', null::text, array['valeur nominale']::text[], '{}'::text[], null::text, null::text, 'CSC art. 92', 'texte'),
    ('pv_age', 'Opérations sur le capital', 'prime_emission', 'Prime d''émission par titre et totale', 'montant', 'non', null::text, array['prime d''émission']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_age', 'Opérations sur le capital', 'droit_preferentiel_souscription', 'Droit préférentiel de souscription (maintien / renonciation / suppression), délai de souscription', 'texte', 'selon_cas', 'Augmentation en numéraire ; SARL : délai >= 21 jours'::text, array['droit préférentiel de souscription', 'délai de souscription']::text[], '{}'::text[], null::text, null::text, 'CSC art. 131', 'texte'),
    ('pv_age', 'Opérations sur le capital', 'souscription_par_associe', 'Souscription et libération par associé', 'liste', 'selon_cas', null::text, array['a souscrit', 'a libéré']::text[], '{}'::text[], null::text, null::text, 'CSC art. 131, 134', 'texte'),
    ('pv_age', 'Opérations sur le capital', 'nouvelle_repartition_capital', 'Nouvelle répartition du capital', 'liste', 'selon_cas', null::text, array['nouvelle répartition']::text[], '{}'::text[], null::text, null::text, 'CSC art. 96 (mention statutaire à mettre à jour)', 'texte'),
    ('pv_age', 'Opérations sur le capital', 'certificat_depot_fonds', 'Certificat du dépositaire des fonds (établissement, date, montant)', 'texte', 'selon_cas', 'Augmentation en numéraire'::text, array['certificat de dépôt', 'attestation bancaire']::text[], '{}'::text[], null::text, null::text, 'CSC art. 134', 'texte'),
    ('pv_age', 'Opérations sur le capital', 'reserves_incorporees', 'Réserves incorporées (nature et montant)', 'montant', 'selon_cas', 'Incorporation de réserves'::text, array['par prélèvement sur']::text[], '{}'::text[], null::text, null::text, 'CSC art. 133', 'texte'),
    ('pv_age', 'Opérations sur le capital', 'motif_reduction', 'Motif de la réduction (pertes / non motivée) et information des créanciers', 'texte', 'selon_cas', 'Réduction de capital'::text, array['réduction motivée par des pertes']::text[], '{}'::text[], null::text, null::text, 'CSC art. 136, 137', 'texte'),
    ('pv_age', 'Opérations sur le capital', 'constat_realisation', 'Constat de réalisation définitive de l''opération (date)', 'date', 'selon_cas', null::text, array['constate la réalisation définitive']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_age', 'Autres modifications statutaires', 'ancien_siege', 'Ancien siège', 'adresse', 'selon_cas', 'Transfert de siège'::text, array['de']::text[], '{}'::text[], null::text, null::text, 'CSC art. 9', 'texte'),
    ('pv_age', 'Autres modifications statutaires', 'nouveau_siege', 'Nouveau siège et date d''effet', 'adresse', 'selon_cas', 'Transfert de siège'::text, array['transférer le siège social', 'à compter du']::text[], array['المقر الاجتماعي']::text[], null::text, null::text, 'CSC art. 9, 95', 'texte'),
    ('pv_age', 'Autres modifications statutaires', 'ancienne_nouvelle_denomination', 'Ancienne et nouvelle dénomination', 'texte', 'selon_cas', null::text, array['nouvelle dénomination']::text[], '{}'::text[], null::text, null::text, 'CSC art. 9', 'texte'),
    ('pv_age', 'Autres modifications statutaires', 'objet_modifie', 'Nouvel objet social', 'texte', 'selon_cas', null::text, array['extension de l''objet']::text[], '{}'::text[], null::text, null::text, 'CSC art. 9', 'texte'),
    ('pv_age', 'Autres modifications statutaires', 'prorogation_duree', 'Prorogation de durée (nouvelle échéance)', 'date', 'selon_cas', null::text, array['proroger la durée']::text[], '{}'::text[], null::text, null::text, 'CSC art. 9', 'texte'),
    ('pv_age', 'Autres modifications statutaires', 'transformation_forme', 'Transformation (ancienne / nouvelle forme)', 'liste', 'selon_cas', 'Ex. SARL > 50 associés → SA dans l''année'::text, array['transformation en société anonyme']::text[], '{}'::text[], null::text, null::text, 'CSC art. 93 ; régime de transformation INCERTAIN', 'incertain'),
    ('pv_age', 'Autres modifications statutaires', 'dissolution_anticipee', 'Dissolution anticipée, liquidateur nommé, siège de liquidation', 'texte', 'selon_cas', null::text, array['dissolution anticipée', 'liquidateur']::text[], '{}'::text[], null::text, null::text, 'CSC art. 16 ; régime détaillé INCERTAIN', 'incertain'),
    ('pv_age', 'Autres modifications statutaires', 'continuite_exploitation', 'Décision de continuité malgré capitaux propres < moitié du capital', 'booleen', 'selon_cas', null::text, array['continuité de l''exploitation', 'capitaux propres inférieurs à la moitié du capital']::text[], '{}'::text[], null::text, null::text, 'CSC art. 388 (cité en pratique, non lu)', 'pratique'),
    ('pv_age', 'Autres modifications statutaires', 'statuts_refondus_adoptes', 'Adoption d''une version refondue des statuts (annexe)', 'booleen', 'non', null::text, array['adopte article par article puis dans son ensemble']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_age', 'Clôture et formalités', 'pouvoirs_formalites', 'Pouvoirs pour formalités RNE / JORT / enregistrement', 'texte', 'non', null::text, array['tous pouvoirs au porteur']::text[], '{}'::text[], null::text, null::text, 'CSC art. 16', 'texte'),
    ('pv_age', 'Clôture et formalités', 'signataires', 'Signataires', 'liste', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'INCERTAIN ; pratique bureau', 'incertain'),
    ('pv_age', 'Clôture et formalités', 'mention_enregistrement', 'Mention d''enregistrement fiscal', 'texte', 'selon_cas', null::text, array['Enregistré à la recette']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('feuille_presence', 'En-tête', 'denomination', 'Dénomination et identifiant de la société', 'texte', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('feuille_presence', 'En-tête', 'type_assemblee', 'Type d''assemblée (AGO / AGE / spéciale)', 'liste', 'oui', null::text, array['Feuille de présence']::text[], array['قائمة الحضور']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('feuille_presence', 'En-tête', 'date_assemblee', 'Date de l''assemblée', 'date', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('feuille_presence', 'En-tête', 'numero_convocation', 'Rang de convocation', 'liste', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('feuille_presence', 'Lignes d''émargement (une par associé)', 'associe_identite', 'Nom / dénomination de l''associé (donnée personnelle)', 'texte', 'oui', null::text, array['Associé', 'Actionnaire']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('feuille_presence', 'Lignes d''émargement (une par associé)', 'associe_domicile', 'Domicile / siège de l''associé', 'adresse', 'non', null::text, array['Domicile']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('feuille_presence', 'Lignes d''émargement (une par associé)', 'titres_detenus', 'Nombre de parts/actions détenues', 'nombre', 'oui', null::text, array['Nombre de parts', 'Nombre d''actions']::text[], '{}'::text[], null::text, null::text, 'CSC art. 129', 'texte'),
    ('feuille_presence', 'Lignes d''émargement (une par associé)', 'voix', 'Nombre de voix', 'nombre', 'oui', 'SARL : = nombre de parts'::text, array['Nombre de voix']::text[], '{}'::text[], null::text, null::text, 'CSC art. 129', 'texte'),
    ('feuille_presence', 'Lignes d''émargement (une par associé)', 'mode_participation', 'Présent / représenté / vote par correspondance / absent', 'liste', 'oui', null::text, array['présent', 'représenté']::text[], '{}'::text[], null::text, null::text, 'CSC art. 129', 'texte'),
    ('feuille_presence', 'Lignes d''émargement (une par associé)', 'mandataire_identite', 'Identité du mandataire', 'texte', 'selon_cas', 'Associé représenté'::text, array['représenté par', 'Mandataire']::text[], '{}'::text[], null::text, null::text, 'CSC art. 129', 'texte'),
    ('feuille_presence', 'Lignes d''émargement (une par associé)', 'signature', 'Signature (émargement)', 'booleen', 'oui', 'Présents et mandataires'::text, array['Signature', 'Émargement']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('feuille_presence', 'Totaux et certification', 'total_presents', 'Total titres / voix des présents', 'nombre', 'oui', null::text, array['Total']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('feuille_presence', 'Totaux et certification', 'total_representes', 'Total titres / voix des représentés', 'nombre', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('feuille_presence', 'Totaux et certification', 'total_general', 'Total général présents + représentés', 'nombre', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'CSC art. 285 (quorum)', 'texte'),
    ('feuille_presence', 'Totaux et certification', 'nombre_pouvoirs_annexes', 'Nombre de pouvoirs annexés', 'nombre', 'selon_cas', null::text, array['pouvoirs annexés']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('feuille_presence', 'Totaux et certification', 'certification_bureau', 'Certification ''sincère et véritable'' par le bureau (signatures)', 'booleen', 'selon_cas', null::text, array['certifiée sincère et véritable par les membres du bureau']::text[], '{}'::text[], null::text, null::text, 'pratique ; base légale INCERTAIN', 'incertain')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('pv_conseil_administration', 'Identification de la séance', 'denomination', 'Dénomination, capital, siège, identifiant', 'texte', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_conseil_administration', 'Identification de la séance', 'date_reunion', 'Date et heure', 'date', 'oui', null::text, array['Procès-verbal de la réunion du conseil d''administration du']::text[], array['مجلس الإدارة']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_conseil_administration', 'Identification de la séance', 'lieu_reunion', 'Lieu / visioconférence', 'texte', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique ; validité de la visioconférence INCERTAIN', 'incertain'),
    ('pv_conseil_administration', 'Identification de la séance', 'convocation', 'Auteur, mode et date de convocation', 'texte', 'non', null::text, array['sur convocation du président']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_conseil_administration', 'Identification de la séance', 'numero_page_registre', 'Numéro de page / folio du registre coté et paraphé', 'identifiant', 'selon_cas', null::text, array['folio']::text[], '{}'::text[], null::text, null::text, 'CSC art. 222 (INCERTAIN)', 'incertain'),
    ('pv_conseil_administration', 'Présence et quorum', 'administrateurs_presents', 'Administrateurs présents (personnes physiques / représentants permanents)', 'liste', 'oui', null::text, array['Présents']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_conseil_administration', 'Présence et quorum', 'administrateurs_representes', 'Administrateurs représentés et mandataire', 'liste', 'selon_cas', null::text, array['représenté par']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('pv_conseil_administration', 'Présence et quorum', 'administrateurs_absents', 'Administrateurs absents / excusés', 'liste', 'non', null::text, array['Absents excusés']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_conseil_administration', 'Présence et quorum', 'nombre_administrateurs_en_fonction', 'Nombre d''administrateurs en fonction', 'nombre', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_conseil_administration', 'Présence et quorum', 'quorum_constate', 'Constat du quorum', 'booleen', 'oui', null::text, array['le conseil peut valablement délibérer']::text[], array['النصاب']::text[], null::text, null::text, 'INCERTAIN (règle légale non lue)', 'incertain'),
    ('pv_conseil_administration', 'Présence et quorum', 'invites', 'Invités (CAC, DG non administrateur, secrétaire, représentants)', 'liste', 'non', null::text, array['Assistent']::text[], '{}'::text[], null::text, null::text, 'CSC art. 266 bis (CAC)', 'texte'),
    ('pv_conseil_administration', 'Présence et quorum', 'president_seance', 'Président de séance', 'texte', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_conseil_administration', 'Présence et quorum', 'secretaire', 'Secrétaire', 'texte', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_conseil_administration', 'Délibérations (une occurrence par décision)', 'ordre_du_jour', 'Ordre du jour', 'liste', 'oui', null::text, array['Ordre du jour']::text[], array['جدول الأعمال']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_conseil_administration', 'Délibérations (une occurrence par décision)', 'decision_objet', 'Objet normalisé (arrêté des états financiers, convocation AG, rapport de gestion, nomination/révocation PDG/DG, cooptation, autorisation de convention, caution/garantie, emprunt, délégation de pouvoirs, comités, autre)', 'liste', 'oui', null::text, array['arrête les états financiers', 'décide de convoquer', 'autorise']::text[], '{}'::text[], null::text, null::text, 'CSC art. 197, 200, 211 ; pratique', 'pratique'),
    ('pv_conseil_administration', 'Délibérations (une occurrence par décision)', 'decision_texte', 'Texte de la délibération', 'texte', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_conseil_administration', 'Délibérations (une occurrence par décision)', 'votes', 'Votes (pour / contre / abstention) ou unanimité', 'texte', 'oui', null::text, array['à l''unanimité']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_conseil_administration', 'Délibérations (une occurrence par décision)', 'administrateur_interesse', 'Administrateur intéressé n''ayant pas pris part au vote', 'texte', 'selon_cas', 'Conventions réglementées'::text, array['n''a pas pris part au vote']::text[], '{}'::text[], null::text, null::text, 'CSC art. 200', 'texte'),
    ('pv_conseil_administration', 'Délibérations (une occurrence par décision)', 'comptes_arretes', 'Données des comptes arrêtés (exercice, résultat, total bilan, proposition d''affectation)', 'texte', 'selon_cas', 'Conseil d''arrêté des comptes'::text, array['arrête les comptes de l''exercice']::text[], array['القوائم المالية']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_conseil_administration', 'Délibérations (une occurrence par décision)', 'convocation_ag_details', 'AG convoquée : type, date, ordre du jour, projet de résolutions', 'texte', 'selon_cas', null::text, array['convoquer l''assemblée générale']::text[], '{}'::text[], null::text, null::text, 'pratique (BVMT-BIAT-2010 : convocation par le CA)', 'pratique'),
    ('pv_conseil_administration', 'Délibérations (une occurrence par décision)', 'nomination_dirigeant', 'Dirigeant nommé (PDG / président / DG / DGA), durée, rémunération, limitations de pouvoirs', 'texte', 'selon_cas', null::text, array['nomme en qualité de Directeur Général']::text[], array['الرئيس المدير العام', 'المدير العام']::text[], null::text, null::text, 'CSC art. 211, 217 (lecture partielle)', 'texte'),
    ('pv_conseil_administration', 'Délibérations (une occurrence par décision)', 'montant_engagement_autorise', 'Montant d''un engagement autorisé (caution, emprunt, cession d''actif)', 'montant', 'selon_cas', null::text, array['dans la limite de']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('pv_conseil_administration', 'Clôture', 'signataires', 'Signatures (président de séance et au moins un administrateur, selon pratique)', 'liste', 'oui', null::text, array['Le Président', 'Un administrateur']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN - règle légale non lue', 'incertain'),
    ('pv_conseil_administration', 'Clôture', 'pouvoirs_formalites', 'Pouvoirs pour formalités', 'texte', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'CSC art. 16', 'texte')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('decision_associe_unique', 'Identification', 'denomination', 'Dénomination suivie de S.U.A.R.L et capital', 'texte', 'oui', null::text, array['S.U.A.R.L']::text[], '{}'::text[], null::text, null::text, 'CSC art. 91', 'texte'),
    ('decision_associe_unique', 'Identification', 'date_decision', 'Date de la décision', 'date', 'oui', null::text, array['Décision de l''associé unique du']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('decision_associe_unique', 'Identification', 'associe_unique', 'Identité de l''associé unique (donnée personnelle)', 'texte', 'oui', null::text, array['L''associé unique']::text[], array['الشريك الوحيد']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('decision_associe_unique', 'Identification', 'nature_decision', 'Nature (décision ordinaire / extraordinaire)', 'liste', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('decision_associe_unique', 'Identification', 'folio_registre', 'Folio du registre spécial coté et paraphé', 'identifiant', 'selon_cas', null::text, array['registre spécial']::text[], '{}'::text[], null::text, null::text, 'CSC art. 154', 'texte'),
    ('decision_associe_unique', 'Décisions', 'documents_examines', 'Documents examinés (rapport de gestion, états financiers, rapport CAC)', 'liste', 'selon_cas', 'Approbation des comptes'::text, array['après avoir pris connaissance']::text[], '{}'::text[], null::text, null::text, 'CSC art. 128 par renvoi (INCERTAIN), 153', 'incertain'),
    ('decision_associe_unique', 'Décisions', 'decision_objet', 'Objet normalisé (approbation, affectation, nomination gérant, modification statutaire, capital, siège...)', 'liste', 'oui', null::text, array['décide']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('decision_associe_unique', 'Décisions', 'decision_texte', 'Texte de la décision', 'texte', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'CSC art. 154', 'texte'),
    ('decision_associe_unique', 'Décisions', 'resultat_exercice', 'Résultat de l''exercice et affectation (mêmes champs que pv_ago)', 'montant', 'selon_cas', 'Approbation des comptes'::text, '{}'::text[], '{}'::text[], null::text, null::text, 'CSC art. 140', 'texte'),
    ('decision_associe_unique', 'Décisions', 'operation_capital', 'Opération sur capital (mêmes champs que pv_age)', 'texte', 'selon_cas', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'CSC art. 131-137 par renvoi (INCERTAIN)', 'incertain'),
    ('decision_associe_unique', 'Décisions', 'convention_associe_gerant', 'Conventions entre la société et l''associé unique / gérant (mention au registre)', 'texte', 'selon_cas', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'INCERTAIN - régime SUARL spécifique non lu', 'incertain'),
    ('decision_associe_unique', 'Signature', 'signature_associe_unique', 'Signature de l''associé unique (personnelle, sans délégation)', 'booleen', 'oui', null::text, array['L''associé unique']::text[], '{}'::text[], null::text, null::text, 'CSC art. 153, 154', 'texte')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('decision_gerant', 'Identification', 'denomination', 'Dénomination, capital, siège', 'texte', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'CSC art. 91', 'texte'),
    ('decision_gerant', 'Identification', 'gerant', 'Identité et qualité du gérant (personne physique)', 'texte', 'oui', null::text, array['Le gérant soussigné']::text[], '{}'::text[], null::text, null::text, 'CSC art. 112', 'texte'),
    ('decision_gerant', 'Identification', 'date_decision', 'Date', 'date', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('decision_gerant', 'Décision', 'objet', 'Objet (convocation d''AG, arrêté des comptes, mise en conformité statutaire, transfert de siège si statuts l''autorisent, ouverture d''établissement, délégation)', 'liste', 'oui', null::text, array['décide']::text[], '{}'::text[], null::text, null::text, 'CSC art. 126, 131 ; pratique', 'pratique'),
    ('decision_gerant', 'Décision', 'texte', 'Texte de la décision', 'texte', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('decision_gerant', 'Décision', 'fondement_pouvoir', 'Fondement du pouvoir (article des statuts / loi)', 'texte', 'non', null::text, array['conformément à l''article']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('decision_gerant', 'Décision', 'ratification_requise', 'Ratification par l''AG suivante requise', 'booleen', 'selon_cas', 'Mise en conformité statutaire'::text, array['sous réserve de ratification']::text[], '{}'::text[], null::text, null::text, 'CSC art. 131', 'texte'),
    ('decision_gerant', 'Décision', 'signature_gerant', 'Signature du ou des gérants', 'booleen', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('rapport_gestion', 'Identification', 'denomination', 'Société', 'texte', 'oui', null::text, array['Rapport de gestion', 'Rapport du conseil d''administration']::text[], array['تقرير التصرف']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('rapport_gestion', 'Identification', 'exercice', 'Exercice couvert', 'periode', 'oui', null::text, array['exercice clos le']::text[], '{}'::text[], null::text, null::text, 'CSC art. 128', 'texte'),
    ('rapport_gestion', 'Identification', 'auteur', 'Organe auteur et date d''arrêté', 'texte', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('rapport_gestion', 'Identification', 'ag_destinataire', 'Assemblée à laquelle il est présenté (date)', 'date', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'CSC art. 128', 'texte'),
    ('rapport_gestion', 'Activité et résultats', 'situation_activite', 'Activité et situation de la société durant l''exercice', 'texte', 'oui', null::text, array['Activité de la société']::text[], '{}'::text[], null::text, null::text, 'CSC art. 201 INCERTAIN ; pratique', 'incertain'),
    ('rapport_gestion', 'Activité et résultats', 'chiffre_affaires', 'Chiffre d''affaires / produits d''exploitation', 'montant', 'non', null::text, array['chiffre d''affaires', 'revenus']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('rapport_gestion', 'Activité et résultats', 'resultat_net', 'Résultat net', 'montant', 'oui', null::text, array['résultat net']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('rapport_gestion', 'Activité et résultats', 'indicateurs_cles', 'Indicateurs clés et évolution N / N-1', 'liste', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('rapport_gestion', 'Activité et résultats', 'evenements_posterieurs', 'Événements importants survenus depuis la clôture', 'texte', 'non', null::text, array['événements postérieurs']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN ; pratique', 'incertain'),
    ('rapport_gestion', 'Activité et résultats', 'perspectives', 'Évolution prévisible et perspectives', 'texte', 'non', null::text, array['perspectives']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN ; pratique', 'incertain'),
    ('rapport_gestion', 'Activité et résultats', 'recherche_developpement', 'Activités de recherche et développement', 'texte', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('rapport_gestion', 'Activité et résultats', 'controle_interne', 'Contrôle interne / gestion des risques', 'texte', 'non', null::text, array['contrôle interne']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('rapport_gestion', 'Capital, filiales et gouvernance', 'actionnariat', 'Structure du capital et évolutions (franchissements de seuils)', 'liste', 'non', null::text, array['actionnariat']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('rapport_gestion', 'Capital, filiales et gouvernance', 'filiales_participations', 'Filiales et participations, prises de participation', 'liste', 'selon_cas', 'Société détenant des participations'::text, array['filiales', 'participations']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('rapport_gestion', 'Capital, filiales et gouvernance', 'organes_mandats', 'Organes d''administration et mandats arrivant à échéance', 'liste', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('rapport_gestion', 'Capital, filiales et gouvernance', 'remunerations_dirigeants', 'Rémunérations des dirigeants', 'montant', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('rapport_gestion', 'Capital, filiales et gouvernance', 'conventions', 'Conventions réglementées (SARL : rapport du gérant sur conventions)', 'texte', 'selon_cas', 'Conventions avec gérant/associé'::text, array['conventions']::text[], '{}'::text[], null::text, null::text, 'CSC art. 115', 'texte'),
    ('rapport_gestion', 'Propositions à l''assemblée', 'proposition_affectation', 'Proposition d''affectation du résultat', 'texte', 'oui', null::text, array['nous vous proposons d''affecter']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('rapport_gestion', 'Propositions à l''assemblée', 'dividendes_trois_derniers_exercices', 'Dividendes distribués au titre des exercices antérieurs', 'liste', 'non', 'Utile pour règle des 30 % sur 3 ans (SARL)'::text, '{}'::text[], '{}'::text[], null::text, null::text, 'CSC art. 140', 'texte'),
    ('rapport_gestion', 'Propositions à l''assemblée', 'projets_resolutions', 'Projets de résolutions', 'liste', 'non', null::text, array['projet de résolutions']::text[], '{}'::text[], null::text, null::text, 'CSC art. 126, 128', 'texte'),
    ('rapport_gestion', 'Propositions à l''assemblée', 'signature', 'Signature (gérant / président du conseil)', 'booleen', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('rapport_cac', 'Identification', 'type_rapport', 'Type (général / spécial conventions / réduction de capital / autre)', 'liste', 'oui', null::text, array['Rapport général', 'Rapport spécial']::text[], array['تقرير مراقب الحسابات']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('rapport_cac', 'Identification', 'societe_auditee', 'Société auditée', 'texte', 'oui', null::text, array['Messieurs les actionnaires de']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('rapport_cac', 'Identification', 'exercice', 'Exercice audité', 'periode', 'oui', 'Rapport annuel'::text, array['exercice clos le']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('rapport_cac', 'Identification', 'cac_identite', 'Identité du CAC (cabinet, associé signataire)', 'texte', 'oui', null::text, array['Commissaire aux comptes']::text[], array['مراقب الحسابات']::text[], null::text, null::text, 'CSC art. 259', 'texte'),
    ('rapport_cac', 'Identification', 'cac_inscription', 'Numéro d''inscription à l''ordre / tableau', 'identifiant', 'non', null::text, array['membre de l''Ordre des Experts Comptables de Tunisie']::text[], '{}'::text[], null::text, null::text, 'pratique ; INCERTAIN', 'incertain'),
    ('rapport_cac', 'Identification', 'mandat_reference', 'Référence de la désignation (AG, date, période du mandat)', 'periode', 'non', null::text, array['En exécution de la mission qui nous a été confiée par']::text[], '{}'::text[], null::text, null::text, 'CSC art. 13 bis, 260', 'texte'),
    ('rapport_cac', 'Identification', 'date_rapport', 'Date de signature', 'date', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('rapport_cac', 'Identification', 'lieu_signature', 'Lieu', 'texte', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('rapport_cac', 'Rapport général - opinion', 'type_opinion', 'Opinion (sans réserve / avec réserve / défavorable / impossibilité d''exprimer)', 'liste', 'oui', 'Rapport général'::text, array['Opinion', 'sans réserve', 'avec réserve', 'opinion défavorable', 'impossibilité d''exprimer une opinion']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN (normes d''audit)', 'incertain'),
    ('rapport_cac', 'Rapport général - opinion', 'fondement_opinion', 'Fondement de l''opinion / motifs des réserves', 'texte', 'selon_cas', 'Opinion modifiée'::text, array['Fondement de l''opinion']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('rapport_cac', 'Rapport général - opinion', 'observations', 'Paragraphes d''observation / incertitude sur la continuité', 'texte', 'non', null::text, array['Observation', 'continuité d''exploitation']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('rapport_cac', 'Rapport général - opinion', 'chiffres_cles_audites', 'Chiffres cités (total bilan, capitaux propres, résultat)', 'montant', 'non', null::text, array['total net de bilan', 'bénéfice de', 'capitaux propres positifs de']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('rapport_cac', 'Rapport général - opinion', 'verifications_specifiques', 'Vérifications spécifiques (rapport de gestion, contrôle interne, tenue des comptes en valeurs mobilières)', 'texte', 'non', null::text, array['Vérifications spécifiques']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('rapport_cac', 'Rapport général - opinion', 'irregularites_signalees', 'Irrégularités ou faits délictueux signalés', 'texte', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('rapport_cac', 'Rapport spécial - conventions', 'conventions_liste', 'Conventions (nouvelles et antérieures poursuivies) : parties, objet, montants, conditions', 'liste', 'selon_cas', 'Rapport spécial'::text, array['conventions et opérations visées']::text[], '{}'::text[], null::text, null::text, 'CSC art. 115, 200', 'texte'),
    ('rapport_cac', 'Rapport spécial - conventions', 'personne_interessee', 'Dirigeant / associé intéressé', 'texte', 'selon_cas', null::text, array['personne concernée']::text[], '{}'::text[], null::text, null::text, 'CSC art. 200', 'texte'),
    ('rapport_cac', 'Rapport spécial - conventions', 'montant_convention', 'Montant de la convention sur l''exercice', 'montant', 'selon_cas', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('rapport_cac', 'Rapport spécial - conventions', 'remunerations_dirigeants', 'Rémunérations et avantages des dirigeants', 'montant', 'non', null::text, array['rémunérations des dirigeants']::text[], '{}'::text[], null::text, null::text, 'CSC art. 200 (pratique BVMT ; liste précise INCERTAIN)', 'incertain'),
    ('rapport_cac', 'Rapport spécial - conventions', 'absence_conventions', 'Mention d''absence de conventions', 'booleen', 'selon_cas', null::text, array['aucune convention']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('rapport_cac', 'Signature', 'signature_cac', 'Signature et cachet du CAC', 'booleen', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('contrat_commercial', 'Identification du contrat', 'intitule', 'Intitulé / type de contrat', 'liste', 'oui', null::text, array['Contrat de', 'Convention de']::text[], array['عقد']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_commercial', 'Identification du contrat', 'reference', 'Référence interne / numéro', 'identifiant', 'non', null::text, array['Réf.']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_commercial', 'Identification du contrat', 'date_signature', 'Date de signature', 'date', 'oui', null::text, array['Fait à', 'le']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_commercial', 'Identification du contrat', 'lieu_signature', 'Lieu', 'texte', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_commercial', 'Identification du contrat', 'nombre_exemplaires', 'Nombre d''exemplaires originaux', 'nombre', 'non', null::text, array['en deux exemplaires originaux']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_commercial', 'Identification du contrat', 'langue_faisant_foi', 'Langue faisant foi', 'texte', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_commercial', 'Parties', 'partie_role', 'Rôle (vendeur, acheteur, prestataire, client, fournisseur, distributeur, concédant...)', 'liste', 'oui', 'Pour chaque partie'::text, array['ci-après dénommé']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_commercial', 'Parties', 'partie_denomination', 'Dénomination / nom', 'texte', 'oui', null::text, array['La société']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_commercial', 'Parties', 'partie_forme_capital', 'Forme et capital', 'texte', 'non', 'Personne morale'::text, array['au capital de']::text[], '{}'::text[], null::text, null::text, 'CSC art. 91 (mention sur documents SARL)', 'texte'),
    ('contrat_commercial', 'Parties', 'partie_siege', 'Siège / adresse', 'adresse', 'oui', null::text, array['dont le siège social est']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_commercial', 'Parties', 'partie_identifiant_unique', 'Identifiant unique RNE', 'identifiant', 'non', null::text, array['identifiant unique']::text[], array['المعرف الوحيد']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_commercial', 'Parties', 'partie_matricule_fiscal', 'Matricule fiscal', 'identifiant', 'non', null::text, array['Matricule fiscal']::text[], array['المعرف الجبائي']::text[], 'matricule_fiscal'::text, null::text, 'pratique', 'pratique'),
    ('contrat_commercial', 'Parties', 'partie_representant', 'Représentant signataire et qualité', 'texte', 'oui', 'Personne morale'::text, array['représentée par', 'en sa qualité de', 'dûment habilité']::text[], '{}'::text[], null::text, null::text, 'pratique ; CSC art. 16', 'pratique'),
    ('contrat_commercial', 'Parties', 'partie_pouvoir_reference', 'Référence du pouvoir du signataire (statuts, PV, procuration)', 'texte', 'non', null::text, array['en vertu des pouvoirs']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_commercial', 'Objet et obligations', 'preambule', 'Préambule / contexte', 'texte', 'non', null::text, array['Préambule', 'Il a été préalablement exposé']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_commercial', 'Objet et obligations', 'objet', 'Objet du contrat (biens, services, périmètre)', 'texte', 'oui', null::text, array['Objet']::text[], '{}'::text[], null::text, null::text, 'COC (article INCERTAIN)', 'incertain'),
    ('contrat_commercial', 'Objet et obligations', 'obligations_parties', 'Obligations de chaque partie', 'texte', 'oui', null::text, array['Obligations du']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_commercial', 'Objet et obligations', 'livrables_niveaux_service', 'Livrables, délais, niveaux de service, pénalités', 'liste', 'non', null::text, array['pénalités de retard']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_commercial', 'Objet et obligations', 'exclusivite_territoire', 'Exclusivité et territoire', 'texte', 'non', 'Distribution / agence'::text, array['exclusivité', 'territoire']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_commercial', 'Conditions financières', 'prix_montant', 'Prix / montant (HT, TVA, TTC) ou mode de détermination', 'montant', 'oui', null::text, array['Prix', 'HT', 'TTC']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_commercial', 'Conditions financières', 'devise', 'Devise', 'texte', 'oui', null::text, array['dinars', 'euros']::text[], '{}'::text[], null::text, null::text, 'pratique ; réglementation des changes hors périmètre', 'pratique'),
    ('contrat_commercial', 'Conditions financières', 'revision_prix', 'Clause de révision / indexation', 'texte', 'non', null::text, array['révision']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_commercial', 'Conditions financières', 'modalites_paiement', 'Modalités et délais de paiement, échéancier', 'texte', 'non', null::text, array['Modalités de paiement', 'à jours']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_commercial', 'Conditions financières', 'retenue_source_clause', 'Clause de retenue à la source / charges fiscales', 'texte', 'non', null::text, array['retenue à la source']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_commercial', 'Conditions financières', 'garanties_financieres', 'Garanties (caution bancaire, retenue de garantie, avance)', 'montant', 'non', null::text, array['caution', 'retenue de garantie']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_commercial', 'Durée et fin', 'date_effet', 'Date d''entrée en vigueur', 'date', 'oui', null::text, array['entre en vigueur']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_commercial', 'Durée et fin', 'duree', 'Durée', 'periode', 'oui', null::text, array['Durée']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_commercial', 'Durée et fin', 'renouvellement', 'Renouvellement (tacite / exprès) et préavis', 'texte', 'non', null::text, array['tacite reconduction', 'préavis']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_commercial', 'Durée et fin', 'resiliation', 'Cas et modalités de résiliation', 'texte', 'non', null::text, array['Résiliation']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_commercial', 'Clauses juridiques', 'responsabilite_plafond', 'Limitation de responsabilité (plafond)', 'montant', 'non', null::text, array['responsabilité']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_commercial', 'Clauses juridiques', 'confidentialite', 'Confidentialité', 'texte', 'non', null::text, array['Confidentialité']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_commercial', 'Clauses juridiques', 'donnees_personnelles', 'Protection des données personnelles', 'texte', 'non', 'Traitement de données personnelles'::text, array['données à caractère personnel']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN - loi organique tunisienne sur les données personnelles non consultée', 'incertain'),
    ('contrat_commercial', 'Clauses juridiques', 'propriete_intellectuelle', 'Propriété intellectuelle', 'texte', 'non', null::text, array['propriété intellectuelle']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_commercial', 'Clauses juridiques', 'force_majeure', 'Force majeure', 'texte', 'non', null::text, array['Force majeure']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_commercial', 'Clauses juridiques', 'cession_sous_traitance', 'Cession / sous-traitance', 'texte', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_commercial', 'Clauses juridiques', 'droit_applicable', 'Droit applicable', 'texte', 'non', null::text, array['droit applicable', 'droit tunisien']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_commercial', 'Clauses juridiques', 'juridiction_arbitrage', 'Juridiction compétente / clause compromissoire', 'texte', 'non', null::text, array['tribunaux de', 'arbitrage']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_commercial', 'Clauses juridiques', 'election_domicile', 'Élection de domicile', 'adresse', 'non', null::text, array['élisent domicile']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_commercial', 'Clauses juridiques', 'annexes', 'Annexes (cahier des charges, grille tarifaire, SLA)', 'liste', 'non', null::text, array['Annexe']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_commercial', 'Signatures et formalités', 'signatures', 'Signatures et cachets des parties', 'liste', 'oui', null::text, array['Lu et approuvé']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_commercial', 'Signatures et formalités', 'legalisation_signature', 'Légalisation des signatures', 'booleen', 'non', null::text, array['signature légalisée']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_commercial', 'Signatures et formalités', 'enregistrement', 'Mention d''enregistrement (recette, date, droits)', 'texte', 'selon_cas', null::text, array['Enregistré à']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN (Code des droits d''enregistrement non consulté)', 'incertain'),
    ('contrat_commercial', 'Signatures et formalités', 'avenant_reference', 'Référence au contrat initial (si avenant)', 'identifiant', 'selon_cas', 'Avenant'::text, array['Avenant n°']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('bail_commercial', 'Identification', 'type_bail', 'Type (commercial / professionnel / mixte / domiciliation)', 'liste', 'oui', null::text, array['Bail commercial', 'Contrat de location', 'Contrat de domiciliation']::text[], array['عقد كراء']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bail_commercial', 'Identification', 'date_signature', 'Date de signature', 'date', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bail_commercial', 'Identification', 'forme_acte', 'Forme (sous seing privé légalisé / authentique)', 'liste', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bail_commercial', 'Parties', 'bailleur_identite', 'Bailleur (personne physique : identité ; personne morale : dénomination, identifiant, représentant)', 'texte', 'oui', null::text, array['Le bailleur', 'propriétaire']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bail_commercial', 'Parties', 'bailleur_matricule_fiscal', 'Matricule fiscal / identifiant du bailleur', 'identifiant', 'non', 'Utile pour retenue à la source sur loyers'::text, array['matricule fiscal']::text[], array['المعرف الجبائي']::text[], 'matricule_fiscal'::text, null::text, 'pratique', 'pratique'),
    ('bail_commercial', 'Parties', 'preneur_identite', 'Preneur (dénomination, forme, identifiant unique, représentant)', 'texte', 'oui', null::text, array['Le preneur', 'le locataire']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bail_commercial', 'Parties', 'titre_bailleur', 'Titre de propriété / qualité du bailleur (propriétaire, usufruitier, sous-bailleur)', 'texte', 'non', null::text, array['titre foncier']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bail_commercial', 'Local', 'adresse_local', 'Adresse du local', 'adresse', 'oui', null::text, array['sis à']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bail_commercial', 'Local', 'description_local', 'Désignation (surface, étage, composition, dépendances)', 'texte', 'oui', null::text, array['d''une superficie de', 'm²']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bail_commercial', 'Local', 'titre_foncier_reference', 'Référence du titre foncier', 'identifiant', 'non', null::text, array['titre foncier n°']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bail_commercial', 'Local', 'destination', 'Destination / activité autorisée', 'texte', 'oui', null::text, array['à usage de', 'destination']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bail_commercial', 'Local', 'usage_siege_social', 'Autorisation d''y fixer le siège social / domiciliation', 'booleen', 'non', null::text, array['siège social']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bail_commercial', 'Local', 'etat_des_lieux', 'État des lieux annexé', 'booleen', 'non', null::text, array['état des lieux']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bail_commercial', 'Durée', 'date_effet', 'Date de prise d''effet', 'date', 'oui', null::text, array['à compter du']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bail_commercial', 'Durée', 'duree', 'Durée', 'periode', 'oui', null::text, array['pour une durée de']::text[], array['المدة']::text[], null::text, null::text, 'Loi 77-37 INCERTAIN', 'incertain'),
    ('bail_commercial', 'Durée', 'renouvellement', 'Renouvellement (tacite, par périodes)', 'texte', 'non', null::text, array['renouvelable par tacite reconduction']::text[], '{}'::text[], null::text, null::text, 'Loi 77-37 INCERTAIN', 'incertain'),
    ('bail_commercial', 'Durée', 'preavis_conge', 'Préavis de congé / forme', 'texte', 'non', null::text, array['préavis', 'congé']::text[], '{}'::text[], null::text, null::text, 'Loi 77-37 INCERTAIN', 'incertain'),
    ('bail_commercial', 'Conditions financières', 'loyer_montant', 'Loyer (montant, périodicité, HT/TTC)', 'montant', 'oui', null::text, array['loyer mensuel', 'loyer annuel']::text[], array['معين الكراء']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bail_commercial', 'Conditions financières', 'periodicite', 'Périodicité de paiement (mensuel, trimestriel, d''avance)', 'liste', 'oui', null::text, array['payable d''avance']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bail_commercial', 'Conditions financières', 'tva_loyer', 'Assujettissement du loyer à la TVA', 'booleen', 'non', null::text, array['TVA']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN (fiscal hors périmètre)', 'incertain'),
    ('bail_commercial', 'Conditions financières', 'augmentation_loyer', 'Clause d''augmentation (taux, périodicité)', 'taux', 'non', null::text, array['majoration de', '% chaque année']::text[], '{}'::text[], null::text, null::text, 'pratique ; encadrement légal INCERTAIN (loi 77-37)', 'incertain'),
    ('bail_commercial', 'Conditions financières', 'depot_garantie', 'Dépôt de garantie / caution', 'montant', 'non', null::text, array['dépôt de garantie', 'caution']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bail_commercial', 'Conditions financières', 'avance_loyers', 'Avance sur loyers', 'montant', 'non', null::text, array['avance']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bail_commercial', 'Conditions financières', 'charges_impots', 'Répartition des charges et taxes (taxe locative, syndic, eau, électricité)', 'texte', 'non', null::text, array['charges', 'taxes']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bail_commercial', 'Conditions financières', 'retenue_source_loyer', 'Mention de retenue à la source sur loyers', 'texte', 'non', null::text, array['retenue à la source']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN (fiscal hors périmètre)', 'incertain'),
    ('bail_commercial', 'Conditions financières', 'modalites_paiement', 'Modalités de paiement (virement, chèque, compte du bailleur - RIB masqué)', 'texte', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bail_commercial', 'Clauses', 'travaux_entretien', 'Travaux, entretien, réparations', 'texte', 'non', null::text, array['réparations']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bail_commercial', 'Clauses', 'cession_sous_location', 'Cession du bail / sous-location', 'texte', 'non', null::text, array['sous-location', 'cession du droit au bail']::text[], '{}'::text[], null::text, null::text, 'pratique ; Loi 77-37 INCERTAIN', 'incertain'),
    ('bail_commercial', 'Clauses', 'clause_resolutoire', 'Clause résolutoire', 'texte', 'non', null::text, array['clause résolutoire']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bail_commercial', 'Clauses', 'assurance', 'Assurances', 'texte', 'non', null::text, array['assurance']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bail_commercial', 'Clauses', 'juridiction', 'Juridiction compétente', 'texte', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bail_commercial', 'Signatures et formalités', 'signatures', 'Signatures (légalisées)', 'liste', 'oui', null::text, array['signature légalisée']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bail_commercial', 'Signatures et formalités', 'enregistrement', 'Mention d''enregistrement (recette, date, quittance, droits)', 'texte', 'selon_cas', null::text, array['Enregistré à la recette']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('procuration', 'Identification', 'type_pouvoir', 'Type (pouvoir pour AG / délégation de pouvoirs / procuration bancaire / pouvoir pour formalités / mandat général)', 'liste', 'oui', null::text, array['Pouvoir', 'Procuration', 'Délégation de pouvoirs']::text[], array['توكيل']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('procuration', 'Identification', 'date_pouvoir', 'Date', 'date', 'oui', null::text, array['Fait à', 'le']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('procuration', 'Identification', 'lieu', 'Lieu', 'texte', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('procuration', 'Mandant', 'mandant_identite', 'Mandant (personne physique ou morale)', 'texte', 'oui', null::text, array['Je soussigné', 'La société']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('procuration', 'Mandant', 'mandant_qualite', 'Qualité du mandant (associé détenant X titres, gérant, PDG)', 'texte', 'oui', null::text, array['agissant en qualité de', 'propriétaire de']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('procuration', 'Mandant', 'mandant_titres', 'Nombre de parts/actions détenues', 'nombre', 'selon_cas', 'Pouvoir pour AG'::text, array['propriétaire de', 'parts sociales', 'actions']::text[], '{}'::text[], null::text, null::text, 'CSC art. 129', 'texte'),
    ('procuration', 'Mandant', 'mandant_representant', 'Représentant légal si mandant personne morale', 'texte', 'selon_cas', null::text, array['représentée par']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('procuration', 'Mandataire', 'mandataire_identite', 'Mandataire (identité - donnée personnelle)', 'texte', 'oui', null::text, array['donne pouvoir à', 'constitue pour mandataire']::text[], '{}'::text[], null::text, null::text, 'CSC art. 129', 'texte'),
    ('procuration', 'Mandataire', 'mandataire_qualite', 'Qualité du mandataire (associé, conjoint, salarié, avocat...)', 'texte', 'non', 'Restrictions statutaires possibles'::text, '{}'::text[], '{}'::text[], null::text, null::text, 'statuts ; pratique', 'pratique'),
    ('procuration', 'Mandataire', 'substitution', 'Faculté de substitution / sous-délégation', 'booleen', 'non', null::text, array['avec faculté de substitution']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('procuration', 'Objet et limites', 'objet_pouvoir', 'Objet précis (assemblée du [date] / actes autorisés)', 'texte', 'oui', 'Pouvoir AG : procuration spéciale'::text, array['à l''effet de', 'aux fins de me représenter']::text[], '{}'::text[], null::text, null::text, 'CSC art. 129', 'texte'),
    ('procuration', 'Objet et limites', 'assemblee_visee', 'Assemblée visée (type, date, société)', 'date', 'selon_cas', 'Pouvoir pour AG'::text, array['à l''assemblée générale qui se tiendra le']::text[], '{}'::text[], null::text, null::text, 'CSC art. 129', 'texte'),
    ('procuration', 'Objet et limites', 'instructions_vote', 'Instructions de vote par résolution', 'liste', 'non', null::text, array['voter pour', 'voter contre']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('procuration', 'Objet et limites', 'plafond_montant', 'Plafond d''engagement', 'montant', 'non', 'Délégation financière'::text, array['dans la limite de']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('procuration', 'Objet et limites', 'duree_validite', 'Durée de validité / date d''expiration', 'periode', 'non', null::text, array['valable jusqu''au']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('procuration', 'Objet et limites', 'fondement_pouvoir_mandant', 'Source du pouvoir du mandant (statuts, PV du conseil)', 'texte', 'non', 'Délégation par un dirigeant'::text, array['en vertu de']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('procuration', 'Signatures et formalités', 'signature_mandant', 'Signature du mandant (''Bon pour pouvoir'')', 'booleen', 'oui', null::text, array['Bon pour pouvoir']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('procuration', 'Signatures et formalités', 'acceptation_mandataire', 'Acceptation / signature du mandataire', 'booleen', 'non', null::text, array['Bon pour acceptation']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('procuration', 'Signatures et formalités', 'legalisation', 'Légalisation de signature', 'booleen', 'selon_cas', 'Exigée par le tiers (banque, RNE)'::text, array['signature légalisée']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('procuration', 'Signatures et formalités', 'date_depot', 'Date de dépôt au siège avant l''AG', 'date', 'selon_cas', 'Si les statuts imposent un délai'::text, array['déposé au siège']::text[], '{}'::text[], null::text, null::text, 'statuts (pratique BVMT-TRE-2018)', 'pratique')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('bulletin_paie', 'en_tete_employeur', 'employeur_raison_sociale', 'Raison sociale ou nom de l''employeur', 'texte', 'oui', null::text, array['Employeur', 'Société', 'Raison sociale']::text[], array['المؤجر']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bulletin_paie', 'en_tete_employeur', 'employeur_adresse', 'Adresse du siège ou de l''établissement', 'adresse', 'oui', null::text, array['Adresse', 'Siège social']::text[], array['العنوان']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bulletin_paie', 'en_tete_employeur', 'employeur_matricule_fiscal', 'Matricule fiscal (identifiant unique) de l''employeur', 'identifiant', 'selon_cas', 'Obligatoire sur les documents à portée fiscale ; usuel ailleurs'::text, array['Matricule fiscal', 'MF', 'Identifiant unique']::text[], array['المعرف الجبائي']::text[], 'matricule_fiscal'::text, null::text, 'pratique', 'pratique'),
    ('bulletin_paie', 'en_tete_employeur', 'employeur_numero_cnss', 'Numéro d''affiliation employeur à la CNSS', 'identifiant', 'oui', null::text, array['N° affiliation CNSS', 'N° employeur', 'Matricule CNSS employeur']::text[], array['الصندوق الوطني للضمان الاجتماعي']::text[], null::text, null::text, 'pratique (identifiant exigé par la CNSS sur ses formulaires)', 'pratique'),
    ('bulletin_paie', 'en_tete_employeur', 'employeur_rne', 'Identifiant au Registre national des entreprises', 'identifiant', 'non', 'Si personne morale ou commerçant immatriculé'::text, array['RNE', 'Registre national des entreprises', 'Registre de commerce']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bulletin_paie', 'en_tete_employeur', 'employeur_activite', 'Activité principale / secteur', 'texte', 'non', 'Utile pour taux AT et convention collective'::text, array['Activité', 'Secteur']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bulletin_paie', 'en_tete_employeur', 'employeur_telephone_email', 'Coordonnées de contact', 'texte', 'non', null::text, array['Tél', 'E-mail']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bulletin_paie', 'en_tete_employeur', 'employeur_signature_cachet', 'Signature et cachet de l''employeur', 'booleen', 'selon_cas', 'Exigé en pratique sur attestations, contrats, solde de tout compte'::text, array['Signature', 'Cachet']::text[], array['الإمضاء']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bulletin_paie', 'identite_salarie', 'salarie_nom_prenom', 'Nom et prénom du salarié (donnée personnelle)', 'texte', 'oui', null::text, array['Nom', 'Prénom', 'Nom et prénom']::text[], array['الاسم واللقب']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bulletin_paie', 'identite_salarie', 'salarie_cin', 'Numéro de carte d''identité nationale ou de passeport/carte de séjour (donnée personnelle, à masquer)', 'identifiant', 'selon_cas', 'CIN pour les Tunisiens ; passeport/carte de séjour pour les étrangers'::text, array['CIN', 'N° CIN', 'Passeport']::text[], array['بطاقة التعريف الوطنية']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bulletin_paie', 'identite_salarie', 'salarie_matricule_cnss', 'Numéro d''immatriculation (assuré social) du salarié à la CNSS (donnée personnelle)', 'identifiant', 'oui', null::text, array['N° CNSS', 'Matricule CNSS', 'N° assuré social']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bulletin_paie', 'identite_salarie', 'salarie_matricule_interne', 'Matricule interne du salarié chez l''employeur', 'identifiant', 'non', null::text, array['Matricule', 'Mle']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bulletin_paie', 'identite_salarie', 'salarie_date_naissance', 'Date de naissance (donnée personnelle)', 'date', 'non', null::text, array['Date de naissance', 'Né(e) le']::text[], array['تاريخ الولادة']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bulletin_paie', 'identite_salarie', 'salarie_adresse', 'Adresse du salarié (donnée personnelle)', 'adresse', 'non', null::text, array['Adresse']::text[], array['العنوان']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bulletin_paie', 'identite_salarie', 'salarie_nationalite', 'Nationalité', 'texte', 'non', 'Requis en pratique pour un salarié étranger (contrat visé)'::text, array['Nationalité']::text[], array['الجنسية']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bulletin_paie', 'identite_salarie', 'salarie_situation_familiale', 'Situation familiale et nombre d''enfants à charge', 'texte', 'selon_cas', 'Nécessaire au calcul des déductions IRPP (chef de famille, enfants)'::text, array['Situation familiale', 'Chef de famille', 'Enfants à charge', 'Marié', 'Célibataire']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN : Code IRPP-IS, déductions pour charges de famille (article non lu)', 'incertain'),
    ('bulletin_paie', 'emploi_et_classification', 'emploi_poste', 'Emploi / fonction occupé', 'texte', 'oui', null::text, array['Emploi', 'Fonction', 'Poste', 'Qualification']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN : Code du travail, article non lu (vérifier sur legislation.tn, Code du travail consolidé)', 'incertain'),
    ('bulletin_paie', 'emploi_et_classification', 'categorie_echelon', 'Catégorie, échelon (grille de la convention collective sectorielle)', 'texte', 'selon_cas', 'Si l''employeur relève d''une convention collective sectorielle'::text, array['Catégorie', 'Échelon', 'Cat.', 'Ech.']::text[], array['الصنف', 'الدرجة']::text[], null::text, null::text, 'INCERTAIN : convention collective sectorielle applicable', 'incertain'),
    ('bulletin_paie', 'emploi_et_classification', 'convention_collective', 'Convention collective applicable', 'texte', 'non', null::text, array['Convention collective']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bulletin_paie', 'emploi_et_classification', 'date_entree', 'Date d''entrée / d''embauche', 'date', 'non', 'Utile au calcul de l''ancienneté'::text, array['Date d''entrée', 'Date d''embauche']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bulletin_paie', 'emploi_et_classification', 'anciennete', 'Ancienneté (années/mois)', 'texte', 'non', null::text, array['Ancienneté']::text[], array['الأقدمية']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bulletin_paie', 'emploi_et_classification', 'type_contrat', 'Nature du contrat (CDI, CDD, CIVP…)', 'liste', 'non', null::text, array['Type contrat', 'Nature contrat']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bulletin_paie', 'emploi_et_classification', 'regime_horaire', 'Régime horaire (40 h ou 48 h hebdomadaires)', 'liste', 'non', 'Détermine le SMIG applicable'::text, array['Régime', '40H', '48H']::text[], '{}'::text[], null::text, null::text, 'Cleiss : SMIG 48 h et 40 h distincts (2025)', 'texte'),
    ('bulletin_paie', 'periode', 'periode_paie', 'Période de paie (mois, quinzaine)', 'periode', 'oui', null::text, array['Période', 'Mois de', 'Du … au …']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN : Code du travail, article non lu (vérifier sur legislation.tn, Code du travail consolidé)', 'incertain'),
    ('bulletin_paie', 'periode', 'date_paiement', 'Date de paiement', 'date', 'selon_cas', null::text, array['Date de paiement', 'Payé le']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bulletin_paie', 'periode', 'mode_paiement', 'Mode de paiement (virement, chèque, espèces)', 'liste', 'non', null::text, array['Mode de paiement', 'Virement', 'Chèque', 'Espèces']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bulletin_paie', 'periode', 'banque_salarie', 'Banque du salarié (RIB masqué, jamais stocké en clair)', 'texte', 'non', 'Si virement'::text, array['Banque', 'RIB']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bulletin_paie', 'temps_de_travail', 'jours_travailles', 'Nombre de jours travaillés', 'nombre', 'selon_cas', 'Paie journalière'::text, array['Jours travaillés', 'Nbre jours']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bulletin_paie', 'temps_de_travail', 'heures_normales', 'Nombre d''heures normales', 'nombre', 'selon_cas', 'Paie horaire'::text, array['Heures normales', 'Nbre heures']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bulletin_paie', 'temps_de_travail', 'heures_supplementaires', 'Heures supplémentaires (nombre, taux de majoration, montant)', 'montant', 'selon_cas', 'Si heures supplémentaires effectuées'::text, array['Heures supplémentaires', 'HS 75%', 'HS 50%', 'HS 100%']::text[], array['الساعات الإضافية']::text[], null::text, null::text, 'INCERTAIN : Code du travail, article non lu (vérifier sur legislation.tn, Code du travail consolidé)', 'incertain'),
    ('bulletin_paie', 'temps_de_travail', 'absences', 'Absences (nombre et retenue)', 'montant', 'selon_cas', null::text, array['Absences', 'Retenue absence']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bulletin_paie', 'temps_de_travail', 'conges_payes_pris', 'Congés payés pris / indemnité de congé', 'montant', 'selon_cas', null::text, array['Congé payé', 'Indemnité congé']::text[], array['عطلة خالصة الأجر']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bulletin_paie', 'temps_de_travail', 'solde_conges', 'Solde de congés restant', 'nombre', 'non', null::text, array['Solde congé', 'Reliquat']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bulletin_paie', 'temps_de_travail', 'jours_feries_payes', 'Jours fériés chômés payés', 'montant', 'selon_cas', null::text, array['Jours fériés']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bulletin_paie', 'elements_bruts', 'salaire_base', 'Salaire de base', 'montant', 'oui', null::text, array['Salaire de base', 'Base']::text[], array['الأجر الأساسي']::text[], null::text, null::text, 'INCERTAIN : Code du travail, article non lu (vérifier sur legislation.tn, Code du travail consolidé)', 'incertain'),
    ('bulletin_paie', 'elements_bruts', 'taux_horaire_ou_journalier', 'Taux horaire ou journalier', 'montant', 'selon_cas', 'Paie horaire/journalière'::text, array['Taux horaire', 'Taux journalier']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bulletin_paie', 'elements_bruts', 'prime_anciennete', 'Prime d''ancienneté', 'montant', 'selon_cas', 'Selon convention collective'::text, array['Prime d''ancienneté']::text[], array['منحة الأقدمية']::text[], null::text, null::text, 'INCERTAIN : convention collective sectorielle', 'incertain'),
    ('bulletin_paie', 'elements_bruts', 'indemnite_transport', 'Indemnité de transport', 'montant', 'selon_cas', 'Selon convention collective'::text, array['Indemnité de transport', 'Prime de transport']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN : convention collective sectorielle', 'incertain'),
    ('bulletin_paie', 'elements_bruts', 'indemnite_presence', 'Prime/indemnité de présence', 'montant', 'selon_cas', null::text, array['Prime de présence', 'Indemnité de présence']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN : convention collective sectorielle', 'incertain'),
    ('bulletin_paie', 'elements_bruts', 'prime_rendement', 'Prime de rendement / productivité', 'montant', 'non', null::text, array['Prime de rendement', 'Prime de productivité']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bulletin_paie', 'elements_bruts', 'autres_primes_indemnites', 'Autres primes et indemnités (liste libre : panier, salissure, responsabilité, logement, fonction…)', 'liste', 'non', null::text, array['Prime', 'Indemnité']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bulletin_paie', 'elements_bruts', 'avantages_en_nature', 'Avantages en nature (véhicule, logement…) valorisés', 'montant', 'selon_cas', 'Si fournis'::text, array['Avantage en nature']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bulletin_paie', 'elements_bruts', 'salaire_brut', 'Salaire brut (total des éléments de rémunération soumis)', 'montant', 'oui', null::text, array['Salaire brut', 'Brut', 'Total brut']::text[], array['الأجر الخام']::text[], null::text, null::text, 'INCERTAIN : Code du travail, article non lu (vérifier sur legislation.tn, Code du travail consolidé)', 'incertain'),
    ('bulletin_paie', 'cotisations_sociales', 'assiette_cnss', 'Assiette des cotisations CNSS (brut soumis)', 'montant', 'oui', null::text, array['Brut soumis CNSS', 'Base CNSS', 'Assiette CNSS']::text[], '{}'::text[], null::text, null::text, 'Cleiss 2025 : cotisations de base sur la totalité du salaire, sans plafond mentionné', 'texte'),
    ('bulletin_paie', 'cotisations_sociales', 'taux_cnss_salarie', 'Taux de cotisation salariale CNSS', 'taux', 'non', '9,18 % (Cleiss, au 1er janvier 2025) ; 9,68 % si +0,5 % Fonds perte d''emploi (PwC, revue 29/06/2026) : à paramétrer en base, jamais en dur'::text, array['CNSS', 'Taux CNSS', 'Cotisation salariale']::text[], '{}'::text[], null::text, null::text, 'Cleiss 2025 / PwC 2026 ; répartition FPE INCERTAINE', 'incertain'),
    ('bulletin_paie', 'cotisations_sociales', 'retenue_cnss_salarie', 'Montant de la retenue CNSS salariale', 'montant', 'oui', null::text, array['Retenue CNSS', 'Cotisation CNSS', 'CNSS salariale']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN : Code du travail, article non lu (vérifier sur legislation.tn, Code du travail consolidé) ; Loi n° 60-30 du 14 décembre 1960 relative aux régimes de sécurité sociale, modifiée par la loi n° 2007-51 du 23 juillet 2007', 'incertain'),
    ('bulletin_paie', 'cotisations_sociales', 'cotisation_fpe_salarie', 'Cotisation Fonds d''assurance perte d''emploi (part salariale)', 'montant', 'selon_cas', 'Si appliquée par l''employeur (base légale LF 2025 ; répartition et collecteur INCERTAINS)'::text, array['Perte d''emploi', 'Fonds chômage']::text[], '{}'::text[], null::text, null::text, 'PwC (0,5 % chacun) vs presse (0,5 % réparti) : INCERTAIN', 'incertain'),
    ('bulletin_paie', 'cotisations_sociales', 'retraite_complementaire_salarie', 'Retraite complémentaire (part salariale)', 'montant', 'selon_cas', 'Établissements adhérents ; tranche au-delà de 6 SMIG (Cleiss 2025 : 3 % salarié)'::text, array['Retraite complémentaire', 'RCC']::text[], '{}'::text[], null::text, null::text, 'Cleiss 2025', 'texte'),
    ('bulletin_paie', 'cotisations_sociales', 'assurance_groupe_salarie', 'Assurance groupe / mutuelle (part salariale)', 'montant', 'non', 'Si contrat de prévoyance'::text, array['Assurance groupe', 'Mutuelle']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bulletin_paie', 'cotisations_sociales', 'foprolos_salarie', 'FOPROLOS part salariale (si affichée)', 'montant', 'selon_cas', 'INCERTAIN : FOPROLOS est en principe patronal ; une source secondaire (Africarrières) évoque 0,5 % salarié'::text, array['FOPROLOS']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('bulletin_paie', 'imposition', 'salaire_imposable', 'Salaire imposable (brut − CNSS salariale − frais professionnels et déductions)', 'montant', 'selon_cas', null::text, array['Salaire imposable', 'Net imposable', 'Imposable']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN : Code IRPP-IS (déduction frais professionnels, charges de famille ; articles non lus)', 'incertain'),
    ('bulletin_paie', 'imposition', 'base_annualisee', 'Base annuelle imposable reconstituée', 'montant', 'non', 'Méthode d''annualisation pour appliquer le barème'::text, array['Base annuelle', 'Revenu annuel']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bulletin_paie', 'imposition', 'retenue_irpp', 'Retenue à la source au titre de l''IRPP', 'montant', 'oui', 'Peut être nulle sous le seuil d''imposition'::text, array['IRPP', 'Impôt sur le revenu', 'Retenue à la source', 'IR']::text[], array['الضريبة على الدخل', 'الخصم من المورد']::text[], null::text, null::text, 'LF 2025 art. 36 (barème) ; obligation de retenue : Code IRPP-IS, article INCERTAIN', 'incertain'),
    ('bulletin_paie', 'imposition', 'css_salarie', 'Contribution sociale de solidarité (CSS) retenue', 'montant', 'selon_cas', 'Si en vigueur pour la période'::text, array['CSS', 'Contribution sociale de solidarité']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN : taux et base à vérifier (LF successives)', 'incertain'),
    ('bulletin_paie', 'autres_retenues', 'avance_sur_salaire', 'Avances et acomptes', 'montant', 'selon_cas', null::text, array['Avance', 'Acompte']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bulletin_paie', 'autres_retenues', 'pret_employeur', 'Remboursement de prêt employeur', 'montant', 'selon_cas', null::text, array['Prêt', 'Remboursement prêt']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bulletin_paie', 'autres_retenues', 'saisie_cession', 'Saisie-arrêt / cession sur salaire', 'montant', 'selon_cas', 'Sur décision ou cession'::text, array['Saisie', 'Cession']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN : Code du travail, article non lu (vérifier sur legislation.tn, Code du travail consolidé)', 'incertain'),
    ('bulletin_paie', 'autres_retenues', 'cotisation_syndicale', 'Cotisation syndicale', 'montant', 'selon_cas', 'Si le salarié y a consenti'::text, array['Cotisation syndicale']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bulletin_paie', 'autres_retenues', 'autres_retenues_liste', 'Autres retenues (liste libre)', 'liste', 'non', null::text, array['Retenue', 'Divers']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bulletin_paie', 'autres_retenues', 'total_retenues', 'Total des retenues', 'montant', 'selon_cas', null::text, array['Total retenues']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bulletin_paie', 'totaux_net', 'net_a_payer', 'Net à payer', 'montant', 'oui', null::text, array['Net à payer', 'Net', 'Salaire net']::text[], array['الأجر الصافي']::text[], null::text, null::text, 'INCERTAIN : Code du travail, article non lu (vérifier sur legislation.tn, Code du travail consolidé)', 'incertain'),
    ('bulletin_paie', 'totaux_net', 'net_en_lettres', 'Net en toutes lettres', 'texte', 'non', null::text, array['Arrêté le présent bulletin à la somme de']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bulletin_paie', 'totaux_net', 'cumuls_annuels', 'Cumuls depuis le 1er janvier (brut, CNSS, imposable, IRPP, net)', 'montant', 'non', 'Recommandé pour le recoupement avec la déclaration employeur'::text, array['Cumul', 'Cumuls annuels']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bulletin_paie', 'charges_patronales', 'cnss_patronale', 'Cotisation patronale CNSS', 'montant', 'non', 'Taux 16,57 % hors AT (Cleiss 2025) ; 17,07 % avec FPE (PwC) ; à paramétrer'::text, array['CNSS patronale', 'Part patronale']::text[], '{}'::text[], null::text, null::text, 'Cleiss 2025 / PwC 2026', 'texte'),
    ('bulletin_paie', 'charges_patronales', 'accident_travail', 'Cotisation accident du travail (taux selon secteur 0,4 % à 4 %)', 'montant', 'non', null::text, array['Accident de travail', 'AT']::text[], '{}'::text[], null::text, null::text, 'Cleiss 2025', 'texte'),
    ('bulletin_paie', 'charges_patronales', 'tfp', 'Taxe de formation professionnelle', 'montant', 'non', null::text, array['TFP']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN : taux (1 % / 2 % selon secteur) et seuil à vérifier au Code IRPP-IS / texte TFP', 'incertain'),
    ('bulletin_paie', 'charges_patronales', 'foprolos', 'Contribution FOPROLOS', 'montant', 'non', null::text, array['FOPROLOS']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN : taux et exonérations à vérifier', 'incertain'),
    ('bulletin_paie', 'charges_patronales', 'cout_total_employeur', 'Coût total employeur', 'montant', 'non', null::text, array['Coût employeur', 'Coût total']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bulletin_paie', 'mentions', 'mention_conservation', 'Mentions diverses (conserver sans limite, réclamations…)', 'texte', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('bulletin_paie', 'mentions', 'signature_salarie', 'Émargement du salarié', 'booleen', 'non', 'Pratique en cas de paiement en espèces'::text, array['Signature salarié', 'Lu et approuvé']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('declaration_cnss_trimestrielle', 'identification_employeur', 'employeur_raison_sociale', 'Raison sociale ou nom de l''employeur', 'texte', 'oui', null::text, array['Employeur', 'Société', 'Raison sociale']::text[], array['المؤجر']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('declaration_cnss_trimestrielle', 'identification_employeur', 'employeur_adresse', 'Adresse du siège ou de l''établissement', 'adresse', 'oui', null::text, array['Adresse', 'Siège social']::text[], array['العنوان']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('declaration_cnss_trimestrielle', 'identification_employeur', 'employeur_matricule_fiscal', 'Matricule fiscal (identifiant unique) de l''employeur', 'identifiant', 'selon_cas', 'Obligatoire sur les documents à portée fiscale ; usuel ailleurs'::text, array['Matricule fiscal', 'MF', 'Identifiant unique']::text[], array['المعرف الجبائي']::text[], 'matricule_fiscal'::text, null::text, 'pratique', 'pratique'),
    ('declaration_cnss_trimestrielle', 'identification_employeur', 'employeur_numero_cnss', 'Numéro d''affiliation employeur à la CNSS', 'identifiant', 'oui', null::text, array['N° affiliation CNSS', 'N° employeur', 'Matricule CNSS employeur']::text[], array['الصندوق الوطني للضمان الاجتماعي']::text[], null::text, null::text, 'Loi n° 60-30 du 14 décembre 1960 relative aux régimes de sécurité sociale, modifiée par la loi n° 2007-51 du 23 juillet 2007 (affiliation) ; article INCERTAIN', 'incertain'),
    ('declaration_cnss_trimestrielle', 'identification_employeur', 'employeur_rne', 'Identifiant au Registre national des entreprises', 'identifiant', 'non', 'Si personne morale ou commerçant immatriculé'::text, array['RNE', 'Registre national des entreprises', 'Registre de commerce']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('declaration_cnss_trimestrielle', 'identification_employeur', 'employeur_activite', 'Activité principale / secteur', 'texte', 'non', 'Utile pour taux AT et convention collective'::text, array['Activité', 'Secteur']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('declaration_cnss_trimestrielle', 'identification_employeur', 'employeur_telephone_email', 'Coordonnées de contact', 'texte', 'non', null::text, array['Tél', 'E-mail']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('declaration_cnss_trimestrielle', 'identification_employeur', 'employeur_signature_cachet', 'Signature et cachet de l''employeur', 'booleen', 'selon_cas', 'Exigé en pratique sur attestations, contrats, solde de tout compte'::text, array['Signature', 'Cachet']::text[], array['الإمضاء']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('declaration_cnss_trimestrielle', 'identification_employeur', 'code_exploitation', 'Code d''exploitation / établissement (si plusieurs)', 'identifiant', 'selon_cas', 'Employeur multi-établissements'::text, array['Code exploitation']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN : nomenclature CNSS', 'incertain'),
    ('declaration_cnss_trimestrielle', 'identification_employeur', 'regime', 'Régime de sécurité sociale (salariés non agricoles, agricoles…)', 'liste', 'oui', null::text, array['Régime']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('declaration_cnss_trimestrielle', 'periode', 'annee', 'Année', 'nombre', 'oui', null::text, array['Année']::text[], array['السنة']::text[], null::text, null::text, 'Loi n° 60-30 du 14 décembre 1960 relative aux régimes de sécurité sociale, modifiée par la loi n° 2007-51 du 23 juillet 2007', 'texte'),
    ('declaration_cnss_trimestrielle', 'periode', 'trimestre', 'Trimestre (1 à 4)', 'periode', 'oui', null::text, array['Trimestre', 'T1', 'T2', 'T3', 'T4']::text[], array['الثلاثية']::text[], null::text, null::text, 'Loi n° 60-30 du 14 décembre 1960 relative aux régimes de sécurité sociale, modifiée par la loi n° 2007-51 du 23 juillet 2007 art. 45', 'texte'),
    ('declaration_cnss_trimestrielle', 'periode', 'nature_declaration', 'Nature (initiale, complémentaire, rectificative)', 'liste', 'selon_cas', null::text, array['Complémentaire', 'Rectificative']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('declaration_cnss_trimestrielle', 'periode', 'numero_page', 'Numéro de page / feuillet', 'nombre', 'non', 'Déclaration papier multi-pages'::text, array['Page', 'Feuillet']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('declaration_cnss_trimestrielle', 'lignes_salaries', 'ligne_ordre', 'Numéro d''ordre de la ligne', 'nombre', 'non', null::text, array['N° ordre']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('declaration_cnss_trimestrielle', 'lignes_salaries', 'ligne_matricule_cnss', 'Matricule CNSS de l''assuré (type identifiant, donnée personnelle)', 'identifiant', 'oui', null::text, array['Matricule assuré', 'N° assuré']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('declaration_cnss_trimestrielle', 'lignes_salaries', 'ligne_nom_prenom', 'Nom et prénom de l''assuré', 'texte', 'oui', null::text, array['Nom et prénom']::text[], array['الاسم واللقب']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('declaration_cnss_trimestrielle', 'lignes_salaries', 'ligne_cin', 'Numéro CIN (donnée personnelle)', 'identifiant', 'selon_cas', null::text, array['CIN']::text[], array['بطاقة التعريف الوطنية']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('declaration_cnss_trimestrielle', 'lignes_salaries', 'ligne_salaire_mois1', 'Salaire brut du 1er mois du trimestre', 'montant', 'selon_cas', 'Si ventilation mensuelle demandée par le formulaire'::text, array['Mois 1']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN : format du formulaire CNSS en vigueur', 'incertain'),
    ('declaration_cnss_trimestrielle', 'lignes_salaries', 'ligne_salaire_mois2', 'Salaire brut du 2e mois', 'montant', 'selon_cas', 'idem'::text, array['Mois 2']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('declaration_cnss_trimestrielle', 'lignes_salaries', 'ligne_salaire_mois3', 'Salaire brut du 3e mois', 'montant', 'selon_cas', 'idem'::text, array['Mois 3']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('declaration_cnss_trimestrielle', 'lignes_salaries', 'ligne_salaire_trimestre', 'Total salaire du trimestre pour l''assuré', 'montant', 'oui', null::text, array['Salaire trimestriel', 'Total']::text[], '{}'::text[], null::text, null::text, 'Loi n° 60-30 du 14 décembre 1960 relative aux régimes de sécurité sociale, modifiée par la loi n° 2007-51 du 23 juillet 2007', 'texte'),
    ('declaration_cnss_trimestrielle', 'lignes_salaries', 'ligne_jours_ou_mois', 'Période/jours d''activité (entrée/sortie en cours de trimestre)', 'texte', 'selon_cas', null::text, array['Date entrée', 'Date sortie']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('declaration_cnss_trimestrielle', 'totaux_et_cotisations', 'nombre_salaries', 'Nombre de salariés déclarés', 'nombre', 'oui', null::text, array['Nombre de salariés', 'Effectif']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('declaration_cnss_trimestrielle', 'totaux_et_cotisations', 'masse_salariale_declaree', 'Total des salaires déclarés (masse salariale)', 'montant', 'oui', null::text, array['Total salaires', 'Masse salariale']::text[], '{}'::text[], null::text, null::text, 'Loi n° 60-30 du 14 décembre 1960 relative aux régimes de sécurité sociale, modifiée par la loi n° 2007-51 du 23 juillet 2007', 'texte'),
    ('declaration_cnss_trimestrielle', 'totaux_et_cotisations', 'taux_global', 'Taux global de cotisation appliqué (patronal + salarial + AT)', 'taux', 'oui', '26,15 % à 29,75 % (Cleiss 2025) ; +1 % si FPE 0,5 %+0,5 % (PwC) ; à paramétrer par employeur'::text, array['Taux']::text[], '{}'::text[], null::text, null::text, 'Cleiss 2025 / PwC 2026', 'texte'),
    ('declaration_cnss_trimestrielle', 'totaux_et_cotisations', 'taux_accident_travail', 'Taux accident du travail propre à l''employeur', 'taux', 'oui', '0,4 % à 4 % selon secteur'::text, array['Taux AT']::text[], '{}'::text[], null::text, null::text, 'Cleiss 2025', 'texte'),
    ('declaration_cnss_trimestrielle', 'totaux_et_cotisations', 'montant_cotisations', 'Montant total des cotisations dues', 'montant', 'oui', null::text, array['Montant des cotisations', 'Cotisations dues']::text[], array['المساهمات']::text[], null::text, null::text, 'Loi n° 60-30 du 14 décembre 1960 relative aux régimes de sécurité sociale, modifiée par la loi n° 2007-51 du 23 juillet 2007', 'texte'),
    ('declaration_cnss_trimestrielle', 'totaux_et_cotisations', 'penalites_retard', 'Pénalités de retard', 'montant', 'selon_cas', 'Si dépôt/paiement après échéance'::text, array['Pénalités', 'Majorations']::text[], '{}'::text[], null::text, null::text, 'Loi n° 60-30 du 14 décembre 1960 relative aux régimes de sécurité sociale, modifiée par la loi n° 2007-51 du 23 juillet 2007 art. 105 nouveau', 'texte'),
    ('declaration_cnss_trimestrielle', 'totaux_et_cotisations', 'montant_total_a_payer', 'Total à payer', 'montant', 'oui', null::text, array['Total à payer', 'Net à payer']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('declaration_cnss_trimestrielle', 'validation', 'date_depot', 'Date de dépôt / transmission', 'date', 'oui', null::text, array['Date de dépôt', 'Date']::text[], array['التاريخ']::text[], null::text, null::text, 'Loi n° 60-30 du 14 décembre 1960 relative aux régimes de sécurité sociale, modifiée par la loi n° 2007-51 du 23 juillet 2007 art. 45', 'texte'),
    ('declaration_cnss_trimestrielle', 'validation', 'signature_cachet', 'Signature et cachet de l''employeur (dépôt papier)', 'booleen', 'selon_cas', 'Dépôt papier'::text, array['Signature', 'Cachet']::text[], array['الإمضاء']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('declaration_cnss_trimestrielle', 'validation', 'reference_teledeclaration', 'Référence / numéro de télédéclaration', 'identifiant', 'selon_cas', 'Si télédéclaration'::text, array['Référence', 'N° déclaration']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('recepisse_quittance_cnss', 'emetteur', 'bureau_cnss', 'Bureau régional CNSS ou canal (portail, banque)', 'texte', 'selon_cas', null::text, array['Bureau régional', 'CNSS']::text[], array['الصندوق الوطني للضمان الاجتماعي']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('recepisse_quittance_cnss', 'emetteur', 'numero_quittance', 'Numéro de quittance / reçu / transaction', 'identifiant', 'oui', null::text, array['Quittance N°', 'Reçu N°', 'N° transaction']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('recepisse_quittance_cnss', 'employeur', 'employeur_numero_cnss', 'Numéro d''affiliation employeur', 'identifiant', 'oui', null::text, array['N° affiliation']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('recepisse_quittance_cnss', 'employeur', 'employeur_raison_sociale', 'Raison sociale', 'texte', 'oui', null::text, array['Employeur']::text[], array['المؤجر']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('recepisse_quittance_cnss', 'objet', 'annee', 'Année', 'nombre', 'oui', null::text, array['Année']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('recepisse_quittance_cnss', 'objet', 'trimestre_ou_mois', 'Trimestre (ou mois si paiement mensuel)', 'periode', 'oui', null::text, array['Trimestre', 'Mois']::text[], array['الثلاثية']::text[], null::text, null::text, 'Loi n° 60-30 du 14 décembre 1960 relative aux régimes de sécurité sociale, modifiée par la loi n° 2007-51 du 23 juillet 2007 art. 45', 'texte'),
    ('recepisse_quittance_cnss', 'objet', 'regime', 'Régime', 'liste', 'non', null::text, array['Régime']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('recepisse_quittance_cnss', 'objet', 'masse_salariale_rappel', 'Masse salariale déclarée (rappel)', 'montant', 'non', null::text, array['Salaires déclarés']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('recepisse_quittance_cnss', 'paiement', 'montant_cotisations', 'Montant des cotisations payées', 'montant', 'oui', null::text, array['Montant', 'Cotisations']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('recepisse_quittance_cnss', 'paiement', 'montant_penalites', 'Pénalités payées', 'montant', 'selon_cas', null::text, array['Pénalités']::text[], '{}'::text[], null::text, null::text, 'Loi n° 60-30 du 14 décembre 1960 relative aux régimes de sécurité sociale, modifiée par la loi n° 2007-51 du 23 juillet 2007 art. 105', 'texte'),
    ('recepisse_quittance_cnss', 'paiement', 'montant_total_paye', 'Total payé', 'montant', 'oui', null::text, array['Total payé', 'Montant réglé']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('recepisse_quittance_cnss', 'paiement', 'date_paiement', 'Date de paiement', 'date', 'oui', null::text, array['Date de paiement', 'Payé le']::text[], array['التاريخ']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('recepisse_quittance_cnss', 'paiement', 'mode_paiement', 'Mode (espèces, chèque, virement, télépaiement, carte)', 'liste', 'oui', null::text, array['Mode de paiement']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('recepisse_quittance_cnss', 'paiement', 'reference_bancaire', 'Référence chèque / virement', 'identifiant', 'selon_cas', null::text, array['Chèque N°', 'Réf. virement']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('recepisse_quittance_cnss', 'paiement', 'cachet_visa', 'Cachet / visa CNSS ou empreinte électronique', 'booleen', 'selon_cas', 'Quittance papier'::text, array['Cachet', 'Visa']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('contrat_cdi', 'en_tete', 'intitule', 'Intitulé du contrat', 'texte', 'oui', null::text, array['Contrat de travail à durée indéterminée', 'CDI']::text[], array['عقد شغل لمدة غير معينة']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdi', 'en_tete', 'reference_contrat', 'Référence interne', 'identifiant', 'non', null::text, array['Réf.']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdi', 'en_tete', 'avenant_numero', 'Numéro d''avenant', 'nombre', 'selon_cas', 'Si avenant'::text, array['Avenant n°']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdi', 'parties_employeur', 'employeur_raison_sociale', 'Raison sociale ou nom de l''employeur', 'texte', 'oui', null::text, array['Employeur', 'Société', 'Raison sociale']::text[], array['المؤجر']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdi', 'parties_employeur', 'employeur_adresse', 'Adresse du siège ou de l''établissement', 'adresse', 'oui', null::text, array['Adresse', 'Siège social']::text[], array['العنوان']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdi', 'parties_employeur', 'employeur_matricule_fiscal', 'Matricule fiscal (identifiant unique) de l''employeur', 'identifiant', 'selon_cas', 'Obligatoire sur les documents à portée fiscale ; usuel ailleurs'::text, array['Matricule fiscal', 'MF', 'Identifiant unique']::text[], array['المعرف الجبائي']::text[], 'matricule_fiscal'::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdi', 'parties_employeur', 'employeur_numero_cnss', 'Numéro d''affiliation employeur à la CNSS', 'identifiant', 'oui', null::text, array['N° affiliation CNSS', 'N° employeur', 'Matricule CNSS employeur']::text[], array['الصندوق الوطني للضمان الاجتماعي']::text[], null::text, null::text, 'pratique (identifiant exigé par la CNSS sur ses formulaires)', 'pratique'),
    ('contrat_cdi', 'parties_employeur', 'employeur_rne', 'Identifiant au Registre national des entreprises', 'identifiant', 'non', 'Si personne morale ou commerçant immatriculé'::text, array['RNE', 'Registre national des entreprises', 'Registre de commerce']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdi', 'parties_employeur', 'employeur_activite', 'Activité principale / secteur', 'texte', 'non', 'Utile pour taux AT et convention collective'::text, array['Activité', 'Secteur']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdi', 'parties_employeur', 'employeur_telephone_email', 'Coordonnées de contact', 'texte', 'non', null::text, array['Tél', 'E-mail']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdi', 'parties_employeur', 'employeur_signature_cachet', 'Signature et cachet de l''employeur', 'booleen', 'selon_cas', 'Exigé en pratique sur attestations, contrats, solde de tout compte'::text, array['Signature', 'Cachet']::text[], array['الإمضاء']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdi', 'parties_salarie', 'salarie_nom_prenom', 'Nom et prénom du salarié (donnée personnelle)', 'texte', 'oui', null::text, array['Nom', 'Prénom', 'Nom et prénom']::text[], array['الاسم واللقب']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdi', 'parties_salarie', 'salarie_cin', 'Numéro de carte d''identité nationale ou de passeport/carte de séjour (donnée personnelle, à masquer)', 'identifiant', 'selon_cas', 'CIN pour les Tunisiens ; passeport/carte de séjour pour les étrangers'::text, array['CIN', 'N° CIN', 'Passeport']::text[], array['بطاقة التعريف الوطنية']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdi', 'parties_salarie', 'salarie_matricule_cnss', 'Numéro d''immatriculation (assuré social) du salarié à la CNSS (donnée personnelle)', 'identifiant', 'selon_cas', null::text, array['N° CNSS', 'Matricule CNSS', 'N° assuré social']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdi', 'parties_salarie', 'salarie_matricule_interne', 'Matricule interne du salarié chez l''employeur', 'identifiant', 'non', null::text, array['Matricule', 'Mle']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdi', 'parties_salarie', 'salarie_date_naissance', 'Date de naissance (donnée personnelle)', 'date', 'non', null::text, array['Date de naissance', 'Né(e) le']::text[], array['تاريخ الولادة']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdi', 'parties_salarie', 'salarie_adresse', 'Adresse du salarié (donnée personnelle)', 'adresse', 'non', null::text, array['Adresse']::text[], array['العنوان']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdi', 'parties_salarie', 'salarie_nationalite', 'Nationalité', 'texte', 'non', 'Requis en pratique pour un salarié étranger (contrat visé)'::text, array['Nationalité']::text[], array['الجنسية']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdi', 'parties_salarie', 'salarie_diplome_qualification', 'Diplôme / qualification', 'texte', 'non', null::text, array['Diplôme', 'Qualification']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdi', 'objet_et_poste', 'emploi_poste', 'Emploi / fonction', 'texte', 'oui', null::text, array['Fonction', 'Poste', 'En qualité de']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdi', 'objet_et_poste', 'categorie_echelon', 'Catégorie / échelon conventionnels', 'texte', 'selon_cas', 'Si convention collective'::text, array['Catégorie', 'Échelon']::text[], array['الصنف', 'الدرجة']::text[], null::text, null::text, 'INCERTAIN : convention sectorielle', 'incertain'),
    ('contrat_cdi', 'objet_et_poste', 'convention_collective', 'Convention collective applicable', 'texte', 'non', null::text, array['Convention collective']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdi', 'objet_et_poste', 'lieu_travail', 'Lieu de travail', 'adresse', 'non', null::text, array['Lieu de travail']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdi', 'objet_et_poste', 'date_debut', 'Date de prise d''effet', 'date', 'oui', null::text, array['Date d''effet', 'À compter du']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdi', 'periode_essai', 'periode_essai_duree', 'Durée de la période d''essai', 'texte', 'selon_cas', 'Si prévue ; au plus 6 mois renouvelable une fois (réforme 2025, selon presse)'::text, array['Période d''essai']::text[], array['فترة التجربة']::text[], null::text, null::text, 'Loi de 2025 encadrant les contrats de travail et interdisant la sous-traitance (JORT n° 61 du 23 mai 2025 ; numéro cité 9/2025 ou 16/2025 selon la presse : INCERTAIN) ; article INCERTAIN', 'incertain'),
    ('contrat_cdi', 'periode_essai', 'periode_essai_renouvellement', 'Clause de renouvellement de l''essai', 'booleen', 'non', null::text, array['Renouvelable']::text[], '{}'::text[], null::text, null::text, 'Loi de 2025 encadrant les contrats de travail et interdisant la sous-traitance (JORT n° 61 du 23 mai 2025 ; numéro cité 9/2025 ou 16/2025 selon la presse : INCERTAIN) (INCERTAIN)', 'incertain'),
    ('contrat_cdi', 'remuneration', 'salaire_base', 'Salaire de base (mensuel, horaire ou journalier)', 'montant', 'oui', null::text, array['Salaire de base', 'Rémunération']::text[], array['الأجر الأساسي']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdi', 'remuneration', 'salaire_brut_ou_net', 'Indication brut ou net du montant convenu', 'liste', 'non', null::text, array['Brut', 'Net']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdi', 'remuneration', 'primes_contractuelles', 'Primes et avantages contractuels', 'liste', 'non', null::text, array['Prime', 'Avantage']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdi', 'remuneration', 'periodicite_paie', 'Périodicité de paiement', 'liste', 'non', null::text, array['Mensuel']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdi', 'temps_de_travail', 'duree_hebdo', 'Durée hebdomadaire (40 h, 48 h, temps partiel)', 'liste', 'non', null::text, array['Heures par semaine', 'Horaire']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdi', 'temps_de_travail', 'temps_partiel', 'Temps partiel (oui/non, quotité)', 'booleen', 'selon_cas', null::text, array['Temps partiel']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN : Code du travail, chapitre temps partiel (articles non lus)', 'incertain'),
    ('contrat_cdi', 'clauses', 'clause_non_concurrence', 'Clause de non-concurrence', 'texte', 'non', null::text, array['Non-concurrence']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdi', 'clauses', 'clause_confidentialite', 'Clause de confidentialité', 'texte', 'non', null::text, array['Confidentialité']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdi', 'clauses', 'clause_mobilite', 'Clause de mobilité', 'texte', 'non', null::text, array['Mobilité']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdi', 'clauses', 'preavis', 'Préavis de rupture', 'texte', 'non', null::text, array['Préavis']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN : Code du travail / convention', 'incertain'),
    ('contrat_cdi', 'clauses', 'conges', 'Congés annuels', 'texte', 'non', null::text, array['Congé annuel']::text[], array['عطلة خالصة الأجر']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdi', 'signatures', 'lieu_date_signature', 'Lieu et date de signature', 'date', 'oui', null::text, array['Fait à', 'Le']::text[], array['التاريخ']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdi', 'signatures', 'signature_employeur', 'Signature de l''employeur', 'booleen', 'oui', null::text, array['L''employeur']::text[], array['المؤجر']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdi', 'signatures', 'signature_salarie', 'Signature du salarié (« lu et approuvé »)', 'booleen', 'oui', null::text, array['Le salarié', 'Lu et approuvé']::text[], array['الأجير']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdi', 'signatures', 'nombre_exemplaires', 'Nombre d''exemplaires originaux', 'nombre', 'non', null::text, array['Fait en … exemplaires']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdi', 'signatures', 'legalisation_signature', 'Légalisation des signatures', 'booleen', 'non', 'Pratique courante ; obligatoire en pratique pour contrat d''étranger (visa ministère)'::text, array['Légalisation']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('contrat_cdi', 'signatures', 'visa_ministere_etranger', 'Visa du ministère chargé de l''emploi (salarié étranger)', 'booleen', 'selon_cas', 'Salarié de nationalité étrangère'::text, array['Visa', 'Ministère de l''emploi']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN : Code du travail, titre travailleurs étrangers (articles non lus)', 'incertain'),
    ('contrat_cdi', 'conversion', 'issu_conversion_cdd', 'CDI issu d''une conversion légale de CDD (réforme 2025)', 'booleen', 'selon_cas', 'Contrats requalifiés au titre des dispositions transitoires'::text, '{}'::text[], '{}'::text[], null::text, null::text, 'Loi de 2025 encadrant les contrats de travail et interdisant la sous-traitance (JORT n° 61 du 23 mai 2025 ; numéro cité 9/2025 ou 16/2025 selon la presse : INCERTAIN) art. 6 (selon presse)', 'incertain'),
    ('contrat_cdi', 'conversion', 'anciennete_reprise', 'Date d''ancienneté reprise', 'date', 'selon_cas', 'Si conversion ou reprise'::text, array['Ancienneté reprise']::text[], '{}'::text[], null::text, null::text, 'Loi de 2025 encadrant les contrats de travail et interdisant la sous-traitance (JORT n° 61 du 23 mai 2025 ; numéro cité 9/2025 ou 16/2025 selon la presse : INCERTAIN) art. 6 (ancienneté intégrale si interruption < 1 an, selon presse)', 'incertain')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('contrat_cdd', 'en_tete', 'intitule', 'Intitulé du contrat', 'texte', 'oui', null::text, array['Contrat de travail à durée déterminée', 'CDD']::text[], array['عقد شغل لمدة معينة']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdd', 'en_tete', 'reference_contrat', 'Référence interne', 'identifiant', 'non', null::text, array['Réf.']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdd', 'parties_employeur', 'employeur_raison_sociale', 'Raison sociale ou nom de l''employeur', 'texte', 'oui', null::text, array['Employeur', 'Société', 'Raison sociale']::text[], array['المؤجر']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdd', 'parties_employeur', 'employeur_adresse', 'Adresse du siège ou de l''établissement', 'adresse', 'oui', null::text, array['Adresse', 'Siège social']::text[], array['العنوان']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdd', 'parties_employeur', 'employeur_matricule_fiscal', 'Matricule fiscal (identifiant unique) de l''employeur', 'identifiant', 'selon_cas', 'Obligatoire sur les documents à portée fiscale ; usuel ailleurs'::text, array['Matricule fiscal', 'MF', 'Identifiant unique']::text[], array['المعرف الجبائي']::text[], 'matricule_fiscal'::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdd', 'parties_employeur', 'employeur_numero_cnss', 'Numéro d''affiliation employeur à la CNSS', 'identifiant', 'oui', null::text, array['N° affiliation CNSS', 'N° employeur', 'Matricule CNSS employeur']::text[], array['الصندوق الوطني للضمان الاجتماعي']::text[], null::text, null::text, 'pratique (identifiant exigé par la CNSS sur ses formulaires)', 'pratique'),
    ('contrat_cdd', 'parties_employeur', 'employeur_rne', 'Identifiant au Registre national des entreprises', 'identifiant', 'non', 'Si personne morale ou commerçant immatriculé'::text, array['RNE', 'Registre national des entreprises', 'Registre de commerce']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdd', 'parties_employeur', 'employeur_activite', 'Activité principale / secteur', 'texte', 'non', 'Utile pour taux AT et convention collective'::text, array['Activité', 'Secteur']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdd', 'parties_employeur', 'employeur_telephone_email', 'Coordonnées de contact', 'texte', 'non', null::text, array['Tél', 'E-mail']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdd', 'parties_employeur', 'employeur_signature_cachet', 'Signature et cachet de l''employeur', 'booleen', 'selon_cas', 'Exigé en pratique sur attestations, contrats, solde de tout compte'::text, array['Signature', 'Cachet']::text[], array['الإمضاء']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdd', 'parties_salarie', 'salarie_nom_prenom', 'Nom et prénom du salarié (donnée personnelle)', 'texte', 'oui', null::text, array['Nom', 'Prénom', 'Nom et prénom']::text[], array['الاسم واللقب']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdd', 'parties_salarie', 'salarie_cin', 'Numéro de carte d''identité nationale ou de passeport/carte de séjour (donnée personnelle, à masquer)', 'identifiant', 'selon_cas', 'CIN pour les Tunisiens ; passeport/carte de séjour pour les étrangers'::text, array['CIN', 'N° CIN', 'Passeport']::text[], array['بطاقة التعريف الوطنية']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdd', 'parties_salarie', 'salarie_matricule_cnss', 'Numéro d''immatriculation (assuré social) du salarié à la CNSS (donnée personnelle)', 'identifiant', 'selon_cas', null::text, array['N° CNSS', 'Matricule CNSS', 'N° assuré social']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdd', 'parties_salarie', 'salarie_matricule_interne', 'Matricule interne du salarié chez l''employeur', 'identifiant', 'non', null::text, array['Matricule', 'Mle']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdd', 'parties_salarie', 'salarie_date_naissance', 'Date de naissance (donnée personnelle)', 'date', 'non', null::text, array['Date de naissance', 'Né(e) le']::text[], array['تاريخ الولادة']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdd', 'parties_salarie', 'salarie_adresse', 'Adresse du salarié (donnée personnelle)', 'adresse', 'non', null::text, array['Adresse']::text[], array['العنوان']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdd', 'parties_salarie', 'salarie_nationalite', 'Nationalité', 'texte', 'non', 'Requis en pratique pour un salarié étranger (contrat visé)'::text, array['Nationalité']::text[], array['الجنسية']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdd', 'parties_salarie', 'salarie_diplome_qualification', 'Diplôme / qualification', 'texte', 'non', null::text, array['Diplôme', 'Qualification']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdd', 'objet_et_poste', 'emploi_poste', 'Emploi / fonction', 'texte', 'oui', null::text, array['Fonction', 'Poste', 'En qualité de']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdd', 'objet_et_poste', 'categorie_echelon', 'Catégorie / échelon conventionnels', 'texte', 'selon_cas', 'Si convention collective'::text, array['Catégorie', 'Échelon']::text[], array['الصنف', 'الدرجة']::text[], null::text, null::text, 'INCERTAIN : convention sectorielle', 'incertain'),
    ('contrat_cdd', 'objet_et_poste', 'convention_collective', 'Convention collective applicable', 'texte', 'non', null::text, array['Convention collective']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdd', 'objet_et_poste', 'lieu_travail', 'Lieu de travail', 'adresse', 'non', null::text, array['Lieu de travail']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdd', 'objet_et_poste', 'date_debut', 'Date de prise d''effet', 'date', 'oui', null::text, array['Date d''effet', 'À compter du']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdd', 'periode_essai', 'periode_essai_duree', 'Durée de la période d''essai', 'texte', 'selon_cas', 'Si prévue ; au plus 6 mois renouvelable une fois (réforme 2025, selon presse)'::text, array['Période d''essai']::text[], array['فترة التجربة']::text[], null::text, null::text, 'Loi de 2025 encadrant les contrats de travail et interdisant la sous-traitance (JORT n° 61 du 23 mai 2025 ; numéro cité 9/2025 ou 16/2025 selon la presse : INCERTAIN) ; article INCERTAIN', 'incertain'),
    ('contrat_cdd', 'periode_essai', 'periode_essai_renouvellement', 'Clause de renouvellement de l''essai', 'booleen', 'non', null::text, array['Renouvelable']::text[], '{}'::text[], null::text, null::text, 'Loi de 2025 encadrant les contrats de travail et interdisant la sous-traitance (JORT n° 61 du 23 mai 2025 ; numéro cité 9/2025 ou 16/2025 selon la presse : INCERTAIN) (INCERTAIN)', 'incertain'),
    ('contrat_cdd', 'remuneration', 'salaire_base', 'Salaire de base (mensuel, horaire ou journalier)', 'montant', 'oui', null::text, array['Salaire de base', 'Rémunération']::text[], array['الأجر الأساسي']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdd', 'remuneration', 'salaire_brut_ou_net', 'Indication brut ou net du montant convenu', 'liste', 'non', null::text, array['Brut', 'Net']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdd', 'remuneration', 'primes_contractuelles', 'Primes et avantages contractuels', 'liste', 'non', null::text, array['Prime', 'Avantage']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdd', 'remuneration', 'periodicite_paie', 'Périodicité de paiement', 'liste', 'non', null::text, array['Mensuel']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdd', 'temps_de_travail', 'duree_hebdo', 'Durée hebdomadaire (40 h, 48 h, temps partiel)', 'liste', 'non', null::text, array['Heures par semaine', 'Horaire']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdd', 'temps_de_travail', 'temps_partiel', 'Temps partiel (oui/non, quotité)', 'booleen', 'selon_cas', null::text, array['Temps partiel']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN : Code du travail, chapitre temps partiel (articles non lus)', 'incertain'),
    ('contrat_cdd', 'clauses', 'clause_non_concurrence', 'Clause de non-concurrence', 'texte', 'non', null::text, array['Non-concurrence']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdd', 'clauses', 'clause_confidentialite', 'Clause de confidentialité', 'texte', 'non', null::text, array['Confidentialité']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdd', 'clauses', 'clause_mobilite', 'Clause de mobilité', 'texte', 'non', null::text, array['Mobilité']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdd', 'clauses', 'preavis', 'Préavis de rupture', 'texte', 'non', null::text, array['Préavis']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN : Code du travail / convention', 'incertain'),
    ('contrat_cdd', 'clauses', 'conges', 'Congés annuels', 'texte', 'non', null::text, array['Congé annuel']::text[], array['عطلة خالصة الأجر']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdd', 'signatures', 'lieu_date_signature', 'Lieu et date de signature', 'date', 'oui', null::text, array['Fait à', 'Le']::text[], array['التاريخ']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdd', 'signatures', 'signature_employeur', 'Signature de l''employeur', 'booleen', 'oui', null::text, array['L''employeur']::text[], array['المؤجر']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdd', 'signatures', 'signature_salarie', 'Signature du salarié (« lu et approuvé »)', 'booleen', 'oui', null::text, array['Le salarié', 'Lu et approuvé']::text[], array['الأجير']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdd', 'signatures', 'nombre_exemplaires', 'Nombre d''exemplaires originaux', 'nombre', 'non', null::text, array['Fait en … exemplaires']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdd', 'signatures', 'legalisation_signature', 'Légalisation des signatures', 'booleen', 'non', 'Pratique courante ; obligatoire en pratique pour contrat d''étranger (visa ministère)'::text, array['Légalisation']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('contrat_cdd', 'signatures', 'visa_ministere_etranger', 'Visa du ministère chargé de l''emploi (salarié étranger)', 'booleen', 'selon_cas', 'Salarié de nationalité étrangère'::text, array['Visa', 'Ministère de l''emploi']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN : Code du travail, titre travailleurs étrangers (articles non lus)', 'incertain'),
    ('contrat_cdd', 'motif_et_duree', 'forme_ecrite', 'Contrat écrit', 'booleen', 'oui', 'À défaut, CDI'::text, '{}'::text[], '{}'::text[], null::text, null::text, 'Loi de 2025 encadrant les contrats de travail et interdisant la sous-traitance (JORT n° 61 du 23 mai 2025 ; numéro cité 9/2025 ou 16/2025 selon la presse : INCERTAIN) (presse : art. 6-4 nouveau)', 'incertain'),
    ('contrat_cdd', 'motif_et_duree', 'motif_recours', 'Motif de recours parmi les cas autorisés (saisonnier, remplacement, surcroît exceptionnel)', 'liste', 'oui', null::text, array['Motif', 'Saisonnier', 'Remplacement', 'Surcroît']::text[], '{}'::text[], null::text, null::text, 'Loi de 2025 encadrant les contrats de travail et interdisant la sous-traitance (JORT n° 61 du 23 mai 2025 ; numéro cité 9/2025 ou 16/2025 selon la presse : INCERTAIN) art. 6-4 nouveau (liste exacte INCERTAINE)', 'incertain'),
    ('contrat_cdd', 'motif_et_duree', 'circonstances', 'Circonstances de conclusion et domaine d''activité', 'texte', 'oui', null::text, array['Circonstances']::text[], '{}'::text[], null::text, null::text, 'Projet de loi mars 2025 (presse) ; texte final INCERTAIN', 'incertain'),
    ('contrat_cdd', 'motif_et_duree', 'salarie_remplace', 'Identité/fonction du salarié remplacé', 'texte', 'selon_cas', 'Motif remplacement'::text, array['En remplacement de']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdd', 'motif_et_duree', 'date_fin_ou_terme', 'Date de fin ou terme (fin de saison, retour du salarié)', 'date', 'oui', null::text, array['Date de fin', 'Jusqu''au']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdd', 'motif_et_duree', 'duree', 'Durée', 'texte', 'oui', null::text, array['Durée']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_cdd', 'motif_et_duree', 'renouvellement', 'Clause/numéro de renouvellement', 'nombre', 'selon_cas', null::text, array['Renouvellement']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN : plafond de renouvellement après réforme', 'incertain')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('contrat_insertion_civp', 'parties', 'employeur_raison_sociale', 'Raison sociale ou nom de l''employeur', 'texte', 'oui', null::text, array['Employeur', 'Société', 'Raison sociale']::text[], array['المؤجر']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_insertion_civp', 'parties', 'employeur_adresse', 'Adresse du siège ou de l''établissement', 'adresse', 'oui', null::text, array['Adresse', 'Siège social']::text[], array['العنوان']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_insertion_civp', 'parties', 'employeur_matricule_fiscal', 'Matricule fiscal (identifiant unique) de l''employeur', 'identifiant', 'selon_cas', 'Obligatoire sur les documents à portée fiscale ; usuel ailleurs'::text, array['Matricule fiscal', 'MF', 'Identifiant unique']::text[], array['المعرف الجبائي']::text[], 'matricule_fiscal'::text, null::text, 'pratique', 'pratique'),
    ('contrat_insertion_civp', 'parties', 'employeur_numero_cnss', 'Numéro d''affiliation employeur à la CNSS', 'identifiant', 'oui', null::text, array['N° affiliation CNSS', 'N° employeur', 'Matricule CNSS employeur']::text[], array['الصندوق الوطني للضمان الاجتماعي']::text[], null::text, null::text, 'pratique (identifiant exigé par la CNSS sur ses formulaires)', 'pratique'),
    ('contrat_insertion_civp', 'parties', 'employeur_rne', 'Identifiant au Registre national des entreprises', 'identifiant', 'non', 'Si personne morale ou commerçant immatriculé'::text, array['RNE', 'Registre national des entreprises', 'Registre de commerce']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_insertion_civp', 'parties', 'employeur_activite', 'Activité principale / secteur', 'texte', 'non', 'Utile pour taux AT et convention collective'::text, array['Activité', 'Secteur']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_insertion_civp', 'parties', 'employeur_telephone_email', 'Coordonnées de contact', 'texte', 'non', null::text, array['Tél', 'E-mail']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_insertion_civp', 'parties', 'employeur_signature_cachet', 'Signature et cachet de l''employeur', 'booleen', 'selon_cas', 'Exigé en pratique sur attestations, contrats, solde de tout compte'::text, array['Signature', 'Cachet']::text[], array['الإمضاء']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_insertion_civp', 'parties', 'bureau_emploi', 'Bureau de l''emploi / ANETI', 'texte', 'oui', null::text, array['Bureau de l''emploi', 'ANETI']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_insertion_civp', 'parties', 'numero_contrat_aneti', 'Numéro du contrat / dossier ANETI', 'identifiant', 'oui', null::text, array['N° contrat', 'N° dossier']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_insertion_civp', 'parties', 'salarie_nom_prenom', 'Nom et prénom du salarié (donnée personnelle)', 'texte', 'oui', null::text, array['Nom', 'Prénom', 'Nom et prénom']::text[], array['الاسم واللقب']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_insertion_civp', 'parties', 'salarie_cin', 'Numéro de carte d''identité nationale ou de passeport/carte de séjour (donnée personnelle, à masquer)', 'identifiant', 'selon_cas', 'CIN pour les Tunisiens ; passeport/carte de séjour pour les étrangers'::text, array['CIN', 'N° CIN', 'Passeport']::text[], array['بطاقة التعريف الوطنية']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_insertion_civp', 'parties', 'salarie_matricule_cnss', 'Numéro d''immatriculation (assuré social) du salarié à la CNSS (donnée personnelle)', 'identifiant', 'selon_cas', null::text, array['N° CNSS', 'Matricule CNSS', 'N° assuré social']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_insertion_civp', 'parties', 'salarie_matricule_interne', 'Matricule interne du salarié chez l''employeur', 'identifiant', 'non', null::text, array['Matricule', 'Mle']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_insertion_civp', 'parties', 'salarie_date_naissance', 'Date de naissance (donnée personnelle)', 'date', 'non', null::text, array['Date de naissance', 'Né(e) le']::text[], array['تاريخ الولادة']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_insertion_civp', 'parties', 'salarie_adresse', 'Adresse du salarié (donnée personnelle)', 'adresse', 'non', null::text, array['Adresse']::text[], array['العنوان']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_insertion_civp', 'parties', 'salarie_nationalite', 'Nationalité', 'texte', 'non', 'Requis en pratique pour un salarié étranger (contrat visé)'::text, array['Nationalité']::text[], array['الجنسية']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_insertion_civp', 'parties', 'diplome', 'Diplôme et date d''obtention', 'texte', 'oui', 'Dispositif réservé aux diplômés (et demandeurs handicapés, selon presse 2019)'::text, array['Diplôme']::text[], '{}'::text[], null::text, null::text, 'Décret 542/2019 (INCERTAIN)', 'incertain'),
    ('contrat_insertion_civp', 'parties', 'inscription_demandeur_emploi', 'N° d''inscription comme demandeur d''emploi', 'identifiant', 'selon_cas', null::text, array['Inscription']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_insertion_civp', 'objet', 'type_programme', 'Programme (CIVP, autre programme d''emploi en vigueur)', 'liste', 'oui', null::text, array['CIVP', 'SIVP', 'Programme']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_insertion_civp', 'objet', 'poste_formation', 'Poste et programme de formation / tuteur', 'texte', 'oui', null::text, array['Tuteur', 'Encadrant']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_insertion_civp', 'objet', 'date_debut', 'Date de début', 'date', 'oui', null::text, array['Date de début']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_insertion_civp', 'objet', 'date_fin', 'Date de fin / durée', 'date', 'oui', null::text, array['Durée']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN : durée maximale', 'incertain'),
    ('contrat_insertion_civp', 'indemnisation', 'indemnite_etat', 'Indemnité versée par l''État/ANETI', 'montant', 'oui', null::text, array['Indemnité ANETI']::text[], '{}'::text[], null::text, null::text, 'Kapitalis 2019 : 200 DT/mois diplômés du supérieur (à dater, INCERTAIN aujourd''hui)', 'incertain'),
    ('contrat_insertion_civp', 'indemnisation', 'indemnite_complementaire_entreprise', 'Indemnité complémentaire de l''entreprise', 'montant', 'oui', 'Obligatoire pendant toute la durée selon presse 2019'::text, array['Indemnité complémentaire']::text[], '{}'::text[], null::text, null::text, 'Décret 542/2019 (INCERTAIN)', 'incertain'),
    ('contrat_insertion_civp', 'indemnisation', 'couverture_sociale', 'Couverture sociale (prise en charge, régime)', 'texte', 'selon_cas', null::text, array['Couverture sociale']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('contrat_insertion_civp', 'indemnisation', 'engagement_recrutement', 'Engagement de recrutement à l''issue', 'booleen', 'non', null::text, array['Engagement de recrutement']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('contrat_insertion_civp', 'signatures', 'signatures_trois_parties', 'Signatures entreprise, bénéficiaire, ANETI', 'booleen', 'oui', null::text, array['Signature']::text[], array['الإمضاء']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('contrat_insertion_civp', 'signatures', 'date_signature', 'Date de signature', 'date', 'oui', null::text, array['Date']::text[], array['التاريخ']::text[], null::text, null::text, 'pratique', 'pratique')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('attestation_travail', 'employeur', 'employeur_raison_sociale', 'Raison sociale ou nom de l''employeur', 'texte', 'oui', null::text, array['Employeur', 'Société', 'Raison sociale']::text[], array['المؤجر']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('attestation_travail', 'employeur', 'employeur_adresse', 'Adresse du siège ou de l''établissement', 'adresse', 'oui', null::text, array['Adresse', 'Siège social']::text[], array['العنوان']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('attestation_travail', 'employeur', 'employeur_matricule_fiscal', 'Matricule fiscal (identifiant unique) de l''employeur', 'identifiant', 'selon_cas', 'Obligatoire sur les documents à portée fiscale ; usuel ailleurs'::text, array['Matricule fiscal', 'MF', 'Identifiant unique']::text[], array['المعرف الجبائي']::text[], 'matricule_fiscal'::text, null::text, 'pratique', 'pratique'),
    ('attestation_travail', 'employeur', 'employeur_numero_cnss', 'Numéro d''affiliation employeur à la CNSS', 'identifiant', 'oui', null::text, array['N° affiliation CNSS', 'N° employeur', 'Matricule CNSS employeur']::text[], array['الصندوق الوطني للضمان الاجتماعي']::text[], null::text, null::text, 'pratique (identifiant exigé par la CNSS sur ses formulaires)', 'pratique'),
    ('attestation_travail', 'employeur', 'employeur_rne', 'Identifiant au Registre national des entreprises', 'identifiant', 'non', 'Si personne morale ou commerçant immatriculé'::text, array['RNE', 'Registre national des entreprises', 'Registre de commerce']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('attestation_travail', 'employeur', 'employeur_activite', 'Activité principale / secteur', 'texte', 'non', 'Utile pour taux AT et convention collective'::text, array['Activité', 'Secteur']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('attestation_travail', 'employeur', 'employeur_telephone_email', 'Coordonnées de contact', 'texte', 'non', null::text, array['Tél', 'E-mail']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('attestation_travail', 'employeur', 'employeur_signature_cachet', 'Signature et cachet de l''employeur', 'booleen', 'selon_cas', 'Exigé en pratique sur attestations, contrats, solde de tout compte'::text, array['Signature', 'Cachet']::text[], array['الإمضاء']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('attestation_travail', 'salarie', 'salarie_nom_prenom', 'Nom et prénom du salarié (donnée personnelle)', 'texte', 'oui', null::text, array['Nom', 'Prénom', 'Nom et prénom']::text[], array['الاسم واللقب']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('attestation_travail', 'salarie', 'salarie_cin', 'Numéro de carte d''identité nationale ou de passeport/carte de séjour (donnée personnelle, à masquer)', 'identifiant', 'selon_cas', 'CIN pour les Tunisiens ; passeport/carte de séjour pour les étrangers'::text, array['CIN', 'N° CIN', 'Passeport']::text[], array['بطاقة التعريف الوطنية']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('attestation_travail', 'salarie', 'salarie_matricule_cnss', 'Numéro d''immatriculation (assuré social) du salarié à la CNSS (donnée personnelle)', 'identifiant', 'non', null::text, array['N° CNSS', 'Matricule CNSS', 'N° assuré social']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('attestation_travail', 'salarie', 'salarie_matricule_interne', 'Matricule interne du salarié chez l''employeur', 'identifiant', 'non', null::text, array['Matricule', 'Mle']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('attestation_travail', 'salarie', 'salarie_date_naissance', 'Date de naissance (donnée personnelle)', 'date', 'non', null::text, array['Date de naissance', 'Né(e) le']::text[], array['تاريخ الولادة']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('attestation_travail', 'salarie', 'salarie_adresse', 'Adresse du salarié (donnée personnelle)', 'adresse', 'non', null::text, array['Adresse']::text[], array['العنوان']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('attestation_travail', 'salarie', 'salarie_nationalite', 'Nationalité', 'texte', 'non', 'Requis en pratique pour un salarié étranger (contrat visé)'::text, array['Nationalité']::text[], array['الجنسية']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('attestation_travail', 'contenu', 'intitule', 'Intitulé (attestation de travail / certificat de travail)', 'texte', 'oui', null::text, array['Attestation de travail', 'Certificat de travail']::text[], array['شهادة عمل']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('attestation_travail', 'contenu', 'formule_atteste', 'Formule « certifie / atteste que »', 'texte', 'oui', null::text, array['Atteste que', 'Certifie que']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('attestation_travail', 'contenu', 'emploi_poste', 'Emploi(s) occupé(s)', 'texte', 'oui', null::text, array['En qualité de', 'Fonction']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('attestation_travail', 'contenu', 'date_entree', 'Date d''entrée', 'date', 'oui', null::text, array['Depuis le', 'Du']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('attestation_travail', 'contenu', 'date_sortie', 'Date de sortie', 'date', 'selon_cas', 'Certificat de fin de contrat'::text, array['Au', 'Jusqu''au']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('attestation_travail', 'contenu', 'encore_en_fonction', 'Salarié toujours en fonction', 'booleen', 'selon_cas', 'Attestation en cours de contrat'::text, array['Est toujours en fonction', 'À ce jour']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('attestation_travail', 'contenu', 'type_contrat', 'Nature du contrat', 'liste', 'non', null::text, array['CDI', 'CDD']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('attestation_travail', 'contenu', 'libre_de_tout_engagement', 'Mention « libre de tout engagement »', 'booleen', 'non', 'Certificat de fin de contrat'::text, array['Libre de tout engagement']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('attestation_travail', 'contenu', 'objet_remise', 'Mention « délivrée pour servir et valoir ce que de droit »', 'texte', 'non', null::text, array['Pour servir et valoir ce que de droit']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('attestation_travail', 'contenu', 'lieu_date', 'Lieu et date d''établissement', 'date', 'oui', null::text, array['Fait à', 'Le']::text[], array['التاريخ']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('attestation_travail', 'contenu', 'signataire_qualite', 'Nom et qualité du signataire', 'texte', 'oui', null::text, array['Le Directeur', 'Le Gérant', 'DRH']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('attestation_salaire', 'employeur', 'employeur_raison_sociale', 'Raison sociale ou nom de l''employeur', 'texte', 'oui', null::text, array['Employeur', 'Société', 'Raison sociale']::text[], array['المؤجر']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('attestation_salaire', 'employeur', 'employeur_adresse', 'Adresse du siège ou de l''établissement', 'adresse', 'oui', null::text, array['Adresse', 'Siège social']::text[], array['العنوان']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('attestation_salaire', 'employeur', 'employeur_matricule_fiscal', 'Matricule fiscal (identifiant unique) de l''employeur', 'identifiant', 'selon_cas', 'Obligatoire sur les documents à portée fiscale ; usuel ailleurs'::text, array['Matricule fiscal', 'MF', 'Identifiant unique']::text[], array['المعرف الجبائي']::text[], 'matricule_fiscal'::text, null::text, 'pratique', 'pratique'),
    ('attestation_salaire', 'employeur', 'employeur_numero_cnss', 'Numéro d''affiliation employeur à la CNSS', 'identifiant', 'oui', null::text, array['N° affiliation CNSS', 'N° employeur', 'Matricule CNSS employeur']::text[], array['الصندوق الوطني للضمان الاجتماعي']::text[], null::text, null::text, 'pratique (identifiant exigé par la CNSS sur ses formulaires)', 'pratique'),
    ('attestation_salaire', 'employeur', 'employeur_rne', 'Identifiant au Registre national des entreprises', 'identifiant', 'non', 'Si personne morale ou commerçant immatriculé'::text, array['RNE', 'Registre national des entreprises', 'Registre de commerce']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('attestation_salaire', 'employeur', 'employeur_activite', 'Activité principale / secteur', 'texte', 'non', 'Utile pour taux AT et convention collective'::text, array['Activité', 'Secteur']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('attestation_salaire', 'employeur', 'employeur_telephone_email', 'Coordonnées de contact', 'texte', 'non', null::text, array['Tél', 'E-mail']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('attestation_salaire', 'employeur', 'employeur_signature_cachet', 'Signature et cachet de l''employeur', 'booleen', 'selon_cas', 'Exigé en pratique sur attestations, contrats, solde de tout compte'::text, array['Signature', 'Cachet']::text[], array['الإمضاء']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('attestation_salaire', 'salarie', 'salarie_nom_prenom', 'Nom et prénom du salarié (donnée personnelle)', 'texte', 'oui', null::text, array['Nom', 'Prénom', 'Nom et prénom']::text[], array['الاسم واللقب']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('attestation_salaire', 'salarie', 'salarie_cin', 'Numéro de carte d''identité nationale ou de passeport/carte de séjour (donnée personnelle, à masquer)', 'identifiant', 'selon_cas', 'CIN pour les Tunisiens ; passeport/carte de séjour pour les étrangers'::text, array['CIN', 'N° CIN', 'Passeport']::text[], array['بطاقة التعريف الوطنية']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('attestation_salaire', 'salarie', 'salarie_matricule_cnss', 'Numéro d''immatriculation (assuré social) du salarié à la CNSS (donnée personnelle)', 'identifiant', 'non', null::text, array['N° CNSS', 'Matricule CNSS', 'N° assuré social']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('attestation_salaire', 'salarie', 'salarie_matricule_interne', 'Matricule interne du salarié chez l''employeur', 'identifiant', 'non', null::text, array['Matricule', 'Mle']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('attestation_salaire', 'salarie', 'salarie_date_naissance', 'Date de naissance (donnée personnelle)', 'date', 'non', null::text, array['Date de naissance', 'Né(e) le']::text[], array['تاريخ الولادة']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('attestation_salaire', 'salarie', 'salarie_adresse', 'Adresse du salarié (donnée personnelle)', 'adresse', 'non', null::text, array['Adresse']::text[], array['العنوان']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('attestation_salaire', 'salarie', 'salarie_nationalite', 'Nationalité', 'texte', 'non', 'Requis en pratique pour un salarié étranger (contrat visé)'::text, array['Nationalité']::text[], array['الجنسية']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('attestation_salaire', 'salarie', 'emploi_poste', 'Emploi', 'texte', 'non', null::text, array['Fonction']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('attestation_salaire', 'remuneration_attestee', 'intitule', 'Intitulé', 'texte', 'oui', null::text, array['Attestation de salaire']::text[], array['شهادة في الأجر']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('attestation_salaire', 'remuneration_attestee', 'periode_reference', 'Période de référence (mois, année)', 'periode', 'oui', null::text, array['Période', 'Au titre de']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('attestation_salaire', 'remuneration_attestee', 'salaire_brut_mensuel', 'Salaire brut mensuel', 'montant', 'selon_cas', null::text, array['Salaire brut']::text[], array['الأجر الخام']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('attestation_salaire', 'remuneration_attestee', 'salaire_net_mensuel', 'Salaire net mensuel', 'montant', 'selon_cas', null::text, array['Salaire net']::text[], array['الأجر الصافي']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('attestation_salaire', 'remuneration_attestee', 'salaire_annuel', 'Rémunération annuelle', 'montant', 'non', null::text, array['Salaire annuel']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('attestation_salaire', 'remuneration_attestee', 'detail_rubriques', 'Détail des rubriques (base, primes)', 'liste', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('attestation_salaire', 'remuneration_attestee', 'domiciliation_salaire', 'Banque de domiciliation (RIB masqué)', 'texte', 'non', 'Attestation bancaire'::text, array['Domiciliation']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('attestation_salaire', 'remuneration_attestee', 'engagement_virement', 'Engagement de virement irrévocable du salaire', 'booleen', 'non', 'Dossier de crédit'::text, array['Domiciliation irrévocable']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('attestation_salaire', 'remuneration_attestee', 'lieu_date_signature', 'Lieu, date, signature, cachet', 'date', 'oui', null::text, array['Fait à', 'Le']::text[], array['التاريخ']::text[], null::text, null::text, 'pratique', 'pratique')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('certificat_affiliation_cnss', 'emetteur', 'bureau_cnss', 'Bureau régional CNSS émetteur', 'texte', 'oui', null::text, array['Bureau régional']::text[], array['الصندوق الوطني للضمان الاجتماعي']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('certificat_affiliation_cnss', 'emetteur', 'numero_document', 'Numéro du certificat', 'identifiant', 'non', null::text, array['N°']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('certificat_affiliation_cnss', 'employeur', 'employeur_numero_cnss', 'Numéro d''affiliation employeur', 'identifiant', 'oui', null::text, array['N° d''affiliation', 'N° employeur']::text[], '{}'::text[], null::text, null::text, 'Loi n° 60-30 du 14 décembre 1960 relative aux régimes de sécurité sociale, modifiée par la loi n° 2007-51 du 23 juillet 2007', 'texte'),
    ('certificat_affiliation_cnss', 'employeur', 'employeur_raison_sociale', 'Raison sociale / nom', 'texte', 'oui', null::text, array['Raison sociale']::text[], array['المؤجر']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('certificat_affiliation_cnss', 'employeur', 'employeur_adresse', 'Adresse', 'adresse', 'oui', null::text, array['Adresse']::text[], array['العنوان']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('certificat_affiliation_cnss', 'employeur', 'employeur_matricule_fiscal', 'Matricule fiscal', 'identifiant', 'non', null::text, array['Matricule fiscal']::text[], array['المعرف الجبائي']::text[], 'matricule_fiscal'::text, null::text, 'pratique', 'pratique'),
    ('certificat_affiliation_cnss', 'employeur', 'activite', 'Activité déclarée / code activité', 'texte', 'oui', null::text, array['Activité']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('certificat_affiliation_cnss', 'employeur', 'regime', 'Régime d''affiliation', 'liste', 'oui', null::text, array['Régime']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('certificat_affiliation_cnss', 'employeur', 'date_affiliation', 'Date d''affiliation / d''effet', 'date', 'oui', null::text, array['Date d''affiliation', 'Date d''effet']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('certificat_affiliation_cnss', 'employeur', 'taux_accident_travail', 'Taux accident du travail notifié', 'taux', 'non', '0,4 % à 4 % selon secteur (Cleiss 2025)'::text, array['Taux AT']::text[], '{}'::text[], null::text, null::text, 'Cleiss 2025', 'texte'),
    ('certificat_affiliation_cnss', 'employeur', 'date_cachet', 'Date, cachet et signature CNSS', 'date', 'oui', null::text, array['Cachet']::text[], array['التاريخ']::text[], null::text, null::text, 'pratique', 'pratique')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('recu_solde_tout_compte', 'parties', 'employeur_raison_sociale', 'Raison sociale ou nom de l''employeur', 'texte', 'oui', null::text, array['Employeur', 'Société', 'Raison sociale']::text[], array['المؤجر']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('recu_solde_tout_compte', 'parties', 'employeur_adresse', 'Adresse du siège ou de l''établissement', 'adresse', 'oui', null::text, array['Adresse', 'Siège social']::text[], array['العنوان']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('recu_solde_tout_compte', 'parties', 'employeur_matricule_fiscal', 'Matricule fiscal (identifiant unique) de l''employeur', 'identifiant', 'selon_cas', 'Obligatoire sur les documents à portée fiscale ; usuel ailleurs'::text, array['Matricule fiscal', 'MF', 'Identifiant unique']::text[], array['المعرف الجبائي']::text[], 'matricule_fiscal'::text, null::text, 'pratique', 'pratique'),
    ('recu_solde_tout_compte', 'parties', 'employeur_numero_cnss', 'Numéro d''affiliation employeur à la CNSS', 'identifiant', 'oui', null::text, array['N° affiliation CNSS', 'N° employeur', 'Matricule CNSS employeur']::text[], array['الصندوق الوطني للضمان الاجتماعي']::text[], null::text, null::text, 'pratique (identifiant exigé par la CNSS sur ses formulaires)', 'pratique'),
    ('recu_solde_tout_compte', 'parties', 'employeur_rne', 'Identifiant au Registre national des entreprises', 'identifiant', 'non', 'Si personne morale ou commerçant immatriculé'::text, array['RNE', 'Registre national des entreprises', 'Registre de commerce']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('recu_solde_tout_compte', 'parties', 'employeur_activite', 'Activité principale / secteur', 'texte', 'non', 'Utile pour taux AT et convention collective'::text, array['Activité', 'Secteur']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('recu_solde_tout_compte', 'parties', 'employeur_telephone_email', 'Coordonnées de contact', 'texte', 'non', null::text, array['Tél', 'E-mail']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('recu_solde_tout_compte', 'parties', 'employeur_signature_cachet', 'Signature et cachet de l''employeur', 'booleen', 'selon_cas', 'Exigé en pratique sur attestations, contrats, solde de tout compte'::text, array['Signature', 'Cachet']::text[], array['الإمضاء']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('recu_solde_tout_compte', 'parties', 'salarie_nom_prenom', 'Nom et prénom du salarié (donnée personnelle)', 'texte', 'oui', null::text, array['Nom', 'Prénom', 'Nom et prénom']::text[], array['الاسم واللقب']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('recu_solde_tout_compte', 'parties', 'salarie_cin', 'Numéro de carte d''identité nationale ou de passeport/carte de séjour (donnée personnelle, à masquer)', 'identifiant', 'selon_cas', 'CIN pour les Tunisiens ; passeport/carte de séjour pour les étrangers'::text, array['CIN', 'N° CIN', 'Passeport']::text[], array['بطاقة التعريف الوطنية']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('recu_solde_tout_compte', 'parties', 'salarie_matricule_cnss', 'Numéro d''immatriculation (assuré social) du salarié à la CNSS (donnée personnelle)', 'identifiant', 'non', null::text, array['N° CNSS', 'Matricule CNSS', 'N° assuré social']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('recu_solde_tout_compte', 'parties', 'salarie_matricule_interne', 'Matricule interne du salarié chez l''employeur', 'identifiant', 'non', null::text, array['Matricule', 'Mle']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('recu_solde_tout_compte', 'parties', 'salarie_date_naissance', 'Date de naissance (donnée personnelle)', 'date', 'non', null::text, array['Date de naissance', 'Né(e) le']::text[], array['تاريخ الولادة']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('recu_solde_tout_compte', 'parties', 'salarie_adresse', 'Adresse du salarié (donnée personnelle)', 'adresse', 'non', null::text, array['Adresse']::text[], array['العنوان']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('recu_solde_tout_compte', 'parties', 'salarie_nationalite', 'Nationalité', 'texte', 'non', 'Requis en pratique pour un salarié étranger (contrat visé)'::text, array['Nationalité']::text[], array['الجنسية']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('recu_solde_tout_compte', 'rupture', 'intitule', 'Intitulé', 'texte', 'oui', null::text, array['Reçu pour solde de tout compte', 'Solde de tout compte']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('recu_solde_tout_compte', 'rupture', 'date_entree', 'Date d''entrée', 'date', 'non', null::text, array['Date d''entrée']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('recu_solde_tout_compte', 'rupture', 'date_sortie', 'Date de sortie / fin de contrat', 'date', 'oui', null::text, array['Date de sortie']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('recu_solde_tout_compte', 'rupture', 'motif_rupture', 'Motif (démission, fin de CDD, licenciement, retraite, accord)', 'liste', 'non', null::text, array['Motif']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('recu_solde_tout_compte', 'decompte', 'salaire_dernier_mois', 'Salaire du dernier mois / prorata', 'montant', 'selon_cas', null::text, array['Salaire', 'Prorata']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('recu_solde_tout_compte', 'decompte', 'indemnite_conges', 'Indemnité compensatrice de congés payés', 'montant', 'selon_cas', null::text, array['Indemnité de congé']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('recu_solde_tout_compte', 'decompte', 'indemnite_preavis', 'Indemnité de préavis', 'montant', 'selon_cas', null::text, array['Préavis']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN : Code du travail / convention', 'incertain'),
    ('recu_solde_tout_compte', 'decompte', 'indemnite_licenciement', 'Indemnité de licenciement', 'montant', 'selon_cas', 'Licenciement'::text, array['Indemnité de licenciement']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN : Code du travail / convention', 'incertain'),
    ('recu_solde_tout_compte', 'decompte', 'dommages_interets', 'Dommages-intérêts / indemnité transactionnelle', 'montant', 'selon_cas', null::text, array['Dommages-intérêts', 'Transaction']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('recu_solde_tout_compte', 'decompte', 'prime_prorata', 'Primes au prorata (13e mois, rendement…)', 'montant', 'selon_cas', null::text, array['Prorata prime']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('recu_solde_tout_compte', 'decompte', 'retenues', 'Retenues (CNSS, IRPP, avances non remboursées)', 'montant', 'selon_cas', null::text, array['Retenues']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('recu_solde_tout_compte', 'decompte', 'montant_total', 'Montant total versé (net)', 'montant', 'oui', null::text, array['Total', 'Net']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('recu_solde_tout_compte', 'decompte', 'montant_lettres', 'Montant en toutes lettres', 'texte', 'non', null::text, array['La somme de']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('recu_solde_tout_compte', 'decompte', 'mode_paiement', 'Mode de paiement et référence', 'liste', 'oui', null::text, array['Par chèque', 'Par virement']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('recu_solde_tout_compte', 'validation', 'formule_solde', 'Formule « pour solde de tout compte »', 'texte', 'oui', null::text, array['Pour solde de tout compte']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('recu_solde_tout_compte', 'validation', 'mention_manuscrite', 'Mention manuscrite du salarié', 'texte', 'non', null::text, array['Lu et approuvé']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('recu_solde_tout_compte', 'validation', 'date_signature', 'Date de signature', 'date', 'oui', 'Point de départ du délai de dénonciation éventuel'::text, array['Le']::text[], array['التاريخ']::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('recu_solde_tout_compte', 'validation', 'signature_salarie', 'Signature du salarié', 'booleen', 'oui', null::text, array['Signature']::text[], array['الإمضاء']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('recu_solde_tout_compte', 'validation', 'exemplaires', 'Nombre d''exemplaires', 'nombre', 'non', null::text, array['En double exemplaire']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('registre_personnel', 'employeur', 'employeur_raison_sociale', 'Raison sociale ou nom de l''employeur', 'texte', 'oui', null::text, array['Employeur', 'Société', 'Raison sociale']::text[], array['المؤجر']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('registre_personnel', 'employeur', 'employeur_adresse', 'Adresse du siège ou de l''établissement', 'adresse', 'oui', null::text, array['Adresse', 'Siège social']::text[], array['العنوان']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('registre_personnel', 'employeur', 'employeur_matricule_fiscal', 'Matricule fiscal (identifiant unique) de l''employeur', 'identifiant', 'selon_cas', 'Obligatoire sur les documents à portée fiscale ; usuel ailleurs'::text, array['Matricule fiscal', 'MF', 'Identifiant unique']::text[], array['المعرف الجبائي']::text[], 'matricule_fiscal'::text, null::text, 'pratique', 'pratique'),
    ('registre_personnel', 'employeur', 'employeur_numero_cnss', 'Numéro d''affiliation employeur à la CNSS', 'identifiant', 'oui', null::text, array['N° affiliation CNSS', 'N° employeur', 'Matricule CNSS employeur']::text[], array['الصندوق الوطني للضمان الاجتماعي']::text[], null::text, null::text, 'pratique (identifiant exigé par la CNSS sur ses formulaires)', 'pratique'),
    ('registre_personnel', 'employeur', 'employeur_rne', 'Identifiant au Registre national des entreprises', 'identifiant', 'non', 'Si personne morale ou commerçant immatriculé'::text, array['RNE', 'Registre national des entreprises', 'Registre de commerce']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('registre_personnel', 'employeur', 'employeur_activite', 'Activité principale / secteur', 'texte', 'non', 'Utile pour taux AT et convention collective'::text, array['Activité', 'Secteur']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('registre_personnel', 'employeur', 'employeur_telephone_email', 'Coordonnées de contact', 'texte', 'non', null::text, array['Tél', 'E-mail']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('registre_personnel', 'employeur', 'employeur_signature_cachet', 'Signature et cachet de l''employeur', 'booleen', 'selon_cas', 'Exigé en pratique sur attestations, contrats, solde de tout compte'::text, array['Signature', 'Cachet']::text[], array['الإمضاء']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('registre_personnel', 'etat', 'date_arrete', 'Date d''arrêté de l''état', 'date', 'oui', null::text, array['Arrêté au']::text[], array['التاريخ']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('registre_personnel', 'etat', 'effectif_total', 'Effectif total', 'nombre', 'selon_cas', null::text, array['Effectif']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('registre_personnel', 'ligne_salarie', 'numero_ordre', 'Numéro d''ordre d''inscription', 'nombre', 'selon_cas', null::text, array['N° d''ordre']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN : Code du travail, article non lu (vérifier sur legislation.tn, Code du travail consolidé)', 'incertain'),
    ('registre_personnel', 'ligne_salarie', 'nom_prenom', 'Nom et prénom (donnée personnelle)', 'texte', 'oui', null::text, array['Nom et prénom']::text[], array['الاسم واللقب']::text[], null::text, null::text, 'INCERTAIN : Code du travail, article non lu (vérifier sur legislation.tn, Code du travail consolidé)', 'incertain'),
    ('registre_personnel', 'ligne_salarie', 'cin', 'N° CIN / pièce d''identité (donnée personnelle)', 'identifiant', 'selon_cas', null::text, array['CIN']::text[], array['بطاقة التعريف الوطنية']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('registre_personnel', 'ligne_salarie', 'matricule_cnss', 'Matricule CNSS (donnée personnelle)', 'identifiant', 'selon_cas', null::text, array['N° CNSS']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('registre_personnel', 'ligne_salarie', 'date_naissance', 'Date de naissance', 'date', 'selon_cas', null::text, array['Date de naissance']::text[], array['تاريخ الولادة']::text[], null::text, null::text, 'INCERTAIN : Code du travail, article non lu (vérifier sur legislation.tn, Code du travail consolidé)', 'incertain'),
    ('registre_personnel', 'ligne_salarie', 'sexe', 'Sexe', 'liste', 'non', null::text, array['Sexe']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('registre_personnel', 'ligne_salarie', 'nationalite', 'Nationalité', 'texte', 'selon_cas', null::text, array['Nationalité']::text[], array['الجنسية']::text[], null::text, null::text, 'INCERTAIN : Code du travail, article non lu (vérifier sur legislation.tn, Code du travail consolidé)', 'incertain'),
    ('registre_personnel', 'ligne_salarie', 'emploi', 'Emploi / qualification', 'texte', 'oui', null::text, array['Emploi']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN : Code du travail, article non lu (vérifier sur legislation.tn, Code du travail consolidé)', 'incertain'),
    ('registre_personnel', 'ligne_salarie', 'categorie', 'Catégorie', 'texte', 'non', null::text, array['Catégorie']::text[], array['الصنف']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('registre_personnel', 'ligne_salarie', 'type_contrat', 'Type de contrat', 'liste', 'selon_cas', null::text, array['Contrat']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('registre_personnel', 'ligne_salarie', 'date_entree', 'Date d''entrée', 'date', 'oui', null::text, array['Date d''entrée']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN : Code du travail, article non lu (vérifier sur legislation.tn, Code du travail consolidé)', 'incertain'),
    ('registre_personnel', 'ligne_salarie', 'date_sortie', 'Date de sortie', 'date', 'selon_cas', 'Salarié sorti'::text, array['Date de sortie']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN : Code du travail, article non lu (vérifier sur legislation.tn, Code du travail consolidé)', 'incertain'),
    ('registre_personnel', 'ligne_salarie', 'salaire_base', 'Salaire de base', 'montant', 'non', null::text, array['Salaire']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('registre_personnel', 'ligne_salarie', 'conges', 'Congés pris', 'texte', 'non', null::text, array['Congés']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('releve_bancaire', 'En-tête banque', 'banque_nom', 'Raison sociale de la banque (ou La Poste Tunisienne pour un CCP)', 'texte', 'oui', null::text, array['Banque', 'Agence']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('releve_bancaire', 'En-tête banque', 'banque_code', 'Code banque (2 premiers chiffres du RIB)', 'identifiant', 'selon_cas', 'Déductible du RIB s''il est imprimé'::text, array['Code banque']::text[], '{}'::text[], null::text, null::text, 'Pratique bancaire tunisienne documentée par source secondaire (Rabobank, page Tunisie, lue le 2026-10-30) : RIB 20 chiffres = code banque 2 + code agence 3 + numéro de compte 13 + clé 2 ; IBAN TN 24 caractères. Texte BCT/ATPBEF de référence non lu : INCERTAIN quant au texte normatif.', 'incertain'),
    ('releve_bancaire', 'En-tête banque', 'banque_agence_nom', 'Nom de l''agence teneuse de compte', 'texte', 'non', null::text, array['Agence']::text[], array['الفرع', 'الوكالة']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('releve_bancaire', 'En-tête banque', 'banque_agence_code', 'Code agence (positions 3 à 5 du RIB)', 'identifiant', 'selon_cas', null::text, array['Code agence', 'Guichet']::text[], '{}'::text[], null::text, null::text, 'Pratique bancaire tunisienne documentée par source secondaire (Rabobank, page Tunisie, lue le 2026-10-30) : RIB 20 chiffres = code banque 2 + code agence 3 + numéro de compte 13 + clé 2 ; IBAN TN 24 caractères. Texte BCT/ATPBEF de référence non lu : INCERTAIN quant au texte normatif.', 'incertain'),
    ('releve_bancaire', 'En-tête banque', 'banque_agence_adresse', 'Adresse de l''agence', 'adresse', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('releve_bancaire', 'En-tête banque', 'banque_agence_telephone', 'Téléphone / contact agence ou chargé de clientèle', 'texte', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('releve_bancaire', 'En-tête banque', 'banque_bic', 'Code BIC / SWIFT', 'identifiant', 'non', null::text, array['BIC', 'SWIFT']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('releve_bancaire', 'En-tête banque', 'banque_matricule_fiscal', 'Matricule fiscal de la banque', 'identifiant', 'selon_cas', null::text, array['Matricule fiscal', 'MF']::text[], '{}'::text[], 'matricule_fiscal'::text, null::text, 'pratique ; INCERTAIN pour un relevé (attendu surtout lorsque le document vaut facture de commissions avec TVA)', 'incertain'),
    ('releve_bancaire', 'Compte et titulaire', 'compte_rib', 'RIB 20 chiffres', 'identifiant', 'selon_cas', 'Quasi systématique sur les relevés et formules normalisées ; texte imposant l''impression INCERTAIN'::text, array['RIB', 'Relevé d''identité bancaire']::text[], '{}'::text[], null::text, null::text, 'Pratique bancaire tunisienne documentée par source secondaire (Rabobank, page Tunisie, lue le 2026-10-30) : RIB 20 chiffres = code banque 2 + code agence 3 + numéro de compte 13 + clé 2 ; IBAN TN 24 caractères. Texte BCT/ATPBEF de référence non lu : INCERTAIN quant au texte normatif.', 'incertain'),
    ('releve_bancaire', 'Compte et titulaire', 'compte_numero', 'Numéro de compte (13 chiffres internes au RIB)', 'identifiant', 'oui', null::text, array['N° de compte', 'Compte n°']::text[], array['رقم الحساب']::text[], null::text, null::text, 'Pratique bancaire tunisienne documentée par source secondaire (Rabobank, page Tunisie, lue le 2026-10-30) : RIB 20 chiffres = code banque 2 + code agence 3 + numéro de compte 13 + clé 2 ; IBAN TN 24 caractères. Texte BCT/ATPBEF de référence non lu : INCERTAIN quant au texte normatif.', 'incertain'),
    ('releve_bancaire', 'Compte et titulaire', 'compte_cle_rib', 'Clé RIB (2 derniers chiffres)', 'identifiant', 'selon_cas', null::text, array['Clé']::text[], '{}'::text[], null::text, null::text, 'Pratique bancaire tunisienne documentée par source secondaire (Rabobank, page Tunisie, lue le 2026-10-30) : RIB 20 chiffres = code banque 2 + code agence 3 + numéro de compte 13 + clé 2 ; IBAN TN 24 caractères. Texte BCT/ATPBEF de référence non lu : INCERTAIN quant au texte normatif.', 'incertain'),
    ('releve_bancaire', 'Compte et titulaire', 'compte_iban', 'IBAN (TN + 2 chiffres de contrôle + RIB)', 'identifiant', 'non', null::text, array['IBAN']::text[], '{}'::text[], null::text, null::text, 'Rabobank (24 caractères) ; CDQ (préfixe TN, cite ISO 13616) — pratique', 'pratique'),
    ('releve_bancaire', 'Compte et titulaire', 'compte_devise', 'Devise du compte (TND par défaut ; compte en devises ou en dinars convertibles possible)', 'liste', 'oui', null::text, array['Devise', 'Monnaie']::text[], array['العملة']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('releve_bancaire', 'Compte et titulaire', 'compte_type', 'Nature du compte (courant, chèque, épargne, devises, dinars convertibles, CCP)', 'liste', 'non', null::text, array['Compte courant', 'Compte chèque', 'CCP']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('releve_bancaire', 'Compte et titulaire', 'compte_titulaire_nom', 'Nom ou raison sociale du titulaire', 'texte', 'oui', null::text, array['Titulaire', 'Client']::text[], array['صاحب الحساب']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('releve_bancaire', 'Compte et titulaire', 'compte_titulaire_adresse', 'Adresse postale du titulaire', 'adresse', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('releve_bancaire', 'Compte et titulaire', 'compte_titulaire_id_client', 'Identifiant / code client interne banque', 'identifiant', 'non', null::text, array['Code client', 'Réf. client']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('releve_bancaire', 'Compte et titulaire', 'compte_titulaire_matricule_fiscal', 'Matricule fiscal du titulaire (entreprise)', 'identifiant', 'non', null::text, array['MF', 'Matricule fiscal']::text[], '{}'::text[], 'matricule_fiscal'::text, null::text, 'pratique', 'pratique'),
    ('releve_bancaire', 'Identification du relevé', 'releve_numero', 'Numéro d''ordre du relevé / extrait', 'identifiant', 'non', null::text, array['Relevé n°', 'Extrait n°']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('releve_bancaire', 'Identification du relevé', 'releve_page', 'Pagination (page x / y)', 'texte', 'non', null::text, array['Page']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('releve_bancaire', 'Identification du relevé', 'periode_debut', 'Date de début de période', 'date', 'oui', null::text, array['Du', 'Période du']::text[], array['من']::text[], null::text, null::text, 'pratique (un relevé sans période ne prouve rien)', 'pratique'),
    ('releve_bancaire', 'Identification du relevé', 'periode_fin', 'Date de fin de période (date d''arrêté)', 'date', 'oui', null::text, array['Au', 'Arrêté au']::text[], array['إلى']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('releve_bancaire', 'Identification du relevé', 'date_edition', 'Date d''édition / d''impression', 'date', 'non', null::text, array['Édité le', 'Date d''édition']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('releve_bancaire', 'Identification du relevé', 'canal', 'Support (papier, PDF banque en ligne, export CSV/MT940/CFONB-like)', 'liste', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('releve_bancaire', 'Soldes (absents de la table Malica actuelle — à créer)', 'solde_initial', 'Solde au début de période (ancien solde / solde reporté)', 'montant', 'oui', null::text, array['Solde précédent', 'Ancien solde', 'Solde au', 'Solde reporté', 'Solde initial']::text[], array['الرصيد السابق']::text[], null::text, null::text, 'pratique universelle ; condition de la preuve arithmétique du relevé', 'pratique'),
    ('releve_bancaire', 'Soldes (absents de la table Malica actuelle — à créer)', 'solde_initial_sens', 'Sens du solde initial (créditeur / débiteur)', 'liste', 'oui', null::text, array['Créditeur', 'Débiteur', 'CR', 'DB', 'signe -']::text[], array['دائن', 'مدين']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('releve_bancaire', 'Soldes (absents de la table Malica actuelle — à créer)', 'solde_initial_date', 'Date à laquelle le solde initial est arrêté', 'date', 'oui', null::text, array['Solde au']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('releve_bancaire', 'Soldes (absents de la table Malica actuelle — à créer)', 'solde_final', 'Solde à la fin de période (nouveau solde)', 'montant', 'oui', null::text, array['Nouveau solde', 'Solde final', 'Solde au', 'Solde créditeur/débiteur au']::text[], array['الرصيد الجديد']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('releve_bancaire', 'Soldes (absents de la table Malica actuelle — à créer)', 'solde_final_sens', 'Sens du solde final', 'liste', 'oui', null::text, array['Créditeur', 'Débiteur']::text[], array['دائن', 'مدين']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('releve_bancaire', 'Soldes (absents de la table Malica actuelle — à créer)', 'solde_final_date', 'Date d''arrêté du solde final', 'date', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('releve_bancaire', 'Soldes (absents de la table Malica actuelle — à créer)', 'total_debits', 'Total des mouvements débiteurs de la période', 'montant', 'selon_cas', 'Imprimé sur la plupart des relevés ; sinon à calculer'::text, array['Total débit', 'Total mouvements débit']::text[], array['مجموع المدين']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('releve_bancaire', 'Soldes (absents de la table Malica actuelle — à créer)', 'total_credits', 'Total des mouvements créditeurs de la période', 'montant', 'selon_cas', null::text, array['Total crédit']::text[], array['مجموع الدائن']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('releve_bancaire', 'Soldes (absents de la table Malica actuelle — à créer)', 'nombre_operations', 'Nombre d''opérations', 'nombre', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('releve_bancaire', 'Soldes (absents de la table Malica actuelle — à créer)', 'solde_intermediaire', 'Soldes intermédiaires (solde progressif ligne à ligne, report de page, solde de fin de page)', 'montant', 'non', 'Présent sur les relevés à solde progressif ; un report en bas de page doit égaler le report en haut de page suivante'::text, array['Solde', 'À reporter', 'Report']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('releve_bancaire', 'Soldes (absents de la table Malica actuelle — à créer)', 'solde_en_valeur', 'Solde en date de valeur (base de calcul des agios)', 'montant', 'non', null::text, array['Solde en valeur']::text[], array['الرصيد حسب تاريخ القيمة']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('releve_bancaire', 'Soldes (absents de la table Malica actuelle — à créer)', 'solde_disponible', 'Solde disponible (solde comptable ± opérations en cours / autorisation)', 'montant', 'non', null::text, array['Solde disponible']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('releve_bancaire', 'Soldes (absents de la table Malica actuelle — à créer)', 'autorisation_decouvert', 'Montant de l''autorisation de découvert / facilité de caisse', 'montant', 'non', null::text, array['Autorisation', 'Découvert autorisé']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('releve_bancaire', 'Soldes (absents de la table Malica actuelle — à créer)', 'solde_en_lettres', 'Solde en toutes lettres', 'texte', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('releve_bancaire', 'Lignes d''opérations (une par mouvement)', 'ligne_date_operation', 'Date d''opération (date de comptabilisation par la banque)', 'date', 'oui', null::text, array['Date', 'Date opé.', 'Date compta']::text[], array['تاريخ العملية']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('releve_bancaire', 'Lignes d''opérations (une par mouvement)', 'ligne_date_valeur', 'Date de valeur (date à partir de laquelle le mouvement porte intérêt / agios)', 'date', 'selon_cas', 'Présente sur la plupart des relevés tunisiens ; indispensable pour vérifier les agios'::text, array['Valeur', 'Date valeur', 'Val.']::text[], array['تاريخ القيمة']::text[], null::text, null::text, 'pratique ; règles de jours de valeur INCERTAIN (texte BCT non lu)', 'incertain'),
    ('releve_bancaire', 'Lignes d''opérations (une par mouvement)', 'ligne_libelle', 'Libellé de l''opération', 'texte', 'oui', null::text, array['Libellé', 'Désignation', 'Nature de l''opération']::text[], array['البيان']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('releve_bancaire', 'Lignes d''opérations (une par mouvement)', 'ligne_libelle_complementaire', 'Libellé complémentaire (nom contrepartie, motif virement, n° facture)', 'texte', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('releve_bancaire', 'Lignes d''opérations (une par mouvement)', 'ligne_reference', 'Référence de l''opération (n° pièce, n° chèque, n° effet, réf. virement)', 'identifiant', 'non', null::text, array['Réf.', 'Référence', 'N° pièce']::text[], array['المرجع']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('releve_bancaire', 'Lignes d''opérations (une par mouvement)', 'ligne_numero_cheque', 'Numéro du chèque (opérations chèque)', 'identifiant', 'selon_cas', 'Opérations sur chèque émis ou remis'::text, array['Chq', 'CHQ N°', 'Chèque n°']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('releve_bancaire', 'Lignes d''opérations (une par mouvement)', 'ligne_code_operation', 'Code opération / famille (VIR, PRLV, CHQ, EFF, CB, COM, AGIOS, TVA, RS)', 'liste', 'non', null::text, array['Code opé.']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('releve_bancaire', 'Lignes d''opérations (une par mouvement)', 'ligne_debit', 'Montant au débit', 'montant', 'selon_cas', 'Exclusif de ligne_credit'::text, array['Débit', 'DB']::text[], array['مدين']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('releve_bancaire', 'Lignes d''opérations (une par mouvement)', 'ligne_credit', 'Montant au crédit', 'montant', 'selon_cas', 'Exclusif de ligne_debit'::text, array['Crédit', 'CR']::text[], array['دائن']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('releve_bancaire', 'Lignes d''opérations (une par mouvement)', 'ligne_sens', 'Sens dérivé (débit/crédit) — à stocker explicitement, ne pas dépendre du signe', 'liste', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('releve_bancaire', 'Lignes d''opérations (une par mouvement)', 'ligne_solde_apres', 'Solde progressif après l''opération', 'montant', 'non', null::text, array['Solde']::text[], array['الرصيد']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('releve_bancaire', 'Lignes d''opérations (une par mouvement)', 'ligne_devise_origine', 'Devise et montant d''origine (opération en devises)', 'montant', 'selon_cas', 'Opérations internationales'::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('releve_bancaire', 'Lignes d''opérations (une par mouvement)', 'ligne_cours_change', 'Cours de change appliqué', 'taux', 'selon_cas', null::text, array['Cours']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('releve_bancaire', 'Lignes d''opérations (une par mouvement)', 'ligne_contrepartie_rib', 'RIB / nom de la contrepartie (virement, prélèvement)', 'identifiant', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('releve_bancaire', 'Lignes d''opérations (une par mouvement)', 'ligne_lien_piece', 'Lien vers la pièce justificative (avis, chèque, traite, ticket TPE, facture)', 'identifiant', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'Malica (relation à créer)', 'texte'),
    ('releve_bancaire', 'Arrêté d''intérêts, frais et taxes', 'arrete_periode', 'Période d''arrêté des intérêts débiteurs (souvent trimestrielle)', 'periode', 'selon_cas', null::text, array['Arrêté de compte', 'Échelle d''intérêts']::text[], '{}'::text[], null::text, null::text, 'pratique ; périodicité réglementaire INCERTAIN', 'incertain'),
    ('releve_bancaire', 'Arrêté d''intérêts, frais et taxes', 'interets_debiteurs', 'Intérêts / agios débiteurs', 'montant', 'selon_cas', null::text, array['Agios', 'Intérêts débiteurs']::text[], array['الفوائد المدينة']::text[], null::text, null::text, 'pratique ; plafond : loi n°99-64 (taux excessifs), seuils publiés par arrêté semestriel', 'pratique'),
    ('releve_bancaire', 'Arrêté d''intérêts, frais et taxes', 'taux_debiteur', 'Taux débiteur appliqué et/ou TEG', 'taux', 'selon_cas', null::text, array['TEG', 'Taux']::text[], '{}'::text[], null::text, null::text, 'loi n°99-64 et décret n°2000-462 (TEG) — articles INCERTAIN', 'incertain'),
    ('releve_bancaire', 'Arrêté d''intérêts, frais et taxes', 'nombres_debiteurs', 'Nombres débiteurs (échelle : solde en valeur × jours)', 'nombre', 'non', null::text, array['Nombres']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('releve_bancaire', 'Arrêté d''intérêts, frais et taxes', 'commission_plus_fort_decouvert', 'Commission sur le plus fort découvert / de mouvement / de tenue de compte', 'montant', 'non', null::text, array['CPFD', 'Frais de tenue de compte']::text[], '{}'::text[], null::text, null::text, 'pratique ; tarification encadrée par circulaire BCT 2024-2 (détail non lu)', 'pratique'),
    ('releve_bancaire', 'Arrêté d''intérêts, frais et taxes', 'tva_sur_commissions', 'TVA sur commissions bancaires', 'montant', 'selon_cas', null::text, array['TVA']::text[], array['الأداء على القيمة المضافة']::text[], null::text, null::text, 'pratique ; taux non vérifié ici : INCERTAIN', 'incertain'),
    ('releve_bancaire', 'Arrêté d''intérêts, frais et taxes', 'interets_crediteurs', 'Intérêts créditeurs (comptes rémunérés)', 'montant', 'selon_cas', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('releve_bancaire', 'Arrêté d''intérêts, frais et taxes', 'retenue_source_interets', 'Retenue à la source sur intérêts créditeurs', 'montant', 'selon_cas', null::text, array['RS', 'Retenue à la source']::text[], '{}'::text[], null::text, null::text, 'pratique ; taux et article du Code IRPP/IS : INCERTAIN', 'incertain'),
    ('releve_bancaire', 'Arrêté d''intérêts, frais et taxes', 'recap_annuel_commissions', 'Récapitulatif annuel des commissions prélevées', 'montant', 'selon_cas', 'Document annuel distinct ou encart du relevé de fin d''année'::text, '{}'::text[], '{}'::text[], null::text, null::text, 'Circulaire BCT n°2024-2 (selon synthèse de presse) ; article INCERTAIN', 'incertain'),
    ('releve_bancaire', 'Mentions de pied', 'mention_reclamation', 'Délai de réclamation / approbation tacite du relevé', 'texte', 'non', null::text, array['Sauf erreur ou omission', 'Réclamation sous']::text[], '{}'::text[], null::text, null::text, 'pratique ; délai légal tunisien INCERTAIN', 'incertain'),
    ('releve_bancaire', 'Mentions de pied', 'mention_sbf', 'Mention « sauf bonne fin » (crédits sous réserve d''encaissement)', 'texte', 'non', null::text, array['SBF', 'Sauf bonne fin']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('releve_bancaire', 'Mentions de pied', 'mentions_legales_banque', 'Capital, RC/RNE, agrément, siège', 'texte', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('avis_debit', 'En-tête banque', 'banque_nom', 'Raison sociale de la banque (ou La Poste Tunisienne pour un CCP)', 'texte', 'oui', null::text, array['Banque', 'Agence']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avis_debit', 'En-tête banque', 'banque_code', 'Code banque (2 premiers chiffres du RIB)', 'identifiant', 'selon_cas', 'Déductible du RIB s''il est imprimé'::text, array['Code banque']::text[], '{}'::text[], null::text, null::text, 'Pratique bancaire tunisienne documentée par source secondaire (Rabobank, page Tunisie, lue le 2026-10-30) : RIB 20 chiffres = code banque 2 + code agence 3 + numéro de compte 13 + clé 2 ; IBAN TN 24 caractères. Texte BCT/ATPBEF de référence non lu : INCERTAIN quant au texte normatif.', 'incertain'),
    ('avis_debit', 'En-tête banque', 'banque_agence_nom', 'Nom de l''agence teneuse de compte', 'texte', 'non', null::text, array['Agence']::text[], array['الفرع', 'الوكالة']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avis_debit', 'En-tête banque', 'banque_agence_code', 'Code agence (positions 3 à 5 du RIB)', 'identifiant', 'selon_cas', null::text, array['Code agence', 'Guichet']::text[], '{}'::text[], null::text, null::text, 'Pratique bancaire tunisienne documentée par source secondaire (Rabobank, page Tunisie, lue le 2026-10-30) : RIB 20 chiffres = code banque 2 + code agence 3 + numéro de compte 13 + clé 2 ; IBAN TN 24 caractères. Texte BCT/ATPBEF de référence non lu : INCERTAIN quant au texte normatif.', 'incertain'),
    ('avis_debit', 'En-tête banque', 'banque_agence_adresse', 'Adresse de l''agence', 'adresse', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avis_debit', 'En-tête banque', 'banque_agence_telephone', 'Téléphone / contact agence ou chargé de clientèle', 'texte', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avis_debit', 'En-tête banque', 'banque_bic', 'Code BIC / SWIFT', 'identifiant', 'non', null::text, array['BIC', 'SWIFT']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avis_debit', 'En-tête banque', 'banque_matricule_fiscal', 'Matricule fiscal de la banque', 'identifiant', 'selon_cas', null::text, array['Matricule fiscal', 'MF']::text[], '{}'::text[], 'matricule_fiscal'::text, null::text, 'pratique ; INCERTAIN pour un relevé (attendu surtout lorsque le document vaut facture de commissions avec TVA)', 'incertain'),
    ('avis_debit', 'Compte et titulaire', 'compte_rib', 'RIB 20 chiffres', 'identifiant', 'selon_cas', 'Quasi systématique sur les relevés et formules normalisées ; texte imposant l''impression INCERTAIN'::text, array['RIB', 'Relevé d''identité bancaire']::text[], '{}'::text[], null::text, null::text, 'Pratique bancaire tunisienne documentée par source secondaire (Rabobank, page Tunisie, lue le 2026-10-30) : RIB 20 chiffres = code banque 2 + code agence 3 + numéro de compte 13 + clé 2 ; IBAN TN 24 caractères. Texte BCT/ATPBEF de référence non lu : INCERTAIN quant au texte normatif.', 'incertain'),
    ('avis_debit', 'Compte et titulaire', 'compte_numero', 'Numéro de compte (13 chiffres internes au RIB)', 'identifiant', 'oui', null::text, array['N° de compte', 'Compte n°']::text[], array['رقم الحساب']::text[], null::text, null::text, 'Pratique bancaire tunisienne documentée par source secondaire (Rabobank, page Tunisie, lue le 2026-10-30) : RIB 20 chiffres = code banque 2 + code agence 3 + numéro de compte 13 + clé 2 ; IBAN TN 24 caractères. Texte BCT/ATPBEF de référence non lu : INCERTAIN quant au texte normatif.', 'incertain'),
    ('avis_debit', 'Compte et titulaire', 'compte_cle_rib', 'Clé RIB (2 derniers chiffres)', 'identifiant', 'selon_cas', null::text, array['Clé']::text[], '{}'::text[], null::text, null::text, 'Pratique bancaire tunisienne documentée par source secondaire (Rabobank, page Tunisie, lue le 2026-10-30) : RIB 20 chiffres = code banque 2 + code agence 3 + numéro de compte 13 + clé 2 ; IBAN TN 24 caractères. Texte BCT/ATPBEF de référence non lu : INCERTAIN quant au texte normatif.', 'incertain'),
    ('avis_debit', 'Compte et titulaire', 'compte_iban', 'IBAN (TN + 2 chiffres de contrôle + RIB)', 'identifiant', 'non', null::text, array['IBAN']::text[], '{}'::text[], null::text, null::text, 'Rabobank (24 caractères) ; CDQ (préfixe TN, cite ISO 13616) — pratique', 'pratique'),
    ('avis_debit', 'Compte et titulaire', 'compte_devise', 'Devise du compte (TND par défaut ; compte en devises ou en dinars convertibles possible)', 'liste', 'oui', null::text, array['Devise', 'Monnaie']::text[], array['العملة']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avis_debit', 'Compte et titulaire', 'compte_type', 'Nature du compte (courant, chèque, épargne, devises, dinars convertibles, CCP)', 'liste', 'non', null::text, array['Compte courant', 'Compte chèque', 'CCP']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avis_debit', 'Compte et titulaire', 'compte_titulaire_nom', 'Nom ou raison sociale du titulaire', 'texte', 'oui', null::text, array['Titulaire', 'Client']::text[], array['صاحب الحساب']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avis_debit', 'Compte et titulaire', 'compte_titulaire_adresse', 'Adresse postale du titulaire', 'adresse', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avis_debit', 'Compte et titulaire', 'compte_titulaire_id_client', 'Identifiant / code client interne banque', 'identifiant', 'non', null::text, array['Code client', 'Réf. client']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avis_debit', 'Compte et titulaire', 'compte_titulaire_matricule_fiscal', 'Matricule fiscal du titulaire (entreprise)', 'identifiant', 'non', null::text, array['MF', 'Matricule fiscal']::text[], '{}'::text[], 'matricule_fiscal'::text, null::text, 'pratique', 'pratique'),
    ('avis_debit', 'Opération', 'avis_numero', 'Numéro / référence de l''avis', 'identifiant', 'non', null::text, array['Réf.', 'N° avis']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avis_debit', 'Opération', 'avis_type', 'Type d''avis (débit)', 'liste', 'oui', null::text, array['Avis de débit']::text[], array['إشعار بالخصم']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avis_debit', 'Opération', 'nature_operation', 'Nature de l''opération (prélèvement, échéance de prêt, effet domicilié, frais, agios, virement émis, impayé)', 'liste', 'oui', null::text, array['Nature', 'Objet', 'Motif']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avis_debit', 'Opération', 'date_operation', 'Date d''opération', 'date', 'oui', null::text, array['Date']::text[], array['تاريخ العملية']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avis_debit', 'Opération', 'date_valeur', 'Date de valeur', 'date', 'selon_cas', null::text, array['Valeur']::text[], array['تاريخ القيمة']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avis_debit', 'Opération', 'montant_brut', 'Montant brut de l''opération', 'montant', 'oui', null::text, array['Montant']::text[], array['المبلغ']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avis_debit', 'Opération', 'commissions', 'Commissions / frais détaillés', 'montant', 'non', null::text, array['Commission', 'Frais']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avis_debit', 'Opération', 'tva', 'TVA sur commissions', 'montant', 'selon_cas', null::text, array['TVA']::text[], '{}'::text[], null::text, null::text, 'pratique ; taux INCERTAIN', 'incertain'),
    ('avis_debit', 'Opération', 'autres_taxes', 'Autres taxes / timbre / retenue', 'montant', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avis_debit', 'Opération', 'montant_net', 'Montant net débité', 'montant', 'oui', null::text, array['Net', 'Montant net']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avis_debit', 'Opération', 'devise', 'Devise ; montant et cours si opération en devises', 'liste', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avis_debit', 'Opération', 'cours_change', 'Cours de change', 'taux', 'selon_cas', 'Opération en devises'::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avis_debit', 'Opération', 'contrepartie', 'Tiers (donneur d''ordre / bénéficiaire / tireur)', 'texte', 'selon_cas', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avis_debit', 'Opération', 'reference_piece', 'Référence de la pièce d''origine (n° chèque, n° effet, réf. virement, n° prêt)', 'identifiant', 'selon_cas', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avis_debit', 'Opération', 'montant_en_lettres', 'Montant en lettres', 'texte', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avis_debit', 'Opération', 'cachet_signature', 'Cachet / visa de la banque', 'booleen', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('avis_credit', 'En-tête banque', 'banque_nom', 'Raison sociale de la banque (ou La Poste Tunisienne pour un CCP)', 'texte', 'oui', null::text, array['Banque', 'Agence']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avis_credit', 'En-tête banque', 'banque_code', 'Code banque (2 premiers chiffres du RIB)', 'identifiant', 'selon_cas', 'Déductible du RIB s''il est imprimé'::text, array['Code banque']::text[], '{}'::text[], null::text, null::text, 'Pratique bancaire tunisienne documentée par source secondaire (Rabobank, page Tunisie, lue le 2026-10-30) : RIB 20 chiffres = code banque 2 + code agence 3 + numéro de compte 13 + clé 2 ; IBAN TN 24 caractères. Texte BCT/ATPBEF de référence non lu : INCERTAIN quant au texte normatif.', 'incertain'),
    ('avis_credit', 'En-tête banque', 'banque_agence_nom', 'Nom de l''agence teneuse de compte', 'texte', 'non', null::text, array['Agence']::text[], array['الفرع', 'الوكالة']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avis_credit', 'En-tête banque', 'banque_agence_code', 'Code agence (positions 3 à 5 du RIB)', 'identifiant', 'selon_cas', null::text, array['Code agence', 'Guichet']::text[], '{}'::text[], null::text, null::text, 'Pratique bancaire tunisienne documentée par source secondaire (Rabobank, page Tunisie, lue le 2026-10-30) : RIB 20 chiffres = code banque 2 + code agence 3 + numéro de compte 13 + clé 2 ; IBAN TN 24 caractères. Texte BCT/ATPBEF de référence non lu : INCERTAIN quant au texte normatif.', 'incertain'),
    ('avis_credit', 'En-tête banque', 'banque_agence_adresse', 'Adresse de l''agence', 'adresse', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avis_credit', 'En-tête banque', 'banque_agence_telephone', 'Téléphone / contact agence ou chargé de clientèle', 'texte', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avis_credit', 'En-tête banque', 'banque_bic', 'Code BIC / SWIFT', 'identifiant', 'non', null::text, array['BIC', 'SWIFT']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avis_credit', 'En-tête banque', 'banque_matricule_fiscal', 'Matricule fiscal de la banque', 'identifiant', 'selon_cas', null::text, array['Matricule fiscal', 'MF']::text[], '{}'::text[], 'matricule_fiscal'::text, null::text, 'pratique ; INCERTAIN pour un relevé (attendu surtout lorsque le document vaut facture de commissions avec TVA)', 'incertain'),
    ('avis_credit', 'Compte et titulaire', 'compte_rib', 'RIB 20 chiffres', 'identifiant', 'selon_cas', 'Quasi systématique sur les relevés et formules normalisées ; texte imposant l''impression INCERTAIN'::text, array['RIB', 'Relevé d''identité bancaire']::text[], '{}'::text[], null::text, null::text, 'Pratique bancaire tunisienne documentée par source secondaire (Rabobank, page Tunisie, lue le 2026-10-30) : RIB 20 chiffres = code banque 2 + code agence 3 + numéro de compte 13 + clé 2 ; IBAN TN 24 caractères. Texte BCT/ATPBEF de référence non lu : INCERTAIN quant au texte normatif.', 'incertain'),
    ('avis_credit', 'Compte et titulaire', 'compte_numero', 'Numéro de compte (13 chiffres internes au RIB)', 'identifiant', 'oui', null::text, array['N° de compte', 'Compte n°']::text[], array['رقم الحساب']::text[], null::text, null::text, 'Pratique bancaire tunisienne documentée par source secondaire (Rabobank, page Tunisie, lue le 2026-10-30) : RIB 20 chiffres = code banque 2 + code agence 3 + numéro de compte 13 + clé 2 ; IBAN TN 24 caractères. Texte BCT/ATPBEF de référence non lu : INCERTAIN quant au texte normatif.', 'incertain'),
    ('avis_credit', 'Compte et titulaire', 'compte_cle_rib', 'Clé RIB (2 derniers chiffres)', 'identifiant', 'selon_cas', null::text, array['Clé']::text[], '{}'::text[], null::text, null::text, 'Pratique bancaire tunisienne documentée par source secondaire (Rabobank, page Tunisie, lue le 2026-10-30) : RIB 20 chiffres = code banque 2 + code agence 3 + numéro de compte 13 + clé 2 ; IBAN TN 24 caractères. Texte BCT/ATPBEF de référence non lu : INCERTAIN quant au texte normatif.', 'incertain'),
    ('avis_credit', 'Compte et titulaire', 'compte_iban', 'IBAN (TN + 2 chiffres de contrôle + RIB)', 'identifiant', 'non', null::text, array['IBAN']::text[], '{}'::text[], null::text, null::text, 'Rabobank (24 caractères) ; CDQ (préfixe TN, cite ISO 13616) — pratique', 'pratique'),
    ('avis_credit', 'Compte et titulaire', 'compte_devise', 'Devise du compte (TND par défaut ; compte en devises ou en dinars convertibles possible)', 'liste', 'oui', null::text, array['Devise', 'Monnaie']::text[], array['العملة']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avis_credit', 'Compte et titulaire', 'compte_type', 'Nature du compte (courant, chèque, épargne, devises, dinars convertibles, CCP)', 'liste', 'non', null::text, array['Compte courant', 'Compte chèque', 'CCP']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avis_credit', 'Compte et titulaire', 'compte_titulaire_nom', 'Nom ou raison sociale du titulaire', 'texte', 'oui', null::text, array['Titulaire', 'Client']::text[], array['صاحب الحساب']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avis_credit', 'Compte et titulaire', 'compte_titulaire_adresse', 'Adresse postale du titulaire', 'adresse', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avis_credit', 'Compte et titulaire', 'compte_titulaire_id_client', 'Identifiant / code client interne banque', 'identifiant', 'non', null::text, array['Code client', 'Réf. client']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avis_credit', 'Compte et titulaire', 'compte_titulaire_matricule_fiscal', 'Matricule fiscal du titulaire (entreprise)', 'identifiant', 'non', null::text, array['MF', 'Matricule fiscal']::text[], '{}'::text[], 'matricule_fiscal'::text, null::text, 'pratique', 'pratique'),
    ('avis_credit', 'Opération', 'avis_numero', 'Numéro / référence de l''avis', 'identifiant', 'non', null::text, array['Réf.', 'N° avis']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avis_credit', 'Opération', 'avis_type', 'Type d''avis (crédit)', 'liste', 'oui', null::text, array['Avis de crédit']::text[], array['إشعار بالإضافة']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avis_credit', 'Opération', 'nature_operation', 'Nature de l''opération (remise de chèques, encaissement d''effets, escompte, virement reçu, déblocage de crédit, remise TPE)', 'liste', 'oui', null::text, array['Nature', 'Objet', 'Motif']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avis_credit', 'Opération', 'date_operation', 'Date d''opération', 'date', 'oui', null::text, array['Date']::text[], array['تاريخ العملية']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avis_credit', 'Opération', 'date_valeur', 'Date de valeur', 'date', 'selon_cas', null::text, array['Valeur']::text[], array['تاريخ القيمة']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avis_credit', 'Opération', 'montant_brut', 'Montant brut de l''opération', 'montant', 'oui', null::text, array['Montant']::text[], array['المبلغ']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avis_credit', 'Opération', 'commissions', 'Commissions / frais détaillés', 'montant', 'non', null::text, array['Commission', 'Frais']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avis_credit', 'Opération', 'tva', 'TVA sur commissions', 'montant', 'selon_cas', null::text, array['TVA']::text[], '{}'::text[], null::text, null::text, 'pratique ; taux INCERTAIN', 'incertain'),
    ('avis_credit', 'Opération', 'autres_taxes', 'Autres taxes / timbre / retenue', 'montant', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avis_credit', 'Opération', 'montant_net', 'Montant net crédité', 'montant', 'oui', null::text, array['Net', 'Montant net']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avis_credit', 'Opération', 'devise', 'Devise ; montant et cours si opération en devises', 'liste', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avis_credit', 'Opération', 'cours_change', 'Cours de change', 'taux', 'selon_cas', 'Opération en devises'::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avis_credit', 'Opération', 'contrepartie', 'Tiers (donneur d''ordre / bénéficiaire / tireur)', 'texte', 'selon_cas', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avis_credit', 'Opération', 'reference_piece', 'Référence de la pièce d''origine (n° chèque, n° effet, réf. virement, n° prêt)', 'identifiant', 'selon_cas', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avis_credit', 'Opération', 'montant_en_lettres', 'Montant en lettres', 'texte', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('avis_credit', 'Opération', 'cachet_signature', 'Cachet / visa de la banque', 'booleen', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('cheque', 'Mentions de l''art. 346 (liste exacte à vérifier sur le texte officiel)', 'denomination_cheque', 'Dénomination « chèque » dans le texte du titre', 'booleen', 'oui', null::text, array['Chèque', 'Payez contre ce chèque']::text[], array['شيك']::text[], null::text, null::text, 'Art. 346 C. com. (liste non lue mot à mot ; structure de la loi uniforme de Genève) — INCERTAIN sur le libellé exact', 'incertain'),
    ('cheque', 'Mentions de l''art. 346 (liste exacte à vérifier sur le texte officiel)', 'mandat_payer', 'Mandat pur et simple de payer une somme déterminée', 'booleen', 'oui', null::text, array['Payez contre ce chèque']::text[], '{}'::text[], null::text, null::text, 'Art. 346 — INCERTAIN libellé', 'incertain'),
    ('cheque', 'Mentions de l''art. 346 (liste exacte à vérifier sur le texte officiel)', 'montant_chiffres', 'Montant en chiffres', 'montant', 'oui', null::text, array['DT', 'TND']::text[], array['المبلغ']::text[], null::text, null::text, 'Art. 346 (somme déterminée)', 'texte'),
    ('cheque', 'Mentions de l''art. 346 (liste exacte à vérifier sur le texte officiel)', 'montant_lettres', 'Montant en lettres', 'texte', 'selon_cas', null::text, array['Somme en lettres']::text[], '{}'::text[], null::text, null::text, 'pratique sur formule ; règle de prévalence lettres/chiffres : article tunisien INCERTAIN', 'incertain'),
    ('cheque', 'Mentions de l''art. 346 (liste exacte à vérifier sur le texte officiel)', 'tire_banque', 'Nom du tiré (banque) et agence', 'texte', 'oui', null::text, array['Banque']::text[], array['المسحوب عليه']::text[], null::text, null::text, 'Art. 346 — INCERTAIN libellé', 'incertain'),
    ('cheque', 'Mentions de l''art. 346 (liste exacte à vérifier sur le texte officiel)', 'lieu_paiement', 'Lieu de paiement (agence domiciliataire)', 'adresse', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'Art. 346 — INCERTAIN ; le commentaire relève que l''adresse d''agence n''y figure pas expressément', 'incertain'),
    ('cheque', 'Mentions de l''art. 346 (liste exacte à vérifier sur le texte officiel)', 'date_emission', 'Date d''émission (fait foi entre tireur et bénéficiaire)', 'date', 'oui', null::text, array['Le', 'Date']::text[], array['التاريخ']::text[], null::text, null::text, 'Art. 346 (cité par le commentaire)', 'texte'),
    ('cheque', 'Mentions de l''art. 346 (liste exacte à vérifier sur le texte officiel)', 'lieu_emission', 'Lieu d''émission', 'texte', 'oui', null::text, array['À']::text[], '{}'::text[], null::text, null::text, 'Art. 346 — INCERTAIN libellé', 'incertain'),
    ('cheque', 'Mentions de l''art. 346 (liste exacte à vérifier sur le texte officiel)', 'signature_tireur', 'Signature du tireur', 'booleen', 'oui', null::text, array['Signature']::text[], array['الإمضاء']::text[], null::text, null::text, 'Art. 346 — INCERTAIN libellé', 'incertain'),
    ('cheque', 'Mentions de l''art. 346 (liste exacte à vérifier sur le texte officiel)', 'tireur_nom', 'Nom / raison sociale du tireur (pré-imprimé)', 'texte', 'selon_cas', null::text, array['Titulaire']::text[], array['الساحب']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('cheque', 'Mentions issues de la loi n°2024-41', 'beneficiaire', 'Nom du bénéficiaire (chèque au profit d''une personne dénommée uniquement)', 'texte', 'oui', null::text, array['À l''ordre de', 'Payez à']::text[], array['المستفيد']::text[], null::text, null::text, 'Art. 410 bis al. 7 (selon commentaire)', 'texte'),
    ('cheque', 'Mentions issues de la loi n°2024-41', 'date_validite', 'Date de validité de la formule, au bas de l''acte', 'date', 'oui', null::text, array['Valable jusqu''au']::text[], '{}'::text[], null::text, null::text, 'Art. 410 al. 4 (selon commentaire) ; durée minimale 180 jours : article INCERTAIN', 'incertain'),
    ('cheque', 'Mentions issues de la loi n°2024-41', 'plafond_formule', 'Montant maximal (valeur faciale max.) de la formule', 'montant', 'oui', null::text, array['Montant maximum']::text[], '{}'::text[], null::text, null::text, 'Art. 410 bis al. 1 (selon commentaire) ; plafond légal 30 000 DT par formule', 'texte'),
    ('cheque', 'Mentions issues de la loi n°2024-41', 'plafond_chequier', 'Plafond global du chéquier', 'montant', 'selon_cas', 'Peut figurer sur le chéquier plutôt que sur chaque formule'::text, '{}'::text[], '{}'::text[], null::text, null::text, 'Art. 410 bis al. 1 (selon commentaire)', 'texte'),
    ('cheque', 'Mentions issues de la loi n°2024-41', 'qr_code', 'Code de réponse rapide (QR) et éléments de sécurité', 'identifiant', 'oui', null::text, array['QR']::text[], '{}'::text[], null::text, null::text, 'Art. 410 ter (selon commentaire)', 'texte'),
    ('cheque', 'Mentions issues de la loi n°2024-41', 'barrement', 'Barrement général pré-imprimé (deux traits parallèles)', 'booleen', 'oui', null::text, array['Barré']::text[], '{}'::text[], null::text, null::text, 'Art. 410 bis (selon commentaire) ; non barré à titre exceptionnel (circulaire BCT 21/11/2024 citée)', 'texte'),
    ('cheque', 'Mentions issues de la loi n°2024-41', 'non_endossable', 'Mention de non-endossabilité (sauf à une banque pour recouvrement)', 'booleen', 'selon_cas', null::text, array['Non endossable']::text[], '{}'::text[], null::text, null::text, 'Art. 410 bis al. 8 pour l''interdiction ; mention imprimée : INCERTAIN', 'incertain'),
    ('cheque', 'Zones bancaires (pratique)', 'numero_cheque', 'Numéro de chèque (formule)', 'identifiant', 'oui', null::text, array['N°', 'Chèque n°']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('cheque', 'Zones bancaires (pratique)', 'rib_tireur', 'RIB du tireur pré-imprimé', 'identifiant', 'selon_cas', null::text, array['RIB']::text[], '{}'::text[], null::text, null::text, 'Pratique bancaire tunisienne documentée par source secondaire (Rabobank, page Tunisie, lue le 2026-10-30) : RIB 20 chiffres = code banque 2 + code agence 3 + numéro de compte 13 + clé 2 ; IBAN TN 24 caractères. Texte BCT/ATPBEF de référence non lu : INCERTAIN quant au texte normatif.', 'incertain'),
    ('cheque', 'Zones bancaires (pratique)', 'ligne_codage', 'Ligne de codage magnétique / optique bas de formule (n° chèque, RIB)', 'identifiant', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique ; norme (CMC7 ou autre) INCERTAIN', 'incertain'),
    ('cheque', 'Zones bancaires (pratique)', 'date_presentation', 'Date de présentation / remise (verso ou bordereau)', 'date', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'Art. 371 délai 8 jours ouvrables', 'texte'),
    ('cheque', 'Zones bancaires (pratique)', 'endos_banque', 'Endos de remise au verso (banque présentatrice)', 'texte', 'non', null::text, array['Pour encaissement']::text[], '{}'::text[], null::text, null::text, 'Art. 410 bis al. 8', 'texte'),
    ('cheque', 'Talon / souche (pratique, aucune valeur légale identifiée)', 'talon_numero', 'Numéro de chèque reporté', 'identifiant', 'non', null::text, array['N°']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('cheque', 'Talon / souche (pratique, aucune valeur légale identifiée)', 'talon_date', 'Date', 'date', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('cheque', 'Talon / souche (pratique, aucune valeur légale identifiée)', 'talon_beneficiaire', 'Bénéficiaire', 'texte', 'non', null::text, array['À', 'Ordre']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('cheque', 'Talon / souche (pratique, aucune valeur légale identifiée)', 'talon_montant', 'Montant', 'montant', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('cheque', 'Talon / souche (pratique, aucune valeur légale identifiée)', 'talon_objet', 'Objet / n° facture réglée', 'texte', 'non', null::text, array['Objet', 'Motif']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('cheque', 'Talon / souche (pratique, aucune valeur légale identifiée)', 'talon_solde_avant_apres', 'Solde tenu par le tireur (ancien solde, chèque, nouveau solde)', 'montant', 'non', null::text, array['Solde', 'Report']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('lettre_change', 'Mentions obligatoires (art. 269 C. com.)', 'denomination_lc', 'Dénomination « lettre de change » dans le texte du titre', 'booleen', 'oui', null::text, array['Lettre de change']::text[], array['كمبيالة']::text[], null::text, null::text, 'Art. 269-1°', 'texte'),
    ('lettre_change', 'Mentions obligatoires (art. 269 C. com.)', 'mandat_payer', 'Mandat pur et simple de payer une somme déterminée', 'booleen', 'oui', null::text, array['Veuillez payer', 'Contre cette lettre de change']::text[], '{}'::text[], null::text, null::text, 'Art. 269-2°', 'texte'),
    ('lettre_change', 'Mentions obligatoires (art. 269 C. com.)', 'montant', 'Somme déterminée (chiffres)', 'montant', 'oui', null::text, array['Montant', 'DT']::text[], array['المبلغ']::text[], null::text, null::text, 'Art. 269-2°', 'texte'),
    ('lettre_change', 'Mentions obligatoires (art. 269 C. com.)', 'tire_nom', 'Nom du tiré (celui qui doit payer)', 'texte', 'oui', null::text, array['Tiré', 'Nom et adresse du tiré']::text[], array['المسحوب عليه']::text[], null::text, null::text, 'Art. 269-3°', 'texte'),
    ('lettre_change', 'Mentions obligatoires (art. 269 C. com.)', 'echeance', 'Échéance', 'date', 'oui', null::text, array['Échéance']::text[], array['تاريخ الاستحقاق']::text[], null::text, null::text, 'Art. 269-4° ; à défaut : payable à vue', 'texte'),
    ('lettre_change', 'Mentions obligatoires (art. 269 C. com.)', 'lieu_paiement', 'Lieu de paiement', 'texte', 'oui', null::text, array['Lieu de paiement', 'Domiciliation']::text[], '{}'::text[], null::text, null::text, 'Art. 269-5° ; à défaut : lieu indiqué à côté du nom du tiré', 'texte'),
    ('lettre_change', 'Mentions obligatoires (art. 269 C. com.)', 'beneficiaire', 'Nom de celui à qui ou à l''ordre de qui payer', 'texte', 'oui', null::text, array['À l''ordre de']::text[], array['المستفيد']::text[], null::text, null::text, 'Art. 269-6°', 'texte'),
    ('lettre_change', 'Mentions obligatoires (art. 269 C. com.)', 'date_creation', 'Date de création', 'date', 'oui', null::text, array['Date de création', 'Le']::text[], '{}'::text[], null::text, null::text, 'Art. 269-7°', 'texte'),
    ('lettre_change', 'Mentions obligatoires (art. 269 C. com.)', 'lieu_creation', 'Lieu de création', 'texte', 'oui', null::text, array['Fait à', 'Lieu de création']::text[], '{}'::text[], null::text, null::text, 'Art. 269-7° ; à défaut : lieu à côté du nom du tireur', 'texte'),
    ('lettre_change', 'Mentions obligatoires (art. 269 C. com.)', 'signature_tireur', 'Signature du tireur', 'booleen', 'oui', null::text, array['Signature du tireur']::text[], array['إمضاء الساحب']::text[], null::text, null::text, 'Art. 269-8°', 'texte'),
    ('lettre_change', 'Zones de la formule normalisée (norme tunisienne 2003 — détail non lu)', 'numero_lc', 'Numéro de série de la formule', 'identifiant', 'oui', null::text, array['N°']::text[], '{}'::text[], null::text, null::text, 'Arrêté 4 juin 2003 art. 3 et 5 (registre des numéros, doublons interdits)', 'texte'),
    ('lettre_change', 'Zones de la formule normalisée (norme tunisienne 2003 — détail non lu)', 'tireur_nom_adresse', 'Nom et adresse du tireur', 'adresse', 'selon_cas', null::text, array['Tireur']::text[], array['الساحب']::text[], null::text, null::text, 'pratique ; supplétif lieu de création (art. 269)', 'pratique'),
    ('lettre_change', 'Zones de la formule normalisée (norme tunisienne 2003 — détail non lu)', 'tire_adresse', 'Adresse du tiré', 'adresse', 'selon_cas', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique ; supplétif lieu de paiement (art. 269)', 'pratique'),
    ('lettre_change', 'Zones de la formule normalisée (norme tunisienne 2003 — détail non lu)', 'rib_tire', 'RIB du tiré (domiciliation bancaire)', 'identifiant', 'selon_cas', null::text, array['RIB du tiré', 'Domiciliation']::text[], '{}'::text[], null::text, null::text, 'pratique ; exigé pour la télécompensation (norme non lue : INCERTAIN)', 'incertain'),
    ('lettre_change', 'Zones de la formule normalisée (norme tunisienne 2003 — détail non lu)', 'banque_domiciliataire', 'Banque et agence domiciliataires', 'texte', 'selon_cas', null::text, array['Domiciliation']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('lettre_change', 'Zones de la formule normalisée (norme tunisienne 2003 — détail non lu)', 'montant_lettres', 'Montant en lettres', 'texte', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('lettre_change', 'Zones de la formule normalisée (norme tunisienne 2003 — détail non lu)', 'valeur_en', 'Valeur fournie / cause (ex. « valeur en marchandises », n° facture)', 'texte', 'non', null::text, array['Valeur en', 'Valeur reçue']::text[], '{}'::text[], null::text, null::text, 'pratique ; non exigé par art. 269', 'pratique'),
    ('lettre_change', 'Zones de la formule normalisée (norme tunisienne 2003 — détail non lu)', 'reference_facture', 'Référence facture(s) couvertes', 'identifiant', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('lettre_change', 'Zones de la formule normalisée (norme tunisienne 2003 — détail non lu)', 'timbre', 'Droit de timbre (acquitté via la formule normalisée)', 'booleen', 'selon_cas', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'Arrêté 4 juin 2003 art. 4-5 ; CDET art. 117/119/128 ter — montant INCERTAIN', 'incertain'),
    ('lettre_change', 'Zones de la formule normalisée (norme tunisienne 2003 — détail non lu)', 'ligne_codage', 'Ligne de lecture automatique', 'identifiant', 'selon_cas', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'Norme tunisienne homologuée (arrêté 3 mars 2003) — contenu INCERTAIN', 'incertain'),
    ('lettre_change', 'Zones de la formule normalisée (norme tunisienne 2003 — détail non lu)', 'clause_sans_frais', 'Clause « sans frais » / « retour sans frais » (dispense de protêt)', 'booleen', 'non', null::text, array['Sans frais']::text[], '{}'::text[], null::text, null::text, 'pratique ; article tunisien INCERTAIN', 'incertain'),
    ('lettre_change', 'Acceptation, aval, endossement', 'acceptation', 'Acceptation du tiré (« accepté » + signature)', 'booleen', 'non', null::text, array['Bon pour acceptation', 'Accepté']::text[], '{}'::text[], null::text, null::text, 'pratique ; régime de l''acceptation : articles C. com. INCERTAIN', 'incertain'),
    ('lettre_change', 'Acceptation, aval, endossement', 'date_acceptation', 'Date d''acceptation', 'date', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('lettre_change', 'Acceptation, aval, endossement', 'aval_avaliste', 'Aval : nom de l''avaliste et personne garantie', 'texte', 'non', null::text, array['Bon pour aval']::text[], '{}'::text[], null::text, null::text, 'articles INCERTAIN', 'incertain'),
    ('lettre_change', 'Acceptation, aval, endossement', 'endossements', 'Endossement(s) au verso (endosseur, endossataire, date)', 'liste', 'non', null::text, array['Payez à l''ordre de']::text[], '{}'::text[], null::text, null::text, 'articles INCERTAIN', 'incertain'),
    ('lettre_change', 'Acceptation, aval, endossement', 'endos_escompte', 'Remise à l''escompte / à l''encaissement (banque, date, bordereau)', 'texte', 'non', null::text, array['Bordereau de remise']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('lettre_change', 'Sort de l''effet', 'sort', 'Payé / impayé / prorogé', 'liste', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('lettre_change', 'Sort de l''effet', 'certificat_non_paiement', 'Avis/certificat de non-paiement ou protêt (date)', 'date', 'selon_cas', null::text, array['Impayé', 'Protêt']::text[], '{}'::text[], null::text, null::text, 'art. 307, 317-320 C. com. (cités par l''auteur sikafinance)', 'texte')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('billet_ordre', 'Mentions (structure Genève, à confirmer sur le texte tunisien)', 'clause_ordre_denomination', 'Clause à ordre ou dénomination « billet à ordre »', 'booleen', 'oui', null::text, array['Billet à ordre', 'À l''ordre de']::text[], array['سند لأمر']::text[], null::text, null::text, 'INCERTAIN (article tunisien non lu)', 'incertain'),
    ('billet_ordre', 'Mentions (structure Genève, à confirmer sur le texte tunisien)', 'promesse_payer', 'Promesse pure et simple de payer une somme déterminée', 'booleen', 'oui', null::text, array['Je paierai', 'Nous paierons']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('billet_ordre', 'Mentions (structure Genève, à confirmer sur le texte tunisien)', 'montant', 'Somme déterminée', 'montant', 'oui', null::text, array['Montant']::text[], array['المبلغ']::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('billet_ordre', 'Mentions (structure Genève, à confirmer sur le texte tunisien)', 'echeance', 'Échéance', 'date', 'oui', null::text, array['Échéance']::text[], array['تاريخ الاستحقاق']::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('billet_ordre', 'Mentions (structure Genève, à confirmer sur le texte tunisien)', 'lieu_paiement', 'Lieu de paiement / domiciliation', 'texte', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('billet_ordre', 'Mentions (structure Genève, à confirmer sur le texte tunisien)', 'beneficiaire', 'Nom du bénéficiaire', 'texte', 'oui', null::text, array['À l''ordre de']::text[], array['المستفيد']::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('billet_ordre', 'Mentions (structure Genève, à confirmer sur le texte tunisien)', 'date_lieu_souscription', 'Date et lieu de souscription', 'date', 'oui', null::text, array['Fait à', 'Le']::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('billet_ordre', 'Mentions (structure Genève, à confirmer sur le texte tunisien)', 'signature_souscripteur', 'Signature du souscripteur', 'booleen', 'oui', null::text, array['Signature']::text[], array['الإمضاء']::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('billet_ordre', 'Pratique', 'souscripteur_nom_adresse', 'Nom et adresse du souscripteur', 'adresse', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('billet_ordre', 'Pratique', 'rib_souscripteur', 'RIB de domiciliation', 'identifiant', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'Pratique bancaire tunisienne documentée par source secondaire (Rabobank, page Tunisie, lue le 2026-10-30) : RIB 20 chiffres = code banque 2 + code agence 3 + numéro de compte 13 + clé 2 ; IBAN TN 24 caractères. Texte BCT/ATPBEF de référence non lu : INCERTAIN quant au texte normatif.', 'incertain'),
    ('billet_ordre', 'Pratique', 'valeur_en', 'Cause / valeur fournie, réf. facture ou contrat de prêt', 'texte', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('billet_ordre', 'Pratique', 'aval', 'Aval', 'texte', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('billet_ordre', 'Pratique', 'endossements', 'Endossements', 'liste', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'INCERTAIN', 'incertain'),
    ('billet_ordre', 'Pratique', 'timbre', 'Droit de timbre', 'montant', 'selon_cas', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'CDET — montant INCERTAIN', 'incertain')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('virement', 'Donneur d''ordre', 'donneur_nom', 'Nom / raison sociale du donneur d''ordre', 'texte', 'oui', null::text, array['Donneur d''ordre']::text[], array['الآمر بالتحويل']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('virement', 'Donneur d''ordre', 'donneur_rib', 'RIB / IBAN du compte à débiter', 'identifiant', 'oui', null::text, array['Compte à débiter', 'RIB']::text[], '{}'::text[], null::text, null::text, 'Pratique bancaire tunisienne documentée par source secondaire (Rabobank, page Tunisie, lue le 2026-10-30) : RIB 20 chiffres = code banque 2 + code agence 3 + numéro de compte 13 + clé 2 ; IBAN TN 24 caractères. Texte BCT/ATPBEF de référence non lu : INCERTAIN quant au texte normatif.', 'incertain'),
    ('virement', 'Donneur d''ordre', 'donneur_banque', 'Banque du donneur', 'texte', 'selon_cas', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('virement', 'Bénéficiaire', 'beneficiaire_nom', 'Nom du bénéficiaire', 'texte', 'oui', null::text, array['Bénéficiaire']::text[], array['المستفيد']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('virement', 'Bénéficiaire', 'beneficiaire_rib', 'RIB / IBAN du bénéficiaire', 'identifiant', 'oui', null::text, array['RIB bénéficiaire', 'Compte à créditer']::text[], '{}'::text[], null::text, null::text, 'Pratique bancaire tunisienne documentée par source secondaire (Rabobank, page Tunisie, lue le 2026-10-30) : RIB 20 chiffres = code banque 2 + code agence 3 + numéro de compte 13 + clé 2 ; IBAN TN 24 caractères. Texte BCT/ATPBEF de référence non lu : INCERTAIN quant au texte normatif.', 'incertain'),
    ('virement', 'Bénéficiaire', 'beneficiaire_banque', 'Banque / BIC du bénéficiaire', 'texte', 'selon_cas', null::text, array['BIC', 'Banque']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('virement', 'Bénéficiaire', 'beneficiaire_adresse', 'Adresse du bénéficiaire (international)', 'adresse', 'selon_cas', 'Virement international'::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('virement', 'Opération', 'montant', 'Montant', 'montant', 'oui', null::text, array['Montant']::text[], array['المبلغ']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('virement', 'Opération', 'montant_lettres', 'Montant en lettres', 'texte', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('virement', 'Opération', 'devise', 'Devise', 'liste', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('virement', 'Opération', 'motif', 'Motif / référence de paiement (n° facture, mois de salaire)', 'texte', 'non', null::text, array['Motif', 'Objet']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('virement', 'Opération', 'date_ordre', 'Date de l''ordre', 'date', 'oui', null::text, array['Date']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('virement', 'Opération', 'date_execution', 'Date d''exécution souhaitée / effective', 'date', 'selon_cas', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('virement', 'Opération', 'date_valeur', 'Date de valeur (avis reçu)', 'date', 'selon_cas', null::text, array['Valeur']::text[], array['تاريخ القيمة']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('virement', 'Opération', 'type_virement', 'Type (interne, interbancaire, permanent, de masse, international, instantané)', 'liste', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('virement', 'Opération', 'reference_virement', 'Référence bancaire / identifiant de transaction', 'identifiant', 'selon_cas', null::text, array['Réf.']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('virement', 'Opération', 'frais', 'Frais et TVA ; option de répartition des frais (international)', 'montant', 'non', null::text, array['Frais']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('virement', 'Opération', 'cours_change', 'Cours appliqué (devises)', 'taux', 'selon_cas', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('virement', 'Opération', 'references_change', 'Références réglementation des changes (domiciliation, titre d''importation…)', 'texte', 'selon_cas', 'Virement vers/depuis l''étranger'::text, '{}'::text[], '{}'::text[], null::text, null::text, 'INCERTAIN (réglementation des changes non lue)', 'incertain'),
    ('virement', 'Opération', 'signature_donneur', 'Signature(s) autorisée(s) du donneur', 'booleen', 'selon_cas', 'Ordre papier'::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique ; conditions de pouvoir du compte', 'pratique'),
    ('virement', 'Opération', 'cachet_banque', 'Cachet / accusé de réception banque', 'booleen', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('ticket_tpe', 'Commerçant / terminal', 'commercant_enseigne', 'Enseigne / raison sociale du commerçant', 'texte', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('ticket_tpe', 'Commerçant / terminal', 'commercant_adresse', 'Ville / adresse', 'adresse', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('ticket_tpe', 'Commerçant / terminal', 'numero_contrat_commercant', 'N° contrat commerçant / MID', 'identifiant', 'oui', null::text, array['N° commerçant', 'MID']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('ticket_tpe', 'Commerçant / terminal', 'numero_terminal', 'N° de terminal / TID', 'identifiant', 'oui', null::text, array['TID', 'Terminal']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('ticket_tpe', 'Commerçant / terminal', 'acquereur', 'Banque acquéreur', 'texte', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('ticket_tpe', 'Transaction', 'type_transaction', 'Type (débit/achat, annulation, remboursement, pré-autorisation)', 'liste', 'oui', null::text, array['Débit', 'Achat', 'Annulation', 'Crédit']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('ticket_tpe', 'Transaction', 'date_heure', 'Date et heure', 'date', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('ticket_tpe', 'Transaction', 'montant', 'Montant', 'montant', 'oui', null::text, array['Montant']::text[], array['المبلغ']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('ticket_tpe', 'Transaction', 'devise', 'Devise', 'liste', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('ticket_tpe', 'Transaction', 'carte_numero_masque', 'Numéro de carte tronqué/masqué', 'identifiant', 'oui', null::text, array['**** **** ****']::text[], '{}'::text[], null::text, null::text, 'pratique sécurité (PCI) — ne jamais stocker un PAN complet', 'pratique'),
    ('ticket_tpe', 'Transaction', 'carte_reseau', 'Réseau / type de carte', 'texte', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('ticket_tpe', 'Transaction', 'date_expiration', 'Date d''expiration (souvent masquée)', 'date', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('ticket_tpe', 'Transaction', 'numero_autorisation', 'N° d''autorisation', 'identifiant', 'oui', null::text, array['Autorisation', 'Auto']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('ticket_tpe', 'Transaction', 'numero_transaction', 'N° de transaction / séquence / STAN', 'identifiant', 'oui', null::text, array['N° Trans.']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('ticket_tpe', 'Transaction', 'mode_lecture', 'Mode (puce, sans contact, piste, saisie)', 'liste', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('ticket_tpe', 'Transaction', 'aid_application', 'Identifiant d''application carte (AID) et libellé', 'identifiant', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('ticket_tpe', 'Transaction', 'verification_porteur', 'Vérification (code PIN, signature)', 'liste', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('ticket_tpe', 'Transaction', 'mention_copie', 'Copie commerçant / copie client', 'liste', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('ticket_tpe', 'Ticket de télécollecte (clôture)', 'lot_numero', 'N° de lot / remise', 'identifiant', 'selon_cas', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('ticket_tpe', 'Ticket de télécollecte (clôture)', 'lot_nombre_transactions', 'Nombre de transactions', 'nombre', 'selon_cas', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('ticket_tpe', 'Ticket de télécollecte (clôture)', 'lot_total', 'Total remis', 'montant', 'selon_cas', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('ticket_tpe', 'Ticket de télécollecte (clôture)', 'lot_date', 'Date de télécollecte', 'date', 'selon_cas', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('tableau_amortissement_emprunt', 'Identification du crédit', 'banque', 'Banque prêteuse', 'texte', 'oui', null::text, array['Banque']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('tableau_amortissement_emprunt', 'Identification du crédit', 'emprunteur', 'Emprunteur', 'texte', 'oui', null::text, array['Emprunteur']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('tableau_amortissement_emprunt', 'Identification du crédit', 'numero_pret', 'N° de dossier / de prêt', 'identifiant', 'oui', null::text, array['N° prêt', 'Dossier']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('tableau_amortissement_emprunt', 'Identification du crédit', 'objet', 'Objet du crédit (investissement, fonds de roulement, véhicule…)', 'texte', 'non', null::text, array['Objet']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('tableau_amortissement_emprunt', 'Identification du crédit', 'categorie_teg', 'Catégorie de crédit au sens de la publication des TEG (court, moyen, long terme, découvert, consommation, habitat, leasing)', 'liste', 'selon_cas', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'arrêté semestriel des TEG (WMC 03/08/2026)', 'texte'),
    ('tableau_amortissement_emprunt', 'Identification du crédit', 'compte_debite_rib', 'RIB du compte de prélèvement', 'identifiant', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'Pratique bancaire tunisienne documentée par source secondaire (Rabobank, page Tunisie, lue le 2026-10-30) : RIB 20 chiffres = code banque 2 + code agence 3 + numéro de compte 13 + clé 2 ; IBAN TN 24 caractères. Texte BCT/ATPBEF de référence non lu : INCERTAIN quant au texte normatif.', 'incertain'),
    ('tableau_amortissement_emprunt', 'Identification du crédit', 'date_deblocage', 'Date de déblocage / mise à disposition', 'date', 'oui', null::text, array['Date de déblocage']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('tableau_amortissement_emprunt', 'Identification du crédit', 'montant_principal', 'Capital emprunté', 'montant', 'oui', null::text, array['Montant du prêt', 'Capital']::text[], array['أصل القرض']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('tableau_amortissement_emprunt', 'Identification du crédit', 'duree', 'Durée (mois) et nombre d''échéances', 'nombre', 'oui', null::text, array['Durée']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('tableau_amortissement_emprunt', 'Identification du crédit', 'periodicite', 'Périodicité (mensuelle, trimestrielle, semestrielle, annuelle)', 'liste', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('tableau_amortissement_emprunt', 'Identification du crédit', 'differe', 'Différé d''amortissement (durée, type partiel/total)', 'nombre', 'non', null::text, array['Différé', 'Franchise']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('tableau_amortissement_emprunt', 'Identification du crédit', 'mode_amortissement', 'Mode (échéance constante, amortissement constant, in fine)', 'liste', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('tableau_amortissement_emprunt', 'Identification du crédit', 'taux_nominal', 'Taux d''intérêt nominal annuel', 'taux', 'oui', null::text, array['Taux']::text[], array['نسبة الفائدة']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('tableau_amortissement_emprunt', 'Identification du crédit', 'type_taux', 'Fixe ou variable ; index (TMM) + marge', 'liste', 'oui', null::text, array['TMM + marge']::text[], '{}'::text[], null::text, null::text, 'pratique ; index TMM : INCERTAIN quant au texte', 'incertain'),
    ('tableau_amortissement_emprunt', 'Identification du crédit', 'teg', 'Taux effectif global', 'taux', 'selon_cas', null::text, array['TEG']::text[], '{}'::text[], null::text, null::text, 'loi n°99-64 / décret n°2000-462 — obligation d''affichage sur le tableau : INCERTAIN', 'incertain'),
    ('tableau_amortissement_emprunt', 'Identification du crédit', 'base_calcul', 'Base de calcul (360/365)', 'liste', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('tableau_amortissement_emprunt', 'Identification du crédit', 'frais_dossier', 'Frais de dossier / d''étude', 'montant', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('tableau_amortissement_emprunt', 'Identification du crédit', 'assurance', 'Prime d''assurance (décès-invalidité, perte d''emploi) et taux', 'montant', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('tableau_amortissement_emprunt', 'Identification du crédit', 'garanties', 'Garanties (hypothèque, nantissement, caution, billets à ordre)', 'texte', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('tableau_amortissement_emprunt', 'Identification du crédit', 'date_premiere_echeance', 'Date de la première échéance', 'date', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('tableau_amortissement_emprunt', 'Identification du crédit', 'date_derniere_echeance', 'Date de la dernière échéance', 'date', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('tableau_amortissement_emprunt', 'Identification du crédit', 'cout_total_credit', 'Coût total du crédit (Σ intérêts + frais + assurance)', 'montant', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('tableau_amortissement_emprunt', 'Lignes d''échéance (une par échéance)', 'ech_rang', 'N° d''échéance', 'nombre', 'oui', null::text, array['N°']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('tableau_amortissement_emprunt', 'Lignes d''échéance (une par échéance)', 'ech_date', 'Date d''échéance', 'date', 'oui', null::text, array['Échéance', 'Date']::text[], array['تاريخ الاستحقاق']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('tableau_amortissement_emprunt', 'Lignes d''échéance (une par échéance)', 'ech_crd_debut', 'Capital restant dû début de période', 'montant', 'oui', null::text, array['Capital restant dû', 'CRD']::text[], array['رأس المال المتبقي']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('tableau_amortissement_emprunt', 'Lignes d''échéance (une par échéance)', 'ech_interets', 'Intérêts de la période', 'montant', 'oui', null::text, array['Intérêts']::text[], array['الفوائد']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('tableau_amortissement_emprunt', 'Lignes d''échéance (une par échéance)', 'ech_amortissement', 'Amortissement du capital (principal remboursé)', 'montant', 'oui', null::text, array['Amortissement', 'Principal']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('tableau_amortissement_emprunt', 'Lignes d''échéance (une par échéance)', 'ech_tva_interets', 'TVA sur intérêts', 'montant', 'selon_cas', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique ; assujettissement et taux INCERTAIN', 'incertain'),
    ('tableau_amortissement_emprunt', 'Lignes d''échéance (une par échéance)', 'ech_assurance', 'Assurance de l''échéance', 'montant', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('tableau_amortissement_emprunt', 'Lignes d''échéance (une par échéance)', 'ech_frais', 'Frais / commissions de l''échéance', 'montant', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('tableau_amortissement_emprunt', 'Lignes d''échéance (une par échéance)', 'ech_montant_total', 'Montant total de l''échéance', 'montant', 'oui', null::text, array['Échéance', 'Mensualité']::text[], array['القسط']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('tableau_amortissement_emprunt', 'Lignes d''échéance (une par échéance)', 'ech_crd_fin', 'Capital restant dû après échéance', 'montant', 'oui', null::text, array['CRD']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('tableau_amortissement_emprunt', 'Lignes d''échéance (une par échéance)', 'ech_statut', 'Statut (à venir, payée, impayée, reportée)', 'liste', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'Malica', 'texte'),
    ('tableau_amortissement_emprunt', 'Totaux', 'total_interets', 'Total des intérêts', 'montant', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('tableau_amortissement_emprunt', 'Totaux', 'total_amortissements', 'Total des amortissements', 'montant', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('tableau_amortissement_emprunt', 'Totaux', 'total_echeances', 'Total des échéances', 'montant', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut)
select g.id, v.parcelle, v.code, v.libelle, v.type, v.obligatoire, v.condition, v.reperes_fr,
       v.reperes_ar, v.format_code, v.groupe, v.fondement, v.source_fondement, 'defaut_a_valider'
  from (values
    ('echeancier_leasing', 'Contrat', 'bailleur', 'Société de leasing', 'texte', 'oui', null::text, array['Bailleur', 'Société de leasing']::text[], '{}'::text[], null::text, null::text, 'Loi 94-89 art. 1 (bailleur propriétaire)', 'texte'),
    ('echeancier_leasing', 'Contrat', 'preneur', 'Preneur (locataire)', 'texte', 'oui', null::text, array['Preneur', 'Locataire']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('echeancier_leasing', 'Contrat', 'numero_contrat', 'N° de contrat', 'identifiant', 'oui', null::text, array['Contrat n°']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('echeancier_leasing', 'Contrat', 'date_contrat', 'Date de signature', 'date', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('echeancier_leasing', 'Contrat', 'date_mise_en_loyer', 'Date de mise en loyer / livraison', 'date', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('echeancier_leasing', 'Contrat', 'nature_leasing', 'Mobilier ou immobilier', 'liste', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'Loi 94-89 art. 1', 'texte'),
    ('echeancier_leasing', 'Contrat', 'bien_designation', 'Désignation du bien (marque, modèle, n° série/châssis, immatriculation)', 'texte', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('echeancier_leasing', 'Contrat', 'fournisseur_bien', 'Fournisseur du bien', 'texte', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('echeancier_leasing', 'Contrat', 'valeur_ht', 'Valeur d''acquisition HT financée', 'montant', 'oui', null::text, array['Valeur HT', 'Montant financé']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('echeancier_leasing', 'Contrat', 'tva_bien', 'TVA sur le bien (supportée par le bailleur)', 'montant', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('echeancier_leasing', 'Contrat', 'premier_loyer_majore', 'Premier loyer majoré / apport', 'montant', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('echeancier_leasing', 'Contrat', 'duree', 'Durée (mois) et nombre de loyers', 'nombre', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('echeancier_leasing', 'Contrat', 'periodicite', 'Périodicité des loyers', 'liste', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('echeancier_leasing', 'Contrat', 'terme', 'Paiement à terme échu ou à échoir', 'liste', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('echeancier_leasing', 'Contrat', 'taux', 'Taux / TEG du leasing', 'taux', 'selon_cas', null::text, array['Taux', 'TEG']::text[], '{}'::text[], null::text, null::text, 'seuil leasing publié (arrêté semestriel)', 'texte'),
    ('echeancier_leasing', 'Contrat', 'valeur_residuelle', 'Valeur résiduelle / prix de levée d''option d''achat', 'montant', 'oui', null::text, array['Valeur résiduelle', 'Option d''achat']::text[], '{}'::text[], null::text, null::text, 'pratique ; texte imposant la mention INCERTAIN', 'incertain'),
    ('echeancier_leasing', 'Contrat', 'depot_garantie', 'Dépôt de garantie', 'montant', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('echeancier_leasing', 'Contrat', 'assurance', 'Assurance du bien', 'montant', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('echeancier_leasing', 'Contrat', 'compte_prelevement_rib', 'RIB de prélèvement', 'identifiant', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'Pratique bancaire tunisienne documentée par source secondaire (Rabobank, page Tunisie, lue le 2026-10-30) : RIB 20 chiffres = code banque 2 + code agence 3 + numéro de compte 13 + clé 2 ; IBAN TN 24 caractères. Texte BCT/ATPBEF de référence non lu : INCERTAIN quant au texte normatif.', 'incertain'),
    ('echeancier_leasing', 'Contrat', 'enregistrement', 'Mention d''enregistrement (recette des finances, date)', 'texte', 'selon_cas', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'CDET art. 3, I-12° (60 jours)', 'texte'),
    ('echeancier_leasing', 'Lignes de loyer', 'loyer_rang', 'N° du loyer', 'nombre', 'oui', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('echeancier_leasing', 'Lignes de loyer', 'loyer_date', 'Date d''échéance', 'date', 'oui', null::text, array['Échéance']::text[], array['تاريخ الاستحقاق']::text[], null::text, null::text, 'pratique', 'pratique'),
    ('echeancier_leasing', 'Lignes de loyer', 'loyer_ht', 'Loyer HT', 'montant', 'oui', null::text, array['Loyer HT']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('echeancier_leasing', 'Lignes de loyer', 'loyer_part_capital', 'Part principal (amortissement financier)', 'montant', 'selon_cas', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('echeancier_leasing', 'Lignes de loyer', 'loyer_part_interets', 'Part intérêts (marge financière)', 'montant', 'selon_cas', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('echeancier_leasing', 'Lignes de loyer', 'loyer_tva', 'TVA sur loyer', 'montant', 'oui', null::text, array['TVA']::text[], '{}'::text[], null::text, null::text, 'pratique ; taux INCERTAIN (paramètre)', 'incertain'),
    ('echeancier_leasing', 'Lignes de loyer', 'loyer_ttc', 'Loyer TTC', 'montant', 'oui', null::text, array['Loyer TTC']::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('echeancier_leasing', 'Lignes de loyer', 'encours_debut', 'Encours financier début', 'montant', 'selon_cas', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('echeancier_leasing', 'Lignes de loyer', 'encours_fin', 'Encours financier fin', 'montant', 'selon_cas', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique'),
    ('echeancier_leasing', 'Lignes de loyer', 'loyer_assurance_frais', 'Assurance / frais accessoires', 'montant', 'non', null::text, '{}'::text[], '{}'::text[], null::text, null::text, 'pratique', 'pratique')
  ) as v(grille, parcelle, code, libelle, type, obligatoire, condition, reperes_fr, reperes_ar,
         format_code, groupe, fondement, source_fondement)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

insert into ref.grille_relations (grille_id, vers, nature, cle)
select g.id, v.vers, v.nature, v.cle
  from (values
    ('facture', 'tiers (fiche fournisseur ou client)', 'identifie la contrepartie', 'matricule_fiscal_emetteur / matricule_fiscal_client, sinon nom + adresse'),
    ('facture', 'bon_commande', 'facture issue d''une commande', 'ref_bon_commande'),
    ('facture', 'bon_livraison / bon_reception', 'facture d''éléments livrés (rapprochement à trois voies commande-livraison-facture)', 'ref_bon_livraison, lignes (référence article, quantité)'),
    ('facture', 'devis_proforma', 'facture conforme à l''offre acceptée', 'ref_devis_marche'),
    ('facture', 'avoir', 'facture annulée ou corrigée en tout ou partie', 'numero_facture référencé dans l''avoir'),
    ('facture', 'justificatif_paiement / relevé bancaire / compte bancaire', 'règlement de la facture', 'net_a_payer, numero_facture dans le libellé du virement ou chèque, date'),
    ('facture', 'certificat de retenue à la source', 'retenue opérée sur le paiement', 'numero_facture, montant TTC, matricules fiscaux'),
    ('facture', 'écriture comptable (journal achats ou ventes)', 'comptabilisation HT, TVA, FODEC, timbre, TTC', 'numero_facture, date_operation, tiers'),
    ('facture', 'déclaration mensuelle TVA', 'TVA collectée (vente) ou déductible (achat)', 'montant_tva_par_taux, période de date_operation'),
    ('facture', 'liste trimestrielle des factures en suspension', 'déclaration à la DGI dans les 28 jours suivant le trimestre', 'numero_facture, date, MF client, montant_tva_suspendue, ref_attestation_suspension'),
    ('facture_electronique', 'facture', 'même objet métier, représentation XML signée', 'numero_facture, matricule_fiscal_emetteur'),
    ('facture_electronique', 'plateforme TTN / El Fatoora', 'enregistrement et vérification', 'reference_unique_ttn'),
    ('facture_electronique', 'document de transport de marchandises', 'copie de la facture électronique accompagnant le transport (sanction depuis 01/07/2025 selon KPMG US)', 'reference_unique_ttn'),
    ('facture_electronique', 'tiers', 'émetteur adhérent au réseau', 'matricule_fiscal_emetteur'),
    ('avoir', 'facture', 'rectifie ou annule une facture', 'ref_facture_origine + matricule_fiscal_emetteur'),
    ('avoir', 'bon_reception / bon de retour', 'retour physique de marchandises', 'ref_bon_retour'),
    ('avoir', 'déclaration TVA', 'régularisation de TVA collectée ou déductible', 'montant_tva, période'),
    ('avoir', 'écriture comptable', 'extourne partielle ou totale', 'numero_avoir'),
    ('devis_proforma', 'bon_commande', 'le devis accepté déclenche la commande', 'numero_devis'),
    ('devis_proforma', 'facture', 'la facture reprend le devis', 'numero_devis, lignes'),
    ('devis_proforma', 'dossier d''importation / domiciliation bancaire', 'proforma support de la domiciliation ou du crédit documentaire', 'numero_devis, devise, montant'),
    ('bon_commande', 'devis_proforma', 'commande sur devis', 'ref_devis'),
    ('bon_commande', 'bon_livraison / bon_reception', 'exécution de la commande', 'numero_commande'),
    ('bon_commande', 'facture', 'facturation de la commande', 'numero_commande'),
    ('bon_commande', 'tiers (fournisseur)', 'contrepartie', 'matricule_fiscal_fournisseur'),
    ('bon_livraison', 'bon_commande', 'exécute la commande', 'ref_commande'),
    ('bon_livraison', 'facture', 'BL facturé (souvent plusieurs BL par facture)', 'numero_bl repris dans la facture'),
    ('bon_livraison', 'bon_reception', 'contrepartie côté acheteur', 'numero_bl, date, lignes'),
    ('bon_livraison', 'stock', 'sortie de stock (vendeur) / entrée (acheteur)', 'reference_article, quantite_livree'),
    ('bon_reception', 'bon_livraison', 'constate la livraison du fournisseur', 'ref_bl_fournisseur'),
    ('bon_reception', 'bon_commande', 'solde la commande', 'ref_commande'),
    ('bon_reception', 'facture (achat)', 'autorise le paiement de la facture', 'ref_commande, lignes'),
    ('bon_reception', 'avoir', 'les refus déclenchent un retour et un avoir', 'quantite_acceptee_refusee'),
    ('ticket_caisse', 'note_frais', 'justificatif de dépense d''un salarié', 'date_heure, total_ttc'),
    ('ticket_caisse', 'facture globale quotidienne (côté vendeur)', 'agrégation des ventes de la journée', 'date, caisse'),
    ('ticket_caisse', 'justificatif_paiement / relevé bancaire', 'paiement carte', 'date, total_ttc'),
    ('recu_quittance', 'contrat de bail', 'exécution du bail', 'ref_contrat_bail, adresse_bien_loue'),
    ('recu_quittance', 'facture', 'constate le paiement d''une facture', 'ref_facture_reglee, montant_recu'),
    ('recu_quittance', 'certificat de retenue à la source', 'retenue sur loyer ou honoraires', 'montant, période, tiers'),
    ('recu_quittance', 'justificatif_paiement / relevé bancaire', 'trace bancaire du paiement', 'montant_recu, date_paiement, numéro de chèque'),
    ('recu_quittance', 'tiers (bailleur)', 'contrepartie', 'nom_creancier, matricule_fiscal_creancier'),
    ('note_frais', 'ticket_caisse / facture / recu_quittance', 'justificatifs des lignes', 'date_depense, montant_ttc_ligne'),
    ('note_frais', 'fiche salarié', 'bénéficiaire du remboursement', 'matricule_salarie'),
    ('note_frais', 'justificatif_paiement', 'remboursement au salarié', 'net_a_rembourser'),
    ('note_frais', 'écriture comptable', 'charges par nature', 'categorie_depense'),
    ('facture_service_public', 'tiers (opérateur)', 'fournisseur récurrent', 'matricule_fiscal_operateur'),
    ('facture_service_public', 'site / local de l''entreprise', 'rattachement de la consommation à un établissement', 'adresse_abonne, numero_compteur_ligne'),
    ('facture_service_public', 'justificatif_paiement / relevé bancaire', 'règlement', 'reference_paiement, montant_a_payer'),
    ('facture_service_public', 'recu_quittance / contrat de bail', 'charges refacturées par le bailleur', 'adresse'),
    ('bilan', 'etat_resultat', 'résultat de l''exercice identique', 'raison_sociale + date_cloture'),
    ('bilan', 'etat_flux_tresorerie', 'liquidités (nettes de concours bancaires selon la définition retenue en note) = trésorerie de clôture', 'date_cloture'),
    ('bilan', 'notes_etats_financiers', 'chaque ligne renvoie à une note détaillée', 'colonne_notes'),
    ('bilan', 'balance_tiers', 'chaque ligne = agrégat de comptes de la balance de clôture', 'date_cloture + numéro de compte'),
    ('bilan', 'bilan', 'colonne N−1 = colonne N du bilan précédent', 'raison_sociale + date_cloture − 1 an'),
    ('bilan', 'fiche_immobilisation', 'brut et amortissements = somme des fiches', 'catégorie d''immobilisation'),
    ('bilan', 'pv_inventaire_stocks', 'stocks = valorisation du PV d''inventaire à la clôture', 'date_cloture'),
    ('bilan', 'contrat_leasing', 'dettes de leasing = capital restant dû des échéanciers (NCT 41)', 'n° contrat'),
    ('etat_resultat', 'bilan', 'résultat net = résultat de l''exercice au bilan', 'raison_sociale + date_cloture'),
    ('etat_resultat', 'etat_flux_tresorerie', 'point de départ de la méthode indirecte', 'date_cloture'),
    ('etat_resultat', 'fiche_immobilisation', 'dotations aux amortissements ⊇ somme des dotations des fiches', 'exercice'),
    ('etat_resultat', 'balance_tiers', 'chaque ligne = agrégat des comptes de charges (classe 6) et produits (classe 7)', 'exercice + compte'),
    ('etat_resultat', 'pv_inventaire_stocks', 'achats consommés = achats + stock initial − stock final', 'exercice'),
    ('etat_resultat', 'contrat_leasing', 'intérêts de leasing dans les charges financières', 'n° contrat'),
    ('etat_flux_tresorerie', 'bilan', 'trésorerie de clôture ↔ liquidités et concours bancaires', 'date_cloture'),
    ('etat_flux_tresorerie', 'etat_resultat', 'résultat net (méthode indirecte)', 'exercice'),
    ('etat_flux_tresorerie', 'etat_flux_tresorerie', 'trésorerie début N = trésorerie clôture N−1', 'exercice − 1'),
    ('etat_flux_tresorerie', 'fiche_immobilisation', 'décaissements d''acquisition ≈ acquisitions de l''exercice ± variation des dettes fournisseurs d''immobilisations', 'exercice'),
    ('etat_flux_tresorerie', 'contrat_leasing', 'remboursements de capital et intérêts payés', 'n° contrat'),
    ('notes_etats_financiers', 'bilan', 'détail et justification des postes', 'numéro de note'),
    ('notes_etats_financiers', 'etat_resultat', 'détail des charges et produits', 'numéro de note'),
    ('notes_etats_financiers', 'fiche_immobilisation', 'tableau des immobilisations = agrégation des fiches', 'rubrique + exercice'),
    ('notes_etats_financiers', 'contrat_leasing', 'engagements et dettes de leasing', 'n° contrat'),
    ('balance_tiers', 'grand_livre_tiers', 'chaque ligne = totaux du compte au grand livre', 'numéro de compte + période'),
    ('balance_tiers', 'bilan', 'classes 1 à 5 agrégées en postes', 'date de clôture'),
    ('balance_tiers', 'etat_resultat', 'classes 6 et 7 agrégées', 'exercice'),
    ('balance_tiers', 'balance_tiers', 'à-nouveaux N = soldes de clôture N−1 (comptes de bilan) ; balance auxiliaire ↔ compte collectif', 'exercice / compte collectif'),
    ('grand_livre_tiers', 'balance_tiers', 'totaux par compte = ligne de balance', 'numéro de compte + période'),
    ('grand_livre_tiers', 'facture_acquisition_immobilisation', 'pièce justificative d''une écriture d''immobilisation', 'reference_piece'),
    ('grand_livre_tiers', 'declaration_douane_import', 'pièce justificative des droits et TVA à l''import', 'n° déclaration'),
    ('grand_livre_tiers', 'contrat_leasing', 'écritures de loyers / remboursements', 'n° contrat + date échéance'),
    ('facture_acquisition_immobilisation', 'fiche_immobilisation', 'valeur d''origine = HT (+ TVA si non récupérable) + frais accessoires', 'numero_facture + numero_serie'),
    ('facture_acquisition_immobilisation', 'contrat_acquisition_immobilisation', 'exécution du contrat', 'référence contrat / désignation'),
    ('facture_acquisition_immobilisation', 'declaration_douane_import', 'facture étrangère annexée à la déclaration ; droits non récupérables capitalisés', 'numero_facture'),
    ('facture_acquisition_immobilisation', 'contrat_leasing', 'facture adressée au bailleur pour un bien en leasing', 'numero_serie'),
    ('facture_acquisition_immobilisation', 'carte_grise', 'véhicule : même n° de châssis', 'numero_serie'),
    ('facture_acquisition_immobilisation', 'grand_livre_tiers', 'pièce justificative de l''écriture', 'numero_facture'),
    ('contrat_acquisition_immobilisation', 'fiche_immobilisation', 'valeur d''origine = prix + frais d''acquisition', 'objet + date'),
    ('contrat_acquisition_immobilisation', 'facture_acquisition_immobilisation', 'facture d''exécution le cas échéant', 'objet'),
    ('contrat_acquisition_immobilisation', 'notes_etats_financiers', 'engagements hors bilan / hypothèques', 'titre_foncier'),
    ('fiche_immobilisation', 'facture_acquisition_immobilisation', 'origine de la valeur d''entrée', 'reference_facture'),
    ('fiche_immobilisation', 'declaration_douane_import', 'droits non récupérables capitalisés', 'n° déclaration'),
    ('fiche_immobilisation', 'contrat_leasing', 'bien pris en leasing inscrit à l''actif', 'n° contrat'),
    ('fiche_immobilisation', 'carte_grise', 'véhicule identifié par immatriculation et châssis', 'numero_serie_immatriculation'),
    ('fiche_immobilisation', 'contrat_assurance', 'bien assuré ; indemnité en cas de sinistre', 'numero_serie_immatriculation'),
    ('fiche_immobilisation', 'notes_etats_financiers', 'agrégation dans le tableau des immobilisations', 'categorie_compte + exercice'),
    ('fiche_immobilisation', 'etat_resultat', 'Σ dotations = dotations aux amortissements', 'exercice'),
    ('pv_inventaire_stocks', 'bilan', 'stocks au bilan = valorisation du PV − dépréciations', 'date_reference'),
    ('pv_inventaire_stocks', 'etat_resultat', 'variation de stocks / achats consommés', 'exercice'),
    ('pv_inventaire_stocks', 'declaration_douane_import', 'coût d''achat des marchandises importées (droits de douane inclus)', 'code_article / n° déclaration'),
    ('pv_inventaire_stocks', 'grand_livre_tiers', 'comptes de stocks (classe 3)', 'date_reference'),
    ('declaration_douane_import', 'facture_acquisition_immobilisation', 'facture étrangère jointe ; coût d''entrée = valeur + droits non récupérables', 'reference_facture'),
    ('declaration_douane_import', 'certificat_origine', 'justifie le pays d''origine et le taux préférentiel', 'reference_certificat_origine'),
    ('declaration_douane_import', 'document_dedouanement', 'quittance et bon à enlever de la même déclaration', 'numero_enregistrement'),
    ('declaration_douane_import', 'pv_inventaire_stocks', 'coût d''achat des stocks importés', 'position_tarifaire / article'),
    ('declaration_douane_import', 'fiche_immobilisation', 'équipement importé', 'numero_enregistrement'),
    ('declaration_douane_import', 'contrat_assurance', 'assurance transport (facultés) incluse dans la valeur', 'titre_transport'),
    ('declaration_douane_export', 'certificat_origine', 'même expédition', 'numero_enregistrement / facture'),
    ('declaration_douane_export', 'grand_livre_tiers', 'chiffre d''affaires export et créance client en devise', 'facture'),
    ('declaration_douane_export', 'etat_resultat', 'revenus à l''export', 'exercice'),
    ('document_dedouanement', 'declaration_douane_import', 'paiement et mainlevée de la déclaration', 'numero_declaration'),
    ('document_dedouanement', 'grand_livre_tiers', 'écriture de paiement des droits', 'numero_quittance'),
    ('document_dedouanement', 'fiche_immobilisation', 'frais accessoires capitalisables', 'numero_declaration'),
    ('certificat_origine', 'declaration_douane_export', 'même expédition ; référence du document d''export au visa', 'numero déclaration / factures'),
    ('certificat_origine', 'declaration_douane_import', 'justifie l''origine et le taux préférentiel', 'numero_certificat'),
    ('contrat_assurance', 'avis_echeance_assurance', 'appels de prime successifs', 'numero_police'),
    ('contrat_assurance', 'carte_grise', 'véhicule assuré', 'immatriculation / châssis'),
    ('contrat_assurance', 'fiche_immobilisation', 'bien assuré ; capital assuré à comparer à la valeur', 'identifiant du bien'),
    ('contrat_assurance', 'contrat_leasing', 'assurance exigée par le bailleur, délégation', 'n° contrat leasing / châssis'),
    ('contrat_assurance', 'declaration_douane_import', 'assurance facultés (transport)', 'titre de transport'),
    ('avis_echeance_assurance', 'contrat_assurance', 'appel de prime de la police', 'numero_police'),
    ('avis_echeance_assurance', 'grand_livre_tiers', 'charge d''assurance et paiement', 'numero_avis'),
    ('carte_grise', 'fiche_immobilisation', 'véhicule immobilisé (même châssis)', 'numero_serie_vin'),
    ('carte_grise', 'facture_acquisition_immobilisation', 'facture d''achat du véhicule', 'numero_serie_vin'),
    ('carte_grise', 'vignette', 'taxe de circulation selon puissance fiscale et immatriculation', 'numero_immatriculation'),
    ('carte_grise', 'contrat_assurance', 'véhicule assuré', 'numero_immatriculation'),
    ('carte_grise', 'contrat_leasing', 'véhicule objet du leasing', 'numero_serie_vin'),
    ('vignette', 'carte_grise', 'immatriculation, puissance fiscale, propriétaire', 'numero_immatriculation'),
    ('vignette', 'fiche_immobilisation', 'véhicule du parc', 'numero_immatriculation'),
    ('vignette', 'grand_livre_tiers', 'charge d''impôts et taxes', 'numero_quittance'),
    ('contrat_leasing', 'fiche_immobilisation', 'bien inscrit à l''actif du preneur (NCT 41) ; amortissement sur durée minimale fiscale', 'numero_contrat + identifiant_bien'),
    ('contrat_leasing', 'carte_grise', 'véhicule objet du contrat', 'identifiant_bien (châssis)'),
    ('contrat_leasing', 'contrat_assurance', 'assurance du bien avec délégation au bailleur', 'identifiant_bien'),
    ('contrat_leasing', 'facture_acquisition_immobilisation', 'facture du fournisseur au bailleur', 'reference_facture_fournisseur'),
    ('contrat_leasing', 'bilan', 'dette de leasing : part > 1 an en passifs non courants, part < 1 an en courants', 'date_cloture'),
    ('contrat_leasing', 'grand_livre_tiers', 'écritures de loyers et prélèvements bancaires', 'numero_contrat + date_echeance'),
    ('contrat_leasing', 'vignette', 'véhicules en leasing : échéance spécifique (5 mai selon LF 2022)', 'immatriculation'),
    ('declaration_mensuelle', 'facture_vente', 'La TVA collectée et le nombre de factures (timbre) se justifient par les factures émises du mois', 'matricule_fiscal + periode (date de facture ou fait générateur dans le mois)'),
    ('declaration_mensuelle', 'facture_achat', 'La TVA déductible se justifie par des factures d''achat conformes à l''art. 18 Code TVA', 'matricule_fiscal client + periode de comptabilisation'),
    ('declaration_mensuelle', 'certificat_retenue_source (émis)', 'Chaque retenue déclarée doit correspondre aux certificats émis pour les paiements du mois', 'matricule payeur + mois de paiement + catégorie de retenue'),
    ('declaration_mensuelle', 'certificat_retenue_source (reçu, TVA)', 'TVA retenue subie imputable seulement si certificat plateforme', 'matricule bénéficiaire + date paiement'),
    ('declaration_mensuelle', 'bulletin_paie', 'Base TFP/FOPROLOS = Σ brut imposable + avantages ; RAS salaires = Σ IRPP retenu ; CSS = Σ CSS retenue', 'matricule employeur + mois de paie'),
    ('declaration_mensuelle', 'declaration_mensuelle (mois précédent)', 'Continuité du crédit de TVA reporté', 'matricule_fiscal + periode-1'),
    ('declaration_mensuelle', 'quittance_paiement', 'Preuve du paiement du net à payer', 'matricule + periode + montant'),
    ('declaration_mensuelle', 'declaration_employeur', 'Σ annuelle des RAS déclarées mensuellement = totaux de la déclaration employeur', 'matricule + exercice'),
    ('declaration_mensuelle', 'declaration_annuelle_is', 'CA cumulé des 12 déclarations (TCL/TVA) cohérent avec CA de la déclaration annuelle ; base minimum d''impôt', 'matricule + exercice'),
    ('declaration_mensuelle', 'attestation_suspension_tva', 'Ventes en suspension justifiées par les attestations des clients', 'matricule client + n° attestation'),
    ('declaration_mensuelle', 'releve_bancaire', 'Débit du télépaiement ou du chèque', 'montant + date'),
    ('acompte_provisionnel', 'declaration_annuelle_is (N-1)', 'La base de l''acompte est l''impôt de l''exercice précédent', 'matricule + exercice N-1'),
    ('acompte_provisionnel', 'declaration_annuelle_is (N)', 'Les 3 acomptes payés s''imputent sur l''impôt annuel de N', 'matricule + exercice N'),
    ('acompte_provisionnel', 'quittance_paiement', 'Preuve de paiement', 'matricule + rang + montant'),
    ('acompte_provisionnel', 'certificat_retenue_source (reçus)', 'Retenues subies éventuellement imputées', 'matricule bénéficiaire + exercice'),
    ('declaration_annuelle_is_irpp', 'etats_financiers', 'Résultat comptable repris des états financiers de l''exercice', 'matricule + exercice'),
    ('declaration_annuelle_is_irpp', 'acompte_provisionnel (N)', 'Imputation des 3 acomptes', 'matricule + exercice'),
    ('declaration_annuelle_is_irpp', 'acompte_provisionnel (N+1)', 'L''IS dû N fonde les acomptes N+1', 'matricule + exercice'),
    ('declaration_annuelle_is_irpp', 'certificat_retenue_source (reçus)', 'Retenues subies imputées = Σ certificats dont le bénéficiaire est la société, datés de l''exercice', 'matricule bénéficiaire + année de paiement'),
    ('declaration_annuelle_is_irpp', 'declaration_mensuelle (x12)', 'CA cumulé cohérent (écarts à expliquer : exigibilité, TCL TTC/HT)', 'matricule + exercice'),
    ('declaration_annuelle_is_irpp', 'declaration_employeur', 'Les charges (salaires, honoraires, loyers) non déclarées dans la déclaration employeur sont non déductibles', 'matricule + exercice'),
    ('declaration_annuelle_is_irpp', 'declaration_annuelle (N-1)', 'Déficits reportés, excédent d''impôt, amortissements différés', 'matricule + exercice-1'),
    ('declaration_annuelle_is_irpp', 'quittance_paiement', 'Paiement du reste à payer', 'matricule + exercice + montant'),
    ('declaration_annuelle_is_irpp', 'notification_resultats_verification', 'Une vérification peut redresser la déclaration', 'matricule + exercice'),
    ('declaration_employeur', 'bulletin_paie', 'Annexe I = Σ annuelle par salarié des bulletins (brut, avantages, IRPP, CSS, net)', 'employeur + salarié + année'),
    ('declaration_employeur', 'declaration_mensuelle (x12)', 'Σ des retenues mensuelles par nature = récapitulatif annuel', 'matricule + exercice + nature'),
    ('declaration_employeur', 'certificat_retenue_source', 'Chaque ligne bénéficiaire des annexes II à VII = Σ des certificats émis à ce bénéficiaire', 'matricule payeur + identifiant bénéficiaire + année'),
    ('declaration_employeur', 'grand_livre / balance', 'Charges d''honoraires, loyers, commissions comptabilisées ⇒ déclarées (sinon non déductibles)', 'comptes 62x / 61x + exercice'),
    ('declaration_employeur', 'declaration_annuelle_is', 'Réintégration des charges non déclarées', 'matricule + exercice'),
    ('certificat_retenue_source', 'facture (achat chez payeur / vente chez bénéficiaire)', 'Le certificat justifie l''écart entre facture TTC et encaissement', 'matricule fournisseur + n° facture + montant TTC'),
    ('certificat_retenue_source', 'reglement / releve_bancaire', 'Net servi = montant décaissé/encaissé', 'reference_paiement + date + net'),
    ('certificat_retenue_source', 'declaration_mensuelle (payeur)', 'Retenue déclarée dans la mensuelle du mois de paiement', 'matricule payeur + mois de date_paiement'),
    ('certificat_retenue_source', 'declaration_employeur (payeur)', 'Agrégé dans l''annexe du bénéficiaire', 'matricule payeur + bénéficiaire + année'),
    ('certificat_retenue_source', 'declaration_annuelle_is (bénéficiaire)', 'Retenue IR/IS imputable sur l''impôt annuel', 'matricule bénéficiaire + année'),
    ('certificat_retenue_source', 'declaration_mensuelle (bénéficiaire)', 'Retenue TVA imputable comme TVA déductible', 'matricule bénéficiaire + mois'),
    ('quittance_paiement', 'declaration_mensuelle / acompte_provisionnel / declaration_annuelle_is / arrete_taxation', 'Preuve de paiement du montant déclaré ou notifié', 'matricule + nature + periode + montant'),
    ('quittance_paiement', 'releve_bancaire', 'Débit correspondant (chèque, virement, télépaiement)', 'montant + date + référence'),
    ('quittance_paiement', 'ecriture_comptable', 'Solde des comptes d''État (4xx)', 'montant + date'),
    ('quittance_paiement', 'attestation_situation_fiscale', 'Les quittances prouvent la régularité de paiement', 'matricule'),
    ('carte_identification_fiscale', 'tenant (société) Malica', 'Document racine : fixe le matricule de référence de tous les autres documents', 'matricule_fiscal'),
    ('carte_identification_fiscale', 'extrait_RNE / statuts', 'Cohérence raison sociale, adresse, activité', 'raison_sociale + identifiant RNE'),
    ('carte_identification_fiscale', 'toutes déclarations', 'Le code TVA et la catégorie déterminent les obligations attendues', 'matricule_fiscal'),
    ('carte_identification_fiscale', 'facture', 'Matricule porté sur les factures émises', 'matricule_fiscal'),
    ('attestation_situation_fiscale', 'declaration_mensuelle / declaration_annuelle_is / acompte_provisionnel', 'L''attestation présuppose que toutes les déclarations échues sont déposées', 'matricule + périodes échues à la date d''arrêté'),
    ('attestation_situation_fiscale', 'quittance_paiement', 'Et payées', 'matricule'),
    ('attestation_situation_fiscale', 'dossier_marche_public', 'Pièce administrative jointe à une soumission', 'n° attestation + date'),
    ('attestation_situation_fiscale', 'notification_resultats_verification / arrete_taxation', 'Une dette contestée ou un redressement en cours peut empêcher la délivrance', 'matricule'),
    ('avis_verification', 'declarations de la période', 'Périmètre du contrôle : mensuelles, annuelles, employeur de la période', 'matricule + impôts + période'),
    ('avis_verification', 'notification_resultats_verification', 'Suite de la procédure', 'référence avis / matricule + période'),
    ('avis_verification', 'demande_renseignements', 'Demandes en cours de vérification (réponse 20 jours, art. 41)', 'référence'),
    ('notification_resultats_verification', 'avis_verification', 'Procédure source', 'référence avis'),
    ('notification_resultats_verification', 'declarations redressées', 'Chaque chef renvoie à une déclaration et une période', 'matricule + impôt + période'),
    ('notification_resultats_verification', 'pieces justificatives (factures, certificats)', 'Éléments de défense/contestation', 'période + nature'),
    ('notification_resultats_verification', 'arrete_taxation_office', 'Suite en cas de désaccord', 'matricule + période'),
    ('notification_resultats_verification', 'declaration_rectificative + reconnaissance_dette', 'Suite en cas d''acquiescement', 'référence notification'),
    ('notification_resultats_verification', 'quittance_paiement', 'Paiement du rappel', 'montant'),
    ('arrete_taxation_office', 'notification_resultats_verification', 'Procédure antérieure (cas art. 47 al. 1)', 'matricule + période'),
    ('arrete_taxation_office', 'mise_en_demeure', 'Procédure antérieure (défaut de déclaration)', 'matricule + période'),
    ('arrete_taxation_office', 'quittance_paiement / caution_bancaire', 'Suspension par paiement 10 % ou caution 15 % sous 60 jours', 'référence arrêté'),
    ('attestation_suspension_tva', 'facture_vente (fournisseur)', 'Facture sans TVA portant « vente en suspension » + n° et date de l''attestation', 'numero_attestation + matricule client'),
    ('attestation_suspension_tva', 'bon_commande', 'Bon de commande mentionnant la suspension', 'numero_attestation'),
    ('attestation_suspension_tva', 'declaration_mensuelle (fournisseur)', 'CA en suspension ; droit à restitution mensuelle du crédit', 'matricule + mois'),
    ('attestation_suspension_tva', 'liste_trimestrielle_achats_suspension (bénéficiaire)', 'Déclaration dans les 28 jours suivant le trimestre', 'matricule + trimestre'),
    ('attestation_suspension_tva', 'declaration_annuelle_is (bénéficiaire)', 'CA export > 50 % du CA global (condition d''éligibilité)', 'matricule + exercice'),
    ('attestation_exoneration_non_retenue', 'facture', 'Facture sans TVA / sans timbre référant l''attestation', 'numero attestation + matricule'),
    ('attestation_exoneration_non_retenue', 'certificat_retenue_source', 'Absence ou réduction de retenue justifiée par l''attestation', 'matricule bénéficiaire + date paiement'),
    ('attestation_exoneration_non_retenue', 'declaration_mensuelle', 'CA exonéré déclaré', 'matricule + mois'),
    ('statuts', 'extrait_rne', 'Les statuts en vigueur doivent correspondre aux données immatriculées (dénomination, forme, capital, siège, objet, durée, dirigeants)', 'identifiant_unique_rne / dénomination'),
    ('statuts', 'pv_age', 'Chaque version des statuts est produite par une AGE (ou décision de l''associé unique) ; chaîne de versions datées', 'date_mise_a_jour = date_assemblee de l''AGE'),
    ('statuts', 'pv_ago', 'Règles statutaires (quorum, majorité, réserves, exercice) applicables à l''AGO', 'version des statuts en vigueur à date_assemblee'),
    ('statuts', 'feuille_presence', 'Le total des titres de la feuille de présence doit égaler le nombre de titres des statuts', 'nombre_titres'),
    ('statuts', 'etats_financiers', 'Capital social du bilan = capital des statuts ; date de clôture = exercice_cloture', 'capital_montant ; exercice_cloture'),
    ('statuts', 'rapport_cac', 'Désignation du CAC conforme à la clause statutaire et à la loi', 'commissaire_aux_comptes'),
    ('statuts', 'procuration', 'Signature des statuts par mandataire muni d''un pouvoir spécial', 'associe ↔ mandant'),
    ('extrait_rne', 'statuts', 'Cohérence des données immatriculées avec les statuts en vigueur', 'identifiant_unique'),
    ('extrait_rne', 'pv_ago', 'Les dirigeants nommés par l''assemblée doivent apparaître sur l''extrait postérieur (après inscription modificative)', 'dirigeant_nom + qualité + date'),
    ('extrait_rne', 'pv_age', 'Capital, siège, dénomination modifiés en AGE doivent apparaître sur un extrait postérieur', 'identifiant_unique + date'),
    ('extrait_rne', 'pv_conseil_administration', 'Nomination du PDG/DG par le conseil reflétée sur l''extrait', 'dirigeant_nom'),
    ('extrait_rne', 'procuration', 'Le mandant signataire d''une procuration doit être dirigeant habilité selon l''extrait à la date de la procuration', 'dirigeant_nom + date'),
    ('extrait_rne', 'contrat', 'Le signataire pour la société doit être habilité (dirigeant ou mandataire)', 'identifiant_unique + signataire'),
    ('pv_ago', 'feuille_presence', 'Le quorum du PV est la somme de la feuille de présence', 'date_assemblee + identifiant_unique'),
    ('pv_ago', 'statuts', 'Statuts en vigueur à la date de l''assemblée (règles de quorum, majorité, exercice, réserves)', 'date_assemblee ∈ période de validité de la version'),
    ('pv_ago', 'etats_financiers', 'Résultat affecté = résultat net des états financiers approuvés', 'exercice_concerne'),
    ('pv_ago', 'rapport_gestion', 'Rapport présenté à l''AGO', 'exercice_concerne'),
    ('pv_ago', 'rapport_cac', 'Rapports général et spécial lus ; opinion du CAC', 'exercice_concerne'),
    ('pv_ago', 'extrait_rne', 'Nominations / révocations à inscrire et vérifier sur l''extrait postérieur', 'nomination_personne + fonction'),
    ('pv_ago', 'procuration', 'Pouvoirs des associés représentés', 'mandant ↔ associé'),
    ('pv_ago', 'pv_ago (n-1)', 'Report à nouveau antérieur = report à nouveau nouveau du PV de l''exercice précédent', 'exercice n-1'),
    ('pv_ago', 'comptabilite_dividendes', 'Dividendes décidés → écritures de dividendes à payer et retenue à la source', 'dividendes_total + date_mise_en_paiement'),
    ('pv_age', 'statuts', 'Produit une nouvelle version des statuts ; la version antérieure s''applique à la tenue de l''AGE elle-même', 'date_assemblee'),
    ('pv_age', 'feuille_presence', 'Quorum', 'date_assemblee'),
    ('pv_age', 'extrait_rne', 'Inscription modificative attendue (capital, siège, dénomination, forme, durée)', 'identifiant_unique'),
    ('pv_age', 'etats_financiers', 'Incorporation de réserves ≤ réserves disponibles ; capitaux propres pour art. 388', 'dernier exercice approuvé'),
    ('pv_age', 'rapport_cac', 'Rapport spécial sur réduction de capital / apports', 'date_assemblee'),
    ('pv_age', 'comptabilite_capital', 'Écritures de capital, prime, réserves, compte bloqué', 'montant_variation + date de réalisation'),
    ('feuille_presence', 'pv_ago', 'Annexe du PV ; totaux = quorum du PV', 'date_assemblee'),
    ('feuille_presence', 'pv_age', 'Annexe du PV ; totaux = quorum du PV', 'date_assemblee'),
    ('feuille_presence', 'statuts', 'Somme des titres détenus (tous associés, y compris absents) = nombre de titres des statuts en vigueur', 'nombre_titres'),
    ('feuille_presence', 'procuration', 'Chaque ligne ''représenté'' doit être couverte par un pouvoir', 'associe + mandataire + date_assemblee'),
    ('pv_conseil_administration', 'pv_ago', 'Le conseil arrête les comptes et convoque l''AGO ; ordre du jour de l''AGO = ordre du jour arrêté par le conseil', 'exercice + date AG'),
    ('pv_conseil_administration', 'rapport_gestion', 'Le conseil arrête le rapport de gestion', 'exercice'),
    ('pv_conseil_administration', 'extrait_rne', 'Nomination PDG/DG à inscrire au RNE', 'nomination_dirigeant'),
    ('pv_conseil_administration', 'rapport_cac', 'Conventions autorisées → rapport spécial du CAC', 'convention'),
    ('pv_conseil_administration', 'procuration', 'Délégations de pouvoirs consenties par le conseil', 'délégataire + date'),
    ('pv_conseil_administration', 'statuts', 'Composition et règles du conseil', 'version en vigueur'),
    ('decision_associe_unique', 'statuts', 'Version des statuts en vigueur ; production d''une nouvelle version si décision extraordinaire', 'date_decision'),
    ('decision_associe_unique', 'etats_financiers', 'Résultat affecté = résultat net', 'exercice'),
    ('decision_associe_unique', 'extrait_rne', 'Nomination du gérant / modifications à inscrire', 'identifiant_unique'),
    ('decision_associe_unique', 'procuration', 'Aucune procuration ne peut suppléer l''associé unique pour ses décisions', 'signataire'),
    ('decision_gerant', 'extrait_rne', 'Le signataire doit être gérant inscrit à la date', 'gerant + date'),
    ('decision_gerant', 'pv_ago', 'Décision de mise en conformité à ratifier ; convocation → AG', 'date'),
    ('decision_gerant', 'statuts', 'Pouvoirs du gérant et limitations', 'version en vigueur'),
    ('rapport_gestion', 'etats_financiers', 'Chiffres cités = états financiers', 'exercice'),
    ('rapport_gestion', 'pv_ago', 'Proposition d''affectation = affectation votée (ou écart motivé)', 'exercice'),
    ('rapport_gestion', 'pv_conseil_administration', 'Arrêté par le conseil', 'exercice'),
    ('rapport_gestion', 'rapport_cac', 'Le CAC vérifie la sincérité des informations du rapport de gestion (pratique)', 'exercice'),
    ('rapport_cac', 'etats_financiers', 'Chiffres audités = états financiers soumis à l''AGO', 'exercice'),
    ('rapport_cac', 'pv_ago', 'Rapport lu en AGO ; nomination/renouvellement du CAC', 'exercice + mandat'),
    ('rapport_cac', 'pv_conseil_administration', 'Conventions autorisées par le conseil reprises au rapport spécial', 'convention'),
    ('rapport_cac', 'statuts', 'Obligation de CAC selon forme et seuils', 'forme_juridique'),
    ('rapport_cac', 'extrait_rne', 'CAC inscrit au RNE', 'cac_identite'),
    ('contrat_commercial', 'extrait_rne', 'Signataire habilité (dirigeant inscrit) à la date de signature ; contrepartie existante et active', 'identifiant_unique + partie_representant'),
    ('contrat_commercial', 'procuration', 'Si signataire non dirigeant : pouvoir couvrant l''objet et le montant', 'mandataire + date'),
    ('contrat_commercial', 'pv_conseil_administration', 'Autorisation préalable si convention réglementée ou engagement soumis à autorisation statutaire', 'objet + montant'),
    ('contrat_commercial', 'rapport_cac', 'Convention avec dirigeant/associé à reprendre au rapport spécial', 'partie ↔ dirigeant'),
    ('contrat_commercial', 'factures', 'Factures émises/reçues conformes au prix et à l''échéancier', 'reference contrat'),
    ('contrat_commercial', 'contrat (avenants)', 'Chaîne contrat initial → avenants', 'reference'),
    ('bail_commercial', 'statuts', 'Adresse du local = siège statutaire si bail du siège', 'adresse'),
    ('bail_commercial', 'extrait_rne', 'Adresse du siège / établissement secondaire immatriculé = adresse du local', 'adresse'),
    ('bail_commercial', 'pv_age', 'Transfert de siège ⇒ nouveau bail daté avant ou à la date d''effet', 'nouveau_siege'),
    ('bail_commercial', 'comptabilite_loyers', 'Charges de loyer et retenues mensuelles conformes au bail', 'loyer_montant + périodicité'),
    ('bail_commercial', 'procuration', 'Signataire pour le preneur habilité', 'signataire'),
    ('procuration', 'feuille_presence', 'Couvre une ligne ''représenté''', 'mandant + date AG'),
    ('procuration', 'pv_ago', 'Pouvoirs comptés dans le quorum', 'date AG'),
    ('procuration', 'extrait_rne', 'Mandant dirigeant habilité à la date', 'mandant + date'),
    ('procuration', 'contrat', 'Pouvoir du signataire couvrant objet et montant', 'mandataire + objet'),
    ('procuration', 'pv_conseil_administration', 'Délégation issue d''une décision du conseil', 'fondement_pouvoir_mandant'),
    ('bulletin_paie', 'contrat_travail', 'applique les conditions du contrat (salaire de base, emploi, catégorie)', 'salarie_matricule_cnss + employeur_numero_cnss'),
    ('bulletin_paie', 'declaration_cnss_trimestrielle', 'les bruts des bulletins des 3 mois forment la ligne du salarié', 'salarie_matricule_cnss + trimestre'),
    ('bulletin_paie', 'declaration_mensuelle_impots (famille fiscale)', 'somme des retenues IRPP du mois = ligne traitements et salaires', 'employeur_matricule_fiscal + mois'),
    ('bulletin_paie', 'declaration_employeur_annuelle (famille fiscale)', 'cumul annuel brut, imposable et IRPP par salarié', 'salarie_cin + annee'),
    ('bulletin_paie', 'certificat_retenue_salaires (famille fiscale)', 'certificat annuel remis au salarié reprenant les cumuls', 'salarie_cin + annee'),
    ('bulletin_paie', 'releve_bancaire (famille banque)', 'net à payer = virement salaire', 'montant net + date paiement + nom bénéficiaire'),
    ('bulletin_paie', 'journal_paie / ecritures comptables (famille comptable)', 'comptabilisation 421/431/432/4425 ou plan équivalent', 'periode + employeur'),
    ('bulletin_paie', 'registre_personnel', 'le salarié doit figurer au registre/état du personnel', 'salarie_matricule_interne'),
    ('bulletin_paie', 'attestation_salaire', 'les montants attestés proviennent des bulletins', 'salarie + periode'),
    ('declaration_cnss_trimestrielle', 'bulletin_paie', 'agrégation des bruts des bulletins du trimestre par assuré', 'matricule_cnss + trimestre'),
    ('declaration_cnss_trimestrielle', 'recepisse_quittance_cnss', 'preuve de dépôt et de paiement de cette déclaration', 'employeur_numero_cnss + annee + trimestre'),
    ('declaration_cnss_trimestrielle', 'releve_bancaire (famille banque)', 'prélèvement/virement CNSS = montant_total_a_payer', 'montant + date + libellé CNSS'),
    ('declaration_cnss_trimestrielle', 'declaration_employeur_annuelle (famille fiscale)', 'Σ 4 trimestres ≈ Σ bruts annuels déclarés au fisc (écarts justifiés : éléments non soumis)', 'employeur + annee'),
    ('declaration_cnss_trimestrielle', 'registre_personnel', 'chaque salarié actif du trimestre doit apparaître', 'matricule_cnss'),
    ('declaration_cnss_trimestrielle', 'ecritures comptables (famille comptable)', 'charges sociales et dette CNSS', 'trimestre'),
    ('recepisse_quittance_cnss', 'declaration_cnss_trimestrielle', 'solde la déclaration du même trimestre', 'employeur_numero_cnss + annee + trimestre'),
    ('recepisse_quittance_cnss', 'releve_bancaire (famille banque)', 'débit correspondant', 'montant_total_paye + date_paiement + reference_bancaire'),
    ('recepisse_quittance_cnss', 'certificat_affiliation_cnss / attestation de situation', 'la régularité des quittances conditionne l''obtention d''une attestation de situation', 'employeur_numero_cnss'),
    ('contrat_cdi', 'bulletin_paie', 'conditions appliquées chaque mois', 'salarie + employeur'),
    ('contrat_cdi', 'registre_personnel', 'inscription du salarié à la date d''effet', 'salarie + date_debut'),
    ('contrat_cdi', 'declaration_cnss_trimestrielle', 'apparition du salarié à partir du trimestre d''embauche', 'matricule_cnss'),
    ('contrat_cdi', 'attestation_travail', 'dates et emploi attestés', 'salarie'),
    ('contrat_cdi', 'recu_solde_tout_compte', 'clôture du contrat', 'salarie + date_fin'),
    ('contrat_cdd', 'contrat_cdi', 'requalification si motif hors article 6-4 ou absence d''écrit', 'salarie + employeur'),
    ('contrat_cdd', 'bulletin_paie', 'mêmes droits que CDI (égalité de traitement, réforme 2025)', 'salarie'),
    ('contrat_cdd', 'recu_solde_tout_compte', 'fin de contrat', 'date_fin_ou_terme'),
    ('contrat_insertion_civp', 'bulletin_paie / état d''indemnités', 'indemnité complémentaire versée chaque mois', 'beneficiaire + mois'),
    ('contrat_insertion_civp', 'contrat_cdi', 'recrutement éventuel à l''issue', 'beneficiaire'),
    ('contrat_insertion_civp', 'registre_personnel', 'à distinguer des salariés (statut stagiaire)', 'beneficiaire'),
    ('attestation_travail', 'contrat_travail', 'dates et emploi doivent correspondre', 'salarie'),
    ('attestation_travail', 'registre_personnel', 'dates d''entrée/sortie', 'salarie'),
    ('attestation_travail', 'declaration_cnss_trimestrielle', 'présence du salarié sur la période attestée', 'matricule_cnss + periode'),
    ('attestation_salaire', 'bulletin_paie', 'montants attestés = bulletins de la période', 'salarie + periode_reference'),
    ('attestation_salaire', 'releve_bancaire', 'net attesté = virements reçus (si détenu)', 'montant'),
    ('certificat_affiliation_cnss', 'declaration_cnss_trimestrielle', 'le numéro d''affiliation identifie toutes les déclarations', 'employeur_numero_cnss'),
    ('certificat_affiliation_cnss', 'registre RNE / patente (famille juridique)', 'raison sociale et matricule fiscal concordants', 'employeur_matricule_fiscal'),
    ('recu_solde_tout_compte', 'bulletin_paie', 'dernier bulletin (solde) reprend les mêmes éléments', 'salarie + date_sortie'),
    ('recu_solde_tout_compte', 'attestation_travail', 'certificat de travail remis à la même date', 'salarie'),
    ('recu_solde_tout_compte', 'releve_bancaire', 'paiement du montant_total', 'montant + date'),
    ('recu_solde_tout_compte', 'declaration_cnss_trimestrielle', 'dernière apparition du salarié au trimestre de sortie', 'matricule_cnss'),
    ('registre_personnel', 'declaration_cnss_trimestrielle', 'effectif et liste des assurés concordants', 'matricule_cnss + trimestre'),
    ('registre_personnel', 'bulletin_paie', 'un bulletin par salarié actif et par mois', 'matricule + mois'),
    ('registre_personnel', 'contrat_travail', 'dates et emploi', 'salarie'),
    ('releve_bancaire', 'releve_bancaire (période précédente)', 'continuité', 'compte_rib + solde_final(n) = solde_initial(n+1) + periode_fin(n) < periode_debut(n+1) sans trou'),
    ('releve_bancaire', 'avis_debit / avis_credit', 'justifie une ligne', 'compte_rib + date_operation + montant + reference'),
    ('releve_bancaire', 'cheque', 'débit (chèque émis) ou crédit (remise de chèque)', 'numero_cheque + montant'),
    ('releve_bancaire', 'lettre_change / billet_ordre', 'débit à l''échéance (effet domicilié) ou crédit (encaissement / escompte)', 'numero_effet + echeance + montant'),
    ('releve_bancaire', 'virement', 'ligne VIR émise ou reçue', 'reference_virement + montant + date_valeur'),
    ('releve_bancaire', 'ticket_tpe', 'crédit de la remise TPE (brut − commission commerçant)', 'date_remise + numero_terminal/contrat commerçant + montant'),
    ('releve_bancaire', 'tableau_amortissement_emprunt', 'prélèvement d''échéance', 'numero_pret + date_echeance + montant_echeance'),
    ('releve_bancaire', 'echeancier_leasing', 'prélèvement du loyer', 'numero_contrat + date_echeance + loyer_ttc'),
    ('releve_bancaire', 'facture (achats/ventes)', 'lettrage règlement', 'montant + tiers + référence facture dans le libellé'),
    ('releve_bancaire', 'grand livre 532 (compte banque) / état de rapprochement', 'rapprochement bancaire', 'solde_final relevé vs solde comptable à la même date'),
    ('avis_debit', 'releve_bancaire', 'justifie une ligne', 'compte_rib + date_operation + montant_net + reference'),
    ('avis_debit', 'cheque / lettre_change / virement / tableau_amortissement_emprunt / echeancier_leasing', 'pièce d''origine', 'reference_piece'),
    ('avis_debit', 'facture_banque (commissions)', 'charges financières déductibles et TVA récupérable', 'commissions + tva + date'),
    ('avis_credit', 'releve_bancaire', 'justifie une ligne', 'compte_rib + date_operation + montant_net + reference'),
    ('avis_credit', 'cheque / lettre_change / virement / tableau_amortissement_emprunt / echeancier_leasing', 'pièce d''origine', 'reference_piece'),
    ('avis_credit', 'facture_banque (commissions)', 'charges financières déductibles et TVA récupérable', 'commissions + tva + date'),
    ('cheque', 'releve_bancaire', 'débit chez le tireur / crédit chez le bénéficiaire', 'numero_cheque + montant'),
    ('cheque', 'facture fournisseur ou client', 'règlement', 'talon_objet / beneficiaire + montant'),
    ('cheque', 'bordereau de remise de chèques', 'encaissement (côté bénéficiaire)', 'numero_cheque + banque tirée + montant'),
    ('cheque', 'talon', 'même formule', 'numero_cheque'),
    ('cheque', 'certificat de non-paiement / avis d''impayé', 'rejet', 'numero_cheque + date_presentation'),
    ('lettre_change', 'facture de vente/achat', 'règlement à terme', 'reference_facture / valeur_en + montant + tiers'),
    ('lettre_change', 'releve_bancaire (tiré)', 'débit à l''échéance', 'numero_lc + echeance + montant'),
    ('lettre_change', 'releve_bancaire (tireur)', 'crédit (encaissement ou escompte, net d''agios)', 'numero_lc + montant'),
    ('lettre_change', 'bordereau d''escompte / d''encaissement', 'remise en banque', 'numero_lc'),
    ('lettre_change', 'avis_debit (impayé)', 'contre-passation', 'numero_lc + montant + frais'),
    ('billet_ordre', 'facture / contrat de prêt', 'règlement ou garantie', 'valeur_en + montant'),
    ('billet_ordre', 'releve_bancaire', 'débit à l''échéance (souscripteur) / crédit (bénéficiaire)', 'montant + echeance'),
    ('billet_ordre', 'tableau_amortissement_emprunt', 'billets souscrits en garantie des échéances (pratique)', 'numero_pret + echeance'),
    ('virement', 'releve_bancaire', 'ligne VIR émis/reçu', 'reference_virement + montant + date_valeur'),
    ('virement', 'facture', 'règlement', 'motif (n° facture) + montant + tiers'),
    ('virement', 'journal de paie / déclaration CNSS / déclaration fiscale', 'paiement de salaires ou d''impôts', 'motif + période + montant'),
    ('virement', 'tiers (fichier fournisseurs/clients)', 'RIB du tiers', 'beneficiaire_rib'),
    ('ticket_tpe', 'releve_bancaire (commerçant)', 'crédit de remise TPE (souvent net de commission)', 'lot_date + numero_contrat_commercant + lot_total'),
    ('ticket_tpe', 'releve_bancaire (porteur)', 'débit carte', 'date + montant + enseigne'),
    ('ticket_tpe', 'facture / ticket de caisse', 'encaissement d''une vente ou paiement d''un achat', 'date_heure + montant'),
    ('ticket_tpe', 'avis_debit (commission commerçant)', 'coût de l''encaissement', 'lot_numero'),
    ('tableau_amortissement_emprunt', 'releve_bancaire', 'crédit au déblocage puis débit à chaque échéance', 'numero_pret + ech_date + ech_montant_total'),
    ('tableau_amortissement_emprunt', 'contrat de prêt', 'document source (taux, garanties)', 'numero_pret'),
    ('tableau_amortissement_emprunt', 'billet_ordre', 'garantie éventuelle', 'numero_pret + echeance'),
    ('tableau_amortissement_emprunt', 'bilan (dettes financières) / états financiers', 'CRD à la clôture, part à moins d''un an, charges financières', 'ech_crd_fin à la date de clôture'),
    ('tableau_amortissement_emprunt', 'immobilisation financée', 'objet du crédit', 'objet'),
    ('echeancier_leasing', 'releve_bancaire', 'prélèvement de chaque loyer TTC', 'numero_contrat + loyer_date + loyer_ttc'),
    ('echeancier_leasing', 'facture de loyer leasing', 'TVA déductible, charge ou dette selon traitement comptable', 'numero_contrat + loyer_rang'),
    ('echeancier_leasing', 'immobilisation / registre des biens', 'bien loué, levée d''option', 'bien_designation + numero_contrat'),
    ('echeancier_leasing', 'facture fournisseur du bien', 'valeur d''origine', 'valeur_ht + fournisseur_bien')
  ) as v(grille, vers, nature, cle)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, vers, nature, cle) do nothing;

insert into ref.grille_preuves (grille_id, code, regle, genre, expression, statut, variante)
select g.id, v.code, v.regle, v.genre, v.expression, v.statut, v.variante
  from (values
    ('facture', 'P01', 'Somme des montant_ligne_ht - remise_globale = total_ht', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('facture', 'P02', 'quantite x prix_unitaire_ht x (1 - remise) = montant_ligne_ht (tolérance d''arrondi au millime)', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('facture', 'P03', 'Pour chaque taux : base_tva x taux = montant_tva (tolérance 1 millime par ligne)', 'arithmetique', '{"op": "groupe_taux", "base": "base_tva_par_taux", "montant": "montant_tva_par_taux", "total_base": "total_ht", "bareme": "tva", "exoneration": "mention_suspension_exoneration"}'::jsonb, 'defaut_a_valider', null::text),
    ('facture', 'P04', 'total_ht + FODEC + somme TVA + droit de timbre (+ droit de consommation) = total_ttc', 'arithmetique', '{"op": "somme", "total": "total_ttc", "parties": ["total_ht", "montant_tva_par_taux", "montant_fodec?", "droit_timbre?"]}'::jsonb, 'defaut_a_valider', 'ttc_avec_timbre'),
    ('facture', 'P05', 'Matricule fiscal au format tunisien (7 chiffres + clé lettre + code TVA + catégorie + 3 chiffres d''établissement)', 'format', '{"op": "format", "champ": "matricule_fiscal_emetteur", "format": "matricule_fiscal"}'::jsonb, 'defaut_a_valider', null::text),
    ('facture', 'P05b', 'Matricule fiscal au format tunisien (7 chiffres + clé lettre + code TVA + catégorie + 3 chiffres d''établissement)', 'format', '{"op": "format", "champ": "matricule_fiscal_client", "format": "matricule_fiscal"}'::jsonb, 'defaut_a_valider', null::text),
    ('facture', 'P06', 'Numéros de facture d''un même émetteur continus sans trou ni doublon sur l''exercice', 'unicite', null::jsonb, 'a_traduire', null::text),
    ('facture', 'P07', 'Couple (matricule_fiscal_emetteur, numero_facture) unique dans le tenant', 'unicite', null::jsonb, 'a_traduire', null::text),
    ('facture', 'P08', 'Facture d''achat sans MF émetteur ou sans TVA détaillée : TVA non déductible (alerte, verdict par moteur déterministe)', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('facture', 'P09', 'Facture de vente à un client soumis à déclaration d''existence sans MF client : non conforme', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('facture', 'P10', 'Si l''émetteur relève d''une obligation de facturation électronique (services depuis 01/01/2026, DGE avec l''État, médicaments, hydrocarbures) et la facture n''a pas de référence TTN : alerte', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('facture', 'P11', 'Montant TTC = montant du règlement rapproché (moins retenue à la source éventuelle)', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('facture', 'P12', 'date_operation non postérieure à la date de scan et cohérente avec l''exercice', 'format', null::jsonb, 'a_traduire', null::text),
    ('facture', 'M01', 'Droit de timbre imprimé = montant fixe du pack (ref.fiscal_charges, DROIT_TIMBRE) — preuve ajoutée par Malica', 'arithmetique', '{"op": "charge", "montant": "droit_timbre", "code": "DROIT_TIMBRE"}'::jsonb, 'defaut_a_valider', null::text),
    ('facture', 'M02', 'FODEC imprimé = arrondi(total HT × taux du pack) (ref.fiscal_charges, FODEC) — preuve ajoutée par Malica ; une facture dont le FODEC ne porte que sur une partie des lignes n''est pas prouvée (signalée, jamais faussement prouvée)', 'arithmetique', '{"op": "charge", "montant": "montant_fodec", "code": "FODEC", "base": "total_ht"}'::jsonb, 'defaut_a_valider', null::text),
    ('facture', 'M03', 'Variante TTC hors timbre : total_ttc = total HT + TVA + FODEC — preuve ajoutée par Malica', 'arithmetique', '{"op": "somme", "total": "total_ttc", "parties": ["total_ht", "montant_tva_par_taux", "montant_fodec?"]}'::jsonb, 'defaut_a_valider', 'ttc_hors_timbre'),
    ('facture', 'M04', 'Variante TTC hors timbre : net à payer = total TTC + droit de timbre — preuve ajoutée par Malica', 'arithmetique', '{"op": "somme", "total": "net_a_payer", "parties": ["total_ttc", "droit_timbre?"]}'::jsonb, 'defaut_a_valider', 'ttc_hors_timbre'),
    ('facture_electronique', 'P01', 'Le XML valide le schéma XSD TEIF officiel de la version déclarée', 'format', null::jsonb, 'a_traduire', null::text),
    ('facture_electronique', 'P02', 'La signature électronique est valide et le certificat non révoqué à la date de signature', 'format', null::jsonb, 'a_traduire', null::text),
    ('facture_electronique', 'P03', 'La référence TTN est présente et unique', 'unicite', null::jsonb, 'a_traduire', null::text),
    ('facture_electronique', 'P04', 'Montants du XML = montants de la copie PDF/papier scannée', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('facture_electronique', 'P05', 'I-176 + taxes = I-180 (contrôles arithmétiques identiques à la facture)', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('avoir', 'P01', 'La facture d''origine existe dans le tenant et le total de ses avoirs n''excède pas son montant', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('avoir', 'P02', 'Taux de TVA de l''avoir = taux de la ligne d''origine', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('avoir', 'P03', 'HT + TVA (+ FODEC) = TTC', 'arithmetique', '{"op": "somme", "total": "total_ttc", "parties": ["total_ht", "montant_tva", "montant_fodec?"]}'::jsonb, 'defaut_a_valider', null::text),
    ('avoir', 'P04', 'Numéro d''avoir unique par émetteur', 'unicite', null::jsonb, 'a_traduire', null::text),
    ('devis_proforma', 'P01', 'Somme des lignes = total HT ; HT + TVA = TTC', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('devis_proforma', 'P02', 'Un devis ou une proforma ne doit jamais être comptabilisé comme facture (pas d''écriture, pas de TVA déductible)', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('devis_proforma', 'P03', 'Écart de prix devis / facture finale au-delà d''un seuil paramétré : alerte', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('bon_commande', 'P01', 'Quantité facturée <= quantité commandée ; prix facturé = prix commandé (tolérance paramétrée)', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('bon_commande', 'P02', 'Numéro de commande unique pour l''acheteur', 'unicite', null::jsonb, 'a_traduire', null::text),
    ('bon_commande', 'P03', 'Commande au-delà du plafond d''approbation sans signature habilitée : alerte', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('bon_livraison', 'P01', 'Quantités livrées cumulées <= quantités commandées', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('bon_livraison', 'P02', 'Tout BL de vente est facturé dans un délai paramétré (BL non facturés = risque de chiffre d''affaires non déclaré)', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('bon_livraison', 'P03', 'Numéros de BL continus', 'unicite', null::jsonb, 'a_traduire', null::text),
    ('bon_reception', 'P01', 'Quantité facturée <= quantité acceptée', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('bon_reception', 'P02', 'Facture d''achat de biens sans bon de réception rapproché : alerte', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('ticket_caisse', 'P01', 'Somme des lignes = total', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('ticket_caisse', 'P02', 'Ticket d''achat seul : TVA non récupérable (alerte, demander une facture)', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('ticket_caisse', 'P03', 'Dépense en espèces au-delà d''un seuil : alerte (seuil légal de paiement en espèces INCERTAIN)', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('recu_quittance', 'P01', 'Loyer + charges + TVA - retenue = montant reçu', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('recu_quittance', 'P02', 'Montant en chiffres = montant en lettres', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('recu_quittance', 'P03', 'Une quittance par période, sans trou ni doublon sur la durée du bail', 'unicite', null::jsonb, 'a_traduire', null::text),
    ('recu_quittance', 'P04', 'Loyer constant entre deux révisions prévues au bail', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('note_frais', 'P01', 'Somme des lignes = total ; total - avance = net à rembourser', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('note_frais', 'P01b', 'Partie de P01 : total - avance = net à rembourser', 'arithmetique', '{"op": "somme", "total": "net_a_rembourser", "parties": ["total_frais", "-avance_recue?"]}'::jsonb, 'defaut_a_valider', null::text),
    ('note_frais', 'P02', 'Chaque ligne a un justificatif rapproché de même montant et date', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('note_frais', 'P03', 'Un même justificatif n''est pas remboursé deux fois', 'unicite', null::jsonb, 'a_traduire', null::text),
    ('note_frais', 'P04', 'Frais au-delà d''un plafond interne paramétré : alerte', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('facture_service_public', 'P01', '(nouvel index - ancien index) x coefficient = consommation', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('facture_service_public', 'P02', 'HT + TVA + autres taxes + timbre + arriérés = montant à payer', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('facture_service_public', 'P03', 'Ancien index = nouvel index de la facture précédente du même compteur', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('facture_service_public', 'P04', 'Une facture par compteur et par période', 'unicite', null::jsonb, 'a_traduire', null::text),
    ('facture_service_public', 'P05', 'Abonnement non au nom de l''entreprise : TVA non déductible (alerte)', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('facture_service_public', 'P06', 'Variation de consommation > seuil paramétré vs moyenne : alerte', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('bilan', 'P01', 'Total des actifs = Total des capitaux propres et des passifs (N et N−1)', 'arithmetique', '{"op": "egal", "a": "total_actifs", "b": "total_cp_et_passifs"}'::jsonb, 'defaut_a_valider', null::text),
    ('bilan', 'P02', 'Chaque sous-total = somme de ses lignes ; net = brut − amortissements/provisions', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('bilan', 'P03', 'Total passifs = passifs non courants + passifs courants ; total actifs = actifs non courants + actifs courants', 'arithmetique', '{"op": "somme", "total": "total_passifs", "parties": ["total_passifs_non_courants", "total_passifs_courants"]}'::jsonb, 'defaut_a_valider', null::text),
    ('bilan', 'P03b', 'Total passifs = passifs non courants + passifs courants ; total actifs = actifs non courants + actifs courants', 'arithmetique', '{"op": "somme", "total": "total_actifs", "parties": ["total_actifs_non_courants", "total_actifs_courants"]}'::jsonb, 'defaut_a_valider', null::text),
    ('bilan', 'P04', 'Résultat de l''exercice (bilan) = Résultat net (état de résultat)', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('bilan', 'P05', 'Colonne N−1 = colonne N du bilan N−1 archivé, sauf retraitement expliqué en note (modification comptable)', 'continuite', null::jsonb, 'a_traduire', null::text),
    ('bilan', 'P06', 'Résultats reportés N = résultats reportés N−1 + résultat N−1 − dividendes et dotations aux réserves (PV d''AGO)', 'continuite', null::jsonb, 'a_traduire', null::text),
    ('bilan', 'P07', 'Liquidités du bilan cohérentes avec la trésorerie de clôture de l''état des flux (après prise en compte des concours bancaires si inclus dans la trésorerie)', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('bilan', 'P08', 'Monnaie = TND', 'format', null::jsonb, 'a_traduire', null::text),
    ('bilan', 'P09', 'Date de clôture : exercice de 12 mois (sauf premier exercice / changement)', 'format', null::jsonb, 'a_traduire', null::text),
    ('bilan', 'P10', 'Total actif ≥ 0 ; montants nets ≥ 0 sauf résultat et capitaux propres', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('etat_resultat', 'P01', 'Résultat d''exploitation = total produits d''exploitation − total charges d''exploitation', 'arithmetique', '{"op": "somme", "total": "resultat_exploitation", "parties": ["total_produits_exploitation", "-total_charges_exploitation"]}'::jsonb, 'defaut_a_valider', null::text),
    ('etat_resultat', 'P02', 'Résultat AO avant impôt = résultat d''exploitation − charges financières nettes + produits des placements + autres gains − autres pertes', 'arithmetique', '{"op": "somme", "total": "resultat_ao_avant_impot", "parties": ["resultat_exploitation", "-charges_financieres_nettes?", "produits_placements?", "autres_gains_ordinaires?", "-autres_pertes_ordinaires?"]}'::jsonb, 'defaut_a_valider', null::text),
    ('etat_resultat', 'P03', 'Résultat net = résultat AO après impôt ± éléments extraordinaires', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('etat_resultat', 'P04', 'Résultat net = résultat de l''exercice au bilan', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('etat_resultat', 'P05', 'Résultat net = solde (classe 7 − classe 6) de la balance de clôture', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('etat_resultat', 'P06', 'Colonne N−1 = colonne N de l''état précédent', 'continuite', null::jsonb, 'a_traduire', null::text),
    ('etat_resultat', 'P07', 'Dotations aux amortissements (part immobilisations) = Σ dotations de l''exercice des fiches d''immobilisation, à l''arrondi près', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('etat_resultat', 'P08', 'Achats consommés = achats de l''exercice + stock initial − stock final (PV d''inventaire)', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('etat_resultat', 'P09', 'Impôt sur les bénéfices ≥ minimum d''impôt applicable', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('etat_flux_tresorerie', 'P01', 'Variation de trésorerie = flux exploitation + flux investissement + flux financement (+ incidence change)', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('etat_flux_tresorerie', 'P02', 'Variation de trésorerie = trésorerie clôture − trésorerie début', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('etat_flux_tresorerie', 'P03', 'Trésorerie début N = trésorerie clôture N−1 (état précédent)', 'continuite', null::jsonb, 'a_traduire', null::text),
    ('etat_flux_tresorerie', 'P04', 'Trésorerie clôture = liquidités et équivalents − concours bancaires (selon définition donnée en note) au bilan', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('etat_flux_tresorerie', 'P05', 'Méthode indirecte : premier élément = résultat net de l''état de résultat', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('etat_flux_tresorerie', 'P06', 'Ajustement amortissements et provisions ≈ dotations − reprises de l''état de résultat', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('notes_etats_financiers', 'P01', 'Brut clôture = brut ouverture + acquisitions ± reclassements − cessions (+ réévaluation) par rubrique et au total', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('notes_etats_financiers', 'P02', 'Amortissements clôture = ouverture + dotations − reprises/sorties', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('notes_etats_financiers', 'P03', 'Brut et amortissements du tableau = lignes du bilan', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('notes_etats_financiers', 'P04', 'Dotations du tableau = dotations aux amortissements de l''état de résultat (hors provisions)', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('notes_etats_financiers', 'P05', 'Ouverture N = clôture N−1 des notes précédentes', 'continuite', null::jsonb, 'a_traduire', null::text),
    ('notes_etats_financiers', 'P06', 'Tableau de variation des capitaux propres : solde de clôture = total capitaux propres au bilan', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('notes_etats_financiers', 'P07', 'Renvois de notes cohérents (la note citée traite bien du poste) — incohérence relevée dans EF CNT 2024 (réserves renvoyant à la note emprunts)', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('balance_tiers', 'P01', 'Σ mouvements débit = Σ mouvements crédit ; Σ soldes débiteurs = Σ soldes créditeurs ; Σ à-nouveaux débit = Σ à-nouveaux crédit', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('balance_tiers', 'P02', 'Pour chaque compte : solde = ouverture + débit − crédit, porté du bon côté', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('balance_tiers', 'P03', 'Comptes de gestion (classes 6/7) à-nouveaux nuls en début d''exercice', 'continuite', null::jsonb, 'a_traduire', null::text),
    ('balance_tiers', 'P04', 'À-nouveaux N = soldes clôture N−1 des comptes de bilan, résultat N−1 reporté', 'continuite', null::jsonb, 'a_traduire', null::text),
    ('balance_tiers', 'P05', 'Solde (produits − charges) = résultat de l''état de résultat (balance après inventaire)', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('balance_tiers', 'P06', 'Total balance auxiliaire clients/fournisseurs = solde du compte collectif en balance générale', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('balance_tiers', 'P07', 'Numéro de compte unique par ligne ; numéro conforme au plan (commence par 1 à 7)', 'unicite', null::jsonb, 'a_traduire', null::text),
    ('grand_livre_tiers', 'P01', 'Total débit/crédit du compte = mouvements de la balance de même période', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('grand_livre_tiers', 'P02', 'Solde progressif cohérent ligne à ligne', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('grand_livre_tiers', 'P03', 'Dates croissantes à l''intérieur d''un journal ; toutes dans la période', 'format', null::jsonb, 'a_traduire', null::text),
    ('grand_livre_tiers', 'P04', 'Chaque écriture (même n°) équilibrée débit = crédit tous comptes confondus', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('grand_livre_tiers', 'P05', 'Référence de pièce présente pour chaque ligne', 'format', null::jsonb, 'a_traduire', null::text),
    ('grand_livre_tiers', 'P06', 'Numéro d''écriture unique par journal et exercice', 'unicite', null::jsonb, 'a_traduire', null::text),
    ('grand_livre_tiers', 'P07', 'Lignes lettrées : Σ débits = Σ crédits par code de lettrage', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('facture_acquisition_immobilisation', 'P01', 'Σ lignes HT = total HT ; TVA = HT × taux ; TTC = HT + TVA + timbre', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('facture_acquisition_immobilisation', 'P02', 'Facture en devise : montant DT = montant devise × cours du jour de l''opération', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('facture_acquisition_immobilisation', 'P03', 'Matricule fiscal au format attendu (clé de contrôle)', 'format', null::jsonb, 'a_traduire', null::text),
    ('facture_acquisition_immobilisation', 'P04', 'Un même (fournisseur, numéro de facture) n''est saisi qu''une fois', 'unicite', null::jsonb, 'a_traduire', null::text),
    ('facture_acquisition_immobilisation', 'P05', 'Bien de faible valeur (≤ 500 DT selon PwC) : peut être passé en charge fiscalement', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('contrat_acquisition_immobilisation', 'P01', 'Σ échéances de paiement = prix', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('contrat_acquisition_immobilisation', 'P02', 'Prix terrain + prix construction = prix total', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('contrat_acquisition_immobilisation', 'P03', 'Valeur d''origine en fiche = prix + droits et frais d''acquisition', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('fiche_immobilisation', 'P01', 'VNC fin = VO − cumul amortissements − dépréciations', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('fiche_immobilisation', 'P02', 'Dotation pleine année = base amortissable × taux ; année d''entrée = × prorata (jours/360 ou 365 selon convention de l''entité)', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('fiche_immobilisation', 'P03', 'Cumul amortissements ≤ base amortissable ; dotation nulle après amortissement complet ; terrain non amorti', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('fiche_immobilisation', 'P04', 'VNC début N = VNC fin N−1', 'continuite', null::jsonb, 'a_traduire', null::text),
    ('fiche_immobilisation', 'P05', 'Σ dotations des fiches = dotations aux amortissements de l''exercice (état de résultat et tableau des immobilisations)', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('fiche_immobilisation', 'P06', 'Σ VO des fiches par catégorie = brut au bilan / note ; Σ cumuls = amortissements au bilan', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('fiche_immobilisation', 'P07', 'Taux comptable > taux fiscal max ⇒ réintégration attendue dans la déclaration d''IS', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('fiche_immobilisation', 'P08', 'Plus-value = prix de cession − VNC à la date de sortie', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('fiche_immobilisation', 'P09', 'Code d''inventaire unique', 'unicite', null::jsonb, 'a_traduire', null::text),
    ('pv_inventaire_stocks', 'P01', 'Valeur ligne = quantité comptée × coût unitaire ; Σ lignes = totaux', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('pv_inventaire_stocks', 'P02', 'Écart = quantité comptée − quantité théorique', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('pv_inventaire_stocks', 'P03', 'Valeur totale (après dépréciation) = stocks au bilan de la date de référence', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('pv_inventaire_stocks', 'P04', 'Séquence des fiches de comptage continue, aucune fiche manquante', 'continuite', null::jsonb, 'a_traduire', null::text),
    ('pv_inventaire_stocks', 'P05', 'Un code article apparaît une fois par emplacement', 'unicite', null::jsonb, 'a_traduire', null::text),
    ('pv_inventaire_stocks', 'P06', 'Date d''inventaire dans l''exercice (ou mouvements de passage documentés)', 'format', null::jsonb, 'a_traduire', null::text),
    ('pv_inventaire_stocks', 'P07', 'Écart de valeur supérieur au seuil de matérialité défini par l''entité ⇒ analyse obligatoire', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('declaration_douane_import', 'P01', 'Valeur en douane DT = montant facture devise × cours de la date d''enregistrement (+ fret + assurance jusqu''à la frontière si non inclus)', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('declaration_douane_import', 'P02', 'Droit de douane = valeur en douane de l''article × taux (ad valorem)', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('declaration_douane_import', 'P03', 'Σ valeurs des articles = valeur en douane totale ; Σ droits et taxes = total liquidé', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('declaration_douane_import', 'P04', 'Base TVA import = valeur en douane + droits de douane + droit de consommation (à confirmer)', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('declaration_douane_import', 'P05', 'Cours appliqué = cours officiel de la date d''enregistrement (tolérance d''arrondi)', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('declaration_douane_import', 'P06', 'Poids net ≤ poids brut', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('declaration_douane_import', 'P07', 'Position tarifaire : format numérique de longueur attendue (NGP)', 'format', null::jsonb, 'a_traduire', null::text),
    ('declaration_douane_import', 'P08', 'Numéro d''enregistrement unique par bureau et année', 'unicite', null::jsonb, 'a_traduire', null::text),
    ('declaration_douane_import', 'P09', 'Montant payé (quittance) = total liquidé', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('declaration_douane_export', 'P01', 'Valeur DT = montant devise × cours de la date d''enregistrement', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('declaration_douane_export', 'P02', 'Montant facture export = montant déclaré (tolérance d''arrondi)', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('declaration_douane_export', 'P03', 'Encaissement client (devise) rapproché de la facture ; écart de change en résultat financier', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('declaration_douane_export', 'P04', 'Numéro d''enregistrement unique', 'unicite', null::jsonb, 'a_traduire', null::text),
    ('document_dedouanement', 'P01', 'Montant quittance = total liquidé de la déclaration (+ liquidation complémentaire)', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('document_dedouanement', 'P02', 'Date BAE ≥ date d''enregistrement ; date de sortie ≥ date BAE', 'format', null::jsonb, 'a_traduire', null::text),
    ('document_dedouanement', 'P03', 'Paiement à crédit : échéance ≤ 90 jours après enlèvement (à confirmer)', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('document_dedouanement', 'P04', 'Numéro de quittance unique', 'unicite', null::jsonb, 'a_traduire', null::text),
    ('certificat_origine', 'P01', 'Désignation, colis et masse cohérents avec la facture et la déclaration', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('certificat_origine', 'P02', 'Date de visa ≤ date d''expédition (sauf délivrance a posteriori mentionnée en observations)', 'format', null::jsonb, 'a_traduire', null::text),
    ('certificat_origine', 'P03', 'Pays d''origine ≠ vide ; cohérent avec l''accord indiqué', 'format', null::jsonb, 'a_traduire', null::text),
    ('certificat_origine', 'P04', 'Numéro de certificat unique', 'unicite', null::jsonb, 'a_traduire', null::text),
    ('certificat_origine', 'P05', 'Durée de validité du certificat respectée à l''import (durée par accord)', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('contrat_assurance', 'P01', 'Prime TTC = prime nette + accessoires + taxes', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('contrat_assurance', 'P02', 'Date d''effet ≤ échéance ; période de couverture continue d''un renouvellement à l''autre (pas de trou)', 'continuite', null::jsonb, 'a_traduire', null::text),
    ('contrat_assurance', 'P03', 'Prime de l''exercice : charge = part courue ; part non courue en charges constatées d''avance à la clôture', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('contrat_assurance', 'P04', 'Capital assuré ≥ valeur de remplacement estimée (sinon risque de règle proportionnelle)', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('contrat_assurance', 'P05', 'Tout véhicule de la société a une attestation valide à date', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('contrat_assurance', 'P06', 'Numéro de police unique par assureur', 'unicite', null::jsonb, 'a_traduire', null::text),
    ('avis_echeance_assurance', 'P01', 'Montant TTC = prime nette + accessoires + taxes', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('avis_echeance_assurance', 'P02', 'Prime nette cohérente avec la police / dernier avenant (écart = indexation ou bonus-malus à expliquer)', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('avis_echeance_assurance', 'P03', 'Périodes couvertes successives contiguës', 'continuite', null::jsonb, 'a_traduire', null::text),
    ('avis_echeance_assurance', 'P04', 'Paiement bancaire = montant TTC à la date proche de l''échéance', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('avis_echeance_assurance', 'P05', 'Numéro d''avis unique', 'unicite', null::jsonb, 'a_traduire', null::text),
    ('carte_grise', 'P01', 'Châssis (VIN) de 17 caractères alphanumériques sans I, O, Q (norme ISO 3779) pour les véhicules récents', 'format', null::jsonb, 'a_traduire', null::text),
    ('carte_grise', 'P02', 'Châssis identique sur facture, fiche d''immobilisation, contrat de leasing et police d''assurance', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('carte_grise', 'P03', 'Propriétaire = société (ou bailleur si leasing) ; sinon véhicule hors patrimoine à signaler', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('carte_grise', 'P04', 'Date de 1re mise en circulation ≤ date de délivrance', 'format', null::jsonb, 'a_traduire', null::text),
    ('carte_grise', 'P05', 'Immatriculation unique dans le parc de l''entité', 'unicite', null::jsonb, 'a_traduire', null::text),
    ('vignette', 'P01', 'Montant = barème(année, catégorie de redevable, tranche de CV) ; personne morale non exonérée = 2 × tarif particulier (barème 2022 : ≤4 CV 130 DT ; 5-7 CV 260 DT ; 8-9 CV 360 DT ; 10-11 CV 460 DT ; 12-13 CV 2 100 DT ; 14-15 CV 2 800 DT ; ≥16 CV 4 200 DT) — barème 2026 révisé à intégrer', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('vignette', 'P02', 'Puissance fiscale = celle de la carte grise', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('vignette', 'P03', 'Date de paiement ≤ échéance légale, sinon pénalités attendues', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('vignette', 'P04', 'Une vignette par véhicule et par année', 'unicite', null::jsonb, 'a_traduire', null::text),
    ('vignette', 'P05', 'Tous les véhicules immobilisés au 1er janvier ont une vignette de l''année', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('contrat_leasing', 'P01', 'Loyer HT de l''échéance = part capital + part intérêts', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('contrat_leasing', 'P02', 'Σ parts capital (+ premier loyer majoré imputé + valeur résiduelle) = montant financé', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('contrat_leasing', 'P03', 'Capital restant dû(n) = capital restant dû(n−1) − part capital(n) ; dernier CRD = valeur résiduelle ou 0', 'continuite', null::jsonb, 'a_traduire', null::text),
    ('contrat_leasing', 'P04', 'Loyer TTC = loyer HT + TVA ; nombre d''échéances = nombre de loyers ; dates espacées selon la périodicité', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('contrat_leasing', 'P05', 'Chaque échéance ↔ un prélèvement bancaire de même montant TTC à date ± tolérance paramétrable ; échéance sans prélèvement = impayé à signaler', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('contrat_leasing', 'P06', 'Taux implicite recalculé (TRI des flux) ≈ taux affiché', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('contrat_leasing', 'P07', 'Coût d''entrée à l''actif = min(juste valeur, valeur actualisée des paiements minimaux)', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('contrat_leasing', 'P08', 'Durée d''amortissement fiscal ≥ minimum de la catégorie (transport 3 ans, machines 4 ans, constructions 7 ans)', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('contrat_leasing', 'P09', 'Dette de leasing au bilan = CRD à la date de clôture (ventilé < 1 an / > 1 an)', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('contrat_leasing', 'P10', 'Numéro de contrat unique par bailleur', 'unicite', null::jsonb, 'a_traduire', null::text),
    ('declaration_mensuelle', 'P01', 'TVA à chaque taux = base HT × taux (tolérance d''arrondi au millime)', 'arithmetique', '{"op": "taux", "montant": "tva_19", "base": "ca_taxable_19", "bareme": "tva"}'::jsonb, 'defaut_a_valider', null::text),
    ('declaration_mensuelle', 'P01b', 'TVA à chaque taux = base HT × taux (tolérance d''arrondi au millime)', 'arithmetique', '{"op": "taux", "montant": "tva_13", "base": "ca_taxable_13", "bareme": "tva"}'::jsonb, 'defaut_a_valider', null::text),
    ('declaration_mensuelle', 'P01c', 'TVA à chaque taux = base HT × taux (tolérance d''arrondi au millime)', 'arithmetique', '{"op": "taux", "montant": "tva_7", "base": "ca_taxable_7", "bareme": "tva"}'::jsonb, 'defaut_a_valider', null::text),
    ('declaration_mensuelle', 'P02', 'TVA à payer = max(0, TVA collectée − TVA déductible − crédit reporté) ; crédit à reporter = max(0, inverse)', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('declaration_mensuelle', 'P03', 'Crédit reporté du mois M = crédit à reporter du mois M-1 (moins restitution obtenue)', 'continuite', null::jsonb, 'a_traduire', null::text),
    ('declaration_mensuelle', 'P04', 'Σ TVA des factures de vente du mois = TVA collectée déclarée (écart à expliquer : avoirs, encaissements pour prestations si règle d''exigibilité différente)', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('declaration_mensuelle', 'P05', 'TVA déductible ≤ Σ TVA des factures d''achat conformes + TVA import justifiée + certificats TVA ; exclure voitures de tourisme, fournisseurs forfaitaires, paiements espèces ≥ 5 000 DT HT', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('declaration_mensuelle', 'P06', 'TFP = base × 2 % (ou 1 %) ; FOPROLOS = base × 1 % ; base identique = Σ bruts des bulletins du mois', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('declaration_mensuelle', 'P07', 'TCL = 0,2 % CA local + 0,1 % CA export', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('declaration_mensuelle', 'P08', 'Droit de timbre = nombre de factures soumises × tarif en vigueur à la date de facture', 'arithmetique', '{"op": "produit", "total": "timbre_montant", "facteurs": ["timbre_nombre_factures", "timbre_tarif"]}'::jsonb, 'defaut_a_valider', null::text),
    ('declaration_mensuelle', 'P09', 'Total = somme des lignes ; net à payer = total + pénalités', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('declaration_mensuelle', 'P09b', 'Partie de P09 : net à payer = total + pénalités', 'arithmetique', '{"op": "somme", "total": "total_a_payer", "parties": ["total_principal", "penalites_retard?"]}'::jsonb, 'defaut_a_valider', null::text),
    ('declaration_mensuelle', 'P10', 'Retenue achats appliquée uniquement si paiement > 1 000 DT TTC', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('declaration_mensuelle', 'P11', 'Date de dépôt ≤ échéance (20 PM télédéclarante / 28 PM / 15 PP, reportée au jour ouvrable suivant) sinon pénalités attendues', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('declaration_mensuelle', 'P12', 'Une seule déclaration initiale par matricule+établissement+mois ; les suivantes sont rectificatives', 'unicite', null::jsonb, 'a_traduire', null::text),
    ('declaration_mensuelle', 'P13', '12 déclarations par exercice sans trou de période', 'continuite', null::jsonb, 'a_traduire', null::text),
    ('declaration_mensuelle', 'P14', 'Montant de la quittance = net à payer', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('acompte_provisionnel', 'P01', 'Montant brut = 30 % × impôt N-1 déclaré (tolérance millime)', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('acompte_provisionnel', 'P02', '3 acomptes par exercice, rangs 1-2-3 uniques', 'unicite', null::jsonb, 'a_traduire', null::text),
    ('acompte_provisionnel', 'P03', 'Pas d''acompte la première année d''activité', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('acompte_provisionnel', 'P04', 'Σ acomptes payés N = ligne « acomptes provisionnels » de la déclaration annuelle N', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('acompte_provisionnel', 'P05', 'Date ≤ 28 (PM) / 25 (PP) de juin, septembre, décembre (report jour ouvrable)', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('declaration_annuelle_is_irpp', 'P01', 'IS calculé = bénéfice imposable × taux applicable', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('declaration_annuelle_is_irpp', 'P02', 'Minimum = max(0,2 % × CA local TTC ; 500 DT) (ou 0,1 % / 300 DT) ; IS dû = max(IS calculé, minimum) sauf exonération totale', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('declaration_annuelle_is_irpp', 'P03', 'Reste à payer = IS dû + contributions − acomptes − retenues − excédent antérieur', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('declaration_annuelle_is_irpp', 'P04', 'Résultat comptable = résultat net des états financiers', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('declaration_annuelle_is_irpp', 'P05', 'Σ certificats de retenue reçus de l''exercice = retenues imputées', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('declaration_annuelle_is_irpp', 'P06', 'Dépôt ≤ 25 mars (25 juin si audit légal)', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('declaration_annuelle_is_irpp', 'P07', 'CA ≥ 20 MDT ⇒ documentation prix de transfert attendue', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('declaration_annuelle_is_irpp', 'P08', 'Une déclaration initiale par matricule+exercice', 'unicite', null::jsonb, 'a_traduire', null::text),
    ('declaration_employeur', 'P01', 'Total général (DECEMP50) = Σ des totaux de retenues des enregistrements 01 à 49', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('declaration_employeur', 'P02', 'Pour chaque nature : Σ retenues des annexes = total du récapitulatif', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('declaration_employeur', 'P03', 'Annexe I : brut imposable = revenu imposable + avantages ; net servi = brut − retenues', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('declaration_employeur', 'P04', 'Annexe II nature 0 : brut > 0, retenues = 0, net = 0', 'format', null::jsonb, 'a_traduire', null::text),
    ('declaration_employeur', 'P05', 'Σ retenues annuelles du récapitulatif = Σ des 12 déclarations mensuelles (même natures)', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('declaration_employeur', 'P06', 'Indicateur annexe = 0 ⇔ fichier d''annexe présent', 'format', null::jsonb, 'a_traduire', null::text),
    ('declaration_employeur', 'P07', 'Un bénéficiaire n''apparaît qu''une fois par annexe (agrégation annuelle)', 'unicite', null::jsonb, 'a_traduire', null::text),
    ('declaration_employeur', 'P08', 'Dépôt ≤ 30 avril N+1', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('certificat_retenue_source', 'P01', 'Montant retenue = brut × taux (tolérance millime)', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('certificat_retenue_source', 'P02', 'Net servi = brut − retenue IR/IS − retenue TVA − CSS', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('certificat_retenue_source', 'P03', 'Achats : retenue seulement si brut > 1 000 DT TTC', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('certificat_retenue_source', 'P04', 'Taux cohérent avec nature et statut du bénéficiaire (10 % / 3 % / 1,5 % / 1 % / 0,5 % / 15 % / 20 % / 25 %)', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('certificat_retenue_source', 'P05', 'Date d''émission ≤ dernier jour du mois suivant date de paiement', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('certificat_retenue_source', 'P06', 'Numéro de certificat unique ; un paiement ne génère pas deux certificats initiaux', 'unicite', null::jsonb, 'a_traduire', null::text),
    ('certificat_retenue_source', 'P07', 'Format du matricule payeur et bénéficiaire valide', 'format', null::jsonb, 'a_traduire', null::text),
    ('certificat_retenue_source', 'P08', 'Σ certificats émis du mois = retenues déclarées dans la mensuelle (par nature)', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('quittance_paiement', 'P01', 'Total payé = principal + pénalités ; = net à payer du document déclaratif', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('quittance_paiement', 'P02', 'Montant en lettres = montant en chiffres', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('quittance_paiement', 'P03', 'Numéro de quittance unique', 'unicite', null::jsonb, 'a_traduire', null::text),
    ('quittance_paiement', 'P04', 'Date de paiement ≤ échéance de la déclaration liée, sinon pénalités attendues', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('carte_identification_fiscale', 'P01', 'Format MF : ^[0-9]{7}[A-HJ-NP-TV-Z][ABDNP][CEMNP][0-9]{3}$ (après normalisation des séparateurs)', 'format', null::jsonb, 'a_traduire', null::text),
    ('carte_identification_fiscale', 'P02', 'Établissement ≠ 000 ⇒ catégorie E', 'format', null::jsonb, 'a_traduire', null::text),
    ('carte_identification_fiscale', 'P03', 'Un seul MF par tenant (les établissements partagent l''identifiant 7 chiffres + clé)', 'unicite', null::jsonb, 'a_traduire', null::text),
    ('carte_identification_fiscale', 'P04', 'Raison sociale/adresse = celles des factures et déclarations récentes, sinon mise à jour à demander', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('attestation_situation_fiscale', 'P01', 'Date du jour ≤ date de fin de validité au moment de l''usage', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('attestation_situation_fiscale', 'P02', 'Malica ne doit pas montrer d''obligation échue non déposée/non payée à la date d''arrêté (sinon incohérence à investiguer)', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('attestation_situation_fiscale', 'P03', 'MF de l''attestation = MF du tenant', 'format', null::jsonb, 'a_traduire', null::text),
    ('avis_verification', 'P01', 'date_debut − date_notification ≥ 15 jours', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('avis_verification', 'P02', 'Durée effective ≤ 6 mois (comptabilité) / 1 an (hors interruptions ≤ 60 jours)', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('avis_verification', 'P03', 'Période vérifiée non prescrite à la date de l''avis', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('avis_verification', 'P04', 'Pas de seconde vérification approfondie même impôt/même période sans informations nouvelles', 'unicite', null::jsonb, 'a_traduire', null::text),
    ('avis_verification', 'P05', 'Présence de toutes les mentions de l''art. 39 (sinon irrégularité à signaler au conseil)', 'format', null::jsonb, 'a_traduire', null::text),
    ('notification_resultats_verification', 'P01', 'Total = Σ principal des chefs + Σ pénalités', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('notification_resultats_verification', 'P02', 'Impôt rappelé d''un chef = base redressée × taux applicable − impôt déclaré', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('notification_resultats_verification', 'P03', 'Notification (préliminaire) ≤ 90 jours après expiration du délai de réponse aux demandes', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('notification_resultats_verification', 'P04', 'Date de réponse ≤ date_notification + délai légal', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('notification_resultats_verification', 'P05', 'Chaque période redressée non prescrite (ou prescription interrompue par l''avis)', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('notification_resultats_verification', 'P06', 'Mentions de l''art. 43 présentes', 'format', null::jsonb, 'a_traduire', null::text),
    ('arrete_taxation_office', 'P01', 'Paiement de suspension ≥ 10 % du principal (ou caution ≥ 15 %) dans les 60 jours', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('arrete_taxation_office', 'P02', 'Délai notification arrêté respecté', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('arrete_taxation_office', 'P03', 'Montants = montants maintenus après réponse de l''administration', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('attestation_suspension_tva', 'P01', 'Date de facture dans la période de validité de l''attestation', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('attestation_suspension_tva', 'P02', 'Σ achats en suspension ≤ plafond de l''attestation', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('attestation_suspension_tva', 'P03', 'Facture en suspension : TVA = 0 et mention + n° attestation présents', 'format', null::jsonb, 'a_traduire', null::text),
    ('attestation_suspension_tva', 'P04', 'CA export/suspension > 50 % du CA total du bénéficiaire', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('attestation_suspension_tva', 'P05', 'Liste trimestrielle déposée ≤ 28 jours après fin de trimestre', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('attestation_exoneration_non_retenue', 'P01', 'Date de l''opération dans la période de validité', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('attestation_exoneration_non_retenue', 'P02', 'Paiement sans retenue au-dessus de 1 000 DT TTC ⇒ attestation valide requise, sinon anomalie', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('attestation_exoneration_non_retenue', 'P03', 'MF de l''attestation = MF du fournisseur sur la facture', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('statuts', 'P01', 'somme(nombre de titres par associé) = nombre_titres', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('statuts', 'P02', 'nombre_titres × valeur_nominale = capital_montant', 'arithmetique', '{"op": "produit", "total": "capital_montant", "facteurs": ["nombre_titres", "valeur_nominale"]}'::jsonb, 'defaut_a_valider', null::text),
    ('statuts', 'P03', 'somme(apports numéraire) + somme(évaluations apports en nature) = capital_montant (hors prime d''émission)', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('statuts', 'P04', 'SARL : 2 <= nombre_associes <= 50 ; SUARL : nombre_associes = 1', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('statuts', 'P05', 'SA : nombre_actionnaires >= minimum légal (7 lu, INCERTAIN) et capital >= minimum légal (INCERTAIN)', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('statuts', 'P06', 'Présence des 6 mentions de l''art. 9 (forme, durée, dénomination, siège, objet, capital) ; pour SARL des 8 mentions de l''art. 96', 'format', null::jsonb, 'a_traduire', null::text),
    ('statuts', 'P07', 'SARL : dénomination contient ''S.A.R.L'' (ou ''S.U.A.R.L'') et le montant du capital dans les documents sociaux', 'format', null::jsonb, 'a_traduire', null::text),
    ('statuts', 'P08', 'SARL : déclaration de libération intégrale présente (sinon constitution non définitive)', 'format', null::jsonb, 'a_traduire', null::text),
    ('statuts', 'P09', 'Chaque apport en nature > 3 000 dinars exige un rapport de commissaire aux apports', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('statuts', 'P10', 'Gérant de SARL = personne physique', 'format', null::jsonb, 'a_traduire', null::text),
    ('statuts', 'P11', 'Une personne physique n''est associé unique que d''une seule SUARL (recoupement multi-tenant sur la même personne)', 'unicite', null::jsonb, 'a_traduire', null::text),
    ('statuts', 'P12', 'Versions de statuts : pas de chevauchement de périodes de validité ; chaque version après la première est rattachée à un PV d''AGE ou décision d''associé unique', 'continuite', null::jsonb, 'a_traduire', null::text),
    ('statuts', 'P13', 'Immatriculation dans le mois de la constitution ; publication JORT dans le mois', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('extrait_rne', 'P01', 'Format de l''identifiant unique conforme au modèle RNE (gabarit à paramétrer, INCERTAIN)', 'format', null::jsonb, 'a_traduire', null::text),
    ('extrait_rne', 'P02', 'Un identifiant unique ↔ une seule entreprise dans le référentiel du tenant', 'unicite', null::jsonb, 'a_traduire', null::text),
    ('extrait_rne', 'P03', 'Capital, forme, siège, dénomination de l''extrait = statuts en vigueur à la date de délivrance (sinon formalité en retard)', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('extrait_rne', 'P04', 'Dirigeants du dernier PV de nomination = dirigeants de l''extrait délivré plus d''un mois après', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('extrait_rne', 'P05', 'Ancienneté de l''extrait <= seuil paramétré (pratique bancaire, ex. 3 mois - INCERTAIN)', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('extrait_rne', 'P06', 'Statut ''active'' requis pour valider un contrat ou une procuration à la même date', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('pv_ago', 'P01', 'quorum_taux = titres_presents_representes / total_titres_droit_vote', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('pv_ago', 'P02', 'SARL 1re convocation : titres_presents_representes > 50 % du capital (sauf clause statutaire) ; SA : seuil INCERTAIN, paramétrable', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('pv_ago', 'P03', 'SARL 2e convocation : date_assemblee - date_premiere_assemblee >= 15 jours ; date_assemblee - date_convocation >= 8 jours', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('pv_ago', 'P04', 'SARL : date_assemblee - date_convocation >= 20 jours ; documents communiqués >= 30 jours avant (AGO annuelle)', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('pv_ago', 'P05', 'AGO annuelle : date_assemblee <= date de clôture + 6 mois', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('pv_ago', 'P06', 'Pour chaque résolution : votes_pour + votes_contre + abstentions (+ voix exclues) = titres_presents_representes (ou nombre de votants déclaré)', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('pv_ago', 'P07', 'Résolution adoptée ⇔ votes_pour >= majorité requise (calcul déterministe selon forme, convocation, objet)', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('pv_ago', 'P08', 'Révocation du gérant statutaire SARL : votes_pour >= 75 % du capital', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('pv_ago', 'P09', 'resultat_a_affecter = résultat net des états financiers de l''exercice', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('pv_ago', 'P10', 'resultat_a_affecter + report_a_nouveau_anterieur + reprises = somme des affectations (réserves + dividendes + nouveau report)', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('pv_ago', 'P11', 'SARL : dotation_reserve_legale >= 5 % du bénéfice tant que réserve légale < 10 % du capital', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('pv_ago', 'P12', 'dividende_par_titre × nombre de titres = dividendes_total (tolérance d''arrondi paramétrée)', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('pv_ago', 'P13', 'date_mise_en_paiement <= date_assemblee + 3 mois (SARL)', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('pv_ago', 'P14', 'Vote sur convention : l''associé intéressé n''a pas voté (voix exclues)', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('pv_ago', 'P15', 'report_a_nouveau_anterieur = report_a_nouveau_nouveau du PV de l''exercice précédent', 'continuite', null::jsonb, 'a_traduire', null::text),
    ('pv_ago', 'P16', 'Une seule AGO d''approbation par exercice (hors AGO de rectification motivée)', 'unicite', null::jsonb, 'a_traduire', null::text),
    ('pv_ago', 'P17', 'Président de séance / gérant signataire = dirigeant habilité selon RNE à la date', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('pv_age', 'P01', 'capital_apres = capital_avant ± montant_variation', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('pv_age', 'P02', 'capital_apres = nombre total de titres après × valeur nominale après', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('pv_age', 'P03', 'somme(nouvelle_repartition_capital) = nombre total de titres après', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('pv_age', 'P04', 'SARL : votes_pour >= 75 % du capital (régime légal) ou, si clause statutaire, quorum 1re AGE >= 50 % et votes_pour >= 2/3 des présents/représentés', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('pv_age', 'P05', 'SARL : 2e AGE (option statutaire) au moins 60 jours après la 1re', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('pv_age', 'P06', 'SARL : changement de nationalité ⇒ unanimité', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('pv_age', 'P07', 'SARL : incorporation de réserves ⇒ votes_pour > 50 % du capital', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('pv_age', 'P08', 'SA : votes_pour >= 2/3 des voix ; quorum 2e convocation >= 1/3 du capital ; quorum 1re convocation INCERTAIN (paramètre)', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('pv_age', 'P09', 'SARL : délai de souscription >= 21 jours', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('pv_age', 'P10', 'Réduction de capital : projet communiqué au CAC >= 3 mois avant ; avis aux créanciers <= 15 jours ; réalisation après expiration du délai d''opposition d''1 mois', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('pv_age', 'P11', 'Montant libéré en numéraire = montant du certificat de dépôt', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('pv_age', 'P12', 'reserves_incorporees <= réserves disponibles du dernier bilan approuvé', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('pv_age', 'P13', 'votes_pour + votes_contre + abstentions = titres présents/représentés votants', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('pv_age', 'P14', 'Statuts mis à jour postérieurs à l''AGE reprennent exactement les articles modifiés', 'continuite', null::jsonb, 'a_traduire', null::text),
    ('feuille_presence', 'P01', 'somme(titres_detenus des lignes présentes) = total_presents ; idem représentés ; total_presents + total_representes = total_general', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('feuille_presence', 'P02', 'somme(titres_detenus de tous les associés listés) = nombre de titres du capital (si la feuille liste aussi les absents)', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('feuille_presence', 'P03', 'total_general = titres_presents_representes du PV', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('feuille_presence', 'P04', 'Chaque associé n''apparaît qu''une fois', 'unicite', null::jsonb, 'a_traduire', null::text),
    ('feuille_presence', 'P05', 'Ligne ''représenté'' ⇒ mandataire renseigné et pouvoir annexé daté avant l''assemblée', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('feuille_presence', 'P06', 'Titres détenus par associé = table de capitalisation à la date de l''assemblée', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('pv_conseil_administration', 'P01', 'Présents + représentés >= quorum paramétré (légal INCERTAIN, statutaire extrait des statuts)', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('pv_conseil_administration', 'P02', 'Administrateurs listés = administrateurs en fonction à la date (nominations AGO / cooptations non échues)', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('pv_conseil_administration', 'P03', 'Résultat des comptes arrêtés = résultat des états financiers soumis à l''AGO', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('pv_conseil_administration', 'P04', 'Directeur général = personne physique', 'format', null::jsonb, 'a_traduire', null::text),
    ('pv_conseil_administration', 'P05', 'Numérotation continue des folios du registre des délibérations', 'continuite', null::jsonb, 'a_traduire', null::text),
    ('pv_conseil_administration', 'P06', 'Convention autorisée ⇒ administrateur intéressé exclu du vote et convention reprise au rapport spécial du CAC', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('decision_associe_unique', 'P01', 'Signataire = associé unique inscrit (pas de mandataire)', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('decision_associe_unique', 'P02', 'Nombre d''associés de la société = 1', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('decision_associe_unique', 'P03', 'Folios du registre continus et chronologiques', 'continuite', null::jsonb, 'a_traduire', null::text),
    ('decision_associe_unique', 'P04', 'Affectation : mêmes règles arithmétiques que pv_ago', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('decision_gerant', 'P01', 'Gérant signataire en fonction à la date (RNE / dernier PV de nomination)', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('decision_gerant', 'P02', 'Mise en conformité statutaire par le gérant ⇒ ratification à la prochaine AG', 'continuite', null::jsonb, 'a_traduire', null::text),
    ('decision_gerant', 'P03', 'Objet de la décision dans le périmètre des pouvoirs statutaires (sinon décision collective requise)', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('rapport_gestion', 'P01', 'resultat_net = résultat des états financiers', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('rapport_gestion', 'P02', 'Date de communication aux associés <= date AGO - 30 jours (SARL)', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('rapport_gestion', 'P03', 'Proposition d''affectation arithmétiquement équilibrée (mêmes règles que pv_ago)', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('rapport_gestion', 'P04', 'SARL : au moins une distribution >= 30 % du bénéfice sur toute période de 3 exercices, sauf unanimité contraire', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('rapport_cac', 'P01', 'Rapport daté avant la date de l''AGO et, en SARL, disponible 30 jours avant', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('rapport_cac', 'P02', 'Exercice audité ∈ période du mandat (3 exercices)', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('rapport_cac', 'P03', 'Chiffres cités = états financiers', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('rapport_cac', 'P04', 'Conventions du rapport spécial = conventions autorisées par le conseil + conventions déclarées (aucune omise)', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('rapport_cac', 'P05', 'Société soumise à CAC (SA ou SARL au-delà des seuils) ⇒ un rapport par exercice', 'continuite', null::jsonb, 'a_traduire', null::text),
    ('contrat_commercial', 'P01', 'Montant TTC = HT + TVA (si ventilé)', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('contrat_commercial', 'P02', 'Somme de l''échéancier = prix total', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('contrat_commercial', 'P03', 'date_effet + duree = date de fin calculée ; alerte de préavis de non-renouvellement', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('contrat_commercial', 'P04', 'Signataire = dirigeant inscrit au RNE à la date ou mandataire avec pouvoir valide', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('contrat_commercial', 'P05', 'Contrepartie = dirigeant/associé ⇒ procédure de convention réglementée suivie', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('contrat_commercial', 'P06', 'Format matricule fiscal / identifiant unique valide (gabarit paramétré)', 'format', null::jsonb, 'a_traduire', null::text),
    ('bail_commercial', 'P01', 'Loyer annuel = loyer périodique × nombre de périodes', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('bail_commercial', 'P02', 'Loyer à date = loyer initial × (1 + taux d''augmentation)^n selon la clause', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('bail_commercial', 'P03', 'date_effet + duree = échéance ; alerte de préavis', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('bail_commercial', 'P04', 'Adresse siège RNE ↔ adresse d''un bail en cours de validité', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('bail_commercial', 'P05', 'Pas deux baux actifs pour le même siège social sans transfert', 'unicite', null::jsonb, 'a_traduire', null::text),
    ('bail_commercial', 'P06', 'Continuité de l''occupation du siège : chaque période couverte par un bail ou renouvellement', 'continuite', null::jsonb, 'a_traduire', null::text),
    ('procuration', 'P01', 'date_pouvoir <= date de l''acte ou de l''assemblée <= date d''expiration', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('procuration', 'P02', 'mandant_titres = titres du mandant dans la table de capitalisation à la date de l''AG', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('procuration', 'P03', 'Pouvoir pour AG = spécial (désigne l''assemblée)', 'format', null::jsonb, 'a_traduire', null::text),
    ('procuration', 'P04', 'SUARL : aucune décision de l''associé unique prise par mandataire', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('procuration', 'P05', 'Montant de l''acte <= plafond_montant', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('procuration', 'P06', 'Un mandant n''a qu''un pouvoir actif pour une même assemblée', 'unicite', null::jsonb, 'a_traduire', null::text),
    ('bulletin_paie', 'P01', 'salaire_brut = salaire_base + Σ primes + heures_supplementaires + avantages_en_nature − retenues_absence', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('bulletin_paie', 'P02', 'retenue_cnss_salarie = assiette_cnss × taux_cnss_salarie (taux daté, lu en base) ± 0,001 DT', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('bulletin_paie', 'P03', 'net_a_payer = salaire_brut − retenue_cnss_salarie − cotisation_fpe_salarie − retenue_irpp − css_salarie − autres retenues', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('bulletin_paie', 'P04', 'retenue_irpp recalculée par moteur déterministe (barème LF 2025 art. 36, déductions paramétrées) ; écart signalé, jamais corrigé par l''IA', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('bulletin_paie', 'P05', 'salaire_base mensuel ≥ SMIG du régime horaire en vigueur à la période (sauf temps partiel proratisé)', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('bulletin_paie', 'P06', 'salaire_base ≥ minimum de la catégorie de la convention collective', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('bulletin_paie', 'P07', 'Un seul bulletin par salarié et par période (hors bulletin rectificatif identifié)', 'unicite', null::jsonb, 'a_traduire', null::text),
    ('bulletin_paie', 'P08', 'Cumul annuel N = cumul N-1 du mois précédent + montants du mois', 'continuite', null::jsonb, 'a_traduire', null::text),
    ('bulletin_paie', 'P09', 'Matricule CNSS et matricule fiscal au bon format (contrôle de clé)', 'format', null::jsonb, 'a_traduire', null::text),
    ('bulletin_paie', 'P10', 'Σ net_a_payer des bulletins du mois = Σ virements salaires du relevé bancaire (± espèces justifiées)', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('bulletin_paie', 'P11', 'Σ retenue_irpp des bulletins du mois M = montant « traitements et salaires » de la déclaration mensuelle des retenues de M (dépôt le 15, 20 ou 28 du mois M+1 selon la catégorie du contribuable)', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('bulletin_paie', 'P12', 'Σ annuelle des retenue_irpp et des bruts par salarié = lignes de la déclaration de l''employeur annuelle (dépôt au plus tard le 30 avril N+1 selon presse 2026)', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('bulletin_paie', 'P13', 'Σ bruts des bulletins du trimestre = masse_salariale_declaree de la DS CNSS (écart = éléments non soumis, à justifier)', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('bulletin_paie', 'P14', 'TFP déclarée = masse salariale brute du mois × taux TFP paramétré ; FOPROLOS = masse salariale × taux paramétré (exonérations gérées par règle)', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('bulletin_paie', 'P15', 'Cotisations patronales totales du trimestre = Σ cnss_patronale + accident_travail des bulletins = part patronale de la DS', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('declaration_cnss_trimestrielle', 'P01', 'Σ ligne_salaire_trimestre = masse_salariale_declaree', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('declaration_cnss_trimestrielle', 'P02', 'ligne_salaire_trimestre(assuré) = Σ assiette_cnss des bulletins des 3 mois (±1 DT)', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('declaration_cnss_trimestrielle', 'P03', 'montant_cotisations = masse_salariale_declaree × taux_global (taux daté en base)', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('declaration_cnss_trimestrielle', 'P04', 'nombre_salaries = nombre de lignes = nombre de salariés ayant au moins un bulletin dans le trimestre', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('declaration_cnss_trimestrielle', 'P05', 'date_depot ≤ 15 du mois suivant le trimestre (report si jour férié, cf. communiqués CNSS) ; sinon pénalités attendues', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('declaration_cnss_trimestrielle', 'P06', 'Une seule déclaration initiale par employeur/trimestre ; les autres sont complémentaires ou rectificatives', 'unicite', null::jsonb, 'a_traduire', null::text),
    ('declaration_cnss_trimestrielle', 'P07', 'Aucun trimestre manquant entre la date d''affiliation et aujourd''hui tant que l''effectif est non nul', 'continuite', null::jsonb, 'a_traduire', null::text),
    ('declaration_cnss_trimestrielle', 'P08', 'Matricule CNSS de chaque ligne présent et unique dans la déclaration', 'unicite', null::jsonb, 'a_traduire', null::text),
    ('recepisse_quittance_cnss', 'P01', 'montant_cotisations = montant_cotisations de la déclaration du même trimestre', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('recepisse_quittance_cnss', 'P02', 'montant_total_paye = montant_cotisations + montant_penalites', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('recepisse_quittance_cnss', 'P03', 'Si date_paiement > 15 du mois suivant le trimestre, montant_penalites > 0 attendu (≈1 % par mois ou fraction)', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('recepisse_quittance_cnss', 'P04', 'numero_quittance unique par employeur', 'unicite', null::jsonb, 'a_traduire', null::text),
    ('recepisse_quittance_cnss', 'P05', 'Une quittance (ou cumul de quittances) par trimestre déclaré', 'continuite', null::jsonb, 'a_traduire', null::text),
    ('contrat_cdi', 'P01', 'salaire_base ≥ SMIG (régime horaire) et ≥ minimum conventionnel de la catégorie à date_debut', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('contrat_cdi', 'P02', 'periode_essai_duree ≤ 6 mois (renouvellement compris : à vérifier au texte)', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('contrat_cdi', 'P03', 'Salaire de base du 1er bulletin = salaire contractuel (ou avenant le plus récent)', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('contrat_cdi', 'P04', 'Un seul contrat actif par salarié et employeur (avenants chaînés)', 'unicite', null::jsonb, 'a_traduire', null::text),
    ('contrat_cdd', 'P01', 'motif_recours ∈ liste paramétrée des cas légaux ; sinon alerte « risque de requalification en CDI » (verdict par moteur déterministe, pas par l''IA)', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('contrat_cdd', 'P02', 'date_fin_ou_terme > date_debut', 'format', null::jsonb, 'a_traduire', null::text),
    ('contrat_cdd', 'P03', 'Bulletins postérieurs à date_fin sans nouveau contrat ⇒ alerte continuité (relation présumée CDI)', 'continuite', null::jsonb, 'a_traduire', null::text),
    ('contrat_cdd', 'P04', 'CDD conclu avant l''entrée en vigueur hors exceptions ⇒ statut CDI attendu', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('contrat_insertion_civp', 'P01', 'Indemnité complémentaire versée chaque mois entre date_debut et date_fin', 'continuite', null::jsonb, 'a_traduire', null::text),
    ('contrat_insertion_civp', 'P02', 'Bénéficiaire non présent simultanément en CDI chez le même employeur', 'unicite', null::jsonb, 'a_traduire', null::text),
    ('contrat_insertion_civp', 'P03', 'date_fin − date_debut ≤ durée maximale paramétrée', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('attestation_travail', 'P01', 'date_entree ≤ date_sortie ≤ date d''établissement', 'format', null::jsonb, 'a_traduire', null::text),
    ('attestation_travail', 'P02', 'Salarié présent dans les DS CNSS de chaque trimestre entre date_entree et date_sortie', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('attestation_travail', 'P03', 'Signataire habilité (gérant/représentant légal ou délégataire connu)', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('attestation_salaire', 'P01', 'salaire_net_mensuel = net_a_payer du bulletin de la période (tolérance paramétrée)', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('attestation_salaire', 'P02', 'salaire_brut_mensuel ≥ salaire_net_mensuel', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('attestation_salaire', 'P03', 'Attestation datée après la période attestée', 'format', null::jsonb, 'a_traduire', null::text),
    ('certificat_affiliation_cnss', 'P01', 'Première DS attendue pour le trimestre de date_affiliation (si salariés)', 'continuite', null::jsonb, 'a_traduire', null::text),
    ('certificat_affiliation_cnss', 'P02', 'employeur_numero_cnss identique sur tous les bulletins et déclarations', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('recu_solde_tout_compte', 'P01', 'montant_total = Σ éléments du décompte − retenues', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('recu_solde_tout_compte', 'P02', 'montant_total = net du dernier bulletin (solde)', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('recu_solde_tout_compte', 'P03', 'Aucun bulletin postérieur à date_sortie', 'continuite', null::jsonb, 'a_traduire', null::text),
    ('registre_personnel', 'P01', 'Ensemble des salariés actifs du mois = ensemble des bulletins du mois', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('registre_personnel', 'P02', 'numero_ordre croissant sans trou ni doublon', 'continuite', null::jsonb, 'a_traduire', null::text),
    ('registre_personnel', 'P03', 'effectif_total = nombre de lignes actives à date_arrete', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('releve_bancaire', 'P01', 'solde_initial (signé) + total_credits − total_debits = solde_final (signé), au millime (3 décimales en TND)', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('releve_bancaire', 'P02', 'Σ ligne_credit = total_credits et Σ ligne_debit = total_debits quand les totaux sont imprimés', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('releve_bancaire', 'P03', 'Solde progressif : ligne_solde_apres(i) = ligne_solde_apres(i−1) + credit(i) − debit(i) ; la première ligne part de solde_initial, la dernière égale solde_final', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('releve_bancaire', 'P04', 'Report de page : solde de bas de page p = solde de haut de page p+1', 'continuite', null::jsonb, 'a_traduire', null::text),
    ('releve_bancaire', 'P05', 'Continuité inter-relevés : solde_final(n) = solde_initial(n+1) ; periode_debut(n+1) = periode_fin(n) + 1 jour (ou même date selon convention de la banque) ; aucun trou ni chevauchement', 'continuite', null::jsonb, 'a_traduire', null::text),
    ('releve_bancaire', 'P06', 'Numéros de relevé consécutifs pour un même compte', 'continuite', null::jsonb, 'a_traduire', null::text),
    ('releve_bancaire', 'P07', 'Toutes les date_operation ∈ [periode_debut ; periode_fin]', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('releve_bancaire', 'P08', 'Écart date_valeur − date_operation : alerte si inhabituel (ex. crédit en valeur antérieure, débit en valeur très postérieure) ; seuils à paramétrer en base, règles BCT de jours de valeur INCERTAIN', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('releve_bancaire', 'P09', 'RIB : 20 chiffres ; code banque (2) cohérent avec la banque émettrice ; clé RIB valide (algorithme INCERTAIN — à paramétrer après lecture de la norme)', 'format', null::jsonb, 'a_traduire', null::text),
    ('releve_bancaire', 'P10', 'IBAN : ''TN'' + 2 chiffres de contrôle + RIB 20 chiffres = 24 caractères ; contrôle modulo 97 ISO 13616/ISO 7064', 'format', null::jsonb, 'a_traduire', null::text),
    ('releve_bancaire', 'P11', 'Unicité : (compte_rib, releve_numero) ou (compte_rib, periode_debut, periode_fin) unique ; dédoublonnage des lignes sur (compte, date_operation, montant, sens, reference, rang)', 'unicite', null::jsonb, 'a_traduire', null::text),
    ('releve_bancaire', 'P12', 'Une ligne a soit un débit soit un crédit, jamais les deux, montant > 0', 'format', null::jsonb, 'a_traduire', null::text),
    ('releve_bancaire', 'P13', 'Agios recalculables : Σ(solde débiteur en valeur × jours × taux)/base ≈ interets_debiteurs ; taux ≤ seuil de taux excessif publié pour la catégorie ''découverts''', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('releve_bancaire', 'P14', 'TVA sur commissions = commissions × taux en vigueur (taux paramétré en base)', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('releve_bancaire', 'P15', 'Rapprochement : solde_final relevé − solde comptable 532 = Σ opérations en suspens justifiées', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('avis_debit', 'P01', 'montant_net = montant_brut + commissions + TVA + autres taxes (selon convention du type d''opération)', 'arithmetique', '{"op": "somme", "total": "montant_net", "parties": ["montant_brut", "commissions?", "tva?", "autres_taxes?"]}'::jsonb, 'defaut_a_valider', null::text),
    ('avis_debit', 'P02', 'La ligne correspondante existe sur le relevé de la période (même compte, date, montant net, sens)', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('avis_debit', 'P03', 'TVA = commissions × taux paramétré', 'arithmetique', '{"op": "taux", "montant": "tva", "base": "commissions", "bareme": "tva"}'::jsonb, 'defaut_a_valider', null::text),
    ('avis_debit', 'P04', 'Unicité (compte, avis_numero)', 'unicite', null::jsonb, 'a_traduire', null::text),
    ('avis_credit', 'P01', 'montant_net = montant_brut − commissions − TVA sur commissions − autres frais (selon le type d''opération)', 'arithmetique', '{"op": "somme", "total": "montant_net", "parties": ["montant_brut", "-commissions?", "-tva?", "-autres_taxes?"]}'::jsonb, 'defaut_a_valider', null::text),
    ('avis_credit', 'P02', 'La ligne correspondante existe sur le relevé de la période (même compte, date, montant net, sens)', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('avis_credit', 'P03', 'TVA = commissions × taux paramétré', 'arithmetique', '{"op": "taux", "montant": "tva", "base": "commissions", "bareme": "tva"}'::jsonb, 'defaut_a_valider', null::text),
    ('avis_credit', 'P04', 'Unicité (compte, avis_numero)', 'unicite', null::jsonb, 'a_traduire', null::text),
    ('cheque', 'P01', 'montant_chiffres ≤ plafond_formule ≤ 30 000 DT', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('cheque', 'P02', 'date_emission ≤ date_validite', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('cheque', 'P03', 'date_presentation − date_emission ≤ 8 jours ouvrables (Tunisie) — alerte, pas verdict juridique', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('cheque', 'P04', 'montant_lettres converti = montant_chiffres', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('cheque', 'P05', 'Talon et chèque : même numéro, même montant, même bénéficiaire', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('cheque', 'P06', 'Numéros de chèques d''un même chéquier consécutifs ; aucun numéro utilisé deux fois par compte', 'unicite', null::jsonb, 'a_traduire', null::text),
    ('cheque', 'P07', 'Ligne de relevé CHQ n° X de même montant, date_operation ≥ date_emission', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('cheque', 'P08', 'beneficiaire renseigné (pas de chèque au porteur)', 'format', null::jsonb, 'a_traduire', null::text),
    ('cheque', 'P09', 'Rupture de séquence de talons = chèque non comptabilisé à rechercher', 'continuite', null::jsonb, 'a_traduire', null::text),
    ('lettre_change', 'P01', 'Présence des 8 mentions de l''art. 269 ; à défaut d''échéance → à vue ; à défaut de lieu → règles supplétives', 'format', null::jsonb, 'a_traduire', null::text),
    ('lettre_change', 'P02', 'date_creation ≤ date_acceptation ≤ echeance', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('lettre_change', 'P03', 'Σ montants des traites = montant TTC de la (des) facture(s) réglée(s) (moins acomptes)', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('lettre_change', 'P04', 'Unicité numero_lc (doublon de numéro dans une série = timbre réputé non recouvré)', 'unicite', null::jsonb, 'a_traduire', null::text),
    ('lettre_change', 'P05', 'RIB du tiré au format 20 chiffres valide', 'format', null::jsonb, 'a_traduire', null::text),
    ('lettre_change', 'P06', 'Délai échéance − date facture ≤ délai de paiement légal/contractuel (paramètre)', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('billet_ordre', 'P01', 'date_souscription ≤ echeance', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('billet_ordre', 'P02', 'Σ billets = montant facture ou Σ échéances garanties', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('virement', 'P01', 'RIB donneur et bénéficiaire valides (format 20 chiffres / IBAN mod 97)', 'format', null::jsonb, 'a_traduire', null::text),
    ('virement', 'P02', 'RIB bénéficiaire = RIB connu du tiers (alerte fraude au changement de RIB)', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('virement', 'P03', 'Virement de masse : Σ lignes = montant global', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('virement', 'P04', 'Unicité reference_virement par banque', 'unicite', null::jsonb, 'a_traduire', null::text),
    ('ticket_tpe', 'P01', 'Σ montants transactions du lot (achats − annulations − remboursements) = lot_total', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('ticket_tpe', 'P02', 'Crédit relevé = lot_total − commission commerçant (taux paramétré par contrat)', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('ticket_tpe', 'P03', 'Unicité (numero_terminal, numero_transaction, date)', 'unicite', null::jsonb, 'a_traduire', null::text),
    ('ticket_tpe', 'P04', 'Numéro de carte toujours masqué (rejet si PAN complet détecté)', 'format', null::jsonb, 'a_traduire', null::text),
    ('tableau_amortissement_emprunt', 'P01', 'ech_interets(i) = ech_crd_debut(i) × taux périodique (taux_nominal / périodicité, ou au prorata jours/base), tolérance d''arrondi au millime', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('tableau_amortissement_emprunt', 'P02', 'ech_montant_total = ech_interets + ech_amortissement + TVA + assurance + frais', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('tableau_amortissement_emprunt', 'P03', 'ech_crd_fin(i) = ech_crd_debut(i) − ech_amortissement(i) et ech_crd_debut(i+1) = ech_crd_fin(i)', 'continuite', null::jsonb, 'a_traduire', null::text),
    ('tableau_amortissement_emprunt', 'P04', 'Σ ech_amortissement = montant_principal ; ech_crd_fin(dernière) = 0', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('tableau_amortissement_emprunt', 'P05', 'Échéance constante : A = C × t / (1 − (1+t)^−n) (hors différé)', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('tableau_amortissement_emprunt', 'P06', 'Dates d''échéance espacées selon la périodicité ; nombre = duree / périodicité', 'continuite', null::jsonb, 'a_traduire', null::text),
    ('tableau_amortissement_emprunt', 'P07', 'TEG ≤ seuil de taux excessif publié pour la catégorie et le semestre (seuils en base, datés)', 'seuil', null::jsonb, 'a_traduire', null::text),
    ('tableau_amortissement_emprunt', 'P08', 'Chaque échéance échue se retrouve débitée sur le relevé (± jours ouvrés)', 'recoupement', null::jsonb, 'a_traduire', null::text),
    ('echeancier_leasing', 'P01', 'loyer_ttc = loyer_ht + loyer_tva ; loyer_tva = loyer_ht × taux TVA paramétré', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('echeancier_leasing', 'P02', 'loyer_ht = part_capital + part_interets ; encours_fin = encours_debut − part_capital ; Σ part_capital + valeur_residuelle (+ premier loyer) = valeur_ht financée', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('echeancier_leasing', 'P03', 'Valeur actuelle des loyers HT et de la valeur résiduelle au taux du contrat = valeur financée', 'arithmetique', null::jsonb, 'a_traduire', null::text),
    ('echeancier_leasing', 'P04', 'Nombre de loyers = duree / périodicité ; dates régulières', 'continuite', null::jsonb, 'a_traduire', null::text),
    ('echeancier_leasing', 'P05', 'Taux ≤ seuil leasing du semestre (en base, daté)', 'seuil', null::jsonb, 'a_traduire', null::text)
  ) as v(grille, code, regle, genre, expression, statut, variante)
  join ref.grilles g on g.code = v.grille and g.valid_from = date '2026-01-01'
  join ref.jurisdiction_packs p on p.id = g.pack_version_id
 where p.jurisdiction = 'TN' and p.effective_from <= date '2026-01-01' and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict (grille_id, code) do nothing;

-- ========================================================== 4. LE SEMIS SE VÉRIFIE
--
-- Une preuve qui nomme un champ absent de sa grille ne serait jamais évaluable,
-- et on ne le verrait qu'au premier document. On le voit ici.
do $$
declare
  v_grilles integer;
  v_champs  integer;
  v_orph    text;
begin
  select count(*) into v_grilles
    from ref.grilles g join ref.jurisdiction_packs p on p.id = g.pack_version_id
   where p.jurisdiction = 'TN' and g.valid_from = date '2026-01-01';
  if v_grilles <> 77 then
    raise exception 'grilles semées : %, 77 attendues', v_grilles;
  end if;

  select count(*) into v_champs
    from ref.grille_champs c join ref.grilles g on g.id = c.grille_id
    join ref.jurisdiction_packs p on p.id = g.pack_version_id
   where p.jurisdiction = 'TN' and g.valid_from = date '2026-01-01';
  if v_champs <> 2132 then
    raise exception 'champs semés : %, 2132 attendus (le catalogue)', v_champs;
  end if;

  with noms as (
    select g.code as grille, pr.code as preuve,
           regexp_replace(regexp_replace(n, '^-', ''), '\?$', '') as champ
      from ref.grille_preuves pr
      join ref.grilles g on g.id = pr.grille_id
      cross join lateral (
        select pr.expression ->> k as n
          from unnest(array['total', 'montant', 'base', 'total_base', 'total_montant',
                            'a', 'b', 'champ', 'avant', 'apres', 'exoneration']) k
         where pr.expression ? k
        union all
        select jsonb_array_elements_text(pr.expression -> k)
          from unnest(array['parties', 'facteurs']) k
         where pr.expression ? k
      ) x
     where pr.expression is not null
  )
  select string_agg(n.grille || '/' || n.preuve || ' -> ' || n.champ, ', ') into v_orph
    from noms n
   where not exists (select 1 from ref.grille_champs c join ref.grilles g on g.id = c.grille_id
                      where g.code = n.grille and c.code = n.champ);
  if v_orph is not null then
    raise exception 'preuves qui nomment un champ absent : %', v_orph;
  end if;

  select string_agg(g.code || '/' || pr.code, ', ') into v_orph
    from ref.grille_preuves pr join ref.grilles g on g.id = pr.grille_id
   where pr.expression ->> 'op' = 'charge'
     and not exists (select 1 from ref.fiscal_charges f
                      where f.pack_version_id = g.pack_version_id
                        and f.code = pr.expression ->> 'code');
  if v_orph is not null then
    raise exception 'preuves de charge sans charge au pack : %', v_orph;
  end if;
end $$;
