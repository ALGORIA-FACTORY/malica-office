import { describe, expect, it } from "vitest";

import { ligneDeLaSocieteEnPlus } from "../societe-en-plus";

describe("la société en plus se dit avant le geste", () => {
  it("dans l'inclus : « n sur m », où n compte la nouvelle", () => {
    expect(ligneDeLaSocieteEnPlus(1, 2, "29.000")).toEqual({
      cle: "pme.societe.rejointInclus",
      n: 2,
      total: 2,
    });
  });

  it("au-delà de l'inclus : le prix de la grille, tel quel", () => {
    expect(ligneDeLaSocieteEnPlus(2, 2, "29.000")).toEqual({
      cle: "pme.societe.rejointEnPlus",
      prix: "29.000",
    });
  });

  it("au-delà de l'inclus sans prix lu, ou à prix nul : rien d'inventé", () => {
    expect(ligneDeLaSocieteEnPlus(2, 2, null)).toEqual({ cle: "pme.societe.rejoint" });
    expect(ligneDeLaSocieteEnPlus(2, 2, "0.000")).toEqual({ cle: "pme.societe.rejoint" });
  });

  it("une offre à une société : la nouvelle a son propre abonnement", () => {
    expect(ligneDeLaSocieteEnPlus(1, 1, "29.000")).toEqual({
      cle: "pme.societe.propreAbonnement",
    });
  });

  it("un chiffre pas lu n'est pas dit comme un zéro", () => {
    expect(ligneDeLaSocieteEnPlus(null, 2, "29.000")).toEqual({ cle: "pme.societe.rejoint" });
    expect(ligneDeLaSocieteEnPlus(1, null, "29.000")).toEqual({ cle: "pme.societe.rejoint" });
  });
});
