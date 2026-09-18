/**
 * Après la connexion, `/auth` ne mène qu'à l'accueil ou à la page
 * d'invitation : une `suite` libre ferait de l'écran de connexion un tremplin
 * vers n'importe quelle adresse (redirection ouverte).
 */
import { describe, expect, it } from "vitest";

import { lireSuite } from "@/lib/suite-apres-connexion";

describe("la suite après connexion", () => {
  it("admet la page d'invitation", () => {
    expect(lireSuite({ suite: "/invitation" })).toEqual({ suite: "/invitation" });
  });

  it("ignore toute autre destination", () => {
    for (const suite of [
      "https://ailleurs.example",
      "//ailleurs.example",
      "/cabinet",
      "/invitation/x",
      42,
    ]) {
      expect(lireSuite({ suite })).toEqual({});
    }
  });

  it("n'ouvre l'onglet de création d'accès que sur demande explicite", () => {
    expect(lireSuite({ mode: "signup" })).toEqual({ mode: "signup" });
    expect(lireSuite({ mode: "admin" })).toEqual({});
  });
});
