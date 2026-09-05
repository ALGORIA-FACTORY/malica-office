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
 *
 * Et la règle ne passe JAMAIS par un flottant : une chaîne décimale se
 * cadre chiffre par chiffre, l'arrondi se fait en entiers (demi vers le
 * haut, comme en comptabilité). Un montant qui traverse `Number` perd sa
 * troisième décimale au-delà de quelques milliards de millimes — ce n'est
 * pas une hypothèse qu'un logiciel comptable a le droit de faire.
 */

/** Cadre une écriture décimale à N décimales, sans flottant. */
function cadrer(v: unknown, decimales: number): string {
  // Un nombre JavaScript (un compte, un calcul) s'écrit en décimal développé,
  // jamais en notation savante : « 1e-7 » n'est pas une écriture comptable.
  if (typeof v === "number" && !Number.isFinite(v)) throw new Error("decimal.illisible: nombre");
  const brut = (typeof v === "number" ? v.toFixed(20) : String(v)).trim();
  const m = /^([+-])?(\d*)(?:\.(\d*))?$/.exec(brut);
  if (!m || (m[2] === "" && (m[3] ?? "") === "")) {
    throw new Error(`decimal.illisible: ${brut}`);
  }
  const negatif = m[1] === "-";
  const entier = m[2] === "" ? "0" : m[2]!;
  const fraction = (m[3] ?? "").padEnd(decimales + 1, "0");
  // Un chiffre de garde, puis l'arrondi en entiers : demi vers le haut.
  const garde = BigInt(entier + fraction.slice(0, decimales + 1));
  const arrondi = garde / 10n + (garde % 10n >= 5n ? 1n : 0n);
  const chiffres = arrondi.toString().padStart(decimales + 1, "0");
  const texte =
    decimales === 0 ? chiffres : `${chiffres.slice(0, -decimales)}.${chiffres.slice(-decimales)}`;
  return negatif && arrondi !== 0n ? `-${texte}` : texte;
}

/** Chaîne décimale à N décimales. Zéro quand la valeur est absente. */
export function dec(v: unknown, decimales = 3): string {
  if (v === null || v === undefined) return cadrer("0", decimales);
  return cadrer(v, decimales);
}

/** Idem, mais l'absence reste `null` — elle porte une information. */
export function decOuNul(v: unknown, decimales = 3): string | null {
  if (v === null || v === undefined) return null;
  return cadrer(v, decimales);
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
