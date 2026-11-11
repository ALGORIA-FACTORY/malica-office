/**
 * La relecture guidée par la contradiction — ne relire que ce que l'arithmétique désigne.
 *
 * Garantit que seules les cellules des rangées d'articles sont relues, et seulement quand
 * le total est prouvé mais que les lignes ne ferment pas ; et qu'une relecture ne remplace
 * un jeton que si elle est plus sûre que lui, sans toucher au plan d'origine. La preuve
 * reste l'arithmétique du moteur : la relecture n'affirme rien d'elle-même.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SortieDuSudoku } from "@malica/sudoku";

import { avecLesRelectures, cellulesContredites } from "./relecture.ts";
import type { PageToken } from "./token-plan.ts";

const jeton = (
  ordinal: number,
  text: string,
  x0: number,
  y0: number,
  confidence = 0.8,
): PageToken => ({
  page: 1,
  ordinal,
  text,
  x0,
  y0,
  x1: x0 + 0.05,
  y1: y0 + 0.01,
  confidence,
});

// Une rangée d'en-tête chiffrée (téléphone), deux rangées d'articles, le total HT.
const plan: PageToken[] = [
  jeton(0, "71", 0.1, 0.1),
  jeton(1, "334", 0.2, 0.1),
  jeton(2, "556", 0.3, 0.1),
  jeton(3, "Clavier", 0.1, 0.3),
  jeton(4, "2", 0.5, 0.3),
  jeton(5, "44.000", 0.6, 0.3),
  jeton(6, "71.950", 0.7, 0.3),
  jeton(7, "Souris", 0.1, 0.32),
  jeton(8, "T", 0.5, 0.32),
  jeton(9, "38,000", 0.6, 0.32),
  jeton(10, "31.933", 0.7, 0.32),
  jeton(11, "105,883", 0.7, 0.4),
];

const sortie = (lignes: string, issue = "prouvee") =>
  ({
    issue,
    champs: { total_ht: { valeur: "105883", refs: [{ page: 1, ordinal: 11 }], statut: "prouve" } },
    lignes: { statut: lignes, instances: [] },
  }) as unknown as SortieDuSudoku;

describe("la relecture guidée par la contradiction", () => {
  it("ne relit que les cellules des rangées d'articles, quand les lignes ne ferment pas", () => {
    assert.deepEqual(cellulesContredites(plan, sortie("signale"), "total_ht"), [4, 5, 6, 8, 9, 10]);
    assert.deepEqual(cellulesContredites(plan, sortie("prouve"), "total_ht"), []);
    assert.deepEqual(cellulesContredites(plan, sortie("signale", "aucune"), "total_ht"), []);
  });

  it("une relecture ne remplace un jeton que si elle est plus sûre que lui", () => {
    const relu = avecLesRelectures(
      plan,
      [6, 8, 9],
      [
        { texte: "73.950", confiance: 0.93 },
        { texte: "1", confiance: 0.99 },
        { texte: "33,000", confiance: 0.5 },
      ],
    );
    assert.equal(relu[6]!.text, "73.950");
    assert.equal(relu[8]!.text, "1");
    assert.equal(relu[9]!.text, "38,000");
    assert.equal(plan[6]!.text, "71.950");
  });
});
