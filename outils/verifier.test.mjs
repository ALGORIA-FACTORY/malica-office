/**
 * La porte locale (`npm run verifier`) lance tout ce que le job « atelier » de la
 * CI lance. Sinon, « vert sur le poste » ne dit rien de la CI.
 *
 * Trouvé le 17 septembre 2026 : la porte ne lançait pas knip. Une dépendance
 * installée par un espace de travail mais importée depuis `outils/`, sans être
 * déclarée à la racine, passait la porte et cassait la CI (27beb39, « Code
 * mort »). knip, lancé à la main, le voyait du premier coup.
 *
 *   node --test outils/verifier.test.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const lire = (chemin) => readFileSync(new URL(`../${chemin}`, import.meta.url), "utf8");

/** Les commandes `run:` d'une ligne du job `atelier` de ci.yml. */
function commandesAtelier() {
  const ci = lire(".github/workflows/ci.yml");
  const debut = ci.indexOf("\n  atelier:");
  assert.ok(debut >= 0, "job atelier introuvable dans ci.yml");
  const suite = ci.slice(debut + 1);
  const fin = suite.search(/\n  [a-z][\w-]*:\n/);
  const job = fin >= 0 ? suite.slice(0, fin) : suite;
  return [...job.matchAll(/^\s+run: (.+)$/gm)]
    .map((m) => m[1].trim())
    .filter((c) => c !== "npm ci");
}

test("la porte locale lance chaque commande du job atelier de la CI", () => {
  const porte = lire("outils/verifier.mjs");
  const testsRacine = JSON.parse(lire("package.json")).scripts.test;
  const commandes = commandesAtelier();
  assert.ok(commandes.length >= 4, `commandes lues : ${commandes.join(" ; ")}`);
  const absentes = commandes.filter(
    (c) => !porte.includes(`"${c}"`) && !testsRacine.includes(c.replace(/^node --test /, "")),
  );
  assert.deepEqual(absentes, [], "commandes de la CI que la porte ne lance pas");
});
