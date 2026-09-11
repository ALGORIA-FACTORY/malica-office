-- Remise à zéro du métier de la base locale — un geste d'administration, assumé.
--
--   psql "<URL d'administration>" -v ON_ERROR_STOP=1 \
--        -v sauvegarde=<fichier .dump pris juste avant> -v mode=essai \
--        -f db/maintenance/purge_metier.sql
--
--   mode=essai   tout s'exécute, puis ROLLBACK : rien ne change.
--   mode=reel    tout s'exécute, puis COMMIT.
--
-- ==================================================================== POURQUOI
--
-- On repart de zéro sur le MÉTIER (tenants, comptes, pièces, écritures…) pour
-- éprouver les parcours d'onboarding et de scan sur une base propre. Le corpus
-- juridique (`legal`) et le référentiel (`ref`, les tarifs des modèles, le seau
-- de stockage, l'historique des migrations, le journal de plateforme) ne sont
-- PAS touchés. Inventaire et classement : docs/audit-avant-remise-a-zero.md.
--
-- `TRUNCATE` contourne les gardes R7 par construction : elles refusent le
-- DELETE ligne à ligne, pas le TRUNCATE. C'est voulu. Les gardes empêchent
-- l'application d'effacer une écriture comptabilisée ; elles n'empêchent pas
-- une remise à zéro d'administration décidée explicitement, sur une base de
-- développement. D'où les verrous, tous bloquants :
--
--   1. la base s'appelle `malica_local`, sinon RAISE EXCEPTION ;
--   2. aucun CASCADE : chaque table est nommée ci-dessous ; si une table hors
--      de la liste en référence une de la liste, on s'arrête — on n'ajoute pas
--      CASCADE ;
--   3. la fermeture des cascades de la liste ne contient aucune table de
--      `legal` ni `agents.model_pricing` (cible de `legal.chunks.pricing_id`) ;
--   4. toute table ni préservée ni nommée arrête tout : on ne laisse pas de
--      métier derrière soi sans le savoir ;
--   5. les cinq compteurs du corpus sont relevés avant et après, et doivent
--      valoir ceux de l'audit ; une ligne d'écart, et tout est annulé.
--
-- Le récit de la remise à zéro s'écrit en dernier, DANS la transaction, dans
-- `audit.journal_plateforme` : tout ou rien. `audit.event_log` est vidée avec
-- le reste — elle redémarre au premier acte d'un tenant.
--
-- Après : `app.platform_operators` est vide. Rejouer
-- `node outils/operateur-plateforme.mjs <email>` à l'étape 3, une fois le compte
-- recréé par l'onboarding. Les fichiers des pièces se déplacent à part
-- (`.stockage` → `.stockage.avant-remise-a-zero-AAAAMMJJ`).

\set ON_ERROR_STOP on
\set QUIET on
\pset footer off

-- --------------------------------------------------------------- les paramètres

\if :{?sauvegarde}
\else
do $$ begin raise exception 'Refus : -v sauvegarde=<fichier de sauvegarde pris juste avant> est obligatoire.'; end $$;
\endif
\if :{?mode}
\else
do $$ begin raise exception 'Refus : -v mode=essai ou -v mode=reel est obligatoire.'; end $$;
\endif
\getenv utilisateur_poste USERNAME
\if :{?utilisateur_poste}
\else
\getenv utilisateur_poste USER
\endif
\if :{?utilisateur_poste}
\else
do $$ begin raise exception 'Refus : impossible de lire l''utilisateur du poste (USERNAME ou USER).'; end $$;
\endif

begin;
set local lock_timeout = '5s';
select set_config('purge.sauvegarde', :'sauvegarde', true),
       set_config('purge.mode', :'mode', true),
       set_config('purge.utilisateur_poste', :'utilisateur_poste', true) \gset

-- ------------------------------------------------------------------ verrou 1

do $$
begin
  if current_database() <> 'malica_local' then
    raise exception 'Refus : cette purge ne s''exécute que sur malica_local (base actuelle : %).',
      current_database();
  end if;
  if current_setting('purge.mode') not in ('essai', 'reel') then
    raise exception 'Refus : mode % inconnu (essai ou reel).', current_setting('purge.mode');
  end if;
end $$;

-- ------------------------------------------------------- le corpus, avant

create temp table purge_corpus (
  moment text primary key, articles bigint, versions bigint, fragments bigint,
  sondages bigint, cas bigint
) on commit drop;

insert into purge_corpus
select 'avant', (select count(*) from legal.articles), (select count(*) from legal.article_versions),
       (select count(*) from legal.chunks), (select count(*) from legal.sondages),
       (select count(*) from legal.banque_cas);

-- ------------------------------------------------------ ce qui est préservé

create temp table purge_preservees (nom text primary key) on commit drop;
insert into purge_preservees values
  ('agents.model_pricing'),      -- tarifs des modèles (R8), cible de legal.chunks.pricing_id
  ('storage.buckets'),           -- configuration du stockage
  ('app.migrations'),            -- historique des migrations : on ajoute, on ne réécrit pas
  ('audit.journal_plateforme');  -- le journal où cette purge s'inscrit
-- Et, par schéma entier : legal (le corpus) et ref (le référentiel).

-- ----------------------------------------------------- les 72 tables à vider

create temp table purge_tables (nom text primary key) on commit drop;
insert into purge_tables values
  ('agents.agent_runs'), ('agents.arbitrages'), ('agents.budgets'),
  ('agents.conversation_messages'), ('agents.conversations'), ('agents.reponse_controles'),
  ('agents.reponse_verdicts'),
  ('app.platform_operators'), ('app.signalements'),
  ('audit.event_log'),
  ('auth.refresh_tokens'), ('auth.users'),
  ('banque.comptes'), ('banque.lettrage_etat'), ('banque.lettrages'), ('banque.rapprochements'),
  ('banque.releve_lignes'),
  ('billing.invoice_lines'), ('billing.invoice_sequences'), ('billing.invoices'),
  ('capture.citations'), ('capture.conformite'), ('capture.extractions'),
  ('capture.piece_articles'), ('capture.piece_versions'), ('capture.pieces'),
  ('capture.precisions'), ('capture.token_plan'),
  ('catalog.products'),
  ('coffre.objects'),
  ('collab.assignments'), ('collab.charge_questions'), ('collab.encaissements_honoraires'),
  ('collab.exports'), ('collab.factures_honoraires'), ('collab.factures_honoraires_lignes'),
  ('collab.mandats_honoraires'), ('collab.notifications'), ('collab.obligations_cabinet'),
  ('collab.obligations_propres'), ('collab.push_devices'), ('collab.pv_reunions'),
  ('collab.reglages_cabinet'),
  ('commissions.entries'), ('commissions.rules'),
  ('contracts.contracts'),
  ('identity.api_keys'), ('identity.engagements'), ('identity.entities'),
  ('identity.fiches_fiscales'), ('identity.invitations'), ('identity.memberships'),
  ('identity.organizations'), ('identity.profiles'),
  ('immo.assets'), ('immo.cessions'), ('immo.depreciations'), ('immo.dotations'),
  ('parametrage.accounts'), ('parametrage.role_bindings'),
  ('payments.payments'),
  ('pricing.price_lists'), ('pricing.prices'),
  ('schedule.echeances'),
  ('socle.ecriture_lignes'), ('socle.ecritures'),
  ('stocks.depreciations'), ('stocks.inventaires'), ('stocks.items'), ('stocks.mouvements'),
  ('storage.objects'),
  ('tiers.auxiliaires');

-- ------------------------------------------------------ verrous 2, 3 et 4

do $$
declare
  nombre       integer;
  hors_liste   text;
  interdites   text;
  oubliees     text;
begin
  select count(*) into nombre from purge_tables;
  if nombre <> 72 then
    raise exception 'Refus : % tables nommées, 72 attendues (docs/audit-avant-remise-a-zero.md).', nombre;
  end if;

  -- La fermeture : toutes les tables qu'un TRUNCATE … CASCADE de la liste atteindrait.
  with recursive fermeture(oid) as (
    select nom::regclass::oid from purge_tables
    union
    select con.conrelid
      from pg_constraint con join fermeture f on con.confrelid = f.oid
     where con.contype = 'f'
  ), nommees as (
    select n.nspname || '.' || c.relname as nom
      from fermeture f join pg_class c on c.oid = f.oid join pg_namespace n on n.oid = c.relnamespace
  )
  select string_agg(nom, ', ' order by nom) filter (where nom like 'legal.%' or nom = 'agents.model_pricing'),
         string_agg(nom, ', ' order by nom) filter (where nom not in (select nom from purge_tables))
    into interdites, hors_liste
    from nommees;

  if interdites is not null then
    raise exception 'Refus (verrou 3) : la fermeture des cascades atteint %.', interdites;
  end if;
  if hors_liste is not null then
    raise exception 'Refus (verrou 2) : un TRUNCATE sans CASCADE échouerait — % référence(nt) la liste sans en faire partie. On s''arrête et on le signale.', hors_liste;
  end if;

  -- Toute table de données qui n'est ni préservée ni nommée.
  select string_agg(n.nspname || '.' || c.relname, ', ' order by 1)
    into oubliees
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where c.relkind in ('r', 'p')
     and n.nspname not like 'pg\_%' and n.nspname <> 'information_schema'
     and n.nspname not in ('legal', 'ref')
     and (n.nspname || '.' || c.relname) not in (select nom from purge_preservees)
     and (n.nspname || '.' || c.relname) not in (select nom from purge_tables);
  if oubliees is not null then
    raise exception 'Refus (verrou 4) : table(s) ni préservée(s) ni nommée(s) : %.', oubliees;
  end if;
end $$;

-- ---------------------------------------------- ce qui va partir, compté

create temp table purge_lignes (nom text primary key, lignes bigint not null) on commit drop;

do $$
declare
  t record;
  n bigint;
begin
  for t in select nom from purge_tables order by nom loop
    execute format('select count(*) from %s', t.nom::regclass) into n;
    insert into purge_lignes values (t.nom, n);
  end loop;
end $$;

-- ------------------------------------------------------------- le TRUNCATE

-- Une seule instruction, construite depuis la liste nommée : sans CASCADE,
-- PostgreSQL refuse si une référence sort de la liste (c'est le verrou 2 à
-- nouveau, par le moteur lui-même).
do $$
declare
  instruction text;
begin
  select 'truncate table ' || string_agg(nom::regclass::text, ', ' order by nom)
    into instruction from purge_tables;
  perform set_config('purge.instruction', instruction, true);
  execute instruction;
end $$;

do $$
declare
  restantes text;
  t record;
  n bigint;
begin
  for t in select nom from purge_tables loop
    execute format('select count(*) from %s', t.nom::regclass) into n;
    if n <> 0 then
      restantes := concat_ws(', ', restantes, t.nom || ' (' || n || ')');
    end if;
  end loop;
  if restantes is not null then
    raise exception 'Le TRUNCATE a laissé des lignes : %. Tout est annulé.', restantes;
  end if;
end $$;

-- ------------------------------------------------- le corpus, après — verrou 5

insert into purge_corpus
select 'apres', (select count(*) from legal.articles), (select count(*) from legal.article_versions),
       (select count(*) from legal.chunks), (select count(*) from legal.sondages),
       (select count(*) from legal.banque_cas);

do $$
declare
  a purge_corpus;
  p purge_corpus;
begin
  select * into a from purge_corpus where moment = 'avant';
  select * into p from purge_corpus where moment = 'apres';
  -- Les chiffres de l'audit du 11 septembre 2026 : si le corpus n'est plus
  -- celui qu'on a audité, on ne purge pas à l'aveugle.
  if (a.articles, a.versions, a.fragments, a.sondages, a.cas)
     is distinct from (11440::bigint, 16183::bigint, 31863::bigint, 12101::bigint, 667::bigint) then
    raise exception 'Le corpus n''est pas celui de l''audit : % articles, % versions, % fragments, % sondages, % cas. Tout est annulé.',
      a.articles, a.versions, a.fragments, a.sondages, a.cas;
  end if;
  if (a.articles, a.versions, a.fragments, a.sondages, a.cas)
     is distinct from (p.articles, p.versions, p.fragments, p.sondages, p.cas) then
    raise exception 'Le corpus a changé pendant la purge : avant (%, %, %, %, %), après (%, %, %, %, %). Tout est annulé.',
      a.articles, a.versions, a.fragments, a.sondages, a.cas,
      p.articles, p.versions, p.fragments, p.sondages, p.cas;
  end if;
end $$;

-- ---------------------------------------------- le récit, dans la transaction

insert into audit.journal_plateforme (acte, utilisateur_poste, detail)
select 'plateforme.remise_a_zero_metier',
       current_setting('purge.utilisateur_poste'),
       jsonb_build_object(
         'base', current_database(),
         'mode', current_setting('purge.mode'),
         'sauvegarde', current_setting('purge.sauvegarde'),
         'script', 'db/maintenance/purge_metier.sql',
         'instruction', current_setting('purge.instruction'),
         'tables', (select jsonb_object_agg(nom, lignes) from purge_lignes),
         'tables_videes', (select count(*) from purge_lignes),
         'lignes_supprimees', (select sum(lignes) from purge_lignes),
         'corpus_avant', (select to_jsonb(c) - 'moment' from purge_corpus c where moment = 'avant'),
         'corpus_apres', (select to_jsonb(c) - 'moment' from purge_corpus c where moment = 'apres'));

-- ------------------------------------------------------------------ le bilan

\unset QUIET
\echo
\echo '=== Lignes vidées, table par table (tables non vides) ==='
select nom as table, lignes from purge_lignes where lignes > 0 order by lignes desc, nom;
\echo '=== Total ==='
select count(*) as tables_videes, sum(lignes) as lignes_supprimees from purge_lignes;
\echo '=== Le corpus, avant et après ==='
select moment, articles, versions, fragments, sondages, cas from purge_corpus order by moment desc;
\echo '=== Le récit inscrit dans audit.journal_plateforme ==='
select horodatage, acte, role_base, utilisateur_poste,
       detail ->> 'sauvegarde' as sauvegarde, detail ->> 'lignes_supprimees' as lignes
  from audit.journal_plateforme order by horodatage desc limit 1;

select (current_setting('purge.mode') = 'reel') as reel \gset
\if :reel
commit;
\echo 'MODE RÉEL — COMMIT : le métier est vidé, le corpus et le référentiel sont intacts.'
\else
rollback;
\echo 'MODE ESSAI — ROLLBACK : tout s''est exécuté, rien n''a changé.'
\endif
