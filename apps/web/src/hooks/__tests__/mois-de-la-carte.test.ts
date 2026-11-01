/**
 * La carte de TVA de l'accueil montre le mois le plus récent qui a quelque
 * chose à dire, jamais un mois vide parce qu'il vient de commencer.
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
  it("le 1er du mois, montre le dernier mois qui a un solde", () => {
    const serie = [
      vide("2026-09"),
      { ...vide("2026-10"), recuperee: "19.000", collectee: "0.000", solde: "-19.000" },
      vide("2026-11"),
    ];
    expect(moisDeLaCarte(serie).periode).toBe("2026-10");
  });

  it("un mois dont les pièces sont toutes hors du calcul compte aussi : il le dit", () => {
    const serie = [vide("2026-10"), { ...vide("2026-11"), horsDuCalcul: 2 }];
    expect(moisDeLaCarte(serie).periode).toBe("2026-11");
  });

  it("sans rien nulle part, le mois courant", () => {
    expect(moisDeLaCarte([vide("2026-10"), vide("2026-11")]).periode).toBe("2026-11");
  });
});
