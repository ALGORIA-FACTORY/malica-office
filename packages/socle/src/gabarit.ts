/**
 * Remplit un gabarit de message : chaque `{nom}` reçoit sa valeur, telle quelle.
 *
 * Une seule règle pour l'écran, le serveur et les refus traduits. La valeur
 * passe par une fonction de remplacement, jamais comme chaîne de remplacement :
 * `replaceAll` y lirait `$&`, `$'` ou `` $` `` comme des motifs, et une valeur
 * saisie par quelqu'un (un libellé, un identifiant cité par un refus)
 * s'afficherait tronquée ou dupliquée.
 *
 * ================================================ « RETOUR D’AUDICORP »
 *
 * Le français élide « de » devant une voyelle : « Retour d’AUDICORP »,
 * « Demander l’avis d’Amel », « la licence d’ALGORIA ». Le gabarit ne peut pas l’écrire, il ignore
 * le nom qu’il recevra. La règle vit donc ICI, une fois, et pas dans chaque
 * écran : un `de {nom}` du gabarit devient `d’` quand la valeur commence par
 * une voyelle — A E I O U Y et leurs variantes accentuées, en majuscule comme
 * en minuscule.
 *
 * Le h muet n'est PAS élidé, et c'est un choix : « de Hédi » et « d’Hélène »
 * ne se distinguent pas à l'écriture, et une règle qui devine se trompe à
 * l'écran d'un dirigeant. Mieux vaut un « de » correct qu'une élision fausse.
 *
 * Seul le motif `de {nom}` est lu, mot entier : il n'existe qu'en français,
 * et un nombre, une date chiffrée ou un montant ne commencent jamais par une
 * voyelle — ils gardent « de ».
 */
export function remplirLeGabarit(
  gabarit: string,
  valeurs: Readonly<Record<string, string | number>>,
): string {
  return Object.entries(valeurs).reduce((texte, [nom, valeur]) => {
    const v = String(valeur);
    const elide = VOYELLE_INITIALE.test(v)
      ? texte.replace(
          new RegExp(`(?<![\\p{L}\\p{N}_])([dD])e \\{${echappe(nom)}\\}`, "gu"),
          (_, d: string) => `${d}’${v}`,
        )
      : texte;
    return elide.replaceAll(`{${nom}}`, () => v);
  }, gabarit);
}

/** La première lettre d'une valeur qui fait élider « de » (voir plus haut). */
const VOYELLE_INITIALE = /^[aeiouyàâäéèêëîïôöùûüÿæœ]/iu;

/** Un nom de variable lu comme texte, jamais comme motif. */
function echappe(nom: string): string {
  return nom.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
