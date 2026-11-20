/**
 * Une société en plus se dit AVANT le geste : dans l'inclus de la licence
 * d'accueil, « n sur m » ; au-delà, le prix de la grille tel que la base le
 * rend, jamais un chiffre inventé ; et quand la porte refuserait, l'écran le
 * dit d'abord.
 */
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

  it("titulaire d'une offre à une société : la porte refuserait, l'écran le dit avant le geste", () => {
    expect(ligneDeLaSocieteEnPlus({ offre_multisociete_requise: true })).toEqual({
      cle: "pme.societe.offreMultisocieteRequise",
    });
  });

  it("aucune licence ne l'accueille : la société aura sa propre licence", () => {
    expect(ligneDeLaSocieteEnPlus(null)).toEqual({ cle: "pme.societe.propreAbonnement" });
  });
});
