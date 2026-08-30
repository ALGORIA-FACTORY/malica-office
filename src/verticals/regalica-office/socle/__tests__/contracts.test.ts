/**
 * Couvre les schémas Zod des contrats en les parsant sur des DTO valides.
 * Cela garantit que la forme est stable et exécute le code de validation.
 */
import { describe, it, expect } from "vitest";
import { ExtractV1 } from "../contracts/extract.v1";
import { PivotV1 } from "../contracts/pivot.v1";
import { TvaV1 } from "../contracts/tva.v1";
import { PnlV1 } from "../contracts/pnl.v1";
import { EcheanceV1 } from "../contracts/echeance.v1";
import { FxConversionV1, FxRateV1 } from "../contracts/fx.v1";
import { factureAchatSimple } from "./fixtures";

describe("contracts — parsing DTO valides", () => {
  it("ExtractV1", () => expect(ExtractV1.parse(factureAchatSimple())).toBeTruthy());

  it("PivotV1", () => {
    expect(PivotV1.parse({
      contract: "pivot.v1", source_item_id: null, entry_date: "2026-07-15",
      period: "2026-07", currency: "TND",
      lines: [
        { account_code: "607", label: "x", debit: "10.000", credit: "0" },
        { account_code: "401", label: "y", debit: "0", credit: "10.000" },
      ],
      totals: { debit: "10.000", credit: "10.000" },
      traffic_light: "VERT", motifs: [], approvable: true,
    })).toBeTruthy();
  });

  it("TvaV1", () => expect(TvaV1.parse({
    contract: "tva.v1", period: "2026-07", currency: "TND",
    collectee: [], deductible: [],
    totals: { collectee: "0.000", deductible: "0.000", solde: "0.000" },
    refused: [],
  })).toBeTruthy());

  it("PnlV1", () => expect(PnlV1.parse({
    contract: "pnl.v1", period: "2026-07", currency: "TND",
    produits: "0.000", charges: "0.000", resultat: "0.000", by_account: [],
  })).toBeTruthy());

  it("EcheanceV1", () => expect(EcheanceV1.parse({
    contract: "echeance.v1", jurisdiction: "TN", kind: "TVA_MENSUELLE",
    label: "x", period: "2026-07", due_date: "2026-08-28",
  })).toBeTruthy());

  it("FxConversionV1 + FxRateV1", () => {
    expect(FxConversionV1.parse({
      contract: "fx.v1", amount_in: "100.00", currency_in: "EUR",
      amount_out: "335.000", currency_out: "TND", rate_used: "3.35", rate_date: "2026-07-15",
    })).toBeTruthy();
    expect(FxRateV1.parse({
      base: "EUR", quote: "TND", rate: "3.35",
      valid_from: "2026-07-01", valid_to: null, source: "BCT",
    })).toBeTruthy();
  });
});
