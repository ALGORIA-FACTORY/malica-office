/**
 * Les chiffres arabes-indiens (U+0660…) et persans (U+06F0…), ramenés aux
 * chiffres latins.
 *
 * Les deux séries sont contiguës dans Unicode : la conversion est un décalage,
 * pas une table. Une transcription, pas une interprétation — chaque caractère a
 * un seul équivalent, et rien d'autre n'est touché.
 *
 * Quatre copies de ces deux lignes vivaient dans le dépôt (le matricule, la
 * date du plan de jetons, la normalisation des montants, la saisie à l'écran),
 * relevées le 30 octobre 2026 en unifiant les lecteurs de montants. Une seule
 * reste, ici.
 */
export function enChiffresLatins(texte: string): string {
  return texte
    .replace(/[٠-٩]/gu, (c) => String(c.codePointAt(0)! - 0x0660))
    .replace(/[۰-۹]/gu, (c) => String(c.codePointAt(0)! - 0x06f0));
}
