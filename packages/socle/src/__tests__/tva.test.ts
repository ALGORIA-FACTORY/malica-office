/**
 * Les épreuves du calcul de TVA — collectée, déductible, solde, ou refus.
 *
 * Garantissent que le moteur agrège la TVA collectée sur les ventes et la TVA déductible
 * sur les achats (un seau par taux), calcule le solde (positif : à payer), et refuse
 * explicitement une pièce dont la date n'a aucun taux applicable, sans en inventer un
 * et sans l'ajouter aux totaux (R4).
 */
import { describe, it, expect } from "vitest";
import { computeTva } from "../engines/tva/compute.ts";
import {
  TND,
  TAX_RATES_TN,
  DECLARATION_ESSAI,
  factureAchatMultiTaux,
  factureVenteSimple,
  factureTauxManquant,
} from "./fixtures.ts";

describe("TVA / compute", () => {
  it("agrège collectée et déductible, solde correct", () => {
    const r = computeTva({
      period: "2026-07",
      currency: TND,
      tax_rates: TAX_RATES_TN,
      declaration: DECLARATION_ESSAI,
      achats: [{ item_id: "a1", extract: factureAchatMultiTaux() }],
      ventes: [{ item_id: "v1", extract: factureVenteSimple() }],
    });
    expect(r.totals.collectee).toBe("380.000");
    expect(r.totals.deductible).toBe("128.000");
    expect(r.totals.solde).toBe("252.000");
    expect(r.collectee).toHaveLength(1);
    expect(r.deductible).toHaveLength(3);
  });

  it("date sans taux : refus explicite, aucun taux inventé", () => {
    const r = computeTva({
      period: "2010-01",
      currency: TND,
      tax_rates: TAX_RATES_TN,
      declaration: DECLARATION_ESSAI,
      achats: [{ item_id: "x", extract: factureTauxManquant() }],
      ventes: [],
    });
    expect(r.refused.length).toBeGreaterThan(0);
    expect(r.totals.deductible).toBe("0.000");
  });
});
