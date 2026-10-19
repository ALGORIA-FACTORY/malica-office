/**
 * La retenue à la source se constate sur le règlement — elle ne se suppose pas.
 *
 * 19 octobre 2026 : un achat de 1 969,610 DT payé par chèque s'écrivait
 * 401 / 532 pour le tout. Au-dessus du seuil de l'article 52-I-g, l'acheteur
 * retient une part du prix : le chèque ne porte que le net.
 *
 * Les taux et le seuil sont ceux que le référentiel rendrait ; aucun n'est
 * écrit dans le moteur (R4).
 */
import { describe, expect, it } from "vitest";

import { construireReglement, type EntreeReglement } from "../ecriture-de-reglement.ts";
import { constaterLaRetenue, type TauxDeRetenue } from "../retenue-au-reglement.ts";

const TAUX: TauxDeRetenue[] = [
  { code: "RAS_MARCHES_ACQUISITIONS", taux: "0.015", libelle: "RAS acquisitions 1,5 %" },
  { code: "RAS_MARCHES_TAUX_REDUIT_1", taux: "0.01", libelle: "RAS acquisitions 1 %" },
  { code: "RAS_MARCHES_TAUX_REDUIT_05", taux: "0.005", libelle: "RAS acquisitions 0,5 %" },
];
const BASE = { seuil: "1000", taux: TAUX, decimales: 3 };

describe("constater la retenue d'un règlement", () => {
  it("le chèque porte le net à 1,5 % : la retenue a été opérée", () => {
    // 1 969,610 × 1,5 % = 29,544 ; le net est 1 940,066.
    const c = constaterLaRetenue({ ...BASE, ttc: "1969.610", paye: "1940.066" });
    expect(c).toMatchObject({ cas: "operee", code: "RAS_MARCHES_ACQUISITIONS", montant: "29.544" });
  });

  it("le payé dit lequel des taux a servi : 1 % ici", () => {
    const c = constaterLaRetenue({ ...BASE, ttc: "2000.000", paye: "1980.000" });
    expect(c).toMatchObject({
      cas: "operee",
      code: "RAS_MARCHES_TAUX_REDUIT_1",
      montant: "20.000",
    });
  });

  it("payé pour le TTC entier au-dessus du seuil : rien n'a été retenu, et on le dit", () => {
    expect(constaterLaRetenue({ ...BASE, ttc: "1969.610", paye: "1969.610" })).toEqual({
      cas: "non_operee",
      ttc: "1969.610",
    });
  });

  it("sous le seuil, il n'y a rien à constater", () => {
    expect(constaterLaRetenue({ ...BASE, ttc: "999.999", paye: "985.000" })).toEqual({
      cas: "sans_objet",
    });
  });

  it("le seuil s'entend « égal ou supérieur »", () => {
    expect(constaterLaRetenue({ ...BASE, ttc: "1000.000", paye: "985.000" }).cas).toBe("operee");
  });

  it("un acompte ne se lit pas comme une retenue", () => {
    expect(constaterLaRetenue({ ...BASE, ttc: "1969.610", paye: "1000.000" })).toEqual({
      cas: "sans_objet",
    });
  });

  it("sans référentiel, le moteur ne conclut rien", () => {
    expect(
      constaterLaRetenue({
        ttc: "1969.610",
        paye: "1940.066",
        seuil: null,
        taux: [],
        decimales: 3,
      }),
    ).toEqual({ cas: "sans_objet" });
  });

  it("l'arrondi d'un millime n'empêche pas de constater", () => {
    // 1 234,567 × 1,5 % = 18,518505 → 18,519 ; un payeur qui arrondit à
    // 18,518 paie 1 216,049. Les deux se reconnaissent.
    expect(constaterLaRetenue({ ...BASE, ttc: "1234.567", paye: "1216.049" })).toMatchObject({
      cas: "operee",
      montant: "18.518",
    });
  });
});

const ACHAT: EntreeReglement = {
  sens: "facture_achat",
  montant: "1940.066",
  devise: "TND",
  payeLe: "2026-10-13",
  moyenLibelle: "Chèque",
  tresorerieAccount: "532",
  journalCode: "BQ",
  counterpartyAccount: "401",
  tiers: "COMPTOIR DU CENTRE SUARL",
  reference: "4512871",
  referencePiece: "GS-2026-77120",
  retenue: { montant: "29.544", compte: "432", libelle: "RAS acquisitions 1,5 %" },
};

describe("l'écriture d'un règlement avec retenue", () => {
  it("achat : 401 au débit pour le TTC, 532 au crédit pour le net, 432 pour la retenue", () => {
    const e = construireReglement(ACHAT);
    expect(e.lignes).toEqual([
      expect.objectContaining({ account_code: "401", debit: "1969.610", credit: "0.000" }),
      expect.objectContaining({ account_code: "532", debit: "0.000", credit: "1940.066" }),
      expect.objectContaining({ account_code: "432", debit: "0.000", credit: "29.544" }),
    ]);
  });

  it("vente : la banque reçoit le net, la retenue subie est une créance, le client s'éteint au TTC", () => {
    const e = construireReglement({
      ...ACHAT,
      sens: "facture_vente",
      counterpartyAccount: "411",
      retenue: { montant: "29.544", compte: "4353", libelle: "RAS subie 1,5 %" },
    });
    expect(e.lignes).toEqual([
      expect.objectContaining({ account_code: "532", debit: "1940.066" }),
      expect.objectContaining({ account_code: "4353", debit: "29.544" }),
      expect.objectContaining({ account_code: "411", credit: "1969.610" }),
    ]);
  });

  it("s'équilibre toujours", () => {
    const e = construireReglement(ACHAT);
    const s = (k: "debit" | "credit") => e.lignes.reduce((a, l) => a + Number(l[k]) * 1000, 0);
    expect(s("debit")).toBe(s("credit"));
  });

  it("le libellé relie le règlement à sa facture et à son fournisseur", () => {
    const e = construireReglement(ACHAT);
    expect(e.libelle).toContain("COMPTOIR DU CENTRE SUARL");
    expect(e.libelle).toContain("GS-2026-77120");
  });

  it("une retenue sans compte au paramétrage est refusée, pas devinée", () => {
    expect(() =>
      construireReglement({ ...ACHAT, retenue: { montant: "29.544", compte: "", libelle: "x" } }),
    ).toThrow(/retenue/);
  });
});
