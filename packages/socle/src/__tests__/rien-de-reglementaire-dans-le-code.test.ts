/**
 * Ni le journal, ni la nature d'une classe ne sont écrits dans le code.
 *
 * ================================================================= POURQUOI
 *
 * 11 octobre 2026 : « corrige la faiblesse comptable et le hardcoding ».
 *
 * Deux constantes réglementaires vivaient en TypeScript, et R4 les nomme
 * toutes les deux :
 *
 *     journal: document_kind === "facture_achat" ? "ACH" : "VEN"
 *     if (!code.startsWith("6") && !code.startsWith("7")) continue
 *
 * La première donne un code de journal qui appartient au plan de
 * l'organisation, pas au produit. La seconde affirme qu'un compte commençant
 * par 6 est une charge — vrai en Tunisie, et la première juridiction qui
 * numérote autrement aurait rendu un compte de résultat VIDE, sans aucune
 * erreur à l'écran. C'est la forme d'erreur que R4 nomme la pire : plausible
 * et fausse.
 */
import { describe, expect, it } from "vitest";

import { computePnl } from "../engines/pnl/snapshot.ts";
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
];

const FACTURE = {
  contract: "extract.v1",
  document_kind: "facture_achat",
  document_date: "2026-09-01",
  currency: "TND",
  issuer: "SOTUPAP",
  lines: [
    {
      label: "Papier",
      base_ht: "100.000",
      tax_code: "TVA_19",
      vat_amount: "19.000",
      ttc: "119.000",
    },
  ],
  totals: { base_ht: "100.000", vat: "19.000", ttc: "119.000" },
  references: {},
  other_charges: [],
};

const imputation = (journalCode: string | null): AccountMapping[] => [
  {
    documentKind: "facture_achat",
    taxCode: null,
    mainAccount: "6061",
    vatAccount: "43661",
    counterpartyAccount: "401",
    journalCode,
  },
];

describe("le journal de l'écriture", () => {
  it("vient du PACK, et non d'un test sur le sens du document", () => {
    const p = buildProposal({
      pieceId: "11111111-1111-1111-1111-111111111111",
      payload: FACTURE,
      taxRates: TAUX,
      mappings: imputation("ACHATS_2026"),
      currency: "TND",
      parametres: PARAMETRES,
    });
    // Un code que le produit n'aurait jamais pu deviner : la preuve qu'il est lu.
    expect(p.journal).toBe("ACHATS_2026");
  });

  it("et son absence au pack est REFUSÉE, pas remplacée", () => {
    /*
     * R4, corollaire : aucun repli implicite. Une écriture rangée dans un
     * journal inventé est une écriture qu'aucun grand-livre ne retrouve, et
     * le défaut ne se voit qu'à la clôture.
     */
    expect(() =>
      buildProposal({
        pieceId: "22222222-2222-2222-2222-222222222222",
        payload: FACTURE,
        taxRates: TAUX,
        mappings: imputation(null),
        currency: "TND",
        parametres: PARAMETRES,
      }),
    ).toThrow(/MISSING_JOURNAL/);
  });
});

describe("le compte de résultat", () => {
  const ECRITURES = [
    { account_code: "6061", debit: "100.000", credit: "0" },
    { account_code: "7071", debit: "0", credit: "300.000" },
    { account_code: "401", debit: "0", credit: "119.000" },
  ];

  /** Un plan tunisien : 6 charges, 7 produits, 4 tiers. */
  const CLASSES_TN = [
    { prefix: "4", nature: "actif" as const },
    { prefix: "6", nature: "charge" as const },
    { prefix: "7", nature: "produit" as const },
  ];

  it("lit la nature des classes au référentiel", () => {
    const pnl = computePnl({
      period: "2026-09",
      currency: { code: "TND", decimals: 3 },
      entries: ECRITURES,
      coa: [],
      classes: CLASSES_TN,
    });
    expect(pnl.charges).toBe("100.000");
    expect(pnl.produits).toBe("300.000");
    expect(pnl.resultat).toBe("200.000");
    expect(pnl.by_account.map((r) => r.account_code)).toEqual(["6061", "7071"]);
  });

  it("une juridiction qui numérote autrement est lue, pas perdue", () => {
    /*
     * Le défaut qu'on ne verrait pas : avec `startsWith("6")` écrit dans le
     * code, ce plan-là rendait un compte de résultat à zéro — et zéro charge
     * sur un mois qui en porte est un chiffre plausible.
     */
    const pnl = computePnl({
      period: "2026-09",
      currency: { code: "XOF", decimals: 0 },
      entries: [
        { account_code: "A10", debit: "500", credit: "0" },
        { account_code: "B20", debit: "0", credit: "900" },
      ],
      coa: [],
      classes: [
        { prefix: "A", nature: "charge" },
        { prefix: "B", nature: "produit" },
      ],
    });
    expect(pnl.charges).toBe("500");
    expect(pnl.produits).toBe("900");
  });

  it("le préfixe le PLUS LONG gagne", () => {
    // Un pack qui sortirait les charges financières du résultat d'exploitation
    // le dirait ainsi, et « 66 » doit l'emporter sur « 6 ».
    const pnl = computePnl({
      period: "2026-09",
      currency: { code: "TND", decimals: 3 },
      entries: [
        { account_code: "6061", debit: "100.000", credit: "0" },
        { account_code: "6611", debit: "40.000", credit: "0" },
      ],
      coa: [],
      classes: [
        { prefix: "6", nature: "charge" },
        { prefix: "66", nature: "passif" },
      ],
    });
    expect(pnl.charges).toBe("100.000");
    expect(pnl.by_account.map((r) => r.account_code)).toEqual(["6061"]);
  });

  it("et un compte d'une classe inconnue n'est pas rangé en silence", () => {
    /*
     * Il n'entre ni dans les charges ni dans les produits — on ne devine pas —
     * mais il ne disparaît pas : il figure au détail, pour qu'on voie qu'il
     * existe. Un montant qui s'évapore d'un compte de résultat est pire qu'un
     * montant mal rangé : le second se corrige, le premier ne se cherche pas.
     */
    const pnl = computePnl({
      period: "2026-09",
      currency: { code: "TND", decimals: 3 },
      entries: [{ account_code: "ZZ9", debit: "77.000", credit: "0" }],
      coa: [],
      classes: CLASSES_TN,
    });
    expect(pnl.charges).toBe("0.000");
    expect(pnl.produits).toBe("0.000");
    expect(pnl.by_account.map((r) => r.account_code)).toEqual(["ZZ9"]);
  });
});
