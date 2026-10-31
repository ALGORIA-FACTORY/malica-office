/**
 * Une pièce en devise, convertie par le Socle (31 octobre 2026).
 *
 * Avant #142, une facture de 1 000,00 € d'un dossier tenu en dinars
 * s'inscrivait 1 000,000 DT ; depuis, elle n'était plus proposée. Le Socle la
 * convertit désormais au cours donné, sans rien deviner :
 *
 *   — chaque montant × taux ÷ unité, en décimal exact, arrondi à l'exposant
 *     de la devise du dossier, au plus proche et, à égalité, au pair ;
 *   — la TVA et le total tels quels, l'écart d'arrondi selon la règle du
 *     référentiel (« base_la_plus_grande ») — une règle inconnue lève ;
 *   — l'écriture vérifiée d'abord dans la devise de la facture, puis composée
 *     dans celle du dossier, chaque ligne avec son montant d'origine ;
 *   — un droit fixé du pack ne se compare qu'à un montant dans sa devise.
 *
 * Les cours sont FICTIFS : des valeurs de forme.
 */
import { describe, expect, it } from "vitest";

import { ExtractV1 } from "../contracts/extract.v1.ts";
import {
  convertirLExtrait,
  ConversionRefusee,
  type ConversionDemandee,
} from "../engines/fx/convertir-l-extrait.ts";
import { HORS_DU_CALCUL, tvaDesExtraits } from "../engines/tva/des-extraits.ts";
import type {
  AccountMapping,
  DeclarationTva,
  FiscalCharge,
  TaxRate,
} from "../ports/repositories.ts";
import { buildProposal } from "../use-cases/propose-ecriture.ts";

import { EUR, TAX_RATES_TN, TND } from "./fixtures.ts";

const XOF = { code: "XOF", decimals: 0 };

const cours = (taux: string, unite = 1) => ({
  id: "00000000-0000-4000-8000-0000000000aa",
  date: "2026-09-10",
  source: "SOURCE_D_ESSAI",
  taux,
  unite,
});

const conversion = (
  de: typeof EUR,
  vers: typeof TND,
  taux: string,
  unite = 1,
): ConversionDemandee => ({ de, vers, cours: cours(taux, unite), ecart: "base_la_plus_grande" });

/** Un extrait d'achat : une ligne par [code, HT, TVA], des droits, le total imprimé. */
const extrait = (
  devise: string,
  lignes: Array<[string, string, string]>,
  ttc: string,
  droits: Array<[string, string]> = [],
) =>
  ExtractV1.parse({
    contract: "extract.v1",
    issuer: "FOURNISSEUR D'ESSAI",
    document_date: "2026-09-10",
    currency: devise,
    document_kind: "facture_achat",
    lines: lignes.map(([code, ht, tva]) => ({
      label: code,
      tax_code: code,
      base_ht: ht,
      vat_amount: tva,
      ttc: (Number(ht) + Number(tva)).toFixed(4),
    })),
    articles: [
      {
        designation: "Article d'essai",
        quantity: "2",
        unit_price_ht: "500.00",
        unit_price_ttc: null,
        total_ht: "1000.00",
        tax_code: lignes[0]![0],
      },
    ],
    other_charges: droits.map(([code, amount]) => ({ code, label: code, amount })),
    totals: {
      base_ht: lignes.reduce((s, l) => s + Number(l[1]), 0).toFixed(4),
      vat: lignes.reduce((s, l) => s + Number(l[2]), 0).toFixed(4),
      ttc,
    },
  });

describe("convertir l'extrait d'une pièce en devise", () => {
  it("convertit chaque montant au cours, à l'exposant du dossier", () => {
    const { extrait: e, conversion: c } = convertirLExtrait(
      extrait("EUR", [["TVA19", "1000.00", "190.00"]], "1190.00"),
      conversion(EUR, TND, "3.3456"),
    );
    expect(e.currency).toBe("TND");
    expect([e.lines[0]!.base_ht, e.lines[0]!.vat_amount, e.lines[0]!.ttc]).toEqual([
      "3345.600",
      "635.664",
      "3981.264",
    ]);
    expect(e.totals).toEqual({ base_ht: "3345.600", vat: "635.664", ttc: "3981.264" });
    // Les articles aussi : prix unitaire et total.
    expect([e.articles[0]!.unit_price_ht, e.articles[0]!.total_ht]).toEqual([
      "1672.800",
      "3345.600",
    ]);
    expect(c).toMatchObject({ devise_origine: "EUR", devise: "TND", taux_unitaire: "3.3456" });
    expect([c.ecart, c.ligne_ajustee]).toEqual(["0.000", null]);
  });

  it("un demi-millime exact s'arrondit au pair, jamais vers le haut", () => {
    // 119,30 × 3,345 = 399,0585 : au pair 399,058 (vers le haut, 399,059).
    const { extrait: e } = convertirLExtrait(
      extrait("EUR", [["TVA19", "100.25", "19.05"]], "119.30"),
      conversion(EUR, TND, "3.345"),
    );
    expect(e.totals.ttc).toBe("399.058");
  });

  it("l'écart d'arrondi va à la plus grande base ; la TVA et le total restent exacts", () => {
    // 333,33 × 3,0125 = 1 004,157 ; 63,33 → 190,782 ; 396,66 → 1 194,938 : un millime de trop.
    const { extrait: e, conversion: c } = convertirLExtrait(
      extrait("USD", [["TVA19", "333.33", "63.33"]], "396.66"),
      conversion({ code: "USD", decimals: 2 }, TND, "3.0125"),
    );
    expect([e.lines[0]!.base_ht, e.lines[0]!.vat_amount, e.totals.ttc]).toEqual([
      "1004.156",
      "190.782",
      "1194.938",
    ]);
    expect([c.ecart, c.ligne_ajustee]).toEqual(["-0.001", 0]);
  });

  it("deux taux : l'écart va à la PLUS GRANDE base, la première à égalité", () => {
    const { extrait: e, conversion: c } = convertirLExtrait(
      extrait(
        "USD",
        [
          ["TVA07", "100.01", "7.00"],
          ["TVA19", "333.33", "63.33"],
        ],
        "503.67",
      ),
      conversion({ code: "USD", decimals: 2 }, TND, "3.0125"),
    );
    // 301,280 + 1 004,157 + 21,088 + 190,782 = 1 517,307 ; le total converti
    // vaut 1 517,306 : le millime de trop sort de la plus grande base (la 2e).
    expect(e.lines.map((l) => [l.base_ht, l.vat_amount])).toEqual([
      ["301.280", "21.088"],
      ["1004.156", "190.782"],
    ]);
    expect(e.totals).toEqual({ base_ht: "1305.436", vat: "211.870", ttc: "1517.306" });
    expect([c.ecart, c.ligne_ajustee]).toEqual(["-0.001", 1]);
  });

  it("de l'unité au millime : un cours pour 1 000 F CFA", () => {
    const { extrait: e } = convertirLExtrait(
      extrait("XOF", [["TVA19", "1000000", "190000"]], "1190000"),
      conversion(XOF, TND, "5.0123", 1000),
    );
    expect(e.totals).toEqual({ base_ht: "5012.300", vat: "952.337", ttc: "5964.637" });
  });

  it("vers une devise sans décimale (un dossier tenu en francs CFA) : au franc près, au pair", () => {
    // 1 000,00 × 655,957 = 655 957 ; 190,50 × 655,957 = 124 959,8085 → 124 960.
    const { extrait: e, conversion: c } = convertirLExtrait(
      extrait("EUR", [["TVA19", "1000.00", "190.50"]], "1190.50"),
      conversion(EUR, XOF, "655.957"),
    );
    expect([e.lines[0]!.base_ht, e.lines[0]!.vat_amount, e.totals.ttc]).toEqual([
      "655957",
      "124960",
      "780917",
    ]);
    expect(c.ecart).toBe("0");
  });

  it("une règle d'écart inconnue du Socle lève : un écart ne se place pas au hasard", () => {
    expect(() =>
      convertirLExtrait(extrait("EUR", [["TVA19", "1000.00", "190.00"]], "1190.00"), {
        ...conversion(EUR, TND, "3.3456"),
        ecart: "au_hasard",
      }),
    ).toThrow(ConversionRefusee);
  });
});

/** Le refus d'une conversion, son code. */
const refus = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    if (e instanceof ConversionRefusee) return e.raison;
    throw e;
  }
  return null;
};

describe("la conversion ne se trompe jamais de beaucoup (revue de #148)", () => {
  it("60 lignes de 0,01 € en francs CFA : l'écart reste sous sa borne, aucune base n'est négative", () => {
    // Converties une à une, chaque ligne valait 7 F CFA, et l'écart −53 rendait une base de −46.
    const lignes = Array.from({ length: 60 }, (): [string, string, string] => [
      "TVA19",
      "0.01",
      "0.01",
    ]);
    const { extrait: e, conversion: c } = convertirLExtrait(
      extrait("EUR", lignes, "1.20"),
      conversion(EUR, XOF, "655.957"),
    );
    // Une demi-unité par montant arrondi : le total, un taux, la somme des bases.
    expect(Math.abs(Number(c.ecart))).toBeLessThanOrEqual(1.5);
    expect(e.lines.every((l) => Number(l.base_ht) >= 0)).toBe(true);
    // Chaque base s'écarte de sa conversion exacte (6,55957) de moins d'une unité, écart compris.
    expect(e.lines.every((l) => Math.abs(Number(l.base_ht) - 6.55957) < 2)).toBe(true);
    expect(e.totals.ttc).toBe("787");
  });

  it("la TVA d'un taux est celle de la facture au cours, répartie sur ses lignes", () => {
    // 10 lignes de 1,90 € : 19,00 € de TVA, 12 463 F CFA (et non 10 × 1 246 = 12 460).
    const lignes = Array.from({ length: 10 }, (): [string, string, string] => [
      "TVA19",
      "10.01",
      "1.90",
    ]);
    const { extrait: e } = convertirLExtrait(
      extrait("EUR", lignes, "119.10"),
      conversion(EUR, XOF, "655.957"),
    );
    expect(e.totals.vat).toBe("12463");
    expect(e.totals.base_ht).toBe("65661");
    expect(e.totals.ttc).toBe("78124");
  });

  it("deux taux : chaque taux converti sur son propre total", () => {
    const { extrait: e } = convertirLExtrait(
      extrait(
        "EUR",
        [
          ["TVA19", "10.01", "1.90"],
          ["TVA07", "10.01", "0.70"],
          ["TVA19", "10.01", "1.90"],
        ],
        "34.53",
      ),
      conversion(EUR, XOF, "655.957"),
    );
    const parCode = (code: string) =>
      e.lines.filter((l) => l.tax_code === code).reduce((s, l) => s + Number(l.vat_amount), 0);
    expect(parCode("TVA19")).toBe(2493); // 3,80 × 655,957 = 2 492,64
    expect(parCode("TVA07")).toBe(459); // 0,70 × 655,957 = 459,17
  });

  it("une facture qui ne tient pas dans sa devise ne se convertit pas", () => {
    expect(
      refus(() =>
        convertirLExtrait(
          extrait("EUR", [["TVA19", "1000.00", "190.00"]], "1290.00"),
          conversion(EUR, TND, "3.3456"),
        ),
      ),
    ).toBe("desequilibre");
  });

  it("un écart qui changerait le signe d'une base est refusé", () => {
    // Deux taux de 0,01 € sur des bases nulles : 7 + 7 F CFA de TVA pour 13 au total.
    expect(
      refus(() =>
        convertirLExtrait(
          extrait(
            "EUR",
            [
              ["TVA19", "0.00", "0.01"],
              ["TVA07", "0.00", "0.01"],
            ],
            "0.02",
          ),
          conversion(EUR, XOF, "655.957"),
        ),
      ),
    ).toBe("signe");
  });
});

const taxRates: TaxRate[] = TAX_RATES_TN.map((r) => ({
  code: r.code,
  label: r.label,
  rate: r.rate,
  validFrom: r.valid_from,
  validTo: r.valid_to,
  jurisdiction: r.jurisdiction,
}));
const mappings: AccountMapping[] = [
  {
    documentKind: "facture_achat",
    taxCode: null,
    mainAccount: "6071",
    vatAccount: "43661",
    counterpartyAccount: "4011",
    journalCode: "ACH",
  },
];
const timbre: FiscalCharge[] = [
  {
    code: "DROIT_TIMBRE",
    label: "Droit de timbre",
    accountCode: "6654",
    documentKind: "facture_achat",
    fixedAmount: "1.000",
    legalReference: null,
  },
];

const proposerEnDevise = (payload: unknown, taux: string, fiscalCharges: FiscalCharge[] = []) =>
  buildProposal({
    pieceId: "11111111-1111-1111-1111-111111111111",
    payload,
    taxRates,
    mappings,
    fiscalCharges,
    currency: "EUR",
    parametres: { decimals: 2, confianceReserve: 0.7, confianceBloquante: 0.4 },
    conversion: { vers: TND, cours: cours(taux), ecart: "base_la_plus_grande" },
  });

describe("proposer l'écriture d'une pièce en devise", () => {
  it("dans la devise du dossier, chaque ligne avec son montant, sa devise et son taux d'origine", () => {
    const p = proposerEnDevise(
      extrait("EUR", [["TVA_19", "1000.00", "190.00"]], "1190.00"),
      "3.3456",
    );
    expect(p.pivot.approvable).toBe(true);
    expect(p.pivot.currency).toBe("TND");
    expect(
      p.lignes.map((l) => [l.account_code, l.debit, l.credit, l.devise_origine, l.montant_origine]),
    ).toEqual([
      ["6071", "3345.600", "0", "EUR", "1000.00"],
      ["43661", "635.664", "0", "EUR", "190.00"],
      ["4011", "0", "3981.264", "EUR", "1190.00"],
    ]);
    expect(p.lignes.every((l) => l.taux_de_change === "3.3456")).toBe(true);
    expect(p.conversion?.cours.id).toBe("00000000-0000-4000-8000-0000000000aa");
  });

  it("une facture qui ne tient pas dans SA devise ne se convertit pas", () => {
    // 1 000,00 à 19 % ne fait pas 150,00 de TVA : le refus vient de l'euro.
    const p = proposerEnDevise(
      extrait("EUR", [["TVA_19", "1000.00", "150.00"]], "1150.00"),
      "3.3456",
    );
    expect(p.pivot.approvable).toBe(false);
    expect(p.pivot.currency).toBe("EUR");
    expect(p.conversion).toBeUndefined();
  });

  it("un « timbre » imprimé en euros n'est pas le timbre du pack, fixé en dinars", () => {
    const p = proposerEnDevise(
      extrait("EUR", [["TVA_19", "1000.00", "190.00"]], "1191.00", [["DROIT_TIMBRE", "1.00"]]),
      "3.3456",
      timbre,
    );
    expect(p.pivot.approvable).toBe(false);
    expect(p.pivot.motifs.map((m) => m.code)).toContain("FISCAL_CHARGE_MISMATCH");
  });

  it("sans conversion, rien ne change : aucune ligne ne porte d'origine", () => {
    const p = buildProposal({
      pieceId: "11111111-1111-1111-1111-111111111111",
      payload: extrait("TND", [["TVA_19", "1000.000", "190.000"]], "1190.000"),
      taxRates,
      mappings,
      currency: "TND",
      parametres: { decimals: 3, confianceReserve: 0.7, confianceBloquante: 0.4 },
    });
    expect(p.conversion).toBeUndefined();
    expect(p.lignes.some((l) => l.devise_origine !== undefined)).toBe(false);
  });
});

const DECLARATION_D_ESSAI: DeclarationTva = {
  natureParDefaut: "AUTRE",
  natures: [{ code: "AUTRE", label: "Autre" }],
  affectations: [
    { sens: "deductible", nature: "AUTRE", ligne: "DED", origine: "pack", decideLe: null },
  ],
  lignes: [
    {
      code: "DED",
      label: "Déductible",
      sens: "deductible",
      nature: null,
      ordinal: 1,
      incertain: false,
    },
  ],
};

describe("la TVA du mois ne compte qu'une devise", () => {
  it("un extrait dans une autre devise que celle du calcul est refusé, nommé", () => {
    const r = tvaDesExtraits({
      period: "2026-09",
      currency: TND,
      taux: taxRates,
      declaration: DECLARATION_D_ESSAI,
      rows: [
        { pieceId: "p-eur", extract: extrait("EUR", [["TVA_19", "1000.00", "190.00"]], "1190.00") },
      ],
    });
    expect(r.totals.deductible).toBe("0.000");
    expect(r.refused).toEqual([{ reason: "EXTRAIT_EN_DEVISE:EUR", item_id: "p-eur" }]);
  });

  it("une pièce dont la conversion est refusée sort du calcul, avec sa raison (revue de #148)", () => {
    const r = tvaDesExtraits({
      period: "2026-09",
      currency: TND,
      taux: taxRates,
      declaration: DECLARATION_D_ESSAI,
      rows: [
        {
          pieceId: "p-refusee",
          extract: extrait("TND", [["TVA_19", "1000.000", "190.000"]], "1190.000"),
          refus: "CONVERSION_REFUSEE:desequilibre",
        },
      ],
    });
    expect(r.totals.deductible).toBe("0.000");
    expect(r.refused).toEqual([
      { reason: "CONVERSION_REFUSEE:desequilibre", item_id: "p-refusee" },
    ]);
    expect(HORS_DU_CALCUL).toContain("CONVERSION_REFUSEE");
  });
});
