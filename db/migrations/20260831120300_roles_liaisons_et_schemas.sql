-- =====================================================================================
--  Rôles comptables, liaisons et schémas d'écriture.
--
--  Un schéma d'écriture ne désigne JAMAIS un numéro de compte : il désigne un rôle.
--  Le rôle est relié à un compte par une liaison, que l'expert peut changer pour son
--  cabinet ou pour un dossier. Aucun schéma n'est réécrit, aucun contrôle ne tombe.
--
--  'classes_admises' est le cœur du dispositif : il borne les comptes auxquels un rôle
--  PEUT être relié. Un rôle de taxe collectée pour le compte de l'État n'accepte que la
--  classe 4 — relier la TVA collectée à un compte de produit devient impossible EN BASE,
--  et non plus une faute rattrapée à la première facture.
--  C'est NC 03 §06 rendu structurel.
-- =====================================================================================

create table if not exists ref.account_roles (
  code            text primary key,
  libelle         text not null,
  famille         text not null,
  classes_admises int[] not null,
  resolution      text not null check (resolution in ('fixe','par_nature')),
  auxiliaire      text,
  note            text
);

create table if not exists ref.role_bindings (
  pack_version_id uuid not null references ref.jurisdiction_packs(id),
  role_code       text not null references ref.account_roles(code),
  account_code    text not null,
  perimetre       text,
  justification   text,
  primary key (pack_version_id, role_code)
);

create table if not exists tenant_role_bindings (
  tenant_id     uuid not null,
  portee        text not null check (portee in ('cabinet','dossier')),
  portee_id     uuid not null,
  role_code     text not null references ref.account_roles(code),
  account_code  text not null,
  primary key (portee, portee_id, role_code)
);

-- La contrainte de classe, appliquée par la base sur LES DEUX tables de liaison.
create or replace function ref.verifier_classe_role() returns trigger
language plpgsql as $$
declare cls int; adm int[]; lib text;
begin
  select account_class into cls from ref.accounts a
   where a.account_code = NEW.account_code
   limit 1;
  if cls is null then
    raise exception 'Liaison impossible : le compte % n''existe pas dans le plan comptable.',
      NEW.account_code using errcode = 'foreign_key_violation';
  end if;
  select classes_admises, libelle into adm, lib from ref.account_roles where code = NEW.role_code;
  if not (cls = any(adm)) then
    raise exception
      'Le rôle « % » (%) n''admet que la ou les classes % : le compte % est en classe %.',
      lib, NEW.role_code, adm, NEW.account_code, cls
      using errcode = 'check_violation';
  end if;
  return NEW;
end $$;

drop trigger if exists trg_classe_role_ref on ref.role_bindings;
create trigger trg_classe_role_ref before insert or update on ref.role_bindings
  for each row execute function ref.verifier_classe_role();
drop trigger if exists trg_classe_role_tenant on tenant_role_bindings;
create trigger trg_classe_role_tenant before insert or update on tenant_role_bindings
  for each row execute function ref.verifier_classe_role();

create table if not exists ref.journals (
  code text primary key, libelle text not null);
insert into ref.journals (code, libelle) values
  ('ACH','Journal des achats'), ('VEN','Journal des ventes'),
  ('BQ','Journal de banque'),   ('OD','Opérations diverses')
on conflict (code) do nothing;

create table if not exists ref.entry_templates (
  code            text primary key,
  libelle         text not null,
  journal_code    text not null references ref.journals(code),
  norme           text,
  paragraphes     text[],
  statut          text check (statut in ('texte','lecture')),
  regle           text,
  controle        text
);
comment on column ref.entry_templates.statut is
  'texte = citation opposable. lecture = interprétation, JAMAIS présentable à l''utilisateur '
  'comme une prescription normative.';

create table if not exists ref.entry_template_lines (
  template_code text not null references ref.entry_templates(code) on delete cascade,
  ordre         int  not null,
  role_code     text not null references ref.account_roles(code),
  sens          text not null check (sens in ('debit','credit','debit_ou_credit')),
  grandeur      text not null,
  note          text,
  primary key (template_code, ordre)
);
comment on table ref.entry_template_lines is
  'Aucune colonne ne peut contenir un numéro de compte : une ligne porte un role_code, '
  'avec clé étrangère. C''est ce qui rend la renumérotation du plan sans effet.';

create table if not exists ref.entry_controls (
  code       text primary key,
  portee     text not null,
  regle      text not null,
  norme      text,
  paragraphes text[],
  statut     text,
  message    text not null
);

-- --- rôles ---
insert into ref.account_roles (code,libelle,famille,classes_admises,resolution,auxiliaire,note) values ('CLIENT_COLLECTIF','Collectif clients','tiers','{4}','fixe','client','Compte collectif : le detail est porte par l''auxiliaire, jamais par des sous-comptes par client.') on conflict (code) do nothing;
insert into ref.account_roles (code,libelle,famille,classes_admises,resolution,auxiliaire,note) values ('CLIENT_RETENUE_GARANTIE','Clients - retenues de garantie','tiers','{4}','fixe','client',null) on conflict (code) do nothing;
insert into ref.account_roles (code,libelle,famille,classes_admises,resolution,auxiliaire,note) values ('CLIENT_DOUTEUX','Clients douteux ou litigieux','tiers','{4}','fixe','client',null) on conflict (code) do nothing;
insert into ref.account_roles (code,libelle,famille,classes_admises,resolution,auxiliaire,note) values ('CLIENT_TRAVAUX_NON_FACTURABLES','Creances sur travaux non encore facturables','tiers','{4}','fixe','client',null) on conflict (code) do nothing;
insert into ref.account_roles (code,libelle,famille,classes_admises,resolution,auxiliaire,note) values ('CLIENT_AVOIRS_A_ETABLIR','Avoirs a accorder aux clients','tiers','{4}','fixe',null,null) on conflict (code) do nothing;
insert into ref.account_roles (code,libelle,famille,classes_admises,resolution,auxiliaire,note) values ('CLIENT_AVANCES_RECUES','Clients - avances et acomptes recus','tiers','{4}','fixe','client','NC 03 §15 : hors regie, une avance recue ne mesure pas l''avancement. Ce compte reste au passif.') on conflict (code) do nothing;
insert into ref.account_roles (code,libelle,famille,classes_admises,resolution,auxiliaire,note) values ('CLIENT_PROVISION_DEPRECIATION','Provisions pour depreciation des comptes clients','tiers','{4}','fixe',null,null) on conflict (code) do nothing;
insert into ref.account_roles (code,libelle,famille,classes_admises,resolution,auxiliaire,note) values ('FOURNISSEUR_COLLECTIF','Collectif fournisseurs d''exploitation','tiers','{4}','fixe','fournisseur',null) on conflict (code) do nothing;
insert into ref.account_roles (code,libelle,famille,classes_admises,resolution,auxiliaire,note) values ('FOURNISSEUR_IMMOBILISATIONS','Fournisseurs d''immobilisations','tiers','{4}','fixe','fournisseur',null) on conflict (code) do nothing;
insert into ref.account_roles (code,libelle,famille,classes_admises,resolution,auxiliaire,note) values ('FOURNISSEUR_AVOIRS_A_RECEVOIR','Avoirs a obtenir des fournisseurs','tiers','{4}','fixe',null,null) on conflict (code) do nothing;
insert into ref.account_roles (code,libelle,famille,classes_admises,resolution,auxiliaire,note) values ('PERSONNEL_REMUNERATIONS_DUES','Personnel - remunerations dues','tiers','{4}','fixe','salarie',null) on conflict (code) do nothing;
insert into ref.account_roles (code,libelle,famille,classes_admises,resolution,auxiliaire,note) values ('TVA_DEDUCTIBLE','TVA deductible','etat','{4}','fixe',null,null) on conflict (code) do nothing;
insert into ref.account_roles (code,libelle,famille,classes_admises,resolution,auxiliaire,note) values ('TVA_COLLECTEE','TVA collectee pour le compte de l''Etat','etat','{4}','fixe',null,'NC 03 §06 : somme encaissee pour le compte d''un tiers, jamais un revenu. Classe 7 structurellement interdite.') on conflict (code) do nothing;
insert into ref.account_roles (code,libelle,famille,classes_admises,resolution,auxiliaire,note) values ('TVA_A_PAYER','TVA a decaisser','etat','{4}','fixe',null,null) on conflict (code) do nothing;
insert into ref.account_roles (code,libelle,famille,classes_admises,resolution,auxiliaire,note) values ('TVA_CREDIT_A_REPORTER','Credit de TVA a reporter','etat','{4}','fixe',null,null) on conflict (code) do nothing;
insert into ref.account_roles (code,libelle,famille,classes_admises,resolution,auxiliaire,note) values ('TIMBRE_COLLECTE','Droit de timbre collecte pour le compte de l''Etat','etat','{4}','fixe',null,'Le timbre n''est pas une taxe sur le chiffre d''affaires : la liaison ne doit pas pointer la serie des taxes sur le CA.') on conflict (code) do nothing;
insert into ref.account_roles (code,libelle,famille,classes_admises,resolution,auxiliaire,note) values ('RETENUE_SOURCE_OPEREE','Retenue a la source operee par l''entreprise sur des tiers','etat','{4}','fixe',null,'Dette envers l''Etat. A ne jamais confondre avec RETENUE_SOURCE_SUBIE.') on conflict (code) do nothing;
insert into ref.account_roles (code,libelle,famille,classes_admises,resolution,auxiliaire,note) values ('RETENUE_SOURCE_SUBIE','Retenue a la source subie par l''entreprise','etat','{4}','fixe',null,'Acompte d''impot sur les benefices, au debit. Sens oppose de RETENUE_SOURCE_OPEREE.') on conflict (code) do nothing;
insert into ref.account_roles (code,libelle,famille,classes_admises,resolution,auxiliaire,note) values ('TFP_A_PAYER','Taxe de formation professionnelle a payer','etat','{4}','fixe',null,null) on conflict (code) do nothing;
insert into ref.account_roles (code,libelle,famille,classes_admises,resolution,auxiliaire,note) values ('FOPROLOS_A_PAYER','FOPROLOS a payer','etat','{4}','fixe',null,null) on conflict (code) do nothing;
insert into ref.account_roles (code,libelle,famille,classes_admises,resolution,auxiliaire,note) values ('SUBVENTION_A_RECEVOIR','Subventions a recevoir de l''Etat','etat','{4}','fixe',null,null) on conflict (code) do nothing;
insert into ref.account_roles (code,libelle,famille,classes_admises,resolution,auxiliaire,note) values ('ORGANISME_SOCIAL','Organisme de securite sociale','etat','{4}','fixe',null,null) on conflict (code) do nothing;
insert into ref.account_roles (code,libelle,famille,classes_admises,resolution,auxiliaire,note) values ('BANQUE','Banque','tresorerie','{5}','par_nature','compte_bancaire',null) on conflict (code) do nothing;
insert into ref.account_roles (code,libelle,famille,classes_admises,resolution,auxiliaire,note) values ('CAISSE','Caisse','tresorerie','{5}','fixe',null,null) on conflict (code) do nothing;
insert into ref.account_roles (code,libelle,famille,classes_admises,resolution,auxiliaire,note) values ('VENTE_MARCHANDISES','Ventes de marchandises','produit','{7}','par_nature',null,null) on conflict (code) do nothing;
insert into ref.account_roles (code,libelle,famille,classes_admises,resolution,auxiliaire,note) values ('VENTE_PRODUITS_FINIS','Ventes de produits finis','produit','{7}','par_nature',null,null) on conflict (code) do nothing;
insert into ref.account_roles (code,libelle,famille,classes_admises,resolution,auxiliaire,note) values ('VENTE_SERVICES','Prestations de services','produit','{7}','par_nature',null,null) on conflict (code) do nothing;
insert into ref.account_roles (code,libelle,famille,classes_admises,resolution,auxiliaire,note) values ('VENTE_TRAVAUX','Travaux','produit','{7}','fixe',null,null) on conflict (code) do nothing;
insert into ref.account_roles (code,libelle,famille,classes_admises,resolution,auxiliaire,note) values ('SUBVENTION_QUOTE_PART_RESULTAT','Quote-part de subvention inscrite au resultat','produit','{7}','fixe',null,null) on conflict (code) do nothing;
insert into ref.account_roles (code,libelle,famille,classes_admises,resolution,auxiliaire,note) values ('ACHAT_MARCHANDISES','Achats de marchandises','charge','{6}','par_nature',null,null) on conflict (code) do nothing;
insert into ref.account_roles (code,libelle,famille,classes_admises,resolution,auxiliaire,note) values ('ACHAT_MATIERES','Achats stockes de matieres et fournitures','charge','{6}','par_nature',null,null) on conflict (code) do nothing;
insert into ref.account_roles (code,libelle,famille,classes_admises,resolution,auxiliaire,note) values ('ACHAT_SERVICES_EXTERIEURS','Services exterieurs','charge','{6}','par_nature',null,null) on conflict (code) do nothing;
insert into ref.account_roles (code,libelle,famille,classes_admises,resolution,auxiliaire,note) values ('HONORAIRES','Honoraires et remunerations d''intermediaires','charge','{6}','par_nature',null,null) on conflict (code) do nothing;
insert into ref.account_roles (code,libelle,famille,classes_admises,resolution,auxiliaire,note) values ('LOCATION_SIMPLE_CHARGE','Loyers de location simple','charge','{6}','fixe',null,'NC 41 §30-31 : linearisation obligatoire, y compris paliers et franchises.') on conflict (code) do nothing;
insert into ref.account_roles (code,libelle,famille,classes_admises,resolution,auxiliaire,note) values ('TIMBRE_CHARGE','Droits d''enregistrement et de timbre supportes','charge','{6}','fixe',null,null) on conflict (code) do nothing;
insert into ref.account_roles (code,libelle,famille,classes_admises,resolution,auxiliaire,note) values ('TFP_CHARGE','Taxe de formation professionnelle','charge','{6}','fixe',null,null) on conflict (code) do nothing;
insert into ref.account_roles (code,libelle,famille,classes_admises,resolution,auxiliaire,note) values ('FOPROLOS_CHARGE','FOPROLOS','charge','{6}','fixe',null,null) on conflict (code) do nothing;
insert into ref.account_roles (code,libelle,famille,classes_admises,resolution,auxiliaire,note) values ('SALAIRES_BRUTS','Remunerations du personnel','charge','{6}','par_nature',null,null) on conflict (code) do nothing;
insert into ref.account_roles (code,libelle,famille,classes_admises,resolution,auxiliaire,note) values ('CHARGES_SOCIALES_PATRONALES','Charges sociales legales','charge','{6}','par_nature',null,null) on conflict (code) do nothing;
insert into ref.account_roles (code,libelle,famille,classes_admises,resolution,auxiliaire,note) values ('INTERETS_EMPRUNTS','Charges d''interets','charge','{6}','fixe',null,'Seul role de charge admis sur une redevance de location-financement, avec DOTATION_AMORTISSEMENTS.') on conflict (code) do nothing;
insert into ref.account_roles (code,libelle,famille,classes_admises,resolution,auxiliaire,note) values ('DOTATION_AMORTISSEMENTS','Dotations aux amortissements des immobilisations','charge','{6}','fixe',null,null) on conflict (code) do nothing;
insert into ref.account_roles (code,libelle,famille,classes_admises,resolution,auxiliaire,note) values ('DOTATION_RESORPTION_CHARGES_REPORTEES','Dotations aux resorptions des charges reportees','charge','{6}','fixe',null,null) on conflict (code) do nothing;
insert into ref.account_roles (code,libelle,famille,classes_admises,resolution,auxiliaire,note) values ('DOTATION_PROVISIONS_EXPLOITATION','Dotations aux provisions pour risques et charges d''exploitation','charge','{6}','fixe',null,null) on conflict (code) do nothing;
insert into ref.account_roles (code,libelle,famille,classes_admises,resolution,auxiliaire,note) values ('DOTATION_DEPRECIATION_CREANCES','Dotations aux provisions pour depreciation des creances','charge','{6}','fixe',null,null) on conflict (code) do nothing;
insert into ref.account_roles (code,libelle,famille,classes_admises,resolution,auxiliaire,note) values ('IMMOBILISATION_CORPORELLE','Immobilisations corporelles en pleine propriete','actif_non_courant','{2}','par_nature',null,null) on conflict (code) do nothing;
insert into ref.account_roles (code,libelle,famille,classes_admises,resolution,auxiliaire,note) values ('IMMOBILISATION_STATUT_PARTICULIER','Immobilisations a statut juridique particulier','actif_non_courant','{2}','par_nature',null,'NC 41 : le bien pris en location-financement se loge ici, jamais avec les biens en pleine propriete.') on conflict (code) do nothing;
insert into ref.account_roles (code,libelle,famille,classes_admises,resolution,auxiliaire,note) values ('AMORTISSEMENT_IMMOBILISATION_CORPORELLE','Amortissements des immobilisations corporelles','actif_non_courant','{2}','par_nature',null,null) on conflict (code) do nothing;
insert into ref.account_roles (code,libelle,famille,classes_admises,resolution,auxiliaire,note) values ('AMORTISSEMENT_STATUT_PARTICULIER','Amortissements des immobilisations a statut juridique particulier','actif_non_courant','{2}','par_nature',null,null) on conflict (code) do nothing;
insert into ref.account_roles (code,libelle,famille,classes_admises,resolution,auxiliaire,note) values ('CHARGES_REPORTEES','Charges reportees','actif_non_courant','{2}','par_nature',null,'La resorption credite directement ce compte : il n''existe pas d''amortissement cumule pour les charges reportees. Valeur brute et cumul a suivre hors bilan.') on conflict (code) do nothing;
insert into ref.account_roles (code,libelle,famille,classes_admises,resolution,auxiliaire,note) values ('DETTE_LOCATION_FINANCEMENT','Dettes sur contrats de location-financement, part non courante','passif_non_courant','{1}','fixe',null,null) on conflict (code) do nothing;
insert into ref.account_roles (code,libelle,famille,classes_admises,resolution,auxiliaire,note) values ('DETTE_LOCATION_FINANCEMENT_COURANTE','Dettes sur contrats de location-financement, echeance a moins d''un an','passif_courant','{5}','fixe',null,null) on conflict (code) do nothing;
insert into ref.account_roles (code,libelle,famille,classes_admises,resolution,auxiliaire,note) values ('SUBVENTION_INVESTISSEMENT','Subventions d''investissement','capitaux_propres','{1}','fixe',null,null) on conflict (code) do nothing;
insert into ref.account_roles (code,libelle,famille,classes_admises,resolution,auxiliaire,note) values ('SUBVENTION_INVESTISSEMENT_INSCRITE_RESULTAT','Subventions d''investissement inscrites au resultat','capitaux_propres','{1}','fixe',null,null) on conflict (code) do nothing;
insert into ref.account_roles (code,libelle,famille,classes_admises,resolution,auxiliaire,note) values ('PROVISION_PERTE_A_TERMINAISON','Provisions pour pertes sur marches a achevement futur','passif_non_courant','{1}','fixe',null,null) on conflict (code) do nothing;
insert into ref.account_roles (code,libelle,famille,classes_admises,resolution,auxiliaire,note) values ('MODIFICATIONS_COMPTABLES_REPORTEES','Modifications comptables affectant les resultats reportes','capitaux_propres','{1}','fixe',null,'NC 11 §17 : une correction d''erreur fondamentale s''impute ici, jamais au resultat de l''exercice.') on conflict (code) do nothing;

-- --- liaisons par défaut TN ---
insert into ref.role_bindings (pack_version_id, role_code, account_code, perimetre, justification) select p.id,'CLIENT_COLLECTIF','4111',null,null from ref.jurisdiction_packs p where p.jurisdiction='TN' on conflict do nothing;
insert into ref.role_bindings (pack_version_id, role_code, account_code, perimetre, justification) select p.id,'CLIENT_RETENUE_GARANTIE','4117',null,null from ref.jurisdiction_packs p where p.jurisdiction='TN' on conflict do nothing;
insert into ref.role_bindings (pack_version_id, role_code, account_code, perimetre, justification) select p.id,'CLIENT_DOUTEUX','416',null,null from ref.jurisdiction_packs p where p.jurisdiction='TN' on conflict do nothing;
insert into ref.role_bindings (pack_version_id, role_code, account_code, perimetre, justification) select p.id,'CLIENT_TRAVAUX_NON_FACTURABLES','417',null,null from ref.jurisdiction_packs p where p.jurisdiction='TN' on conflict do nothing;
insert into ref.role_bindings (pack_version_id, role_code, account_code, perimetre, justification) select p.id,'CLIENT_AVOIRS_A_ETABLIR','4198',null,null from ref.jurisdiction_packs p where p.jurisdiction='TN' on conflict do nothing;
insert into ref.role_bindings (pack_version_id, role_code, account_code, perimetre, justification) select p.id,'CLIENT_AVANCES_RECUES','4191',null,null from ref.jurisdiction_packs p where p.jurisdiction='TN' on conflict do nothing;
insert into ref.role_bindings (pack_version_id, role_code, account_code, perimetre, justification) select p.id,'CLIENT_PROVISION_DEPRECIATION','491',null,null from ref.jurisdiction_packs p where p.jurisdiction='TN' on conflict do nothing;
insert into ref.role_bindings (pack_version_id, role_code, account_code, perimetre, justification) select p.id,'FOURNISSEUR_COLLECTIF','401',null,null from ref.jurisdiction_packs p where p.jurisdiction='TN' on conflict do nothing;
insert into ref.role_bindings (pack_version_id, role_code, account_code, perimetre, justification) select p.id,'FOURNISSEUR_IMMOBILISATIONS','404',null,null from ref.jurisdiction_packs p where p.jurisdiction='TN' on conflict do nothing;
insert into ref.role_bindings (pack_version_id, role_code, account_code, perimetre, justification) select p.id,'FOURNISSEUR_AVOIRS_A_RECEVOIR','4098',null,null from ref.jurisdiction_packs p where p.jurisdiction='TN' on conflict do nothing;
insert into ref.role_bindings (pack_version_id, role_code, account_code, perimetre, justification) select p.id,'PERSONNEL_REMUNERATIONS_DUES','425',null,null from ref.jurisdiction_packs p where p.jurisdiction='TN' on conflict do nothing;
insert into ref.role_bindings (pack_version_id, role_code, account_code, perimetre, justification) select p.id,'TVA_DEDUCTIBLE','4366',null,null from ref.jurisdiction_packs p where p.jurisdiction='TN' on conflict do nothing;
insert into ref.role_bindings (pack_version_id, role_code, account_code, perimetre, justification) select p.id,'TVA_COLLECTEE','4367',null,null from ref.jurisdiction_packs p where p.jurisdiction='TN' on conflict do nothing;
insert into ref.role_bindings (pack_version_id, role_code, account_code, perimetre, justification) select p.id,'TVA_A_PAYER','43651',null,null from ref.jurisdiction_packs p where p.jurisdiction='TN' on conflict do nothing;
insert into ref.role_bindings (pack_version_id, role_code, account_code, perimetre, justification) select p.id,'TVA_CREDIT_A_REPORTER','43667',null,null from ref.jurisdiction_packs p where p.jurisdiction='TN' on conflict do nothing;
insert into ref.role_bindings (pack_version_id, role_code, account_code, perimetre, justification) select p.id,'TIMBRE_COLLECTE','4371',null,'NC 01 ne subdivise pas 437. Le timbre n''est pas une taxe sur le chiffre d''affaires : la serie 436 lui est fermee. Seul rattachement officiel : 437, « credite du montant de tous les autres impots et taxes dus par l''entreprise ».' from ref.jurisdiction_packs p where p.jurisdiction='TN' on conflict do nothing;
insert into ref.role_bindings (pack_version_id, role_code, account_code, perimetre, justification) select p.id,'RETENUE_SOURCE_OPEREE','432',null,'NC 01, commentaire du compte 43 : « credite des retenues effectuees par l''entreprise pour le compte de l''Etat sur des sommes dues a des tiers ».' from ref.jurisdiction_packs p where p.jurisdiction='TN' on conflict do nothing;
insert into ref.role_bindings (pack_version_id, role_code, account_code, perimetre, justification) select p.id,'RETENUE_SOURCE_SUBIE','4341',null,'Subdivision officielle de 434 « Etat - impots sur les benefices » : acompte d''impot, au debit.' from ref.jurisdiction_packs p where p.jurisdiction='TN' on conflict do nothing;
insert into ref.role_bindings (pack_version_id, role_code, account_code, perimetre, justification) select p.id,'TFP_A_PAYER','4372',null,'Extension Malica sous 437, contrepartie de la charge officielle 6611.' from ref.jurisdiction_packs p where p.jurisdiction='TN' on conflict do nothing;
insert into ref.role_bindings (pack_version_id, role_code, account_code, perimetre, justification) select p.id,'FOPROLOS_A_PAYER','4373',null,'Extension Malica sous 437, contrepartie de la charge officielle 6612.' from ref.jurisdiction_packs p where p.jurisdiction='TN' on conflict do nothing;
insert into ref.role_bindings (pack_version_id, role_code, account_code, perimetre, justification) select p.id,'SUBVENTION_A_RECEVOIR','431',null,null from ref.jurisdiction_packs p where p.jurisdiction='TN' on conflict do nothing;
insert into ref.role_bindings (pack_version_id, role_code, account_code, perimetre, justification) select p.id,'ORGANISME_SOCIAL','45311',null,null from ref.jurisdiction_packs p where p.jurisdiction='TN' on conflict do nothing;
insert into ref.role_bindings (pack_version_id, role_code, account_code, perimetre, justification) select p.id,'BANQUE','532','53','Une liaison par compte bancaire du cabinet ou de la PME, sous le regroupement 53.' from ref.jurisdiction_packs p where p.jurisdiction='TN' on conflict do nothing;
insert into ref.role_bindings (pack_version_id, role_code, account_code, perimetre, justification) select p.id,'CAISSE','541',null,null from ref.jurisdiction_packs p where p.jurisdiction='TN' on conflict do nothing;
insert into ref.role_bindings (pack_version_id, role_code, account_code, perimetre, justification) select p.id,'VENTE_MARCHANDISES','707','70',null from ref.jurisdiction_packs p where p.jurisdiction='TN' on conflict do nothing;
insert into ref.role_bindings (pack_version_id, role_code, account_code, perimetre, justification) select p.id,'VENTE_PRODUITS_FINIS','701','70',null from ref.jurisdiction_packs p where p.jurisdiction='TN' on conflict do nothing;
insert into ref.role_bindings (pack_version_id, role_code, account_code, perimetre, justification) select p.id,'VENTE_SERVICES','706','70',null from ref.jurisdiction_packs p where p.jurisdiction='TN' on conflict do nothing;
insert into ref.role_bindings (pack_version_id, role_code, account_code, perimetre, justification) select p.id,'VENTE_TRAVAUX','704',null,null from ref.jurisdiction_packs p where p.jurisdiction='TN' on conflict do nothing;
insert into ref.role_bindings (pack_version_id, role_code, account_code, perimetre, justification) select p.id,'SUBVENTION_QUOTE_PART_RESULTAT','739',null,null from ref.jurisdiction_packs p where p.jurisdiction='TN' on conflict do nothing;
insert into ref.role_bindings (pack_version_id, role_code, account_code, perimetre, justification) select p.id,'ACHAT_MARCHANDISES','607','60',null from ref.jurisdiction_packs p where p.jurisdiction='TN' on conflict do nothing;
insert into ref.role_bindings (pack_version_id, role_code, account_code, perimetre, justification) select p.id,'ACHAT_MATIERES','601','60',null from ref.jurisdiction_packs p where p.jurisdiction='TN' on conflict do nothing;
insert into ref.role_bindings (pack_version_id, role_code, account_code, perimetre, justification) select p.id,'ACHAT_SERVICES_EXTERIEURS','61','61','Compte de regroupement : le socle resout la feuille (611 a 618) selon la nature de la ligne.' from ref.jurisdiction_packs p where p.jurisdiction='TN' on conflict do nothing;
insert into ref.role_bindings (pack_version_id, role_code, account_code, perimetre, justification) select p.id,'HONORAIRES','622','62',null from ref.jurisdiction_packs p where p.jurisdiction='TN' on conflict do nothing;
insert into ref.role_bindings (pack_version_id, role_code, account_code, perimetre, justification) select p.id,'LOCATION_SIMPLE_CHARGE','613',null,null from ref.jurisdiction_packs p where p.jurisdiction='TN' on conflict do nothing;
insert into ref.role_bindings (pack_version_id, role_code, account_code, perimetre, justification) select p.id,'TIMBRE_CHARGE','6654',null,null from ref.jurisdiction_packs p where p.jurisdiction='TN' on conflict do nothing;
insert into ref.role_bindings (pack_version_id, role_code, account_code, perimetre, justification) select p.id,'TFP_CHARGE','6611',null,null from ref.jurisdiction_packs p where p.jurisdiction='TN' on conflict do nothing;
insert into ref.role_bindings (pack_version_id, role_code, account_code, perimetre, justification) select p.id,'FOPROLOS_CHARGE','6612',null,null from ref.jurisdiction_packs p where p.jurisdiction='TN' on conflict do nothing;
insert into ref.role_bindings (pack_version_id, role_code, account_code, perimetre, justification) select p.id,'SALAIRES_BRUTS','640','64',null from ref.jurisdiction_packs p where p.jurisdiction='TN' on conflict do nothing;
insert into ref.role_bindings (pack_version_id, role_code, account_code, perimetre, justification) select p.id,'CHARGES_SOCIALES_PATRONALES','647','64',null from ref.jurisdiction_packs p where p.jurisdiction='TN' on conflict do nothing;
insert into ref.role_bindings (pack_version_id, role_code, account_code, perimetre, justification) select p.id,'INTERETS_EMPRUNTS','651',null,null from ref.jurisdiction_packs p where p.jurisdiction='TN' on conflict do nothing;
insert into ref.role_bindings (pack_version_id, role_code, account_code, perimetre, justification) select p.id,'DOTATION_AMORTISSEMENTS','6811',null,null from ref.jurisdiction_packs p where p.jurisdiction='TN' on conflict do nothing;
insert into ref.role_bindings (pack_version_id, role_code, account_code, perimetre, justification) select p.id,'DOTATION_RESORPTION_CHARGES_REPORTEES','6812',null,null from ref.jurisdiction_packs p where p.jurisdiction='TN' on conflict do nothing;
insert into ref.role_bindings (pack_version_id, role_code, account_code, perimetre, justification) select p.id,'DOTATION_PROVISIONS_EXPLOITATION','6815',null,null from ref.jurisdiction_packs p where p.jurisdiction='TN' on conflict do nothing;
insert into ref.role_bindings (pack_version_id, role_code, account_code, perimetre, justification) select p.id,'DOTATION_DEPRECIATION_CREANCES','68174',null,null from ref.jurisdiction_packs p where p.jurisdiction='TN' on conflict do nothing;
insert into ref.role_bindings (pack_version_id, role_code, account_code, perimetre, justification) select p.id,'IMMOBILISATION_CORPORELLE','22','22','Le socle resout 221 a 228 selon la nature du bien.' from ref.jurisdiction_packs p where p.jurisdiction='TN' on conflict do nothing;
insert into ref.role_bindings (pack_version_id, role_code, account_code, perimetre, justification) select p.id,'IMMOBILISATION_STATUT_PARTICULIER','24','24','NC 01, commentaire du compte 24 : « ventile dans les memes conditions que le compte 22 ». Les feuilles 241 a 248 sont des extensions Malica.' from ref.jurisdiction_packs p where p.jurisdiction='TN' on conflict do nothing;
insert into ref.role_bindings (pack_version_id, role_code, account_code, perimetre, justification) select p.id,'AMORTISSEMENT_IMMOBILISATION_CORPORELLE','282','282',null from ref.jurisdiction_packs p where p.jurisdiction='TN' on conflict do nothing;
insert into ref.role_bindings (pack_version_id, role_code, account_code, perimetre, justification) select p.id,'AMORTISSEMENT_STATUT_PARTICULIER','284','284',null from ref.jurisdiction_packs p where p.jurisdiction='TN' on conflict do nothing;
insert into ref.role_bindings (pack_version_id, role_code, account_code, perimetre, justification) select p.id,'CHARGES_REPORTEES','27','27','271 frais preliminaires, 272 charges a repartir, 273 frais d''emission — categories fermees par NC 10 §04.' from ref.jurisdiction_packs p where p.jurisdiction='TN' on conflict do nothing;
insert into ref.role_bindings (pack_version_id, role_code, account_code, perimetre, justification) select p.id,'DETTE_LOCATION_FINANCEMENT','1686',null,'NC 41 (2008) posterieure a la nomenclature NC 01 (1996) : aucun compte dedie. 168 = {1681,1685,1688}, le 1686 est libre.' from ref.jurisdiction_packs p where p.jurisdiction='TN' on conflict do nothing;
insert into ref.role_bindings (pack_version_id, role_code, account_code, perimetre, justification) select p.id,'DETTE_LOCATION_FINANCEMENT_COURANTE','505',null,'NC 41 §20 impose le partage courant / non courant. NC 01 : « Les comptes 505 et 508 enregistrent, respectivement, la partie a moins d''un an des emprunts non courants et les interets courus non echus a la cloture ».' from ref.jurisdiction_packs p where p.jurisdiction='TN' on conflict do nothing;
insert into ref.role_bindings (pack_version_id, role_code, account_code, perimetre, justification) select p.id,'SUBVENTION_INVESTISSEMENT','1451',null,null from ref.jurisdiction_packs p where p.jurisdiction='TN' on conflict do nothing;
insert into ref.role_bindings (pack_version_id, role_code, account_code, perimetre, justification) select p.id,'SUBVENTION_INVESTISSEMENT_INSCRITE_RESULTAT','1459',null,null from ref.jurisdiction_packs p where p.jurisdiction='TN' on conflict do nothing;
insert into ref.role_bindings (pack_version_id, role_code, account_code, perimetre, justification) select p.id,'PROVISION_PERTE_A_TERMINAISON','1513',null,null from ref.jurisdiction_packs p where p.jurisdiction='TN' on conflict do nothing;
insert into ref.role_bindings (pack_version_id, role_code, account_code, perimetre, justification) select p.id,'MODIFICATIONS_COMPTABLES_REPORTEES','128',null,null from ref.jurisdiction_packs p where p.jurisdiction='TN' on conflict do nothing;

-- --- schémas ---
insert into ref.entry_templates (code,libelle,journal_code,norme,paragraphes,statut,regle,controle) values ('VENTE_BIENS','Facture de vente de biens','VEN','NC 03','{"06","09","11"}','texte','Revenu net de remises et rendus ; les taxes collectees pour le compte de l''Etat n''en font pas partie. Constatation subordonnee au transfert des risques et avantages.',null) on conflict (code) do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('VENTE_BIENS',1,'CLIENT_COLLECTIF','debit','ttc',null) on conflict do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('VENTE_BIENS',2,'VENTE_MARCHANDISES','credit','montant_ht',null) on conflict do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('VENTE_BIENS',3,'TVA_COLLECTEE','credit','tva',null) on conflict do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('VENTE_BIENS',4,'TIMBRE_COLLECTE','credit','timbre',null) on conflict do nothing;
insert into ref.entry_templates (code,libelle,journal_code,norme,paragraphes,statut,regle,controle) values ('VENTE_PRODUITS','Facture de vente de produits finis','VEN','NC 03','{"06","09"}','texte',null,null) on conflict (code) do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('VENTE_PRODUITS',1,'CLIENT_COLLECTIF','debit','ttc',null) on conflict do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('VENTE_PRODUITS',2,'VENTE_PRODUITS_FINIS','credit','montant_ht',null) on conflict do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('VENTE_PRODUITS',3,'TVA_COLLECTEE','credit','tva',null) on conflict do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('VENTE_PRODUITS',4,'TIMBRE_COLLECTE','credit','timbre',null) on conflict do nothing;
insert into ref.entry_templates (code,libelle,journal_code,norme,paragraphes,statut,regle,controle) values ('VENTE_SERVICES','Facture de prestation de services','VEN','NC 03','{"14","15"}','texte','Revenu au degre d''avancement. Hors regie, un acompte recu ou une situation facturee ne mesure pas l''avancement.',null) on conflict (code) do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('VENTE_SERVICES',1,'CLIENT_COLLECTIF','debit','ttc',null) on conflict do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('VENTE_SERVICES',2,'VENTE_SERVICES','credit','montant_ht',null) on conflict do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('VENTE_SERVICES',3,'TVA_COLLECTEE','credit','tva',null) on conflict do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('VENTE_SERVICES',4,'TIMBRE_COLLECTE','credit','timbre',null) on conflict do nothing;
insert into ref.entry_templates (code,libelle,journal_code,norme,paragraphes,statut,regle,controle) values ('VENTE_EXONEREE','Facture de vente exoneree ou a l''export','VEN','NC 03','{"06"}','texte',null,null) on conflict (code) do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('VENTE_EXONEREE',1,'CLIENT_COLLECTIF','debit','ttc',null) on conflict do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('VENTE_EXONEREE',2,'VENTE_MARCHANDISES','credit','montant_ht',null) on conflict do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('VENTE_EXONEREE',3,'TIMBRE_COLLECTE','credit','timbre',null) on conflict do nothing;
insert into ref.entry_templates (code,libelle,journal_code,norme,paragraphes,statut,regle,controle) values ('VENTE_TRAVAUX_AVANCEMENT','Constatation du revenu a l''avancement, contrat de construction','OD','NC 09','{"11","15"}','texte','Revenu au pourcentage d''avancement. Les avances recues ne mesurent pas l''avancement.',null) on conflict (code) do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('VENTE_TRAVAUX_AVANCEMENT',1,'CLIENT_TRAVAUX_NON_FACTURABLES','debit','revenu_avancement',null) on conflict do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('VENTE_TRAVAUX_AVANCEMENT',2,'VENTE_TRAVAUX','credit','revenu_avancement',null) on conflict do nothing;
insert into ref.entry_templates (code,libelle,journal_code,norme,paragraphes,statut,regle,controle) values ('VENTE_TRAVAUX_FACTURATION','Facturation d''une situation avec retenue de garantie','VEN','NC 09','{"05"}','texte',null,null) on conflict (code) do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('VENTE_TRAVAUX_FACTURATION',1,'CLIENT_COLLECTIF','debit','ttc - retenue_garantie',null) on conflict do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('VENTE_TRAVAUX_FACTURATION',2,'CLIENT_RETENUE_GARANTIE','debit','retenue_garantie',null) on conflict do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('VENTE_TRAVAUX_FACTURATION',3,'CLIENT_TRAVAUX_NON_FACTURABLES','credit','montant_ht',null) on conflict do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('VENTE_TRAVAUX_FACTURATION',4,'TVA_COLLECTEE','credit','tva',null) on conflict do nothing;
insert into ref.entry_templates (code,libelle,journal_code,norme,paragraphes,statut,regle,controle) values ('AVANCE_CLIENT','Avance ou acompte recu d''un client','BQ','NC 03','{"15"}','texte','Hors regie, l''acompte recu ne mesure pas l''avancement : il reste au passif jusqu''a constatation du revenu.',null) on conflict (code) do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('AVANCE_CLIENT',1,'BANQUE','debit','avance',null) on conflict do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('AVANCE_CLIENT',2,'CLIENT_AVANCES_RECUES','credit','avance',null) on conflict do nothing;
insert into ref.entry_templates (code,libelle,journal_code,norme,paragraphes,statut,regle,controle) values ('AVOIR_CLIENT','Avoir client pour rendu ou reduction accordee','VEN','NC 03','{"06","25"}','texte','Un rendu accepte reduit le revenu. Un IMPAYE ne le reduit pas : il se traite par provision.','REVENU_NON_ANNULABLE') on conflict (code) do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('AVOIR_CLIENT',1,'CLIENT_AVOIRS_A_ETABLIR','debit','montant_ht',null) on conflict do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('AVOIR_CLIENT',2,'TVA_COLLECTEE','debit','tva',null) on conflict do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('AVOIR_CLIENT',3,'CLIENT_COLLECTIF','credit','ttc',null) on conflict do nothing;
insert into ref.entry_templates (code,libelle,journal_code,norme,paragraphes,statut,regle,controle) values ('PROVISION_CLIENT','Client douteux et provision pour depreciation','OD','NC 03','{"25"}','texte','« le montant initialement comptabilise au titre des revenus n''est pas ajuste »',null) on conflict (code) do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('PROVISION_CLIENT',1,'CLIENT_DOUTEUX','debit','creance_ttc',null) on conflict do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('PROVISION_CLIENT',2,'CLIENT_COLLECTIF','credit','creance_ttc',null) on conflict do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('PROVISION_CLIENT',3,'DOTATION_DEPRECIATION_CREANCES','debit','provision',null) on conflict do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('PROVISION_CLIENT',4,'CLIENT_PROVISION_DEPRECIATION','credit','provision',null) on conflict do nothing;
insert into ref.entry_templates (code,libelle,journal_code,norme,paragraphes,statut,regle,controle) values ('ACHAT_MARCHANDISES','Facture d''achat de marchandises','ACH','NC 04','{"12","13"}','texte','Le cout comprend le prix d''achat, les droits de douane et taxes NON recuperables, le transport et l''assurance de reception.',null) on conflict (code) do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('ACHAT_MARCHANDISES',1,'ACHAT_MARCHANDISES','debit','montant_ht',null) on conflict do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('ACHAT_MARCHANDISES',2,'TVA_DEDUCTIBLE','debit','tva',null) on conflict do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('ACHAT_MARCHANDISES',3,'FOURNISSEUR_COLLECTIF','credit','ttc',null) on conflict do nothing;
insert into ref.entry_templates (code,libelle,journal_code,norme,paragraphes,statut,regle,controle) values ('ACHAT_MATIERES','Facture d''achat de matieres premieres et fournitures liees','ACH','NC 04','{"12"}','texte',null,null) on conflict (code) do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('ACHAT_MATIERES',1,'ACHAT_MATIERES','debit','montant_ht',null) on conflict do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('ACHAT_MATIERES',2,'TVA_DEDUCTIBLE','debit','tva',null) on conflict do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('ACHAT_MATIERES',3,'FOURNISSEUR_COLLECTIF','credit','ttc',null) on conflict do nothing;
insert into ref.entry_templates (code,libelle,journal_code,norme,paragraphes,statut,regle,controle) values ('ACHAT_TVA_NON_RECUPERABLE','Achat dont la TVA n''est pas recuperable','ACH','NC 04','{"12"}','texte','Les taxes non recuperables s''incorporent au cout du bien : elles ne sont pas une charge d''impot.',null) on conflict (code) do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('ACHAT_TVA_NON_RECUPERABLE',1,'ACHAT_MARCHANDISES','debit','montant_ht + tva_nd',null) on conflict do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('ACHAT_TVA_NON_RECUPERABLE',2,'TVA_DEDUCTIBLE','debit','tva - tva_nd',null) on conflict do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('ACHAT_TVA_NON_RECUPERABLE',3,'FOURNISSEUR_COLLECTIF','credit','ttc',null) on conflict do nothing;
insert into ref.entry_templates (code,libelle,journal_code,norme,paragraphes,statut,regle,controle) values ('ACHAT_SERVICES','Facture de prestation de services recue','ACH',null,null,null,null,null) on conflict (code) do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('ACHAT_SERVICES',1,'ACHAT_SERVICES_EXTERIEURS','debit','montant_ht',null) on conflict do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('ACHAT_SERVICES',2,'TVA_DEDUCTIBLE','debit','tva',null) on conflict do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('ACHAT_SERVICES',3,'FOURNISSEUR_COLLECTIF','credit','ttc',null) on conflict do nothing;
insert into ref.entry_templates (code,libelle,journal_code,norme,paragraphes,statut,regle,controle) values ('ACHAT_HONORAIRES_RS','Facture d''honoraires avec retenue a la source','ACH','NC 01',null,'texte','« Le compte 432 est credite des retenues effectuees par l''entreprise pour le compte de l''Etat sur des sommes dues a des tiers par le debit de leurs comptes. »',null) on conflict (code) do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('ACHAT_HONORAIRES_RS',1,'HONORAIRES','debit','montant_ht',null) on conflict do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('ACHAT_HONORAIRES_RS',2,'TVA_DEDUCTIBLE','debit','tva',null) on conflict do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('ACHAT_HONORAIRES_RS',3,'RETENUE_SOURCE_OPEREE','credit','rs',null) on conflict do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('ACHAT_HONORAIRES_RS',4,'FOURNISSEUR_COLLECTIF','credit','net_a_payer',null) on conflict do nothing;
insert into ref.entry_templates (code,libelle,journal_code,norme,paragraphes,statut,regle,controle) values ('ACHAT_IMMOBILISATION','Facture d''acquisition d''immobilisation corporelle','ACH','NC 05',null,'texte',null,null) on conflict (code) do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('ACHAT_IMMOBILISATION',1,'IMMOBILISATION_CORPORELLE','debit','montant_ht',null) on conflict do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('ACHAT_IMMOBILISATION',2,'TVA_DEDUCTIBLE','debit','tva',null) on conflict do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('ACHAT_IMMOBILISATION',3,'FOURNISSEUR_IMMOBILISATIONS','credit','ttc',null) on conflict do nothing;
insert into ref.entry_templates (code,libelle,journal_code,norme,paragraphes,statut,regle,controle) values ('AVOIR_FOURNISSEUR','Avoir fournisseur','ACH',null,null,null,null,null) on conflict (code) do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('AVOIR_FOURNISSEUR',1,'FOURNISSEUR_COLLECTIF','debit','ttc',null) on conflict do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('AVOIR_FOURNISSEUR',2,'FOURNISSEUR_AVOIRS_A_RECEVOIR','credit','montant_ht',null) on conflict do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('AVOIR_FOURNISSEUR',3,'TVA_DEDUCTIBLE','credit','tva',null) on conflict do nothing;
insert into ref.entry_templates (code,libelle,journal_code,norme,paragraphes,statut,regle,controle) values ('ENCAISSEMENT_CLIENT','Encaissement d''une creance client','BQ','NC 01',null,'texte','La retenue subie est un acompte d''impot sur les benefices, non une dette.',null) on conflict (code) do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('ENCAISSEMENT_CLIENT',1,'BANQUE','debit','montant_encaisse',null) on conflict do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('ENCAISSEMENT_CLIENT',2,'RETENUE_SOURCE_SUBIE','debit','rs_subie',null) on conflict do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('ENCAISSEMENT_CLIENT',3,'CLIENT_COLLECTIF','credit','creance_soldee',null) on conflict do nothing;
insert into ref.entry_templates (code,libelle,journal_code,norme,paragraphes,statut,regle,controle) values ('DECAISSEMENT_FOURNISSEUR','Reglement d''un fournisseur','BQ',null,null,null,null,null) on conflict (code) do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('DECAISSEMENT_FOURNISSEUR',1,'FOURNISSEUR_COLLECTIF','debit','dette_soldee',null) on conflict do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('DECAISSEMENT_FOURNISSEUR',2,'BANQUE','credit','montant_decaisse',null) on conflict do nothing;
insert into ref.entry_templates (code,libelle,journal_code,norme,paragraphes,statut,regle,controle) values ('PAIE_SALAIRES','Comptabilisation de la paie','OD','NC 01',null,'texte','« du montant des retenues sur salaires au titre des impots sur salaires et appointements par le credit du compte 432 » ; « de la quote-part des charges sociales incombant au personnel par le credit du compte 453 »',null) on conflict (code) do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('PAIE_SALAIRES',1,'SALAIRES_BRUTS','debit','salaire_brut',null) on conflict do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('PAIE_SALAIRES',2,'ORGANISME_SOCIAL','credit','cnss_salariale',null) on conflict do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('PAIE_SALAIRES',3,'RETENUE_SOURCE_OPEREE','credit','irpp_retenu',null) on conflict do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('PAIE_SALAIRES',4,'PERSONNEL_REMUNERATIONS_DUES','credit','net_a_payer_salarie',null) on conflict do nothing;
insert into ref.entry_templates (code,libelle,journal_code,norme,paragraphes,statut,regle,controle) values ('PAIE_CHARGES_PATRONALES','Charges sociales patronales','OD',null,null,null,null,null) on conflict (code) do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('PAIE_CHARGES_PATRONALES',1,'CHARGES_SOCIALES_PATRONALES','debit','cnss_patronale',null) on conflict do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('PAIE_CHARGES_PATRONALES',2,'ORGANISME_SOCIAL','credit','cnss_patronale',null) on conflict do nothing;
insert into ref.entry_templates (code,libelle,journal_code,norme,paragraphes,statut,regle,controle) values ('TFP_FOPROLOS','TFP et FOPROLOS','OD',null,null,null,null,null) on conflict (code) do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('TFP_FOPROLOS',1,'TFP_CHARGE','debit','tfp',null) on conflict do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('TFP_FOPROLOS',2,'FOPROLOS_CHARGE','debit','foprolos',null) on conflict do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('TFP_FOPROLOS',3,'TFP_A_PAYER','credit','tfp',null) on conflict do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('TFP_FOPROLOS',4,'FOPROLOS_A_PAYER','credit','foprolos',null) on conflict do nothing;
insert into ref.entry_templates (code,libelle,journal_code,norme,paragraphes,statut,regle,controle) values ('LIQUIDATION_TVA','Liquidation periodique de la TVA','OD','NC 01',null,'texte',null,null) on conflict (code) do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('LIQUIDATION_TVA',1,'TVA_COLLECTEE','debit','tva_collectee_periode',null) on conflict do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('LIQUIDATION_TVA',2,'TVA_DEDUCTIBLE','credit','tva_deductible_periode',null) on conflict do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('LIQUIDATION_TVA',3,'TVA_A_PAYER','credit','tva_a_payer',null) on conflict do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('LIQUIDATION_TVA',4,'TVA_CREDIT_A_REPORTER','debit','credit_a_reporter',null) on conflict do nothing;
insert into ref.entry_templates (code,libelle,journal_code,norme,paragraphes,statut,regle,controle) values ('TIMBRE_REVERSEMENT','Reversement du droit de timbre collecte','BQ',null,null,null,null,null) on conflict (code) do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('TIMBRE_REVERSEMENT',1,'TIMBRE_COLLECTE','debit','timbre_periode',null) on conflict do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('TIMBRE_REVERSEMENT',2,'BANQUE','credit','timbre_periode',null) on conflict do nothing;
insert into ref.entry_templates (code,libelle,journal_code,norme,paragraphes,statut,regle,controle) values ('TIMBRE_SUPPORTE','Droit de timbre supporte en charge','OD',null,null,null,null,null) on conflict (code) do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('TIMBRE_SUPPORTE',1,'TIMBRE_CHARGE','debit','timbre',null) on conflict do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('TIMBRE_SUPPORTE',2,'BANQUE','credit','timbre',null) on conflict do nothing;
insert into ref.entry_templates (code,libelle,journal_code,norme,paragraphes,statut,regle,controle) values ('LEASING_ENTREE','Entree d''un bien en location-financement','OD','NC 41','{"17","19","21"}','texte','Actif et passif au meme montant : le plus faible de la juste valeur et de la valeur actualisee des paiements minimaux. Taux implicite en priorite ; taux marginal seulement s''il est indeterminable.',null) on conflict (code) do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('LEASING_ENTREE',1,'IMMOBILISATION_STATUT_PARTICULIER','debit','valeur_initiale + couts_directs_initiaux',null) on conflict do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('LEASING_ENTREE',2,'DETTE_LOCATION_FINANCEMENT','credit','valeur_initiale',null) on conflict do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('LEASING_ENTREE',3,'BANQUE','credit','couts_directs_initiaux',null) on conflict do nothing;
insert into ref.entry_templates (code,libelle,journal_code,norme,paragraphes,statut,regle,controle) values ('LEASING_REDEVANCE','Paiement d''une redevance de location-financement','BQ','NC 41','{"22","26"}','texte','« Les paiements minimaux au titre de la location doivent etre ventiles entre la charge financiere et l''amortissement du solde de la dette. » « il est donc inapproprie de se contenter de comptabiliser en charges les paiements a effectuer au titre de la location. »','LOCATION_FINANCEMENT_SANS_CHARGE_DE_LOYER') on conflict (code) do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('LEASING_REDEVANCE',1,'DETTE_LOCATION_FINANCEMENT','debit','part_principal',null) on conflict do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('LEASING_REDEVANCE',2,'INTERETS_EMPRUNTS','debit','part_interets','Taux actuariel : taux periodique constant sur le capital restant du. Jamais lineaire.') on conflict do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('LEASING_REDEVANCE',3,'TVA_DEDUCTIBLE','debit','tva',null) on conflict do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('LEASING_REDEVANCE',4,'BANQUE','credit','redevance_ttc',null) on conflict do nothing;
insert into ref.entry_templates (code,libelle,journal_code,norme,paragraphes,statut,regle,controle) values ('LEASING_AMORTISSEMENT','Amortissement d''un bien en location-financement','OD','NC 41','{"24","25"}','texte','Duree d''utilite si la levee d''option est raisonnablement certaine ; sinon la plus courte de la duree du bail et de la duree d''utilite.',null) on conflict (code) do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('LEASING_AMORTISSEMENT',1,'DOTATION_AMORTISSEMENTS','debit','dotation',null) on conflict do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('LEASING_AMORTISSEMENT',2,'AMORTISSEMENT_STATUT_PARTICULIER','credit','dotation',null) on conflict do nothing;
insert into ref.entry_templates (code,libelle,journal_code,norme,paragraphes,statut,regle,controle) values ('LEASING_RECLASSEMENT_COURANT','Reclassement de la part a moins d''un an a la cloture','OD','NC 41','{"20"}','texte',null,null) on conflict (code) do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('LEASING_RECLASSEMENT_COURANT',1,'DETTE_LOCATION_FINANCEMENT','debit','echeance_moins_un_an',null) on conflict do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('LEASING_RECLASSEMENT_COURANT',2,'DETTE_LOCATION_FINANCEMENT_COURANTE','credit','echeance_moins_un_an',null) on conflict do nothing;
insert into ref.entry_templates (code,libelle,journal_code,norme,paragraphes,statut,regle,controle) values ('LOCATION_SIMPLE','Loyer de location simple','ACH','NC 41','{"30","31"}','texte','Linearisation obligatoire sur la duree du bail, y compris en presence de paliers ou de franchises.',null) on conflict (code) do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('LOCATION_SIMPLE',1,'LOCATION_SIMPLE_CHARGE','debit','loyer_linearise',null) on conflict do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('LOCATION_SIMPLE',2,'TVA_DEDUCTIBLE','debit','tva',null) on conflict do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('LOCATION_SIMPLE',3,'FOURNISSEUR_COLLECTIF','credit','loyer_ttc',null) on conflict do nothing;
insert into ref.entry_templates (code,libelle,journal_code,norme,paragraphes,statut,regle,controle) values ('DOTATION_AMORTISSEMENT','Dotation aux amortissements des immobilisations','OD','NC 05',null,'texte',null,null) on conflict (code) do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('DOTATION_AMORTISSEMENT',1,'DOTATION_AMORTISSEMENTS','debit','dotation',null) on conflict do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('DOTATION_AMORTISSEMENT',2,'AMORTISSEMENT_IMMOBILISATION_CORPORELLE','credit','dotation',null) on conflict do nothing;
insert into ref.entry_templates (code,libelle,journal_code,norme,paragraphes,statut,regle,controle) values ('SUBVENTION_INVESTISSEMENT_OCTROI','Octroi d''une subvention d''investissement','OD','NC 12','{"11"}','texte',null,null) on conflict (code) do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('SUBVENTION_INVESTISSEMENT_OCTROI',1,'SUBVENTION_A_RECEVOIR','debit','subvention',null) on conflict do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('SUBVENTION_INVESTISSEMENT_OCTROI',2,'SUBVENTION_INVESTISSEMENT','credit','subvention',null) on conflict do nothing;
insert into ref.entry_templates (code,libelle,journal_code,norme,paragraphes,statut,regle,controle) values ('SUBVENTION_INVESTISSEMENT_REPRISE','Reprise annuelle d''une subvention d''investissement','OD','NC 12','{"14"}','texte','Reprise strictement proportionnelle a l''amortissement du bien finance.',null) on conflict (code) do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('SUBVENTION_INVESTISSEMENT_REPRISE',1,'SUBVENTION_INVESTISSEMENT_INSCRITE_RESULTAT','debit','quote_part',null) on conflict do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('SUBVENTION_INVESTISSEMENT_REPRISE',2,'SUBVENTION_QUOTE_PART_RESULTAT','credit','quote_part',null) on conflict do nothing;
insert into ref.entry_templates (code,libelle,journal_code,norme,paragraphes,statut,regle,controle) values ('CHARGE_REPORTEE_RESORPTION','Resorption d''une charge reportee','OD','NC 10',null,'texte','« Le compte 27 est credite a la fin de chaque exercice, par le debit du compte 6812 ». Il n''existe pas d''amortissement cumule pour les charges reportees : la valeur brute et le cumul des resorptions se suivent hors bilan, pour la note exigee par NC 10 §30.',null) on conflict (code) do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('CHARGE_REPORTEE_RESORPTION',1,'DOTATION_RESORPTION_CHARGES_REPORTEES','debit','resorption',null) on conflict do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('CHARGE_REPORTEE_RESORPTION',2,'CHARGES_REPORTEES','credit','resorption',null) on conflict do nothing;
insert into ref.entry_templates (code,libelle,journal_code,norme,paragraphes,statut,regle,controle) values ('PERTE_A_TERMINAISON','Provision pour perte a terminaison sur contrat','OD','NC 09','{"25","26"}','texte','Constituee meme si le chantier n''a pas demarre ; jamais compensee par les profits d''autres contrats.',null) on conflict (code) do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('PERTE_A_TERMINAISON',1,'DOTATION_PROVISIONS_EXPLOITATION','debit','perte_attendue',null) on conflict do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('PERTE_A_TERMINAISON',2,'PROVISION_PERTE_A_TERMINAISON','credit','perte_attendue',null) on conflict do nothing;
insert into ref.entry_templates (code,libelle,journal_code,norme,paragraphes,statut,regle,controle) values ('MODIFICATION_COMPTABLE','Modification comptable ou correction d''erreur fondamentale','OD','NC 11','{"17"}','texte','L''ajustement s''impute en capitaux propres, jamais au resultat de l''exercice.','CORRECTION_HORS_RESULTAT') on conflict (code) do nothing;
insert into ref.entry_template_lines (template_code,ordre,role_code,sens,grandeur,note) values ('MODIFICATION_COMPTABLE',1,'MODIFICATIONS_COMPTABLES_REPORTEES','debit_ou_credit','ajustement',null) on conflict do nothing;

-- --- contrôles ---
insert into ref.entry_controls (code,portee,regle,norme,paragraphes,statut,message) values ('LOCATION_FINANCEMENT_SANS_CHARGE_DE_LOYER','toute ecriture rattachee a un contrat classe en location-financement','Aucune ligne ne peut debiter un compte de charge, a l''exception des roles INTERETS_EMPRUNTS et DOTATION_AMORTISSEMENTS.','NC 41','{"22","26"}','texte','NC 41 §26 : « il est donc inapproprie de se contenter de comptabiliser en charges les paiements a effectuer au titre de la location ». La redevance se ventile entre remboursement du principal, charge financiere et amortissement du bien.') on conflict (code) do nothing;
insert into ref.entry_controls (code,portee,regle,norme,paragraphes,statut,message) values ('REVENU_NON_ANNULABLE','toute ecriture debitant un role de la famille ''produit'' en diminution d''un revenu deja comptabilise','Refusee lorsque le motif est un defaut de recouvrement. Le traitement legal est le passage en client douteux et la provision.','NC 03','{"25"}','texte','NC 03 §25 : « le montant initialement comptabilise au titre des revenus n''est pas ajuste ». Utilisez le schema PROVISION_CLIENT.') on conflict (code) do nothing;
insert into ref.entry_controls (code,portee,regle,norme,paragraphes,statut,message) values ('TAXE_COLLECTEE_JAMAIS_UN_REVENU','liaison role -> compte, verifiee au chargement et a chaque modification par l''expert','Les roles TVA_COLLECTEE, TIMBRE_COLLECTE et RETENUE_SOURCE_OPEREE n''admettent que la classe 4. La liaison vers un compte de produit est impossible.','NC 03','{"06"}','texte','NC 03 §06 : « Les sommes encaissees pour le compte de tiers, par exemple les taxes collectees pour le compte de l''Etat [...] ne font pas partie des revenus ».') on conflict (code) do nothing;
insert into ref.entry_controls (code,portee,regle,norme,paragraphes,statut,message) values ('CORRECTION_HORS_RESULTAT','correction d''erreur fondamentale au sens de NC 11 §06','Aucune ligne ne peut toucher un role des familles ''produit'' ou ''charge''.','NC 11','{"17"}','texte','NC 11 §17 : l''ajustement s''impute en capitaux propres, jamais au resultat de l''exercice.') on conflict (code) do nothing;
insert into ref.entry_controls (code,portee,regle,norme,paragraphes,statut,message) values ('LIAISON_OBLIGATOIRE','resolution d''un role au moment de la comptabilisation','Un role sans liaison — ni surcharge du tenant, ni defaut de juridiction — leve une erreur explicite nommant le role manquant. Aucun compte n''est jamais devine, ni choisi par defaut, ni cree a la volee.',null,null,'lecture','Le role {role} n''est relie a aucun compte pour ce dossier. Rattachez-le dans le parametrage du plan comptable.') on conflict (code) do nothing;
