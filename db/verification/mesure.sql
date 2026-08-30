-- Trois lectures chaudes, mesurées sous l'identité d'un vrai locataire.
--
-- Le point important : ces plans sont pris SOUS RLS, avec `set role authenticated`
-- et le claim posé comme le fait l'API. Mesurer en superutilisateur donnerait des
-- plans sans la clause de tenant — c'est-à-dire pas les plans que la production
-- exécute.
--
-- Chaque requête est lancée deux fois : le premier passage remplit le cache, le
-- second est celui qu'on lit. Comparer un plan à froid avec un plan à chaud
-- attribuerait aux index un gain qui vient du cache.
--
--   psql -f db/verification/mesure.sql

\pset pager off

-- Le locataire le mieux fourni du banc, ET qui a un membre : sans membre, la RLS
-- ne rendrait rien et la mesure porterait sur zéro ligne.
select m.tenant_id as tenant, m.user_id as membre
  from identity.memberships m
 where exists (select 1 from capture.citations c where c.tenant_id = m.tenant_id)
 order by (select count(*) from capture.citations c where c.tenant_id = m.tenant_id) desc
 limit 1 \gset

select id as piece from capture.pieces where tenant_id = :'tenant' limit 1 \gset
select id as ecriture from socle.ecritures where tenant_id = :'tenant' limit 1 \gset

\echo '=== locataire :' :tenant
\echo '=== pièce     :' :piece

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'membre', true);

\echo ''
\echo '=========== 1. LES CITATIONS D UNE PIÈCE (capture.citations) ==========='
explain (analyze, buffers, costs off, timing off)
select field, page, bbox, zone from capture.citations where piece_id = :'piece';
explain (analyze, buffers, costs off, timing off)
select field, page, bbox, zone from capture.citations where piece_id = :'piece';

\echo ''
\echo '=========== 2. LE PLAN DE TOKENS D UNE PIÈCE (capture.token_plan) ==========='
explain (analyze, buffers, costs off, timing off)
select page, ordinal, text, x0, y0, x1, y1 from capture.token_plan
 where piece_id = :'piece' order by ordinal;
explain (analyze, buffers, costs off, timing off)
select page, ordinal, text, x0, y0, x1, y1 from capture.token_plan
 where piece_id = :'piece' order by ordinal;

\echo ''
\echo '=========== 3. LES LIGNES D UNE ÉCRITURE (socle.ecriture_lignes) ==========='
explain (analyze, buffers, costs off, timing off)
select ecriture_id, ordinal, account_code, libelle, debit, credit, tax_code
  from socle.ecriture_lignes where ecriture_id = any(array[:'ecriture']::uuid[]) order by ordinal;
explain (analyze, buffers, costs off, timing off)
select ecriture_id, ordinal, account_code, libelle, debit, credit, tax_code
  from socle.ecriture_lignes where ecriture_id = any(array[:'ecriture']::uuid[]) order by ordinal;

\echo ''
\echo '=========== 4. TOUTES LES LIGNES DU LOCATAIRE (seul filtre : la RLS) ==========='
-- La lecture précédente est déjà servie par `lignes_ecriture_idx`. Celle-ci est
-- celle que l'index menant par tenant_id doit changer : elle n'a AUCUN autre
-- filtre que celui posé par la politique.
explain (analyze, buffers, costs off, timing off)
select count(*) from socle.ecriture_lignes;
explain (analyze, buffers, costs off, timing off)
select count(*) from socle.ecriture_lignes;

\echo ''
\echo '=========== 5. TOUTES LES CITATIONS DU LOCATAIRE (seul filtre : la RLS) ==========='
explain (analyze, buffers, costs off, timing off)
select count(*) from capture.citations;
explain (analyze, buffers, costs off, timing off)
select count(*) from capture.citations;

rollback;
