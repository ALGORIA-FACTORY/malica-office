/**
 * Les lignes d'une facture tiennent-elles ? Fonction pure, en entiers exacts.
 *
 * ================================================================= POURQUOI
 *
 * Le crayon des lignes (10 novembre 2026) laisse corriger la quantité, le prix
 * unitaire et le montant HT d'une ligne. Le jugement des montants (la
 * normalisation) tient le PIED : base, TVA, droits, total. Il ne regarde pas
 * qu'une ligne vaille quantité × prix. Sans cette vérification, « la facture
 * tombe juste » serait dit d'une ligne dont le montant ne suit pas son prix.
 *
 * Deux égalités, chacune à la tolérance d'arrondi du paramétrage près
 * (`lecture.tolerance_arrondi_mineure`, en unités mineures) :
 *
 *     quantité × prix unitaire HT = montant HT de la ligne
 *     Σ montants HT des lignes    = base HT du pied
 *
 * Une égalité qu'on ne peut pas poser (une quantité, un prix ou un montant
 * absent) n'est pas posée : on ne reproche pas à une ligne ce qu'elle ne dit
 * pas. Aucun nombre flottant, aucune valeur de devise écrite ici : les
 * décimales viennent de la devise du référentiel, par l'appelant (R4).
 */
import type { ArticleLu } from "./precisions-de-lecture.ts";

/** Un décimal exact : `n` unités de 10^-echelle. */
interface Decimal {
  n: bigint;
  echelle: number;
}

const decimal = (v: string | null | undefined): Decimal | null => {
  const m = /^(\d+)(?:\.(\d+))?$/.exec((v ?? "").trim());
  if (!m) return null;
  const fraction = m[2] ?? "";
  return { n: BigInt(`${m[1]}${fraction}`), echelle: fraction.length };
};

/** Division entière arrondie à la moitié supérieure (valeurs positives). */
const arrondi = (num: bigint, den: bigint) => (2n * num + den) / (2n * den);

/** Ce décimal en unités mineures de la devise (arrondi à la moitié supérieure). */
const enMineur = (d: Decimal, decimales: number): bigint =>
  d.echelle <= decimales
    ? d.n * 10n ** BigInt(decimales - d.echelle)
    : arrondi(d.n, 10n ** BigInt(d.echelle - decimales));

const ecart = (a: bigint, b: bigint) => (a > b ? a - b : b - a);

/**
 * Les champs à vérifier : les chemins de citation des lignes dont le montant ne
 * suit pas quantité × prix, et `totals.base_ht` quand les lignes ne font pas la
 * base du pied. Vide quand tout tient.
 */
export function lignesQuiNeTiennentPas(
  articles: readonly ArticleLu[],
  baseHt: string | null | undefined,
  decimales: number,
  toleranceMineure: number,
): string[] {
  const tolerance = BigInt(toleranceMineure);
  const aVerifier: string[] = [];

  articles.forEach((a, i) => {
    const q = decimal(a.quantity);
    const pu = decimal(a.unit_price_ht);
    const total = decimal(a.total_ht);
    if (!q || !pu || !total) return;
    const attendu = arrondi(
      q.n * pu.n * 10n ** BigInt(decimales),
      10n ** BigInt(q.echelle + pu.echelle),
    );
    if (ecart(attendu, enMineur(total, decimales)) > tolerance)
      aVerifier.push(`articles[${i}].total_ht`);
  });

  const base = decimal(baseHt);
  const totaux = articles.map((a) => decimal(a.total_ht));
  if (base && articles.length > 0 && totaux.every((t): t is Decimal => t !== null)) {
    const somme = totaux.reduce((s, t) => s + enMineur(t, decimales), 0n);
    // Chaque ligne arrondit pour son compte : la tolérance se cumule d'une ligne à l'autre.
    if (ecart(somme, enMineur(base, decimales)) > tolerance * BigInt(articles.length))
      aVerifier.push("totals.base_ht");
  }
  return aVerifier;
}
