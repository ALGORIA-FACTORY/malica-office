/**
 * Les chiffres de TVA du PV (revue de #145) : aucun montant publié quand
 * aucune pièce n'a été comptée, et seules les pièces dont l'extrait ne se lit
 * pas sont « hors du calcul ».
 *
 *   node --experimental-strip-types --test src/malica/pv/la-tva-du-pv.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { tvaDesExtraits } from "@malica/socle/engines/tva/des-extraits";
import type { DeclarationTva } from "@malica/socle/ports/repositories";

import { chiffresDeLaTva } from "./rediger.ts";

const declaration: DeclarationTva = {
  natureParDefaut: "AUTRE",
  natures: [{ code: "AUTRE", label: "Autre" }],
  affectations: [
    { sens: "collectee", nature: "AUTRE", ligne: "C", origine: "pack", decideLe: null },
    { sens: "deductible", nature: "AUTRE", ligne: "D", origine: "pack", decideLe: null },
  ],
  lignes: [
    { code: "C", label: "C", sens: "collectee", nature: null, ordinal: 1, incertain: true },
    { code: "D", label: "D", sens: "deductible", nature: null, ordinal: 2, incertain: true },
  ],
};
const taux = [
  {
    code: "TVA19",
    label: "TVA19",
    rate: "0.190",
    validFrom: "2020-01-01",
    validTo: null,
    jurisdiction: "TN",
  },
];
const extrait = (code: string) => ({
  contract: "extract.v1",
  issuer: "FOURNISSEUR D'ESSAI",
  document_date: "2026-10-30",
  currency: "TND",
  document_kind: "facture_achat",
  lines: [
    { label: code, tax_code: code, base_ht: "100.000", vat_amount: "19.000", ttc: "119.000" },
  ],
  totals: { base_ht: "100.000", vat: "19.000", ttc: "119.000" },
});
const chiffres = (rows: Array<{ pieceId: string; extract: unknown }>) =>
  chiffresDeLaTva(
    tvaDesExtraits({
      period: "2026-10",
      currency: { code: "TND", decimals: 3 },
      taux,
      declaration,
      rows,
    }),
    rows.length,
    "TND",
  ).map((c) => [c.label, c.valeur]);

describe("la TVA du PV", () => {
  it("rien de compté : aucun montant de TVA, seulement les pièces hors du calcul", () => {
    assert.deepEqual(chiffres([{ pieceId: "x", extract: { contract: "extract.v1" } }]), [
      ["tvaHorsCalcul", "1"],
    ]);
  });

  it("une ligne sans taux ne fait pas une pièce hors du calcul", () => {
    assert.deepEqual(
      chiffres([
        { pieceId: "a", extract: extrait("TVA19") },
        { pieceId: "b", extract: extrait("INCONNU") },
      ]),
      [
        ["tvaCollectee", "0.000"],
        ["tvaDeductible", "19.000"],
        ["tva", "-19.000"],
      ],
    );
  });

  it("des pièces comptées et une illisible : les montants, et une pièce hors du calcul", () => {
    assert.deepEqual(
      chiffres([
        { pieceId: "a", extract: extrait("TVA19") },
        { pieceId: "z", extract: { contract: "extract.v1" } },
      ]),
      [
        ["tvaCollectee", "0.000"],
        ["tvaDeductible", "19.000"],
        ["tva", "-19.000"],
        ["tvaHorsCalcul", "1"],
      ],
    );
  });
});
