import { enChiffresLatins } from "./chiffres.ts";

/**
 * Un montant TAPÉ par une personne, vers la chaîne décimale du Socle.
 *
 * C'est l'inverse de `montant()` (`apps/web/src/lib/lisible.ts`) : l'écran
 * affiche « 1 234,500 », la personne recopie « 1 234,500 », et le Socle attend
 * « 1234.500 ». Un `.replace(",", ".")` rendait « 1 234.500 », que le moteur
 * refusait comme montant invalide.
 *
 * Un montant tapé n'est pas un montant imprimé : la personne voit ce qu'elle
 * écrit, et le séparateur qu'elle tape est sa décimale. Ce n'est donc pas la
 * règle du lecteur des pièces (`montant-imprime.ts`), qui doute d'un « 2.800 ».
 * Mais c'est UNE règle : elle vivait à l'écran, et six saisies la recopiaient
 * par un `.replace(",", ".")` (le paiement, le stock, la tour, la recharge, la
 * saisie d'une écriture au Socle) — relevé le 30 octobre 2026. Elle vit ici,
 * et toutes l'appellent.
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
  const chiffres = enChiffresLatins(texte.trim())
    .replace(/٫/g, ",")
    // `\s` couvre U+0020, U+00A0 et U+202F : toutes les espaces de milliers.
    .replace(/\s/g, "");
  if (chiffres === "") return null;
  if (chiffres.includes(",") && chiffres.includes(".")) return null;
  const canonique = chiffres.replace(",", ".");
  return /^\d+(\.\d+)?$/.test(canonique) ? canonique : null;
}
