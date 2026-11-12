/**
 * 3B-2 — La confiance de chaque champ lu.
 *
 * Deux organes lisent une pièce : le relevé (la couche de texte d'un PDF, ou le
 * modèle de vision, jeton par jeton) et la désignation (le modèle qui dit quel
 * jeton est le TTC, le numéro…). Un champ n'est pas plus sûr que le moins sûr
 * des deux : sa confiance est le minimum entre la confiance globale de la
 * désignation et celle de chacun de ses jetons cités.
 *
 * Un jeton sans confiance propre — la couche de texte d'un PDF n'en donne pas,
 * elle est exacte — n'abaisse rien. Une citation sans jeton n'invente rien.
 */

const borner = (x: number) => Math.min(1, Math.max(0, x));

/**
 * Le NEUTRE du minimum : la confiance d'une désignation qui n'ajoute aucune
 * incertitude. Un désignateur déterministe (une recette, le Sudoku seul) désigne
 * ou s'abstient, il n'échantillonne pas. Ce n'est pas « sûr à 100 % » : la
 * confiance du champ devient celle de son jeton relevé, exactement comme pour un
 * jeton sans confiance propre.
 */
export const NEUTRE_DU_MINIMUM = 1;

export function confianceParChamp(
  citations: ReadonlyArray<{ field: string; page: number; ordinal: number }>,
  jetons: ReadonlyArray<{ page: number; ordinal: number; confidence?: number | null }>,
  confianceDesignation: number,
): Record<string, number> {
  const parPlace = new Map(jetons.map((j) => [`${j.page}:${j.ordinal}`, j]));
  const resultat: Record<string, number> = {};
  for (const c of citations) {
    const j = parPlace.get(`${c.page}:${c.ordinal}`);
    if (!j) continue;
    const propre = typeof j.confidence === "number" ? j.confidence : 1;
    const valeur = borner(Math.min(propre, confianceDesignation));
    resultat[c.field] = Math.min(resultat[c.field] ?? 1, valeur);
  }
  return resultat;
}
