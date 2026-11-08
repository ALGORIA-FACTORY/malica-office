/**
 * La base tient son intégrité : ni orphelin, ni doublon, ni littéral métier.
 *
 * ================================================================= POURQUOI
 *
 * 1er novembre 2026, Wissem : « Dans la base et tables aussi. Pas d'orphelins,
 * pas de hardcoding, pas de doublons, toujours corrige automatiquement. »
 *
 * Les gardes existantes tiennent chacune un endroit : les portes
 * (`les-clients-n-ecrivent-que-par-les-portes.test.ts`), les espaces de noms
 * de `ref.labels` (`scan/le-referentiel-se-traduit.test.ts`), les littéraux
 * fiscaux sous `socle/juridictions` (`no-fiscal-literals.test.ts`). Aucune ne
 * relisait la base ENTIÈRE. Cet audit la relit, après les migrations (la CI
 * de l'API) et après le jeu de données et les épreuves (la CI des épreuves),
 * et il dit, catégorie par catégorie :
 *
 *   orphelins  — une colonne `uuid` `*_id` sans clé étrangère ; une référence
 *                polymorphe qui nomme une table absente ; un libellé dont le
 *                code n'existe plus, un code sans libellé en fr, en ou ar ; une
 *                clé de message que rien ne lit ; une clé `refus.*` levée sans
 *                message dans les trois langues ; un message levé en français
 *                brut, qui arrive tel quel à un utilisateur arabophone ; une
 *                porte `security definer` que personne ne peut ni n'appelle ;
 *   doublons   — une table de référence sans clé naturelle unique ; deux codes
 *                qui ne diffèrent que par la casse ou les blancs ; deux
 *                fonctions au corps identique ; un lecteur de plus d'une table
 *                de paramétrage (la même résolution écrite deux fois) ;
 *   littéraux  — un numéro de compte, un code devise ou un taux de TVA du
 *                référentiel écrit en dur dans le code ou dans une fonction ;
 *                un titre de page figé en français.
 *
 * ============================================================ L'INSTANTANÉ
 *
 * `verrous/integrite-de-la-base.json` porte ce qui reste, et POURQUOI : chaque
 * entrée dit sa raison. L'audit échoue dans les deux sens, comme l'instantané
 * des portes : un constat NOUVEAU (une colonne sans clé, un message brut, un
 * littéral) le fait rougir, et un constat qui DISPARAÎT aussi — l'instantané se
 * resserre alors, dans la même PR que la correction, pour qu'aucune dette
 * réglée ne puisse revenir sans qu'on le voie.
 *
 *   node --experimental-strip-types --test src/la-base-tient-son-integrite.test.ts
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { MESSAGES } from "@malica/socle/messages";

import { introuvableLisible, REFUS_SANS_CLE, refusLisible } from "./refus.ts";

interface Verrou {
  colonnes_sans_cle_etrangere: Record<string, string>;
  libelles: Record<string, string>;
  cles_de_refus_composees: Record<string, string>;
  messages_bruts: Record<string, string[]>;
  refus_calcules: Record<string, string>;
  portes_que_personne_n_appelle: Record<string, string>;
  portes_sans_appel: Record<string, string>;
  fonctions_publiques_sans_appel: Record<string, string>;
  cascades_sans_index: Record<string, string>;
  lecteurs_du_parametrage: Record<string, string[]>;
  litteraux_metier: Record<string, { raison: string; litteraux: Record<string, number> }>;
  titres_de_page_figes: Record<string, string>;
}

const VERROU = JSON.parse(
  readFileSync(new URL("./verrous/integrite-de-la-base.json", import.meta.url), "utf8"),
) as Verrou;

const RACINE = fileURLToPath(new URL("../../../", import.meta.url));

/* ------------------------------------------------------------------ le code */

/** Les fichiers de production d'un dossier : ni test, ni épreuve, ni gabarit. */
function fichiersDeProduction(dossier: string, extensions: RegExp): string[] {
  const out: string[] = [];
  const parcourir = (d: string) => {
    for (const nom of readdirSync(d)) {
      const chemin = join(d, nom);
      if (statSync(chemin).isDirectory()) {
        if (!["node_modules", "__tests__", "e2e"].includes(nom)) parcourir(chemin);
      } else if (extensions.test(nom) && !/\.(test|spec)\.|\.d\.ts$|routeTree\.gen/.test(nom)) {
        out.push(chemin);
      }
    }
  };
  parcourir(join(RACINE, dossier));
  return out;
}

// The lock file names paths with "/" — on Windows, join() gives "\".
const relatif = (chemin: string) => chemin.slice(RACINE.length).split(sep).join("/");

/** Retire les commentaires : seul le code exécutable est jugé. */
const sansCommentaires = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:\\])\/\/.*$/gm, "$1 ");

const CODE_TS = [
  ...fichiersDeProduction("apps/api/src", /\.ts$/),
  ...fichiersDeProduction("apps/web/src", /\.tsx?$/),
  ...fichiersDeProduction("packages/socle/src", /\.ts$/),
].filter((f) => !/\/messages(-[a-z]+)?\.ts$/.test(f));

const TEXTES = new Map(CODE_TS.map((f) => [relatif(f), readFileSync(f, "utf8")]));

const LOCALES = ["fr", "en", "ar"] as const;
const DICTS = MESSAGES as unknown as Record<(typeof LOCALES)[number], Record<string, string>>;

/** Une clé de message existe dans une langue, nue ou par ses formes de pluriel. */
const cleDite = (locale: (typeof LOCALES)[number], cle: string) =>
  cle in DICTS[locale] || Object.keys(DICTS[locale]).some((k) => k.startsWith(`${cle}#`));

/** Les langues où une clé manque. */
const languesSans = (cle: string) => LOCALES.filter((l) => !cleDite(l, cle));

/**
 * Compare un relevé à l'instantané, dans les deux sens, et dit quoi faire.
 * `quoi` nomme la catégorie : le message d'échec doit suffire à corriger.
 */
function egalALInstantane(quoi: string, releve: string[], instantane: string[]) {
  const nouveaux = releve.filter((x) => !instantane.includes(x));
  const partis = instantane.filter((x) => !releve.includes(x));
  assert.deepEqual(
    { nouveaux, partis },
    { nouveaux: [], partis: [] },
    `${quoi} : ${nouveaux.length} nouveau(x) — corrigez-les à la racine ; ` +
      `${partis.length} réglé(s) — retirez-les de verrous/integrite-de-la-base.json`,
  );
}

/* ------------------------------------------------------- ce qui se passe de la base */

describe("l'intégrité du code qui parle à la base", () => {
  it("chaque entrée de l'instantané dit sa raison", () => {
    const sansRaison = [
      ...Object.entries(VERROU.colonnes_sans_cle_etrangere),
      ...Object.entries(VERROU.cles_de_refus_composees),
      ...Object.entries(VERROU.refus_calcules),
      ...Object.entries(VERROU.portes_que_personne_n_appelle),
      ...Object.entries(VERROU.portes_sans_appel),
      ...Object.entries(VERROU.fonctions_publiques_sans_appel),
      ...Object.entries(VERROU.cascades_sans_index),
      ...Object.entries(VERROU.litteraux_metier).map(([f, v]) => [f, v.raison] as const),
    ]
      .filter(([, raison]) => raison.trim().length < 20)
      .map(([cle]) => cle);
    assert.deepEqual(sansRaison, []);
  });

  it("aucune clé de message que rien ne lit", () => {
    /*
     * Une clé lue par composition (« `refus.ecriture.${defaut}` ») compte pour
     * lue quand son préfixe est composé quelque part dans le code.
     */
    const code = [...TEXTES.values()].join("\n");
    const sql = readdirSync(join(RACINE, "db/migrations"))
      .map((f) => readFileSync(join(RACINE, "db/migrations", f), "utf8"))
      .join("\n");
    const prefixes = [
      ...new Set([...code.matchAll(/["'`]([a-zA-Z][\w.]*\.)\$\{/g)].map((m) => m[1]!)),
    ];
    const cles = [...new Set(Object.keys(DICTS.fr).map((k) => k.replace(/#\w+$/, "")))];
    const orphelines = cles.filter(
      (k) => !code.includes(k) && !sql.includes(k) && !prefixes.some((p) => k.startsWith(p)),
    );
    assert.deepEqual(
      orphelines,
      [],
      `clé(s) de message que rien ne lit : ${orphelines.join(", ")}`,
    );
  });

  it("chaque clé de message est dite en fr, en et ar", () => {
    const cles = new Set(LOCALES.flatMap((l) => Object.keys(DICTS[l])));
    const manques = [...cles]
      .map((k) => [k, LOCALES.filter((l) => !(k in DICTS[l]))] as const)
      .filter(([, l]) => l.length > 0)
      .map(([k, l]) => `${k} (${l.join(",")})`);
    assert.deepEqual(manques, []);
  });

  it("chaque clé `refus.*` levée par le code a son message en fr, en et ar", () => {
    const manques: string[] = [];
    for (const [fichier, texte] of TEXTES) {
      for (const m of sansCommentaires(texte).matchAll(/["'`](refus\.[a-z0-9_.]+)(["'`]|\$\{)/g)) {
        const cle = m[1]!;
        if (m[2] === "${" || cle.endsWith(".")) {
          if (!(cle in VERROU.cles_de_refus_composees))
            manques.push(`${fichier} : préfixe composé non déclaré ${cle}`);
          continue;
        }
        const l = languesSans(cle);
        if (l.length) manques.push(`${fichier} : ${cle} (${l.join(",")})`);
      }
    }
    assert.deepEqual([...new Set(manques)], []);
  });

  it("aucun titre de page figé en français, hors de ceux qui restent nommés", () => {
    /*
     * Le rendu serveur (TanStack Start) produit la tête de page avant que la
     * langue choisie — rangée dans le navigateur — ne soit connue : un titre
     * traduit dans `head()` différerait entre le serveur et l'hydratation.
     * L'inventaire est tenu ici ; aucun titre figé de plus.
     */
    const releve: string[] = [];
    for (const [fichier, texte] of TEXTES) {
      if (!fichier.startsWith("apps/web/src/routes/")) continue;
      for (const m of texte.matchAll(/\btitle:\s*"([^"]+)"/g)) releve.push(`${fichier} :: ${m[1]}`);
    }
    egalALInstantane(
      "titres de page figés",
      releve,
      Object.entries(VERROU.titres_de_page_figes).map(([f, t]) => `${f} :: ${t}`),
    );
  });
});

/* ------------------------------------------------------------------- la base */

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL_ADMIN"]);

/** Les noms de conditions PL/pgSQL que nos `raise` emploient, et leur SQLSTATE. */
const SQLSTATE: Readonly<Record<string, string>> = {
  check_violation: "23514",
  no_data_found: "P0002",
  restrict_violation: "23001",
  unique_violation: "23505",
  foreign_key_violation: "23503",
  not_null_violation: "23502",
  insufficient_privilege: "42501",
  invalid_parameter_value: "22023",
  data_exception: "22000",
  wrong_object_type: "42809",
  serialization_failure: "40001",
  cardinality_violation: "21000",
  raise_exception: "P0001",
};

/** Les fonctions écrites par le dépôt : ni extension, ni catalogue. */
const NOS_FONCTIONS = `
  select p.oid, n.nspname || '.' || p.proname as fn, p.prosrc, p.prosecdef, p.prorettype
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname not in ('pg_catalog', 'information_schema')
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')`;

describe("l'intégrité de la base", { skip: !BASE_CONFIGUREE }, () => {
  let pool: pg.Pool;
  const q = async <T extends pg.QueryResultRow>(sql: string, valeurs: unknown[] = []) =>
    (await pool.query<T>(sql, valeurs)).rows;

  before(() => {
    pool = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
  });

  after(async () => {
    await pool.end();
  });

  /* ------------------------------------------------------------- orphelins */

  it("chaque colonne uuid `*_id` porte une clé étrangère, ou sa raison", async () => {
    const rows = await q<{ colonne: string }>(`
      select c.table_schema || '.' || c.table_name || '.' || c.column_name as colonne
        from information_schema.columns c
        join information_schema.tables t using (table_schema, table_name)
       where t.table_type = 'BASE TABLE' and c.data_type = 'uuid'
         and c.column_name like '%\\_id' escape '\\'
         and c.table_schema not in ('pg_catalog', 'information_schema')
         and not exists (
               select 1 from pg_constraint k
                 join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any (k.conkey)
                where k.contype = 'f'
                  and k.conrelid = (quote_ident(c.table_schema) || '.' || quote_ident(c.table_name))::regclass
                  and a.attname = c.column_name)
       order by 1`);
    egalALInstantane(
      "colonnes uuid sans clé étrangère",
      rows.map((r) => r.colonne),
      Object.keys(VERROU.colonnes_sans_cle_etrangere),
    );
  });

  it("une référence polymorphe nomme une table qui existe", async () => {
    /*
     * `audit.event_log` survit aux objets qu'il raconte — une pièce supprimée
     * garde son journal, c'est voulu (`la_suppression_libre_l_est_vraiment`) :
     * l'objet peut manquer, la TABLE qu'il nomme jamais.
     */
    const rows = await q<{ ou: string }>(`
      select distinct 'audit.event_log : ' || object_schema || '.' || object_table as ou
        from audit.event_log
       where to_regclass(quote_ident(object_schema) || '.' || quote_ident(object_table)) is null
      union
      select distinct 'ref.faits_consignables : ' || object_schema || '.' || object_table
        from ref.faits_consignables
       where to_regclass(quote_ident(object_schema) || '.' || quote_ident(object_table)) is null`);
    assert.deepEqual(
      rows.map((r) => r.ou),
      [],
    );
  });

  it("une table de passage reste vide hors de la transaction qui l'emploie", async () => {
    // Ses identifiants n'ont pas de clé : ce qu'elle nomme est en train de partir.
    const rows = await q<{ n: string }>(
      `select count(*)::text as n from capture.effacements_en_cours`,
    );
    assert.equal(rows[0]!.n, "0");
  });

  it("chaque espace de libellés dit d'où viennent ses codes", async () => {
    const espaces = await q<{ ns: string }>(`select distinct ns from ref.labels order by ns`);
    egalALInstantane(
      "espaces de libellés sans source déclarée",
      espaces.map((e) => e.ns),
      Object.keys(VERROU.libelles),
    );
  });

  it("ni libellé orphelin, ni code sans libellé en fr, en et ar", async () => {
    const constats: string[] = [];
    for (const [ns, source] of Object.entries(VERROU.libelles)) {
      const rows = await q<{ constat: string }>(
        `with codes as (select distinct x::text as code from (${source}) s(x)),
              dits as (select key, array_agg(locale order by locale) as locales
                         from ref.labels where ns = $1 group by key)
         select 'libellé orphelin ' || $1 || '.' || d.key as constat
           from dits d where d.key not in (select code from codes)
         union all
         select 'code sans libellé ' || $1 || '.' || c.code || ' (' ||
                coalesce(array_to_string(d.locales, ','), 'aucune langue') || ')'
           from codes c left join dits d on d.key = c.code
          where d.locales is distinct from array['ar', 'en', 'fr']
         order by 1`,
        [ns],
      );
      constats.push(...rows.map((r) => r.constat));
    }
    assert.deepEqual(constats, []);
  });

  it("le dictionnaire des concepts tient : chaque champ lisible par son expert, chaque concept lu", async () => {
    /*
     * Des déclencheurs différés gardent chaque écriture (20261115100000) ; ce
     * relevé relit la base entière par la même fonction, et ajoute ce qu'un
     * déclencheur de ligne ne voit pas : un concept que plus aucun champ ne lit.
     */
    const rows = await q<{ constat: string }>(`
      select champ || ' : ' || ecart as constat from ref.champs_hors_dictionnaire()
      union all
      select 'concept sans champ : ' || k.code from ref.concepts k
       where not exists (select 1 from ref.grille_champs c where c.concept_id = k.id)
      order by 1`);
    assert.deepEqual(
      rows.map((r) => r.constat),
      [],
    );
  });

  it("chaque clé `refus.*` levée par une fonction a son message en fr, en et ar", async () => {
    const rows = await q<{ cle: string; fn: string }>(`
      with f as (${NOS_FONCTIONS})
      select distinct m[1] as cle, f.fn
        from f, regexp_matches(f.prosrc, '''(refus\\.[a-z0-9_.]*)''', 'g') m
       order by 1`);
    const manques = rows
      .filter((r) => {
        if (r.cle.endsWith(".")) return !(r.cle in VERROU.cles_de_refus_composees);
        return languesSans(r.cle).length > 0;
      })
      .map((r) => `${r.cle} (${r.fn} : ${languesSans(r.cle).join(",") || "préfixe non déclaré"})`);
    assert.deepEqual([...new Set(manques)], []);
  });

  it("chaque préfixe de refus composé a ses messages", () => {
    for (const prefixe of Object.keys(VERROU.cles_de_refus_composees)) {
      const dites = LOCALES.map(
        (l) => Object.keys(DICTS[l]).filter((k) => k.startsWith(prefixe)).length,
      );
      assert.ok(
        dites.every((n) => n > 0 && n === dites[0]),
        `${prefixe} : ${dites.join("/")} message(s) en fr/en/ar`,
      );
    }
  });

  it("aucun message en français brut ne part vers l'écran", async () => {
    /*
     * Un `raise exception '<phrase>' using errcode = …` que la frontière
     * (`refus.ts`) rend TEL QUEL à l'appelant arrive en français à un
     * utilisateur qui lit l'arabe. La frontière est rejouée ici, telle quelle :
     * un message qu'elle traduit (une clé, un « introuvable ») ou qu'elle tait
     * (une panne, au journal) n'est pas un constat.
     *
     * Le message se lit ENTIER : PostgreSQL concatène deux littéraux qu'un saut
     * de ligne sépare (`'Le compte % existe… '` puis `'plutôt qu''un doublon.'`).
     * N'en lire que le premier laissait passer quinze phrases françaises
     * (audit du 1er novembre 2026) : leur premier morceau finit par une
     * espace, que la frontière retire — le relevé ne les reconnaissait plus.
     */
    const rows = await q<{ fn: string; stmt: string }>(`
      with f as (${NOS_FONCTIONS})
      select f.fn, m[1] as stmt
        from f, regexp_matches(f.prosrc,
               '(raise\\s+exception\\s+''(?:[^'']|'''')*''(?:\\s*''(?:[^'']|'''')*'')*[^;]*;)', 'gi') m`);
    const parMessage = new Map<string, Set<string>>();
    const calcules = new Set<string>();
    const inconnus: string[] = [];
    for (const { fn, stmt } of rows) {
      const litteraux = /^raise\s+exception\s+('(?:[^']|'')*'(?:\s*'(?:[^']|'')*')*)/i.exec(
        stmt,
      )![1]!;
      const message = [...litteraux.matchAll(/'((?:[^']|'')*)'/g)]
        .map((m) => m[1]!.replaceAll("''", "'"))
        .join("");
      if (message === "%") {
        /*
         * Un message calculé se calcule depuis une clé — `'refus.…' || geste`,
         * `app.refus_avec_valeurs('refus.…', …)` —, ou sa raison est nommée
         * dans l'instantané : une variable ne se juge pas à la lecture.
         */
        if (!/,\s*[^;]*'refus\./.test(stmt)) calcules.add(fn);
        continue;
      }
      if (message.startsWith("refus.")) continue;
      // Une clé du dictionnaire, dite dans les trois langues, se traduit à l'écran.
      if (/^[a-z_]+(\.[a-z0-9_]+)+$/.test(message) && languesSans(message).length === 0) continue;
      const nom = /errcode\s*=\s*'([0-9A-Za-z_]+)'/i.exec(stmt)?.[1] ?? "raise_exception";
      const code = /^[0-9A-Z]{5}$/.test(nom) ? nom : SQLSTATE[nom];
      if (!code) {
        inconnus.push(`${fn} : ${nom}`);
        continue;
      }
      const erreur = Object.assign(new Error(message), { code });
      if (introuvableLisible(erreur) !== null) continue;
      // Un message qui ne se dit ni par sa clé ni par une traduction tombe sur la
      // clé générique : il ne part plus à l'écran, mais R12 veut sa clé.
      if (refusLisible(erreur) !== REFUS_SANS_CLE) continue;
      parMessage.set(message, (parMessage.get(message) ?? new Set()).add(fn));
    }
    assert.deepEqual(inconnus, [], "condition PL/pgSQL inconnue de l'audit");
    egalALInstantane(
      "messages calculés sans clé refus.* (levez une clé, ou nommez la raison)",
      [...calcules].sort(),
      Object.keys(VERROU.refus_calcules),
    );
    const releve = [...parMessage].map(([m, fns]) => `${m} :: ${[...fns].sort().join(" ")}`);
    egalALInstantane(
      "messages levés en français brut (faites-en une clé refus.* dite en fr, en et ar)",
      releve,
      Object.entries(VERROU.messages_bruts).map(([m, fns]) => `${m} :: ${fns.join(" ")}`),
    );
  });

  it("aucune porte morte : ni sans appelant permis, ni sans appel dans le code", async () => {
    /*
     * Deux formes. Une porte qu'aucun client ni l'API ne peut exécuter, et que
     * rien dans la base n'appelle, ne sert à rien. Une porte qu'un client peut
     * exécuter mais que ni la base, ni l'API, ni les outils n'appellent est un
     * geste sans écran : soit l'écran manque, soit la porte est de trop.
     */
    const rows = await q<{ fn: string; client: boolean; api: boolean }>(`
      with f as (${NOS_FONCTIONS}),
      textes as (
        select p.prosrc as t from pg_proc p
        union all
        select coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || ' ' ||
               coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '') from pg_policy pol
        union all
        select pg_get_viewdef(c.oid) from pg_class c
         where c.relkind in ('v', 'm')
           and c.relnamespace not in ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
        union all select pg_get_expr(d.adbin, d.adrelid) from pg_attrdef d
        union all select pg_get_constraintdef(k.oid) from pg_constraint k where k.contype = 'c'
      )
      select f.fn,
             has_function_privilege('authenticated', f.oid, 'execute')
               or has_function_privilege('anon', f.oid, 'execute') as client,
             exists (select 1 from pg_roles where rolname = 'malica_api')
               and has_function_privilege('malica_api', f.oid, 'execute') as api
        from f
       where f.prosecdef
         and f.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)
         and not exists (select 1 from textes
                          where textes.t ~* ('\\m' || split_part(f.fn, '.', 2) || '\\s*\\('))
       order by 1`);
    egalALInstantane(
      "portes que personne ne peut appeler et que rien n'appelle",
      rows.filter((r) => !r.client && !r.api).map((r) => r.fn),
      Object.keys(VERROU.portes_que_personne_n_appelle),
    );
    const outils = [
      ...fichiersDeProduction("outils", /\.mjs$/),
      ...fichiersDeProduction("db", /\.mjs$/).filter((f) => !f.includes("/migrations/")),
    ].map((f) => readFileSync(f, "utf8"));
    const code = [...TEXTES.values(), ...outils].map(sansCommentaires).join("\n");
    const sansAppel = rows
      .filter((r) => r.client || r.api)
      .map((r) => r.fn)
      .filter((fn) => !new RegExp(`\\b${fn.split(".")[1]}\\b`).test(code));
    egalALInstantane(
      "portes qu'un client peut appeler mais que rien n'appelle",
      sansAppel,
      Object.keys(VERROU.portes_sans_appel),
    );
  });

  it("aucune fonction exécutable par PUBLIC que rien n'appelle", async () => {
    /*
     * Le pendant des portes mortes, hors `security definer`. Audit du
     * 6 novembre 2026 (docs/audit-2026-11-06/base.md, § 3.3) :
     * `ref.parametre_fiscal` et `ref.appliquer_bareme` étaient exécutables par
     * tout rôle (droit par défaut de PUBLIC), sans un seul appelant — et la
     * première renvoyait vers une fonction qui n'a jamais existé. Une fonction
     * que tout le monde peut appeler et que personne n'appelle est une surface
     * sans usage ; retirée par 20261205094400.
     *
     * Un appel se reconnaît à « nom( » dans une AUTRE définition de la base
     * (corps de fonction, politique, vue, défaut, contrainte), ou au nom seul
     * dans le code (API, écran, socle, outils).
     */
    const rows = await q<{ fn: string }>(`
      with f as (${NOS_FONCTIONS}),
      textes as (
        select p.oid, p.prosrc as t from pg_proc p
        union all
        select null, coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || ' ' ||
               coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '') from pg_policy pol
        union all
        select null, pg_get_viewdef(c.oid) from pg_class c
         where c.relkind in ('v', 'm')
           and c.relnamespace not in ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
        union all select null, pg_get_expr(d.adbin, d.adrelid) from pg_attrdef d
        union all select null, pg_get_constraintdef(k.oid) from pg_constraint k where k.contype = 'c'
      )
      select f.fn from f join pg_proc p on p.oid = f.oid
       where not f.prosecdef
         and f.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)
         and exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                      where a.grantee = 0 and a.privilege_type = 'EXECUTE')
         and not exists (select 1 from textes
                          where textes.oid is distinct from f.oid
                            and textes.t ~* ('\\m' || split_part(f.fn, '.', 2) || '\\s*\\('))
       order by 1`);
    const outils = [
      ...fichiersDeProduction("outils", /\.mjs$/),
      ...fichiersDeProduction("db", /\.mjs$/).filter((f) => !f.includes("/migrations/")),
    ].map((f) => readFileSync(f, "utf8"));
    const code = [...TEXTES.values(), ...outils].map(sansCommentaires).join("\n");
    egalALInstantane(
      "fonctions exécutables par PUBLIC que rien n'appelle",
      rows.map((r) => r.fn).filter((fn) => !new RegExp(`\\b${fn.split(".")[1]}\\b`).test(code)),
      Object.keys(VERROU.fonctions_publiques_sans_appel),
    );
  });

  it("chaque clé étrangère qui efface en cascade a un index menant par ses colonnes", async () => {
    /*
     * `on delete cascade` (ou `set null`, `set default`) fait chercher, à chaque
     * suppression de la ligne visée, les lignes qui la nomment. Sans index menant
     * par la colonne, la recherche parcourt la table entière — tous tenants
     * confondus, sous le verrou de la suppression. Audit du 6 novembre 2026
     * (§ 3.5) : `capture.rattachements.piece_id` et `.piece_liee_id`, deux
     * cascades depuis `capture.pieces`, n'avaient qu'un index menant par
     * `tenant_id` ; indexées par 20261205094100. Un index menant par les mêmes
     * colonnes, dans n'importe quel ordre, sert la recherche — partiel aussi,
     * si son seul prédicat est « la colonne n'est pas nulle », que la recherche
     * par égalité implique ; pas un index partiel sur `active`, qui ignore les
     * lignes qu'on efface aussi.
     */
    const rows = await q<{ fk: string }>(`
      select n.nspname || '.' || c.relname || '.' || k.conname as fk
        from pg_constraint k
        join pg_class c on c.oid = k.conrelid
        join pg_namespace n on n.oid = c.relnamespace
       where k.contype = 'f' and k.confdeltype in ('c', 'n', 'd')
         and not exists (
               select 1 from pg_index i
                where i.indrelid = k.conrelid and i.indisvalid
                  and (i.indpred is null
                       or (cardinality(k.conkey) = 1
                           and pg_get_expr(i.indpred, i.indrelid) =
                               '(' || (select quote_ident(a.attname) from pg_attribute a
                                        where a.attrelid = k.conrelid and a.attnum = k.conkey[1])
                                   || ' IS NOT NULL)'))
                  and (string_to_array(i.indkey::text, ' ')::int2[])[1:cardinality(k.conkey)] @> k.conkey
                  and (string_to_array(i.indkey::text, ' ')::int2[])[1:cardinality(k.conkey)] <@ k.conkey)
       order by 1`);
    egalALInstantane(
      "clés étrangères en cascade sans index menant par leurs colonnes",
      rows.map((r) => r.fk),
      Object.keys(VERROU.cascades_sans_index),
    );
  });

  it("les tables que rien ne lit ni n'écrit (relevé, sans échec)", async (t) => {
    const rows = await q<{ table: string }>(`
      with tables as (
        select n.nspname || '.' || c.relname as nom
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where c.relkind in ('r', 'p') and not c.relispartition
           and n.nspname not in ('pg_catalog', 'information_schema', 'extensions', 'public', 'pg_toast')
      ), textes as (
        select string_agg(p.prosrc, E'\\n') as t from pg_proc p
        union all
        select string_agg(pg_get_viewdef(c.oid), E'\\n') from pg_class c
         where c.relkind in ('v', 'm')
           and c.relnamespace not in ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
      )
      select nom as table from tables
       where not exists (select 1 from textes where textes.t ~* ('\\m' || replace(nom, '.', '\\.') || '\\M'))
       order by 1`);
    const code = [...TEXTES.values()].join("\n");
    const muettes = rows.map((r) => r.table).filter((nom) => !code.includes(nom));
    t.diagnostic(
      `tables que ni une fonction, ni une vue, ni le code ne nomment : ${muettes.join(", ")}`,
    );
  });

  /* --------------------------------------------------------------- doublons */

  it("chaque table de référence a une clé naturelle unique", async () => {
    // Une clé primaire `id` seule n'empêche aucun doublon : deux lignes au
    // même code et à la même date d'effet entrent toutes les deux.
    const rows = await q<{ table: string }>(`
      select c.oid::regclass::text as table
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'ref' and c.relkind in ('r', 'p')
         and not exists (
               select 1 from pg_index i
                where i.indrelid = c.oid and i.indisunique
                  and exists (select 1 from unnest(i.indkey) k(attnum)
                                join pg_attribute a on a.attrelid = c.oid and a.attnum = k.attnum
                               where a.attname <> 'id'))
         and not exists (select 1 from pg_constraint x where x.conrelid = c.oid and x.contype = 'x')
       order by 1`);
    assert.deepEqual(
      rows.map((r) => r.table),
      [],
    );
  });

  it("aucun code de référence ne double un autre à la casse ou aux blancs près", async () => {
    const tables = await q<{ table: string; cle: string[] }>(`
      select c.oid::regclass::text as table,
             array(select a.attname::text from unnest(i.indkey) k(attnum)
                     join pg_attribute a on a.attrelid = c.oid and a.attnum = k.attnum) as cle
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        join pg_index i on i.indrelid = c.oid and i.indisunique and i.indpred is null
                       and i.indexprs is null
       where n.nspname = 'ref' and c.relkind in ('r', 'p')
         and exists (select 1 from unnest(i.indkey) k(attnum)
                       join pg_attribute a on a.attrelid = c.oid and a.attnum = k.attnum
                       join pg_type ty on ty.oid = a.atttypid
                      where ty.typname = 'text')`);
    const doublons: string[] = [];
    for (const { table, cle } of tables) {
      const colonnes = await q<{ attname: string; texte: boolean }>(
        `select a.attname, t.typname = 'text' as texte
           from pg_attribute a join pg_type t on t.oid = a.atttypid
          where a.attrelid = $1::regclass and a.attname = any ($2)`,
        [table, cle],
      );
      const expr = colonnes
        .map((c) => (c.texte ? `lower(btrim(${c.attname}))` : c.attname))
        .join(", ");
      const rows = await q<{ n: number }>(
        `select count(*)::int as n from (select 1 from ${table} group by ${expr} having count(*) > 1) d`,
      );
      if (rows[0]!.n > 0) doublons.push(`${table} (${cle.join(", ")}) : ${rows[0]!.n}`);
    }
    assert.deepEqual(doublons, []);
  });

  it("aucune fonction ne recopie le corps d'une autre", async () => {
    const rows = await q<{ fns: string }>(`
      with f as (${NOS_FONCTIONS})
      select string_agg(fn, ' = ' order by fn) as fns from f
       group by md5(regexp_replace(prosrc, '\\s+', ' ', 'g')) having count(*) > 1`);
    assert.deepEqual(
      rows.map((r) => r.fns),
      [],
    );
  });

  it("une table de paramétrage a ses lecteurs nommés : une résolution, un endroit", async () => {
    /*
     * La même règle écrite deux fois est la forme la plus coûteuse du doublon :
     * les deux copies divergent un jour, et chacune a raison chez elle. Une
     * table de paramétrage (`parametrage.*`) est ce que le cabinet a arrêté
     * au-dessus du pack (R10) ; chaque fonction et chaque fichier qui la lit
     * est nommé, et un lecteur de plus passe par la revue.
     */
    const tables = await q<{ nom: string }>(`
      select n.nspname || '.' || c.relname as nom
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'parametrage' and c.relkind in ('r', 'p') order by 1`);
    const fonctions = await q<{ fn: string; prosrc: string }>(`
      with f as (${NOS_FONCTIONS}) select fn, prosrc from f`);
    const releve: string[] = [];
    for (const { nom } of tables) {
      const vue = nom.replace(".", "_") + "_v";
      const motif = new RegExp(`\\b(${nom.replace(".", "\\.")}|${vue})\\b`);
      for (const f of fonctions) if (motif.test(f.prosrc)) releve.push(`${nom} :: ${f.fn}`);
      for (const [fichier, texte] of TEXTES)
        if (motif.test(sansCommentaires(texte))) releve.push(`${nom} :: ${fichier}`);
    }
    egalALInstantane(
      "lecteurs des tables de paramétrage",
      [...new Set(releve)],
      Object.entries(VERROU.lecteurs_du_parametrage).flatMap(([t, ls]) =>
        ls.map((l) => `${t} :: ${l}`),
      ),
    );
  });

  /* -------------------------------------------------------------- littéraux */

  /** Les littéraux métier, relevés dans le référentiel lui-même. */
  const litterauxDuReferentiel = () =>
    q<{ valeur: string; nature: string }>(`
      select distinct account_code as valeur, 'compte' as nature
        from ref.accounts where length(account_code) >= 3
      union select code, 'devise' from ref.devises
      union select distinct rtrim(rtrim(rate::text, '0'), '.'), 'taux'
        from ref.tva_rates where rate > 0`);

  it("aucune fonction n'écrit en dur un compte, une devise ou un taux du référentiel", async () => {
    const litteraux = await litterauxDuReferentiel();
    const fonctions = await q<{ fn: string; prosrc: string }>(`
      with f as (${NOS_FONCTIONS}) select fn, prosrc from f`);
    const constats: string[] = [];
    for (const f of fonctions) {
      const corps = f.prosrc.replace(/--.*$/gm, " ");
      for (const { valeur, nature } of litteraux) {
        const motif =
          nature === "taux"
            ? new RegExp(`(?<![\\d.])${valeur.replace(".", "\\.")}(?![\\d])`)
            : new RegExp(`'${valeur}'`);
        if (motif.test(corps)) constats.push(`${f.fn} : ${nature} ${valeur}`);
      }
    }
    assert.deepEqual(constats, []);
  });

  it("aucun fichier n'écrit en dur un compte, une devise ou un taux du référentiel", async () => {
    const litteraux = await litterauxDuReferentiel();
    const releve: string[] = [];
    for (const [fichier, texte] of TEXTES) {
      const code = sansCommentaires(texte);
      const compte = new Map<string, number>();
      for (const { valeur, nature } of litteraux) {
        // Un taux se juge sur une ligne qui parle de taux : une coordonnée
        // (0.19 d'une page) n'en est pas un. Un attribut JSX (`y="262"`) n'est
        // pas un compte.
        const motif =
          nature === "taux"
            ? new RegExp(
                `^.*(taux|rate|tva|vat).*(?<![\\w.])${valeur.replace(".", "\\.")}(?![\\d]).*$`,
                "gim",
              )
            : new RegExp(`(?<!=)["'\`]${valeur}["'\`]`, "g");
        const n = [...code.matchAll(motif)].length;
        if (n) compte.set(`${nature} ${valeur}`, n);
      }
      for (const [l, n] of compte) releve.push(`${fichier} :: ${l} ×${n}`);
    }
    egalALInstantane(
      "littéraux métier dans le code",
      releve,
      Object.entries(VERROU.litteraux_metier).flatMap(([f, { litteraux }]) =>
        Object.entries(litteraux).map(([l, n]) => `${f} :: ${l} ×${n}`),
      ),
    );
  });
});
