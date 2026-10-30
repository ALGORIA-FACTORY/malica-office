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
import { lireUnMontantImprime, type DeviseLue } from "../montant-imprime.ts";

/** Une devise d'épreuve : les marques sont des données fictives, pas le référentiel. */
const devise = (decimales: number, separateurDecimal = ","): DeviseLue => ({
  decimales,
  separateurDecimal,
  marques: ["XX", "X.X.", "¤"],
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

  it("règle 5 : une parenthèse orpheline est du bruit, une paire qui reste refuse", () => {
    expect(lire("514,700)")).toEqual([514700]);
    expect(lire("(3 020,000))")).toEqual([]);
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
