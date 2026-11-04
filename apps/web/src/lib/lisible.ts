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
import { noterAuJournal } from "./journal-atelier";

/**
 * Un montant du Socle, dans la langue du lecteur.
 *
 * Les décimales ne sont ni ajoutées ni retirées : « 1240.500 » garde ses trois
 * décimales parce que le dinar en a trois, et c'est le Socle qui l'a décidé.
 */
export function montant(valeur: string | null | undefined, locale: string): string {
  /*
   * ================================================== UN MONTANT PEUT MANQUER
   *
   * La signature disait `string`, et elle mentait : le serveur rend du JSON,
   * où un montant absent vaut `null`. Le 4 octobre 2026, l'écran d'une pièce
   * a planté sur un téléphone — « Cannot read properties of null (reading
   * 'trim') » — parce qu'un appelant se gardait de `undefined` et pas de
   * `null`. Corriger le seul appelant aurait laissé le piège aux suivants.
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
 * Une quantité du Socle, dans la langue du lecteur.
 *
 * Une quantité N'EST PAS un montant, et l'afficher comme tel ment : la base
 * stocke « 300.000 » parce que la colonne porte trois décimales, mais on
 * n'achète pas 300,000 ramettes — on en achète 300. Le dinar garde ses trois
 * décimales parce que le dinar EST divisé en millimes ; une ramette, non.
 *
 * On retire donc les zéros de queue — et le séparateur décimal avec eux
 * quand il ne reste rien derrière. « 2.500 » devient « 2,5 » : la demie
 * compte, les zéros non.
 *
 * Aucune arithmétique ici non plus : on coupe la chaîne, on ne l'arrondit
 * pas. « 0.001 » reste « 0,001 ».
 */
export function quantite(valeur: string | null | undefined, locale: string): string {
  if (valeur === null || valeur === undefined) return "";
  const propre = valeur.trim();
  if (propre === "") return "";
  if (!propre.includes(".")) return montant(propre, locale);
  const sansZeros = propre.replace(/0+$/, "").replace(/\.$/, "");
  return montant(sansZeros === "" || sansZeros === "-" ? "0" : sansZeros, locale);
}

/** Ce qu'affiche une date que le Socle a rendue illisible : rien qui ressemble à une date. */
const DATE_ILLISIBLE = "—";

/**
 * Le jour d'une date du Socle, mis en forme ; jamais d'exception.
 *
 * Lu en UTC : une date de calendrier n'a pas d'heure, et la lire à minuit
 * local la ferait reculer d'un jour à l'ouest de Greenwich.
 *
 * Le 29 octobre 2026, une recharge sans échéance est arrivée avec
 * `expire_le: "infinity"` : `Intl` a levé « Invalid time value » au milieu du
 * rendu, et tout l'écran des réglages est tombé. Une date illisible part donc
 * au journal et s'affiche neutre ; une date ABSENTE n'est pas une erreur et
 * rend `sansDate`.
 */
function jourDuSocle(
  iso: string | null | undefined,
  locale: string,
  forme: Intl.DateTimeFormatOptions,
  sansDate: string,
): string {
  if (iso === null || iso === undefined || iso === "") return sansDate;
  const jour = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(jour.getTime())) {
    noterAuJournal("lib/lisible : date", new RangeError(`date illisible : ${iso}`));
    return DATE_ILLISIBLE;
  }
  return new Intl.DateTimeFormat(locale, { ...forme, timeZone: "UTC" }).format(jour);
}

/** Une date du Socle (« 2026-11-30 »), en chiffres, dans la langue du lecteur. */
export function dateEnChiffres(iso: string, locale: string): string {
  return jourDuSocle(iso, locale, { day: "2-digit", month: "2-digit", year: "numeric" }, "");
}

/**
 * Une date du Socle en toutes lettres (« 30 novembre 2026 »), dans la langue
 * du lecteur. Absente, elle rend `sansDate` — la phrase que l'appelant a
 * choisie, vide par défaut.
 */
export function dateEnLettres(
  iso: string | null | undefined,
  locale: string,
  sansDate = "",
): string {
  return jourDuSocle(iso, locale, { day: "numeric", month: "long", year: "numeric" }, sansDate);
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

/**
 * Le jour d'une date du Socle ou d'un instant, dans la forme demandée.
 *
 * Une DATE (« 2026-10-30 ») n'a pas de fuseau : elle se lit telle quelle. Un
 * INSTANT (« 2026-10-29T23:20:00Z ») se lit à l'heure du lecteur, comme
 * l'heure qu'on lui montre à côté. Relevé sur staging le 30 octobre 2026, à
 * 00:20 à Tunis : « Transmise à AUDICORP · 29/10 » sous « depuis 00:20 » —
 * le jour en UTC, l'heure locale, deux fuseaux dans la même phrase.
 */
export function jourOuInstant(
  iso: string,
  locale: string,
  forme: Intl.DateTimeFormatOptions = { day: "2-digit", month: "2-digit" },
): string {
  return iso.length === 10
    ? new Intl.DateTimeFormat(locale, { ...forme, timeZone: "UTC" }).format(
        new Date(`${iso}T00:00:00Z`),
      )
    : new Intl.DateTimeFormat(locale, forme).format(new Date(iso));
}

/** Le mois (`AAAA-MM`) d'un instant, à l'heure du lecteur — la même règle que son jour. */
export function moisLocal(instant: Date): string {
  return `${instant.getFullYear()}-${String(instant.getMonth() + 1).padStart(2, "0")}`;
}

/** Le jour et le mois, en chiffres (« 13/10 ») — d'une date du Socle ou d'un instant. */
export function jourEtMois(iso: string, locale: string): string {
  return jourOuInstant(iso, locale);
}

/**
 * Quand une chose est partie, dit comme on le dit (écran « Envoyé », maquette
 * validée le 27 octobre 2026) : l'heure si c'est aujourd'hui (« 10:42 »),
 * sinon le jour (« 26/10 »).
 *
 * Un instant, pas une date : il se lit à l'heure du lecteur. `maintenant` est
 * un paramètre pour que le test ne dépende pas de l'horloge.
 */
export function momentDeLEnvoi(
  iso: string,
  locale: string,
  maintenant: Date = new Date(),
): { quand: string; aujourdhui: boolean } {
  const d = new Date(iso);
  const aujourdhui =
    d.getFullYear() === maintenant.getFullYear() &&
    d.getMonth() === maintenant.getMonth() &&
    d.getDate() === maintenant.getDate();
  const quand = new Intl.DateTimeFormat(
    locale,
    aujourdhui ? { hour: "2-digit", minute: "2-digit" } : { day: "2-digit", month: "2-digit" },
  ).format(d);
  return { quand, aujourdhui };
}

/**
 * Un texte qui ouvre une phrase : sa première lettre seule passe en majuscule.
 *
 * Relevé sur staging le 4 novembre 2026 : l'accueil du cabinet titrait
 * « Mercredi 4 Novembre ». Le `text-transform: capitalize` de la feuille
 * mettait une majuscule à CHAQUE mot ; en français, le mois et le jour
 * s'écrivent en minuscules, et seule l'initiale de la phrase se relève.
 * L'anglais garde les majuscules qu'Intl lui donne déjà ; l'arabe n'a pas
 * de casse, et la fonction le laisse tel quel.
 */
export function enDebutDePhrase(texte: string, locale: string): string {
  const [premier] = texte;
  if (premier === undefined) return texte;
  return premier.toLocaleUpperCase(locale) + texte.slice(premier.length);
}

/** Au-delà de ce compte, un badge dit « 99+ » : trois chiffres débordent la pastille. */
const PLAFOND_DU_BADGE = 99;

/**
 * Le compte qu'affiche un badge : exact jusqu'à 99, « 99+ » au-delà. Le compte
 * exact reste dans l'étiquette lue par un lecteur d'écran, jamais tronqué.
 */
export function compteDuBadge(n: number): string {
  return n > PLAFOND_DU_BADGE ? `${PLAFOND_DU_BADGE}+` : String(n);
}
