/**
 * Une parenthèse orpheline : du bruit de citation, ou un avoir coupé — le plan le dit.
 *
 * ================================================= LE DÉFAUT QUI L'A FAIT NAÎTRE
 *
 * 15 octobre 2026, 18 h 17. Le dirigeant scanne une facture d'achat. La
 * lecture est bonne : contrat complet, confiance 0,9, TTC 613,493, base
 * 514,700 — et l'arithmétique tombe juste, 514,700 + 97,793 + 1,000 = 613,493.
 *
 * Et pourtant : « Aucun montant n'est retenu — ils sont à saisir : montant
 * illisible : « 514,700 514,700) » ». Verdict « anomalie à signaler », aucune
 * écriture.
 *
 * Le plan de jetons dit tout :
 *
 *     108 | 514,700        ← le total hors taxes
 *     112 | 97,793         ← la TVA
 *     117 | (base
 *     118 | 514,700)       ← une mention entre parenthèses, sur la ligne de TVA
 *     119 | 1,000          ← le timbre
 *     124 | 613,493        ← le total TTC
 *
 * La facture imprime « (base 514,700) » à côté du taux. La désignation a
 * englobé la parenthèse fermante, et un seul caractère parasite a rendu
 * illisible un montant parfaitement lu.
 *
 * ========================================== POURQUOI LA RÈGLE DES BLOCS N'A PAS JOUÉ
 *
 * `blocsIdentiques` existe pour ce cas : deux blocs textuellement identiques
 * ne laissent qu'une valeur possible, et la rendre ne choisit rien. Mais ici
 * les blocs sont « 514,700 » et « 514,700) » — différents d'un caractère.
 *
 * ============================================= POURQUOI ON NE TOUCHE PAS AUX PAIRES
 *
 * Une parenthèse ÉQUILIBRÉE a un sens en comptabilité : « (514,700) » se lit
 * moins 514,700. Les retirer transformerait un négatif en positif, en
 * silence — l'erreur la plus grave possible sur un montant.
 *
 * On ne retirait donc que les parenthèses ORPHELINES.
 *
 * ========================================== LE 30 OCTOBRE : CE QUE FERME LA PARENTHÈSE
 *
 * Revue de la PR 144 : une orpheline n'est pas toujours du bruit. « 514,700) »
 * peut aussi être l'avoir « (514,700) » dont la citation a perdu l'ouvrante —
 * et le lire positif proposait un ACHAT. Le texte seul ne tranche pas ; le
 * plan, si. La fermante ne se retire que si elle ferme un MOT que la citation
 * a laissé dehors (« (base »), et c'est le plan de jetons qui le dit
 * (`texteDuMontantCite`), pour les deux chaînes. Sinon, rien ne se lit.
 *
 *   node --experimental-strip-types --test src/scan/une-parenthese-orpheline.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { texteDuMontantCite, type PageToken } from "../malica/lecture/token-plan.ts";

import { candidatsMontant, normaliserMontants } from "./normaliser-montants.ts";
import { deviseDEssai } from "./devise-d-essai.ts";

const P = { ...deviseDEssai(3), toleranceMineure: 1 };

/** Une ligne de la facture du 15 octobre : des jetons côte à côte, à la même hauteur. */
const ligne = (jetons: Array<[ordinal: number, texte: string]>): PageToken[] =>
  jetons.map(([ordinal, text], i) => ({
    page: 1,
    ordinal,
    text,
    x0: 0.1 + i * 0.12,
    y0: 0.6,
    x1: 0.2 + i * 0.12,
    y1: 0.615,
  }));

describe("une parenthèse orpheline", () => {
  it("le texte seul ne la lit pas : elle peut fermer un avoir", () => {
    for (const t of ["514,700)", "(514,700", "514,700 514,700)", "(514,700)"])
      assert.deepEqual(candidatsMontant(t, P), [], t);
  });

  it("le défaut du 15 octobre : la fermante de « (base 514,700) » se retire au plan", () => {
    const plan = ligne([
      [112, "97,793"],
      [117, "(base"],
      [118, "514,700)"],
    ]);
    const texte = texteDuMontantCite(plan, { page: 1, ordinal: 118 });
    assert.equal(texte, "514,700");
    assert.deepEqual(
      candidatsMontant(texte!, P).map((c) => c.mineur),
      [514_700],
    );
  });

  it("une ouvrante suivie d'un chiffre n'ouvre pas un mot : l'avoir coupé ne se lit pas", () => {
    for (const avant of ["(", "(-", "TOTAL ("]) {
      const plan = ligne([
        [10, avant],
        [11, "514,700)"],
      ]);
      const texte = texteDuMontantCite(plan, { page: 1, ordinal: 11 });
      assert.equal(texte, "514,700)", avant);
      assert.deepEqual(candidatsMontant(texte!, P), [], avant);
    }
  });

  it("une parenthèse déjà fermée avant la citation n'est pas celle qu'on cherche", () => {
    const plan = ligne([
      [10, "(base"],
      [11, "100,000)"],
      [12, "514,700)"],
    ]);
    assert.equal(texteDuMontantCite(plan, { page: 1, ordinal: 12 }), "514,700)");
  });

  it("une ouvrante sur une autre ligne ne compte pas", () => {
    const plan: PageToken[] = [
      { page: 1, ordinal: 10, text: "(base", x0: 0.1, y0: 0.5, x1: 0.2, y1: 0.515 },
      { page: 1, ordinal: 11, text: "514,700)", x0: 0.1, y0: 0.6, x1: 0.2, y1: 0.615 },
    ];
    assert.equal(texteDuMontantCite(plan, { page: 1, ordinal: 11 }), "514,700)");
  });

  it("la facture du 15 octobre, relue au plan, se normalise", () => {
    const r = normaliserMontants(
      {
        bases: [{ ht: "514,700 514,700", taux: "0.19" }],
        tva: "97,793",
        autres: [{ brut: "1,000", attendu: 1_000 }],
        ttc: "613,493",
      },
      P,
    );
    assert.equal(r.etat, "tranche", r.raison);
    assert.equal(r.montants.bases[0]!.ht, 514_700);
    assert.equal(r.montants.ttc, 613_493);
  });
});
