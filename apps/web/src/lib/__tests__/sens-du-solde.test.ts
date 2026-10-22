import { describe, expect, it } from "vitest";

import { sensDuSolde } from "../sens-du-solde";

describe("la présentation du solde du moteur", () => {
  it("ne présente pas un solde nul comme un crédit", () => {
    for (const valeur of ["0", "0.000", "-0.000"]) expect(sensDuSolde(valeur)).toBe("nul");
  });

  it("ne présente pas une absence ou une valeur illisible comme un crédit", () => {
    for (const valeur of [null, "", " ", "NaN", "Infinity", "inconnu"])
      expect(sensDuSolde(valeur)).toBe("inconnu");
  });

  it("conserve le sens des soldes effectivement servis", () => {
    expect(sensDuSolde("12.345")).toBe("du");
    expect(sensDuSolde("-12.345")).toBe("credit");
  });
});
