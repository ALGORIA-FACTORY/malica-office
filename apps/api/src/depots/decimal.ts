/**
 * La conversion des numériques, en un seul endroit.
 *
 * Le piège, découvert en portant le référentiel : PostgREST rendait les
 * `numeric` en NOMBRES JSON, `pg` les rend en CHAÎNES. Les adaptateurs
 * d'origine faisaient confiance aux chaînes et ne reformataient que les
 * nombres — repris tels quels, ils laissent passer « 0.190000 » là où le
 * contrat attend « 0.1900 ».
 *
 * Aucun type ne s'en plaint. Le décalage se glisserait dans chaque montant,
 * chaque taux et chaque tolérance des huit dépôts. D'où ce fichier : la règle
 * vit à un seul endroit, et chaque dépôt l'importe.
 */

/** Chaîne décimale à N décimales. Zéro quand la valeur est absente. */
export function dec(v: unknown, decimales = 3): string {
  if (v === null || v === undefined) return (0).toFixed(decimales);
  return Number(v).toFixed(decimales);
}

/** Idem, mais l'absence reste `null` — elle porte une information. */
export function decOuNul(v: unknown, decimales = 3): string | null {
  if (v === null || v === undefined) return null;
  return Number(v).toFixed(decimales);
}

/** Le jour, au format que la base compare aux colonnes `date`. */
export function aujourdhui(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Filtre les lignes en vigueur ce jour. Les référentiels sont versionnés par
 * date d'effet : lire sans filtrer donnerait le taux d'un autre exercice.
 */
export function enVigueur<T extends Record<string, unknown>>(lignes: T[]): T[] {
  const jour = aujourdhui();
  return lignes.filter(
    (r) => String(r["valid_from"]) <= jour && (!r["valid_to"] || String(r["valid_to"]) >= jour),
  );
}
