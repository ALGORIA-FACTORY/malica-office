/**
 * L'écriture saisie par le comptable : équilibrée en décimales exactes, ou
 * le défaut qui l'empêche, dit une fois pour l'écran et pour l'API.
 */
import { describe, expect, it } from "vitest";

import { controlerLaSaisie, ligneNormalisee, type LigneSaisie } from "../ecriture-saisie.ts";

const ligne = (account_code: string, debit: string, credit: string): LigneSaisie => ({
  account_code,
  libelle: "",
  debit,
  credit,
  tax_code: null,
});

describe("controlerLaSaisie", () => {
  it("équilibrée au millième près, là où un flottant se tromperait", () => {
    const c = controlerLaSaisie(
      [ligne("601", "0.1", ""), ligne("601", "0,2", ""), ligne("401", "", "0.3")],
      3,
    );
    expect(c).toEqual({ totalDebit: "0.300", totalCredit: "0.300", defaut: null });
  });

  it("dit le défaut, dans l'ordre", () => {
    expect(controlerLaSaisie([ligne("601", "1", "")], 3).defaut).toBe("lignes");
    expect(controlerLaSaisie([ligne("", "1", ""), ligne("401", "", "1")], 3).defaut).toBe(
      "compte",
    );
    expect(controlerLaSaisie([ligne("601", "1,2,3", ""), ligne("401", "", "1")], 3).defaut).toBe(
      "montant",
    );
    expect(controlerLaSaisie([ligne("601", "-1", ""), ligne("401", "", "1")], 3).defaut).toBe(
      "montant",
    );
    expect(controlerLaSaisie([ligne("601", "1", "1"), ligne("401", "", "1")], 3).defaut).toBe(
      "sens",
    );
    expect(controlerLaSaisie([ligne("601", "", ""), ligne("401", "", "1")], 3).defaut).toBe("sens");
    expect(controlerLaSaisie([ligne("601", "2", ""), ligne("401", "", "1")], 3).defaut).toBe(
      "desequilibre",
    );
  });

  it("refuse plus de décimales que la devise n'en porte", () => {
    expect(controlerLaSaisie([ligne("601", "1.005", ""), ligne("401", "", "1.005")], 2).defaut).toBe(
      "montant",
    );
    expect(controlerLaSaisie([ligne("601", "1.050", ""), ligne("401", "", "1.05")], 2).defaut).toBe(
      null,
    );
  });

  it("normalise la ligne qui part", () => {
    expect(ligneNormalisee({ ...ligne(" 601 ", "1,5", ""), libelle: " Achat " })).toEqual({
      account_code: "601",
      libelle: "Achat",
      debit: "1.5",
      credit: "0",
      tax_code: null,
    });
  });
});
