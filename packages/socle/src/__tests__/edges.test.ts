import { describe, it, expect } from "vitest";
import { computePivot } from "../engines/p4/balance.ts";
import { computePnl } from "../engines/pnl/snapshot.ts";
import { resolveTaxRate } from "../domain/tax-rates.ts";
import { TND, TAX_RATES_TN, MAP_ACHAT, TOLERANCES, factureAchatSimple } from "./fixtures.ts";
import type { TaxRateRow } from "../domain/types.ts";

describe("edge branches", () => {
  it("resolveTaxRate — respecte valid_to fini", () => {
    const abrogated: TaxRateRow[] = [
      {
        code: "TVA_18",
        label: "old",
        rate: "0.18",
        valid_from: "2015-01-01",
        valid_to: "2017-12-31",
        jurisdiction: "TN",
      },
    ];
    expect(resolveTaxRate(abrogated, "TVA_18", "2016-06-01")).not.toBeNull();
    expect(resolveTaxRate(abrogated, "TVA_18", "2020-06-01")).toBeNull();
  });

  it("balance — écart d'arrondi ≤ tolérance ⇒ ORANGE ROUNDING_WITHIN_TOLERANCE", () => {
    // Construit un extract où la sommation avant/après arrondi diffère de 0.001.
    const e = factureAchatSimple();
    e.lines = [
      {
        label: "l1",
        tax_code: "TVA_19",
        base_ht: "100.0006",
        vat_amount: "19.0006",
        ttc: "119.0011",
      },
    ];
    e.totals = { base_ht: "100.0006", vat: "19.0006", ttc: "119.0011" };
    const p = computePivot({
      extract: e,
      source_item_id: null,
      tenant_currency: TND,
      tax_rates: TAX_RATES_TN,
      mapping: MAP_ACHAT,
      tolerances: TOLERANCES,
    });
    expect(p.motifs.some((m) => m.code === "ROUNDING_WITHIN_TOLERANCE")).toBe(true);
    expect(p.traffic_light).toBe("ORANGE");
    expect(p.approvable).toBe(true);
  });

  it("PnL — un compte sans libellé au plan garde son code, et la classe vient du pack", () => {
    const r = computePnl({
      period: "2026-07",
      currency: TND,
      entries: [{ account_code: "607", debit: "100.000", credit: "0" }],
      coa: [], // pas de libellé
      classes: [
        { prefix: "4", nature: "actif" },
        { prefix: "6", nature: "charge" },
        { prefix: "7", nature: "produit" },
      ],
    });
    expect(r.by_account[0]!.label).toBe("607");
  });
});
