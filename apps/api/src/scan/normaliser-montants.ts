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
  /** Une base par taux : le HT tel qu'imprimé, et le taux du paramétrage (« 0.19 »). */
  bases: Array<{ ht: string | null; taux: string | number }>;
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

/** Les lectures possibles d'un montant imprimé. Vide : illisible. */
/**
 * Les blocs d'une plage qui a couvert le MÊME montant plusieurs fois.
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
 * ========================================== POURQUOI CE N'EST PAS UNE SUPPOSITION
 *
 * Quand les blocs répétés sont TEXTUELLEMENT IDENTIQUES, il n'y a qu'une
 * valeur possible — quel que soit l'endroit où la plage aurait dû s'arrêter,
 * on lit le même nombre. Rendre cette valeur ne choisit rien.
 *
 * La règle est donc volontairement étroite, et deux choses la bornent :
 *
 *   — des blocs DIFFÉRENTS ne se départagent pas. « 514,700 200,000 » reste
 *     illisible, parce qu'on ne sait pas lequel était visé ;
 *   — elle ne s'applique qu'APRÈS l'échec de la lecture entière, donc
 *     « 2 800,000 » se recolle comme avant — ses blocs ne sont pas identiques.
 *
 * R2 tient : aucune valeur n'est inventée, et celle-ci pointe toujours vers
 * les jetons de la plage.
 */
function blocsIdentiques(texte: string): string | null {
  // `\s` couvre déjà l'espace insécable et l'espace fine insécable. Les
  // écrire eux-mêmes dans une classe les ferait entrer littéralement dans le
  // fichier, invisibles — ce que le lint refuse, à juste titre.
  const blocs = texte.split(/\s+/u).filter((b) => b.length > 0);
  if (blocs.length < 2) return null;
  return blocs.every((b) => b === blocs[0]) ? blocs[0]! : null;
}

export function candidatsMontant(brut: string, decimales: number): Candidat[] {
  const repete = blocsIdentiques(brut.trim());
  if (repete !== null) {
    const lectures = candidatsMontant(repete, decimales);
    // La répétition ne sert que si elle DÉBLOQUE. Si le texte entier se lit
    // déjà, c'est lui qui fait foi : « 2 2 » peut être deux fois deux, et la
    // lecture entière le dit mieux que la règle.
    if (lectures.length > 0 && candidatsMontant(brut.replace(/\s+/gu, ""), decimales).length === 0)
      return lectures;
  }
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
  /** Des groupes de milliers bien formés : 1 à 3 chiffres, puis des groupes de 3. */
  const milliersValides = (gs: string[]) =>
    gs.length > 0 && gs[0]!.length <= 3 && gs.slice(1).every((g) => g.length === 3);
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
    if (coherent && (avant.length === 0 || milliersValides(entiers))) {
      const dec = partieDecimale(fin);
      if (dec !== null)
        ajouter(BigInt(entiers.join("")) * echelle + dec, `décimale « ${dernier} »`);
    }
  }

  // 2. Tous les séparateurs sont des milliers : un entier.
  const tous = new Set(seps);
  if (tous.size === 1 && milliersValides(groupes)) {
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
    return vide("illisible", `montant illisible : « ${champs[illisible]!.brut} »${suffixe}`);

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

  function valeurs(pris: Candidat[]) {
    const par = new Map(champs.map((c, i) => [c.nom, BigInt(pris[i]!.mineur)]));
    return {
      hts: entree.bases.map((_, i) => par.get(`ht${i}`)!),
      tva: par.get("tva"),
      autres: (entree.autres ?? []).map((_, i) => par.get(`autre${i}`)!),
      ttc: par.get("ttc"),
    };
  }

  function verifie(pris: Candidat[]): boolean {
    const v = valeurs(pris);
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
  ): ResultatNormalisation {
    const v = valeurs(pris);
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
