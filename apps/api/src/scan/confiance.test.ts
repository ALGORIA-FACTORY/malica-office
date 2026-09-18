/**
 * 3B-2 — La confiance par champ : ce que `capture.extractions.confiance_par_champ`
 * porte désormais, champ par champ, au lieu de « {} ».
 *
 *   node --experimental-strip-types --test src/scan/confiance.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { confianceParChamp } from "./confiance.ts";

const jeton = (ordinal: number, confidence: number | null) => ({ page: 1, ordinal, confidence });

describe("la confiance par champ", () => {
  it("le plus faible de ses jetons, borné par la confiance de la désignation", () => {
    const c = confianceParChamp(
      [
        { field: "totals.ttc", page: 1, ordinal: 1 },
        { field: "totals.ttc", page: 1, ordinal: 2 },
        { field: "references.numero", page: 1, ordinal: 3 },
      ],
      [jeton(1, 0.98), jeton(2, 0.62), jeton(3, 0.99)],
      0.9,
    );
    assert.deepEqual(c, { "totals.ttc": 0.62, "references.numero": 0.9 });
  });

  it("un jeton sans confiance propre (couche de texte d'un PDF) n'abaisse rien", () => {
    const c = confianceParChamp([{ field: "issuer", page: 1, ordinal: 1 }], [jeton(1, null)], 0.8);
    assert.deepEqual(c, { issuer: 0.8 });
  });

  it("une citation sans jeton correspondant ne fabrique pas de confiance", () => {
    const c = confianceParChamp([{ field: "issuer", page: 1, ordinal: 9 }], [jeton(1, 0.9)], 0.8);
    assert.deepEqual(c, {});
  });

  it("toujours entre 0 et 1 : ce que la contrainte de la base exige", () => {
    const c = confianceParChamp([{ field: "x", page: 1, ordinal: 1 }], [jeton(1, 1.4)], 1.2);
    assert.deepEqual(c, { x: 1 });
  });
});
