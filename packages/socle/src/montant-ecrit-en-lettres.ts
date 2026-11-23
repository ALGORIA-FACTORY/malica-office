/**
 * Écrire un montant en toutes lettres — la mention « Arrêtée la présente facture à la somme
 * de : mille deux cent trente-quatre dinars et cinq cents millimes ».
 *
 * ================================================================= POURQUOI
 *
 * La facture de Malica Office (décision du 23 novembre 2026) porte son net à payer deux
 * fois : en chiffres et en lettres. Les lettres sont la seconde écriture du même montant ;
 * elles ne doivent jamais le contredire. On les calcule donc depuis la chaîne décimale exacte
 * (jamais un flottant), et un montant qu'on ne sait pas écrire lève une erreur plutôt qu'une
 * phrase fausse.
 *
 * =========================================================== CE QUI VIENT D'AILLEURS
 *
 * Le NOM de la devise et de sa subdivision (« dinar », « millimes », « دينارا ») vient de la
 * base (`ref.devises_ecrites`), avec le nombre de décimales de la devise (`ref.devises.exposant`) :
 * aucune devise n'est écrite ici (R4). Ce module ne porte que la grammaire des nombres de trois
 * langues — ce n'est pas une donnée réglementaire, c'est la langue.
 *
 * L'arabe compte autrement : un nom compté se met au duel pour deux, au pluriel de trois à
 * dix, à l'accusatif singulier de onze à quatre-vingt-dix-neuf, au singulier pour cent, mille…
 * (selon les deux derniers chiffres). La base porte ces quatre formes.
 *
 * Module pur (R1) : des valeurs entrent, une phrase sort.
 */

export type LangueDesLettres = "fr" | "en" | "ar";

/** Les formes d'un nom compté (`ref.devises_ecrites`). */
export interface FormesDuNom {
  readonly singulier: string;
  readonly pluriel: string;
  /** L'arabe seulement : deux (المثنى). */
  readonly duel?: string | null;
  /** L'arabe seulement : de 11 à 99 (التمييز المنصوب). */
  readonly accusatif?: string | null;
}

export interface NomsDeLaDevise {
  readonly majeure: FormesDuNom;
  readonly mineure: FormesDuNom;
}

/** Au-delà, le montant ne s'écrit pas : une facture d'abonnement n'en approche pas. */
const PLAFOND = 10n ** 12n;

/* ------------------------------------------------------------------ français */

const FR_UNITES = [
  "zéro",
  "un",
  "deux",
  "trois",
  "quatre",
  "cinq",
  "six",
  "sept",
  "huit",
  "neuf",
  "dix",
  "onze",
  "douze",
  "treize",
  "quatorze",
  "quinze",
  "seize",
  "dix-sept",
  "dix-huit",
  "dix-neuf",
] as const;
const FR_DIZAINES = [
  "",
  "",
  "vingt",
  "trente",
  "quarante",
  "cinquante",
  "soixante",
  "soixante",
  "quatre-vingt",
  "quatre-vingt",
] as const;

/** 0 < n < 100. `final` : rien ne suit dans le groupe (« quatre-vingts », pas « quatre-vingt mille »). */
function frMoinsDeCent(n: number, final: boolean): string {
  if (n < 20) return FR_UNITES[n]!;
  const d = Math.floor(n / 10);
  const u = n % 10;
  if (d === 7 || d === 9) {
    if (d === 7 && u === 1) return "soixante et onze";
    return `${FR_DIZAINES[d]}-${FR_UNITES[10 + u]}`;
  }
  if (u === 0) return d === 8 && final ? "quatre-vingts" : FR_DIZAINES[d]!;
  if (u === 1 && d !== 8) return `${FR_DIZAINES[d]} et un`;
  return `${FR_DIZAINES[d]}-${FR_UNITES[u]}`;
}

/** 0 < n < 1000. */
function frMoinsDeMille(n: number, final: boolean): string {
  const c = Math.floor(n / 100);
  const r = n % 100;
  const mots: string[] = [];
  if (c === 1) mots.push("cent");
  else if (c > 1) mots.push(`${FR_UNITES[c]} ${r === 0 && final ? "cents" : "cent"}`);
  if (r > 0) mots.push(frMoinsDeCent(r, final));
  return mots.join(" ");
}

function francais(n: bigint): string {
  if (n === 0n) return FR_UNITES[0];
  const groupes: [bigint, string | null][] = [
    [n / 10n ** 9n, "milliard"],
    [(n / 10n ** 6n) % 1000n, "million"],
    [(n / 1000n) % 1000n, "mille"],
    [n % 1000n, null],
  ];
  const mots: string[] = [];
  for (const [g, nom] of groupes) {
    const v = Number(g);
    if (v === 0) continue;
    if (nom === "mille") mots.push(v === 1 ? "mille" : `${frMoinsDeMille(v, false)} mille`);
    else if (nom) mots.push(`${frMoinsDeMille(v, true)} ${nom}${v > 1 ? "s" : ""}`);
    else mots.push(frMoinsDeMille(v, true));
  }
  return mots.join(" ");
}

/* ------------------------------------------------------------------- anglais */

const EN_UNITES = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
] as const;
const EN_DIZAINES = [
  "",
  "",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
] as const;

function enMoinsDeMille(n: number): string {
  const c = Math.floor(n / 100);
  const r = n % 100;
  const mots: string[] = [];
  if (c > 0) mots.push(`${EN_UNITES[c]} hundred`);
  if (r > 0 && r < 20) mots.push(EN_UNITES[r]!);
  else if (r >= 20) {
    const d = EN_DIZAINES[Math.floor(r / 10)]!;
    mots.push(r % 10 === 0 ? d : `${d}-${EN_UNITES[r % 10]}`);
  }
  return mots.join(" ");
}

function anglais(n: bigint): string {
  if (n === 0n) return EN_UNITES[0];
  const groupes: [bigint, string | null][] = [
    [n / 10n ** 9n, "billion"],
    [(n / 10n ** 6n) % 1000n, "million"],
    [(n / 1000n) % 1000n, "thousand"],
    [n % 1000n, null],
  ];
  return groupes
    .filter(([g]) => g > 0n)
    .map(([g, nom]) => (nom ? `${enMoinsDeMille(Number(g))} ${nom}` : enMoinsDeMille(Number(g))))
    .join(" ");
}

/* -------------------------------------------------------------------- arabe */

const AR_UNITES = [
  "",
  "واحد",
  "اثنان",
  "ثلاثة",
  "أربعة",
  "خمسة",
  "ستة",
  "سبعة",
  "ثمانية",
  "تسعة",
  "عشرة",
] as const;
const AR_DIZAINES = [
  "",
  "",
  "عشرون",
  "ثلاثون",
  "أربعون",
  "خمسون",
  "ستون",
  "سبعون",
  "ثمانون",
  "تسعون",
] as const;
const AR_CENTAINES = [
  "",
  "مائة",
  "مائتان",
  "ثلاثمائة",
  "أربعمائة",
  "خمسمائة",
  "ستمائة",
  "سبعمائة",
  "ثمانمائة",
  "تسعمائة",
] as const;
const AR_ET = " و";

/** Les grands nombres, eux-mêmes comptés. */
const AR_MILLE: FormesDuNom = {
  singulier: "ألف",
  duel: "ألفان",
  pluriel: "آلاف",
  accusatif: "ألفا",
};
const AR_MILLION: FormesDuNom = {
  singulier: "مليون",
  duel: "مليونان",
  pluriel: "ملايين",
  accusatif: "مليونا",
};
const AR_MILLIARD: FormesDuNom = {
  singulier: "مليار",
  duel: "ملياران",
  pluriel: "مليارات",
  accusatif: "مليارا",
};

function arMoinsDeCent(n: number): string {
  if (n <= 10) return AR_UNITES[n]!;
  if (n === 11) return "أحد عشر";
  if (n === 12) return "اثنا عشر";
  if (n < 20) return `${AR_UNITES[n - 10]} عشر`;
  const u = n % 10;
  const d = AR_DIZAINES[Math.floor(n / 10)]!;
  return u === 0 ? d : `${AR_UNITES[u]}${AR_ET}${d}`;
}

function arMoinsDeMille(n: number): string {
  const c = Math.floor(n / 100);
  const r = n % 100;
  const mots: string[] = [];
  if (c > 0) mots.push(AR_CENTAINES[c]!);
  if (r > 0) mots.push(arMoinsDeCent(r));
  return mots.join(AR_ET);
}

/** La forme du nom compté par n (n ≥ 3), d'après ses deux derniers chiffres. */
function arFormeComptee(n: bigint, f: FormesDuNom): string {
  const r = Number(n % 100n);
  if (r >= 3 && r <= 10) return f.pluriel;
  if (r >= 11) return exige(f.accusatif);
  return f.singulier;
}

/** « ألف », « ألفان », « ثلاثة آلاف », « أحد عشر ألفا », « مائة ألف ». */
function arCompte(n: bigint, f: FormesDuNom): string {
  if (n === 1n) return f.singulier;
  if (n === 2n) return exige(f.duel);
  return `${arabe(n)} ${arFormeComptee(n, f)}`;
}

function arabe(n: bigint): string {
  if (n === 0n) return "صفر";
  const groupes: [bigint, FormesDuNom | null][] = [
    [n / 10n ** 9n, AR_MILLIARD],
    [(n / 10n ** 6n) % 1000n, AR_MILLION],
    [(n / 1000n) % 1000n, AR_MILLE],
    [n % 1000n, null],
  ];
  return groupes
    .filter(([g]) => g > 0n)
    .map(([g, f]) => (f ? arCompte(g, f) : arMoinsDeMille(Number(g))))
    .join(AR_ET);
}

function exige(forme: string | null | undefined): string {
  if (!forme) throw new Error("lettres.forme_manquante");
  return forme;
}

/* ------------------------------------------------------------------ montant */

/** Un nombre et son nom, dans la langue. */
function compte(n: bigint, nom: FormesDuNom, langue: LangueDesLettres): string {
  if (langue === "ar") {
    if (n === 1n) return `${nom.singulier} ${AR_UNITES[1]}`;
    if (n === 2n) return exige(nom.duel);
    return `${arabe(n)} ${arFormeComptee(n, nom)}`;
  }
  if (langue === "en") return `${anglais(n)} ${n === 1n ? nom.singulier : nom.pluriel}`;
  // « un million DE dinars » : après million et milliard ronds, le nom se lie par « de ».
  const de = n >= 10n ** 6n && n % 10n ** 6n === 0n ? "de " : "";
  return `${francais(n)} ${de}${n < 2n ? nom.singulier : nom.pluriel}`;
}

const LIAISON: Record<LangueDesLettres, string> = { fr: " et ", en: " and ", ar: AR_ET };

/**
 * Le montant décimal `montant` (« 1234.5 », « 119.000 ») en toutes lettres, dans `langue`,
 * avec les noms de la devise. `exposant` : les décimales de la devise (3 pour une devise en
 * millièmes). Lève une erreur pour un montant mal formé, négatif, trop grand, ou portant plus
 * de décimales que la devise — jamais d'arrondi silencieux.
 */
export function ecrireLeMontantEnLettres(
  montant: string,
  exposant: number,
  langue: LangueDesLettres,
  noms: NomsDeLaDevise,
): string {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(montant.trim());
  if (!m || !Number.isInteger(exposant) || exposant < 0)
    throw new Error("lettres.montant_invalide");
  const fraction = m[2] ?? "";
  if (fraction.replace(/0+$/, "").length > exposant) throw new Error("lettres.montant_invalide");
  const majeures = BigInt(m[1]!);
  const mineures = exposant > 0 ? BigInt(fraction.padEnd(exposant, "0").slice(0, exposant)) : 0n;
  if (majeures >= PLAFOND) throw new Error("lettres.montant_trop_grand");

  if (majeures === 0n && mineures > 0n) return compte(mineures, noms.mineure, langue);
  const tete = compte(majeures, noms.majeure, langue);
  return mineures > 0n
    ? `${tete}${LIAISON[langue]}${compte(mineures, noms.mineure, langue)}`
    : tete;
}
