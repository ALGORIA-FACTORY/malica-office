/**
 * Toutes les opérations arithmétiques du socle passent par ici.
 * Interdit d'utiliser Number pour un montant : les tests de propriété
 * vérifient que les DTO restent des chaînes décimales.
 */
// Par son nom, pas par défaut : sous la résolution de Node, l'import par défaut
// d'un module qui se déclare aussi en CommonJS rend l'espace de noms entier, et
// `new Decimal()` n'est plus constructible. `decimal.mjs` exporte les deux ;
// le nom est le seul qui vaille des deux côtés — l'application comme l'API.
import { Decimal } from "decimal.js";

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

/**
 * Répartit un montant entre des poids, au plus fort reste : chaque part est
 * tronquée à `decimals`, puis les unités qui manquent vont, une à une, aux
 * parts dont la troncature a le plus perdu (à égalité, la première). La somme
 * des parts vaut exactement le montant, et aucune part n'est négative ni ne
 * dépasse sa juste valeur de plus d'une unité.
 *
 * Arrondir chaque part puis donner le reliquat à la dernière ne tient pas : 2
 * réparti sur 60/60/60/20 sans décimales donne 1/1/1/−1 (revue de #260).
 */
export function repartir(
  total: string | Decimal,
  poids: ReadonlyArray<string | Decimal>,
  decimals: number,
): Decimal[] {
  const montant = D(total);
  const base = sum(poids);
  if (poids.length === 0 || base.isZero()) throw new Error("repartir: aucun poids");
  if (montant.isNeg() || poids.some((p) => D(p).isNeg())) {
    throw new Error("repartir: montant ou poids négatif");
  }
  const unite = D(1).div(D(10).pow(decimals));
  const justes = poids.map((p) => montant.times(D(p)).div(base));
  const parts = justes.map((j) => j.toDecimalPlaces(decimals, Decimal.ROUND_DOWN));
  let manque = montant.minus(sum(parts)).div(unite).round().toNumber();
  const ordre = justes
    .map((j, i) => ({ i, perte: j.minus(parts[i]!) }))
    .sort((a, b) => b.perte.comparedTo(a.perte) || a.i - b.i);
  for (let k = 0; manque > 0; k = (k + 1) % ordre.length, manque -= 1) {
    const i = ordre[k]!.i;
    parts[i] = parts[i]!.plus(unite);
  }
  return parts;
}
