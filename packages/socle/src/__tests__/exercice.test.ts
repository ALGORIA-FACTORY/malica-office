import { describe, expect, it } from "vitest";

import { arreteDuCumul, debutDExercice, finDuMois } from "../exercice.ts";

describe("finDuMois", () => {
  it("connaît les mois courts, longs et bissextiles", () => {
    expect(finDuMois("2026-02")).toBe("2026-02-28");
    expect(finDuMois("2028-02")).toBe("2028-02-29");
    expect(finDuMois("2026-04")).toBe("2026-04-30");
    expect(finDuMois("2026-12")).toBe("2026-12-31");
  });
});

describe("debutDExercice", () => {
  it("sans clôture, c'est l'année civile", () => {
    expect(debutDExercice(null, "2026-09")).toBe("2026-01-01");
  });

  it("une clôture au 31 décembre donne aussi l'année civile", () => {
    expect(debutDExercice("12-31", "2026-09")).toBe("2026-01-01");
    expect(debutDExercice("2025-12-31", "2026-02")).toBe("2026-01-01");
  });

  it("une clôture décalée fait commencer l'exercice au lendemain, l'année qu'il faut", () => {
    // Clôture au 30 juin : l'exercice commence le 1er juillet.
    expect(debutDExercice("06-30", "2026-09")).toBe("2026-07-01");
    expect(debutDExercice("06-30", "2026-03")).toBe("2025-07-01");
    expect(debutDExercice("06-30", "2026-07")).toBe("2026-07-01");
  });
});

describe("arreteDuCumul", () => {
  it("arrête le mois en cours au jour même, pas à sa fin", () => {
    expect(arreteDuCumul("2026-11", "2026-11-05")).toBe("2026-11-05");
  });
  it("arrête un mois passé à sa fin", () => {
    expect(arreteDuCumul("2026-10", "2026-11-05")).toBe("2026-10-31");
  });
  it("arrête à la fin le dernier jour du mois, et un mois à venir aussi", () => {
    expect(arreteDuCumul("2026-11", "2026-11-30")).toBe("2026-11-30");
    expect(arreteDuCumul("2026-12", "2026-11-05")).toBe("2026-12-31");
  });
});
