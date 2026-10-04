import { describe, expect, it } from "vitest";

import { deMois, montant, montantSigne, quantite } from "../lisible";

describe("un montant, dans la langue du lecteur", () => {
  it("groupe les milliers et pose la virgule française", () => {
    expect(montant("1240.500", "fr")).toBe("1\u00a0240,500");
    expect(montant("6420.000", "fr")).toBe("6\u00a0420,000");
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
      "123\u00a0456\u00a0789\u00a0012\u00a0345\u00a0678,123",
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

describe("une quantité n'est pas un montant", () => {
  it("retire les zéros de queue que la colonne impose", () => {
    expect(quantite("300.000", "fr-FR")).toBe("300");
    expect(quantite("1.000", "fr-FR")).toBe("1");
    expect(quantite("5.000", "fr-FR")).toBe("5");
  });

  it("garde la décimale qui compte", () => {
    expect(quantite("2.500", "fr-FR")).toBe("2,5");
    expect(quantite("0.750", "fr-FR")).toBe("0,75");
    expect(quantite("0.001", "fr-FR")).toBe("0,001");
  });

  it("groupe les milliers comme un montant", () => {
    expect(quantite("12000.000", "fr-FR")).toBe("12 000");
  });

  it("laisse un entier sans point intact", () => {
    expect(quantite("42", "fr-FR")).toBe("42");
  });

  it("ne rend jamais une chaîne vide", () => {
    expect(quantite("0.000", "fr-FR")).toBe("0");
  });

  it("suit la langue du lecteur", () => {
    expect(quantite("2.500", "en-US")).toBe("2.5");
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

describe("un montant absent", () => {
  /*
   * ================================================= LE PLANTAGE DU 4 OCTOBRE
   *
   * L'écran de la pièce affichait « Cet écran n'a pas pu s'afficher » sur un
   * téléphone, sans laisser de trace. La remontée des plantages, posée le jour
   * même, a rendu la ligne exacte :
   *
   *   TypeError: Cannot read properties of null (reading 'trim')
   *       at pme.piece._pieceId-D7ZJFj8f.js:1:5517
   *
   * L'appelant se gardait de `undefined` et pas de `null`. Or le serveur rend
   * du JSON, où un montant absent vaut `null` — jamais `undefined`. La
   * signature disait `string`, et elle mentait.
   *
   * On ne corrige pas que l'appelant : le même mensonge se reproduira ailleurs.
   * Le formateur rend « rien » pour « rien », et ne lève plus.
   */
  it("ne lève pas sur null : c'est ce que le serveur envoie", () => {
    expect(() => montant(null as unknown as string, "fr")).not.toThrow();
    expect(montant(null as unknown as string, "fr")).toBe("");
  });

  it("ne lève pas sur undefined", () => {
    expect(montant(undefined as unknown as string, "fr")).toBe("");
  });

  it("rend vide sur une chaîne vide, plutôt qu'un zéro inventé", () => {
    // Afficher « 0,000 » pour un montant absent ferait croire à un montant nul.
    expect(montant("", "fr")).toBe("");
    expect(montant("   ", "fr")).toBe("");
  });

  it("une quantité absente se tait pareil", () => {
    expect(quantite(null as unknown as string, "fr")).toBe("");
  });
});
