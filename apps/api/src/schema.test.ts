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
