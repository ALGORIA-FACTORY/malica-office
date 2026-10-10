/**
 * Les mois qu'un écran montre, et le piège de janvier.
 *
 * L'épreuve qui compte est la dernière : elle tient que la fenêtre
 * d'affichage et la fenêtre de calcul ne se confondent pas. Les confondre
 * donnerait un résultat plausible et faux une fois par an — le 1er janvier.
 */
import { describe, expect, it } from "vitest";

import { moisDecale, moisDeLExercice, moisGlissants } from "../exercice.ts";

/** L'exercice tunisien clôt au 31 décembre. Il vient de la fiche, pas d'ici. */
const CIVIL = "12-31";

describe("les mois d'un exercice", () => {
  it("montre les douze mois, de janvier à décembre", () => {
    const mois = moisDeLExercice(CIVIL, "2026-10", "2026-10");
    expect(mois).toHaveLength(12);
    expect(mois[0]!.periode).toBe("2026-01");
    expect(mois[11]!.periode).toBe("2026-12");
  });

  it("commence par janvier quel que soit le mois consulté", () => {
    // La demande, mot pour mot : « tous les mois de l'année doivent tous
    // apparaître dès janvier ».
    expect(moisDeLExercice(CIVIL, "2026-12", "2026-12")[0]!.periode).toBe("2026-01");
    expect(moisDeLExercice(CIVIL, "2026-01", "2026-10")[0]!.periode).toBe("2026-01");
  });

  it("sans clôture renseignée, c'est l'année civile", () => {
    // Une fiche sans clôture est permise (R10) ; elle ne doit pas vider l'écran.
    expect(moisDeLExercice(null, "2026-10", "2026-10")[0]!.periode).toBe("2026-01");
  });

  it("distingue les mois à venir des mois vides", () => {
    const mois = moisDeLExercice(CIVIL, "2026-10", "2026-10");
    expect(mois.filter((m) => m.aVenir).map((m) => m.periode)).toEqual(["2026-11", "2026-12"]);
    expect(mois.find((m) => m.periode === "2026-10")!.aVenir).toBe(false);
  });

  it("suit un exercice décalé sans forker le code (R5)", () => {
    // Clôture au 31 mars : octobre 2026 est dans l'exercice ouvert en avril
    // 2026 ; février 2026 dans celui ouvert en avril 2025.
    expect(moisDeLExercice("03-31", "2026-10", "2026-10")[0]!.periode).toBe("2026-04");
    const fevrier = moisDeLExercice("03-31", "2026-02", "2026-10");
    expect(fevrier[0]!.periode).toBe("2025-04");
    expect(fevrier[11]!.periode).toBe("2026-03");
  });

  it("ne met aucun mois deux fois, et n'en saute aucun", () => {
    for (const cloture of [CIVIL, "03-31", "06-30", "01-31"]) {
      const mois = moisDeLExercice(cloture, "2026-06", "2026-10").map((m) => m.periode);
      expect(new Set(mois).size, `clôture ${cloture}`).toBe(12);
      for (let i = 1; i < mois.length; i += 1) {
        expect(mois[i], `clôture ${cloture} : après ${mois[i - 1]}`).toBe(
          moisDecale(mois[i - 1]!, -1),
        );
      }
    }
  });

  it("la fenêtre de CALCUL traverse le changement d'exercice", () => {
    const glissants = moisGlissants("2026-01", 12);
    expect(glissants).toHaveLength(12);
    expect(glissants[11]).toBe("2026-01");
    expect(glissants[10], "janvier a un mois précédent : décembre de l'exercice d'avant").toBe(
      "2025-12",
    );
  });

  it("et elle n'est PAS la fenêtre d'affichage", () => {
    // La garantie en une épreuve : en janvier, les deux ne coïncident pas. Si
    // quelqu'un remplace un jour l'une par l'autre, celle-ci tombe.
    const affiches = moisDeLExercice(CIVIL, "2026-01", "2026-01").map((m) => m.periode);
    const calcules = moisGlissants("2026-01", 12);
    expect(affiches).not.toEqual(calcules);
    expect(affiches.includes("2025-12"), "décembre 2025 n'est pas de cet exercice").toBe(false);
    expect(calcules.includes("2025-12"), "mais il sert à comparer janvier").toBe(true);
  });
});
