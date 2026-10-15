/**
 * Une parenthèse orpheline n'efface pas un montant.
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
 * On ne retire donc que les parenthèses ORPHELINES : une fermante sans
 * ouvrante ne peut pas être une notation de signe, c'est du bruit.
 *
 *   node --experimental-strip-types --test src/scan/une-parenthese-orpheline.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { candidatsMontant, normaliserMontants } from "./normaliser-montants.ts";

const P = { decimales: 3, toleranceMineure: 1 };

describe("une parenthèse orpheline n'efface pas un montant", () => {
  it("le défaut du 15 octobre : « 514,700 514,700) » se lit comme « 514,700 »", () => {
    /*
     * Pas « une seule lecture » : « 514,700 » seul en a deux — virgule
     * décimale, ou virgule des milliers — et c'est l'arithmétique de la
     * facture qui tranche, comme pour n'importe quel montant. Ce que la
     * parenthèse orpheline enlevait, c'est la possibilité MÊME de lire.
     */
    assert.deepEqual(
      candidatsMontant("514,700 514,700)", P.decimales),
      candidatsMontant("514,700", P.decimales),
    );
    assert.ok(candidatsMontant("514,700 514,700)", P.decimales).length > 0);
  });

  it("une fermante seule, collée à un nombre, est du bruit", () => {
    assert.deepEqual(
      candidatsMontant("514,700)", P.decimales).map((x) => x.mineur),
      candidatsMontant("514,700", P.decimales).map((x) => x.mineur),
    );
  });

  it("une ouvrante seule aussi", () => {
    assert.deepEqual(
      candidatsMontant("(514,700", P.decimales).map((x) => x.mineur),
      candidatsMontant("514,700", P.decimales).map((x) => x.mineur),
    );
  });

  it("une PAIRE n'est pas touchée : elle veut dire moins, et on ne devine pas", () => {
    /*
     * « (514,700) » se lit moins 514,700 en comptabilité. La chaîne ne sait
     * pas encore lire cette notation, et c'est tant mieux : la retirer en
     * silence transformerait un négatif en positif, l'erreur la plus grave
     * possible sur un montant.
     */
    assert.deepEqual(candidatsMontant("(514,700)", P.decimales), []);
  });

  it("la facture du 15 octobre se normalise, et son écriture peut se proposer", () => {
    const r = normaliserMontants(
      {
        bases: [{ ht: "514,700 514,700)", taux: "0.19" }],
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
