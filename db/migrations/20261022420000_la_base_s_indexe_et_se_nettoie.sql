-- La base s'indexe et se nettoie (20 octobre 2026).
--
-- Règles non négociables du 20 octobre 2026 : « tout en tables avec index »,
-- « zéro doublon ». L'audit du code a relevé :
--   • 117 clés étrangères sans index de même tête : une suppression en
--     cascade ou une jointure balayait la table entière ;
--   • 4 index identiques à une clé primaire ou unique ;
--   • une ancienne surcharge de `capture_piece_register` (8 arguments), restée
--     à côté de la version à 10 arguments que l'API appelle ;
--   • `ref.account_classes` et `ref.recharges` sans RLS, alors que toutes les
--     autres tables de référence l'ont (lecture pour `authenticated`).
--
-- Les index sont nommés `<table>_<colonnes>_fk_idx`. Liste produite depuis le
-- catalogue (`abonnement-outils/fk-sans-index.sql`), figée ici pour que le
-- rejeu soit identique.
-- REJEU (R11) : `if not exists` / `if exists`.

begin;

-- 1. Les clés étrangères ont leur index.
create index if not exists arbitrages_conversation_id_fk_idx on agents.arbitrages (conversation_id);
create index if not exists arbitrages_message_id_fk_idx on agents.arbitrages (message_id);
create index if not exists conversations_tenant_id_fk_idx on agents.conversations (tenant_id);
create index if not exists reponse_controles_message_id_fk_idx on agents.reponse_controles (message_id);
create index if not exists reponse_controles_tenant_id_fk_idx on agents.reponse_controles (tenant_id);
create index if not exists event_log_motif_id_fk_idx on audit.event_log (motif_id);
create index if not exists event_log_pack_version_id_fk_idx on audit.event_log (pack_version_id);
create index if not exists comptes_entity_id_fk_idx on banque.comptes (entity_id);
create index if not exists lettrage_etat_ecriture_id_fk_idx on banque.lettrage_etat (ecriture_id);
create index if not exists lettrage_etat_pack_version_id_fk_idx on banque.lettrage_etat (pack_version_id);
create index if not exists lettrages_ecriture_id_fk_idx on banque.lettrages (ecriture_id);
create index if not exists lettrages_motif_id_fk_idx on banque.lettrages (motif_id);
create index if not exists lettrages_pack_version_id_fk_idx on banque.lettrages (pack_version_id);
create index if not exists rapprochements_ecriture_id_fk_idx on banque.rapprochements (ecriture_id);
create index if not exists rapprochements_motif_id_fk_idx on banque.rapprochements (motif_id);
create index if not exists rapprochements_pack_version_id_fk_idx on banque.rapprochements (pack_version_id);
create index if not exists invoice_lines_product_id_fk_idx on billing.invoice_lines (product_id);
create index if not exists invoices_entity_id_fk_idx on billing.invoices (entity_id);
create index if not exists invoices_reverses_id_fk_idx on billing.invoices (reverses_id);
create index if not exists analyses_extraction_id_fk_idx on capture.analyses (extraction_id);
create index if not exists analyses_pack_version_id_fk_idx on capture.analyses (pack_version_id);
create index if not exists citations_token_id_fk_idx on capture.citations (token_id);
create index if not exists conformite_motif_id_fk_idx on capture.conformite (motif_id);
create index if not exists conformite_pack_version_id_fk_idx on capture.conformite (pack_version_id);
create index if not exists paiement_justificatifs_paiement_id_fk_idx on capture.paiement_justificatifs (paiement_id);
create index if not exists paiement_justificatifs_piece_id_fk_idx on capture.paiement_justificatifs (piece_id);
create index if not exists paiements_annulation_motif_id_fk_idx on capture.paiements (annulation_motif_id);
create index if not exists paiements_annule_paiement_id_fk_idx on capture.paiements (annule_paiement_id);
create index if not exists paiements_entity_id_fk_idx on capture.paiements (entity_id);
create index if not exists paiements_justificatif_piece_id_fk_idx on capture.paiements (justificatif_piece_id);
create index if not exists paiements_pack_version_id_fk_idx on capture.paiements (pack_version_id);
create index if not exists paiements_piece_id_fk_idx on capture.paiements (piece_id);
create index if not exists piece_articles_entity_id_fk_idx on capture.piece_articles (entity_id);
create index if not exists piece_articles_pack_version_id_fk_idx on capture.piece_articles (pack_version_id);
create index if not exists pieces_document_kind_fk_idx on capture.pieces (document_kind);
create index if not exists pieces_doublon_de_fk_idx on capture.pieces (doublon_de);
create index if not exists pieces_entity_id_fk_idx on capture.pieces (entity_id);
create index if not exists pieces_source_piece_id_fk_idx on capture.pieces (source_piece_id);
create index if not exists charge_questions_pack_version_id_fk_idx on collab.charge_questions (pack_version_id);
create index if not exists demandes_sur_piece_piece_id_fk_idx on collab.demandes_sur_piece (piece_id);
create index if not exists encaissements_honoraires_facture_id_fk_idx on collab.encaissements_honoraires (facture_id);
create index if not exists exports_client_tenant_id_fk_idx on collab.exports (client_tenant_id);
create index if not exists exports_pack_version_id_fk_idx on collab.exports (pack_version_id);
create index if not exists factures_honoraires_avoir_de_fk_idx on collab.factures_honoraires (avoir_de);
create index if not exists factures_honoraires_client_tenant_id_fk_idx on collab.factures_honoraires (client_tenant_id);
create index if not exists factures_honoraires_mandat_id_fk_idx on collab.factures_honoraires (mandat_id);
create index if not exists factures_honoraires_pack_version_id_fk_idx on collab.factures_honoraires (pack_version_id);
create index if not exists mandats_honoraires_client_tenant_id_fk_idx on collab.mandats_honoraires (client_tenant_id);
create index if not exists pv_reunions_client_tenant_id_fk_idx on collab.pv_reunions (client_tenant_id);
create index if not exists entries_invoice_id_fk_idx on commissions.entries (invoice_id);
create index if not exists entries_rule_id_fk_idx on commissions.entries (rule_id);
create index if not exists derives_piece_id_fk_idx on fabrique.derives (piece_id);
create index if not exists derives_tenant_id_recette_version_id_fk_idx on fabrique.derives (tenant_id, recette_version_id);
create index if not exists evaluation_exemples_tenant_id_exemple_id_usage_fk_idx on fabrique.evaluation_exemples (tenant_id, exemple_id, usage);
create index if not exists evaluations_tenant_id_recette_version_id_fk_idx on fabrique.evaluations (tenant_id, recette_version_id);
create index if not exists executions_piece_id_fk_idx on fabrique.executions (piece_id);
create index if not exists executions_tenant_id_recette_version_id_fk_idx on fabrique.executions (tenant_id, recette_version_id);
create index if not exists exemples_piece_id_fk_idx on fabrique.exemples (piece_id);
create index if not exists promotions_tenant_id_evaluation_id_fk_idx on fabrique.promotions (tenant_id, evaluation_id);
create index if not exists promotions_tenant_id_recette_version_id_fk_idx on fabrique.promotions (tenant_id, recette_version_id);
create index if not exists recette_version_exemples_tenant_id_exemple_id_nourrit_une_recet on fabrique.recette_version_exemples (tenant_id, exemple_id, nourrit_une_recette, usage);
create index if not exists travail_faits_tenant_id_travail_id_fk_idx on fabrique.travail_faits (tenant_id, travail_id);
create index if not exists acces_canal_fk_idx on facturation.acces (canal);
create index if not exists acces_motif_fin_fk_idx on facturation.acces (motif_fin);
create index if not exists acces_offre_code_fk_idx on facturation.acces (offre_code);
create index if not exists emetteurs_organisation_id_fk_idx on facturation.emetteurs (organisation_id);
create index if not exists encaissements_annule_id_fk_idx on facturation.encaissements (annule_id);
create index if not exists factures_avoir_de_fk_idx on facturation.factures (avoir_de);
create index if not exists factures_payeur_type_fk_idx on facturation.factures (payeur_type);
create index if not exists forfait_historique_canal_fk_idx on facturation.forfait_historique (canal);
create index if not exists forfait_historique_motif_fk_idx on facturation.forfait_historique (motif);
create index if not exists forfait_historique_offre_code_fk_idx on facturation.forfait_historique (offre_code);
create index if not exists forfait_historique_remplace_fk_idx on facturation.forfait_historique (remplace);
create index if not exists licences_offre_code_fk_idx on facturation.licences (offre_code);
create index if not exists licences_origine_cabinet_fk_idx on facturation.licences (origine_cabinet);
create index if not exists licences_origine_fk_idx on facturation.licences (origine);
create index if not exists transmissions_licence_id_fk_idx on facturation.transmissions (licence_id);
create index if not exists fiches_fiscales_piece_id_fk_idx on identity.fiches_fiscales (piece_id);
create index if not exists assets_category_id_fk_idx on immo.assets (category_id);
create index if not exists assets_entity_id_fk_idx on immo.assets (entity_id);
create index if not exists assets_pack_version_id_fk_idx on immo.assets (pack_version_id);
create index if not exists assets_piece_id_fk_idx on immo.assets (piece_id);
create index if not exists cessions_ecriture_id_fk_idx on immo.cessions (ecriture_id);
create index if not exists depreciations_asset_id_fk_idx on immo.depreciations (asset_id);
create index if not exists depreciations_ecriture_id_fk_idx on immo.depreciations (ecriture_id);
create index if not exists depreciations_motif_id_fk_idx on immo.depreciations (motif_id);
create index if not exists dotations_ecriture_id_fk_idx on immo.dotations (ecriture_id);
create index if not exists dotations_pack_version_id_fk_idx on immo.dotations (pack_version_id);
create index if not exists chunks_pricing_id_fk_idx on legal.chunks (pricing_id);
create index if not exists envois_gabarit_id_fk_idx on notif.envois (gabarit_id);
create index if not exists role_bindings_role_code_fk_idx on parametrage.role_bindings (role_code);
create index if not exists payments_invoice_id_fk_idx on payments.payments (invoice_id);
create index if not exists reclamations_tenant_id_fk_idx on plateforme.reclamations (tenant_id);
create index if not exists prices_product_id_fk_idx on pricing.prices (product_id);
create index if not exists account_mappings_journal_code_fk_idx on ref.account_mappings (journal_code);
create index if not exists entry_template_lines_role_code_fk_idx on ref.entry_template_lines (role_code);
create index if not exists entry_templates_journal_code_fk_idx on ref.entry_templates (journal_code);
create index if not exists offres_par_canal_offre_code_fk_idx on ref.offres_par_canal (offre_code);
create index if not exists payment_means_journal_code_fk_idx on ref.payment_means (journal_code);
create index if not exists role_bindings_role_code_fk_idx on ref.role_bindings (role_code);
create index if not exists echeances_entity_id_fk_idx on schedule.echeances (entity_id);
create index if not exists echeances_pack_version_id_fk_idx on schedule.echeances (pack_version_id);
create index if not exists ecritures_entity_id_fk_idx on socle.ecritures (entity_id);
create index if not exists ecritures_pack_version_id_fk_idx on socle.ecritures (pack_version_id);
create index if not exists ecritures_reversal_reason_id_fk_idx on socle.ecritures (reversal_reason_id);
create index if not exists ecritures_review_motif_id_fk_idx on socle.ecritures (review_motif_id);
create index if not exists depreciations_ecriture_id_fk_idx on stocks.depreciations (ecriture_id);
create index if not exists depreciations_pack_version_id_fk_idx on stocks.depreciations (pack_version_id);
create index if not exists inventaires_ecriture_id_fk_idx on stocks.inventaires (ecriture_id);
create index if not exists inventaires_item_id_fk_idx on stocks.inventaires (item_id);
create index if not exists inventaires_pack_version_id_fk_idx on stocks.inventaires (pack_version_id);
create index if not exists items_category_id_fk_idx on stocks.items (category_id);
create index if not exists items_entity_id_fk_idx on stocks.items (entity_id);
create index if not exists items_pack_version_id_fk_idx on stocks.items (pack_version_id);
create index if not exists mouvements_ecriture_id_fk_idx on stocks.mouvements (ecriture_id);
create index if not exists mouvements_piece_id_fk_idx on stocks.mouvements (piece_id);
create index if not exists auxiliaires_entity_id_fk_idx on tiers.auxiliaires (entity_id);

-- 2. Les index en double.
drop index if exists collab.reglages_cabinet_tenant_idx;
drop index if exists parametrage.parametrage_accounts_tenant_idx;
drop index if exists parametrage.parametrage_fabrique_seuils_tenant_idx;
drop index if exists tiers.tiers_auxiliaires_tenant_idx;

-- 3. L'ancienne surcharge.
drop function if exists public.capture_piece_register(uuid, text, text, text, uuid, app.vis_t, text, smallint);

-- 4. Les deux tables de référence suivent la règle commune.
alter table ref.account_classes enable row level security;
drop policy if exists ref_account_classes_sel on ref.account_classes;
create policy ref_account_classes_sel on ref.account_classes for select to authenticated using (true);
alter table ref.recharges enable row level security;
drop policy if exists ref_recharges_sel on ref.recharges;
create policy ref_recharges_sel on ref.recharges for select to authenticated using (true);

commit;
