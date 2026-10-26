import { D, sum } from "./decimal.ts";

/** Répartition au plus fort reste : la somme égale exactement la TVA imprimée. */
export function repartirMontant(montant: string, poids: string[], decimales: number): string[] {
  if (!poids.length) return [];
  const total = sum(poids);
  if (total.isZero()) {
    if (!D(montant).isZero()) return poids.map(() => "0");
    return poids.map(() => "0");
  }
  const echelle = D(10).pow(decimales);
  const mineur = D(montant).mul(echelle);
  const quotas = poids.map((p) => mineur.mul(p).div(total));
  const entiers = quotas.map((q) => q.floor());
  let reste = mineur.minus(sum(entiers.map((e) => e.toString()))).toNumber();
  const ordre = quotas
    .map((q, i) => ({ i, reste: q.minus(entiers[i]!) }))
    .sort((a, b) => b.reste.comparedTo(a.reste) || a.i - b.i);
  for (const o of ordre) {
    if (reste-- <= 0) break;
    entiers[o.i] = entiers[o.i]!.plus(1);
  }
  return entiers.map((v) => v.div(echelle).toFixed(decimales));
}
