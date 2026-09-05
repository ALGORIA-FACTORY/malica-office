/**
 * La conversion des numériques ne passe pas par un flottant.
 *
 * Le cas qui compte : un montant à trois décimales au-delà de ce qu'un
 * double représente exactement. `Number(v).toFixed(3)` le déformait ; le
 * cadrage en entiers le garde tel quel.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { dec, decOuNul } from "./decimal.ts";

describe("dec", () => {
  it("cadre une chaîne de la base à trois décimales", () => {
    assert.equal(dec("0.190000"), "0.190");
    assert.equal(dec("1428"), "1428.000");
    assert.equal(dec("12.5"), "12.500");
    assert.equal(dec(".5"), "0.500");
    assert.equal(dec("-3.1"), "-3.100");
  });

  it("arrondit en entiers, demi vers le haut", () => {
    assert.equal(dec("2.0005"), "2.001");
    assert.equal(dec("2.0004"), "2.000");
    assert.equal(dec("0.19005", 4), "0.1901");
    assert.equal(dec("7", 0), "7");
    assert.equal(dec("7.5", 0), "8");
  });

  it("garde exact un montant que le flottant déformerait", () => {
    const enorme = "123456789012345678.905";
    assert.equal(dec(enorme), enorme);
    assert.notEqual(Number(enorme).toFixed(3), enorme);
  });

  it("ne rend jamais « -0.000 »", () => {
    assert.equal(dec("-0.0001"), "0.000");
  });

  it("accepte un nombre JavaScript sans notation savante", () => {
    assert.equal(dec(3), "3.000");
    assert.equal(dec(0.1), "0.100");
    assert.equal(dec(1e-7), "0.000");
  });

  it("refuse ce qui n'est pas une écriture décimale", () => {
    assert.throws(() => dec("abc"));
    assert.throws(() => dec(""));
    assert.throws(() => dec(Number.NaN));
  });

  it("l'absence vaut zéro pour dec, null pour decOuNul", () => {
    assert.equal(dec(null), "0.000");
    assert.equal(dec(undefined, 2), "0.00");
    assert.equal(decOuNul(null), null);
    assert.equal(decOuNul("4.2"), "4.200");
  });
});
