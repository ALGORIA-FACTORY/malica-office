/**
 * Revue de #140 : une facture à deux taux forcée sans codes rendait un extrait
 * invalide (`tax_code: null`, `label: ""`), et la TVA du mois l'écartait sans
 * un mot. Elle est désormais « refusée », avec ce qui manque.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/verticals/malica-office/composition", () => ({ office: () => ({}) }));

import { extraitsDeLaTva } from "@/hooks/use-tva";

const extrait = (lignes: unknown[], sens = "facture_achat") => ({
  contract: "extract.v1",
  issuer: "FOURNISSEUR D'ESSAI",
  document_date: "2026-10-30",
  currency: "TND",
  document_kind: sens,
  lines: lignes,
  totals: { base_ht: "1000.000", vat: "130.000", ttc: "1130.000" },
});

describe("les extraits de la TVA du mois", () => {
  it("un extrait invalide est refusé, nommé, jamais écarté en silence", () => {
    const r = extraitsDeLaTva([
      {
        pieceId: "p1",
        extract: extrait([
          {
            label: "",
            tax_code: null,
            base_ht: "1000.000",
            vat_amount: "130.000",
            ttc: "1130.000",
          },
        ]),
      },
    ]);
    expect(r.achats).toEqual([]);
    expect(r.illisibles).toHaveLength(1);
    expect(r.illisibles[0]!.item_id).toBe("p1");
    expect(r.illisibles[0]!.reason).toMatch(/^EXTRAIT_ILLISIBLE:.*lines\.0\.tax_code/);
  });

  it("deux taux, deux lignes codées : un achat, et rien de refusé", () => {
    const r = extraitsDeLaTva([
      {
        pieceId: "p2",
        extract: extrait([
          {
            label: "TVA07",
            tax_code: "TVA07",
            base_ht: "500.000",
            vat_amount: "35.000",
            ttc: "535.000",
          },
          {
            label: "TVA19",
            tax_code: "TVA19",
            base_ht: "500.000",
            vat_amount: "95.000",
            ttc: "595.000",
          },
        ]),
      },
      {
        pieceId: "p3",
        extract: extrait(
          [
            {
              label: "TVA19",
              tax_code: "TVA19",
              base_ht: "1.000",
              vat_amount: "0.190",
              ttc: "1.190",
            },
          ],
          "facture_vente",
        ),
      },
    ]);
    expect(r.illisibles).toEqual([]);
    expect(r.achats.map((a) => a.item_id)).toEqual(["p2"]);
    expect(r.ventes.map((v) => v.item_id)).toEqual(["p3"]);
  });
});
