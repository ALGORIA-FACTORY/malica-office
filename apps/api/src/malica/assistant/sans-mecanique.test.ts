/**
 * Le filtre de la mécanique, en pur : aucune base, aucun réseau.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FiltreDeMecanique } from "./sans-mecanique.ts";

/** Le texte tel que l'écran le reçoit, les morceaux arrivant un à un. */
function filtrer(morceaux: string[]): string {
  const f = new FiltreDeMecanique();
  return morceaux.map((m) => f.passer(m)).join("") + f.vider();
}

describe("le filtre de la mécanique", () => {
  it("retire les marques de passage, même coupées entre deux morceaux", () => {
    assert.equal(
      filtrer(["Le délai est de vingt-huit jours[S", "1]. Il est réduit[S2][S1", "0] ensuite."]),
      "Le délai est de vingt-huit jours. Il est réduit ensuite.",
    );
  });

  it("coupe une conclusion écrite en clair, balise ou JSON, jusqu'à la fin du tour", () => {
    assert.equal(
      // Les sauts de ligne déjà partis restent : l'écran les rogne.
      filtrer([
        "Votre société est en bénéfice.\n\n<concl",
        "ure_reponse>\nconseil: false\n</conclure_reponse>",
      ]).trimEnd(),
      "Votre société est en bénéfice.",
    );
    const f = new FiltreDeMecanique();
    assert.equal(f.passer('La réponse. {"conseil": true, "portee": "generale"}'), "La réponse.");
    assert.equal(f.passer("Et encore du texte."), "");
    assert.equal(f.vider(), "");
  });

  it("laisse passer un crochet, un chevron ou une accolade qui n'en sont pas", () => {
    for (const texte of [
      "Remplacez [montant] et [date] dans le courriel.",
      "Si A < B, alors B > A.",
      "La formule {x} tient, et [S] seul aussi.",
      "Une phrase qui finit par [S",
    ]) {
      assert.equal(filtrer([...texte]), texte, texte);
    }
  });
});
