import { describe, expect, it } from "vitest";

import { refusDeSaisie, saisieDecimale } from "../saisie-decimale.ts";

describe("saisie d'un montant", () => {
  it("relit les espaces de milliers, quelles qu'elles soient", () => {
    expect(saisieDecimale("1 234,500")).toBe("1234.500");
    expect(saisieDecimale("1 234,500")).toBe("1234.500");
    expect(saisieDecimale("1 234,500")).toBe("1234.500");
  });

  it("garde la chaîne du Socle telle quelle", () => {
    expect(saisieDecimale("1234.500")).toBe("1234.500");
    expect(saisieDecimale(" 12 ")).toBe("12");
  });

  it("lit les chiffres et le séparateur arabes", () => {
    expect(saisieDecimale("١٢٣٤٫٥٠٠")).toBe("1234.500");
    expect(saisieDecimale("۱۲۳۴٫۵")).toBe("1234.5");
  });

  it("refuse de deviner un texte qui mêle virgule et point", () => {
    expect(saisieDecimale("1,234.500")).toBeNull();
    expect(saisieDecimale("1.234,500")).toBeNull();
  });

  it("refuse ce qui n'est pas un montant", () => {
    expect(saisieDecimale("")).toBeNull();
    expect(saisieDecimale("12,5,0")).toBeNull();
    expect(saisieDecimale("-5")).toBeNull();
    expect(saisieDecimale("abc")).toBeNull();
  });
});

describe("pourquoi une saisie de montant ne s'inscrit pas", () => {
  it("dit la raison, au lieu de griser sans un mot", () => {
    expect(refusDeSaisie("12,500", 3)).toBeNull();
    expect(refusDeSaisie("1 234,5000", 3)).toBeNull();
    expect(refusDeSaisie("0,0001", 3)).toBe("trop_precis");
    expect(refusDeSaisie("12,345", 2)).toBe("trop_precis");
    expect(refusDeSaisie("-5", 3)).toBe("negatif");
    expect(refusDeSaisie("− 1 234,5", 3)).toBe("negatif");
    expect(refusDeSaisie("abc", 3)).toBe("illisible");
    expect(refusDeSaisie("-abc", 3)).toBe("illisible");
  });
});
