import { describe, expect, it } from "vitest";

import { deMois, montant, montantSigne } from "../lisible";

describe("un montant, dans la langue du lecteur", () => {
  it("groupe les milliers et pose la virgule française", () => {
    expect(montant("1240.500", "fr")).toBe("1\u202f240,500");
    expect(montant("6420.000", "fr")).toBe("6\u202f420,000");
  });

  it("garde les décimales que le Socle a décidées", () => {
    // Trois pour le dinar, deux pour l'euro : ce n'est pas l'écran qui tranche.
    expect(montant("89.000", "fr")).toBe("89,000");
    expect(montant("89.00", "fr")).toBe("89,00");
    expect(montant("89", "fr")).toBe("89");
  });

  it("ne perd pas un chiffre sur un grand nombre", () => {
    // Passer par Number() arrondirait au-delà de quinze chiffres significatifs.
    expect(montant("123456789012345678.123", "fr")).toBe(
      "123\u202f456\u202f789\u202f012\u202f345\u202f678,123",
    );
  });

  it("marque le négatif avec un vrai signe moins", () => {
    expect(montant("-340.000", "fr")).toBe("−340,000");
  });

  it("suit la langue", () => {
    expect(montant("1240.5", "en")).toBe("1,240.5");
  });

  it("signe le positif, et lui seul", () => {
    expect(montantSigne("180.500", "fr")).toBe("+180,500");
    expect(montantSigne("-180.500", "fr")).toBe("−180,500");
    expect(montantSigne("0.000", "fr")).toBe("0,000");
  });
});

describe("« de » ou « d' » devant un mois", () => {
  it("élide devant une voyelle", () => {
    for (const m of ["avril", "août", "octobre"]) {
      expect(deMois(m, "fr")).toBe(`d'${m}`);
    }
  });

  it("n'élide pas devant une consonne", () => {
    for (const m of ["mars", "juin", "septembre", "décembre"]) {
      expect(deMois(m, "fr")).toBe(`de ${m}`);
    }
  });

  it("laisse les autres langues tranquilles", () => {
    expect(deMois("August", "en")).toBe("August");
    expect(deMois("أوت", "ar")).toBe("أوت");
  });
});
