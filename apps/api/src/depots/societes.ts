/**
 * Les appels groupés par société — une règle, écrite une fois.
 */

/**
 * Les sociétés d'un appel groupé : des identifiants, sans doublon, en nombre
 * borné. Un tableau de cinq mille sociétés n'est pas une bibliothèque, c'est
 * un appel à refuser avant d'ouvrir un plan qui les lirait toutes.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SOCIETES_PAR_APPEL = 500;
export function idsDeSocietes(entree: unknown): string[] {
  if (!Array.isArray(entree)) throw new Error("societes.invalides");
  const ids = [...new Set(entree)];
  if (ids.length > SOCIETES_PAR_APPEL) throw new Error("societes.trop_nombreuses");
  if (!ids.every((id): id is string => typeof id === "string" && UUID.test(id)))
    throw new Error("societes.invalides");
  return ids;
}
