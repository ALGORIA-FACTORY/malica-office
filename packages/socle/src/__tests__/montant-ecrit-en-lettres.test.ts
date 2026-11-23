/**
 * Le montant écrit en toutes lettres, sur la facture de Malica Office (23 novembre 2026).
 *
 * Les noms de la devise sont ceux que la base sème (`ref.devises_ecrites`) ; ils sont recopiés
 * ici comme jeu d'essai, pas comme vérité. La preuve la plus forte est le ALLER-RETOUR : ce que
 * l'écrivain écrit, le lecteur de lettres du pack (`lireLeMontantEnLettres`, lexique du pack)
 * le relit au même montant, en français et en arabe.
 */
import { describe, expect, it } from "vitest";

import { ecrireLeMontantEnLettres, type NomsDeLaDevise } from "../montant-ecrit-en-lettres.ts";
import { lireLeMontantEnLettres } from "../montant-en-lettres.ts";

import { LEXIQUE_D_ESSAI } from "./regles-de-lecture-d-essai.ts";

const FR: NomsDeLaDevise = {
  majeure: { singulier: "dinar", pluriel: "dinars" },
  mineure: { singulier: "millime", pluriel: "millimes" },
};
const EN: NomsDeLaDevise = FR;
const AR: NomsDeLaDevise = {
  majeure: { singulier: "دينار", pluriel: "دنانير", duel: "ديناران", accusatif: "دينارا" },
  mineure: { singulier: "مليم", pluriel: "مليمات", duel: "مليمان", accusatif: "مليما" },
};

const fr = (m: string) => ecrireLeMontantEnLettres(m, 3, "fr", FR);
const en = (m: string) => ecrireLeMontantEnLettres(m, 3, "en", EN);
const ar = (m: string) => ecrireLeMontantEnLettres(m, 3, "ar", AR);

describe("en français", () => {
  it("écrit les dinars et les millimes", () => {
    expect(fr("1234.500")).toBe("mille deux cent trente-quatre dinars et cinq cents millimes");
    expect(fr("119.000")).toBe("cent dix-neuf dinars");
    expect(fr("1")).toBe("un dinar");
    expect(fr("0.250")).toBe("deux cent cinquante millimes");
    expect(fr("21.001")).toBe("vingt et un dinars et un millime");
  });

  it("tient les accords de vingt, cent et mille", () => {
    expect(fr("80")).toBe("quatre-vingts dinars");
    expect(fr("81")).toBe("quatre-vingt-un dinars");
    expect(fr("71")).toBe("soixante et onze dinars");
    expect(fr("91")).toBe("quatre-vingt-onze dinars");
    expect(fr("200")).toBe("deux cents dinars");
    expect(fr("200000")).toBe("deux cent mille dinars");
    expect(fr("80000")).toBe("quatre-vingt mille dinars");
    expect(fr("99.999")).toBe(
      "quatre-vingt-dix-neuf dinars et neuf cent quatre-vingt-dix-neuf millimes",
    );
  });

  it("dit « de » après un million rond", () => {
    expect(fr("2000000")).toBe("deux millions de dinars");
    expect(fr("1000001")).toBe("un million un dinars");
  });
});

describe("en anglais", () => {
  it("écrit les dinars et les millimes", () => {
    expect(en("1234.5")).toBe(
      "one thousand two hundred thirty-four dinars and five hundred millimes",
    );
    expect(en("1")).toBe("one dinar");
    expect(en("40.001")).toBe("forty dinars and one millime");
  });
});

describe("en arabe", () => {
  it("écrit les dinars et les millimes, le nom compté à sa forme", () => {
    expect(ar("1234.500")).toBe("ألف ومائتان وأربعة وثلاثون دينارا وخمسمائة مليم");
    expect(ar("1")).toBe("دينار واحد");
    expect(ar("2")).toBe("ديناران");
    expect(ar("5")).toBe("خمسة دنانير");
    expect(ar("15")).toBe("خمسة عشر دينارا");
    expect(ar("100")).toBe("مائة دينار");
    expect(ar("3000")).toBe("ثلاثة آلاف دينار");
  });
});

describe("le même montant, relu par le lecteur du pack", () => {
  const montants = ["1234.500", "119", "21.001", "80", "71.071", "99.999", "200000", "45678.910"];

  it("en français", () => {
    for (const m of montants) {
      const [maj, min = ""] = m.split(".");
      const lu = lireLeMontantEnLettres(fr(m).split(" "), LEXIQUE_D_ESSAI);
      expect(lu, m).toMatchObject({ majeures: Number(maj) });
      expect(lu?.mineures ?? 0, m).toBe(Number(min.padEnd(3, "0")));
    }
  });

  it("en arabe", () => {
    for (const m of ["1234.500", "119", "45678.910", "15.015"]) {
      const [maj, min = ""] = m.split(".");
      const lu = lireLeMontantEnLettres(ar(m).split(" "), LEXIQUE_D_ESSAI);
      expect(lu, m).toMatchObject({ majeures: Number(maj) });
      expect(lu?.mineures ?? 0, m).toBe(Number(min.padEnd(3, "0")));
    }
  });
});

describe("ce qui ne s'écrit pas", () => {
  it("refuse un montant mal formé, négatif, ou plus précis que la devise", () => {
    expect(() => fr("-1")).toThrow("lettres.montant_invalide");
    expect(() => fr("1,5")).toThrow("lettres.montant_invalide");
    expect(() => fr("1.0001")).toThrow("lettres.montant_invalide");
    expect(() => fr("1000000000000")).toThrow("lettres.montant_trop_grand");
  });

  it("refuse une forme arabe absente plutôt que d'écrire une phrase fausse", () => {
    expect(() =>
      ecrireLeMontantEnLettres("2", 3, "ar", {
        majeure: { singulier: "دينار", pluriel: "دنانير" },
        mineure: AR.mineure,
      }),
    ).toThrow("lettres.forme_manquante");
  });
});
