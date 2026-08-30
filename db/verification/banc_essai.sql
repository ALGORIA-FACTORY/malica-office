-- Le banc d'essai : du volume, pour que la mesure veuille dire quelque chose.
--
-- Une base à 85 pièces et zéro écriture ne prouve rien sur les index. Le
-- planificateur choisit le parcours séquentiel sur une petite table, et il a
-- raison : lire 85 lignes coûte moins cher que lire un index PUIS la table.
-- Comparer deux plans dans ces conditions reviendrait à montrer deux fois la
-- même image en annonçant un progrès.
--
-- Ce script sème donc de quoi mesurer : environ 300 000 lignes réparties sur
-- toutes les organisations existantes, pour que le filtre par tenant soit
-- SÉLECTIF — c'est la sélectivité, pas le volume seul, qui décide un index.
--
-- Il s'exécute en superutilisateur, hors du chemin applicatif : c'est un banc,
-- pas un jeu de démonstration. Les lignes portent toutes la marque « BANC » et
-- `db/verification/banc_essai_purge.sql` les retire.
--
--   psql -f db/verification/banc_essai.sql

\timing on

-- Les organisations qui serviront de locataires, et le pack en vigueur.
create temporary table banc_orgs as
select id, row_number() over (order by id) as n
  from identity.organizations
 where archived_at is null or archived_at is not null;

create temporary table banc_ctx as
select (select id from ref.jurisdiction_packs where jurisdiction = 'TN'
         order by effective_from desc limit 1) as pack,
       (select id from auth.users order by created_at limit 1) as auteur;

-- ------------------------------------------------------------------ pièces
insert into capture.pieces
  (tenant_id, source, vis, storage_path, idempotency_key, created_by, content_type)
select o.id, 'pdf', 'partage',
       o.id || '/banc-' || g,
       'BANC:' || o.id || ':' || g,
       (select auteur from banc_ctx),
       'application/pdf'
  from banc_orgs o, generate_series(1, 40) g
on conflict do nothing;

-- --------------------------------------------------------------- plan de tokens
insert into capture.token_plan (tenant_id, piece_id, page, ordinal, text, x0, y0, x1, y1)
select p.tenant_id, p.id, 1, g, 'mot' || g, 0.1, 0.1, 0.2, 0.2
  from capture.pieces p, generate_series(1, 25) g
 where p.idempotency_key like 'BANC:%'
on conflict do nothing;

-- ---------------------------------------------------------------- citations
-- Chaque citation désigne un token RÉEL : la clé étrangère l'exige, et c'est
-- tout le sens du contrat — une citation orpheline n'existe pas.
insert into capture.citations (tenant_id, piece_id, field, token_id, page, bbox, zone)
select t.tenant_id, t.piece_id, 'champ_' || (t.ordinal % 12), t.id, 1,
       '{"x0":0.1,"y0":0.1,"x1":0.2,"y1":0.2}'::jsonb, 'zone_' || (t.ordinal % 4)
  from capture.token_plan t
  join capture.pieces p on p.id = t.piece_id
 where p.idempotency_key like 'BANC:%';

-- ----------------------------------------------------------------- écritures
insert into socle.ecritures
  (tenant_id, piece_id, journal, date_ecriture, libelle, pack_version_id, status, created_by)
select p.tenant_id, p.id, 'ACH', current_date - (g % 365), 'BANC écriture ' || g,
       (select pack from banc_ctx), 'proposee', (select auteur from banc_ctx)
  from capture.pieces p, generate_series(1, 2) g
 where p.idempotency_key like 'BANC:%';

-- ------------------------------------------------------------ lignes d'écriture
-- Une ligne au débit, une au crédit : la contrainte exige exactement un des deux
-- montants non nul, et l'unicité porte sur (ecriture_id, ordinal).
insert into socle.ecriture_lignes
  (tenant_id, ecriture_id, ordinal, account_code, libelle, debit, credit)
select e.tenant_id, e.id, g, case when g % 2 = 0 then '401' else '607' end,
       'ligne ' || g,
       case when g % 2 = 0 then 0 else 100.000 end,
       case when g % 2 = 0 then 100.000 else 0 end
  from socle.ecritures e, generate_series(1, 4) g
 where e.libelle like 'BANC %'
on conflict do nothing;

analyze capture.pieces;
analyze capture.citations;
analyze capture.token_plan;
analyze socle.ecritures;
analyze socle.ecriture_lignes;

\echo '===== VOLUMES DU BANC ====='
select 'capture.pieces' as tbl, count(*) from capture.pieces
union all select 'capture.citations', count(*) from capture.citations
union all select 'capture.token_plan', count(*) from capture.token_plan
union all select 'socle.ecritures', count(*) from socle.ecritures
union all select 'socle.ecriture_lignes', count(*) from socle.ecriture_lignes;
