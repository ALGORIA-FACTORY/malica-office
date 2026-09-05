/**
 * Une date de PostgreSQL, rendue au format ISO `AAAA-MM-JJ`.
 *
 * ============================================================== POURQUOI ICI
 *
 * Cette fonction existait DEUX fois, identique à l'octet près, dans
 * `depots/corpus.ts` et `depots/identite.ts`. Deux copies d'un même geste,
 * c'est une divergence qui attend son heure : on corrige l'une, l'autre garde
 * le défaut, et une date sort différemment selon le dépôt qui l'a lue.
 *
 * ============================================================ POURQUOI PAS `toISOString`
 *
 * `toISOString()` passe par l'UTC : une date de colonne `date` lue à minuit à
 * Tunis (UTC+1) reculerait d'un jour. On lit donc les composantes LOCALES —
 * ce sont celles que le pilote a construites depuis la valeur de la colonne.
 *
 * Une valeur qui n'est pas une `Date` — une chaîne déjà formatée, selon le
 * typage du pilote — est rendue telle quelle. `null` reste `null` : une date
 * absente est une information, pas un défaut à combler.
 */
export function enDate(d: unknown): string | null {
  if (d === null || d === undefined) return null;
  if (!(d instanceof Date)) return String(d);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
