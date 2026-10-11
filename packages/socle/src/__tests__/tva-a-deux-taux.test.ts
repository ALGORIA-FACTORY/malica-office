/**
 * Une facture à DEUX taux de TVA.
 *
 * ================================================================= POURQUOI
 *
 * 11 octobre 2026 : « vérifie profondément comme un expert-comptable les
 * écritures comptables proposées par Malica ».
 *
 * La vérification a trouvé ceci, et c'est le défaut le plus coûteux du
 * moteur : le pivot produit UNE SEULE ligne de TVA, portant la somme de tous
 * les taux, et la proposition la timbre avec le code de taxe de la PREMIÈRE
 * ligne de la facture.
 *
 *     tax_code: l.account_code === mapping.vatAccount ? firstTaxCode : null
 *
 * Sur une facture de restaurant tunisienne — 7 % sur les plats, 19 % sur les
 * boissons — la totalité de la TVA se retrouve donc déclarée à 7 %, ou à 19 %
 * selon l'ordre des lignes. Les deux cas sont faux, l'écriture est
 * parfaitement équilibrée, et rien ne le signale : ni le contrôle de
 * cohérence taux ↔ montants, qui travaille ligne par ligne et passe, ni
 * l'équilibre, qui est exact. Le défaut n'apparaît qu'à la déclaration, au
 * moment de ventiler la TVA par taux — c'est-à-dire chez l'expert, un mois
 * plus tard, sans moyen de savoir d'où vient l'écart.
 *
 * Et le choix de l'imputation souffre du même biais : `mappings.find` cherche
 * le mapping du PREMIER code de taxe. Quand un pack distingue le compte de
 * TVA par taux, celui du second taux n'est jamais lu.
 *
 * ====================================================== CE QUE L'ON ATTEND
 *
 * Une ligne de TVA PAR TAUX, chacune timbrée de son code et imputée au compte
 * que le pack donne pour ce code. La somme ne change pas, l'équilibre non
 * plus : seule la ventilation devient vraie.
 */
import { describe, expect, it } from "vitest";

import { buildProposal } from "../use-cases/propose-ecriture.ts";
import type { AccountMapping, TaxRate } from "../ports/repositories.ts";

const PARAMETRES = { decimals: 3, confianceReserve: 0.7, confianceBloquante: 0.4 };

const TAUX: TaxRate[] = [
  {
    code: "TVA_19",
    label: "TVA 19 %",
    rate: "0.1900",
    validFrom: "2026-01-01",
    validTo: null,
    jurisdiction: "TN",
  },
  {
    code: "TVA_07",
    label: "TVA 7 %",
    rate: "0.0700",
    validFrom: "2026-01-01",
    validTo: null,
    jurisdiction: "TN",
  },
];

/** Le pack tunisien impute les deux taux au même compte de TVA déductible. */
const IMPUTATIONS: AccountMapping[] = [
  {
    documentKind: "facture_achat",
    taxCode: null,
    mainAccount: "6061",
    vatAccount: "43661",
    counterpartyAccount: "401",
    // Le journal vient du pack : son absence fait REFUSER la proposition (R4).
    journalCode: "ACH",
  },
];

/** Plats à 7 %, boissons à 19 % — la facture de restaurant la plus ordinaire. */
const FACTURE = {
  contract: "extract.v1",
  document_kind: "facture_achat",
  document_date: "2026-09-01",
  currency: "TND",
  issuer: "RESTAURANT EL MEDINA",
  lines: [
    {
      label: "Plats du jour",
      base_ht: "100.000",
      tax_code: "TVA_07",
      vat_amount: "7.000",
      ttc: "107.000",
    },
    {
      label: "Boissons",
      base_ht: "200.000",
      tax_code: "TVA_19",
      vat_amount: "38.000",
      ttc: "238.000",
    },
  ],
  totals: { base_ht: "300.000", vat: "45.000", ttc: "345.000" },
  references: {},
  other_charges: [],
};

describe("une facture à deux taux de TVA", () => {
  const proposition = buildProposal({
    pieceId: "11111111-1111-1111-1111-111111111111",
    payload: FACTURE,
    taxRates: TAUX,
    mappings: IMPUTATIONS,
    currency: "TND",
    parametres: PARAMETRES,
  });

  const tva = proposition.lignes.filter((l) => l.account_code === "43661");

  it("donne UNE LIGNE DE TVA PAR TAUX, et non une somme", () => {
    expect(tva).toHaveLength(2);
  });

  it("chaque ligne porte SON code de taxe", () => {
    expect(new Set(tva.map((l) => l.tax_code))).toEqual(new Set(["TVA_07", "TVA_19"]));
  });

  it("et son montant, celui de son taux", () => {
    const parCode = new Map(tva.map((l) => [l.tax_code, l.debit]));
    expect(parCode.get("TVA_07")).toBe("7.000");
    expect(parCode.get("TVA_19")).toBe("38.000");
  });

  it("la TVA totale ne change pas : seule sa ventilation devient vraie", () => {
    const total = tva.reduce((n, l) => n + Number(l.debit), 0);
    expect(total.toFixed(3)).toBe("45.000");
  });

  it("l'écriture reste équilibrée au millime", () => {
    // C'est ce qui rendait le défaut invisible : l'écriture était juste en
    // totaux, et fausse en ventilation. Elle doit rester juste en totaux.
    const debit = proposition.lignes.reduce((n, l) => n + Number(l.debit), 0);
    const credit = proposition.lignes.reduce((n, l) => n + Number(l.credit), 0);
    expect(debit.toFixed(3)).toBe(credit.toFixed(3));
    expect(credit.toFixed(3)).toBe("345.000");
  });

  it("et un seul taux donne toujours UNE ligne de TVA, timbrée", () => {
    // La correction ne doit pas transformer le cas ordinaire : la très grande
    // majorité des factures ne porte qu'un taux.
    const unSeul = buildProposal({
      pieceId: "22222222-2222-2222-2222-222222222222",
      payload: {
        ...FACTURE,
        lines: [FACTURE.lines[1]],
        totals: { base_ht: "200.000", vat: "38.000", ttc: "238.000" },
      },
      taxRates: TAUX,
      mappings: IMPUTATIONS,
      currency: "TND",
      parametres: PARAMETRES,
    });
    const lignesTva = unSeul.lignes.filter((l) => l.account_code === "43661");
    expect(lignesTva).toHaveLength(1);
    expect(lignesTva[0]!.tax_code).toBe("TVA_19");
    expect(lignesTva[0]!.debit).toBe("38.000");
  });
});
