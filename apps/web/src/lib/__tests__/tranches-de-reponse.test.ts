import { describe, expect, it } from "vitest";

import type { BlocDeReponse } from "@malica/socle/ports/assistant";

import { tranchesDeReponse } from "../tranches-de-reponse";

const bloc = (titre: string, apres?: number): BlocDeReponse => ({
  type: "tableau",
  titre,
  periode: null,
  perimetre: null,
  source: "s",
  colonnes: [],
  lignes: [],
  total: null,
  ...(apres === undefined ? {} : { apres }),
});
const forme = (t: ReturnType<typeof tranchesDeReponse>) =>
  t.map((x) => (x.genre === "texte" ? x.texte : x.blocs.map((b) => `[${b.titre}]`).join("")));

const ANNONCE = "Je regarde vos achats.";
const TEXTE = `${ANNONCE}\n\nSismara pèse le plus.\n\nUne pièce est écartée.`;

describe("les tranches d'une réponse", () => {
  it("pose le bloc là où Malica l'a montré : après l'annonce, avant la suite", () => {
    expect(forme(tranchesDeReponse(TEXTE, [bloc("A", ANNONCE.length)]))).toEqual([
      ANNONCE,
      "[A]",
      "Sismara pèse le plus.\n\nUne pièce est écartée.",
    ]);
  });

  it("ne coupe jamais un paragraphe : une place au milieu passe à la fin du paragraphe", () => {
    expect(forme(tranchesDeReponse(TEXTE, [bloc("A", ANNONCE.length + 10)]))).toEqual([
      `${ANNONCE}\n\nSismara pèse le plus.`,
      "[A]",
      "Une pièce est écartée.",
    ]);
  });

  it("un bloc montré avant tout texte vient en premier ; sans place, il vient après le texte", () => {
    expect(forme(tranchesDeReponse(TEXTE, [bloc("A", 0)]))).toEqual(["[A]", TEXTE]);
    expect(forme(tranchesDeReponse(TEXTE, [bloc("A")]))).toEqual([TEXTE, "[A]"]);
  });

  it("deux blocs au même endroit se suivent, dans l'ordre où ils ont été montrés", () => {
    expect(
      forme(tranchesDeReponse(TEXTE, [bloc("A", ANNONCE.length), bloc("B", ANNONCE.length)])),
    ).toEqual([ANNONCE, "[A][B]", "Sismara pèse le plus.\n\nUne pièce est écartée."]);
  });

  it("pendant le flux, un bloc dont la place n'est pas encore écrite attend après le texte reçu", () => {
    expect(forme(tranchesDeReponse("Je regarde", [bloc("A", 400)]))).toEqual(["Je regarde", "[A]"]);
    expect(forme(tranchesDeReponse("", [bloc("A", 0)]))).toEqual(["[A]"]);
    expect(forme(tranchesDeReponse("Bonjour.", []))).toEqual(["Bonjour."]);
  });
});
