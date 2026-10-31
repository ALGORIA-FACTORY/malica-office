/**
 * Mesurer le jeu synthétique sur la vraie chaîne, et en écrire le rapport.
 *
 *   node --experimental-strip-types outils/jeu-synthetique/mesurer.mjs
 *   OCR_URL=http://127.0.0.1:8000 node --experimental-strip-types outils/jeu-synthetique/mesurer.mjs
 *
 * Sans `OCR_URL`, les images (photos, carnets) sortent « non mesurées » : le
 * second lecteur n'est pas joignable, et le modèle de vision, payant, n'est
 * jamais appelé (`sansAppelPayant`). Le rapport l'écrit en tête.
 *
 * Écrit `RAPPORT.md` (le tableau et les écarts) et `mesure.json` (l'issue de
 * chaque cas), à côté de ce fichier.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ecarts,
  mesurerLeJeu,
  tableau,
} from "../../apps/api/src/malica/lecture/jeu-synthetique.ts";

const ICI = dirname(fileURLToPath(import.meta.url));

const resultats = await mesurerLeJeu();
const nonMesures = resultats.filter((r) => r.verdict === "non_mesuree");
const raisons = [...new Set(nonMesures.map((r) => r.detail))];

const rapport = `# Mesure du jeu synthétique

Produit par \`node --experimental-strip-types outils/jeu-synthetique/mesurer.mjs\`. Ne pas
éditer à la main : relancer.

Chaîne mesurée : relevé de production (\`relever\`) → désignation ATTENDUE (désignateur
idéal, voir le README) → relecture au plan → jugement → proposition du Socle.

${nonMesures.length > 0 ? `**${nonMesures.length} cas non mesurés** : ${raisons.join(" ; ")}.\n` : ""}
## Tableau

${tableau(resultats)}

« fausses » : une écriture proposée qui n'est pas l'écriture attendue, ou une écriture
proposée là où un refus était attendu — le pire résultat. « refus mal nommés » : la pièce
est refusée, mais pas pour la raison attendue. « refus injustes » : aucune écriture,
alors qu'une écriture juste était attendue.

## Écarts

${ecarts(resultats) || "Aucun."}
`;

writeFileSync(join(ICI, "RAPPORT.md"), rapport);
writeFileSync(
  join(ICI, "mesure.json"),
  `${JSON.stringify(
    Object.fromEntries(
      resultats.map((r) => [r.id, { verdict: r.verdict, champsFaux: r.champs.faux.length }]),
    ),
    null,
    1,
  )}\n`,
);
console.log(tableau(resultats));
console.log(`\n${ecarts(resultats)}`);
