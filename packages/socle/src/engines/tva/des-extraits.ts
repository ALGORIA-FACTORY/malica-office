/**
 * La TVA d'un ensemble d'extraits : le SEUL calcul que font le mois
 * (`use-tva`), l'accueil (`use-accueil`), la synthèse du cabinet
 * (`use-synthese-client`) et le PV de réunion (`malica/pv/rediger`).
 *
 * Il vivait dans l'application web ; le PV, côté serveur, refaisait le même
 * assemblage à la main — et écartait EN SILENCE un extrait qui ne validait
 * pas, quand l'écran le refusait en le nommant. Il vit donc au Socle, où les
 * deux rives le lisent (3 novembre 2026).
 *
 * Une pièce dont l'extrait ne valide pas (un taux manquant, revue de #140)
 * n'est jamais écartée en silence : elle est « refusée », avec ce qui manque
 * (`EXTRAIT_ILLISIBLE:<champs>`), à côté des refus du moteur — et l'écran la
 * compte.
 */
import { ExtractV1 } from "../../contracts/extract.v1.ts";
import type { TvaV1 } from "../../contracts/tva.v1.ts";
import type { DeclarationTva, TaxRate } from "../../ports/repositories.ts";
import { computeTva } from "./compute.ts";

type Entree = { item_id: string | null; extract: ExtractV1 };

/** Le motif d'un extrait qui ne valide pas le contrat : la pièce entière est hors du calcul. */
export const EXTRAIT_ILLISIBLE = "EXTRAIT_ILLISIBLE";

export function tvaDesExtraits(args: {
  period: string;
  currency: { code: string; decimals: number };
  taux: ReadonlyArray<TaxRate>;
  /** Les lignes de la déclaration, au référentiel (`referentiel.declarationTva`). */
  declaration: DeclarationTva;
  rows: ReadonlyArray<{ pieceId: string; extract: unknown }>;
}): TvaV1 {
  const achats: Entree[] = [];
  const ventes: Entree[] = [];
  const illisibles: TvaV1["refused"] = [];
  for (const row of args.rows) {
    const lu = ExtractV1.safeParse(row.extract);
    if (!lu.success) {
      const champs = [...new Set(lu.error.issues.map((i) => i.path.join(".")))].sort();
      illisibles.push({ reason: `${EXTRAIT_ILLISIBLE}:${champs.join(",")}`, item_id: row.pieceId });
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
    declaration: {
      nature_par_defaut: args.declaration.natureParDefaut,
      lignes: args.declaration.lignes,
      affectations: args.declaration.affectations,
    },
    achats,
    ventes,
  });
  return { ...calcul, refused: [...illisibles, ...calcul.refused] };
}
