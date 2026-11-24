import { describe, expect, it } from "vitest";

import { casesDuMois, unJourParColonne } from "./calendrier-du-mois";

describe("casesDuMois", () => {
  it("commence la grille le lundi : novembre 2026 s'ouvre un dimanche", () => {
    const cases = casesDuMois("2026-11");
    expect(cases.slice(0, 7)).toEqual([null, null, null, null, null, null, "2026-11-01"]);
    expect(cases.at(-1)).toBe("2026-11-30");
    expect(cases.filter((c) => c !== null)).toHaveLength(30);
  });

  it("n'ajoute aucune case vide quand le premier est un lundi", () => {
    expect(casesDuMois("2026-06")[0]).toBe("2026-06-01");
  });

  it("compte février selon l'année", () => {
    expect(casesDuMois("2028-02").filter(Boolean)).toHaveLength(29);
    expect(casesDuMois("2026-02").filter(Boolean)).toHaveLength(28);
  });
});

describe("unJourParColonne", () => {
  it("donne un jour par colonne, du lundi au dimanche", () => {
    const jours = unJourParColonne("2026-11");
    expect(jours).toHaveLength(7);
    expect(jours.map((j) => new Date(`${j}T00:00:00Z`).getUTCDay())).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });
});
