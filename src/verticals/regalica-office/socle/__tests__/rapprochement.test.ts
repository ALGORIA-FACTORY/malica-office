import { describe, expect, it } from "vitest";

import { computeRapprochement } from "../engines/banque/rapprochement";
import type { BankLine, BookLine } from "../contracts/rapprochement.v1";

const params = {
  currency: "TND",
  decimals: 3,
  toleranceJours: 5,
  toleranceMontant: "1.000",
} as const;

const bank: BankLine[] = [
  { id: "b1", at: "2026-02-03", label: "VIR STEG", montant: "-236.000", reference: "F2026-014" },
  { id: "b2", at: "2026-02-10", label: "REM CHQ", montant: "1180.000", reference: null },
  { id: "b3", at: "2026-02-28", label: "FRAIS", montant: "-12.500", reference: null },
];

const book: BookLine[] = [
  {
    id: "k1",
    at: "2026-02-01",
    label: "STEG février",
    montant: "-236.000",
    reference: "F2026-014",
  },
  { id: "k2", at: "2026-02-09", label: "Client Nour", montant: "1180.000", reference: null },
  { id: "k3", at: "2026-03-15", label: "Loyer", montant: "-900.000", reference: null },
];

describe("rapprochement bancaire", () => {
  it("apparie montant exact + référence identique avec le meilleur score", () => {
    const res = computeRapprochement(params, bank, book);
    const paire = res.paires.find((p) => p.bank_id === "b1");
    expect(paire?.book_id).toBe("k1");
    expect(paire?.score).toBeGreaterThanOrEqual(90);
    expect(paire?.reference_exacte).toBe(true);
  });

  it("apparie sans référence quand montant et date concordent", () => {
    const res = computeRapprochement(params, bank, book);
    expect(res.paires.find((p) => p.bank_id === "b2")?.book_id).toBe("k2");
  });

  it("laisse les lignes hors tolérance orphelines des deux côtés", () => {
    const res = computeRapprochement(params, bank, book);
    expect(res.bank_orphelines).toEqual(["b3"]);
    expect(res.book_orphelines).toEqual(["k3"]);
  });

  it("n'apparie jamais deux fois la même ligne", () => {
    const res = computeRapprochement(params, bank, [
      ...book,
      {
        id: "k4",
        at: "2026-02-03",
        label: "STEG doublon",
        montant: "-236.000",
        reference: "F2026-014",
      },
    ]);
    const bankIds = res.paires.map((p) => p.bank_id);
    expect(new Set(bankIds).size).toBe(bankIds.length);
  });

  it("expose l'écart global entre les deux bords", () => {
    const res = computeRapprochement(params, bank, book);
    expect(res.totals.ecart).toBe("887.500");
  });
});
