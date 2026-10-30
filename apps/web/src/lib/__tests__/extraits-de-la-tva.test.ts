/**
 * Revue de #140 : une facture à deux taux forcée sans codes rendait un extrait
 * invalide (`tax_code: null`, `label: ""`), et la TVA du mois l'écartait sans
 * un mot. Elle est désormais « refusée », avec ce qui manque — sur TOUS les
 * écrans qui comptent la TVA (le mois, l'accueil, la synthèse du cabinet) :
 * un seul calcul, `tvaDesExtraits`.
 */
import { describe, expect, it } from "vitest";

import { tvaDesExtraits } from "@/lib/extraits-de-la-tva";

const extrait = (lignes: unknown[], sens = "facture_achat") => ({
  contract: "extract.v1",
  issuer: "FOURNISSEUR D'ESSAI",
  document_date: "2026-10-30",
  currency: "TND",
  document_kind: sens,
  lines: lignes,
  totals: { base_ht: "1000.000", vat: "130.000", ttc: "1130.000" },
});

const ligne = (code: string | null, ht: string, tva: string, label = code ?? "") => ({
  label,
  tax_code: code,
  base_ht: ht,
  vat_amount: tva,
  ttc: (Number(ht) + Number(tva)).toFixed(3),
});

const taux = [
  { code: "TVA07", rate: "0.070" },
  { code: "TVA19", rate: "0.190" },
].map((t) => ({
  ...t,
  label: t.code,
  validFrom: "2020-01-01",
  validTo: null,
  jurisdiction: "TN",
}));

const calcul = (rows: Array<{ pieceId: string; extract: unknown }>) =>
  tvaDesExtraits({
    period: "2026-10",
    currency: { code: "TND", decimals: 3 },
    taux,
    rows,
  });

describe("la TVA des extraits du mois", () => {
  it("un extrait invalide est refusé, nommé, jamais écarté en silence", () => {
    const r = calcul([{ pieceId: "p1", extract: extrait([ligne(null, "1000.000", "130.000")]) }]);
    expect(r.totals.deductible).toBe("0.000");
    expect(r.refused).toHaveLength(1);
    expect(r.refused[0]!.item_id).toBe("p1");
    expect(r.refused[0]!.reason).toMatch(/^EXTRAIT_ILLISIBLE:.*lines\.0\.tax_code/);
  });

  it("deux taux, deux lignes codées : comptés, et rien de refusé", () => {
    const r = calcul([
      {
        pieceId: "p2",
        extract: extrait([
          ligne("TVA07", "500.000", "35.000"),
          ligne("TVA19", "500.000", "95.000"),
        ]),
      },
      {
        pieceId: "p3",
        extract: extrait([ligne("TVA19", "1.000", "0.190")], "facture_vente"),
      },
    ]);
    expect(r.refused).toEqual([]);
    expect(r.totals.deductible).toBe("130.000");
    expect(r.totals.collectee).toBe("0.190");
  });

  it("un extrait invalide parmi d'autres : les autres comptent, lui est refusé", () => {
    const r = calcul([
      { pieceId: "p4", extract: extrait([ligne("TVA19", "1000.000", "190.000")]) },
      { pieceId: "p5", extract: { contract: "extract.v1" } },
    ]);
    expect(r.totals.deductible).toBe("190.000");
    expect(r.refused.map((x) => x.item_id)).toEqual(["p5"]);
  });
});
