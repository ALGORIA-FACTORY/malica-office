/**
 * Un montant du Socle, dans la langue du lecteur — le seul formateur du dépôt.
 *
 * Deux règles, et la frontière entre elles compte :
 *
 *   — le Socle produit une CHAÎNE DÉCIMALE exacte, « 1240.500 » ;
 *   — le lecteur la lit dans sa langue, « 1 240,500 ».
 *
 * Formater n'est pas calculer. Ce module ne fait aucune arithmétique : il
 * découpe la chaîne du Socle et regroupe les milliers. Convertir en `Number`
 * pour formater perdrait de la précision au-delà de quinze chiffres, et un
 * grand livre en centimes y arrive.
 *
 * Il vivait dans l'application (`lib/lisible.ts`). Le procès-verbal, rédigé
 * côté API, en a eu besoin le 5 novembre 2026 : son texte écrivait
 * « 3600.000 TND » quand le tableau du même PV, à l'écran, disait
 * « 3 600,000 TND ». Deux formateurs auraient fini par se contredire ; il n'y
 * en a qu'un, ici, et l'écran le réexporte.
 *
 * Les décimales ne sont ni ajoutées ni retirées : « 1240.500 » garde ses trois
 * décimales parce que le dinar en a trois, et c'est le Socle qui l'a décidé.
 */
export function montantLisible(valeur: string | null | undefined, locale: string): string {
  /*
   * ================================================== UN MONTANT PEUT MANQUER
   *
   * Le serveur rend du JSON, où un montant absent vaut `null`. Le 4 octobre
   * 2026, l'écran d'une pièce a planté sur un téléphone — « Cannot read
   * properties of null (reading 'trim') » — parce qu'un appelant se gardait de
   * `undefined` et pas de `null`.
   *
   * « Rien » se rend par RIEN, pas par « 0,000 » : un montant absent n'est pas
   * un montant nul, et une facture sans total ne doit pas afficher zéro.
   */
  if (valeur === null || valeur === undefined) return "";
  const propre = valeur.trim();
  if (propre === "") return "";
  const negatif = propre.startsWith("-");
  const sansSigne = negatif ? propre.slice(1) : propre;
  const [entiere = "0", decimale] = sansSigne.split(".");

  const separateurs = new Intl.NumberFormat(locale).formatToParts(12345.6);
  const brut = separateurs.find((p) => p.type === "group")?.value ?? " ";
  // U+202F, l'espace fine insécable du français, s'efface dans une police
  // proportionnelle. U+00A0 dit la même chose et se voit partout.
  const millier = brut === " " ? " " : brut;
  const virgule = separateurs.find((p) => p.type === "decimal")?.value ?? ",";

  // On groupe à la main : `Intl` formaterait un `Number`, donc arrondirait.
  const groupee = entiere.replace(/\B(?=(\d{3})+(?!\d))/g, millier);
  const corps = decimale ? `${groupee}${virgule}${decimale}` : groupee;
  return negatif ? `−${corps}` : corps;
}
