import type { TaxRateRow } from "./types.ts";

/**
 * Résout un taux applicable à une date donnée. Retourne `null` si aucun taux
 * n'est valide — le moteur DOIT refuser de calculer plutôt qu'inventer.
 */
export function resolveTaxRate(
  rates: readonly TaxRateRow[],
  code: string,
  documentDate: string,
): TaxRateRow | null {
  const hit = rates.find(
    (r) =>
      r.code === code &&
      r.valid_from <= documentDate &&
      (r.valid_to === null || r.valid_to >= documentDate),
  );
  return hit ?? null;
}
