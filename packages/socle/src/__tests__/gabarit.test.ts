/**
 * Les épreuves du gabarit de phrase — remplir sans déformer, élider comme on écrit.
 *
 * `remplirLeGabarit` place les valeurs dans les messages affichés. Ces épreuves
 * garantissent qu'une valeur est insérée telle quelle même si elle ressemble à un motif
 * de remplacement (`$&`, `$1`…), et que « de » s'élide en « d’ » devant une voyelle
 * (accentuée ou non, majuscule comprise) mais pas devant une consonne, un h, un chiffre,
 * un signe ou un nombre : « Retour d’AUDICORP », jamais « Retour de AUDICORP ».
 */
import { describe, expect, it } from "vitest";

import { remplirLeGabarit } from "../gabarit.ts";

describe("remplirLeGabarit", () => {
  it("place chaque valeur, autant de fois qu'elle est citée", () => {
    expect(remplirLeGabarit("{a} puis {b}, encore {a}", { a: "x", b: 2 })).toBe(
      "x puis 2, encore x",
    );
  });

  it("insère une valeur telle quelle, même si elle ressemble à un motif de remplacement", () => {
    for (const v of ["$&", "$'", "$`", "$$", "$1"])
      expect(remplirLeGabarit("« {valeur} »", { valeur: v })).toBe(`« ${v} »`);
  });
});

describe("l'élision de « de » devant une voyelle", () => {
  const retour = (qui: string) => remplirLeGabarit("Retour de {qui}", { qui });

  it("élide devant A E I O U Y, en majuscule comme en minuscule", () => {
    expect(retour("AUDICORP")).toBe("Retour d’AUDICORP");
    expect(retour("Amel")).toBe("Retour d’Amel");
    expect(retour("Imen")).toBe("Retour d’Imen");
    expect(retour("Omar")).toBe("Retour d’Omar");
    expect(retour("Ursula")).toBe("Retour d’Ursula");
    expect(retour("Yasmine")).toBe("Retour d’Yasmine");
    expect(retour("expertise sarl")).toBe("Retour d’expertise sarl");
  });

  it("élide devant une voyelle accentuée, majuscule comprise", () => {
    expect(retour("Émilie")).toBe("Retour d’Émilie");
    expect(retour("ÉTUDES ET CONSEIL")).toBe("Retour d’ÉTUDES ET CONSEIL");
    expect(retour("Île Conseil")).toBe("Retour d’Île Conseil");
    expect(retour("Œuvre")).toBe("Retour d’Œuvre");
  });

  it("garde « de » devant une consonne, un h (muet ou non), un chiffre ou un signe", () => {
    expect(retour("CABINET D’ESSAI")).toBe("Retour de CABINET D’ESSAI");
    expect(retour("Hédi")).toBe("Retour de Hédi");
    expect(retour("Hélène")).toBe("Retour de Hélène");
    expect(retour("3F Conseil")).toBe("Retour de 3F Conseil");
    expect(retour("« Atlas »")).toBe("Retour de « Atlas »");
    expect(retour("")).toBe("Retour de ");
  });

  it("garde la majuscule de « De » en tête de phrase", () => {
    expect(remplirLeGabarit("De {qui}, rien", { qui: "Amel" })).toBe("D’Amel, rien");
  });

  it("ne lit que le mot entier « de » devant la variable", () => {
    expect(remplirLeGabarit("Procède {x}", { x: "ainsi" })).toBe("Procède ainsi");
    expect(remplirLeGabarit("code {x}", { x: "A1" })).toBe("code A1");
    expect(remplirLeGabarit("de {y} pour {x}", { x: "Amel", y: "Sami" })).toBe("de Sami pour Amel");
  });

  it("élide chaque occurrence, et la même valeur ailleurs reste telle quelle", () => {
    expect(
      remplirLeGabarit("{cabinet} a ouvert le dossier de {pme} — {pme}", {
        cabinet: "X",
        pme: "ALGORIA",
      }),
    ).toBe("X a ouvert le dossier d’ALGORIA — ALGORIA");
  });

  it("ne touche pas aux nombres", () => {
    expect(remplirLeGabarit("En hausse de {pourcent} %", { pourcent: 8 })).toBe("En hausse de 8 %");
  });
});
