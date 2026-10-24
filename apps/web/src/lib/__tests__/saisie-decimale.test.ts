import { describe, expect, it } from "vitest";
import { montant } from "../lisible";
import { saisieDecimale } from "../saisie-decimale";

describe("saisie d'un montant", () => {
  it("relit ce que l'écran affiche, milliers compris", () => {
    expect(saisieDecimale("1 234,500")).toBe("1234.500");
    expect(saisieDecimale("1\u00a0234,500")).toBe("1234.500");
    expect(saisieDecimale("1\u202f234,500")).toBe("1234.500");
    expect(saisieDecimale(montant("1234.500", "fr"))).toBe("1234.500");
  });

  it("garde la chaîne du Socle telle quelle", () => {
    expect(saisieDecimale("1234.500")).toBe("1234.500");
    expect(saisieDecimale(" 12 ")).toBe("12");
  });

  it("lit les chiffres et le séparateur arabes", () => {
    expect(saisieDecimale("١٢٣٤٫٥٠٠")).toBe("1234.500");
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
