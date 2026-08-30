/**
 * Toutes les opérations arithmétiques du socle passent par ici.
 * Interdit d'utiliser Number pour un montant : les tests de propriété
 * vérifient que les DTO restent des chaînes décimales.
 */
import Decimal from "decimal.js";

// ROUND_HALF_EVEN (arrondi bancaire) — évite le biais de l'arrondi commercial.
Decimal.set({ rounding: Decimal.ROUND_HALF_EVEN, precision: 40 });

export function D(v: string | number | Decimal): Decimal {
  return new Decimal(v);
}

export function toFixedStr(v: Decimal, decimals: number): string {
  return v.toDecimalPlaces(decimals, Decimal.ROUND_HALF_EVEN).toFixed(decimals);
}

export function sum(values: Iterable<string | Decimal>): Decimal {
  let acc = new Decimal(0);
  for (const v of values) acc = acc.plus(v);
  return acc;
}

export { Decimal };
