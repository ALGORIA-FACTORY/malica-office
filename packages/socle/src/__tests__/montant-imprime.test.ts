/**
 * Le lecteur unique des montants imprimés : une épreuve par règle.
 *
 * Les règles sont écrites dans `montant-imprime.ts` ; la table de tout ce que
 * le dépôt imprime, lue par les deux chaînes, est dans
 * `apps/api/src/un-seul-lecteur-de-montants.test.ts`. Ici, chaque règle, et la
 * preuve que la devise en est une DONNÉE : le même texte se lit autrement
 * quand le référentiel déclare un autre séparateur ou un autre exposant.
 */
import { describe, expect, it } from "vitest";

import { enChiffresLatins } from "../chiffres.ts";
import { deviseDeLaPiece, lireUnMontantImprime, type DeviseLue } from "../montant-imprime.ts";

/** Des marques d'épreuve : des données fictives, pas le référentiel. */
const MARQUES = [
  { marque: "XX", devise: "XXX" },
  { marque: "X.X.", devise: "XXX" },
  { marque: "¤", devise: "YYY" },
];
/** Une devise d'épreuve, « XXX ». */
const devise = (decimales: number, separateurDecimal = ","): DeviseLue => ({
  code: "XXX",
  decimales,
  separateurDecimal,
  marques: MARQUES,
});
const lire = (texte: string, d = devise(3)) =>
  lireUnMontantImprime(texte, d).lectures.map((l) => l.mineur);

describe("le lecteur unique des montants imprimés", () => {
  it("règle 1 : les chiffres arabes et persans se lisent, et la lecture le dit", () => {
    expect(enChiffresLatins("٣٠٢٠ ۳۰۲۰")).toBe("3020 3020");
    const lu = lireUnMontantImprime("٣ ٠٢٠٫٠٠٠", devise(3));
    expect(lu.lectures.map((l) => l.mineur)).toEqual([3020000]);
    expect(lu.chiffresArabes).toBe(true);
    expect(lireUnMontantImprime("3 020,000", devise(3)).chiffresArabes).toBe(false);
    // « ٫ » est le séparateur décimal DE LA DEVISE, « ٬ » une apostrophe de milliers.
    expect(lire("٣٬٠٢٠٫٥", devise(3, "."))).toEqual([3020500]);
  });

  it("règle 2 : seules les marques du référentiel sont une décoration", () => {
    expect(lire("1 234,560 X.X.")).toEqual([1234560]);
    expect(lire("¤ 1 234,560")).toEqual([1234560]);
    expect(lire("Total 1 234,560")).toEqual([]);
    expect(lire("1 234,560 DT")).toEqual([]);
  });

  it("règles 3 et 4 : un taux, une date, une heure ne sont pas des montants", () => {
    for (const t of ["19%", "19 % 306,610", "08/09/2026", "23:18", "18:18"])
      expect(lire(t)).toEqual([]);
  });

  it("règle 5 : seul le moins en tête est un signe", () => {
    expect(lire("-1 234,560")).toEqual([-1234560]);
    expect(lire("- 1 234,560")).toEqual([-1234560]);
    for (const t of ["+ 135,183", "+135,183", "(514,700)", "1 234,560-", "1 2-34,560"])
      expect(lire(t)).toEqual([]);
  });

  it("règle 5 : une parenthèse, appariée ou orpheline, ne se lit pas", () => {
    // Revue de la PR 144 : « 1 234,560) » se lisait positif — un avoir coupé
    // par la plage devenait un achat. La fermante d'un MOT coupé se retire au
    // plan de jetons (`texteDuMontantCite`), pas ici.
    for (const t of ["514,700)", "(1 234,560", "1 234,560)", "(3 020,000))", "-(1 234,560)"])
      expect(lire(t)).toEqual([]);
  });

  it("règle 2 : la lecture dit de quelles devises sont les marques imprimées", () => {
    expect(lireUnMontantImprime("1 234,560 X.X.", devise(3)).devises).toEqual(["XXX"]);
    expect(lireUnMontantImprime("¤ 1 234,560", devise(3)).devises).toEqual(["YYY"]);
    expect(lireUnMontantImprime("1 234,560", devise(3)).devises).toEqual([]);
  });

  it("règle 6 : une espace ne sépare des milliers que si les groupes le prouvent", () => {
    expect(lire("1 234,560")).toEqual([1234560]);
    expect(lire("1 234 ,560")).toEqual([1234560]);
    expect(lire("12 3,500")).toEqual([]);
  });

  it("règle 7 : le séparateur décimal vient de la devise", () => {
    // La virgule décimale : « 100,000 » vaut 100 ; le point peut être l'un ou l'autre.
    expect(lire("100,000", devise(3, ","))).toEqual([100000]);
    expect(lire("100.000", devise(3, ","))).toEqual([100000, 100000000]);
    // Le point décimal : c'est l'inverse, sans toucher au lecteur.
    expect(lire("100.000", devise(3, "."))).toEqual([100000]);
    expect(lire("100,000", devise(3, "."))).toEqual([100000, 100000000]);
    // Trois chiffres qui ne peuvent pas être des décimales : des milliers.
    expect(lire("1,500", devise(0))).toEqual([1500]);
    expect(lire("12,345", devise(2))).toEqual([1234500]);
    // Les séparateurs mêlés : le dernier porte les décimales.
    expect(lire("1.234,560")).toEqual([1234560]);
    expect(lire("1,234.560")).toEqual([1234560]);
    expect(lire("1'234.560")).toEqual([1234560]);
    // Au-delà de l'exposant, des zéros seulement : jamais un arrondi.
    expect(lire("1234,5600")).toEqual([1234560]);
    expect(lire("12,3456")).toEqual([]);
    expect(lire("1,234,567")).toEqual([]);
  });

  it("règle 7 : une devise sans décimales n'en lit jamais ; un zéro n'ouvre pas des milliers", () => {
    // Revue de la PR 144 : « 5,000 » se lisait aussi 5 francs CFA, « 0.500 »
    // aussi 500 dinars.
    expect(lire("5,000", devise(0))).toEqual([5000]);
    expect(lire("5.000", devise(0))).toEqual([5000]);
    expect(lire("1 234,560", devise(0))).toEqual([]);
    expect(lire("0.500")).toEqual([500]);
    expect(lire("0,500")).toEqual([500]);
  });

  it("règle 7 : ce que la convention seule écarte est rendu à part", () => {
    expect(lireUnMontantImprime("100,000", devise(3)).ecarteesParConvention).toEqual([100000000]);
    expect(lireUnMontantImprime("100.000", devise(3)).ecarteesParConvention).toEqual([]);
    expect(lireUnMontantImprime("1 234,560", devise(3)).ecarteesParConvention).toEqual([]);
  });

  it("règle 8 : un premier groupe à zéro de tête est un morceau", () => {
    expect(lire("020,000")).toEqual([]);
    expect(lire("0,500")).toEqual([500]);
  });

  it("règle 9 : sans séparateur, en unités mineures ou en unités", () => {
    expect(lire("16000")).toEqual([16000, 16000000]);
    expect(lire("45")).toEqual([45000]);
    expect(lire("1 234 560")).toEqual([1234560, 1234560000]);
    expect(lire("1 234 560", devise(2))).toEqual([123456000]);
  });

  it("règle 10 : le même montant répété se lit une fois, deux montants jamais", () => {
    expect(lire("3 020,000 | 3 020,000")).toEqual([3020000]);
    expect(lire("514,700 200,000")).toEqual([]);
    expect(lire("3 020 3 020")).toEqual([]);
  });

  it("la plus petite échelle d'abord, et chaque lecture dit sa forme", () => {
    expect(lireUnMontantImprime("2.800", devise(3)).lectures).toEqual([
      { mineur: 2800, forme: "decimale", separateur: "." },
      { mineur: 2800000, forme: "milliers", separateur: "." },
    ]);
  });
});

describe("la devise de la pièce", () => {
  const de = (lue: string | null, textes: string[]) => deviseDeLaPiece(lue, textes, MARQUES, "XXX");

  it("une devise imprimée décide quand la lecture n'en dit pas", () => {
    expect(de(null, ["100,00 ¤", "119,00 ¤"])).toEqual({ code: "YYY", source: "imprimee" });
    expect(de(null, ["Total 119,00 ¤"])).toEqual({ code: "YYY", source: "imprimee" });
  });

  it("une devise imprimée qui contredit la devise lue refuse", () => {
    expect(de("XXX", ["100,00 ¤"])).toEqual({
      code: null,
      raison: "devise imprimée (YYY) ≠ devise lue (XXX)",
    });
  });

  it("deux devises imprimées : on ne choisit pas", () => {
    expect(de(null, ["100,00 ¤", "100,000 XX"]).code).toBeNull();
  });

  it("sans devise lue ni imprimée, celle du dossier — et la source le dit", () => {
    expect(de(null, ["100,000"])).toEqual({ code: "XXX", source: "dossier" });
    expect(de("xxx", ["100,000 X.X."])).toEqual({ code: "XXX", source: "lue" });
  });
});
