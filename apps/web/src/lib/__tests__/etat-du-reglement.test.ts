/**
 * L'état du règlement d'une pièce — dit en une phrase, historique compris.
 *
 * Garantit qu'une pièce est dite non réglée, payée, payée en partie, non payée, ou à
 * confirmer quand le TTC n'est pas lu (jamais « — »). Un règlement annulé ne compte
 * pas, et il ne fait qu'une ligne d'historique, qui porte la date et le motif de
 * l'annulation.
 */
import { describe, expect, it } from "vitest";
import type { PaiementDUnePiece } from "@malica/socle/ports/repositories";

import { etatDuReglement, historiqueDuReglement } from "@/lib/etat-du-reglement";

const ligne = (id: string, autre: Partial<PaiementDUnePiece> = {}): PaiementDUnePiece => ({
  id,
  moyenCode: "especes",
  montantMineur: 1000,
  devise: "TND",
  payeLe: "2026-10-13",
  justificatifPieceId: null,
  createdAt: "2026-10-13T10:00:00Z",
  reference: null,
  annulePaiementId: null,
  annulationMotifId: null,
  eteint: false,
  ...autre,
});

describe("l'état du règlement, en une phrase", () => {
  it("rien d'inscrit", () => {
    expect(etatDuReglement(1000, []).kind).toBe("rien");
  });

  it("payée, en partie, ou pas encore", () => {
    expect(etatDuReglement(1000, [ligne("a")])).toEqual({ kind: "paye", paye: 1000 });
    expect(etatDuReglement(3000, [ligne("a")])).toEqual({
      kind: "partiel",
      paye: 1000,
      reste: 2000,
    });
    expect(
      etatDuReglement(3000, [
        ligne("n", { moyenCode: "non_paye", montantMineur: null, payeLe: null }),
      ]).kind,
    ).toBe("non_paye");
  });

  it("une annulation ne compte pas", () => {
    expect(
      etatDuReglement(3000, [
        ligne("a", { eteint: true }),
        ligne("x", { eteint: true, annulePaiementId: "a" }),
      ]).kind,
    ).toBe("rien");
  });

  it("sans TTC lu, le total est à confirmer, jamais « — »", () => {
    expect(etatDuReglement(null, [ligne("a")])).toEqual({ kind: "a_confirmer", paye: 1000 });
  });
});

describe("l'historique : un règlement annulé, une seule ligne", () => {
  it("la ligne d'annulation porte la date et le motif, sans faire une ligne de plus", () => {
    const h = historiqueDuReglement([
      ligne("a", { eteint: true }),
      ligne("x", {
        eteint: true,
        annulePaiementId: "a",
        annulationMotifId: "m1",
        createdAt: "2026-10-25T09:00:00Z",
      }),
      ligne("b"),
    ]);
    expect(h.map((x) => [x.ligne.id, x.motifId, x.le])).toEqual([
      ["a", "m1", "2026-10-25T09:00:00Z"],
    ]);
  });
});
