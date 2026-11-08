/**
 * L'arithmétique du jeu synthétique — en entiers, jamais en flottants.
 *
 * ================================================================= POURQUOI ICI
 *
 * Les écritures attendues du jeu ne doivent RIEN au moteur qu'elles mesurent :
 * sans quoi le banc vérifierait que le produit fait ce qu'il fait. Ce fichier
 * n'importe donc rien de `@malica/socle` ni de `apps/api`. Il compte en unités
 * mineures (`BigInt`), arrondit lui-même, et écrit lui-même les montants comme
 * une facture les imprime.
 */

/** « 1234.567 » → 1234567n, à l'exposant donné. */
export function versMineur(decimal, exposant) {
  const [entier, fraction = ""] = String(decimal).split(".");
  const signe = entier.startsWith("-") ? -1n : 1n;
  const frac = (fraction + "0".repeat(exposant)).slice(0, exposant);
  return signe * BigInt(entier.replace("-", "") + frac || "0");
}

/** 1234567n → « 1234.567 » : l'écriture décimale du contrat. */
export function versDecimal(mineur, exposant) {
  const negatif = mineur < 0n;
  const abs = (negatif ? -mineur : mineur).toString().padStart(exposant + 1, "0");
  const entier = abs.slice(0, abs.length - exposant);
  const fraction = abs.slice(abs.length - exposant);
  return `${negatif ? "-" : ""}${entier}${exposant > 0 ? `.${fraction}` : ""}`;
}

/**
 * a × taux, arrondi à l'unité mineure. `pair` : au plus proche, à égalité au
 * pair (la conversion de change du pack, `change.ecart`) ; sinon au plus
 * proche, à égalité vers le haut (l'usage commercial des factures).
 */
export function multiplier(mineur, taux, { pair = false } = {}) {
  const [e, f = ""] = String(taux).split(".");
  const echelle = 10n ** BigInt(f.length);
  const num = mineur * BigInt(e + f);
  const quotient = num / echelle;
  const reste = num - quotient * echelle;
  const double = 2n * (reste < 0n ? -reste : reste);
  if (double > echelle) return quotient + (num < 0n ? -1n : 1n);
  if (double < echelle) return quotient;
  if (!pair) return quotient + (num < 0n ? -1n : 1n);
  return quotient % 2n === 0n ? quotient : quotient + (num < 0n ? -1n : 1n);
}

/**
 * Le hors-taxe d'un montant TTC : mineur ÷ (1 + taux), arrondi au plus proche,
 * à égalité vers le haut — la ligne d'un ticket de détail, qui imprime son
 * prix TTC et son montant HT (« PU TTC » × quantité ÷ 1,19).
 */
export function horsTaxe(mineur, taux) {
  const [e, f = ""] = String(taux).split(".");
  const echelle = 10n ** BigInt(f.length);
  const diviseur = echelle + BigInt(e + f);
  const num = mineur * echelle;
  const quotient = num / diviseur;
  const reste = num - quotient * diviseur;
  return 2n * reste >= diviseur ? quotient + 1n : quotient;
}

const ORIENTAUX = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];

/** Des chiffres latins en chiffres arabes orientaux (٠١٢٣…). */
export const enChiffresOrientaux = (texte) => texte.replace(/[0-9]/g, (c) => ORIENTAUX[Number(c)]);

/**
 * Un montant tel qu'une facture l'imprime : séparateur de milliers (espace,
 * point, virgule ou rien), séparateur décimal, chiffres latins ou orientaux.
 */
export function imprimer(mineur, exposant, format) {
  const [entier, fraction] = versDecimal(mineur, exposant).split(".");
  const groupes = [];
  for (let i = entier.length; i > 0; i -= 3) groupes.unshift(entier.slice(Math.max(0, i - 3), i));
  const texte = groupes.join(format.milliers) + (fraction ? `${format.decimal}${fraction}` : "");
  return format.chiffres === "orientaux" ? enChiffresOrientaux(texte) : texte;
}

/* --------------------------------------------------- les nombres en lettres */

const UNITES = [
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
];
const DIZAINES = ["", "dix", "vingt", "trente", "quarante", "cinquante", "soixante"];

function moinsDeCent(n) {
  if (n <= 16) return UNITES[n];
  if (n < 20) return `dix-${UNITES[n - 10]}`;
  if (n < 70) {
    const d = Math.floor(n / 10);
    const u = n % 10;
    if (u === 0) return DIZAINES[d];
    return u === 1 ? `${DIZAINES[d]} et un` : `${DIZAINES[d]}-${UNITES[u]}`;
  }
  if (n < 80) return n === 71 ? "soixante et onze" : `soixante-${moinsDeCent(n - 60)}`;
  if (n === 80) return "quatre-vingts";
  return `quatre-vingt-${moinsDeCent(n - 80)}`;
}

/** 0 ≤ n < 1000 ; `final` : rien ne suit (« deux cents », mais « deux cent mille »). */
function moinsDeMille(n, final) {
  const c = Math.floor(n / 100);
  const r = n % 100;
  let tete = "";
  if (c === 1) tete = "cent";
  else if (c > 1) tete = `${UNITES[c]} cent${r === 0 && final ? "s" : ""}`;
  if (r === 0) return tete;
  // « quatre-vingts », mais « quatre-vingt mille » : mille est invariable.
  const dizaines = r === 80 && !final ? "quatre-vingt" : moinsDeCent(r);
  return tete ? `${tete} ${dizaines}` : dizaines;
}

/** Un entier en toutes lettres, à la française (orthographe traditionnelle). */
export function enLettres(n) {
  if (n === 0) return "zéro";
  const millions = Math.floor(n / 1_000_000);
  const milliers = Math.floor((n % 1_000_000) / 1000);
  const reste = n % 1000;
  const parts = [];
  if (millions)
    parts.push(millions === 1 ? "un million" : `${moinsDeMille(millions, true)} millions`);
  if (milliers) parts.push(milliers === 1 ? "mille" : `${moinsDeMille(milliers, false)} mille`);
  if (reste) parts.push(moinsDeMille(reste, true));
  return parts.join(" ");
}
