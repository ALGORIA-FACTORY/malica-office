import { describe, it, expect } from "vitest";
import {
  computeChargesByFamille,
  type ArticleFact,
  type FamilleDef,
} from "../engines/charges/familles";

const familles: FamilleDef[] = [
  { code: "FOURNITURES", label: "Fournitures", ordinal: 20, isFallback: false },
  { code: "TRANSPORT", label: "Transport", ordinal: 40, isFallback: false },
  { code: "NON_CLASSE", label: "Non classée", ordinal: 999, isFallback: true },
];

function art(p: Partial<ArticleFact> & { period: string; familleCode: string; totalHt: string }): ArticleFact {
  return {
    pieceId: "p",
    ordinal: 1,
    designation: "x",
    quantity: null,
    unitPriceHt: null,
    unitPriceTtc: null,
    documentDate: null,
    citationField: null,
    ...p,
  };
}

describe("charges par famille", () => {
  it("totalise par famille et calcule les parts", () => {
    const r = computeChargesByFamille({
      articles: [
        art({ period: "2026-05", familleCode: "FOURNITURES", totalHt: "540.000" }),
        art({ period: "2026-05", familleCode: "TRANSPORT", totalHt: "460.000" }),
      ],
      familles,
      period: "2026-05",
      baselinePeriods: [],
      threshold: null,
      decimals: 3,
    });
    expect(r.total).toBe("1000.000");
    expect(r.familles[0]!.code).toBe("FOURNITURES");
    expect(r.familles[0]!.share).toBe("0.54");
    expect(r.anomalies).toHaveLength(0);
  });

  it("calcule le montant depuis quantité × PU HT quand le total est absent", () => {
    const r = computeChargesByFamille({
      articles: [
        {
          ...art({ period: "2026-05", familleCode: "TRANSPORT", totalHt: "0" }),
          totalHt: null,
          quantity: "3",
          unitPriceHt: "12.500",
        },
      ],
      familles,
      period: "2026-05",
      baselinePeriods: [],
      threshold: null,
      decimals: 3,
    });
    expect(r.total).toBe("37.500");
  });

  it("signale un écart au-delà du seuil du pack, base = médiane", () => {
    const r = computeChargesByFamille({
      articles: [
        art({ period: "2026-03", familleCode: "FOURNITURES", totalHt: "180.000" }),
        art({ period: "2026-04", familleCode: "FOURNITURES", totalHt: "180.000" }),
        art({ period: "2026-05", familleCode: "FOURNITURES", totalHt: "540.000" }),
      ],
      familles,
      period: "2026-05",
      baselinePeriods: ["2026-04", "2026-03"],
      threshold: { code: "FAMILLE_CONSO", minPeriods: 2, deviationRatio: "0.5", minAmount: "50" },
      decimals: 3,
    });
    expect(r.anomalies).toHaveLength(1);
    expect(r.anomalies[0]!.baseline).toBe("180.000");
    expect(r.anomalies[0]!.observed).toBe("540.000");
    expect(r.anomalies[0]!.deviationRatio).toBe("2");
    expect(r.evolution).toBe("2");
  });

  it("ne signale rien sous le montant plancher du pack", () => {
    const r = computeChargesByFamille({
      articles: [
        art({ period: "2026-03", familleCode: "TRANSPORT", totalHt: "5.000" }),
        art({ period: "2026-04", familleCode: "TRANSPORT", totalHt: "5.000" }),
        art({ period: "2026-05", familleCode: "TRANSPORT", totalHt: "40.000" }),
      ],
      familles,
      period: "2026-05",
      baselinePeriods: ["2026-04", "2026-03"],
      threshold: { code: "FAMILLE_CONSO", minPeriods: 2, deviationRatio: "0.5", minAmount: "50" },
      decimals: 3,
    });
    expect(r.anomalies).toHaveLength(0);
  });

  it("ne signale rien sans assez de périodes de référence", () => {
    const r = computeChargesByFamille({
      articles: [
        art({ period: "2026-04", familleCode: "TRANSPORT", totalHt: "100.000" }),
        art({ period: "2026-05", familleCode: "TRANSPORT", totalHt: "900.000" }),
      ],
      familles,
      period: "2026-05",
      baselinePeriods: ["2026-04"],
      threshold: { code: "FAMILLE_CONSO", minPeriods: 2, deviationRatio: "0.5", minAmount: "50" },
      decimals: 3,
    });
    expect(r.anomalies).toHaveLength(0);
  });
});
