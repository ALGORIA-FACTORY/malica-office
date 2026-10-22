import { describe, expect, it } from "vitest";

import type { PaiementDUnePiece } from "@malica/socle/ports/repositories";
import { totalDesPaiements } from "../total-des-paiements";

const paiement = (changement: Partial<PaiementDUnePiece>): PaiementDUnePiece => ({
  id: "paiement",
  moyenCode: "virement",
  montantMineur: 500,
  devise: "TND",
  payeLe: "2026-10-22",
  justificatifPieceId: null,
  createdAt: "2026-10-22T10:00:00Z",
  reference: null,
  annulePaiementId: null,
  eteint: false,
  ...changement,
});

describe("les paiements connus d'une pièce", () => {
  it("conserve le zéro d'une facture explicitement non payée", () => {
    expect(totalDesPaiements([paiement({ moyenCode: "non_paye", montantMineur: null })])).toBe(0);
  });

  it("cumule les paiements suivants sans compter le constat non payé ni les annulations", () => {
    expect(
      totalDesPaiements([
        paiement({ moyenCode: "non_paye", montantMineur: null }),
        paiement({ montantMineur: 400 }),
        paiement({ montantMineur: 200 }),
        paiement({ montantMineur: 900, eteint: true }),
      ]),
    ).toBe(600);
  });

  it("ne transforme pas un règlement incomplet en zéro", () => {
    expect(totalDesPaiements([paiement({ montantMineur: null })])).toBeNull();
  });

  it("refuse un montant non entier ou une somme hors précision", () => {
    expect(totalDesPaiements([paiement({ montantMineur: 1.5 })])).toBeNull();
    expect(
      totalDesPaiements([
        paiement({ montantMineur: Number.MAX_SAFE_INTEGER }),
        paiement({ montantMineur: 1 }),
      ]),
    ).toBeNull();
  });

  it("conserve le zéro d'une liste lue sans règlement", () => {
    expect(totalDesPaiements([])).toBe(0);
  });
});
