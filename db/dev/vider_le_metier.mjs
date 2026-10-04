/**
 * Vider le métier — repartir à blanc pour un essai en réel.
 *
 * Ce que l'outil efface : tout ce qui appartient à un tenant. Les pièces et
 * leurs lectures, les dossiers, les mandats, les honoraires, les écritures, les
 * comptes et les organisations. Après lui, la base ne connaît plus personne.
 *
 * Ce qu'il GARDE, et pourquoi :
 *
 *   ref.*                  le paramétrage daté — taux de TVA, charges, packs,
 *                          plans de comptes, modèles d'écriture. Il ne vient
 *                          d'aucun client : l'effacer casserait R11.
 *   legal.*                le corpus juridique — 11 440 articles, 31 863
 *                          fragments vectorisés. Des semaines d'ingestion, rien
 *                          à voir avec un tenant.
 *   agents.model_pricing   le tarif daté des modèles. R8 : le modèle vient de
 *                          la table qui le tarife, jamais d'une constante.
 *   storage.buckets        la déclaration des seaux, pas leur contenu.
 *   app.migrations         l'état du schéma. L'effacer rejouerait tout.
 *
 * Les déclencheurs d'inaltérabilité (R7) refusent la suppression d'une pièce
 * transmise ou d'une écriture figée — c'est leur raison d'être. On ne les
 * contourne pas en les supprimant : on pose `session_replication_role` à
 * `replica` le temps du vidage, ce que seul un superutilisateur peut faire, et
 * la session se referme aussitôt après.
 *
 *   node db/dev/vider_le_metier.mjs            # dit ce qu'il ferait
 *   node db/dev/vider_le_metier.mjs --vider    # le fait
 *
 * L'outil refuse toute base qui n'est pas sur localhost : un vidage ne part pas
 * en voyage.
 */
import { readFileSync } from "node:fs";
import pg from "pg";

const ENV = Object.fromEntries(
  readFileSync(new URL("../../apps/api/.env", import.meta.url), "utf8")
    .split(/\r?\n/)
    .map((l) => /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(l))
    .filter(Boolean)
    .map((m) => [m[1], m[2].trim()]),
);

const URL_BASE = ENV["DATABASE_URL_ADMIN"];
if (!URL_BASE) throw new Error("DATABASE_URL_ADMIN absente de apps/api/.env");
const hote = new URL(URL_BASE.replace(/^postgres(ql)?:/, "http:")).hostname;
if (!["localhost", "127.0.0.1", "::1"].includes(hote)) {
  throw new Error(`refus : la base n'est pas locale (${hote})`);
}

/** Les schémas dont tout le contenu appartient à un tenant. */
const SCHEMAS_METIER = [
  "agents",
  "audit",
  "auth",
  "banque",
  "billing",
  "capture",
  "catalog",
  "coffre",
  "collab",
  "commissions",
  "contracts",
  "identity",
  "immo",
  "parametrage",
  "payments",
  "pricing",
  "schedule",
  "socle",
  "stocks",
  "storage",
  "tiers",
];

/** Les tables de référence qui vivent dans un schéma métier. */
const EPARGNEES = new Set(["agents.model_pricing", "storage.buckets"]);

const faire = process.argv.includes("--vider");
const client = new pg.Client({ connectionString: URL_BASE });
await client.connect();

const { rows: tables } = await client.query(
  `select table_schema s, table_name n
     from information_schema.tables
    where table_type = 'BASE TABLE'
      and (table_schema = any($1) or (table_schema = 'app' and table_name = 'platform_operators'))
    order by 1, 2`,
  [SCHEMAS_METIER],
);

const cibles = [];
for (const { s, n } of tables) {
  const q = `${s}.${n}`;
  if (EPARGNEES.has(q)) continue;
  const { rows } = await client.query(`select count(*)::int n from "${s}"."${n}"`);
  cibles.push({ q, avant: rows[0].n });
}

const pleines = cibles.filter((c) => c.avant > 0);
const total = pleines.reduce((s, c) => s + c.avant, 0);

process.stdout.write(`\n${cibles.length} tables de métier · ${total} lignes à effacer\n\n`);
for (const c of pleines) process.stdout.write(`  ${String(c.avant).padStart(6)}  ${c.q}\n`);

if (!faire) {
  process.stdout.write("\n(rien n'a été touché — relancez avec --vider)\n");
  await client.end();
  process.exit(0);
}

await client.query("begin");
await client.query("set local session_replication_role = replica");
await client.query(
  `truncate ${cibles.map((c) => `"${c.q.split(".")[0]}"."${c.q.split(".")[1]}"`).join(", ")} restart identity cascade`,
);
await client.query("commit");

let reste = 0;
for (const c of cibles) {
  const { rows } = await client.query(
    `select count(*)::int n from "${c.q.split(".")[0]}"."${c.q.split(".")[1]}"`,
  );
  reste += rows[0].n;
}

const garde = [];
for (const [s, n] of [
  ["ref", "tva_rates"],
  ["ref", "fiscal_parameters"],
  ["legal", "articles"],
  ["legal", "chunks"],
  ["agents", "model_pricing"],
  ["app", "migrations"],
]) {
  const { rows } = await client.query(`select count(*)::int n from "${s}"."${n}"`);
  garde.push(`${s}.${n} = ${rows[0].n}`);
}

process.stdout.write(`\nvidé : ${total} lignes · reste ${reste}\n`);
process.stdout.write(`gardé : ${garde.join(" · ")}\n`);
await client.end();
