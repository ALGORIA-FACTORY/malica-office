/**
 * La rafale, en pur : une fenêtre d'une minute, par personne.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Rafale } from "./debit.ts";

describe("la rafale", () => {
  it("admet jusqu'à la borne, refuse au-delà, et rouvre quand la minute a glissé", () => {
    const r = new Rafale();
    const t0 = 1_000_000;
    for (let i = 0; i < 3; i += 1) assert.equal(r.admettre("a", 3, t0 + i), true);
    assert.equal(r.admettre("a", 3, t0 + 10), false);
    // Un refus ne se compte pas : la minute ne s'allonge pas à force d'insister.
    assert.equal(r.admettre("a", 3, t0 + 59_000), false);
    assert.equal(r.admettre("a", 3, t0 + 60_001), true);
  });

  it("compte chaque personne à part", () => {
    const r = new Rafale();
    assert.equal(r.admettre("a", 1, 1), true);
    assert.equal(r.admettre("a", 1, 2), false);
    assert.equal(r.admettre("b", 1, 2), true);
  });

  it("suit la borne du moment : abaissée dans la tour, elle vaut à l'appel suivant", () => {
    const r = new Rafale();
    assert.equal(r.admettre("a", 5, 1), true);
    assert.equal(r.admettre("a", 5, 2), true);
    assert.equal(r.admettre("a", 2, 3), false);
  });
});
