import { describe, it, expect } from "vitest";
import { convertFx, findFxRate, FxRateUnavailable } from "../engines/fx/convert";
import { EUR, TND } from "./fixtures";
import type { FxRateV1 } from "../contracts/fx.v1";

const RATES: FxRateV1[] = [
  { base: "EUR", quote: "TND", rate: "3.35", valid_from: "2026-07-01", valid_to: null, source: "BCT" },
];

describe("fx / convert", () => {
  it("convertit EUR → TND avec taux versionné", () => {
    const r = convertFx({ amount: "100.00", from: EUR, to: TND, date: "2026-07-15", rates: RATES });
    expect(r.amount_out).toBe("335.000");
    expect(r.rate_used).toBe("3.35");
  });

  it("même devise : identité, pas de taux requis", () => {
    const r = convertFx({ amount: "100.00", from: EUR, to: EUR, date: "2026-07-15", rates: [] });
    expect(r.amount_out).toBe("100.00");
    expect(r.rate_used).toBe("1");
  });

  it("aucun taux disponible : REFUS explicite, jamais d'invention", () => {
    expect(() =>
      convertFx({ amount: "100.00", from: EUR, to: TND, date: "2020-01-01", rates: RATES }),
    ).toThrow(FxRateUnavailable);
  });

  it("findFxRate retourne null hors période de validité", () => {
    expect(findFxRate(RATES, "EUR", "TND", "2020-01-01")).toBeNull();
    expect(findFxRate(RATES, "USD", "TND", "2026-07-15")).toBeNull();
  });
});
