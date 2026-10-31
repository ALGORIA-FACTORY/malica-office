/**
 * L'arithmétique du jeu synthétique, éprouvée seule : c'est elle qui écrit les
 * valeurs et les écritures attendues, donc une faute ici serait une faute de
 * l'étalon, invisible au banc.
 *
 *   node --test outils/jeu-synthetique/montants.test.mjs
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { enLettres, imprimer, multiplier, versDecimal, versMineur } from "./montants.mjs";

describe("les montants du jeu synthétique", () => {
  it("passent du décimal à l'unité mineure et retour, sans flottant", () => {
    assert.equal(versMineur("1234.567", 3), 1234567n);
    assert.equal(versMineur("12.5", 3), 12500n);
    assert.equal(versDecimal(1234567n, 3), "1234.567");
    assert.equal(versDecimal(5n, 3), "0.005");
    assert.equal(versDecimal(-1500n, 2), "-15.00");
  });

  it("arrondissent au plus proche, à égalité vers le haut ou au pair", () => {
    // 1 000,005 × 19 % = 190,00095 → 190,001.
    assert.equal(multiplier(1000005n, "0.19"), 190001n);
    // Le demi exact : 2,5 → 3 (commercial), 2 (au pair).
    assert.equal(multiplier(25n, "0.1"), 3n);
    assert.equal(multiplier(25n, "0.1", { pair: true }), 2n);
    assert.equal(multiplier(35n, "0.1", { pair: true }), 4n);
    // Le cas de la mesure des propositions : 333,33 $ × 3,0125 = 1 004,1566… → 1 004,157.
    assert.equal(multiplier(333330n, "3.0125", { pair: true }), 1004157n);
  });

  it("s'impriment comme une facture les imprime", () => {
    const f = (milliers, decimal, chiffres = "latins") => ({ milliers, decimal, chiffres });
    assert.equal(imprimer(1234567n, 3, f(" ", ",")), "1 234,567");
    assert.equal(imprimer(1234567n, 3, f(".", ",")), "1.234,567");
    assert.equal(imprimer(123456789n, 2, f(",", ".")), "1,234,567.89");
    assert.equal(imprimer(1000n, 3, f("", ",")), "1,000");
    assert.equal(imprimer(1234567n, 3, f(" ", ",", "orientaux")), "١ ٢٣٤,٥٦٧");
  });

  it("s'écrivent en toutes lettres, à la française", () => {
    assert.equal(enLettres(1), "un");
    assert.equal(enLettres(21), "vingt et un");
    assert.equal(enLettres(71), "soixante et onze");
    assert.equal(enLettres(80), "quatre-vingts");
    assert.equal(enLettres(81), "quatre-vingt-un");
    assert.equal(enLettres(99), "quatre-vingt-dix-neuf");
    assert.equal(enLettres(200), "deux cents");
    assert.equal(enLettres(201), "deux cent un");
    assert.equal(enLettres(1000), "mille");
    assert.equal(enLettres(80000), "quatre-vingt mille");
    assert.equal(enLettres(200000), "deux cent mille");
    assert.equal(enLettres(3594), "trois mille cinq cent quatre-vingt-quatorze");
    assert.equal(enLettres(2_000_000), "deux millions");
  });
});
