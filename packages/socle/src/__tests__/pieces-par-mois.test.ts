import { describe, expect, it } from "vitest";

import { piecesParMois, type PieceLuePourLesMois } from "../engines/pieces/par-mois.ts";

const p = (
  kind: string | null,
  total: string | null,
  dateDocument: string | null,
  devise: string | null = "TND",
): PieceLuePourLesMois => ({ kind, total, dateDocument, devise });

describe("les achats et les ventes par mois", () => {
  const PIECES = [
    p("facture_achat", "100.500", "2026-09-03"),
    p("facture_achat", "0.500", "2026-09-28"),
    p("facture_vente", "1000.000", "2026-09-10"),
    p("facture_vente", "250.250", "2026-11-02"),
    // Hors fenêtre : ni comptée, ni écartée.
    p("facture_achat", "9999.000", "2026-01-15"),
    // Écartées.
    p("facture_achat", null, "2026-10-05"),
    p("facture_vente", "12.00", "2026-10-06", "EUR"),
    p("facture_achat", "5.000", null),
    // Ni achat ni vente : ignorée.
    p("releve", "77.000", "2026-10-07"),
  ];

  it("somme exactement par mois et par sens, et laisse vide le mois sans pièce", () => {
    const r = piecesParMois(PIECES, "TND", 3, "2026-11", 3);
    expect(r.mois).toEqual([
      { mois: "2026-09", achats: "101.000", ventes: "1000.000", piecesAchats: 2, piecesVentes: 1 },
      { mois: "2026-10", achats: null, ventes: null, piecesAchats: 0, piecesVentes: 0 },
      { mois: "2026-11", achats: null, ventes: "250.250", piecesAchats: 0, piecesVentes: 1 },
    ]);
    expect(r.totalAchats).toBe("101.000");
    expect(r.totalVentes).toBe("1250.250");
  });

  it("dit ce qu'il écarte : total non lu, autre devise, date non lue", () => {
    const r = piecesParMois(PIECES, "TND", 3, "2026-11", 3);
    expect(r.ecartees).toEqual({ sansTotal: 1, autreDevise: 1, sansDate: 1 });
  });

  it("la fenêtre passe l'année, et un mois mal écrit se refuse", () => {
    expect(piecesParMois([], "TND", 3, "2026-02", 4).mois.map((m) => m.mois)).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
    expect(() => piecesParMois([], "TND", 3, "novembre", 3)).toThrow(/mois illisible/);
  });

  it("sans pièce : une fenêtre de mois vides et des totaux nuls", () => {
    const r = piecesParMois([], "XOF", 0, "2026-03", 2);
    expect(r.mois.map((m) => [m.mois, m.achats, m.ventes])).toEqual([
      ["2026-02", null, null],
      ["2026-03", null, null],
    ]);
    expect([r.totalAchats, r.totalVentes]).toEqual(["0", "0"]);
  });
});
