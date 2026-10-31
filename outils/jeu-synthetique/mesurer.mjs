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
 * Écrit `RAPPORT.md` (le tableau et les écarts, puis le diagnostic des PDF au
 * texte perdu) et `mesure.json` (l'issue de chaque cas, et son diagnostic),
 * à côté de ce fichier.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ecarts,
  LECTEUR_DU_DIAGNOSTIC,
  mesurerLeJeu,
  tableau,
} from "../../apps/api/src/malica/lecture/jeu-synthetique.ts";

const ICI = dirname(fileURLToPath(import.meta.url));

const resultats = await mesurerLeJeu();
const nonMesures = resultats.filter((r) => r.verdict === "non_mesuree");
const raisons = [...new Set(nonMesures.map((r) => r.detail))];
// Le diagnostic : les PDF au texte perdu, jugés sur leur couche telle quelle
// (`ModeDeReleve`). Rapporté à part, jamais mêlé à la mesure.
const diagnostic = (await mesurerLeJeu(undefined, "diagnostic_couche_crue")).filter(
  (r) => r.lecteur === LECTEUR_DU_DIAGNOSTIC,
);

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

## Diagnostic du Socle : les PDF au texte perdu, jugés sur leur couche telle quelle

La production relit ces ${diagnostic.length} PDF en image (glyphes sans Unicode : \`laCoucheSeCroit\`).
Sans second lecteur ici, ils ne sont pas mesurés plus haut. Ce diagnostic les juge sur leur
couche de texte telle quelle — montants, matricules et dates y sont exacts, les mots arabes
perdus — pour garder le jugement et la proposition du Socle sous mesure. Seul le titre, perdu
lui aussi, est celui que le rendu a imprimé : sans lui, le contrôle de la nature bloquerait
tout, à bon droit. Ce n'est pas une mesure de la chaîne.

${tableau(diagnostic)}

${ecarts(diagnostic) || "Aucun écart."}
`;

writeFileSync(join(ICI, "RAPPORT.md"), rapport);
writeFileSync(
  join(ICI, "mesure.json"),
  `${JSON.stringify(
    Object.fromEntries(
      resultats.map((r) => {
        const d = diagnostic.find((x) => x.id === r.id);
        return [
          r.id,
          {
            verdict: r.verdict,
            champsFaux: r.champs.faux.length,
            ...(d ? { diagnostic: { verdict: d.verdict, champsFaux: d.champs.faux.length } } : {}),
          },
        ];
      }),
    ),
    null,
    1,
  )}\n`,
);
console.log(tableau(resultats));
console.log(`\n${ecarts(resultats)}`);
