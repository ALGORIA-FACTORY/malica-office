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
 * millimes sans séparateur ; « 100.000 » est cent dinars, ou cent mille.
 * (« 1234.560 », lui, n'a qu'une lecture : un premier groupe de quatre
 * chiffres n'est pas un groupe de milliers ; « 100,000 » aussi, depuis le
 * 30 octobre 2026 : la virgule est le séparateur décimal du dinar, et le
 * référentiel le dit — `ref.devises.separateur_decimal`.) Les lectures d'un
 * texte viennent du lecteur unique du dépôt (`@malica/socle/montant-imprime`).
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
 * Sans reste (100.000 × 1,19 = 119.000), lus tous en dinars ou tous en
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
import {
  lireUnMontantImprime,
  type DeviseLue,
  type LectureDeMontant,
} from "@malica/socle/montant-imprime";
import { depuisUniteMineure } from "@malica/socle/somme-decimale";

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
   *
   * `brut: null` : la lecture NOMME le droit, mais n'en a pas cité le montant.
   * Il ne se retient alors que si l'arithmétique le prouve (voir `deduits`).
   */
  autres?: Array<string | { brut: string | null; attendu?: number }>;
  /** Le TTC imprimé. */
  ttc?: string | null;
  /**
   * Le HT global du pied, sur une facture à PLUSIEURS taux. Il ne sert qu'à
   * prouver la base d'une ligne illisible (voir `deduits`).
   */
  htTotal?: string | null;
  /**
   * Le chemin de citation de chaque montant (« ht0 », « htTotal », « tva »,
   * « autre0 », « ttc », et « pied0 » pour le HT du pied d'une ligne seule),
   * pour que `fermes` nomme les champs tels que la lecture les cite.
   */
  chemins?: Readonly<Record<string, string>>;
}

export interface ParametresMontants extends DeviseLue {
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
  /**
   * Les valeurs que la pièce n'a pas laissé LIRE, et que son arithmétique
   * PROUVE (30 octobre 2026). Vide quand tout a été lu.
   *
   * Absent des jugements posés avant cette date : un lecteur lit `?? []`.
   */
  deduits: Deduction[];
  /**
   * Les champs cités que l'équation retenue a VÉRIFIÉS, à leur chemin de
   * citation : ni une valeur déduite, ni un total écarté, ni un montant qui
   * n'entre pas dans l'équation (la TVA d'une ligne, son TTC). Le contrôle de
   * confiance ne lève que ceux-là (revue de la PR 142).
   */
  fermes: string[];
  raison: string;
}

/**
 * Une valeur déduite, jamais devinée : la formule qui la donne, et les
 * montants imprimés et cités qui l'alimentent. Le contrôle arithmétique la
 * lit et pose une RÉSERVE — une déduction se dit toujours au cabinet.
 */
interface Deduction {
  /** Le champ déduit, au chemin de l'extraction : « totals.vat », « other_charges[0].amount »… */
  champ: string;
  /** La valeur retenue : un montant en écriture décimale, ou un code de taux. */
  valeur: string;
  /** La formule, en clair : « TVA = TTC − HT − droits ». */
  formule: string;
  /** Les opérandes, tels qu'imprimés et cités — et ce que la pièce imprimait à la place, s'il y a lieu. */
  operandes: Record<string, string>;
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

/**
 * Les lectures possibles d'un montant imprimé, pour la normalisation. Vide :
 * illisible.
 *
 * ======================================================== LA POLITIQUE DU SCAN
 *
 * Le texte se lit par le lecteur unique du dépôt (`@malica/socle/montant-imprime`,
 * qui en écrit les règles) ; rien ne se relit ici. La normalisation en garde
 * TOUTES les lectures : c'est l'arithmétique de la facture qui tranche entre
 * elles, plus bas, et ce qu'elle ne tranche pas reste sans valeur.
 *
 * Les chiffres arabes et persans se lisent, comme au relevé du 29 octobre
 * 2026 (`un-montant-repete-en-colonnes.test.ts`). La lecture au plan de jetons
 * les refuse, parce que son modèle de vision les rend inversés : ici, une
 * lecture inversée ne passerait pas l'égalité de la facture, et une lecture
 * qu'aucune égalité ne vérifie (`non_verifie`) part en réserve au cabinet.
 */
export function candidatsMontant(entree: string, devise: DeviseLue): Candidat[] {
  return lireUnMontantImprime(entree, devise).lectures.map((l) => ({
    mineur: l.mineur,
    convention: conventionDe(l),
  }));
}

/** Comment un montant a été lu, en clair : ce que la preuve du contrôle arithmétique montre. */
function conventionDe(l: LectureDeMontant): string {
  const sep = l.separateur === " " ? "espace" : `« ${l.separateur ?? ""} »`;
  switch (l.forme) {
    case "decimale":
      return `décimale ${sep}`;
    case "milliers":
      return `milliers ${sep}, entier`;
    case "entier":
      return "entier en unités";
    case "mineures":
      return l.separateur === null
        ? "unités mineures sans séparateur"
        : "unités mineures, milliers séparés par une espace";
  }
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
    candidatsMontant(ligne, p).length === 0
  ) {
    const parLePied = normaliserMontants(
      {
        ...entree,
        bases: [{ ht: pied, taux: seule!.taux }],
        chemins: { ...entree.chemins, ht0: entree.chemins?.["pied0"] ?? "pied0" },
      },
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
    deduits: [],
    fermes: [],
    raison,
  });

  const seLit = (v: string | null | undefined) =>
    texte(v) !== null && candidatsMontant(v!, p).length > 0;

  /*
   * ============================== CE QUE LA FACTURE PROUVE SANS LE LAISSER LIRE
   *
   * 30 octobre 2026, le dirigeant : « le Socle doit PROPOSER, et être EXACT ».
   * Une TVA, une base de ligne ou un timbre illisibles laissaient la pièce
   * sans écriture, alors que la facture imprimait tout ce qu'il faut pour les
   * PROUVER. Une valeur n'est déduite que si l'arithmétique la ferme :
   *
   *   TVA      = TTC − Σ HT − droits, quand Σ arrondi(HT × taux) la vérifie
   *              à la tolérance d'arrondi près ;
   *   base k   = HT du pied − autres bases, quand la TVA et le TTC imprimés
   *              vérifient la facture entière (plusieurs taux) ;
   *   droit    = TTC − Σ HT − TVA, quand ce reste vaut EXACTEMENT le montant
   *              que le paramétrage fixe à ce droit.
   *
   * Une seule déduction par pièce : deux inconnues se compensent, et une
   * égalité qui les absorbe toutes deux ne prouve plus rien. La déduction se
   * nomme (`deduits`) avec sa formule et ses opérandes cités, et le contrôle
   * arithmétique pose une RÉSERVE : le cabinet voit pourquoi. Quand rien ne
   * ferme, rien n'est rendu — comme avant.
   */
  const illisibles = entree.bases.flatMap((b, i) => (seLit(b.ht) ? [] : [i]));
  const baseDeduite =
    entree.bases.length > 1 &&
    illisibles.length === 1 &&
    seLit(entree.htTotal) &&
    seLit(entree.tva) &&
    seLit(entree.ttc)
      ? illisibles[0]!
      : null;

  // Les champs, dans un ordre fixe : bases, TVA, autres, TTC.
  type Champ = { nom: string; brut: string };
  const champs: Champ[] = [];
  entree.bases.forEach((b, i) => {
    if (b.ht === null || b.ht.trim() === "" || i === baseDeduite) return;
    champs.push({ nom: `ht${i}`, brut: b.ht });
  });
  if (baseDeduite !== null) champs.push({ nom: "htTotal", brut: entree.htTotal! });
  else if (entree.bases.some((b) => b.ht === null || b.ht.trim() === ""))
    return vide("illisible", "un HT est absent : la facture ne peut pas être vérifiée");
  if (entree.tva) champs.push({ nom: "tva", brut: entree.tva });
  const attendus = new Map<string, number>();
  (entree.autres ?? []).forEach((a, i) => {
    const nom = `autre${i}`;
    if (typeof a === "string") return champs.push({ nom, brut: a });
    if (a.attendu !== undefined) attendus.set(nom, a.attendu);
    return champs.push({ nom, brut: a.brut ?? "" });
  });
  if (entree.ttc) champs.push({ nom: "ttc", brut: entree.ttc });

  const brutes = champs.map((c) => candidatsMontant(c.brut, p));

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
   * Les autres champs ne se recomposent pas ainsi : une base, une TVA ou un
   * droit ne se DEVINENT pas. Ils ne se retiennent que si l'arithmétique les
   * prouve (plus haut), sans quoi la pièce reste illisible.
   */
  const iTtc = champs.findIndex((c) => c.nom === "ttc");
  if (iTtc >= 0 && brutes[iTtc]!.length === 0) {
    totalNonLu = champs[iTtc]!.brut;
    champs.splice(iTtc, 1);
    brutes.splice(iTtc, 1);
  }
  const suffixe = totalNonLu ? ` ; le total imprimé « ${totalNonLu} » n'a pas pu être lu` : "";
  const lu = (nom: string) => {
    const i = champs.findIndex((c) => c.nom === nom);
    return i >= 0 && brutes[i]!.length > 0;
  };

  // La TVA illisible : écartée de l'équation, que le TTC LU ferme seul.
  let tvaNonLue: string | null = null;
  const iTva = champs.findIndex((c) => c.nom === "tva");
  if (iTva >= 0 && !lu("tva") && lu("ttc") && baseDeduite === null) {
    tvaNonLue = champs[iTva]!.brut;
    champs.splice(iTva, 1);
    brutes.splice(iTva, 1);
  }

  // Le droit illisible ou non cité, que le paramétrage fixe : il ne prend que
  // sa valeur fixée, et l'égalité devra tomber juste au millime (`verifie`).
  const droitsDeduits = new Set<string>();
  if (tvaNonLue === null && baseDeduite === null && lu("tva") && lu("ttc")) {
    const candidats = champs.flatMap((c, i) =>
      c.nom.startsWith("autre") && brutes[i]!.length === 0 && attendus.has(c.nom) ? [i] : [],
    );
    if (candidats.length === 1) {
      const i = candidats[0]!;
      brutes[i] = [{ mineur: attendus.get(champs[i]!.nom)!, convention: "déduit de la facture" }];
      droitsDeduits.add(champs[i]!.nom);
    }
  }

  const illisible = champs.findIndex((_, i) => brutes[i]!.length === 0);
  if (illisible >= 0)
    return vide(
      "illisible",
      champs[illisible]!.brut.trim() === ""
        ? `le montant d'un droit hors TVA n'est pas cité${suffixe}`
        : `montant illisible « ${champs[illisible]!.brut} »${suffixe}`,
    );

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
  const aVerifier = lu("ttc") || lu("tva");
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
    lu("tva") &&
    droitsDeduits.size === 0
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
  const deduite = tvaNonLue !== null || baseDeduite !== null || droitsDeduits.size > 0;
  return construire(
    retenue!,
    "tranche",
    // Vérifiée par la seule TVA, la lecture ne vaut pas celle que le total
    // confirme aussi : on ne lui donne pas la note pleine. Une valeur déduite
    // non plus : elle est vérifiée, pas lue.
    deduite || totalNonLu ? Math.min(pleine, CONFIANCE_VERIFIEE_SANS_LE_TOTAL) : pleine,
    1,
    (deduite
      ? "une valeur illisible est déduite des montants imprimés, que la facture vérifie"
      : unique
        ? "lecture unique, vérifiée par la facture"
        : ancre
          ? "convention tranchée par l'arithmétique de la facture, l'échelle ancrée par un droit que fixe le paramétrage"
          : "convention tranchée par l'arithmétique de la facture") + suffixe,
  );

  function valeursImprimees(pris: Candidat[]) {
    const par = new Map(champs.map((c, i) => [c.nom, BigInt(pris[i]!.mineur)]));
    // La base déduite : le HT du pied, moins les bases lues.
    const lues = entree.bases.reduce(
      (s, _, i) => (i === baseDeduite ? s : s + par.get(`ht${i}`)!),
      0n,
    );
    return {
      hts: entree.bases.map((_, i) =>
        i === baseDeduite ? par.get("htTotal")! - lues : par.get(`ht${i}`)!,
      ),
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
      // Un droit déduit vaut EXACTEMENT le reste : l'arrondi admis porte sur
      // la TVA, jamais sur un montant que le paramétrage fixe.
      if (abs(total - v.ttc) > (droitsDeduits.size > 0 ? 0n : tol)) return false;
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
    const somme = (xs: bigint[]) => xs.reduce((s, x) => s + x, 0n);
    // La TVA illisible vaut le reste du TTC lu : l'écriture tombe sur le total imprimé.
    const tva =
      tvaNonLue !== null && v.ttc !== undefined ? v.ttc - somme(v.hts) - somme(v.autres) : v.tva;
    const montant = (x: bigint) => depuisUniteMineure(Number(x), p.decimales);
    // Les montants imprimés qui alimentent la formule, et ce que la pièce
    // imprimait à la place de la valeur déduite.
    const operandes = (sauf: string, aLaPlace: string | null): Record<string, string> => ({
      ...Object.fromEntries(champs.filter((c) => c.nom !== sauf).map((c) => [c.nom, c.brut])),
      imprime: aLaPlace ?? "",
    });
    const deduits: Deduction[] = [];
    if (tvaNonLue !== null && tva !== undefined)
      deduits.push({
        champ: "totals.vat",
        valeur: montant(tva),
        formule: "TVA = TTC − HT − droits, vérifiée par HT × taux",
        operandes: operandes("tva", tvaNonLue),
      });
    if (baseDeduite !== null)
      deduits.push({
        champ: `lines[${baseDeduite}].base_ht`,
        valeur: montant(v.hts[baseDeduite]!),
        formule: "base = HT du pied − autres bases, vérifiée par la TVA et le TTC",
        operandes: operandes("", entree.bases[baseDeduite]!.ht),
      });
    for (const nom of droitsDeduits) {
      const i = Number(nom.slice("autre".length));
      deduits.push({
        champ: `other_charges[${i}].amount`,
        valeur: montant(v.autres[i]!),
        formule: "droit = TTC − HT − TVA, égal au montant que fixe le paramétrage",
        operandes: operandes(nom, imprime.autres[i] ?? null),
      });
    }
    return {
      etat,
      montants: {
        bases: v.hts.map((h, i) => ({ ht: Number(h), taux: taux[i]! })),
        tva: tva === undefined ? null : Number(tva),
        autres: v.autres.map(Number),
        ttc: v.ttc === undefined ? null : Number(v.ttc),
      },
      imprime,
      confiance,
      conventions: pris.map((c, i) => `${champs[i]!.nom} : ${c.convention}`),
      lecturesValides,
      totalNonLu,
      ligneNonLue: null,
      deduits,
      fermes: champs
        .filter((c) => !droitsDeduits.has(c.nom))
        .map((c) => entree.chemins?.[c.nom] ?? c.nom),
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
