/**
 * Compare le référentiel de la base de travail à celui d'une base vierge.
 *
 *   npm run base-de-test && node db/verification/comparer-referentiel.mjs
 *
 * ============================================================== POURQUOI
 *
 * `ref` porte les taux de TVA, le timbre, les seuils, le plan comptable. Une
 * ligne ajoutée à la main ou par un test s'y propagerait en silence dans toutes
 * les écritures. La seule source de vérité est `db/migrations` : une base
 * montée par elles seules (`malica_test`, juste après `npm run base-de-test`)
 * dit ce que `ref` DEVRAIT contenir. Ce script dit en quoi `malica_local`
 * s'en écarte, table par table, et l'écrit dans `docs/verification-referentiel.md`.
 *
 * ============================================================== LA RÈGLE
 *
 * Dans un comparateur, une exclusion est NOMINATIVE et JUSTIFIÉE, jamais
 * catégorielle. Toute colonne est comparée, sauf celles nommées une à une
 * dans `EXCLUES`, chacune avec sa raison. Une colonne nouvelle est donc
 * comparée par défaut : si elle diffère, elle apparaît en écart, et c'est à
 * quelqu'un de décider, nommément, de l'exclure.
 *
 * Deux versions précédentes l'ont appris à leurs dépens, le 11 septembre 2026 :
 *   - la première écartait « toute colonne dont le défaut est daté » : elle
 *     masquait `ref.rejet_motifs.valid_from`, où la date du jour où l'on joue
 *     la migration entre dans le référentiel ;
 *   - la deuxième écartait « tous les UUID et tous les horodatages » : elle
 *     masquait encore `ref.jurisdiction_packs.validated_at` et `validated_by`
 *     — qui a validé le pack, et quand : une donnée, pas un artefact — et
 *     jetait les 13 `pack_version_id`, qui se comparent très bien par la clé
 *     naturelle du pack qu'ils désignent.
 *
 * Une colonne qui désigne une autre ligne par un UUID tiré au chargement est
 * TRADUITE (`TRADUITES`) : on compare ce qu'elle désigne, pas son UUID.
 *
 * Chaque écart connu est EXPLIQUÉ nommément (`EXPLIQUES`) ; un écart qui ne
 * l'est pas est marqué « NON EXPLIQUÉ » dans le document.
 *
 * Les lignes sont comparées comme des multiensembles : une ligne en double
 * d'un côté compte. Lecture seule des deux côtés (transactions `READ ONLY`).
 * Aucune URL affichée.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SORTIE = join(RACINE, "docs", "verification-referentiel.md");

/* ------------------------------------------------ exclusions, une par une */

const CLE_TECHNIQUE =
  "clé technique : `gen_random_uuid()` à chaque chargement, ne porte aucun contenu";
const HORODATAGE = "horodatage du chargement : `now()`, ne porte aucun contenu";

const EXCLUES = {
  "agents.model_pricing.id": CLE_TECHNIQUE,
  "agents.model_pricing.created_at": HORODATAGE,
  "app.migrations.applique_le": "horodatage de l'application de la migration sur CETTE base",
  "ref.account_mappings.id": CLE_TECHNIQUE,
  "ref.accounts.id": CLE_TECHNIQUE,
  "ref.anomaly_thresholds.id": CLE_TECHNIQUE,
  "ref.charge_famille_rules.id": CLE_TECHNIQUE,
  "ref.charge_familles.id": CLE_TECHNIQUE,
  "ref.document_types.created_at": HORODATAGE,
  "ref.fiscal_charges.id": CLE_TECHNIQUE,
  "ref.fiscal_obligations.id": CLE_TECHNIQUE,
  "ref.fiscal_parameters.id": CLE_TECHNIQUE,
  "ref.immo_categories.id": CLE_TECHNIQUE,
  "ref.jurisdiction_packs.id": CLE_TECHNIQUE,
  "ref.jurisdiction_packs.created_at": HORODATAGE,
  "ref.labels.id": CLE_TECHNIQUE,
  "ref.mentions.id": CLE_TECHNIQUE,
  "ref.pack_rules.id": CLE_TECHNIQUE,
  "ref.regimes_fiscaux.id": CLE_TECHNIQUE,
  "ref.rejet_motifs.id": CLE_TECHNIQUE,
  "ref.socle_params.id": CLE_TECHNIQUE,
  "ref.stock_categories.id": CLE_TECHNIQUE,
  "ref.stock_categories.created_at": HORODATAGE,
  "ref.tva_rates.id": CLE_TECHNIQUE,
  "storage.buckets.created_at": HORODATAGE,
};

/** Colonnes qui désignent le pack par son UUID : comparées par `juridiction/version`. */
const TRADUITES = Object.fromEntries(
  [
    "ref.account_mappings",
    "ref.accounts",
    "ref.anomaly_thresholds",
    "ref.charge_famille_rules",
    "ref.charge_familles",
    "ref.fiscal_charges",
    "ref.immo_categories",
    "ref.mentions",
    "ref.pack_rules",
    "ref.role_bindings",
    "ref.socle_params",
    "ref.stock_categories",
    "ref.tva_rates",
  ].map((t) => [`${t}.pack_version_id`, "pack"]),
);

/** Les écarts connus, et pourquoi. Tout autre écart est « NON EXPLIQUÉ ». */
const EXPLIQUES = {
  "ref.rejet_motifs":
    "Forme **cachée** de R11. La table déclare `valid_from date not null default current_date` (`20260824130649`), et `20260824132104` sème les 9 motifs sans donner `valid_from` : chaque base reçoit la date du jour où elle joue la migration — le 31 août 2026 pour `malica_local`. Codes, sévérités, ordre : identiques.",
  "agents.model_pricing":
    "Forme **écrite** de R11, dans `20260826163000` : `effective_to = current_date` sur le tarif Gemini, `effective_from = current_date` sur le tarif `pdf-text`. Prix, rôles, devises : identiques. La ligne `qwen3.7-text-embedding`, cible de `legal.chunks.pricing_id`, est identique.",
};

/* ---------------------------------------------------------------- bases */

const env = (fichier) =>
  Object.fromEntries(
    readFileSync(join(RACINE, "apps", "api", fichier), "utf8")
      .split(/\r?\n/)
      .filter((l) => /^[A-Z_]+=/.test(l))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]),
  );

const nomDe = (url) => new URL(url).pathname.slice(1);
const urlTravail = env(".env").DATABASE_URL_ADMIN;
const urlVierge = env(".env.test").DATABASE_URL_ADMIN;
if (nomDe(urlVierge) !== "malica_test" || nomDe(urlTravail) === nomDe(urlVierge)) {
  console.error("Refus : il faut deux bases distinctes, dont malica_test comme témoin vierge.");
  process.exit(2);
}

/** Les tables du référentiel : tout `ref`, plus les trois tables préservées hors de `ref`. */
const HORS_REF = [
  ["agents", "model_pricing"],
  ["storage", "buckets"],
  ["app", "migrations"],
];

async function ouvrir(url) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  await c.query("begin transaction read only");
  return c;
}

const travail = await ouvrir(urlTravail);
const vierge = await ouvrir(urlVierge);

async function tablesDe(c) {
  const { rows } = await c.query(`
    select table_schema as s, table_name as t from information_schema.tables
     where table_type = 'BASE TABLE' and table_schema = 'ref' order by 1, 2`);
  return rows.map((r) => [r.s, r.t]);
}

async function colonnesDe(c, s, t) {
  const { rows } = await c.query(
    `select column_name as nom from information_schema.columns
      where table_schema = $1 and table_name = $2 order by ordinal_position`,
    [s, t],
  );
  return rows.map((r) => r.nom);
}

/** Chaque pack, par son UUID dans CETTE base → sa clé naturelle. */
async function packsDe(c) {
  const { rows } = await c.query(
    `select id::text as id, jurisdiction || '/' || version as cle from ref.jurisdiction_packs`,
  );
  return new Map(rows.map((r) => [r.id, r.cle]));
}
const packs = new Map([
  [travail, await packsDe(travail)],
  [vierge, await packsDe(vierge)],
]);

async function lignes(c, s, t, cols) {
  if (cols.length === 0) {
    const { rows } = await c.query(`select count(*)::int as n from "${s}"."${t}"`);
    return Array.from({ length: rows[0].n }, () => "{}");
  }
  const liste = cols.map((x) => `"${x}"::text as "${x}"`).join(", ");
  const { rows } = await c.query(`select ${liste} from "${s}"."${t}"`);
  const traduire = (col, v) =>
    TRADUITES[`${s}.${t}.${col}`] && v !== null
      ? `pack:${packs.get(c).get(v) ?? `INCONNU(${v})`}`
      : v;
  return rows.map((r) => JSON.stringify(cols.map((x) => traduire(x, r[x]))));
}

const compter = (arr) => arr.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map());
const empreinte = (arr) =>
  createHash("sha256")
    .update([...arr].sort().join("\n"))
    .digest("hex")
    .slice(0, 12);

const tables = [...(await tablesDe(vierge)), ...HORS_REF];

// Une exclusion ou une traduction qui ne désigne plus rien est périmée : on
// s'arrête plutôt que de laisser une liste mentir sur ce qu'elle écarte.
const toutesColonnes = new Set();
for (const [s, t] of tables)
  for (const c of await colonnesDe(vierge, s, t)) toutesColonnes.add(`${s}.${t}.${c}`);
const perimees = [...Object.keys(EXCLUES), ...Object.keys(TRADUITES)].filter(
  (k) => !toutesColonnes.has(k),
);
if (perimees.length) {
  console.error(`Refus : exclusion ou traduction périmée — ${perimees.join(", ")}`);
  process.exit(2);
}

const resultats = [];
for (const [s, t] of tables) {
  const colsV = await colonnesDe(vierge, s, t);
  const colsT = await colonnesDe(travail, s, t);
  const comparees = colsV.filter((c) => !EXCLUES[`${s}.${t}.${c}`]);
  const exclues = colsV.filter((c) => EXCLUES[`${s}.${t}.${c}`]);
  const traduites = colsV.filter((c) => TRADUITES[`${s}.${t}.${c}`]);
  const lv = await lignes(vierge, s, t, comparees);
  const lt = colsT.length ? await lignes(travail, s, t, comparees) : [];
  const cv = compter(lv);
  const ct = compter(lt);
  const enPlus = [];
  const enMoins = [];
  for (const [k, n] of ct) for (let i = 0; i < n - (cv.get(k) ?? 0); i++) enPlus.push(k);
  for (const [k, n] of cv) for (let i = 0; i < n - (ct.get(k) ?? 0); i++) enMoins.push(k);
  resultats.push({
    table: `${s}.${t}`,
    memesColonnes: colsV.join(",") === colsT.join(","),
    comparees,
    exclues,
    traduites,
    nTravail: lt.length,
    nVierge: lv.length,
    eTravail: empreinte(lt),
    eVierge: empreinte(lv),
    enPlus,
    enMoins,
  });
}
await travail.query("rollback");
await vierge.query("rollback");
await travail.end();
await vierge.end();

/* ------------------------------------------------------------ le document */

const enEcart = (r) => r.enPlus.length || r.enMoins.length || !r.memesColonnes;
const ecarts = resultats.filter(enEcart);
const nonExpliques = ecarts.filter((r) => !EXPLIQUES[r.table]);
const L = [];
const p = (s = "") => L.push(s);
const n = (x) => Number(x).toLocaleString("fr-FR").replace(/ | /g, " ");

p("# Vérification du référentiel");
p();
p(
  `Relevé du ${new Date().toISOString().slice(0, 10)} par \`db/verification/comparer-referentiel.mjs\`. ` +
    "Témoin : `malica_test`, montée par `npm run base-de-test` depuis les seules migrations du dépôt, juste avant la comparaison. " +
    "Comparée : `malica_local`. Lecture seule des deux côtés.",
);
p();
p(
  `**${resultats.length} tables comparées, ${resultats.length - ecarts.length} identiques, ${ecarts.length} en écart` +
    (ecarts.length ? `, dont ${nonExpliques.length} non expliqué(s).**` : ".**"),
);
p();
if (ecarts.length)
  p(
    nonExpliques.length
      ? "Un écart non expliqué suspend la confiance dans sa table : elle n'est préservée que sous réserve, jusqu'à ce qu'on sache d'où il vient."
      : "Chaque écart est expliqué plus bas. Les tables en écart sont préservées sous une réserve connue.",
  );
p();
p(
  "| Table | Lignes (travail) | Lignes (vierge) | Empreinte (travail) | Empreinte (vierge) | En plus | En moins |",
);
p("| --- | ---: | ---: | --- | --- | ---: | ---: |");
for (const r of resultats) {
  const marque = enEcart(r) ? (EXPLIQUES[r.table] ? " ≠ expliqué" : " **≠ NON EXPLIQUÉ**") : "";
  p(
    `| \`${r.table}\`${marque} | ${n(r.nTravail)} | ${n(r.nVierge)} | \`${r.eTravail}\` | \`${r.eVierge}\` | ${r.enPlus.length} | ${r.enMoins.length} |`,
  );
}
p();

if (ecarts.length) {
  p("## Les écarts");
  p();
  for (const r of ecarts) {
    p(`### \`${r.table}\` — ${EXPLIQUES[r.table] ? "expliqué" : "**NON EXPLIQUÉ**"}`);
    p();
    if (EXPLIQUES[r.table]) {
      p(EXPLIQUES[r.table]);
      p();
    }
    if (!r.memesColonnes) p("**Les colonnes diffèrent entre les deux bases.**\n");
    for (const [titre, liste] of [
      [`En plus dans \`malica_local\` (${r.enPlus.length})`, r.enPlus],
      [`Absentes de \`malica_local\` (${r.enMoins.length})`, r.enMoins],
    ]) {
      if (!liste.length) continue;
      p(`**${titre}**, colonnes ${r.comparees.map((c) => `\`${c}\``).join(", ")} :`);
      p();
      p("```");
      for (const l of liste.slice(0, 25)) p(l);
      if (liste.length > 25) p(`… et ${liste.length - 25} autres`);
      p("```");
      p();
    }
  }
}

p("## Ce qui n'est pas comparé, et pourquoi");
p();
p(
  "Une exclusion est nominative et justifiée : chaque colonne est nommée ci-dessous avec sa raison. Toute colonne absente de cette liste est comparée.",
);
p();
p("| Colonne exclue | Raison |");
p("| --- | --- |");
for (const [k, raison] of Object.entries(EXCLUES)) p(`| \`${k}\` | ${raison} |`);
p();
p(
  `Et ${Object.keys(TRADUITES).length} colonnes **traduites**, pas exclues : chaque \`pack_version_id\` est comparé par la clé naturelle du pack qu'il désigne (\`juridiction/version\`), puisque l'UUID du pack est tiré au chargement.`,
);
p();
p(
  "R11 (`AGENTS.md`) interdit désormais les deux formes d'écart relevées ici ; `db/reproductibilite.test.mjs` le vérifie dans `npm test`.",
);
p();

writeFileSync(SORTIE, L.join("\n"));
console.log(
  `${resultats.length} tables comparées, ${ecarts.length} en écart, ${nonExpliques.length} non expliqué(s) → docs/verification-referentiel.md`,
);
for (const r of ecarts)
  console.log(
    `  ≠ ${r.table}${EXPLIQUES[r.table] ? "" : " (NON EXPLIQUÉ)"} : ${r.nTravail} contre ${r.nVierge} · +${r.enPlus.length} / −${r.enMoins.length}`,
  );
