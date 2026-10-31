import { describe, expect, it } from "vitest";

import { texteSansUnicode } from "../texte-sans-unicode.ts";

/*
 * Relevé sur le jeu synthétique (cas 047, 31 octobre 2026) : la couche de
 * texte d'un PDF imprimé par Chromium rend « إشعار دائن » en glyphes liés
 * sans correspondance Unicode — des U+0000 et des formes de présentation
 * isolées, dans l'ordre visuel. Les caractères sont écrits en échappements :
 * une réécriture de fichier a déjà perdu des plages d'écriture arabe (`mots.ts`).
 */
describe("un texte qui ne se ramène pas à l'Unicode", () => {
  it("un glyphe sans correspondance (U+0000) : le texte est perdu", () => {
    expect(texteSansUnicode("ن\u0000 \u0000 ا")).toBe(true);
  });

  it("le caractère de remplacement (U+FFFD) : le texte est perdu", () => {
    expect(texteSansUnicode("FACTURE �")).toBe(true);
  });

  it("une forme de présentation arabe isolée : le mot n'est plus lisible", () => {
    // « ﺢ » (U+FEA2), « ﺴ » (U+FEB4) : relevés tels quels sur le cas 041.
    expect(texteSansUnicode("ﺢ ﺴ")).toBe(true);
  });

  it("un texte arabe en lettres de base se lit", () => {
    // « إشعار دائن »
    expect(texteSansUnicode("إشعار دائن")).toBe(false);
  });

  it("un texte français, des chiffres arabes orientaux, une tabulation : rien de perdu", () => {
    expect(texteSansUnicode("FACTURE N° F-2026/0042\t٢٠٢٦")).toBe(false);
  });
});
