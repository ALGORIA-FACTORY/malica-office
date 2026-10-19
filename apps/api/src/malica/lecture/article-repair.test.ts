import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { detectColumnBands, repairArticles } from "./article-repair.ts";
import type { PageToken } from "./token-plan.ts";

let ordinal = 0;
function tok(text: string, x0: number, y: number, w = 0.08): PageToken {
  ordinal += 1;
  return { page: 1, ordinal, text, x0, y0: y, x1: x0 + w, y1: y + 0.02 };
}

function fixture(): PageToken[] {
  ordinal = 0;
  return [
    // entêtes
    tok("Désignation", 0.05, 0.3, 0.2),
    tok("Qté", 0.4, 0.3, 0.05),
    tok("P.U. HT", 0.55, 0.3, 0.08),
    tok("Total HT", 0.8, 0.3, 0.1),
    // ligne 1
    tok("Verre", 0.05, 0.36, 0.1),
    tok("2", 0.41, 0.36, 0.03),
    tok("50,000", 0.56, 0.36, 0.07),
    tok("100,000", 0.81, 0.36, 0.08),
    // pied
    tok("1000,000", 0.81, 0.7, 0.08),
  ];
}

/**
 * Le plan tel qu'un œil le rend VRAIMENT.
 *
 * Le plan ci-dessus pose « P.U. HT » et « Total HT » en un jeton chacun, et une
 * désignation d'un seul mot. Aucun relevé ne produit cela : le plan est découpé
 * sur les espaces, et une désignation de facture court sur plusieurs lignes
 * imprimées, les chiffres étant centrés sur le bloc entier. C'est ce qui a
 * laissé ce module inerte pendant qu'il passait au vert — voir son en-tête.
 */
function fixtureReelle(): PageToken[] {
  ordinal = 0;
  return [
    // entêtes, découpés sur les espaces comme dans un vrai plan
    tok("Désignation", 0.08, 0.3, 0.1),
    tok("Qté", 0.42, 0.3, 0.04),
    tok("Prix", 0.52, 0.3, 0.04),
    tok("unitaire", 0.57, 0.3, 0.06),
    tok("HT", 0.64, 0.3, 0.02),
    tok("(DT)", 0.67, 0.3, 0.03),
    tok("Montant", 0.71, 0.3, 0.07),
    tok("HT", 0.79, 0.3, 0.02),
    tok("(DT)", 0.82, 0.3, 0.03),
    // une désignation sur trois lignes imprimées
    tok("Loyer", 0.08, 0.34, 0.05),
    tok("mensuel", 0.14, 0.34, 0.06),
    tok("local", 0.21, 0.34, 0.04),
    tok("Immeuble", 0.08, 0.36, 0.07),
    tok("Le", 0.16, 0.36, 0.02),
    tok("Prestige", 0.19, 0.36, 0.06),
    tok("3e", 0.08, 0.38, 0.02),
    tok("étage", 0.11, 0.38, 0.04),
    // les cellules, centrées sur le bloc
    tok("1", 0.44, 0.36, 0.01),
    tok("2 800,000", 0.62, 0.36, 0.07),
    tok("2 800,000", 0.78, 0.36, 0.07),
  ];
}

describe("réparation géométrique des articles, sur un plan tel qu'un œil le rend", () => {
  it("reconnaît un entête que l'espace a découpé en plusieurs jetons", () => {
    const bands = detectColumnBands(fixtureReelle());
    assert.deepEqual(bands.map((b) => b.column).sort(), ["quantity", "total_ht", "unit_price_ht"]);
  });

  it("retrouve les cellules d'une désignation qui court sur plusieurs lignes", () => {
    const tokens = fixtureReelle();
    const [repaired] = repairArticles(tokens, [
      {
        // « Loyer … étage » : les jetons 10 à 17 de ce plan.
        designation: { page: 1, ordinal: 10, ordinalEnd: 17 },
        quantity: null,
        unit_price_ht: null,
        unit_price_ttc: null,
        total_ht: null,
        tax_code: null,
      },
    ]);
    assert.deepEqual(repaired!.quantity, { page: 1, ordinal: 18 });
    assert.deepEqual(repaired!.unit_price_ht, { page: 1, ordinal: 19 });
    assert.deepEqual(repaired!.total_ht, { page: 1, ordinal: 20 });
    assert.equal(repaired!.unit_price_ttc, null);
  });

  it("une ligne qui ne porte qu'un entête n'est pas une ligne d'entêtes", () => {
    /*
     * « Total HT » au pied de facture, dans la colonne des libellés. Le prendre
     * pour l'entête de la colonne des montants plaçait la bande à gauche du
     * tableau, donc sur les désignations.
     */
    ordinal = 0;
    const pied = [
      tok("Total", 0.42, 0.7, 0.05),
      tok("HT", 0.48, 0.7, 0.02),
      tok("3 020,000", 0.78, 0.7, 0.07),
    ];
    assert.deepEqual(detectColumnBands(pied), []);
  });
});

describe("réparation géométrique des articles", () => {
  it("détecte les bandes de colonnes imprimées", () => {
    const bands = detectColumnBands(fixture());
    assert.deepEqual(bands.map((b) => b.column).sort(), ["quantity", "total_ht", "unit_price_ht"]);
  });

  it("complète les colonnes manquantes depuis les tokens de la même ligne", () => {
    const tokens = fixture();
    const [repaired] = repairArticles(tokens, [
      {
        designation: { page: 1, ordinal: 5 },
        quantity: null,
        unit_price_ht: null,
        unit_price_ttc: null,
        total_ht: null,
        tax_code: null,
      },
    ]);
    assert.deepEqual(repaired!.quantity, { page: 1, ordinal: 6 });
    assert.deepEqual(repaired!.unit_price_ht, { page: 1, ordinal: 7 });
    assert.deepEqual(repaired!.total_ht, { page: 1, ordinal: 8 });
    // colonne non imprimée : rien n'est inventé
    assert.equal(repaired!.unit_price_ttc, null);
  });

  it("n'invente rien quand la désignation n'est pas citée", () => {
    const tokens = fixture();
    const [repaired] = repairArticles(tokens, [
      {
        designation: null,
        quantity: null,
        unit_price_ht: null,
        unit_price_ttc: null,
        total_ht: null,
        tax_code: null,
      },
    ]);
    assert.equal(repaired!.quantity, null);
    assert.equal(repaired!.total_ht, null);
  });

  it("conserve les tokens déjà désignés par le modèle", () => {
    const tokens = fixture();
    const [repaired] = repairArticles(tokens, [
      {
        designation: { page: 1, ordinal: 5 },
        quantity: { page: 1, ordinal: 6 },
        unit_price_ht: null,
        unit_price_ttc: null,
        total_ht: { page: 1, ordinal: 8 },
        tax_code: "19",
      },
    ]);
    assert.deepEqual(repaired!.quantity, { page: 1, ordinal: 6 });
    assert.deepEqual(repaired!.total_ht, { page: 1, ordinal: 8 });
  });
});
