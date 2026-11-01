/**
 * Le FODEC d'un achat, au coût ou au compte du pack (31 octobre 2026).
 *
 * ================================================================= POURQUOI
 *
 * Le FODEC n'est pas déductible chez l'acheteur (Code de la TVA art. 6-I : il
 * entre dans la base de la TVA). Le dirigeant a choisi, à confirmer par un
 * expert-comptable, de l'incorporer au COÛT d'achat (`fodec.traitement` :
 * « par_article_au_cout ») ; le pack l'imputait à 6652 « taxes non
 * récupérables », sans que le cabinet puisse rien y changer. Le réglage du
 * cabinet dit désormais lesquels des droits d'un achat rejoignent la charge
 * (`droitsAuCout`) : leur ligne prend le compte de la charge, et reste une
 * ligne nommée. Une vente garde son compte (4374), quel que soit le réglage.
 */
import { describe, expect, it } from "vitest";

import type { AccountMapping, FiscalCharge, TaxRate } from "../ports/repositories.ts";
import { buildProposal } from "../use-cases/propose-ecriture.ts";

const PARAMETRES = { decimals: 3, confianceReserve: 0.7, confianceBloquante: 0.4 };

const TAUX: TaxRate[] = [
  {
    code: "TVA_ESSAI",
    label: "TVA d'essai",
    rate: "0.1900",
    validFrom: "2026-01-01",
    validTo: null,
    jurisdiction: "XX",
  },
];

const IMPUTATIONS: AccountMapping[] = [
  {
    documentKind: "facture_achat",
    taxCode: null,
    mainAccount: "CHARGE",
    vatAccount: "TVA_DED",
    counterpartyAccount: "FOURN",
    journalCode: "ACH",
  },
  {
    documentKind: "facture_vente",
    taxCode: null,
    mainAccount: "PRODUIT",
    vatAccount: "TVA_COL",
    counterpartyAccount: "CLIENT",
    journalCode: "VEN",
  },
];

/** Un droit proportionnel, taxable, sur l'achat et sur la vente : comptes d'essai. */
const DROITS: FiscalCharge[] = [
  {
    code: "DROIT_ESSAI",
    label: "Droit d'essai",
    documentKind: "facture_achat",
    accountCode: "DROIT_ACHAT",
    fixedAmount: null,
    taxable: true,
    legalReference: null,
  },
  {
    code: "DROIT_ESSAI",
    label: "Droit d'essai",
    documentKind: "facture_vente",
    accountCode: "DROIT_VENTE",
    fixedAmount: null,
    taxable: true,
    legalReference: null,
  },
];

/** 1 000 HT, droit 10, TVA 19 % sur 1 010 = 191,900, TTC 1 201,900. */
const piece = (sens: "facture_achat" | "facture_vente") => ({
  contract: "extract.v1",
  document_kind: sens,
  document_date: "2026-09-01",
  currency: "TND",
  issuer: "FOURNISSEUR D'ESSAI",
  lines: [
    {
      label: "Marchandise",
      base_ht: "1000.000",
      tax_code: "TVA_ESSAI",
      vat_amount: "191.900",
      ttc: "1201.900",
    },
  ],
  other_charges: [{ code: "DROIT_ESSAI", label: "Droit d'essai", amount: "10.000" }],
  totals: { base_ht: "1000.000", vat: "191.900", ttc: "1201.900" },
});

const proposer = (sens: "facture_achat" | "facture_vente", droitsAuCout?: string[]) =>
  buildProposal({
    pieceId: "piece-essai",
    payload: piece(sens),
    taxRates: TAUX,
    mappings: IMPUTATIONS,
    fiscalCharges: DROITS,
    currency: "TND",
    parametres: PARAMETRES,
    ...(droitsAuCout ? { droitsAuCout } : {}),
  });

const ligneDu = (p: ReturnType<typeof proposer>, compte: string) =>
  p.lignes.filter((l) => l.account_code === compte);

describe("le FODEC d'un achat, selon le réglage du cabinet", () => {
  it("au coût : sa ligne prend le compte de la charge, l'écriture reste équilibrée", () => {
    const p = proposer("facture_achat", ["DROIT_ESSAI"]);
    expect(ligneDu(p, "DROIT_ACHAT")).toEqual([]);
    const charges = ligneDu(p, "CHARGE");
    expect(charges.map((l) => l.debit).sort()).toEqual(["10.000", "1000.000"]);
    expect(charges.find((l) => l.debit === "10.000")?.libelle).toMatch(/Droit d'essai/);
    const debit = p.lignes.reduce((s, l) => s + Number(l.debit), 0);
    const credit = p.lignes.reduce((s, l) => s + Number(l.credit), 0);
    expect(debit.toFixed(3)).toBe(credit.toFixed(3));
  });

  it("sans réglage, ou au compte du pack : le compte du pack", () => {
    for (const p of [proposer("facture_achat"), proposer("facture_achat", [])]) {
      expect(ligneDu(p, "DROIT_ACHAT").map((l) => l.debit)).toEqual(["10.000"]);
      expect(ligneDu(p, "CHARGE").map((l) => l.debit)).toEqual(["1000.000"]);
    }
  });

  it("une vente garde son compte : le réglage ne vise que l'achat", () => {
    const p = proposer("facture_vente", ["DROIT_ESSAI"]);
    expect(ligneDu(p, "DROIT_VENTE").map((l) => l.credit)).toEqual(["10.000"]);
  });
});
