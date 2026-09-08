/**
 * Le pluriel se choisit, il ne s'écrit pas entre parenthèses.
 *
 * Ces épreuves portent sur DEUX choses, et la seconde est la plus fragile :
 *
 *   1. le moteur choisit la bonne forme selon la langue et le nombre ;
 *   2. le dictionnaire porte réellement ces formes, dans les trois langues.
 *
 * La seconde se casse silencieusement : ajouter `clé#one` en français et
 * l'oublier en arabe ne fait échouer aucun rendu — la chaîne de repli le
 * masque. Le test, lui, le voit.
 */
import { describe, expect, it } from "vitest";

import { LOCALES, MESSAGES, type Locale } from "@malica/socle/messages";

/** Le choix de forme du moteur, isolé de React. */
function forme(locale: Locale, n: number): string {
  return new Intl.PluralRules(locale).select(n);
}

/** Ce que `t()` rendrait : la variante, son repli, puis la clé nue. */
function rendu(locale: Locale, cle: string, n: number): string {
  const dict = MESSAGES[locale] as Record<string, string>;
  for (const suffixe of [forme(locale, n), "other"]) {
    const v = dict[`${cle}#${suffixe}`];
    if (v !== undefined) return v.replaceAll("{count}", String(n));
  }
  return (dict[cle] ?? cle).replaceAll("{count}", String(n));
}

/** Toutes les clés qui déclarent une forme de pluriel. */
const CLES_PLURIELLES = [
  ...new Set(
    Object.keys(MESSAGES.fr)
      .filter((k) => k.includes("#"))
      .map((k) => k.slice(0, k.indexOf("#"))),
  ),
];

describe("le moteur choisit la forme selon la langue", () => {
  it("le français distingue un et plusieurs", () => {
    expect(rendu("fr", "pme.doc.compte", 1)).toBe("1 pièce");
    expect(rendu("fr", "pme.doc.compte", 4)).toBe("4 pièces");
  });

  it("zéro se dit au singulier en français, au pluriel en anglais", () => {
    // « 0 pièce » et « 0 items » : ce n'est pas une inconséquence, c'est la
    // règle de chaque langue, et c'est exactement ce qu'Intl encode.
    expect(rendu("fr", "pme.doc.compte", 0)).toBe("0 pièce");
    expect(rendu("en", "pme.doc.compte", 0)).toBe("0 items");
  });

  it("l'anglais distingue un et plusieurs", () => {
    expect(rendu("en", "pme.doc.compte", 1)).toBe("1 item");
    expect(rendu("en", "pme.doc.compte", 7)).toBe("7 items");
  });

  it("une forme absente retombe sur le pluriel, jamais sur la parenthèse", () => {
    // L'arabe compte six formes ; le dictionnaire en porte deux. Les quatre
    // autres doivent rendre un pluriel correct, pas « وثيقة(s) ».
    for (const n of [0, 2, 3, 11, 100]) {
      expect(rendu("ar", "pme.doc.compte", n)).not.toContain("(s)");
    }
  });
});

describe("le dictionnaire porte ses formes dans les trois langues", () => {
  it("déclare au moins une clé plurielle", () => {
    expect(CLES_PLURIELLES.length).toBeGreaterThan(0);
  });

  it.each(LOCALES)("« %s » porte les mêmes formes que le français", (locale) => {
    const attendues = Object.keys(MESSAGES.fr).filter((k) => k.includes("#"));
    const presentes = Object.keys(MESSAGES[locale]).filter((k) => k.includes("#"));
    expect(presentes.sort()).toEqual(attendues.sort());
  });

  it.each(LOCALES)("« %s » ne laisse aucun pluriel entre parenthèses", (locale) => {
    const fautives = Object.entries(MESSAGES[locale])
      .filter(([, v]) => /\((e|es|s|ies)\)/.test(v))
      .map(([k]) => k);
    expect(fautives).toEqual([]);
  });

  it("chaque clé plurielle a bien ses deux formes, et elles diffèrent", () => {
    const dict = MESSAGES.fr as Record<string, string>;
    for (const cle of CLES_PLURIELLES) {
      expect(dict[`${cle}#one`], `${cle}#one`).toBeDefined();
      expect(dict[`${cle}#other`], `${cle}#other`).toBeDefined();
      // Deux formes identiques trahissent un accord oublié — sauf quand la
      // langue ne varie pas, ce que l'anglais fait légitimement.
      expect(dict[`${cle}#one`]).not.toBe(dict[`${cle}#other`]);
    }
  });

  it("la clé nue existe encore : c'est le dernier repli", () => {
    const dict = MESSAGES.fr as Record<string, string>;
    for (const cle of CLES_PLURIELLES) {
      expect(dict[cle], cle).toBeDefined();
    }
  });
});
