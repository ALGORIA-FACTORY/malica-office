import { describe, expect, it } from "vitest";

import { evaluerLeCalcul } from "../calcul.ts";

describe("le calcul de Malica", () => {
  it("rend un pourcentage exact, et nomme ses opérandes", () => {
    expect(evaluerLeCalcul("2 450 * 17 / 100")).toEqual({
      valeur: "416.5",
      operandes: ["2450", "17", "100"],
    });
    expect(evaluerLeCalcul("17 % × 2450").valeur).toBe("416.5");
  });

  it("calcule en décimal, jamais en flottant", () => {
    expect(evaluerLeCalcul("0,1 + 0,2").valeur).toBe("0.3");
    expect(evaluerLeCalcul("1200 * (1 + 19 %)").valeur).toBe("1428");
    expect(evaluerLeCalcul("10 / 3").valeur).toBe("3.333333");
    expect(evaluerLeCalcul("-(2 − 5) ÷ 2").valeur).toBe("1.5");
  });

  it("refuse ce qui n'est pas une opération", () => {
    for (const e of ["", "abc", "2 +", "(2 + 3", "2 ** 3", "A2*(1+B2)", "process.exit()"]) {
      expect(() => evaluerLeCalcul(e), e).toThrow("calcul.invalide");
    }
    expect(() => evaluerLeCalcul("5 / (2 - 2)")).toThrow("calcul.division_par_zero");
    expect(() => evaluerLeCalcul("1+".repeat(200) + "1")).toThrow("calcul.trop_long");
  });
});
