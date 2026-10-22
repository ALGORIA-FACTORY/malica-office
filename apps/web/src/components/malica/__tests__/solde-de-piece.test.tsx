import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/i18n", () => ({ useI18n: () => ({ t: (cle: string) => cle }) }));

import { SoldeDePiece } from "../solde-de-piece";

describe("la preuve du solde d'une pièce", () => {
  it("ne présente ni zéro ni règlement acquis quand le total est absent", () => {
    const rendu = renderToStaticMarkup(
      createElement(SoldeDePiece, {
        paye: "0,000",
        total: null,
        reste: null,
        soldee: null,
        progression: null,
        devise: "TND",
      }),
    );
    expect(rendu).toContain("pme.paiement.indetermine");
    expect(rendu).toContain("pme.paiement.incomplet");
    expect(rendu).not.toContain("0,000");
    expect(rendu).not.toContain("pme.paiement.solde");
    expect(rendu).not.toContain('class="bar"');
  });

  it("garde une facture à confirmer quand un règlement est inconnu", () => {
    const rendu = renderToStaticMarkup(
      createElement(SoldeDePiece, {
        paye: null,
        total: "119,000",
        reste: null,
        soldee: null,
        progression: null,
        devise: "TND",
      }),
    );
    expect(rendu).toContain("pme.paiement.indetermine");
    expect(rendu).not.toContain("pme.paiement.solde");
  });

  it("affiche le solde établi sans confondre un vrai zéro avec une absence", () => {
    const rendu = renderToStaticMarkup(
      createElement(SoldeDePiece, {
        paye: "119,000",
        total: "119,000",
        reste: "0,000",
        soldee: true,
        progression: 100,
        devise: "TND",
      }),
    );
    expect(rendu).toContain("pme.paiement.solde");
    expect(rendu).not.toContain("pme.paiement.indetermine");
  });
});
