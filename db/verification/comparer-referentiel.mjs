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
 * ============================================================== COMMENT
 *
 * Pour chaque table : le nombre de lignes, et une empreinte du contenu. Les
 * colonnes que chaque chargement fabrique à neuf n'entrent pas dans
 * l'empreinte — sinon tout différerait sans que rien n'ait changé :
 *   - les UUID (`gen_random_uuid()`, dont les clés du pack que les autres
 *     tables reprennent) ;
 *   - les horodatages ;
 *   - toute colonne dont le défaut est l'heure ou la date du chargement.
 * Les lignes sont comparées comme des multiensembles : une ligne en double
 * d'un côté compte.
 *
 * Lecture seule des deux côtés (transactions `READ ONLY`). Aucune URL affichée.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SORTIE = join(RACINE, "docs", "verification-referentiel.md");

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
    `select column_name as nom, data_type as type, coalesce(column_default, '') as defaut
       from information_schema.columns where table_schema = $1 and table_name = $2
      order by ordinal_position`,
    [s, t],
  );
  return rows;
}

const fabriquee = (col) =>
  col.type === "uuid" ||
  col.type.startsWith("timestamp") ||
  /now\(\)|current_date|current_timestamp|clock_timestamp/i.test(col.defaut);

async function lignes(c, s, t, cols) {
  if (cols.length === 0) {
    const { rows } = await c.query(`select count(*)::int as n from "${s}"."${t}"`);
    return Array.from({ length: rows[0].n }, () => "{}");
  }
  const liste = cols.map((x) => `"${x}"`).join(", ");
  const { rows } = await c.query(`select ${liste} from "${s}"."${t}"`);
  return rows.map((r) => JSON.stringify(cols.map((x) => r[x])));
}

const compter = (arr) => arr.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map());
const empreinte = (arr) =>
  createHash("sha256")
    .update([...arr].sort().join("\n"))
    .digest("hex")
    .slice(0, 12);

const tables = [...(await tablesDe(vierge)), ...HORS_REF];
const tablesTravail = new Set((await tablesDe(travail)).map(([s, t]) => `${s}.${t}`));

const resultats = [];
for (const [s, t] of tables) {
  const colsV = await colonnesDe(vierge, s, t);
  const colsT = await colonnesDe(travail, s, t);
  const nomsV = colsV.map((c) => c.nom).join(",");
  const nomsT = colsT.map((c) => c.nom).join(",");
  const comparees = colsV.filter((c) => !fabriquee(c)).map((c) => c.nom);
  const exclues = colsV.filter(fabriquee).map((c) => c.nom);
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
    presenteEnTravail: s !== "ref" || tablesTravail.has(`${s}.${t}`),
    memesColonnes: nomsV === nomsT,
    comparees,
    exclues,
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

const ecarts = resultats.filter((r) => r.enPlus.length || r.enMoins.length || !r.memesColonnes);
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
  `**${resultats.length} tables comparées, ${ecarts.length} en écart.** ` +
    (ecarts.length === 0
      ? "Le référentiel de la base de travail est exactement celui que produisent les migrations."
      : "Chaque écart est détaillé plus bas ; tant qu'il n'est pas expliqué, la table n'est préservée que sous réserve."),
);
p();
p(
  "Colonnes exclues de l'empreinte, parce que chaque chargement les fabrique à neuf : les UUID, les horodatages, et toute colonne dont le défaut est la date ou l'heure du chargement.",
);
p();
p(
  "| Table | Lignes (travail) | Lignes (vierge) | Empreinte (travail) | Empreinte (vierge) | En plus | En moins |",
);
p("| --- | ---: | ---: | --- | --- | ---: | ---: |");
for (const r of resultats) {
  const marque = r.enPlus.length || r.enMoins.length || !r.memesColonnes ? " **≠**" : "";
  p(
    `| \`${r.table}\`${marque} | ${n(r.nTravail)} | ${n(r.nVierge)} | \`${r.eTravail}\` | \`${r.eVierge}\` | ${r.enPlus.length} | ${r.enMoins.length} |`,
  );
}
p();

if (ecarts.length) {
  p("## Les écarts, ligne par ligne");
  p();
  for (const r of ecarts) {
    p(`### \`${r.table}\``);
    p();
    if (!r.memesColonnes) p("**Les colonnes diffèrent entre les deux bases.**\n");
    p(`Colonnes comparées : ${r.comparees.map((c) => `\`${c}\``).join(", ") || "(aucune)"}.`);
    if (r.exclues.length) p(`Exclues : ${r.exclues.map((c) => `\`${c}\``).join(", ")}.`);
    p();
    for (const [titre, liste] of [
      [`En plus dans \`malica_local\` (${r.enPlus.length})`, r.enPlus],
      [`Absentes de \`malica_local\` (${r.enMoins.length})`, r.enMoins],
    ]) {
      if (!liste.length) continue;
      p(`**${titre}**`);
      p();
      p("```");
      for (const l of liste.slice(0, 25)) p(l);
      if (liste.length > 25) p(`… et ${liste.length - 25} autres`);
      p("```");
      p();
    }
  }
}

writeFileSync(SORTIE, L.join("\n"));
console.log(
  `${resultats.length} tables comparées, ${ecarts.length} en écart → docs/verification-referentiel.md`,
);
for (const r of ecarts)
  console.log(
    `  ≠ ${r.table} : ${r.nTravail} contre ${r.nVierge} · +${r.enPlus.length} / −${r.enMoins.length}`,
  );
