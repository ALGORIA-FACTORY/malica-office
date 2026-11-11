/**
 * Une ligne vaut quantité × prix, et les lignes font la base : en entiers exacts,
 * à la tolérance d'arrondi près. Les décimales de la devise viennent de l'appelant.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { lignesQuiNeTiennentPas } from "./coherence-des-lignes.ts";

const ligne = (quantity: string, unit_price_ht: string, total_ht: string) => ({
  designation: "x",
  quantity,
  unit_price_ht,
  total_ht,
});
const piece = [ligne("200", "25.000", "5000.000"), ligne("20", "500.000", "10000.000")];

describe("les lignes d'une facture tiennent, ou le disent", () => {
  it("la pièce type tient : 200 × 25 + 20 × 500 = 15000", () => {
    assert.deepEqual(lignesQuiNeTiennentPas(piece, "15000.000", 3, 1), []);
  });

  it("une ligne dont le montant ne suit pas son prix se nomme", () => {
    const fausse = [ligne("200", "25.000", "5100.000"), piece[1]!];
    assert.deepEqual(lignesQuiNeTiennentPas(fausse, "15100.000", 3, 1), ["articles[0].total_ht"]);
  });

  it("des lignes qui ne font pas la base nomment la base", () => {
    assert.deepEqual(lignesQuiNeTiennentPas(piece, "14000.000", 3, 1), ["totals.base_ht"]);
  });

  it("l'arrondi d'une quantité fractionnaire est toléré à l'unité mineure près", () => {
    // 3,333 × 0,300 = 0,9999 → 1,000 à trois décimales.
    assert.deepEqual(lignesQuiNeTiennentPas([ligne("3.333", "0.300", "1.000")], "1.000", 3, 1), []);
    assert.deepEqual(lignesQuiNeTiennentPas([ligne("3.333", "0.300", "1.002")], "1.002", 3, 1), [
      "articles[0].total_ht",
    ]);
  });

  it("une égalité qu'on ne peut pas poser n'est pas posée", () => {
    const sansPrix = [{ designation: "x", quantity: "2", unit_price_ht: null, total_ht: "10.000" }];
    assert.deepEqual(lignesQuiNeTiennentPas(sansPrix, "10.000", 3, 1), []);
    assert.deepEqual(lignesQuiNeTiennentPas(piece, null, 3, 1), []);
    assert.deepEqual(lignesQuiNeTiennentPas([], "10.000", 3, 1), []);
  });

  it("les décimales sont celles de la devise : deux décimales, un prix à deux décimales", () => {
    assert.deepEqual(lignesQuiNeTiennentPas([ligne("3", "19.99", "59.97")], "59.97", 2, 1), []);
    assert.deepEqual(lignesQuiNeTiennentPas([ligne("3", "19.99", "60.00")], "60.00", 2, 1), [
      "articles[0].total_ht",
    ]);
  });
});
