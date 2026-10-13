/**
 * L'écriture d'un règlement.
 *
 * 13 octobre 2026, le dirigeant : « l'écriture comptable et le rapprochement
 * dépendent énormément du moyen de paiement ». Le référentiel portait déjà le
 * compte de trésorerie de chaque moyen — et aucun code ne le lisait.
 */
import { describe, expect, it } from "vitest";

import {
  construireReglement,
  ReglementIncomplet,
  type EntreeReglement,
} from "../ecriture-de-reglement.ts";

/** Le pack tunisien, tel que la base le rend — jamais écrit dans le moteur. */
const ACHAT: EntreeReglement = {
  sens: "facture_achat",
  montant: "1969.610",
  devise: "TND",
  payeLe: "2026-10-13",
  moyenLibelle: "Chèque",
  tresorerieAccount: "532",
  journalCode: "BQ",
  counterpartyAccount: "401",
  tiers: "COMPTOIR DU CENTRE SUARL",
  reference: "4512871",
  referencePiece: "GS-2026-77120",
};

describe("l'écriture d'un règlement", () => {
  it("un achat réglé par chèque : 401 au débit, 532 au crédit", () => {
    const e = construireReglement(ACHAT);
    expect(e.journal).toBe("BQ");
    expect(e.lignes).toHaveLength(2);
    expect(e.lignes[0]).toMatchObject({
      account_code: "401",
      debit: "1969.610",
      credit: "0.000",
    });
    expect(e.lignes[1]).toMatchObject({
      account_code: "532",
      debit: "0.000",
      credit: "1969.610",
    });
  });

  it("une vente encaissée en espèces : 54 au débit, 411 au crédit", () => {
    const e = construireReglement({
      ...ACHAT,
      sens: "facture_vente",
      moyenLibelle: "Espèces",
      tresorerieAccount: "54",
      journalCode: "CA",
      counterpartyAccount: "411",
      reference: null,
    });
    expect(e.lignes[0]).toMatchObject({ account_code: "54", debit: "1969.610" });
    expect(e.lignes[1]).toMatchObject({ account_code: "411", credit: "1969.610" });
  });

  it("l'écriture est équilibrée, dans les deux sens", () => {
    for (const sens of ["facture_achat", "facture_vente"] as const) {
      const e = construireReglement({ ...ACHAT, sens });
      const somme = (cle: "debit" | "credit") =>
        e.lignes.reduce((s, l) => s + Number(l[cle]), 0).toFixed(3);
      expect(somme("debit")).toBe(somme("credit"));
    }
  });

  it("elle est datée du RÈGLEMENT, jamais de la facture", () => {
    /*
     * Une facture de septembre payée en octobre touche la trésorerie en
     * octobre. Les confondre rend tout rapprochement bancaire impossible, et
     * c'est l'erreur qui se voit le plus tard.
     */
    const e = construireReglement({ ...ACHAT, payeLe: "2026-10-13" });
    expect(e.dateEcriture).toBe("2026-10-13");
  });

  it("le libellé porte le tiers, le moyen, le numéro et la pièce", () => {
    // C'est ce qu'un rapprochement bancaire cherche : sans le numéro du
    // chèque, l'expert ouvre la photo du talon et déchiffre à l'œil.
    const e = construireReglement(ACHAT);
    expect(e.libelle).toContain("COMPTOIR DU CENTRE SUARL");
    expect(e.libelle).toContain("Chèque");
    expect(e.libelle).toContain("4512871");
    expect(e.libelle).toContain("GS-2026-77120");
  });

  it("aucune TVA n'y figure : la facture l'a déjà portée", () => {
    // La reprendre ici la compterait deux fois. Un règlement éteint une
    // dette, il ne la ventile pas.
    const e = construireReglement(ACHAT);
    expect(e.lignes.map((l) => l.account_code)).toEqual(["401", "532"]);
  });

  it("« pas encore payé » n'ouvre aucun compte, donc aucune écriture", () => {
    expect(() => construireReglement({ ...ACHAT, tresorerieAccount: "" })).toThrow(
      ReglementIncomplet,
    );
  });

  it("sans montant, sans date, sans journal : refus motivé", () => {
    for (const modif of [
      { montant: "0.000" },
      { montant: "" },
      { payeLe: "" },
      { journalCode: "" },
      { counterpartyAccount: "" },
    ]) {
      expect(() => construireReglement({ ...ACHAT, ...modif })).toThrow(ReglementIncomplet);
    }
  });

  it("le refus dit ce qui manque, pas « une erreur est survenue »", () => {
    try {
      construireReglement({ ...ACHAT, payeLe: "" });
      expect.unreachable("le règlement aurait dû être refusé");
    } catch (e) {
      expect((e as ReglementIncomplet).manque).toMatch(/date/);
    }
  });
});
