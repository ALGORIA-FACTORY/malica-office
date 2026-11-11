/**
 * Le total des paiements d'une pièce — exact, ou inconnu, jamais un zéro inventé.
 *
 * Garantit que le zéro d'une facture non payée ou d'une liste sans règlement est
 * conservé, que les annulations et le constat « non payé » ne comptent pas, qu'un
 * règlement incomplet, non entier ou hors précision rend inconnu, et qu'une retenue
 * qualifiée solde la dette sans gonfler le paiement bancaire.
 */
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
  it("une retenue qualifiée solde la dette sans gonfler le paiement bancaire", () => {
    const net = paiement({ montantMineur: 1_970_000, detteEteinteMineur: 2_000_000 });
    expect(totalDesPaiements([net])).toBe(2_000_000);
    expect(net.montantMineur).toBe(1_970_000);
    expect(totalDesPaiements([{ ...net, eteint: true }])).toBe(0);
    expect(totalDesPaiements([paiement({ montantMineur: 1_970_000 })])).toBe(1_970_000);
  });
});
