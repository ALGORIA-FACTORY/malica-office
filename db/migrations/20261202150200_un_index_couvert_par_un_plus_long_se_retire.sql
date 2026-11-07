-- Un index que couvre un index plus long de la même table se retire.
--
-- ================================================================== POURQUOI
--
-- Audit du 6 novembre 2026 (docs/audit-2026-11-06/base.md, § 3.5, M4) : huit
-- index btree non uniques sont le préfixe strict d'un autre index de leur
-- table ; un neuvième est apparu depuis (`app.signalements_user_idx`, que
-- 20261202120000 a couvert en posant `signalements_user_origine_idx`). Chacun
-- coûte une écriture à chaque ligne et ne sert aucune lecture que le plus long
-- ne serve.
--
-- Preuve par le catalogue (requête de apps/api/src/schema.test.ts, « aucun
-- index n'est le préfixe strict d'un autre index de la même table »), sur une
-- base montée jusqu'à 20261202130000. Pour chaque paire : le court est btree,
-- non unique, sans prédicat ni expression, ne porte aucune contrainte
-- (`pg_constraint.conindid`) ; le long est btree, valide, sans prédicat ni
-- expression ; leurs premières colonnes sont les mêmes, dans le même ordre,
-- avec la même classe d'opérateurs, la même collation et le même sens. Un
-- index unique sert toute lecture par son préfixe comme un index simple.
--
--   retiré                                   couvert par
--   app.signalements_user_idx (user_id)      app.signalements_user_origine_idx (user_id, origine, cree_le desc)
--   collab.obligations_cabinet_tenant_idx    collab.obligations_cabinet_pkey
--     (tenant_id)                              (tenant_id, obligation_code, exercice, secteur) — clé primaire
--   collab.pv_reunions_client_tenant_id_fk_idx
--     (client_tenant_id)                     collab.pv_client_publication_idx (client_tenant_id, envoye_le desc)
--   identity.entities_tenant_idx (tenant_id) identity.entities_tenant_id_code_key (tenant_id, code) — unique
--   legal.chunks_version_idx                 legal.chunks_version_ordinal_key (article_version_id, ordinal) — unique
--     (article_version_id)
--   ref.account_classes_pack_idx             ref.account_classes_pack_version_id_prefix_valid_from_key
--     (pack_version_id, prefix)                (pack_version_id, prefix, valid_from) — unique
--   ref.concepts_pack_idx                    ref.concepts_pack_version_id_code_valid_from_key
--     (pack_version_id, code)                  (pack_version_id, code, valid_from) — unique
--   ref.formes_juridiques_pack_idx           ref.formes_juridiques_pack_version_id_code_valid_from_key
--     (pack_version_id, code)                  (pack_version_id, code, valid_from) — unique
--   socle.lignes_ecriture_idx (ecriture_id)  socle.ecriture_lignes_ecriture_id_ordinal_key (ecriture_id, ordinal) — unique
--
-- Ce qui ne bouge pas : la règle R6 (index menant par tenant_id) reste tenue —
-- les deux couvrants de `obligations_cabinet` et `entities` mènent par
-- tenant_id ; les clés étrangères `app.signalements.user_id`,
-- `collab.pv_reunions.client_tenant_id`, `legal.chunks.article_version_id` et
-- `socle.ecriture_lignes.ecriture_id` restent servies par l'index long, qui
-- mène par la même colonne. Aucun nom de ces index n'est cité par le code (git
-- grep : seules leurs migrations, et un commentaire de db/verification/mesure.sql
-- mis à jour dans le même commit).
--
-- Le garde ci-dessous refuse de retirer un index si son couvrant manque ou est
-- invalide sur la base qui joue ce fichier : une base qui aurait divergé du
-- dépôt ne perd pas son seul index.
--
-- `drop index` sans option : le verrou ne dure que le temps de retirer
-- l'entrée du catalogue, et le fichier reste atomique dans la transaction de
-- db/migrer.mjs.

do $$
declare
  v_paire text[];
begin
  foreach v_paire slice 1 in array array[
    ['app.signalements_user_idx', 'app.signalements_user_origine_idx'],
    ['collab.obligations_cabinet_tenant_idx', 'collab.obligations_cabinet_pkey'],
    ['collab.pv_reunions_client_tenant_id_fk_idx', 'collab.pv_client_publication_idx'],
    ['identity.entities_tenant_idx', 'identity.entities_tenant_id_code_key'],
    ['legal.chunks_version_idx', 'legal.chunks_version_ordinal_key'],
    ['ref.account_classes_pack_idx', 'ref.account_classes_pack_version_id_prefix_valid_from_key'],
    ['ref.concepts_pack_idx', 'ref.concepts_pack_version_id_code_valid_from_key'],
    ['ref.formes_juridiques_pack_idx', 'ref.formes_juridiques_pack_version_id_code_valid_from_key'],
    ['socle.lignes_ecriture_idx', 'socle.ecriture_lignes_ecriture_id_ordinal_key']
  ] loop
    if not exists (select 1 from pg_index i
                    where i.indexrelid = to_regclass(v_paire[2]) and i.indisvalid) then
      raise exception 'index couvrant absent ou invalide : % (pour retirer %)', v_paire[2], v_paire[1];
    end if;
  end loop;
end $$;

drop index if exists app.signalements_user_idx;
drop index if exists collab.obligations_cabinet_tenant_idx;
drop index if exists collab.pv_reunions_client_tenant_id_fk_idx;
drop index if exists identity.entities_tenant_idx;
drop index if exists legal.chunks_version_idx;
drop index if exists ref.account_classes_pack_idx;
drop index if exists ref.concepts_pack_idx;
drop index if exists ref.formes_juridiques_pack_idx;
drop index if exists socle.lignes_ecriture_idx;

-- ================================================================== RETOUR
--
-- La migration de retour, à jouer telle quelle (sans les « -- » de tête) — les
-- définitions sont celles que rend pg_get_indexdef avant ce fichier :
--
-- create index if not exists signalements_user_idx on app.signalements (user_id);
-- create index if not exists obligations_cabinet_tenant_idx on collab.obligations_cabinet (tenant_id);
-- create index if not exists pv_reunions_client_tenant_id_fk_idx on collab.pv_reunions (client_tenant_id);
-- create index if not exists entities_tenant_idx on identity.entities (tenant_id);
-- create index if not exists chunks_version_idx on legal.chunks (article_version_id);
-- create index if not exists account_classes_pack_idx on ref.account_classes (pack_version_id, prefix);
-- create index if not exists concepts_pack_idx on ref.concepts (pack_version_id, code);
-- create index if not exists formes_juridiques_pack_idx on ref.formes_juridiques (pack_version_id, code);
-- create index if not exists lignes_ecriture_idx on socle.ecriture_lignes (ecriture_id);
-- delete from app.migrations where nom = '20261202150200_un_index_couvert_par_un_plus_long_se_retire.sql';
