-- L'effacement d'une pièce trouve ses rattachements par index, pas en lisant la table entière.
--
-- ================================================================== POURQUOI
--
-- Audit du 6 novembre 2026 (docs/audit-2026-11-06/base.md, § 3.5, M5) :
-- `capture.rattachements` porte deux clés étrangères `on delete cascade` vers
-- `capture.pieces` — `piece_id` et `piece_liee_id`. Les seuls index qui les
-- nomment mènent par `tenant_id` (`rattachements_tenant_piece_idx`,
-- `rattachements_tenant_liee_idx`) ; la cascade cherche par `piece_id = $1`
-- seul, sans tenant : chaque pièce supprimée parcourt `capture.rattachements`
-- en entier, deux fois, sous le verrou de la suppression.
--
-- Deux index simples, un par colonne. `create index` sans option : la table est
-- petite (un rattachement par paire de pièces liées) et le fichier reste
-- atomique dans la transaction de db/migrer.mjs.
--
-- _Gardé par_ apps/api/src/la-base-tient-son-integrite.test.ts, « chaque clé
-- étrangère qui efface en cascade a un index menant par ses colonnes » (les six
-- cascades qui restent sont nommées, avec leur raison, dans
-- apps/api/src/verrous/integrite-de-la-base.json).

create index if not exists rattachements_piece_idx on capture.rattachements (piece_id);
create index if not exists rattachements_piece_liee_idx on capture.rattachements (piece_liee_id);

-- ================================================================== RETOUR
--
-- La migration de retour, à jouer telle quelle (sans les « -- » de tête) :
--
-- drop index if exists capture.rattachements_piece_idx;
-- drop index if exists capture.rattachements_piece_liee_idx;
-- delete from app.migrations where nom = '20261202150100_l_effacement_d_une_piece_trouve_ses_rattachements_par_index.sql';
