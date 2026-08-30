import { describe, expect, it } from "vitest";

import { detectColumnBands, repairArticles } from "../article-repair";
import type { PageToken } from "../token-plan";

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

describe("réparation géométrique des articles", () => {
  it("détecte les bandes de colonnes imprimées", () => {
    const bands = detectColumnBands(fixture());
    expect(bands.map((b) => b.column).sort()).toEqual(["quantity", "total_ht", "unit_price_ht"]);
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
    expect(repaired!.quantity).toEqual({ page: 1, ordinal: 6 });
    expect(repaired!.unit_price_ht).toEqual({ page: 1, ordinal: 7 });
    expect(repaired!.total_ht).toEqual({ page: 1, ordinal: 8 });
    // colonne non imprimée : rien n'est inventé
    expect(repaired!.unit_price_ttc).toBeNull();
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
    expect(repaired!.quantity).toBeNull();
    expect(repaired!.total_ht).toBeNull();
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
    expect(repaired!.quantity).toEqual({ page: 1, ordinal: 6 });
    expect(repaired!.total_ht).toEqual({ page: 1, ordinal: 8 });
  });
});
