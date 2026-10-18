/**
 * L'écriture d'un jeton, et la clé d'une ancre — module pur.
 *
 * ================================================================= POURQUOI
 *
 * Deux choses se décident ici, et aucune des deux n'est cosmétique.
 *
 * LE SENS DE LECTURE. « À gauche de » n'a pas le même sens dans les deux
 * écritures d'une facture tunisienne : en arabe, le libellé est à DROITE de ce
 * qu'il qualifie. Une relation spatiale calculée sur l'abscisse seule rendrait
 * donc l'inverse de ce qu'un lecteur voit, et deux formats miroirs se
 * confondraient.
 *
 * CE QUI PEUT SERVIR D'ANCRE. Une ancre est un mot qui ne varie pas d'une
 * facture à l'autre : un libellé, une mention, l'ossature d'un entête. Un
 * montant, une date, un numéro de pièce n'en sont pas — ils portent des
 * chiffres, et c'est le seul critère qu'une page unique permette de trancher
 * sans inventer un vocabulaire (ce que R4 interdirait de toute façon).
 *
 * ========================================= POURQUOI CE N'EST PAS UN DOUBLON
 *
 * `malica/lecture/token-plan.ts` porte `comparable`, et `article-repair.ts`
 * porte `key` : deux normalisations voisines, toutes deux PRIVÉES, dans des
 * fichiers que cette tâche n'a pas le droit d'écrire (la chaîne de lecture est
 * sous R2 et appartient à une autre tâche). Leur sémantique diffère d'ailleurs
 * de celle-ci sur le point qui compte : `comparable` DOIT garder les chiffres,
 * puisqu'elle sert à lire des dates, là où une clé d'ancre doit les refuser.
 *
 * Les plages d'écriture sont écrites en échappements `\uXXXX`, et ELLES DOIVENT
 * LE RESTER. Écrites en caractères littéraux, elles embarquent des marques
 * combinantes et des espaces de largeur nulle que plus personne ne voit en
 * relisant — `mots.ts` y a déjà perdu les siennes, et ce fichier les a perdues
 * une première fois le 18 octobre 2026, à sa toute première écriture.
 */

/** Les écritures qui se lisent de droite à gauche — l'arabe et l'hébreu. */
const DROITE_A_GAUCHE =
  /[\u0590-\u05FF\u0600-\u06FF\u0700-\u074F\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFC]/;

/** Les chiffres : latins, arabo-indiens, et leur variante persane. */
const CHIFFRE = /[0-9\u0660-\u0669\u06F0-\u06F9]/;

/**
 * Les marques qui ne changent pas le mot : diacritiques latins issus de la
 * décomposition, hamza et vocalisation arabes, tatweel d'étirement.
 *
 * La décomposition NFD d'un « أ » rend « ا » suivi de U+0654, qui vit dans le
 * bloc arabe et non parmi les diacritiques latins : retirer la seule plage
 * U+0300–U+036F réunirait « février » et « fevrier » en laissant « الأداء »
 * et « الاداء » distincts. C'est le piège que `token-plan.ts` a déjà payé.
 */
const MARQUES =
  /[\u0300-\u036F\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E8\u06EA-\u06ED]/gu;

/**
 * Le tatweel, qui étire un mot sans rien y changer. Il a sa propre
 * expression : collé aux marques combinantes dans une même classe, il formait
 * avec la suivante un caractère composé, et `no-misleading-character-class`
 * avait raison de le refuser.
 */
const TATWEEL = /\u0640/gu;

/** Tout ce qui n'est pas une lettre : ponctuation, espaces, symboles. */
const HORS_LETTRE = /[^\p{L}]/gu;

export type Sens = "ltr" | "rtl" | "mixte";

/**
 * La clé d'une ancre, ou `null` si ce jeton n'en est pas une.
 *
 * Un jeton qui porte un chiffre est une VALEUR : montant, date, numéro,
 * matricule. Un jeton sans lettre n'est qu'une ponctuation. Ni l'un ni
 * l'autre ne décrit une forme, et une signature qui les retiendrait ne
 * reconnaîtrait qu'un seul document — le sien.
 */
export function cleDAncre(texte: string): string | null {
  if (CHIFFRE.test(texte)) return null;
  const cle = texte
    .normalize("NFD")
    .replace(MARQUES, "")
    .replace(TATWEEL, "")
    .replace(HORS_LETTRE, "")
    .toLowerCase();
  return cle.length > 0 ? cle : null;
}

/** Le sens d'un texte, ou `null` quand il est neutre (chiffres, ponctuation). */
function sensDUnTexte(texte: string): "ltr" | "rtl" | null {
  if (DROITE_A_GAUCHE.test(texte)) return "rtl";
  return /\p{L}/u.test(texte) ? "ltr" : null;
}

/**
 * Le sens dominant d'une page.
 *
 * Les jetons neutres ne votent pas : une facture arabe porte ses montants en
 * chiffres latins, et les compter la rendrait « mixte » à tort. En deçà de la
 * part exigée, la page est dite mixte — c'est le cas ordinaire d'une facture
 * tunisienne, pas une exception.
 */
export function sensDominant(textes: readonly string[], partMinimale: number): Sens {
  let rtl = 0;
  let ltr = 0;
  for (const texte of textes) {
    const sens = sensDUnTexte(texte);
    if (sens === "rtl") rtl += 1;
    else if (sens === "ltr") ltr += 1;
  }
  const total = rtl + ltr;
  if (total === 0) return "mixte";
  if (rtl / total >= partMinimale) return "rtl";
  if (ltr / total >= partMinimale) return "ltr";
  return "mixte";
}
