import { describe, expect, it } from "vitest";

import { ligneDeLaSocieteEnPlus } from "../societe-en-plus";

const premium = (organisations: number, prix = "29.000") => ({
  offre: "premium",
  organisations,
  organisations_incluses: 2,
  prix_organisation_sup: prix,
});

describe("la société en plus se dit avant le geste", () => {
  it("dans l'inclus de la licence d'accueil : « n sur m », où n compte la nouvelle", () => {
    expect(ligneDeLaSocieteEnPlus(premium(1))).toEqual({
      cle: "pme.societe.rejointInclus",
      offre: "premium",
      n: 2,
      total: 2,
    });
  });

  it("au-delà de l'inclus : le prix de la grille, tel quel", () => {
    expect(ligneDeLaSocieteEnPlus(premium(2))).toEqual({
      cle: "pme.societe.rejointEnPlus",
      offre: "premium",
      prix: "29.000",
    });
  });

  it("au-delà de l'inclus à prix nul : rien d'inventé", () => {
    expect(ligneDeLaSocieteEnPlus(premium(2, "0.000"))).toEqual({
      cle: "pme.societe.rejoint",
      offre: "premium",
    });
  });

  it("aucune licence ne l'accueille : la société aura sa propre licence", () => {
    expect(ligneDeLaSocieteEnPlus(null)).toEqual({ cle: "pme.societe.propreAbonnement" });
  });
});
