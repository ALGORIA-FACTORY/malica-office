/**
 * Trois garde-fous sur le SCHÉMA, pas sur les fichiers.
 *
 * La différence est tout le sujet. Relire les migrations dit ce qu'on a voulu ;
 * interroger `pg_index` et `pg_policies` dit ce qui est. Entre les deux il y a
 * une migration qui a échoué au milieu, une main qui a corrigé en direct, un
 * fichier ajouté sans être joué. C'est la base qui fait foi.
 *
 * Ces vérifications sont rédigées pour ÉCHOUER de façon lisible : elles nomment
 * la table, la politique ou le compte, pour qu'un rouge se répare sans enquête.
 */

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { fermerLePool, horsRlsAuthentificationSeule } from "./db.ts";

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

/**
 * Lit le catalogue et le référentiel sous le rôle `authenticated`.
 *
 * Le rôle de connexion est `noinherit` : il n'hérite RIEN d'authenticated tant
 * qu'il ne l'endosse pas. Sans ce `set local role`, une lecture de `ref.*`
 * rend un 42501 — et un test qui échoue sur un droit refusé RESSEMBLE à un test
 * qui a trouvé le défaut qu'il cherchait. C'est exactement l'erreur que j'ai
 * faite en écrivant la première version : j ai annoncé qu il détectait le
 * compte 4367 sans lire son message d échec.
 *
 * Aucun claim n'est posé : les tables de référence ont une politique
 * `using (true)`, elles ne dépendent d aucune identité. Les vues du catalogue,
 * elles, sont lisibles par tous.
 */
async function interroger<T extends Record<string, unknown>>(
  sql: string,
  args: unknown[] = [],
): Promise<T[]> {
  return horsRlsAuthentificationSeule(async (db) => {
    await db.query("set local role authenticated");
    const { rows } = await db.query<T>(sql, args);
    return rows;
  });
}

describe("le schéma tient ses promesses", { skip: !BASE_CONFIGUREE }, () => {
  after(async () => {
    await fermerLePool();
  });

  /**
   * (a) Toute table passée sous `app.enable_tenant_rls` a un index dont la
   * PREMIÈRE colonne est `tenant_id`.
   *
   * Pourquoi la première : un index sur (piece_id, tenant_id) ne sert pas le
   * prédicat de la politique, qui ne connaît que le tenant. La position compte
   * autant que la présence.
   *
   * Les tables sont reconnues à leurs politiques, pas à une liste : une table
   * ajoutée demain sous le helper est couverte sans que ce fichier bouge.
   */
  it("chaque table sous RLS de tenant a un index menant par tenant_id", async () => {
    const manquantes = await interroger<{ table_: string }>(`
      with sous_helper as (
        select distinct schemaname as s, tablename as t
          from pg_policies
         where policyname in (schemaname || '_' || tablename || '_sel',
                              schemaname || '_' || tablename || '_ins')
           and coalesce(qual, with_check) like '%app.member_orgs()%'
      )
      select h.s || '.' || h.t as table_
        from sous_helper h
        join pg_class c on c.relname = h.t
         and c.relnamespace::regnamespace::text = h.s
       where exists (select 1 from pg_attribute a
                      where a.attrelid = c.oid and a.attname = 'tenant_id' and a.attnum > 0)
         and not exists (
           select 1 from pg_index i
            where i.indrelid = c.oid
              and (select attname from pg_attribute
                    where attrelid = c.oid and attnum = i.indkey[0]) = 'tenant_id')
       order by 1`);

    assert.deepEqual(
      manquantes.map((r) => r.table_),
      [],
      "ces tables filtrent par tenant_id à chaque lecture sans index pour le servir",
    );
  });

  /**
   * (b) Aucune politique ne contient un appel de fonction nu.
   *
   * `app.is_platform()` dans un `using` est évalué PAR LIGNE. Enveloppé en
   * `(select app.is_platform())`, il devient un InitPlan évalué une fois. Sur
   * 97 000 lignes, la différence mesurée était de 194 436 buffers à 2 438.
   *
   * PostgreSQL rend les expressions sous la forme `( SELECT app.f() AS f)` :
   * l'enveloppe se reconnaît donc à un `select` qui précède immédiatement
   * l'appel.
   */
  it("aucune politique n'appelle une fonction sans l'envelopper", async () => {
    const nus = await interroger<{ tbl: string; policyname: string; expr: string }>(`
      select schemaname || '.' || tablename as tbl, policyname,
             coalesce(qual, '') || ' | ' || coalesce(with_check, '') as expr
        from pg_policies
       where (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~* '(?<!select )app\\.\\w+\\(\\)'
       order by 1, 2`);

    assert.deepEqual(
      nus.map((r) => `${r.tbl} → ${r.policyname}`),
      [],
      "un appel nu dans une politique est réévalué à chaque ligne examinée",
    );
  });

  /**
   * (c) Un compte ne sert qu'à une chose.
   *
   * L'énoncé d'origine parlait d'« un seul libellé par pack ». Les données ne
   * disent pas cela : `ref.accounts` n'a aucun doublon de code, et ce test
   * aurait été vert dès l'écriture — donc sans valeur.
   *
   * Le défaut réel est ailleurs, et il est pire : le compte 4367 « Etat - TVA
   * collectee » est à la fois le compte de TVA des cinq codes de vente
   * (`ref.account_mappings.vat_account`) ET le compte d'imputation du droit de
   * timbre (`ref.fiscal_charges.account_code`). Les deux se mélangent dans la
   * même balance, et la déclaration de TVA sort fausse.
   *
   * C'est donc ce conflit-là que ce test interdit. Écrit avant le correctif, il
   * échoue sur 4367 — c'est la seule preuve qu'il fonctionne.
   */
  it("aucun compte n'est à la fois compte de TVA et compte de charge fiscale", async () => {
    const conflits = await interroger<{ compte: string; libelle: string; usages: string }>(`
      select a.account_code as compte,
             a.label as libelle,
             'TVA de ' || (select string_agg(distinct m.document_kind || '/' || m.tax_code, ', ')
                             from ref.account_mappings m
                            where m.vat_account = a.account_code
                              and m.pack_version_id = a.pack_version_id)
             || '  ET  charge ' || (select string_agg(distinct f.code || '/' || f.document_kind, ', ')
                             from ref.fiscal_charges f
                            where f.account_code = a.account_code
                              and f.pack_version_id = a.pack_version_id) as usages
        from ref.accounts a
       where exists (select 1 from ref.account_mappings m
                      where m.vat_account = a.account_code
                        and m.pack_version_id = a.pack_version_id)
         and exists (select 1 from ref.fiscal_charges f
                      where f.account_code = a.account_code
                        and f.pack_version_id = a.pack_version_id)
       order by 1`);

    assert.deepEqual(
      conflits.map((c) => `${c.compte} « ${c.libelle} » — ${c.usages}`),
      [],
      "un compte qui porte deux natures rend toute déclaration bâtie dessus fausse",
    );
  });

  /**
   * Aucune colonne de devise ou de juridiction ne porte de valeur par défaut.
   *
   * Un défaut de colonne est la pire forme de constante : il s'applique en
   * silence, à l'écriture, sans qu aucun appelant n'ait rien demandé. Six
   * colonnes en portaient une — un cabinet européen aurait tenu ses livres en
   * dinars sans qu'une ligne de code ne le dise.
   *
   * La devise vit désormais dans ref.jurisdiction_packs, avec le pack qui la
   * porte. Ce n'est pas la constante qui a disparu, c'est l'endroit : une
   * donnée de référence, versionnée, et non un littéral au fond du schéma.
   */
  it("aucune colonne de devise ou de juridiction n'a de valeur par défaut", async () => {
    // pg_attribute, PAS information_schema : cette dernière ne rend que les
    // colonnes sur lesquelles l'appelant a un privilège. Un garde-fou qui
    // n'inspecte que ce qu'il a le droit de voir passe au vert sur ce qu'il ne
    // voit pas — c'est un faux vert, la seule chose pire qu'un rouge.
    const defauts = await interroger<{ colonne: string; defaut: string }>(`
      select n.nspname || '.' || c.relname || '.' || a.attname as colonne,
             pg_get_expr(d.adbin, d.adrelid) as defaut
        from pg_attribute a
        join pg_class c on c.oid = a.attrelid and c.relkind = 'r'
        join pg_namespace n on n.oid = c.relnamespace
        join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
       where a.attnum > 0 and not a.attisdropped
         and n.nspname not in ('pg_catalog', 'information_schema')
         and a.attname in ('devise', 'currency', 'jurisdiction')
       order by 1`);

    assert.deepEqual(
      defauts.map((d) => `${d.colonne} = ${d.defaut}`),
      [],
      "une devise posée par défaut est une décision fiscale prise par omission",
    );
  });

  /**
   * Aucune colonne ne se fait passer pour un vecteur.
   *
   * La formulation précédente — « le schéma legal ne revient pas sans pgvector »
   * — était fausse deux fois. Elle interrogeait `information_schema.schemata`,
   * qui filtre par privilège : le schéma est revenu avec le corpus juridique et
   * le test est resté VERT, sans rien voir. Et elle visait le mauvais objet : ce
   * schéma-ci ne porte aucune empreinte vectorielle, il n'a jamais eu besoin de
   * pgvector.
   *
   * Ce qu'il fallait interdire est plus précis : la SUBSTITUTION. Le chargeur
   * réécrivait `vector(768)` en `real[]` quand l'extension manquait, et une
   * colonne d'empreintes devenue tableau de réels ressemble à s'y méprendre à
   * une colonne d'empreintes. C'est cela qu'on refuse.
   *
   * On compare le NOM du type, pas son rendu. `format_type` qualifie par le
   * schéma dès que celui-ci n'est pas sur le chemin de recherche, et il colle
   * la dimension : la vraie colonne se rend « extensions.vector(1024) », que
   * l'égalité à « vector » rejetait comme un imposteur. Le nom, lui, vaut
   * `vector` où que l'extension soit installée et quelle que soit la
   * dimension — tandis qu'un `real[]` s'appelle `_float4`.
   */
  it("aucune colonne d'empreintes n'est un tableau déguisé en vecteur", async () => {
    const deguisees = await interroger<{ colonne: string; type_: string }>(`
      select n.nspname || '.' || c.relname || '.' || a.attname as colonne,
             format_type(a.atttypid, a.atttypmod) as type_
        from pg_attribute a
        join pg_class c on c.oid = a.attrelid and c.relkind = 'r'
        join pg_namespace n on n.oid = c.relnamespace
        join pg_type t on t.oid = a.atttypid
       where a.attnum > 0 and not a.attisdropped
         and a.attname in ('embedding', 'embeddings')
         and t.typname <> 'vector'
       order by 1`);

    assert.deepEqual(
      deguisees.map((d) => `${d.colonne} : ${d.type_}`),
      [],
      "une empreinte qui n'est pas un vecteur ne fait aucune recherche sémantique",
    );
  });

  /*
   * ================================================ LE CLOISONNEMENT, EN BLOC
   *
   * `isolation.test.ts` prouve le comportement sur des tables nommées : un
   * tiers ne voit ni l'organisation, ni la pièce, ni la conversation d'un
   * autre. C'est la preuve qui compte, et elle ne couvre que ce qu'elle nomme.
   *
   * La faute classique du multi-tenant n'est pas une politique fausse : c'est
   * une table AJOUTÉE avec un `tenant_id` et sans politique. Elle ne casse
   * aucun test — elle n'en a aucun — et elle est lisible par tout le monde.
   *
   * Les deux vérifications qui suivent portent donc sur TOUTES les tables qui
   * portent un `tenant_id`, présentes et à venir. 63 au 4 octobre 2026.
   */

  it("toute table portant un tenant_id a une RLS activée, FORCÉE, et au moins une politique", async () => {
    // `force` compte autant qu'`enable` : sans elle, le propriétaire de la
    // table — et toute fonction `security definer` qui lui appartient —
    // traverse les politiques sans les voir.
    const nues = await interroger<{ table_: string; etat: string }>(`
      select ns.nspname || '.' || cl.relname as table_,
             'rls=' || cl.relrowsecurity || ' force=' || cl.relforcerowsecurity ||
             ' politiques=' || (select count(*) from pg_policies p
                                 where p.schemaname = ns.nspname and p.tablename = cl.relname) as etat
        from pg_class cl
        join pg_namespace ns on ns.oid = cl.relnamespace
        join pg_attribute a on a.attrelid = cl.oid and a.attname = 'tenant_id'
                           and a.attnum > 0 and not a.attisdropped
       where cl.relkind = 'r'
         and ns.nspname not in ('pg_catalog', 'information_schema')
         and (not cl.relrowsecurity
              or not cl.relforcerowsecurity
              or not exists (select 1 from pg_policies p
                              where p.schemaname = ns.nspname and p.tablename = cl.relname))
       order by 1`);

    assert.deepEqual(
      nues.map((n) => `${n.table_} — ${n.etat}`),
      [],
      "table de tenant sans cloisonnement : ses lignes sont lisibles par tous",
    );
  });

  /**
   * (d bis) Ce qui garde l'effacement d'une pièce n'est pas le déclencheur.
   *
   * `malica.piece_effacable` est un réglage de session : n'importe quel
   * utilisateur peut le poser. Il ne sert de clé à personne PARCE QUE
   * `authenticated` n'a pas `delete` sur `capture.pieces` et que les tables du
   * garde d'effacement n'ont aucune politique `DELETE` ni `UPDATE`. Cette
   * sûreté tenait à une absence ; l'épreuve la rend visible. Le jour où une
   * politique `DELETE` est ajoutée à l'une de ces tables, le réglage posable
   * par tous devient une clé — et c'est ici que cela rougit.
   *
   * Les tables sont reconnues à leur déclencheur, pas à une liste : une table
   * qui rejoint le garde demain est couverte sans que ce fichier bouge.
   */
  it("l'effacement d'une pièce n'est ouvert à authenticated par aucune politique ni aucun droit", async () => {
    const gardees = `
      select t.tgrelid
        from pg_trigger t
       where t.tgfoid = 'app.deny_mutation_hors_effacement_de_piece()'::regprocedure
         and not t.tgisinternal`;

    const politiques = await interroger<{ table_: string; cmd: string }>(`
      select p.schemaname || '.' || p.tablename as table_, p.cmd
        from pg_policies p
        join pg_class c on c.relname = p.tablename
        join pg_namespace n on n.oid = c.relnamespace and n.nspname = p.schemaname
       where c.oid in (${gardees})
         and p.cmd in ('DELETE', 'UPDATE', 'ALL')
       order by 1, 2`);
    assert.deepEqual(
      politiques.map((r) => `${r.table_} — politique ${r.cmd}`),
      [],
      "une politique DELETE/UPDATE sur une table du garde fait du réglage `malica.piece_effacable` une clé posable par tous",
    );

    const droits = await interroger<{ table_: string; droit: string }>(`
      select c.oid::regclass::text as table_, d.droit
        from pg_class c
        cross join (values ('DELETE'), ('UPDATE')) as d(droit)
       where c.oid in (${gardees})
         and has_table_privilege('authenticated', c.oid, d.droit)
       order by 1, 2`);
    assert.deepEqual(
      droits.map((r) => `${r.table_} — droit ${r.droit}`),
      [],
      "authenticated ne doit pas détenir delete/update sur les tables du garde d'effacement",
    );

    const pieces = await interroger<{ ok: boolean }>(
      "select has_table_privilege('authenticated', 'capture.pieces', 'DELETE') as ok",
    );
    assert.equal(
      pieces[0]!.ok,
      false,
      "authenticated ne supprime pas une pièce : seule `capture_piece_supprimer` le fait",
    );
  });

  /**
   * (e) Aucune vue accordée à `authenticated` ne contourne la RLS.
   *
   * Les épreuves ci-dessus lisent les POLITIQUES. Aucune ne regardait les
   * vues, et c'est par là que le trou est passé : `postgres` est
   * superutilisateur et `bypassrls`, donc une vue qui lui appartient sans être
   * `security_invoker` lit ses tables SANS les politiques. Accordée en
   * `select`, elle rend à n'importe quel compte les lignes de tous les
   * clients. Ni un filtre applicatif oublié, ni une politique oubliée : une
   * politique contournée — le troisième chemin, que R6 ne nomme pas.
   *
   * Une vue matérialisée ne peut pas porter l'option : accordée, elle est
   * toujours fautive.
   *
   * La preuve par exécution est dans
   * `facturation/une-vue-ne-contourne-pas-l-isolation.test.ts` ; celle-ci
   * garde la porte pour les schémas à venir.
   */
  it("aucune vue accordée à authenticated ne contourne la RLS", async () => {
    const fuyantes = await interroger<{ vue: string }>(`
      select n.nspname || '.' || c.relname as vue
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where c.relkind in ('v', 'm')
         and n.nspname not in ('pg_catalog', 'information_schema')
         and has_table_privilege('authenticated', c.oid, 'select')
         and not (c.relkind = 'v'
                  and coalesce(c.reloptions, '{}'::text[]) @> array['security_invoker=true'])
       order by 1`);

    assert.deepEqual(
      fuyantes.map((r) => r.vue),
      [],
      "une vue accordée à authenticated sans security_invoker lit avec les droits de son propriétaire : elle contourne la RLS",
    );
  });

  /*
   * ================================== L'ENVERS DE LA VUE QUI LIT POUR L'APPELANT
   *
   * 18 octobre 2026, trouvé EN REGARDANT l'accueil PME — quatre « 400 » par
   * chargement, et le corps disait « droit refusé pour la table
   * account_classes ».
   *
   * L'épreuve ci-dessus exige qu'une vue accordée lise avec les droits de
   * l'appelant. Elle a un envers que rien ne gardait : si la vue est accordée
   * et que la table DESSOUS ne l'est pas, l'utilisateur reçoit un refus. La
   * vue existe, le droit existe, et rien ne marche.
   *
   * `ref.account_classes` était la seule des trente tables du référentiel à
   * avoir manqué son `grant` — posé sur la vue, jamais sur la table.
   *
   * Pourquoi aucune épreuve ne tombait : l'écran encaisse le refus et se rend
   * quand même. La classe d'un compte ne s'affichait simplement jamais. Un
   * échec qui ne casse rien est le plus durable de tous.
   *
   * L'invariant tenu ici est celui de R10 : le référentiel est LIVRÉ, daté et
   * surchargeable. Il ne porte AUCUNE donnée de tenant — c'est ce qui le
   * distingue de tout le reste du dépôt — donc il se lit par quiconque a
   * ouvert une session. Une table de `ref` illisible est un oubli, jamais une
   * décision : si l'une devait l'être un jour, cette épreuve obligera à
   * l'écrire ici, nommément, au lieu de la laisser silencieuse.
   */

  it("toute table du référentiel est lisible par authenticated", async () => {
    const muettes = await interroger<{ table: string }>(`
      select c.relname as table
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where c.relkind = 'r'
         and n.nspname = 'ref'
         and not has_table_privilege('authenticated', c.oid, 'select')
       order by 1`);

    assert.deepEqual(
      muettes.map((r) => r.table),
      [],
      "une table de ref sans select pour authenticated rend un refus à travers sa vue : la vue est accordée, la table ne l'est pas, et l'écran se tait",
    );
  });

  /*
   * ====================================== LES FONCTIONS QUI PORTENT LES DROITS
   *
   * Une fonction `security definer` exécute avec les droits de son
   * propriétaire : `postgres`, superutilisateur et `bypassrls`. Elle ne subit
   * donc NI la RLS, NI les droits de table de celui qui l'appelle. Soixante
   * d'entre elles sont exécutables par `authenticated` — c'est la surface la
   * plus sensible du dépôt, et aucune épreuve ne la gardait.
   *
   * Trois points, et pas quatre. Le quatrième que la relecture proposait —
   * « un corps sans porte nommée » — demande une liste blanche de soixante
   * fonctions. Une liste blanche qu'on n'a pas examinée une par une est un
   * garde qui MENT : il passe au vert sur ce qu'il a inscrit sans le lire.
   * Il n'est donc pas écrit ici, et ce silence est délibéré.
   *
   * Les fonctions de déclencheur sont hors du point 2, pour une raison
   * exécutable et non pour une commodité : PostgreSQL refuse l'appel direct
   * d'une fonction qui retourne `trigger` (« trigger functions can only be
   * called as triggers »), quel que soit le droit d'exécution. Les sept qui
   * gardent `execute` pour `public` ne sont donc pas une surface d'appel.
   */

  it("toute fonction security definer exécutable par authenticated fixe son search_path", async () => {
    // Sans `search_path` fixé, la résolution des noms du corps suit le chemin
    // de l'APPELANT : un schéma à lui, en tête, et sa table remplace la nôtre
    // — avec les droits du propriétaire de la fonction.
    const sansChemin = await interroger<{ f: string }>(`
      select n.nspname || '.' || p.proname || '(' ||
             pg_get_function_identity_arguments(p.oid) || ')' as f
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where p.prosecdef
         and has_function_privilege('authenticated', p.oid, 'execute')
         and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c
                          where c ~ '^search_path=')
       order by 1`);

    assert.deepEqual(
      sansChemin.map((r) => r.f),
      [],
      "une definer sans search_path fixé résout ses noms dans le chemin de l'appelant",
    );
  });

  it("aucune fonction security definer appelable n'est exécutable par public ou anon", async () => {
    const ouvertes = await interroger<{ f: string; a_qui: string }>(`
      select n.nspname || '.' || p.proname || '(' ||
             pg_get_function_identity_arguments(p.oid) || ')' as f,
             concat_ws(' et ',
               case when has_function_privilege('public', p.oid, 'execute') then 'public' end,
               case when has_function_privilege('anon', p.oid, 'execute') then 'anon' end) as a_qui
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where p.prosecdef
         and p.prorettype <> 'pg_catalog.trigger'::regtype
         and (has_function_privilege('public', p.oid, 'execute')
              or has_function_privilege('anon', p.oid, 'execute'))
       order by 1`);

    assert.deepEqual(
      ouvertes.map((r) => `${r.f} → ${r.a_qui}`),
      [],
      "une definer ouverte à public ou anon prête les droits du propriétaire à un visiteur",
    );
  });

  it("aucune fonction security definer n'écrit dans facturation sans porte nommée", async () => {
    /*
     * `facturation` porte l'argent : licences, factures, lectures comptées.
     * Une definer qui y écrit le fait sans RLS — propriété de `postgres`,
     * superutilisateur, que `force row level security` n'arrête pas. Si son
     * corps ne nomme AUCUNE porte, rien ne dit qui avait le droit d'écrire.
     *
     * L'énoncé était « sans porte de plateforme » jusqu'à la ronde 6, et il
     * est devenu faux ce jour-là : `public.lecture_consommer` est devenue la
     * seule écrivante de `facturation.lectures`, et sa porte n'est pas
     * `app.is_platform` — c'est `app.piece_lisible`, plus son propre verdict.
     * Exiger la porte de plateforme aurait obligé à nommer une exception ; on
     * nomme plutôt les portes admises, qui sont celles qui DÉCIDENT d'un droit.
     *
     * Le 23 octobre, le paiement en ligne (société ou cabinet) nomme sa porte
     * une fois : `facturation.peut_payer` — `app.has_org_role` d'un cabinet, ou
     * le titulaire dirigeant d'une licence —, que `facturation.reste_du_payable`
     * applique à une facture. Ce sont des portes qui DÉCIDENT d'un droit.
     *
     * Ce n'est pas la liste blanche que j'ai refusé d'écrire en ronde 4 :
     * celle-là aurait inscrit soixante FONCTIONS sans les lire. Ici on énumère
     * des PORTES, et l'ensemble gardé est celui des definer qui écrivent dans
     * `facturation` — une aujourd'hui, nommée par le rouge si elle change.
     */
    const sansPorte = await interroger<{ f: string }>(`
      select n.nspname || '.' || p.proname || '(' ||
             pg_get_function_identity_arguments(p.oid) || ')' as f
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where p.prosecdef
         and has_function_privilege('authenticated', p.oid, 'execute')
         and p.prosrc ~* '(insert into|update|delete from)\\s+facturation\\.'
         and p.prosrc !~* '(app\\.(is_platform|piece_lisible|member_orgs|engaged_orgs|has_org_role)|facturation\\.(peut_payer|reste_du_payable))'
       order by 1`);

    assert.deepEqual(
      sansPorte.map((r) => r.f),
      [],
      "écriture dans facturation par une definer sans porte de plateforme",
    );
  });

  /**
   * Le `with check` d'une table de comptage LIE l'identifiant au tenant.
   *
   * Aucun garde sur `pg_proc` n'aurait vu ce défaut-là, parce que la garde
   * manquante n'était pas dans une fonction : `facturation_lectures_ins` ne
   * vérifiait que `tenant_id in app.member_orgs()`, et un collaborateur au
   * plafond s'inscrivait une lecture portant LA LICENCE D'UN TIERS. Une clé
   * étrangère dit « cette licence existe », jamais « cette licence est la
   * vôtre » — et `lecture_autorisee` tient l'existence de la ligne pour une
   * preuve de comptage.
   *
   * La règle, vérifiable : toute table de `facturation` ou de `plateforme` qui
   * porte un `tenant_id` ET l'identifiant d'un autre dossier (`licence_id`,
   * `piece_id`, `requisition_id`) doit nommer les DEUX colonnes dans sa garde
   * d'insertion. Le déclencheur `before insert` compte autant que la
   * politique : `facturation.licence_organisations` y tient son lien depuis
   * l'origine, et il est plus strict qu'une politique.
   *
   * La preuve par exécution est dans
   * `facturation/une-lecture-s-impute-a-la-bonne-licence.test.ts` ; celle-ci
   * garde la porte pour les tables à venir.
   */
  it("toute table de comptage lie son identifiant au tenant à l'insertion", async () => {
    const deliees = await interroger<{ cible: string; garde: string }>(`
      with cibles as (
        select c.oid, n.nspname as s, c.relname as t, a.attname as lien
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
          join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
                             and a.attname in ('licence_id', 'piece_id', 'requisition_id')
         where c.relkind = 'r'
           and n.nspname in ('facturation', 'plateforme')
           and exists (select 1 from pg_attribute b
                        where b.attrelid = c.oid and b.attname = 'tenant_id'
                          and b.attnum > 0 and not b.attisdropped)
      ), gardes as (
        select cb.s, cb.t, cb.lien,
               coalesce((select string_agg(p.with_check, ' ')
                           from pg_policies p
                          where p.schemaname = cb.s and p.tablename = cb.t
                            and p.cmd in ('INSERT', 'ALL')), '')
               || ' ' ||
               coalesce((select string_agg(pr.prosrc, ' ')
                           from pg_trigger tg
                           join pg_proc pr on pr.oid = tg.tgfoid
                          where tg.tgrelid = cb.oid and not tg.tgisinternal
                            and (tg.tgtype & 4) <> 0 and (tg.tgtype & 2) <> 0), '') as garde
          from cibles cb
      )
      select s || '.' || t || ' / ' || lien as cible, garde
        from gardes
       where garde !~ lien or garde !~ 'tenant_id'
       order by 1`);

    assert.deepEqual(
      deliees.map((d) => d.cible),
      [],
      "une garde d'insertion qui ne lie pas cet identifiant au tenant laisse imputer une ligne au dossier d'un autre",
    );
  });

  it("aucune politique de table de tenant n'est inconditionnelle", async () => {
    /*
     * Une politique sur une table de tenant doit se cadrer sur quelque chose :
     * le tenant (`tenant_id`, `app.member_orgs()`, `app.engaged_orgs()`,
     * `app.has_org_role()`), la plateforme (`app.is_platform()`), ou LA
     * PERSONNE (`auth.uid()`, `app.current_uid()`) — ce dernier cas est plus
     * strict que le tenant, pas plus laxiste : les conversations de Malica
     * n'appartiennent qu'à leur auteur, même entre collègues du même cabinet.
     *
     * Ce qui est interdit, c'est l'absence de condition : un `using (true)`
     * sur une table de tenant ouvre la table au premier compte venu.
     */
    const ouvertes = await interroger<{ table_: string; politique: string; cmd: string }>(`
      select p.schemaname || '.' || p.tablename as table_, p.policyname as politique, p.cmd
        from pg_policies p
        join pg_class cl on cl.relname = p.tablename
        join pg_namespace ns on ns.oid = cl.relnamespace and ns.nspname = p.schemaname
        join pg_attribute a on a.attrelid = cl.oid and a.attname = 'tenant_id'
                           and a.attnum > 0 and not a.attisdropped
       where coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '') !~
             'tenant_id|member_orgs|engaged_orgs|has_org_role|is_platform|auth\\.uid|current_uid'
       order by 1, 2`);

    assert.deepEqual(
      ouvertes.map((o) => `${o.table_} / ${o.politique} (${o.cmd})`),
      [],
      "politique sans condition sur une table de tenant",
    );
  });
});
