/**
 * Types partagés — jamais de constante métier ici (taux, décimales, plan
 * comptable). Ces valeurs entrent dans les moteurs par paramètre.
 */
export interface CurrencyDef {
  code: string;
  decimals: number;
}

export interface TaxRateRow {
  code: string;
  label: string;
  rate: string; // décimale en chaîne, ex. "0.19"
  valid_from: string; // YYYY-MM-DD
  valid_to: string | null;
  jurisdiction: string;
}

export interface AccountRow {
  account_code: string;
  label: string;
  parent_code: string | null;
  // classe = premier caractère du plan (ex. "6" charges, "7" produits, "4" tiers)
}

export interface AccountMappingRule {
  // Compte à mouvementer en contrepartie selon le type de document / le tax_code.
  document_kind: "facture_achat" | "facture_vente";
  charge_or_product_account: string; // ex. 607 (achats marchandises) / 707 (ventes)
  vat_account: string; // 4366 déductible / 4367 collectée
  counterparty_account: string; // 401 fournisseurs / 411 clients
}

export interface Tolerances {
  // écart absolu accepté sur l'équilibre (arrondi) en unité de la devise.
  rounding_tolerance: string;
  // seuil de confiance en dessous duquel on tombe en ORANGE.
  confidence_orange: number;
  // seuil en dessous duquel on tombe en ROUGE (confiance).
  confidence_red: number;
}
