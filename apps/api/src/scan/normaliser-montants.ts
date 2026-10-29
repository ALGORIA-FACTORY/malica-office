/**
 * 3B-3 — Normaliser les montants d'une pièce : fonction pure.
 *
 * ============================================================== LE PROBLÈME
 *
 * Les pièces réelles écrivent un même montant de dix façons : « 1 234,560 »,
 * « 1234.560 », « 1,234.560 », « 1.234,560 », « 1'234.560 », « 1 234 560 »,
 * « 1234560 », « 1 234,56 », « 1234,5600 », « 1 234,560DT ». Plusieurs sont
 * AMBIGUËS prises seules : « 2.800 » est deux dinars huit cents millimes, ou
 * deux mille huit cents dinars ; « 1234560 » est écrit en dinars, ou en
 * millimes sans séparateur ; « 100,000 » est cent dinars, ou cent mille à
 * l'anglaise. (« 1234.560 », lui, n'a qu'une lecture : un premier groupe de
 * quatre chiffres n'est pas un groupe de milliers.)
 *
 * ============================================================== LA RÈGLE
 *
 * La convention ne se devine JAMAIS sur un montant isolé. Elle se tranche par
 * la facture elle-même :
 *
 *     Σ HT × (1 + taux) + autres montants (timbre…) = TTC
 *     et, si elle est imprimée, TVA = Σ arrondi(HT × taux)
 *
 * On énumère les lectures possibles de chaque montant, et l'on ne garde que les
 * combinaisons qui vérifient ces égalités, à la tolérance d'arrondi près.
 * Une seule : la convention est tranchée. Aucune : la facture ne tient pas.
 * Plusieurs, distinctes : on ne choisit pas — aucun chiffre n'est rendu.
 *
 * L'ÉCHELLE se tranche d'elle-même quand l'arrondi laisse un reste : lu en
 * dinars, 1 234 560 × 1,19 laisse 400 millimes qui ne tombent pas sur le TTC.
 * Sans reste (100,000 × 1,19 = 119,000), lus tous en dinars ou tous en
 * millimes, les montants tiennent pareil — un timbre imprimé aussi, puisqu'il
 * est lui-même ambigu. Ce qui la rompt alors, c'est un droit dont le
 * PARAMÉTRAGE fixe la valeur (le timbre à 1,000 DT) : `autres[].attendu`.
 *
 * ============================================================== CE QU'ELLE NE PORTE PAS
 *
 * Aucune valeur fiscale : le taux, le nombre de décimales de la devise et la
 * tolérance d'arrondi viennent du paramétrage daté, par l'appelant. Tout se
 * calcule en unités mineures entières (BigInt), le taux lu comme un rationnel
 * exact : pas un nombre flottant sur le chemin d'un montant.
 */

export interface Candidat {
  /** Le montant en unités mineures (millimes pour trois décimales). */
  mineur: number;
  /** Comment il a été lu. */
  convention: string;
}

export interface EntreeMontants {
  /**
   * Une base par taux : le HT tel qu'imprimé, et le taux du paramétrage
   * (« 0.19 »). `pied` : le HT global du pied de facture, quand la base vient
   * d'une ligne — il ne sert que si la ligne ne se lit pas (voir plus bas).
   */
  bases: Array<{ ht: string | null; taux: string | number; pied?: string | null }>;
  /** La TVA imprimée, si elle l'est. */
  tva?: string | null;
  /**
   * Les autres montants qui entrent dans le TTC (droit de timbre…), tels
   * qu'imprimés. Un droit FIXÉ par le paramétrage daté porte sa valeur attendue
   * (en unités mineures) : c'est lui qui ancre l'échelle quand l'égalité, sans
   * reste d'arrondi, la laisse ouverte.
   */
  autres?: Array<string | { brut: string; attendu?: number }>;
  /** Le TTC imprimé. */
  ttc?: string | null;
}

export interface ParametresMontants {
  /** Décimales de la devise — du paramétrage (money.decimals), jamais d'une table en dur. */
  decimales: number;
  /** Écart d'arrondi admis, en unités mineures — du paramétrage. */
  toleranceMineure: number;
}

type EtatNormalisation =
  | "tranche" // une seule lecture vérifie la facture
  | "non_verifie" // rien à vérifier (pas de TTC ni de TVA) ; lecture unique
  | "ambigu" // plusieurs lectures distinctes vérifient, ou aucune vérification possible
  | "incoherent" // aucune lecture ne vérifie la facture
  | "illisible"; // un montant n'a aucune lecture

export interface ResultatNormalisation {
  etat: EtatNormalisation;
  montants: {
    bases: Array<{ ht: number | null; taux: string }>;
    tva: number | null;
    autres: Array<number | null>;
    ttc: number | null;
  };
  /**
   * Ce que la pièce PORTE, tel qu'imprimé — indépendamment de ce qui a été
   * retenu.
   *
   * ================================================================= POURQUOI
   *
   * Le 5 octobre 2026. La facture de loyer imprimait sa base, sa TVA et son
   * total en gras, et le produit répondait : « Mentions obligatoires absentes
   * ou illisibles : Base imposable hors taxes, Montant de la TVA, Total toutes
   * taxes comprises. » Trois reproches sur quatre étaient faux.
   *
   * La cause : quand cette normalisation conclut `incoherent` ou `illisible`,
   * `vide()` met tous les montants à `null` — ce qui est juste, on ne retient
   * aucun chiffre — et le contrôle des mentions lisait cette sortie pour juger
   * de la PRÉSENCE d'une mention. Un montant qu'on refuse de retenir devenait
   * un montant que la pièce ne porte pas.
   *
   * Les deux questions sont distinctes, et doivent être posées à deux endroits
   * différents : « la pièce imprime-t-elle un total ? » se lit ici ; « quelle
   * est sa valeur ? » se lit dans `montants`, et peut légitimement rester vide.
   */
  imprime: {
    bases: Array<string | null>;
    tva: string | null;
    autres: Array<string | null>;
    ttc: string | null;
  };
  /** Indice de confiance, de 0 à 1 — 0 quand aucun chiffre n'est rendu. */
  confiance: number;
  /** Les conventions retenues, montant par montant. */
  conventions: string[];
  /** Nombre de combinaisons distinctes qui vérifient la facture. */
  lecturesValides: number;
  /**
   * Le TTC imprimé qu'aucune lecture ne rend — `null` quand il s'est lu, ou
   * quand la pièce n'en imprime pas.
   *
   * Ce champ existe pour que l'écart SE VOIE. Écarter le total d'une
   * vérification sans le dire serait un repli implicite : la facture
   * passerait, et personne ne saurait qu'un montant imprimé a été laissé de
   * côté. Le contrôle arithmétique le lit et pose une réserve.
   */
  totalNonLu: string | null;
  /**
   * La base imprimée sur la LIGNE qu'aucune lecture ne rend, quand c'est le HT
   * du pied de facture qui a été retenu à sa place — `null` sinon. Comme
   * `totalNonLu`, il existe pour que la substitution se voie : le contrôle
   * arithmétique le lit et pose une réserve.
   */
  ligneNonLue: string | null;
  raison: string;
}

/*
 * L'échelle de confiance. Ce ne sont pas des seuils métier — rien ne se décide
 * dessus ici — mais le sens donné à chaque cas, pour que le verdict en aval
 * puisse les comparer au seuil qu'il lit, lui, dans le paramétrage.
 */
/** Chaque montant n'avait qu'une lecture, et la facture la vérifie. */
const CONFIANCE_LECTURE_UNIQUE_VERIFIEE = 1;
/** Des lectures concurraient ; l'arithmétique en a gardé une seule. */
const CONFIANCE_TRANCHEE_PAR_ARITHMETIQUE = 0.9;
/**
 * Le HT imprimé comprend les autres montants (le timbre) : la base taxable
 * s'en déduit, et la TVA comme le total la confirment tous deux.
 */
const CONFIANCE_HT_AUTRES_COMPRIS = 0.9;
/** Lecture unique, mais rien pour la vérifier. */
const CONFIANCE_NON_VERIFIEE = 0.5;
/**
 * Vérifiée, mais par la TVA seule : le total imprimé n'a pas pu être lu.
 *
 * Entre la lecture pleinement confirmée et celle que rien ne vérifie — la
 * facture tient, mais une de ses deux confirmations manque.
 */
const CONFIANCE_VERIFIEE_SANS_LE_TOTAL = 0.8;

const DEVISE = /^(?:DT|TND|D\.T\.?|DINARS?|د\.?\s?ت\.?)$/iu;
const ESPACES = /[\s\u00A0\u202F]/u;

/**
 * Les occurrences d'une plage qui a couvert le MÊME montant plusieurs fois.
 *
 * ================================================================= POURQUOI
 *
 * 10 octobre 2026. La facture PAPETERIE NOUR reste bloquée sur « montant
 * illisible : « 514,700 514,700 » ».
 *
 * C'est l'envers de la plage de jetons ouverte le 5 octobre pour recoller
 * « 2 800,000 », que l'espace des milliers coupait en deux. Une plage peut
 * désormais couvrir deux montants — ici le même, imprimé deux fois côte à
 * côte, comme le font les factures qui répètent le total en pied de colonne.
 *
 * Deux virgules décimales : aucune lecture ne tient, et la chaîne a eu raison
 * de ne rien rendre plutôt que d'inventer.
 *
 * ========================================== LE 29 OCTOBRE : L'ESPACE DES MILLIERS
 *
 * La première version coupait le texte à CHAQUE espace et exigeait des blocs
 * textuellement identiques. Or l'espace est aussi le séparateur des milliers :
 * « 3 020,000 3 020,000) » — le HT et le total d'une même ligne — donnait
 * « 3 », « 020,000 », « 3 », « 020,000 », et la facture finissait « anomalie
 * à signaler », sans écriture.
 *
 * On découpe donc les jetons (séparés par des espaces ou du bruit de colonne :
 * « | », « ; », « : ») en OCCURRENCES consécutives, de toutes les façons
 * possibles, et l'on ne garde que les découpages où chaque occurrence a
 * EXACTEMENT les mêmes lectures que les autres.
 *
 * ========================================== POURQUOI CE N'EST PAS UNE SUPPOSITION
 *
 * Quand toutes les occurrences ont les mêmes lectures, rendre ces lectures ne
 * choisit rien : quel que soit l'endroit où la plage aurait dû s'arrêter, on
 * lit le même nombre. Et la convention (virgule décimale ou des milliers)
 * reste tranchée ensuite par l'arithmétique de la facture, comme pour
 * n'importe quel montant.
 *
 * Trois bornes, et chacune refuse plutôt que de choisir :
 *
 *   — des occurrences DIFFÉRENTES ne se départagent pas. « 514,700 200,000 »
 *     reste illisible, parce qu'on ne sait pas laquelle était visée ;
 *   — deux découpages qui donnent deux montants différents : illisible ;
 *   — elle ne s'applique qu'APRÈS l'échec de la lecture entière, et si le
 *     texte recollé sans ses espaces ne se lit pas non plus — « 3 020 3 020 »
 *     pourrait être 30 203 020 aux espaces parasites, on ne tranche pas.
 *
 * R2 tient : aucune valeur n'est inventée, et celle-ci pointe toujours vers
 * les jetons de la plage.
 */
/** Assez pour cinq occurrences d'un montant à quatre groupes de chiffres. */
const JETONS_PAR_CELLULE_MAX = 20;

/**
 * Exportée pour la lecture au plan de jetons (`malica/lecture/montants.ts`),
 * qui a la même question à trancher avec SON lecteur d'un montant : `lire`
 * rend les lectures d'un morceau pris comme un seul montant, `valeur` la
 * valeur en unités mineures d'une lecture. Une seule règle, deux lecteurs.
 */
export function occurrencesIdentiques<L>(
  texte: string,
  lire: (morceau: string) => L[],
  valeur: (lecture: L) => number,
): L[] {
  // `\s` couvre déjà l'espace insécable et l'espace fine insécable. Les
  // écrire eux-mêmes dans une classe les ferait entrer littéralement dans le
  // fichier, invisibles — ce que le lint refuse, à juste titre.
  const jetons = texte.split(/[\s|;:]+/u).filter((b) => b.length > 0);
  // Au-delà, le nombre de découpages croît en 2^n ; une cellule n'en porte pas tant.
  if (jetons.length < 2 || jetons.length > JETONS_PAR_CELLULE_MAX) return [];

  const cle = (ls: L[]) =>
    ls
      .map(valeur)
      .sort((a, b) => a - b)
      .join("|");
  const lectures = new Map<string, L[]>();
  const lirePlage = (debut: number, fin: number) => {
    const morceau = jetons.slice(debut, fin).join(" ");
    let l = lectures.get(morceau);
    if (!l) lectures.set(morceau, (l = lire(morceau)));
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

  const retenues = new Map<string, L[]>();
  for (let fin = 1; fin < jetons.length; fin += 1) {
    const premiere = lirePlage(0, fin);
    if (premiere.length === 0) continue;
    const c = cle(premiere);
    if (seDecoupe(fin, c)) retenues.set(c, premiere);
  }
  // Un seul montant possible : on le rend. Deux : on ne choisit pas.
  return retenues.size === 1 ? [...retenues.values()][0]! : [];
}

/**
 * Retirer les parenthèses ORPHELINES, et elles seules.
 *
 * ================================================= LE DÉFAUT QUI L'A FAIT NAÎTRE
 *
 * 15 octobre 2026. Une facture d'achat imprime « (base 514,700) » à côté du
 * taux de TVA. La désignation a englobé la parenthèse fermante, et le montant
 * est arrivé ici sous la forme « 514,700 514,700) ».
 *
 * Un seul caractère parasite, et un montant parfaitement lu devenait
 * illisible : verdict « anomalie à signaler », aucune écriture proposée.
 *
 * ========================================== POURQUOI PAS LES PAIRES
 *
 * Une parenthèse APPARIÉE a un sens en comptabilité : « (514,700) » se lit
 * moins 514,700. La retirer transformerait un négatif en positif, en
 * silence — l'erreur la plus grave possible sur un montant. La chaîne ne lit
 * pas cette notation, et c'est voulu : la même facture imprime aussi
 * « (base 514,700) », et lire la paire comme un négatif inscrirait au crédit
 * ce qui va au débit. Elle refuse ; la personne saisit.
 *
 * ========================================== LE 29 OCTOBRE : PAR APPARIEMENT
 *
 * La première version comptait les parenthèses et, au moindre déséquilibre,
 * les retirait TOUTES : « (3 020,000)) » devenait 3 020,000, positif — la
 * paire perdue avec l'orpheline. On apparie désormais : seule une parenthèse
 * sans partenaire est retirée, et une paire qui reste fait refuser la lecture.
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

/**
 * Les chiffres arabes-indiens (U+0660…) et persans (U+06F0…) en chiffres
 * latins ; la virgule décimale arabe (U+066B) en virgule, le séparateur des
 * milliers arabe (U+066C) en apostrophe — que la lecture ne prend jamais pour
 * une décimale. Une transcription, pas une interprétation : chaque caractère a
 * un seul équivalent.
 */
function enChiffresLatins(texte: string): string {
  return texte
    .replace(/[٠-٩]/gu, (c) => String(c.codePointAt(0)! - 0x0660))
    .replace(/[۰-۹]/gu, (c) => String(c.codePointAt(0)! - 0x06f0))
    .replace(/٫/gu, ",")
    .replace(/٬/gu, "'");
}

/** Les lectures possibles d'un montant imprimé. Vide : illisible. */
export function candidatsMontant(entree: string, decimales: number): Candidat[] {
  const brut = sansParenthesesOrphelines(enChiffresLatins(entree)).trim();
  const entiere = lectureEntiere(brut, decimales);
  if (entiere.length > 0) return entiere;
  // Recollé sans ses espaces, le texte se lit : ce pourrait être UN nombre aux
  // espaces parasites, et non un montant répété. On ne tranche pas.
  if (lectureEntiere(brut.replace(/\s+/gu, ""), decimales).length > 0) return [];
  return occurrencesIdentiques(
    brut,
    (morceau) => lectureEntiere(morceau, decimales),
    (c) => c.mineur,
  );
}

/**
 * Des groupes de milliers bien formés : un premier groupe de 1 à 3 chiffres,
 * puis des groupes d'exactement 3. Partagée avec la lecture au plan de jetons
 * (`malica/lecture/montants.ts`) : « 5.46.3 » n'y est pas plus un nombre
 * qu'ici.
 */
export function groupesDeMilliersValides(groupes: readonly string[]): boolean {
  return (
    groupes.length > 0 &&
    groupes.every((g) => /^\d+$/.test(g)) &&
    groupes[0]!.length <= 3 &&
    groupes.slice(1).every((g) => g.length === 3)
  );
}

/** Les lectures d'un texte pris comme UN seul montant. */
function lectureEntiere(brut: string, decimales: number): Candidat[] {
  let texte = brut.trim();
  // La devise, collée ou non, en tête ou en queue — et rien d'autre de littéral.
  texte = texte.replace(
    /([\d.,'\u2019\s\u00A0\u202F])([^\d.,'\u2019\s\u00A0\u202F-]+)$/u,
    (m, a, dev) => (DEVISE.test(dev.trim()) ? a : m),
  );
  texte = texte.replace(/^([^\d\s-]+)\s*/u, (m, dev) => (DEVISE.test(dev.trim()) ? "" : m));
  texte = texte.trim();
  let signe = 1n;
  if (texte.startsWith("-")) {
    signe = -1n;
    texte = texte.slice(1).trim();
  }
  if (!/^\d[\d.,'\u2019\s\u00A0\u202F]*$/u.test(texte) || !/\d$/.test(texte)) return [];

  // Les groupes de chiffres et les séparateurs entre eux.
  const groupes: string[] = [];
  const seps: string[] = [];
  let courant = "";
  for (const c of texte) {
    if (/\d/.test(c)) {
      courant += c;
    } else {
      if (!courant) return []; // deux séparateurs d'affilée
      groupes.push(courant);
      seps.push(ESPACES.test(c) ? " " : c === "\u2019" ? "'" : c);
      courant = "";
    }
  }
  groupes.push(courant);

  const echelle = 10n ** BigInt(decimales);
  const lectures = new Map<string, Candidat>();
  const ajouter = (mineur: bigint, convention: string) => {
    const v = signe * mineur;
    const cle = v.toString();
    if (
      !lectures.has(cle) &&
      v <= BigInt(Number.MAX_SAFE_INTEGER) &&
      v >= -BigInt(Number.MAX_SAFE_INTEGER)
    )
      lectures.set(cle, { mineur: Number(v), convention });
  };
  /** La partie décimale, ramenée aux décimales de la devise ; null si elle en porte plus, non nulles. */
  const partieDecimale = (d: string): bigint | null => {
    if (d.length > decimales) {
      if (!/^0+$/.test(d.slice(decimales))) return null;
      d = d.slice(0, decimales);
    }
    return BigInt(d.padEnd(decimales, "0") || "0");
  };

  if (seps.length === 0) {
    const n = BigInt(groupes[0]!);
    ajouter(n * echelle, "entier en unités");
    // Écrit en unités mineures, sans séparateur (« 1234560 » pour 1 234,560).
    if (decimales > 0 && groupes[0]!.length > decimales)
      ajouter(n, "unités mineures sans séparateur");
    return [...lectures.values()];
  }

  const dernier = seps[seps.length - 1]!;
  const avant = seps.slice(0, -1);
  const entiers = groupes.slice(0, -1);
  const fin = groupes[groupes.length - 1]!;

  // 1. Le dernier séparateur est décimal ; les précédents sont des milliers,
  //    tous du même signe, distinct du décimal. L'apostrophe n'est jamais décimale.
  if (dernier === "." || dernier === ",") {
    const milliers = new Set(avant);
    const coherent = milliers.size === 0 || (milliers.size === 1 && !milliers.has(dernier));
    if (coherent && (avant.length === 0 || groupesDeMilliersValides(entiers))) {
      const dec = partieDecimale(fin);
      if (dec !== null)
        ajouter(BigInt(entiers.join("")) * echelle + dec, `décimale « ${dernier} »`);
    }
  }

  // 2. Tous les séparateurs sont des milliers : un entier.
  const tous = new Set(seps);
  if (tous.size === 1 && groupesDeMilliersValides(groupes)) {
    const n = BigInt(groupes.join(""));
    ajouter(n * echelle, `milliers « ${dernier} », entier`);
    // Et l'espace qui sépare les millimes (« 1 234 560 » pour 1 234,560).
    if (dernier === " " && fin.length === decimales) ajouter(n, "millimes séparés par une espace");
  }

  return [...lectures.values()];
}

/** Un taux décimal (« 0.19 ») en rationnel exact : numérateur, dénominateur. */
function rationnel(taux: string | number): [bigint, bigint] {
  const t = String(taux).trim().replace(",", ".");
  const m = /^(\d+)(?:\.(\d+))?$/.exec(t);
  if (!m) throw new Error(`taux illisible : ${taux}`);
  const frac = m[2] ?? "";
  return [BigInt(m[1]! + frac), 10n ** BigInt(frac.length)];
}

/** Arrondi au plus proche, demi vers le haut, d'un rationnel positif ou nul. */
function arrondi(num: bigint, den: bigint): bigint {
  const q = num / den;
  return (num % den) * 2n >= den ? q + 1n : q;
}

const abs = (x: bigint) => (x < 0n ? -x : x);

export function normaliserMontants(
  entree: EntreeMontants,
  p: ParametresMontants,
): ResultatNormalisation {
  /*
   * ============================== LA LIGNE ILLISIBLE, LE PIED LISIBLE (29 octobre 2026)
   *
   * Sur une facture à une base, le HT de la ligne et le HT du pied sont le
   * même montant, imprimé deux fois. Quand la ligne ne se lit pas — sa
   * citation a couvert deux colonnes différentes, par exemple — le pied, lui,
   * peut se lire : on le retient, à une condition, que la facture ENTIÈRE le
   * vérifie (`tranche` : la TVA imprimée vaut arrondi(HT × taux), le total
   * vaut la somme). Sinon, rien ne change : la ligne reste illisible.
   *
   * Rien n'est déduit — le HT retenu est imprimé et cité — et la substitution
   * se dit (`ligneNonLue`) : le contrôle arithmétique pose une réserve, la
   * personne qui supervise la voit. Plusieurs bases : le pied ne se ventile
   * pas entre elles, on n'y touche pas.
   */
  const [seule] = entree.bases;
  const pied = seule?.pied?.trim() ?? "";
  const ligne = seule?.ht?.trim() ?? "";
  if (
    entree.bases.length === 1 &&
    ligne !== "" &&
    pied !== "" &&
    pied !== ligne &&
    candidatsMontant(ligne, p.decimales).length === 0
  ) {
    const parLePied = normaliserMontants(
      { ...entree, bases: [{ ht: pied, taux: seule!.taux }] },
      p,
    );
    if (parLePied.etat === "tranche")
      return {
        ...parLePied,
        ligneNonLue: ligne,
        raison: `${parLePied.raison} ; la base de la ligne « ${ligne} » ne se lit pas, celle du pied de facture est retenue`,
      };
  }

  const taux = entree.bases.map((b) => String(b.taux));

  /*
   * Ce que la piece porte, releve UNE fois et rendu par toutes les sorties.
   * Un texte vide vaut absent : une chaine blanche n'est pas une mention.
   */
  const texte = (v: string | null | undefined): string | null => {
    const s = (v ?? "").trim();
    return s === "" ? null : s;
  };
  const imprime = {
    bases: entree.bases.map((b) => texte(b.ht)),
    tva: texte(entree.tva),
    autres: (entree.autres ?? []).map((a) => texte(typeof a === "string" ? a : a.brut)),
    ttc: texte(entree.ttc),
  };

  /**
   * Le total imprimé qu'on n'a pas su lire, s'il y en a un.
   *
   * Déclaré ici parce que `vide` et `construire` doivent tous deux le rendre :
   * un total perdu se dit, que la facture tienne ensuite ou non.
   */
  let totalNonLu: string | null = null;

  const vide = (
    etat: EtatNormalisation,
    raison: string,
    lecturesValides = 0,
  ): ResultatNormalisation => ({
    etat,
    montants: {
      bases: entree.bases.map((_, i) => ({ ht: null, taux: taux[i]! })),
      tva: null,
      autres: (entree.autres ?? []).map(() => null),
      ttc: null,
    },
    imprime,
    confiance: 0,
    conventions: [],
    lecturesValides,
    totalNonLu,
    ligneNonLue: null,
    raison,
  });

  // Les champs, dans un ordre fixe : bases, TVA, autres, TTC.
  type Champ = { nom: string; brut: string };
  const champs: Champ[] = [];
  entree.bases.forEach((b, i) => {
    if (b.ht === null || b.ht.trim() === "") return;
    champs.push({ nom: `ht${i}`, brut: b.ht });
  });
  if (entree.bases.some((b) => b.ht === null || b.ht.trim() === ""))
    return vide("illisible", "un HT est absent : la facture ne peut pas être vérifiée");
  if (entree.tva) champs.push({ nom: "tva", brut: entree.tva });
  const attendus = new Map<string, number>();
  (entree.autres ?? []).forEach((a, i) => {
    const nom = `autre${i}`;
    if (typeof a === "string") return champs.push({ nom, brut: a });
    if (a.attendu !== undefined) attendus.set(nom, a.attendu);
    return champs.push({ nom, brut: a.brut });
  });
  if (entree.ttc) champs.push({ nom: "ttc", brut: entree.ttc });

  const brutes = champs.map((c) => candidatsMontant(c.brut, p.decimales));

  /*
   * ======================================= LE TOTAL EST UN RAPPEL, PAS UNE DONNÉE
   *
   * 13 octobre 2026. Sur une facture réelle, « 4 135,183 » est imprimé en
   * blanc sur bande noire, et la reconnaissance y lit « + 135,183 » : le « 4 »
   * devient un « + ». Rien ne peut lire ce texte.
   *
   * Jusqu'ici, cela mettait TOUS les montants à `null` — les deux bases, la
   * TVA, le timbre, tous lus et cités — et la pièce finissait « anomalie à
   * signaler », sans écriture, le cabinet lisant « rien à superviser ».
   *
   * Or le TTC n'ajoute rien : c'est la somme des autres, imprimée une seconde
   * fois. Quand il manque et que la TVA reste lisible, la facture se vérifie
   * encore — par sa TVA. On l'écarte donc de l'équation, et on le NOMME.
   *
   * Les autres champs ne se recomposent pas : une base, une TVA ou un droit
   * illisible reste fatal. Les déduire serait inventer, et R2 l'interdit.
   */
  const iTtc = champs.findIndex((c) => c.nom === "ttc");
  if (iTtc >= 0 && brutes[iTtc]!.length === 0) {
    totalNonLu = champs[iTtc]!.brut;
    champs.splice(iTtc, 1);
    brutes.splice(iTtc, 1);
  }
  const suffixe = totalNonLu ? ` ; le total imprimé « ${totalNonLu} » n'a pas pu être lu` : "";

  const illisible = champs.findIndex((_, i) => brutes[i]!.length === 0);
  if (illisible >= 0)
    return vide("illisible", `montant illisible « ${champs[illisible]!.brut} »${suffixe}`);

  // Un droit fixé par le paramétrage ne se lit qu'à sa valeur. Imprimé
  // autrement, il n'ancre rien et garde toutes ses lectures.
  let ancre = false;
  const lectures = brutes.map((l, i) => {
    const attendu = attendus.get(champs[i]!.nom);
    if (attendu === undefined) return l;
    const retenues = l.filter((c) => c.mineur === attendu);
    if (retenues.length === 0) return l;
    if (retenues.length < l.length) ancre = true;
    return retenues;
  });

  const rats = entree.bases.map((b) => rationnel(b.taux));
  const tol = BigInt(p.toleranceMineure);
  // Un total qu'on n'a pas su lire ne vérifie rien : il ne compte plus ici.
  const aVerifier = (Boolean(entree.ttc) && totalNonLu === null) || Boolean(entree.tva);
  // L'ambiguïté se mesure sur ce qui est IMPRIMÉ : une lecture levée par
  // l'ancre n'était pas unique.
  const unique = brutes.every((l) => l.length === 1);

  if (!aVerifier) {
    if (!unique)
      return vide(
        "ambigu",
        `montant ambigu et rien pour le vérifier : aucune convention ne se devine seule${suffixe}`,
      );
    return construire(
      lectures.map((l) => l[0]!),
      "non_verifie",
      CONFIANCE_NON_VERIFIEE,
      1,
      totalNonLu
        ? `lecture unique, non vérifiée${suffixe}`
        : "lecture unique, non vérifiée : ni TTC ni TVA imprimés",
    );
  }

  // Toutes les combinaisons, bornées : chaque montant a au plus trois lectures.
  const valides: Candidat[][] = [];
  const combiner = (i: number, pris: Candidat[]) => {
    if (i === lectures.length) {
      if (verifie(pris)) valides.push([...pris]);
      return;
    }
    for (const c of lectures[i]!) {
      pris.push(c);
      combiner(i + 1, pris);
      pris.pop();
    }
  };
  combiner(0, []);

  // Deux combinaisons aux mêmes valeurs ne sont pas deux lectures.
  const distinctes = new Map<string, Candidat[]>();
  for (const v of valides) distinctes.set(v.map((c) => c.mineur).join("|"), v);

  /*
   * ============================== LE HT QUI COMPREND DÉJÀ LE TIMBRE (26 octobre 2026)
   *
   * Facture MYTEK réelle : « TOTAL HT 428,731 », « Base TVA 427,731 »,
   * « TVA 81,269 », « Timbre fiscal 1,000 », « Total avec Timbre 428,731 »,
   * « TTC 510,000 ». Le HT imprimé COMPREND le timbre ; la base taxable est
   * 427,731. Lue comme une base, elle comptait le timbre deux fois
   * (428,731 + 81,269 + 1,000 = 511,000) : « la facture ne tient pas », et
   * plus aucun montant n'était rendu.
   *
   * Seconde lecture, seulement quand la première n'a rien gardé, sur UNE
   * base, avec des autres montants et une TVA imprimée : base = HT imprimé −
   * autres. Elle n'est retenue que si la TVA imprimée vaut arrondi(base ×
   * taux) — l'écart d'un timbre de 1,000 au taux de 19 % fait 190 millimes,
   * bien au-delà de l'arrondi — ET, si le total est lu, si base + TVA +
   * autres = TTC. Sans total lu, la confiance est celle d'une lecture que la
   * seule TVA vérifie. Rien n'est inventé : la base est la différence de deux
   * montants imprimés et cités.
   */
  if (
    distinctes.size === 0 &&
    entree.bases.length === 1 &&
    (entree.autres ?? []).length > 0 &&
    Boolean(entree.tva)
  ) {
    const compris = new Map<string, Candidat[]>();
    const essayer = (i: number, pris: Candidat[]) => {
      if (i === lectures.length) {
        if (verifie(pris, true)) compris.set(pris.map((c) => c.mineur).join("|"), [...pris]);
        return;
      }
      for (const c of lectures[i]!) {
        pris.push(c);
        essayer(i + 1, pris);
        pris.pop();
      }
    };
    essayer(0, []);
    if (compris.size === 1) {
      const [retenue] = [...compris.values()];
      return construire(
        retenue!,
        "tranche",
        champs.some((c) => c.nom === "ttc")
          ? CONFIANCE_HT_AUTRES_COMPRIS
          : CONFIANCE_VERIFIEE_SANS_LE_TOTAL,
        1,
        (champs.some((c) => c.nom === "ttc")
          ? "le HT imprimé comprend les autres montants (timbre) : la base taxable en est déduite, et la TVA comme le total imprimés la vérifient"
          : "le HT imprimé comprend les autres montants (timbre) : la base taxable en est déduite, et la TVA imprimée la vérifie") +
          suffixe,
        true,
      );
    }
  }

  if (distinctes.size === 0)
    return vide(
      "incoherent",
      "aucune lecture ne vérifie Σ HT × (1 + taux) + autres = TTC" +
        (entree.tva ? " ni la TVA imprimée" : "") +
        suffixe,
    );
  if (distinctes.size > 1) {
    const [a, b] = [...distinctes.values()];
    const facteur = a![0]!.mineur !== 0 ? b![0]!.mineur / a![0]!.mineur : 0;
    const echelle = Number.isInteger(Math.log10(Math.abs(facteur || 1))) && facteur !== 1;
    return vide(
      "ambigu",
      (echelle
        ? "l'échelle ne se tranche pas : lus en dinars ou en millimes, les montants vérifient tous deux la facture — il faut un montant d'échelle connue (timbre, TVA)"
        : "plusieurs lectures distinctes vérifient la facture") + suffixe,
      distinctes.size,
    );
  }

  const [retenue] = [...distinctes.values()];
  const pleine = unique ? CONFIANCE_LECTURE_UNIQUE_VERIFIEE : CONFIANCE_TRANCHEE_PAR_ARITHMETIQUE;
  return construire(
    retenue!,
    "tranche",
    // Vérifiée par la seule TVA, la lecture ne vaut pas celle que le total
    // confirme aussi : on ne lui donne pas la note pleine.
    totalNonLu ? Math.min(pleine, CONFIANCE_VERIFIEE_SANS_LE_TOTAL) : pleine,
    1,
    (unique
      ? "lecture unique, vérifiée par la facture"
      : ancre
        ? "convention tranchée par l'arithmétique de la facture, l'échelle ancrée par un droit que fixe le paramétrage"
        : "convention tranchée par l'arithmétique de la facture") + suffixe,
  );

  function valeursImprimees(pris: Candidat[]) {
    const par = new Map(champs.map((c, i) => [c.nom, BigInt(pris[i]!.mineur)]));
    return {
      hts: entree.bases.map((_, i) => par.get(`ht${i}`)!),
      tva: par.get("tva"),
      autres: (entree.autres ?? []).map((_, i) => par.get(`autre${i}`)!),
      ttc: par.get("ttc"),
    };
  }

  /**
   * `autresCompris` : le HT imprimé comprend les autres montants ; la base
   * taxable est HT − autres (une seule base, voir plus haut).
   */
  function valeurs(pris: Candidat[], autresCompris = false) {
    const v = valeursImprimees(pris);
    if (!autresCompris) return v;
    const autres = v.autres.reduce((s, a) => s + a, 0n);
    return { ...v, hts: v.hts.map((h) => h - autres) };
  }

  function verifie(pris: Candidat[], autresCompris = false): boolean {
    const v = valeurs(pris, autresCompris);
    if (v.hts.some((h) => h < 0n)) return false;
    const tvaCalculee = v.hts.reduce((s, h, i) => s + arrondi(h * rats[i]![0], rats[i]![1]), 0n);
    if (v.tva !== undefined && abs(v.tva - tvaCalculee) > tol) return false;
    if (v.ttc !== undefined) {
      const tva = v.tva ?? tvaCalculee;
      const total = v.hts.reduce((s, h) => s + h, 0n) + tva + v.autres.reduce((s, a) => s + a, 0n);
      if (abs(total - v.ttc) > tol) return false;
    }
    return true;
  }

  function construire(
    pris: Candidat[],
    etat: EtatNormalisation,
    confiance: number,
    lecturesValides: number,
    raison: string,
    autresCompris = false,
  ): ResultatNormalisation {
    const v = valeurs(pris, autresCompris);
    return {
      etat,
      montants: {
        bases: v.hts.map((h, i) => ({ ht: Number(h), taux: taux[i]! })),
        tva: v.tva === undefined ? null : Number(v.tva),
        autres: v.autres.map(Number),
        ttc: v.ttc === undefined ? null : Number(v.ttc),
      },
      imprime,
      confiance,
      conventions: pris.map((c, i) => `${champs[i]!.nom} : ${c.convention}`),
      lecturesValides,
      totalNonLu,
      ligneNonLue: null,
      raison,
    };
  }
}

/**
 * La TVA d'une base, en unités mineures : arrondi(HT × taux), le taux lu comme
 * un rationnel exact — le calcul même qui vérifie la facture.
 */
export function tvaDeBase(htMineur: number, taux: string | number): number {
  const [num, den] = rationnel(taux);
  return Number(arrondi(BigInt(htMineur) * num, den));
}
