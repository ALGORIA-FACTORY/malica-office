// @vitest-environment jsdom
/**
 * « Affiché » part du rendu, pas de la réponse : une fois pour des valeurs
 * montrées, encore une fois seulement si l'écran en montre d'autres, et
 * jamais pour un écran qui n'a rien montré.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { signalerLAffichage } = vi.hoisted(() => ({ signalerLAffichage: vi.fn() }));
vi.mock("@/lib/parcours", () => ({ signaleur: () => ({ signalerLAffichage }) }));

import { AffichageSignale } from "../affichage-signale";

const PIECE = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";

afterEach(() => {
  cleanup();
  signalerLAffichage.mockReset();
});

describe("AffichageSignale", () => {
  it("signale une fois par rendu de valeurs, pas à chaque rafraîchissement", () => {
    const vue = render(
      <AffichageSignale
        pieceId={PIECE}
        ecran="pme"
        source="lecture"
        valeurs={{ ttc: "510.000", base_ht: "427.731" }}
      />,
    );
    // L'écran se redessine avec un nouvel objet, aux mêmes valeurs.
    vue.rerender(
      <AffichageSignale
        pieceId={PIECE}
        ecran="pme"
        source="lecture"
        valeurs={{ ttc: "510.000", base_ht: "427.731" }}
      />,
    );
    expect(signalerLAffichage).toHaveBeenCalledTimes(1);
    expect(signalerLAffichage).toHaveBeenCalledWith({
      piece: PIECE,
      ecran: "pme",
      source: "lecture",
      valeurs: { ttc: "510.000", base_ht: "427.731" },
    });

    // Le cabinet a forcé : l'écran montre d'autres montants, c'est un autre rendu.
    vue.rerender(
      <AffichageSignale
        pieceId={PIECE}
        ecran="pme"
        source="cabinet"
        valeurs={{ ttc: "510.000", base_ht: "427.731" }}
      />,
    );
    expect(signalerLAffichage).toHaveBeenCalledTimes(2);
  });

  it("ne signale rien quand l'écran n'a aucun montant à montrer", () => {
    render(
      <AffichageSignale
        pieceId={PIECE}
        ecran="comptabilite"
        source="rien"
        valeurs={{ total_debit: null, total_credit: undefined }}
      />,
    );
    expect(signalerLAffichage).not.toHaveBeenCalled();
  });
});
