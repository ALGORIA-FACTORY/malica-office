/**
 * Le montant d'une pièce dans un total, et les totaux d'un groupe de pièces.
 *
 * ================================================================= POURQUOI
 *
 * Le dirigeant, 21 novembre 2026, sur les ventes d'octobre : deux factures de
 * 300 et 360 EUR et leurs deux avoirs affichaient « 1 320,000 ». Trois fautes en
 * un chiffre :
 *
 *   — un avoir s'ADDITIONNAIT : il retranche (`ref.document_types.signe`, -1) ;
 *   — des euros s'écrivaient à trois décimales : la somme prenait les décimales
 *     du dinar par défaut. Chaque devise garde les siennes (`ref.devises`, R4) ;
 *   — des devises différentes se seraient additionnées : un total par devise.
 *
 * Pur : ni réseau ni écran. Les décimales viennent de la pièce (`decimales`,
 * rendues par la liste) ; inconnues, celles de la chaîne la plus précise — on
 * n'arrondit jamais un montant en silence.
 */
import type { PieceLue } from "@malica/socle/ports/repositories";
import { sommeDecimale } from "@malica/socle/somme-decimale";

export interface TypeSigne {
  code: string;
  /** -1 retranche (un avoir) ; absent ou 1, ajoute. */
  signe?: 1 | -1;
}

type PieceChiffree = Pick<PieceLue, "total" | "devise" | "typeDeDocument"> & {
  decimales?: number | null;
};

/** Le total d'une pièce, signé selon son type : « -300.00 » pour un avoir. */
export function montantDeLaPiece(p: PieceChiffree, types: readonly TypeSigne[]): string | null {
  if (p.total === null || p.total.trim() === "") return null;
  const signe = types.find((t) => t.code === p.typeDeDocument)?.signe ?? 1;
  if (signe === 1) return p.total;
  // Un avoir retranche, qu'il soit imprimé « 300 » ou « -300 ».
  const absolu = p.total.trim().replace(/^-/, "");
  return /^0*([.,]0*)?$/.test(absolu) ? absolu : `-${absolu}`;
}

export interface TotalDeDevise {
  devise: string | null;
  total: string;
}

/** Un total par devise, chacun à ses décimales, dans l'ordre où les devises apparaissent. */
export function totauxParDevise(
  pieces: readonly PieceChiffree[],
  types: readonly TypeSigne[],
): TotalDeDevise[] {
  const groupes = new Map<string | null, { valeurs: string[]; decimales: number | null }>();
  for (const p of pieces) {
    const v = montantDeLaPiece(p, types);
    if (v === null) continue;
    const g = groupes.get(p.devise) ?? { valeurs: [], decimales: p.decimales ?? null };
    g.valeurs.push(v);
    if (g.decimales === null && p.decimales != null) g.decimales = p.decimales;
    groupes.set(p.devise, g);
  }
  return [...groupes].map(([devise, g]) => {
    // Les décimales qui comptent : « 300.000 » en euros n'en porte aucune de plus.
    const precision = Math.max(
      0,
      ...g.valeurs.map((v) => (v.split(/[.,]/)[1] ?? "").replace(/0+$/, "").length),
    );
    // Les décimales de la devise, sauf si un montant en porte plus : il reste exact.
    const decimales = g.decimales === null ? precision : Math.max(g.decimales, precision);
    return { devise, total: sommeDecimale(g.valeurs, decimales) };
  });
}
