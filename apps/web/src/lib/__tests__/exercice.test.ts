import { describe, expect, it } from "vitest";

import { debutDExercice, finDuMois } from "../exercice";

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
