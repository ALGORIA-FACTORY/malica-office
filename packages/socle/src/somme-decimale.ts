/**
 * Additionner des montants sans en perdre un millime.
 *
 * Les montants du Socle voyagent en chaînes décimales — « 404.600 » — parce
 * qu'un flottant ne sait pas représenter 0,1. Un écran qui les additionne
 * pour un total de lot doit le faire en entiers : on lit chaque montant
 * dans la plus petite unité, on somme, on réécrit.
 *
 * Ce n'est pas un moteur : rien ici ne décide d'une imputation ni d'un
 * taux. C'est l'arithmétique d'un total affiché, exacte.
 */

/** « 404.600 » → 404600 pour trois décimales ; « 12 » → 12000. Rejette ce qui n'est pas un nombre. */
function enUnites(valeur: string, decimales: number): bigint {
  const propre = valeur.trim().replace(",", ".");
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(propre);
  if (!m) throw new Error(`montant illisible : ${valeur}`);
  const signe = m[1] === "-" ? -1n : 1n;
  const entier = m[2]!;
  const fraction = (m[3] ?? "").padEnd(decimales, "0").slice(0, decimales);
  return signe * BigInt(entier + fraction);
}

function depuisUnites(unites: bigint, decimales: number): string {
  const negatif = unites < 0n;
  const abs = (negatif ? -unites : unites).toString().padStart(decimales + 1, "0");
  const entier = abs.slice(0, abs.length - decimales);
  const fraction = abs.slice(abs.length - decimales);
  return `${negatif ? "-" : ""}${entier}${decimales > 0 ? `.${fraction}` : ""}`;
}

/** La somme exacte de montants décimaux, rendue avec `decimales` décimales. */
export function sommeDecimale(valeurs: readonly string[], decimales = 3): string {
  let total = 0n;
  for (const v of valeurs) total += enUnites(v, decimales);
  return depuisUnites(total, decimales);
}

/** Vrai si le montant vaut zéro, quelle que soit son écriture (« 0 », « 0.000 »). */
export function estNul(valeur: string, decimales = 3): boolean {
  try {
    return enUnites(valeur, decimales) === 0n;
  } catch {
    return false;
  }
}

/**
 * Une unité mineure vers sa chaîne décimale : 613493 → « 613.493 ».
 *
 * La base garde les montants en unités mineures — un entier, jamais un
 * flottant. Les documents, eux, portent des chaînes décimales. La conversion
 * se fait donc ici, avec les décimales du pack, et pas par un `/ 1000` écrit
 * dans un écran : trois décimales sont tunisiennes, et la première
 * juridiction à deux aurait affiché mille fois le montant.
 */
export function depuisUniteMineure(unites: number, decimales: number): string {
  if (!Number.isInteger(unites)) {
    throw new Error(`unité mineure non entière : ${unites}`);
  }
  return depuisUnites(BigInt(unites), decimales);
}
