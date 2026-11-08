/**
 * La réponse de Malica s'écrit mot à mot — planche 8, approuvée le 7 novembre
 * 2026.
 *
 * Ce qui s'écrit est la VRAIE réponse, déjà reçue en entier : l'écran la
 * dévoile, il n'invente rien. Une longue réponse ne fait pas attendre : le
 * pas grandit pour que tout soit écrit en `DUREE_MAX` au plus.
 */

/** Le temps entre deux pas, en millisecondes. */
export const PAS_MS = 45;
/** Le temps au-delà duquel une réponse n'attend plus son dévoilement. */
export const DUREE_MAX = 3200;

/** Les mots d'un texte, chacun avec l'espace qui le suit (pour rendre le texte exact). */
export function morceaux(texte: string): string[] {
  return texte.match(/\S+\s*|\s+/g) ?? [];
}

/** Combien de mots montrer à chaque pas, pour tenir dans `DUREE_MAX`. */
export function motsParPas(total: number): number {
  const pas = Math.floor(DUREE_MAX / PAS_MS);
  return Math.max(1, Math.ceil(total / pas));
}

/** Le texte montré après `n` mots. */
export function texteMontre(texte: string, n: number): string {
  const m = morceaux(texte);
  return n >= m.length ? texte : m.slice(0, n).join("");
}
