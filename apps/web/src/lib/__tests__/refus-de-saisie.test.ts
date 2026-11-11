/**
 * Le refus d'un montant tapé — la phrase de l'écran quand il ne s'inscrit pas.
 *
 * Garantit qu'aucune phrase ne sort tant que rien n'est tapé ou que le montant
 * s'inscrit, et que le refus dit pourquoi : trop de décimales pour la devise, valeur
 * négative (avec la phrase propre à l'écran appelant) ou texte qui n'est pas un montant.
 */
import { describe, expect, it } from "vitest";

import { phraseDuRefus } from "../refus-de-saisie";

describe("ce que l'écran dit d'un montant tapé qui ne s'inscrit pas", () => {
  it("rien tant que rien n'est tapé, ni quand le montant s'inscrit", () => {
    expect(phraseDuRefus("", 3)).toBeNull();
    expect(phraseDuRefus("12,500", 3)).toBeNull();
  });

  it("le règlement de « 0,0001 » dinar : trop de décimales, dit", () => {
    expect(phraseDuRefus("0,0001", 3)).toBe("saisie.refus.tropPrecis");
  });

  it("une valeur nette négative : la phrase du stock, qui dit pourquoi", () => {
    expect(phraseDuRefus("-5", 3, "cab.stocks.vnrNegative")).toBe("cab.stocks.vnrNegative");
    expect(phraseDuRefus("-5", 3)).toBe("saisie.refus.negatif");
  });

  it("un texte qui n'est pas un montant", () => {
    expect(phraseDuRefus("abc", 3)).toBe("saisie.refus.illisible");
  });
});
