/**
 * Charge le corpus juridique de l'archive dans une base déjà migrée — la
 * version Node de `charger.ps1`, pour Linux et la CI.
 *
 * Même règle que le script PowerShell, et pour les mêmes raisons :
 *   - on ne charge QUE les tables du corpus (le reste du dump ferait doublon
 *     avec les migrations, qui font foi) ;
 *   - les blocs s'écrivent parents d'abord, pas dans l'ordre alphabétique du
 *     dump (sinon `article_versions` arrive avant `articles` et meurt sur sa
 *     clé étrangère) ;
 *   - le corpus se REMPLACE, il ne s'accumule pas ;
 *   - un chargement qui échoue le dit, en code de sortie non nul.
 *
 * Les fragments et leurs empreintes ne sont pas dans l'archive : ils se
 * produisent ensuite avec `bun db/corpus/vectoriser.mjs` (appel payant, à
 * l'encodeur que désigne `agents.model_pricing`).
 *
 *   node db/corpus/charger-depuis-l-archive.mjs postgres://postgres:…@localhost:5432/malica
 *
 * `psql` doit être sur le PATH. L'adresse passe en argument ou par
 * DATABASE_URL_ADMIN ; elle n'est jamais affichée.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DEPOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ARCHIVE = join(DEPOT, "docs", "Base de connaissance", "referentielmalica20260831.tar.gz");
const TABLES = [
  "legal.ingestion_queue",
  "legal.articles",
  "legal.article_versions",
  "legal.references_extraites",
];

const base = process.argv[2] ?? process.env["DATABASE_URL_ADMIN"];
if (!base) {
  console.error("adresse de la base absente (argument ou DATABASE_URL_ADMIN)");
  process.exit(2);
}

const temp = mkdtempSync(join(tmpdir(), "malica-corpus-"));
try {
  execFileSync("tar", ["-xzf", ARCHIVE, "-C", temp, "paquet/dump_referentiel.sql"]);
  const lignes = readFileSync(join(temp, "paquet", "dump_referentiel.sql"), "utf8").split("\n");

  const blocs = new Map();
  let courant = null;
  for (const l of lignes) {
    if (courant === null && l.startsWith("COPY ")) {
      const nom = l.split(" ")[1];
      if (TABLES.includes(nom)) {
        courant = nom;
        blocs.set(nom, [l]);
      }
      continue;
    }
    if (courant !== null) {
      blocs.get(courant).push(l);
      if (l === "\\.") courant = null;
    }
  }

  const sortie = [
    "begin;",
    `truncate ${TABLES.slice().reverse().join(", ")}, legal.articles_extraits cascade;`,
  ];
  for (const t of TABLES) {
    const bloc = blocs.get(t);
    if (!bloc) throw new Error(`bloc COPY absent du dump pour ${t}`);
    console.log(`  ${t} : ${bloc.length - 2} lignes`);
    sortie.push(...bloc);
  }
  sortie.push("commit;");
  const fichier = join(temp, "corpus.sql");
  writeFileSync(fichier, `${sortie.join("\n")}\n`);

  execFileSync("psql", [base, "-v", "ON_ERROR_STOP=1", "-q", "-f", fichier], { stdio: "inherit" });
  execFileSync(
    "psql",
    [
      base,
      "-c",
      "select 'articles' as quoi, count(*) from legal.articles " +
        "union all select 'versions', count(*) from legal.article_versions",
    ],
    { stdio: "inherit" },
  );
  console.log("corpus chargé.");
} catch (erreur) {
  // La transaction unique laisse la base telle qu'elle était : rien n'est vidé à moitié.
  // Le message d'un échec de psql recopie sa ligne de commande, donc
  // l'adresse de la base : on n'en dit que le code.
  const code = erreur && typeof erreur === "object" && "status" in erreur ? erreur.status : null;
  const motif =
    code !== null
      ? `code de sortie ${code}`
      : erreur instanceof Error
        ? erreur.message
        : String(erreur);
  console.error(`le chargement du corpus a échoué : ${motif}`);
  process.exitCode = 1;
} finally {
  rmSync(temp, { recursive: true, force: true });
}
