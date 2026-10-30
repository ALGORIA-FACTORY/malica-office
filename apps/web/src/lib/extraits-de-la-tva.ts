/**
 * La TVA d'un ensemble d'extraits : le seul calcul que font le mois
 * (`use-tva`), l'accueil (`use-accueil`) et la synthèse du cabinet
 * (`use-synthese-client`).
 *
 * Une pièce dont l'extrait ne valide pas (un taux manquant, revue de #140)
 * n'est jamais écartée en silence : elle est « refusée », avec ce qui manque
 * (`EXTRAIT_ILLISIBLE:<champs>`), à côté des refus du moteur — et l'écran la
 * compte.
 */
import { computeTva } from "@malica/socle";
import { ExtractV1 } from "@malica/socle/contracts/extract.v1";
import type { TvaV1 } from "@malica/socle/contracts/tva.v1";
import type { TaxRate } from "@malica/socle/ports/repositories";

type Entree = { item_id: string | null; extract: ExtractV1 };

export function tvaDesExtraits(args: {
  period: string;
  currency: { code: string; decimals: number };
  taux: ReadonlyArray<TaxRate>;
  rows: ReadonlyArray<{ pieceId: string; extract: unknown }>;
}): TvaV1 {
  const achats: Entree[] = [];
  const ventes: Entree[] = [];
  const illisibles: TvaV1["refused"] = [];
  for (const row of args.rows) {
    const lu = ExtractV1.safeParse(row.extract);
    if (!lu.success) {
      const champs = [...new Set(lu.error.issues.map((i) => i.path.join(".")))].sort();
      illisibles.push({ reason: `EXTRAIT_ILLISIBLE:${champs.join(",")}`, item_id: row.pieceId });
      continue;
    }
    const entree = { item_id: row.pieceId, extract: lu.data };
    if (lu.data.document_kind === "facture_vente") ventes.push(entree);
    else achats.push(entree);
  }
  const calcul = computeTva({
    period: args.period,
    currency: args.currency,
    tax_rates: args.taux.map((r) => ({
      code: r.code,
      label: r.label,
      rate: r.rate,
      valid_from: r.validFrom,
      valid_to: r.validTo,
      jurisdiction: r.jurisdiction,
    })),
    achats,
    ventes,
  });
  return { ...calcul, refused: [...illisibles, ...calcul.refused] };
}
