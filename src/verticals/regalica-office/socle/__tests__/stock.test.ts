import { describe, expect, it } from "vitest";

import {
  computeStock,
  computeStockDepreciation,
  computeStockVariation,
  StockMouvementInvalide,
} from "../engines/stock/valorisation";
import type { StockMouvement } from "../contracts/stock.v1";

const params = { currency: "TND", decimals: 3, quantiteDecimals: 3, methode: "cump" } as const;

const mouvements: StockMouvement[] = [
  { at: "2026-01-05", sens: "entree", quantite: "10", cout_unitaire: "10.000", reference: "BL1" },
  { at: "2026-01-20", sens: "entree", quantite: "10", cout_unitaire: "20.000", reference: "BL2" },
  { at: "2026-02-02", sens: "sortie", quantite: "5", cout_unitaire: null, reference: "BS1" },
];

describe("valorisation CUMP", () => {
  it("valorise la sortie au coût unitaire moyen pondéré", () => {
    const res = computeStock(params, mouvements);
    expect(res.lignes[2]?.cump).toBe("15.000");
    expect(res.lignes[2]?.valeur_mouvement).toBe("-75.000");
    expect(res.totals.quantite).toBe("15.000");
    expect(res.totals.valeur).toBe("225.000");
  });
});

describe("valorisation FIFO", () => {
  it("épuise le premier lot d'abord", () => {
    const res = computeStock({ ...params, methode: "fifo" }, mouvements);
    expect(res.lignes[2]?.valeur_mouvement).toBe("-50.000");
    expect(res.totals.valeur).toBe("250.000");
  });

  it("traverse deux lots quand la sortie les dépasse", () => {
    const res = computeStock({ ...params, methode: "fifo" }, [
      ...mouvements,
      { at: "2026-03-01", sens: "sortie", quantite: "10", cout_unitaire: null, reference: "BS2" },
    ]);
    expect(res.lignes[3]?.valeur_mouvement).toBe("-150.000");
    expect(res.totals.quantite).toBe("5.000");
  });
});

describe("garde-fous", () => {
  it("refuse une entrée sans coût", () => {
    expect(() =>
      computeStock(params, [
        { at: "2026-01-01", sens: "entree", quantite: "1", cout_unitaire: null, reference: null },
      ]),
    ).toThrow(StockMouvementInvalide);
  });

  it("refuse une sortie supérieure au stock", () => {
    expect(() =>
      computeStock(params, [
        { at: "2026-01-01", sens: "entree", quantite: "1", cout_unitaire: "1.000", reference: null },
        { at: "2026-01-02", sens: "sortie", quantite: "2", cout_unitaire: null, reference: null },
      ]),
    ).toThrow(StockMouvementInvalide);
  });
});

describe("variation de stock", () => {
  it("calcule final - initial", () => {
    const v = computeStockVariation({
      currency: "TND",
      decimals: 3,
      period: "2026-02",
      initial: "300.000",
      final: "225.000",
    });
    expect(v.variation).toBe("-75.000");
  });
});

describe("dépréciation de stock", () => {
  const base = { currency: "TND", decimals: 3, at: "2026-12-31" };

  it("provisionne l'écart entre le coût et la valeur nette de réalisation", () => {
    const d = computeStockDepreciation({
      ...base,
      valeurStock: "1000.000",
      valeurNette: "820.000",
      cumulAvant: "0",
    });
    expect(d.mouvement).toBe("180.000");
    expect(d.cumul_apres).toBe("180.000");
  });

  it("ne provisionne rien quand la valeur nette dépasse le coût", () => {
    const d = computeStockDepreciation({
      ...base,
      valeurStock: "1000.000",
      valeurNette: "1200.000",
      cumulAvant: "0",
    });
    expect(d.mouvement).toBe("0.000");
  });

  it("reprend sans jamais dépasser le cumul constaté", () => {
    const d = computeStockDepreciation({
      ...base,
      valeurStock: "1000.000",
      valeurNette: "1000.000",
      cumulAvant: "180.000",
    });
    expect(d.mouvement).toBe("-180.000");
    expect(d.cumul_apres).toBe("0.000");
  });
});
