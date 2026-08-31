/**
 * Rendre lisible ce que le Socle a produit.
 *
 * Deux règles, et la frontière entre elles compte :
 *
 *   — le Socle produit une CHAÎNE DÉCIMALE exacte, « 1240.500 » ;
 *   — l'écran l'affiche dans la langue du lecteur, « 1 240,500 ».
 *
 * Formater n'est pas calculer. Ce module ne fait aucune arithmétique : il
 * découpe la chaîne du Socle et regroupe les milliers. Convertir en `Number`
 * pour formater perdrait de la précision au-delà de quinze chiffres, et un
 * grand livre en centimes y arrive.
 */

/**
 * Un montant du Socle, dans la langue du lecteur.
 *
 * Les décimales ne sont ni ajoutées ni retirées : « 1240.500 » garde ses trois
 * décimales parce que le dinar en a trois, et c'est le Socle qui l'a décidé.
 */
export function montant(valeur: string, locale: string): string {
  const propre = valeur.trim();
  const negatif = propre.startsWith("-");
  const sansSigne = negatif ? propre.slice(1) : propre;
  const [entiere = "0", decimale] = sansSigne.split(".");

  const separateurs = new Intl.NumberFormat(locale).formatToParts(12345.6);
  const brut = separateurs.find((p) => p.type === "group")?.value ?? "\u00a0";
  // U+202F, l'espace fine insécable du français, s'efface dans une police
  // proportionnelle. U+00A0 dit la même chose et se voit partout.
  const millier = brut === "\u202f" ? "\u00a0" : brut;
  const virgule = separateurs.find((p) => p.type === "decimal")?.value ?? ",";

  // On groupe à la main : `Intl` formaterait un `Number`, donc arrondirait.
  const groupee = entiere.replace(/\B(?=(\d{3})+(?!\d))/g, millier);
  const corps = decimale ? `${groupee}${virgule}${decimale}` : groupee;
  return negatif ? `−${corps}` : corps;
}

/** Un montant signé — le « + » d'une progression se lit autant que le « − ». */
export function montantSigne(valeur: string, locale: string): string {
  const rendu = montant(valeur, locale);
  return Number(valeur) > 0 ? `+${rendu}` : rendu;
}

/**
 * « de » ou « d' » devant un nom de mois.
 *
 * « Déclaration de août » n'est pas du français. La règle : on élide devant
 * une voyelle et devant le h muet. Les mois français ne comptent aucun h,
 * donc les voyelles suffisent — avril, août, octobre.
 *
 * Les autres langues n'élident pas ; elles reçoivent le mois tel quel et
 * ignorent ce fragment.
 */
export function deMois(mois: string, locale: string): string {
  if (!locale.startsWith("fr")) return mois;
  const premiere = mois.trim().charAt(0).toLowerCase();
  return "aàâeéèêiîoôuûy".includes(premiere) ? `d'${mois}` : `de ${mois}`;
}
