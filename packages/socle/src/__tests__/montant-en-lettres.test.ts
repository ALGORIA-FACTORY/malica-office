/**
 * Le montant en toutes lettres, lu avec le lexique du pack — et la lettre de
 * contrôle d'un matricule, qui avertit sans bloquer.
 *
 * Les phrases viennent du jeu de 150 factures fictives du dirigeant (1er
 * novembre 2026) : 100/A-01, A-03, A-04, D-04, et les trois factures arabes du
 * jeu de 50 achats (10, 25, 43).
 */
import { describe, expect, it } from "vitest";

import { lettreDeControle, normaliserMatricule } from "../matricule.ts";
import { lireLeMontantEnLettres } from "../montant-en-lettres.ts";

import { FORMAT_D_ESSAI, LEXIQUE_D_ESSAI } from "./regles-de-lecture-d-essai.ts";

const lire = (phrase: string) => lireLeMontantEnLettres(phrase.split(" "), LEXIQUE_D_ESSAI);

describe("un montant en lettres, en français", () => {
  it("lit les dinars et les millimes", () => {
    expect(
      lire("Onze mille sept cent quatre dinars et six cent cinquante millimes. TECHNOPRO SARL"),
    ).toEqual({ devise: "TND", majeures: 11704, mineures: 650, mots: 11 });
  });

  it("lit les composés à traits d'union, et « et un »", () => {
    expect(
      lire("Neuf cent quatre-vingt-quatre dinars et six cent cinquante-quatre millimes."),
    ).toMatchObject({ majeures: 984, mineures: 654 });
    expect(
      lire("Quarante et un mille neuf cent quatre-vingt-dix dinars et cent cinquante millimes"),
    ).toMatchObject({ majeures: 41990, mineures: 150 });
    expect(
      lire("Mille neuf cent quatre-vingt-dix dinars et six cent quatre-vingts millimes"),
    ).toMatchObject({ majeures: 1990, mineures: 680 });
  });

  it("lit un montant sans millimes, et s'arrête au premier mot qui n'en est pas un", () => {
    expect(lire("Trois mille deux cents dinars. IMPRIMERIE ESSALEM")).toEqual({
      devise: "TND",
      majeures: 3200,
      mineures: null,
      mots: 5,
    });
  });

  it("ne lit rien plutôt que de deviner", () => {
    // un mot illisible avant l'unité
    expect(lire("Trois mille deux cinguante dinars")).toBeNull();
    // un mot illisible après une liaison : la part des millimes manque (OCR de 100/A-13)
    expect(lire("Onze mille six cent trois dinars et cing cent millimes.")).toBeNull();
    // des nombres que nulle unité ne ferme
    expect(lire("Trois mille dinars et six cent cinquante")).toBeNull();
    // une unité sans nombre
    expect(lire("dinars et cinq cents millimes")).toBeNull();
    // aucun montant
    expect(lire("Conditions de règlement")).toBeNull();
  });
});

describe("un montant en lettres, en arabe", () => {
  it("lit les mots liés par « و », collés ou séparés", () => {
    expect(lire("ثلاثة آلاف و ستة و ستون دينارا و خمسمائة مليما Signature")).toMatchObject({
      devise: "TND",
      majeures: 3066,
      mineures: 500,
    });
    expect(lire("ألفان و تسعمائة و ثمانية و خمسون دينارا و مائة و خمسون مليما")).toMatchObject({
      majeures: 2958,
      mineures: 150,
    });
    expect(lire("ألف ومائتان وأربعة وثلاثون دينارا وخمسمائة مليم")).toMatchObject({
      majeures: 1234,
      mineures: 500,
    });
  });
});

describe("la lettre de contrôle du matricule", () => {
  it("se calcule par la règle du pack, et dit seulement « discordante »", () => {
    // 1876543 : 7·1 + 6·8 + 5·7 + 4·6 + 3·5 + 2·4 + 1·3 = 140 ; 140 mod 23 = 2 → C.
    const juste = normaliserMatricule("1876543C/A/M/000", FORMAT_D_ESSAI);
    expect(lettreDeControle(juste, FORMAT_D_ESSAI)).toBe("conforme");
    const fausse = normaliserMatricule("1876543W/A/M/000", FORMAT_D_ESSAI);
    expect(lettreDeControle(fausse, FORMAT_D_ESSAI)).toBe("discordante");
    // La forme reste complète : la lettre avertit, elle ne défait pas la lecture.
    expect(fausse.forme).toBe("complete");
    expect(FORMAT_D_ESSAI.controle?.effet).toBe("avertit");
  });

  it("ne dit rien d'un matricule sans lettre", () => {
    const partiel = normaliserMatricule("1856324/A/M/000", FORMAT_D_ESSAI);
    expect(lettreDeControle(partiel, FORMAT_D_ESSAI)).toBeNull();
  });
});
