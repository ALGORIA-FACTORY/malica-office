/**
 * Le règlement qu'une ligne de relevé éteint (recette du 11 novembre 2026,
 * point 2.5) : la ligne « VIR PAPETERIE EL AMEN FA-2026-1111 −358,000 »
 * désigne la facture d'achat ouverte de 358,000, et rien d'ambigu n'est
 * proposé.
 */
import { describe, expect, it } from "vitest";

import {
  lignesDuReglement,
  reglementsDesLignes,
  type FactureOuverte,
} from "../engines/banque/reglement-de-ligne.ts";

const ligne = (id: string, montant: string, label: string, reference: string | null = null) => ({
  id,
  at: "2026-11-10",
  label,
  montant,
  reference,
});
const facture = (
  pieceId: string,
  reste: string,
  reference: string | null,
  sens: FactureOuverte["sens"] = "facture_achat",
): FactureOuverte => ({
  pieceId,
  sens,
  reste,
  reference,
  tiers: null,
  date: "2026-11-02",
  compteTiers: sens === "facture_achat" ? "401-essai" : "411-essai",
});

describe("le règlement qu'une ligne de relevé éteint", () => {
  it("une sortie de 358 désigne la facture d'achat ouverte de 358 qu'elle nomme", () => {
    const r = reglementsDesLignes(
      [ligne("l1", "-358.000", "VIR PAPETERIE EL AMEN FA-2026-1111")],
      [facture("autre", "358.000", "FA-2026-0999"), facture("f1", "358.000", "FA-2026-1111")],
    );
    expect(r).toEqual([
      { ligneId: "l1", facture: expect.objectContaining({ pieceId: "f1" }), referenceExacte: true },
    ]);
  });

  it("une référence se lit entière : « FA-10 » ne cite pas « FA-1 » (revue de #361)", () => {
    const factures = [facture("f1", "358.000", "FA-1"), facture("f10", "358.000", "FA-10")];
    expect(
      reglementsDesLignes([ligne("l1", "-358.000", "VIR PAPETERIE FA-10")], factures).map((p) => [
        p.facture.pieceId,
        p.referenceExacte,
      ]),
    ).toEqual([["f10", true]]);
    expect(
      reglementsDesLignes([ligne("l2", "-358.000", "VIR PAPETERIE FA 1")], factures).map(
        (p) => p.facture.pieceId,
      ),
    ).toEqual(["f1"]);
  });

  it("le montant seul suffit quand une seule facture le porte", () => {
    const r = reglementsDesLignes(
      [ligne("l1", "-358.000", "VIR PAPETERIE")],
      [facture("f1", "358.000", "FA-1"), facture("f2", "120.000", "FA-2")],
    );
    expect(r.map((p) => [p.facture.pieceId, p.referenceExacte])).toEqual([["f1", false]]);
  });

  it("deux factures du même montant, sans référence sur la ligne : rien n'est proposé", () => {
    expect(
      reglementsDesLignes(
        [ligne("l1", "-358.000", "VIR PAPETERIE")],
        [facture("f1", "358.000", "FA-1"), facture("f2", "358.000", "FA-2")],
      ),
    ).toEqual([]);
  });

  it("le sens compte : une entrée règle une vente, jamais un achat", () => {
    expect(
      reglementsDesLignes([ligne("l1", "358.000", "VIR RECU")], [facture("f1", "358.000", null)]),
    ).toEqual([]);
    const r = reglementsDesLignes(
      [ligne("l1", "358.000", "VIR RECU")],
      [facture("f1", "358.000", null, "facture_vente")],
    );
    expect(r.map((p) => p.facture.pieceId)).toEqual(["f1"]);
  });

  it("aucune tolérance : un écart d'un millime n'est pas ce règlement", () => {
    expect(
      reglementsDesLignes(
        [ligne("l1", "-357.999", "VIR FA-1")],
        [facture("f1", "358.000", "FA-1")],
      ),
    ).toEqual([]);
  });

  it("une facture n'est pas proposée à deux lignes", () => {
    expect(
      reglementsDesLignes(
        [ligne("l1", "-358.000", "VIR A"), ligne("l2", "-358.000", "VIR B")],
        [facture("f1", "358.000", "FA-1")],
      ),
    ).toEqual([]);
    // Nommée par l'une, elle va à celle-là ; l'autre n'a rien.
    const r = reglementsDesLignes(
      [ligne("l1", "-358.000", "VIR A FA-1"), ligne("l2", "-358.000", "VIR B")],
      [facture("f1", "358.000", "FA-1")],
    );
    expect(r.map((p) => p.ligneId)).toEqual(["l1"]);
  });

  it("un tiers que l'écriture ne dit pas univoquement : rien n'est proposé", () => {
    expect(
      reglementsDesLignes(
        [ligne("l1", "-358.000", "VIR FA-1")],
        [{ ...facture("f1", "358.000", "FA-1"), compteTiers: null }],
      ),
    ).toEqual([]);
  });

  it("l'écriture proposée solde le tiers de la facture contre le compte de la banque", () => {
    const l = ligne("l1", "-358.000", "VIR FA-1");
    expect(lignesDuReglement(l, facture("f1", "358.000", "FA-1"), "banque-essai")).toEqual([
      { account_code: "401-essai", debit: "358", credit: "0" },
      { account_code: "banque-essai", debit: "0", credit: "358" },
    ]);
    const recu = ligne("l2", "120.500", "VIR RECU");
    expect(
      lignesDuReglement(recu, facture("f2", "120.500", null, "facture_vente"), "banque-essai"),
    ).toEqual([
      { account_code: "banque-essai", debit: "120.5", credit: "0" },
      { account_code: "411-essai", debit: "0", credit: "120.5" },
    ]);
  });
});
