/**
 * LA RELECTURE GUIDÉE PAR LA CONTRADICTION — relire les seules cellules que l'arithmétique
 * de la pièce désigne.
 *
 * ================================================================== POURQUOI
 *
 * Banc sans IA du 4 novembre 2026 : sur les photos et les scans, environ 1 000 cellules de
 * lignes restaient muettes alors que les totaux de la pièce étaient prouvés. L'OCR avait
 * mal lu une ou deux cellules dans la ligne (« 73.950 » lu « 71.950 », « 1 » lu « T ») :
 * le tableau ne fermait plus, et TOUTES ses lignes se taisaient. Lue SEULE, dans sa boîte,
 * la même cellule se lit juste (algoria-028 : 0,94 et 0,99).
 *
 * ================================================================== CE QUI SE FAIT
 *
 * Quand le centre est prouvé (le total HT a sa valeur et son jeton) et que les lignes ne
 * le sont pas, les cellules des rangées d'articles — au-dessus du total HT, deux montants à
 * décimales au moins — sont relues une à une par le second lecteur (`POST /relire`). Une relecture ne
 * remplace la lecture d'un jeton que si elle est plus sûre que lui. Puis le moteur rejoue :
 * la preuve reste l'arithmétique, rien n'est affirmé par la relecture elle-même.
 */
import type { SortieDuSudoku } from "@malica/sudoku";

import type { PageToken } from "./token-plan.ts";

/** Une cellule relue seule : son texte et la confiance du lecteur. */
export interface LectureDeCellule {
  readonly texte: string;
  readonly confiance: number;
}

/** Une cellule n'est pas plus longue (un montant, une quantité, un taux, une remise). */
const SIGNES_D_UNE_CELLULE = 12;
/** Une rangée d'articles porte au moins tant de montants à décimales (un prix, un montant). */
const MONTANTS_D_UNE_RANGEE = 2;

const recouvrent = (a: PageToken, b: PageToken) =>
  a.page === b.page &&
  Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 0.5 * Math.min(a.y1 - a.y0, b.y1 - b.y0);

/** Les indices des jetons à relire, ou aucun quand rien ne contredit la lecture. */
export function cellulesContredites(
  tokens: readonly PageToken[],
  sortie: SortieDuSudoku,
  champTotal: string,
): number[] {
  if (sortie.issue !== "prouvee" || sortie.lignes?.statut === "prouve") return [];
  const ref = sortie.champs[champTotal]?.refs?.[0];
  const total = ref
    ? tokens.find((t) => t.page === ref.page && t.ordinal === ref.ordinal)
    : undefined;
  if (!total) return [];
  const chiffre = (t: PageToken) => /\d/u.test(t.text);
  const decimal = (t: PageToken) => /\d[.,]\d{2,3}\D?$/u.test(t.text.trim());
  const dessus = tokens
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => t.page === total.page && t.y1 <= total.y0 + 0.5 * (total.y1 - total.y0));
  // Les rangées d'articles : au moins deux montants à décimales (un prix, un montant) — pas
  // l'en-tête de la pièce, dont le téléphone ou le RIB portent des chiffres sans décimales.
  const rangees = dessus.filter(
    ({ t }) =>
      dessus.filter(({ t: u }) => decimal(u) && recouvrent(t, u)).length >= MONTANTS_D_UNE_RANGEE,
  );
  return rangees
    .filter(({ t }) => t.text.trim().length <= SIGNES_D_UNE_CELLULE)
    .filter(({ t }) => chiffre(t) || t.text.trim().length <= 2)
    .filter(({ t }) => !recouvrent(t, total))
    .map(({ i }) => i);
}

/** Le plan, chaque jeton relu remplacé quand sa relecture est plus sûre que lui. */
export function avecLesRelectures(
  tokens: readonly PageToken[],
  indices: readonly number[],
  lectures: readonly LectureDeCellule[],
): PageToken[] {
  const out = [...tokens];
  indices.forEach((i, k) => {
    const l = lectures[k];
    const t = out[i]!;
    if (!l || !l.texte.trim() || l.texte.trim() === t.text.trim()) return;
    if (l.confiance <= (t.confidence ?? 0)) return;
    out[i] = { ...t, text: l.texte.trim(), confidence: l.confiance };
  });
  return out;
}
