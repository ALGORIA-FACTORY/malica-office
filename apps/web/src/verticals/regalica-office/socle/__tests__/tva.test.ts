import { describe, it, expect } from "vitest";
import { computeTva } from "../engines/tva/compute";
import {
  TND,
  TAX_RATES_TN,
  factureAchatMultiTaux,
  factureVenteSimple,
  factureTauxManquant,
} from "./fixtures";

describe("TVA / compute", () => {
  it("agrège collectée et déductible, solde correct", () => {
    const r = computeTva({
      period: "2026-07",
      currency: TND,
      tax_rates: TAX_RATES_TN,
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
      achats: [{ item_id: "x", extract: factureTauxManquant() }],
      ventes: [],
    });
    expect(r.refused.length).toBeGreaterThan(0);
    expect(r.totals.deductible).toBe("0.000");
  });
});
