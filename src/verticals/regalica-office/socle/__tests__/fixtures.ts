import type {
  AccountMappingRule,
  CurrencyDef,
  TaxRateRow,
  Tolerances,
} from "../domain/types";
import type { ExtractV1 } from "../contracts/extract.v1";

export const TND: CurrencyDef = { code: "TND", decimals: 3 };
export const EUR: CurrencyDef = { code: "EUR", decimals: 2 };

export const TAX_RATES_TN: readonly TaxRateRow[] = [
  { code: "TVA_19", label: "TVA 19%", rate: "0.19", valid_from: "2018-01-01", valid_to: null, jurisdiction: "TN" },
  { code: "TVA_13", label: "TVA 13%", rate: "0.13", valid_from: "2018-01-01", valid_to: null, jurisdiction: "TN" },
  { code: "TVA_07", label: "TVA 7%",  rate: "0.07", valid_from: "2018-01-01", valid_to: null, jurisdiction: "TN" },
  { code: "TVA_00", label: "Exonéré",  rate: "0",   valid_from: "2018-01-01", valid_to: null, jurisdiction: "TN" },
];

export const MAP_ACHAT: AccountMappingRule = {
  document_kind: "facture_achat",
  charge_or_product_account: "607",
  vat_account: "4366",
  counterparty_account: "401",
};

export const MAP_VENTE: AccountMappingRule = {
  document_kind: "facture_vente",
  charge_or_product_account: "707",
  vat_account: "4367",
  counterparty_account: "411",
};

export const TOLERANCES: Tolerances = {
  rounding_tolerance: "0.001",
  confidence_orange: 0.85,
  confidence_red: 0.6,
};

export function factureAchatSimple(): ExtractV1 {
  return {
    contract: "extract.v1",
    issuer: "Fournisseur SARL",
    document_date: "2026-07-15",
    currency: "TND",
    document_kind: "facture_achat",
    lines: [
      { label: "Prestation", tax_code: "TVA_19", base_ht: "1000.000", vat_amount: "190.000", ttc: "1190.000" },
    ],
    articles: [],
  other_charges: [],
  totals: { base_ht: "1000.000", vat: "190.000", ttc: "1190.000" },
    references: { invoice_no: "F-2026-042" },
    field_confidence: { issuer: 0.99, document_date: 0.98, total: 0.99 },
  };
}

export function factureAchatMultiTaux(): ExtractV1 {
  return {
    contract: "extract.v1",
    issuer: "Multi Taux SARL",
    document_date: "2026-07-20",
    currency: "TND",
    document_kind: "facture_achat",
    lines: [
      { label: "Bien 19%", tax_code: "TVA_19", base_ht: "500.000", vat_amount: "95.000", ttc: "595.000" },
      { label: "Bien 13%", tax_code: "TVA_13", base_ht: "200.000", vat_amount: "26.000", ttc: "226.000" },
      { label: "Bien 7%",  tax_code: "TVA_07", base_ht: "100.000", vat_amount: "7.000",  ttc: "107.000" },
    ],
    articles: [],
  other_charges: [],
  totals: { base_ht: "800.000", vat: "128.000", ttc: "928.000" },
    references: {},
    field_confidence: { issuer: 0.9, total: 0.9 },
  };
}

export function factureDesequilibree(): ExtractV1 {
  const f = factureAchatSimple();
  const [first, ...rest] = f.lines;
  if (!first) throw new Error("fixture invalide : aucune ligne");
  return {
    ...f,
    lines: [{ ...first, ttc: "999.000" }, ...rest],
    articles: [],
  other_charges: [],
  totals: { ...f.totals, ttc: "999.000" },
  };
}


export function factureTauxManquant(): ExtractV1 {
  return {
    ...factureAchatSimple(),
    document_date: "2010-01-01", // avant valid_from des taux
  };
}

export function factureVenteSimple(): ExtractV1 {
  return {
    contract: "extract.v1",
    issuer: "Client SA",
    document_date: "2026-07-10",
    currency: "TND",
    document_kind: "facture_vente",
    lines: [
      { label: "Vente", tax_code: "TVA_19", base_ht: "2000.000", vat_amount: "380.000", ttc: "2380.000" },
    ],
    articles: [],
  other_charges: [],
  totals: { base_ht: "2000.000", vat: "380.000", ttc: "2380.000" },
    references: {},
    field_confidence: { issuer: 0.95, total: 0.95 },
  };
}
