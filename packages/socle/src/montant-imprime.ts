/**
 * Lire un montant IMPRIMÉ — le seul lecteur du dépôt.
 *
 * ================================================================= POURQUOI
 *
 * Jusqu'au 30 octobre 2026, deux lecteurs lisaient les mêmes textes : celui du
 * plan de jetons (`malica/lecture/montants.ts`, qui nourrit les hypothèses du
 * solveur) et celui de la normalisation (`scan/normaliser-montants.ts`, qui
 * nourrit les contrôles et la proposition d'écriture). La PR 138 leur avait
 * fait partager les marques de devise ; les nombres, eux, se lisaient deux
 * fois, et sur 32 textes relevés par la PR 142 ils se contredisaient 13 fois.
 * Sur le corpus du dépôt, 107 textes sur 548 :
 *
 *   — « + 135,183 » (le total du 13 octobre, dont le « 4 » est devenu « + »)
 *     se lisait 135,183 au plan de jetons, et pas du tout au scan ;
 *   — « (514,700) » se lisait moins 514,700 d'un côté, rien de l'autre ;
 *   — « 100,000 » valait 100 dinars d'un côté, 100 ou 100 000 de l'autre ;
 *   — « ٣ ٠٢٠٫٠٠٠ » se lisait d'un côté seulement.
 *
 * Il n'y a plus qu'un lecteur, et UN jeu de règles, écrit ci-dessous. Chaque
 * chaîne garde sa POLITIQUE, à un seul endroit et documentée : le plan de
 * jetons veut des hypothèses et refuse les chiffres arabes que son modèle de
 * vision rend inversés (`treillisMontant`) ; la normalisation veut des
 * candidats que l'arithmétique de la facture départage (`candidatsMontant`).
 * Aucune des deux ne relit un nombre.
 *
 * ================================================================= LES RÈGLES
 *
 *  1. Les chiffres arabes et persans se lisent (transcription, `chiffres.ts`) ;
 *     la lecture le DIT (`chiffresArabes`), pour la politique qui en dépend.
 *     « ٫ » est le séparateur décimal de la devise, « ٬ » une apostrophe de
 *     milliers.
 *  2. Seules les marques de devise du référentiel (`ref.devises`,
 *     `ref.devises_marques`) sont une décoration. Tout autre mot fait du texte
 *     un texte : « art. 9 », « TVA 19 », « Total 1 234,560 ».
 *  3. Un « % » fait du texte un taux, jamais un montant.
 *  4. Un « / » ou un chiffre de part et d'autre d'un « : » font une date, une
 *     heure ou un numéro : « 08/09/2026 », « 23:18 ».
 *  5. LE SIGNE. Un « - » en tête est un négatif. Tout autre signe refuse :
 *       « + » n'est jamais un signe — le 13 octobre 2026, c'était un « 4 »
 *         imprimé en blanc sur bande noire, et le lire aurait rendu un total
 *         amputé de 4 000 dinars (`un-total-illisible-n-efface-pas-la-facture.test.ts`) ;
 *       une paire de parenthèses ne se lit pas : en comptabilité elle dit
 *         « moins », sur ces factures elle encadre aussi une base, « (base
 *         514,700) » (15 octobre 2026). La lire en négatif inscrirait au
 *         crédit ce qui va au débit ; la lire en positif effacerait un avoir.
 *         Le texte ne tranche pas, donc on ne lit pas ;
 *       un « - » en queue, ou ailleurs, ne se lit pas non plus ; un montant
 *         commence et finit par un chiffre (« 8, » n'est pas fini).
 *     Une parenthèse ORPHELINE, sans partenaire, est du bruit de plage (« 514,700 »
 *     cité avec la fermante de « (base 514,700) ») : elle se retire, et elle seule.
 *  6. Une espace n'est un séparateur de milliers que si les groupes le
 *     prouvent : 1 à 3 chiffres, puis des groupes de 3. Une espace collée à un
 *     point ou à une virgule n'en est pas une (« 1 234 ,560 »).
 *  7. Le point et la virgule. Le DERNIER séparateur, s'il est seul de son
 *     espèce, peut porter les décimales ; ceux qui le précèdent sont des
 *     milliers d'une seule espèce (« 1.234,560 », « 1,234.560 », « 1'234.560 »).
 *     Les décimales sont celles de la devise (`ref.devises.exposant`) ; au-delà,
 *     seuls des zéros sont admis (« 1234,5600 ») — un chiffre de plus serait un
 *     arrondi, et ce n'est pas à la lecture de le décider.
 *     Un séparateur qui n'apparaît qu'en une espèce peut aussi être un
 *     séparateur de milliers, si les groupes le prouvent (« 2.800 » : 2,800 ou
 *     2 800). Sauf LE SÉPARATEUR DÉCIMAL DE LA DEVISE (`ref.devises.separateur_decimal`) :
 *     il n'est des milliers que si ses trois chiffres ne peuvent pas être des
 *     décimales de la devise. « 100,000 » vaut 100 dinars et jamais 100 000 ;
 *     « 1,000 » en euros vaut 1,00 ou 1 000.
 *     L'apostrophe ne porte jamais de décimales.
 *  8. Un premier groupe à zéro de tête (« 020,000 ») est le morceau d'un
 *     montant plus long, coupé à l'espace des milliers : il ne se lit pas.
 *  9. Sans séparateur, un nombre assez long se lit en unités ou en unités
 *     mineures (« 16000 » : 16,000 ou 16 000) ; des groupes de milliers dont le
 *     dernier a la longueur de l'exposant aussi (« 1 234 560 »).
 * 10. Le même montant répété en colonnes se lit une fois (« 514,700 514,700 »,
 *     « 3 020,000 | 3 020,000 ») ; deux montants différents ne se lisent pas,
 *     et si le texte recollé sans ses espaces se lit, on ne tranche pas non
 *     plus (`occurrencesIdentiques`).
 *
 * Toute lecture rendue est une lecture du texte ; l'ordre est fixe — la plus
 * petite échelle d'abord. Rien n'est arrondi, aucun flottant : des unités
 * mineures entières, ou rien. Module pur.
 */
import { enChiffresLatins } from "./chiffres.ts";

/** Ce que le référentiel dit d'une devise pour en lire les montants. */
export interface DeviseLue {
  /** L'exposant de la devise (`ref.devises.exposant`) : 3 pour le dinar. */
  decimales: number;
  /** Son séparateur décimal (`ref.devises.separateur_decimal`) : « , » ou « . ». */
  separateurDecimal: string;
  /**
   * Les marques imprimées de TOUTES les devises (« DT », « D.T. », « د.ت »,
   * « € ») : les codes de `ref.devises` et les lignes de `ref.devises_marques`.
   */
  marques: readonly string[];
}

/** Comment un texte a été lu. */
export type FormeDeLecture =
  /** Le dernier séparateur porte les décimales. */
  | "decimale"
  /** Tous les séparateurs sont des milliers : un nombre d'unités. */
  | "milliers"
  /** Ni séparateur ni décimale : un nombre d'unités. */
  | "entier"
  /** Écrit en unités mineures : sans séparateur, ou les millimes en dernier groupe. */
  | "mineures";

/** Une lecture admissible d'un texte. */
export interface LectureDeMontant {
  /** La valeur en unités mineures, entière (millimes pour le dinar). */
  mineur: number;
  forme: FormeDeLecture;
  /** Le séparateur qui a décidé de la forme : « , », « . », « ' », une espace, ou null. */
  separateur: string | null;
}

export interface MontantImprime {
  /** Toutes les lectures admissibles ; vide : le texte n'est pas un montant. */
  lectures: LectureDeMontant[];
  /** Le texte portait des chiffres arabes ou persans, transcrits. */
  chiffresArabes: boolean;
}

/* ------------------------------------------------------------ les marques */

/**
 * Un mot imprimé à côté d'un nombre : des lettres, des symboles (« € »,
 * « ° »), éventuellement liés par des points ou des espaces (« D.T. »,
 * « F CFA »), avec le point qui le clôt.
 */
const MOT = /[\p{L}\p{M}\p{Sc}\p{So}]+(?:[.\s]*[\p{L}\p{M}\p{Sc}\p{So}]+)*\.?/gu;

/** Une marque comparée sans casse, sans points ni espaces : « D.T. » vaut « dt ». */
const cleDeMarque = (s: string): string => s.normalize("NFKC").replace(/[\s.]/gu, "").toUpperCase();

/**
 * Retire les marques de devise que le RÉFÉRENTIEL connaît, et elles seules ;
 * null dès qu'un autre mot est imprimé (règle 2).
 */
function sansMarquesDeDevise(texte: string, marques: readonly string[]): string | null {
  const connues = new Set(marques.map(cleDeMarque));
  let inconnu = false;
  const reste = texte.replace(MOT, (mot) => {
    if (connues.has(cleDeMarque(mot))) return " ";
    inconnu = true;
    return mot;
  });
  return inconnu ? null : reste;
}

/* ---------------------------------------------------------- les parenthèses */

/**
 * Retire les parenthèses ORPHELINES, et elles seules, par appariement : dans
 * « (3 020,000)) », la paire reste — et fait refuser la lecture (règle 5).
 */
function sansParenthesesOrphelines(texte: string): string {
  const caracteres = [...texte];
  const orphelines = new Set<number>();
  const ouvertes: number[] = [];
  caracteres.forEach((c, i) => {
    if (c === "(") ouvertes.push(i);
    else if (c === ")" && ouvertes.pop() === undefined) orphelines.add(i);
  });
  for (const i of ouvertes) orphelines.add(i);
  return caracteres.filter((_, i) => !orphelines.has(i)).join("");
}

/* -------------------------------------------------------------- un montant */

/**
 * Des groupes de milliers bien formés : un premier groupe de 1 à 3 chiffres,
 * puis des groupes d'exactement 3.
 */
function groupesDeMilliersValides(groupes: readonly string[]): boolean {
  return (
    groupes.length > 0 &&
    groupes.every((g) => /^\d+$/u.test(g)) &&
    groupes[0]!.length <= 3 &&
    groupes.slice(1).every((g) => g.length === 3)
  );
}

/** Les lectures d'un texte pris comme UN seul montant (règles 5 à 9). */
function lireUnSeulMontant(brut: string, devise: DeviseLue): LectureDeMontant[] {
  const { decimales, separateurDecimal } = devise;
  let texte = brut.trim();
  let signe = 1n;
  if (texte.startsWith("-")) {
    signe = -1n;
    texte = texte.slice(1).trim();
  }
  // Un chiffre en tête et en queue : « 12, » et « 3 020,000- » ne sont pas finis.
  if (!/^\d(?:[\d.,' ]*\d)?$/u.test(texte)) return [];

  const groupes: string[] = [];
  const seps: string[] = [];
  let courant = "";
  for (const c of texte) {
    if (/\d/u.test(c)) {
      courant += c;
      continue;
    }
    if (!courant) return []; // deux séparateurs d'affilée
    groupes.push(courant);
    seps.push(c);
    courant = "";
  }
  groupes.push(courant);
  if (/^0\d/u.test(groupes[0]!)) return []; // règle 8

  const echelle = 10n ** BigInt(decimales);
  const lectures: LectureDeMontant[] = [];
  const ajouter = (mineur: bigint, forme: FormeDeLecture, separateur: string | null): void => {
    const v = signe * mineur;
    if (v > BigInt(Number.MAX_SAFE_INTEGER) || v < -BigInt(Number.MAX_SAFE_INTEGER)) return;
    const n = Number(v);
    if (lectures.some((l) => l.mineur === n)) return;
    lectures.push({ mineur: n, forme, separateur });
  };

  // Règle 9 : sans séparateur, en unités mineures puis en unités.
  if (seps.length === 0) {
    const n = BigInt(groupes[0]!);
    if (decimales > 0 && groupes[0]!.length > decimales) ajouter(n, "mineures", null);
    ajouter(n * echelle, "entier", null);
    return lectures;
  }

  const dernier = seps[seps.length - 1]!;
  const avant = seps.slice(0, -1);
  const fin = groupes[groupes.length - 1]!;

  // Règle 7 : le dernier séparateur porte les décimales, les précédents sont
  // des milliers d'une seule espèce, distincte de la sienne.
  if (dernier === "." || dernier === ",") {
    const milliers = new Set(avant);
    const uneEspece = milliers.size === 0 || (milliers.size === 1 && !milliers.has(dernier));
    const entiers = groupes.slice(0, -1);
    const auDela = fin.slice(decimales);
    if (
      uneEspece &&
      (avant.length === 0 || groupesDeMilliersValides(entiers)) &&
      !/[1-9]/u.test(auDela)
    ) {
      const fraction = BigInt(fin.slice(0, decimales).padEnd(decimales, "0") || "0");
      ajouter(BigInt(entiers.join("")) * echelle + fraction, "decimale", dernier);
    }
  }

  // Règles 6, 7 et 9 : tous les séparateurs, d'une seule espèce, sont des milliers.
  const especes = new Set(seps);
  const ilsLeProuvent =
    especes.size === 1 &&
    groupesDeMilliersValides(groupes) &&
    // Le séparateur décimal de la devise n'est des milliers que si ses groupes
    // de trois chiffres ne peuvent pas en être les décimales.
    (dernier !== separateurDecimal || decimales < 3);
  if (ilsLeProuvent) {
    const n = BigInt(groupes.join(""));
    if (dernier === " " && fin.length === decimales) ajouter(n, "mineures", dernier);
    ajouter(n * echelle, "milliers", dernier);
  }

  // La plus petite échelle d'abord : l'ordre ne dépend pas du chemin suivi.
  return lectures.sort((a, b) => Math.abs(a.mineur) - Math.abs(b.mineur));
}

/* -------------------------------------------------- un montant répété en colonnes */

/** Assez pour cinq occurrences d'un montant à quatre groupes de chiffres. */
const JETONS_PAR_CELLULE_MAX = 20;

/**
 * Les occurrences d'une plage qui a couvert le MÊME montant plusieurs fois
 * (règle 10).
 *
 * 10 octobre 2026, PAPETERIE NOUR : « 514,700 514,700 », le total répété en
 * pied de colonne, que la plage de jetons a couvert deux fois. 29 octobre :
 * « 3 020,000 3 020,000) », le HT et le total d'une même ligne — l'espace des
 * milliers y coupe aussi chaque occurrence.
 *
 * On découpe les jetons (séparés par des espaces ou du bruit de colonne :
 * « | », « ; », « : ») en occurrences consécutives, de toutes les façons
 * possibles, et l'on ne garde que les découpages où chaque occurrence a
 * EXACTEMENT les mêmes lectures que les autres. Rendre ces lectures ne choisit
 * rien : où que la plage eût dû s'arrêter, c'est le même nombre.
 *
 * Trois bornes, et chacune refuse plutôt que de choisir : des occurrences
 * différentes ; deux découpages qui donnent deux montants différents ; et
 * l'appelant ne la joue qu'après l'échec de la lecture entière, et si le texte
 * recollé sans ses espaces ne se lit pas non plus.
 */
function occurrencesIdentiques(texte: string, devise: DeviseLue): LectureDeMontant[] {
  const jetons = texte.split(/[\s|;:]+/u).filter((b) => b.length > 0);
  // Au-delà, le nombre de découpages croît en 2^n ; une cellule n'en porte pas tant.
  if (jetons.length < 2 || jetons.length > JETONS_PAR_CELLULE_MAX) return [];

  const cle = (ls: readonly LectureDeMontant[]) => ls.map((l) => l.mineur).join("|");
  const lectures = new Map<string, LectureDeMontant[]>();
  const lirePlage = (debut: number, fin: number) => {
    const morceau = jetons.slice(debut, fin).join(" ");
    let l = lectures.get(morceau);
    if (!l) lectures.set(morceau, (l = lireUnSeulMontant(morceau, devise)));
    return l;
  };
  // Le reste des jetons, à partir de `debut`, se découpe-t-il en occurrences
  // qui ont toutes la clé `attendue` ?
  const echecs = new Set<string>();
  const seDecoupe = (debut: number, attendue: string): boolean => {
    if (debut === jetons.length) return true;
    if (echecs.has(`${debut}|${attendue}`)) return false;
    for (let fin = debut + 1; fin <= jetons.length; fin += 1) {
      const l = lirePlage(debut, fin);
      if (l.length > 0 && cle(l) === attendue && seDecoupe(fin, attendue)) return true;
    }
    echecs.add(`${debut}|${attendue}`);
    return false;
  };

  const retenues = new Map<string, LectureDeMontant[]>();
  for (let fin = 1; fin < jetons.length; fin += 1) {
    const premiere = lirePlage(0, fin);
    if (premiere.length === 0) continue;
    const c = cle(premiere);
    if (seDecoupe(fin, c)) retenues.set(c, premiere);
  }
  // Un seul montant possible : on le rend. Deux : on ne choisit pas.
  return retenues.size === 1 ? [...retenues.values()][0]! : [];
}

/* ------------------------------------------------------------------ l'entrée */

/** Toutes les lectures admissibles d'un texte imprimé, selon les règles ci-dessus. */
export function lireUnMontantImprime(texte: string, devise: DeviseLue): MontantImprime {
  const latin = enChiffresLatins(texte);
  const chiffresArabes = latin !== texte;
  const rien: MontantImprime = { lectures: [], chiffresArabes };

  // Règles 3, 4 et 5 : un taux, une date ou une heure, un « + ».
  if (/[%/+]|\d:\d/u.test(latin)) return rien;
  const transcrit = latin.replace(/٫/gu, devise.separateurDecimal).replace(/[٬’]/gu, "'");

  const sansMarques = sansMarquesDeDevise(transcrit, devise.marques);
  if (sansMarques === null) return rien;
  const nu = sansParenthesesOrphelines(sansMarques)
    .replace(/\s+/gu, " ")
    .replace(/ ?([.,]) ?/gu, "$1")
    .trim();
  // Une paire restée, ou tout autre caractère : ce n'est pas un montant.
  if (!nu || !/^[\d.,' |;:-]+$/u.test(nu)) return rien;

  const entiere = lireUnSeulMontant(nu, devise);
  if (entiere.length > 0) return { lectures: entiere, chiffresArabes };
  // Recollé sans ses espaces, le texte se lit : ce pourrait être UN nombre aux
  // espaces parasites, et non un montant répété. On ne tranche pas.
  if (lireUnSeulMontant(nu.replace(/ /gu, ""), devise).length > 0) return rien;
  return { lectures: occurrencesIdentiques(nu, devise), chiffresArabes };
}
