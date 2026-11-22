/**
 * Un avoir retranche, et chaque devise a son total à ses décimales.
 *
 * Le dirigeant, 21 novembre 2026, ventes d'octobre : deux factures (300 et 360 EUR) et leurs
 * deux avoirs affichaient « 1 320,000 » — additionnés, et au format du dinar.
 */
import { describe, expect, it } from "vitest";

import { montantDeLaPiece, totauxParDevise } from "../totaux-des-pieces";

const types = [
  { code: "facture_vente", signe: 1 as const },
  { code: "avoir", signe: -1 as const },
];
const piece = (typeDeDocument: string, total: string | null, devise = "EUR", decimales = 2) => ({
  typeDeDocument,
  total,
  devise,
  decimales,
});

describe("les totaux des pièces", () => {
  it("deux factures moins leurs deux avoirs font zéro, en euros à deux décimales", () => {
    const ventes = [
      piece("facture_vente", "300.000"),
      piece("facture_vente", "360.000"),
      piece("avoir", "300.000"),
      piece("avoir", "360.000"),
    ];
    expect(totauxParDevise(ventes, types)).toEqual([{ devise: "EUR", total: "0.00" }]);
  });

  it("un avoir se lit en négatif, qu'il soit imprimé positif ou négatif", () => {
    expect(montantDeLaPiece(piece("avoir", "300.00"), types)).toBe("-300.00");
    expect(montantDeLaPiece(piece("avoir", "-300.00"), types)).toBe("-300.00");
    expect(montantDeLaPiece(piece("facture_vente", "300.00"), types)).toBe("300.00");
    expect(montantDeLaPiece(piece("avoir", null), types)).toBeNull();
  });

  it("des euros ne s'additionnent jamais à des dinars", () => {
    const totaux = totauxParDevise(
      [piece("facture_vente", "300.00"), piece("facture_vente", "1.500", "TND", 3)],
      types,
    );
    expect(totaux).toEqual([
      { devise: "EUR", total: "300.00" },
      { devise: "TND", total: "1.500" },
    ]);
  });

  it("un montant plus précis que sa devise n'est pas arrondi en silence", () => {
    expect(totauxParDevise([piece("facture_vente", "10.005")], types)).toEqual([
      { devise: "EUR", total: "10.005" },
    ]);
  });
});
