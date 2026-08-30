-- Les dix-sept index qui manquaient devant la RLS.
--
-- Chaque politique de lecture commence par `tenant_id in (select ...)`. Sans
-- index menant par `tenant_id`, la base parcourt la table entière et jette
-- ensuite ce qui n'appartient pas à l'appelant. Mesuré ici sur 97 000
-- citations : 1 000 lignes rendues, 96 000 écartées, à chaque lecture.
--
-- Aujourd'hui invisible. À dix cabinets, c'est le mur.
--
-- COMPOSITE, JAMAIS `tenant_id` SEUL. Un index sur la seule colonne de tenant
-- ramène toutes les lignes du locataire puis laisse la base trier et filtrer.
-- La seconde colonne vient de la requête réelle — je suis allé lire le dépôt
-- qui interroge chaque table plutôt que de deviner :
--
--   capture.citations        `where piece_id = $1`
--   capture.token_plan       `where piece_id = $1 order by ordinal`
--   capture.extractions      `where piece_id = $1 order by created_at desc`
--   socle.ecriture_lignes    `where ecriture_id = any($1) order by ordinal`
--   immo.cessions            `where tenant_id = $1 order by at desc`
--   immo.depreciations       `where tenant_id = $1 [and asset_id] order by at`
--   immo.dotations           `where tenant_id = $1 [and asset_id] order by exercice`
--   stocks.depreciations     `where tenant_id = $1 [and item_id] order by at`
--
-- Pour les NEUF autres, aucun dépôt ni écran ne les interroge : ce sont des
-- modules qui n'ont pas encore de surface (facturation, encaissements, tarifs,
-- commissions, coffre, notifications poussées). Je le dis plutôt que de faire
-- passer une supposition pour une lecture. Leur seconde colonne est celle de
-- leur clé d'accès évidente — la pièce, la facture, la liste de prix — et à
-- défaut `created_at`, qui sert le « les plus récents d'abord » que toutes ces
-- surfaces auront. Le jour où l'écran existera, l'index sera à relire.
--
-- `concurrently` : ces index se construisent sans verrouiller la table en
-- écriture. C'est ce qui permet de jouer cette migration sur une base vivante.
-- En contrepartie, PostgreSQL l'interdit dans une transaction — ce fichier ne
-- doit donc PAS être passé à psql avec --single-transaction.
--
--   psql -f db/migrations/20260830150000_index_menant_tenant.sql

-- ------------------------------------------------- servis par une requête lue
create index concurrently if not exists citations_tenant_piece_idx
  on capture.citations (tenant_id, piece_id);

create index concurrently if not exists token_plan_tenant_piece_ordinal_idx
  on capture.token_plan (tenant_id, piece_id, ordinal);

create index concurrently if not exists extractions_tenant_piece_recent_idx
  on capture.extractions (tenant_id, piece_id, created_at desc);

create index concurrently if not exists ecriture_lignes_tenant_ecriture_idx
  on socle.ecriture_lignes (tenant_id, ecriture_id, ordinal);

create index concurrently if not exists immo_cessions_tenant_at_idx
  on immo.cessions (tenant_id, at desc);

create index concurrently if not exists immo_depreciations_tenant_asset_at_idx
  on immo.depreciations (tenant_id, asset_id, at);

create index concurrently if not exists immo_dotations_tenant_asset_exercice_idx
  on immo.dotations (tenant_id, asset_id, exercice);

create index concurrently if not exists stocks_depreciations_tenant_item_at_idx
  on stocks.depreciations (tenant_id, item_id, at);

-- ------------------------------------------- sans surface applicative à ce jour
create index concurrently if not exists conformite_tenant_piece_idx
  on capture.conformite (tenant_id, piece_id);

create index concurrently if not exists piece_versions_tenant_piece_recent_idx
  on capture.piece_versions (tenant_id, piece_id, created_at desc);

create index concurrently if not exists rapprochements_tenant_ligne_idx
  on banque.rapprochements (tenant_id, ligne_id);

create index concurrently if not exists invoice_lines_tenant_invoice_idx
  on billing.invoice_lines (tenant_id, invoice_id);

create index concurrently if not exists coffre_objects_tenant_recent_idx
  on coffre.objects (tenant_id, created_at desc);

create index concurrently if not exists push_devices_tenant_user_idx
  on collab.push_devices (tenant_id, user_id);

create index concurrently if not exists commissions_entries_tenant_invoice_idx
  on commissions.entries (tenant_id, invoice_id);

create index concurrently if not exists payments_tenant_invoice_idx
  on payments.payments (tenant_id, invoice_id);

create index concurrently if not exists prices_tenant_liste_idx
  on pricing.prices (tenant_id, price_list_id);
