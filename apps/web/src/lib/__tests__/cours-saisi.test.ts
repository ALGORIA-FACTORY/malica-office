/**
 * Un cours tapé se relit comme la base le reçoit, ou ne se relit pas : rien
 * n'est deviné (31 octobre 2026). Les taux sont des valeurs de forme.
 */
import { describe, expect, it } from "vitest";

import { coursSaisi } from "../cours-saisi";

describe("un cours de change tapé", () => {
  it("se relit en décimal exact, dans la langue de la personne", () => {
    expect(coursSaisi("3,3456", "1")).toEqual({ taux: "3.3456", unite: 1 });
    expect(coursSaisi(" 20.1234 ", " 1000 ")).toEqual({ taux: "20.1234", unite: 1000 });
  });

  it("un taux nul, négatif, ou illisible ne se relit pas", () => {
    for (const taux of ["", "0", "0,000", "-3,3", "3,3,3", "trois"])
      expect(coursSaisi(taux, "1")).toBeNull();
  });

  it("une unité qui n'est pas une puissance de dix ne se relit pas", () => {
    for (const unite of ["", "0", "12", "100,5", "1e3"])
      expect(coursSaisi("3,3", unite)).toBeNull();
  });
});
