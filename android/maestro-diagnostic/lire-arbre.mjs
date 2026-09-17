// Diagnostic D25 — lit les arbres d'accessibilité relevés par `maestro hierarchy`
// et les écrit côte à côte dans le journal : ce que lit un lecteur d'écran, pas
// ce que montre une capture.
//
//   node android/maestro-diagnostic/lire-arbre.mjs <screen-hierarchy/*.json> …
import { readFileSync } from "node:fs";

const TEMOINS = {
  fond: ["Vos documents", "Crédit de TVA", "Navigation principale"],
  fil: ["Fermer le fil de Malica", "Conversation en cours"],
  bandeau: ["Hors ligne"],
};

for (const fichier of process.argv.slice(2)) {
  console.log(`\n=== ${fichier}`);
  let brut;
  try {
    brut = readFileSync(fichier, "utf8");
  } catch {
    console.log("  (absent)");
    continue;
  }
  const debut = brut.indexOf("{");
  let arbre;
  try {
    arbre = JSON.parse(brut.slice(debut));
  } catch (e) {
    console.log(`  (illisible : ${e.message}) ${brut.slice(0, 300)}`);
    continue;
  }
  const noeuds = [];
  (function parcourir(n) {
    const a = n.attributes ?? {};
    const libelle = [a.text, a.accessibilityText, a.hintText].filter(Boolean).join(" / ");
    if (libelle) noeuds.push(libelle);
    for (const e of n.children ?? []) parcourir(e);
  })(arbre);
  console.log(`  ${noeuds.length} nœuds nommés`);
  for (const l of noeuds) console.log(`  · ${l}`);
  const tout = noeuds.join("\n").toLowerCase();
  for (const [groupe, textes] of Object.entries(TEMOINS)) {
    const vus = textes.map((t) => `${t} : ${tout.includes(t.toLowerCase()) ? "LU" : "absent"}`);
    console.log(`  [${groupe}] ${vus.join(" | ")}`);
  }
}
