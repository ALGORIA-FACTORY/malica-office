/**
 * Remplit un gabarit de message : chaque `{nom}` reçoit sa valeur, telle quelle.
 *
 * Une seule règle pour l'écran, le serveur et les refus traduits. La valeur
 * passe par une fonction de remplacement, jamais comme chaîne de remplacement :
 * `replaceAll` y lirait `$&`, `$'` ou `` $` `` comme des motifs, et une valeur
 * saisie par quelqu'un (un libellé, un identifiant cité par un refus)
 * s'afficherait tronquée ou dupliquée.
 */
export function remplirLeGabarit(
  gabarit: string,
  valeurs: Readonly<Record<string, string | number>>,
): string {
  return Object.entries(valeurs).reduce(
    (texte, [nom, valeur]) => texte.replaceAll(`{${nom}}`, () => String(valeur)),
    gabarit,
  );
}
