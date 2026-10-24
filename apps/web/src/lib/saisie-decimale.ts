/**
 * Un montant TAPÉ par une personne, vers la chaîne décimale du Socle.
 *
 * C'est l'inverse de `montant()` (`lisible.ts`) : l'écran affiche
 * « 1 234,500 », la personne recopie « 1 234,500 », et le Socle attend
 * « 1234.500 ». Un `.replace(",", ".")` rendait « 1 234.500 », que le moteur
 * refusait comme montant invalide.
 *
 * Ce qui est accepté :
 *   — les chiffres latins et arabes (٠-٩, ۰-۹) ;
 *   — les espaces de milliers, quelles qu'elles soient (U+0020, U+00A0, U+202F) ;
 *   — UN séparateur décimal : virgule, point ou séparateur arabe « ٫ ».
 *
 * Ce qui est refusé (rendu `null`) : un texte qui mêle virgule et point.
 * « 1,234.500 » et « 1.234,500 » sont deux montants différents selon la
 * langue de qui les a écrits ; deviner produirait un montant plausible et
 * faux, mille fois trop grand ou trop petit. On demande plutôt de corriger.
 *
 * Aucune arithmétique : on réécrit la chaîne, on ne l'arrondit pas.
 */
export function saisieDecimale(texte: string): string | null {
  const chiffres = texte
    .trim()
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, ",")
    // `\s` couvre U+0020, U+00A0 et U+202F : toutes les espaces de milliers.
    .replace(/\s/g, "");
  if (chiffres === "") return null;
  if (chiffres.includes(",") && chiffres.includes(".")) return null;
  const canonique = chiffres.replace(",", ".");
  return /^\d+(\.\d+)?$/.test(canonique) ? canonique : null;
}
