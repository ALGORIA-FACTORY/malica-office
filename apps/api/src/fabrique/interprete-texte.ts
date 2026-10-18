/**
 * Reconnaître un jeton — et rien de plus — module pur.
 *
 * ================================================================= POURQUOI
 *
 * L'interprète doit pouvoir dire « ce jeton porte le texte « Total » » et
 * « ce jeton a la forme d'un nombre ». Les deux sont des questions de
 * RECONNAISSANCE, et aucune des deux ne produit de valeur : `formeDuJeton`
 * rend une classe, jamais un nombre ; `correspond` rend un booléen, jamais le
 * texte qu'il a comparé. Il n'existe dans ce fichier aucune fonction qui
 * rende un montant, une date ou un texte lu — c'est la règle ① du plan, tenue
 * ici comme elle l'est dans le type `ResultatDeChamp`.
 *
 * ========================================= POURQUOI CE N'EST PAS UN DOUBLON
 *
 * `cleDAncre` (`signature-ecriture.ts`) refuse les jetons qui portent un
 * chiffre, par construction : une ancre de signature ne peut pas être une
 * valeur. Ici, il faut au contraire pouvoir comparer « 118 » ou « 04/10/2026 »
 * — non pour les lire, mais pour décider si un jeton a la FORME attendue.
 *
 * Le repli commun — décomposition, marques combinantes, tatweel, minuscules —
 * n'est donc pas recopié : il est importé de `signature-ecriture.ts`, qui le
 * porte avec ses plages d'écriture en échappements. Les recopier aurait donné
 * deux normalisations qui se corrigent d'un seul côté.
 *
 * ============================================== R4 — AUCUNE CONSTANTE ICI
 *
 * Aucun libellé, aucun nom de format, aucun seuil. Les seules expressions
 * régulières de ce fichier décrivent des FORMES d'écriture — un groupe de
 * chiffres, un séparateur de date — qui n'appartiennent à aucune juridiction
 * et ne figurent dans aucun texte réglementaire.
 */
import { replierLesMarques } from "./signature-ecriture.ts";

import type { Motif } from "./recette.ts";

/** Les systèmes de chiffres, tels que le langage des recettes les nomme. */
export type SystemeDeChiffres = "latins" | "arabes" | "les_deux";

/** Les classes de forme, telles que le langage des recettes les nomme. */
export type Forme = "nombre" | "date" | "pourcentage" | "identifiant" | "mot";

/**
 * Les chiffres arabo-indiens et leur variante persane, et leur rang.
 *
 * Replier « ٥ » sur « 5 » n'est pas LIRE : aucun nombre n'en sort, seulement
 * un texte comparable. La lecture d'un montant reste entièrement dans la
 * chaîne existante, après `recollerLesMilliers`.
 */
const CHIFFRES_ARABES = "٠١٢٣٤٥٦٧٨٩";
const CHIFFRES_PERSANS = "۰۱۲۳۴۵۶۷۸۹";

/** Tout ce qui n'est ni lettre ni chiffre : ponctuation, espaces, symboles. */
const HORS_LETTRE_NI_CHIFFRE = /[^\p{L}\p{N}]/gu;

/**
 * Replie les chiffres d'une autre écriture sur les chiffres latins.
 *
 * `latins` ne replie rien : une recette qui déclare ne reconnaître que les
 * chiffres latins ne doit pas voir « ١١٨ » comme un nombre, sans quoi la
 * déclaration ne sert à rien.
 */
function replierLesChiffres(texte: string, systeme: SystemeDeChiffres): string {
  if (systeme === "latins") return texte;
  let sortie = "";
  for (const c of texte) {
    const arabe = CHIFFRES_ARABES.indexOf(c);
    const persan = CHIFFRES_PERSANS.indexOf(c);
    sortie += arabe >= 0 ? String(arabe) : persan >= 0 ? String(persan) : c;
  }
  return sortie;
}

/**
 * La forme comparable d'un texte : repli des marques, repli des chiffres,
 * puis retrait de tout ce qui n'est ni lettre ni chiffre.
 *
 * « P.U.HT » et « PU HT » se comparent donc égaux, et c'est voulu : un relevé
 * place la ponctuation là où il la voit, et une recette qui dépendrait d'un
 * point ne survivrait pas au premier scan un peu sale.
 */
function texteComparable(texte: string, systeme: SystemeDeChiffres): string {
  return replierLesChiffres(replierLesMarques(texte), systeme).replace(HORS_LETTRE_NI_CHIFFRE, "");
}

/* --------------------------------------------------------- les formes --- */

/** Un chiffre, quelle que soit l'écriture — utilisé avant tout repli. */
const UN_CHIFFRE = /[0-9]/;
const UNE_LETTRE = /\p{L}/u;
/** Un nombre : des chiffres, des groupes séparés, une partie décimale. */
const UN_NOMBRE = /^[-+(]?[0-9]+(?:[ \u00A0.,'][0-9]+)*[)]?$/;
/** Un pourcentage : un nombre suivi du signe, ou le signe suivi d'un nombre. */
const UN_POURCENTAGE = /^(?:%\s*[0-9]|[0-9][0-9 \u00A0.,']*\s*%)/;
/** Une date écrite en trois groupes de chiffres séparés. */
const UNE_DATE = /^[0-9]{1,4}[/.-][0-9]{1,2}[/.-][0-9]{1,4}$/;

/**
 * La classe de forme d'un jeton, ou `null` quand il n'en a aucune.
 *
 * L'ordre des essais n'est pas cosmétique : « 19 % » est un pourcentage avant
 * d'être un nombre, et « 04/10/2026 » est une date avant d'être un
 * identifiant. Le premier qui répond l'emporte, et la liste est close.
 */
export function formeDuJeton(texte: string, systeme: SystemeDeChiffres): Forme | null {
  const brut = replierLesChiffres(texte, systeme).trim();
  if (brut.length === 0) return null;
  if (UN_POURCENTAGE.test(brut)) return "pourcentage";
  if (UNE_DATE.test(brut)) return "date";
  if (UN_NOMBRE.test(brut)) return "nombre";
  const chiffre = UN_CHIFFRE.test(brut);
  const lettre = UNE_LETTRE.test(brut);
  if (chiffre) return "identifiant";
  return lettre ? "mot" : null;
}

/* ------------------------------------------------------- la comparaison -- */

/**
 * Le jeton satisfait-il ce motif ?
 *
 * Le système de chiffres du motif l'emporte sur celui de la recette quand il
 * est déclaré : une facture mixte porte ses libellés en arabe et ses montants
 * en chiffres latins, et une recette qui ne pourrait le dire qu'une fois pour
 * toute la pièce serait fausse sur l'un des deux.
 */
export function correspond(
  motif: Motif,
  texte: string,
  chiffresDeLaRecette: SystemeDeChiffres,
): boolean {
  const systeme = motif.chiffres ?? chiffresDeLaRecette;
  if (motif.genre === "forme") return formeDuJeton(texte, systeme) === motif.forme;

  const jeton = texteComparable(texte, systeme);
  const cherche = texteComparable(motif.texte, systeme);
  if (cherche.length === 0) return false;
  if (motif.genre === "exact") return jeton === cherche;
  if (motif.genre === "commence") return jeton.startsWith(cherche);
  return jeton.includes(cherche);
}
