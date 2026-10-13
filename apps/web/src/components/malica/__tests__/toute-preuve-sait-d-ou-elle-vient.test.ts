// @vitest-environment node
/**
 * Dans cet écran, tout dépôt de pièce dit de quelle facture il vient.
 *
 * ================================================= LE DÉFAUT QUI L'A FAIT NAÎTRE
 *
 * 13 octobre 2026. Le talon de chèque photographié pour prouver un paiement
 * apparaissait comme un document flottant : dans la liste de la PME et dans
 * celle du cabinet, sous « pas encore classés », avec « Émetteur non trouvé ».
 *
 * La cause n'était pas une valeur fausse, c'était une absence :
 * `photographierLaPreuve` ne passait pas `sourcePieceId`, quand `recu`, cent
 * quarante lignes plus bas dans le MÊME fichier, le passait. Et comme les deux
 * étages de la file écrivent `?? null`, rien ne levait : la pièce naissait
 * orpheline, en silence.
 *
 * ======================================== POURQUOI UNE ÉPREUVE QUI LIT LE CODE
 *
 * Aucune épreuve ordinaire ne pouvait voir ce défaut. La fonction SQL est
 * juste et elle est éprouvée (`une-piece-sait-d-ou-elle-vient.test.ts`) ; le
 * port est juste ; la file est juste. Ce qui manquait, c'était un argument
 * dans un objet littéral — et un argument absent ne casse ni la compilation
 * (la propriété est optionnelle, et elle doit le rester : toutes les pièces
 * ne dérivent pas d'une autre) ni aucun appel.
 *
 * Alors on lit le code. Dans CE composant, et dans celui-là seulement, tout
 * ce qu'on dépose naît d'une facture affichée à l'écran : un talon, un reçu.
 * Un dépôt sans parent y est forcément une étourderie.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/** Le chemin part du dossier de travail de Vitest, c'est-à-dire `apps/web`. */
const FICHIER = resolve(process.cwd(), "src/components/malica/comment-c-est-paye.tsx");

/** Le code, commentaires retirés — un exemple en commentaire ne prouve rien. */
function sansCommentaires(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((ligne) => !/^\s*\/\//.test(ligne))
    .join("\n");
}

describe("toute preuve déposée sait de quelle facture elle vient", () => {
  it("chaque dépôt de cet écran porte `sourcePieceId`", () => {
    const code = sansCommentaires(readFileSync(FICHIER, "utf8"));
    const depots = code.split("vidage().deposer(").slice(1);

    // Deux dépôts aujourd'hui : le justificatif et le reçu. Si ce nombre
    // change, c'est qu'un troisième est né — et il doit passer ici aussi.
    expect(depots.length).toBeGreaterThanOrEqual(2);

    for (const [index, apres] of depots.entries()) {
      // L'objet déposé s'arrête à sa première accolade fermante en début de
      // ligne ; au-delà, on lirait le dépôt suivant.
      const objet = apres.split(/\n\s{0,6}\},/)[0] ?? apres.slice(0, 800);
      expect(objet, `le dépôt n° ${index + 1} ne porte pas sourcePieceId`).toMatch(
        /sourcePieceId\s*:/,
      );
    }
  });
});
