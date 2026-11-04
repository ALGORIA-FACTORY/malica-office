/**
 * La carte de TVA de l'accueil montre le mois en cours, toujours (décision
 * du dirigeant, 4 novembre 2026), même vide.
 */
import { describe, expect, it } from "vitest";

import { moisDeLaCarte, type MoisDeTva } from "../use-accueil";

const vide = (periode: string): MoisDeTva => ({
  periode,
  recuperee: null,
  collectee: null,
  solde: null,
  horsDuCalcul: 0,
});

describe("moisDeLaCarte", () => {
  it("montre le mois en cours même quand un mois passé a un solde", () => {
    const serie = [
      vide("2026-09"),
      { ...vide("2026-10"), recuperee: "19.000", collectee: "0.000", solde: "-19.000" },
      vide("2026-11"),
    ];
    expect(moisDeLaCarte(serie).periode).toBe("2026-11");
  });

  it("le mois en cours garde ses pièces hors du calcul", () => {
    const serie = [vide("2026-10"), { ...vide("2026-11"), horsDuCalcul: 2 }];
    expect(moisDeLaCarte(serie).periode).toBe("2026-11");
  });

  it("sans rien nulle part, le mois courant", () => {
    expect(moisDeLaCarte([vide("2026-10"), vide("2026-11")]).periode).toBe("2026-11");
  });
});
