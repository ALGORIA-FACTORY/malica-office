/**
 * La porte de vérification — ce que toute session lance avant de rendre.
 *
 *   npm run verifier            # typage, lint, code mort, tests, puis les épreuves si l'app tourne
 *   npm run verifier -- --vite  # typage, lint, code mort, tests seulement
 *
 * Elle lance au moins tout ce que lance le job « atelier » de la CI
 * (verifier.test.mjs y veille) : sans knip, une dépendance importée sans être
 * déclarée passait la porte et cassait la CI (27beb39, 17 septembre 2026).
 *
 * Deux sessions travaillent dans le même dépôt : une porte unique, lisible,
 * dit si ce qui vient d'être fait a cassé quelque chose — dans son propre
 * périmètre ou dans celui de l'autre. Elle ne corrige rien ; elle nomme.
 *
 * Les épreuves parlent à l'application vivante (8080) ; sans serveur, elles
 * sont SAUTÉES et la porte le dit, plutôt que d'échouer sur une absence.
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";

const RACINE = new URL("..", import.meta.url);
const BASE = process.env["MALICA_BASE"] ?? "http://localhost:8080";
const rapide = process.argv.includes("--vite");

const etapes = [];

function lancer(nom, commande) {
  const debut = Date.now();
  process.stdout.write(`\n▶ ${nom}\n`);
  const r = spawnSync(commande, { cwd: RACINE, stdio: "inherit", shell: true });
  const ok = r.status === 0;
  etapes.push({ nom, ok, secondes: Math.round((Date.now() - debut) / 1000) });
  return ok;
}

async function appTourne() {
  try {
    const r = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(5000) });
    return r.ok;
  } catch {
    return false;
  }
}

lancer("typage (tous les espaces de travail)", "npm run typecheck");
lancer("lint", "npm run lint");
lancer("code mort (knip)", "npm run code-mort");
lancer("tests (tous les espaces de travail)", "npm run test");

if (rapide) {
  process.stdout.write("\n(épreuves sautées : --vite)\n");
} else if (!(await appTourne())) {
  process.stdout.write(
    `\n(épreuves sautées : ${BASE} ne répond pas — lancez les trois serveurs)\n`,
  );
  etapes.push({ nom: "épreuves", ok: null, secondes: 0 });
} else {
  const dossier = new URL("outils/epreuves/", RACINE);
  const fichiers = readdirSync(dossier)
    .filter((f) => f.endsWith(".mjs") && f !== "socle.mjs")
    .sort();
  for (const f of fichiers)
    lancer(`épreuve ${f.replace(/\.mjs$/, "")}`, `node outils/epreuves/${f} ${BASE}`);
  lancer("épreuve capture PME (bout en bout)", `node outils/epreuve-bout-en-bout.mjs ${BASE}`);
}

process.stdout.write("\n──────── la porte ────────\n");
for (const e of etapes) {
  const marque = e.ok === null ? "…  " : e.ok ? "OK " : "KO ";
  process.stdout.write(`${marque} ${e.nom}${e.ok === null ? " (sautée)" : ` · ${e.secondes} s`}\n`);
}
const echecs = etapes.filter((e) => e.ok === false);
process.stdout.write(
  echecs.length === 0
    ? "\nTout est vert.\n"
    : `\n${echecs.length} étape(s) rouge(s) : rien ne se rend dans cet état.\n`,
);
process.exit(echecs.length === 0 ? 0 : 1);
