/**
 * Un refus se dit par une clé, et les valeurs qu'il cite voyagent avec elle.
 *
 * La base et l'API refusent par une CLÉ du dictionnaire (« refus.licence.
 * transmission ») : l'écran la dit dans la langue de la personne. Une phrase
 * française levée telle quelle arrivait, elle, en français à un utilisateur
 * qui lit l'arabe (audit d'intégrité du 1er novembre 2026).
 *
 * Certains refus citent une valeur que l'appelant a envoyée — « cette valeur
 * n'est pas admise : « assistee » ». La valeur ne se traduit pas ; elle suit
 * la clé, encodée comme une requête d'URL : `refus.moteur.valeur_non_admise?
 * valeur=assistee`. Le gabarit du dictionnaire la place (`{valeur}`).
 */

const CLE_DE_REFUS = /^refus\.[a-z0-9_.]+$/;

/** La clé et ses valeurs, en un seul message d'erreur. */
export function refusAvecValeurs(cle: string, valeurs: Record<string, string>): string {
  return `${cle}?${new URLSearchParams(valeurs).toString()}`;
}

/** Le message est-il un refus dit par sa clé, avec ou sans valeurs ? */
export function estUnRefusParCle(message: string): boolean {
  const i = message.indexOf("?");
  return CLE_DE_REFUS.test(i < 0 ? message : message.slice(0, i));
}

/**
 * Relit un message d'erreur : la clé et ses valeurs, ou le message tel quel
 * (sans valeurs) quand ce n'est pas un refus porteur de valeurs.
 */
export function lireUnRefus(message: string): { cle: string; valeurs: Record<string, string> } {
  const i = message.indexOf("?");
  const cle = i < 0 ? message : message.slice(0, i);
  if (i < 0 || !CLE_DE_REFUS.test(cle)) return { cle: message, valeurs: {} };
  return { cle, valeurs: Object.fromEntries(new URLSearchParams(message.slice(i + 1))) };
}
