/**
 * Moteur de valorisation des stocks — déterministe, sans réseau, sans base.
 * La méthode (CUMP ou FIFO) et les décimales sont des paramètres lus au pack.
 */
import { D, Decimal, toFixedStr } from "../../domain/decimal";
import type {
  StockDepreciationV1,
  StockLigne,
  StockMouvement,
  StockV1,
  StockVariationV1,
} from "../../contracts/stock.v1";

export class StockMouvementInvalide extends Error {}

export interface StockParams {
  currency: string;
  decimals: number;
  quantiteDecimals: number;
  methode: "cump" | "fifo";
}

interface Lot {
  quantite: Decimal;
  cout: Decimal;
}

/** Déroule les mouvements dans l'ordre chronologique et valorise chaque sortie. */
export function computeStock(params: StockParams, mouvements: readonly StockMouvement[]): StockV1 {
  const ordered = [...mouvements].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

  let quantite = D(0);
  let valeur = D(0);
  let sortiesValorisees = D(0);
  const lots: Lot[] = [];
  const lignes: StockLigne[] = [];

  for (const m of ordered) {
    const q = D(m.quantite);
    if (q.lte(0)) throw new StockMouvementInvalide(`Quantité non positive au ${m.at}`);

    let valeurMouvement: Decimal;

    if (m.sens === "entree") {
      if (m.cout_unitaire === null) {
        throw new StockMouvementInvalide(`Entrée sans coût unitaire au ${m.at}`);
      }
      const cout = D(m.cout_unitaire);
      valeurMouvement = q.times(cout);
      quantite = quantite.plus(q);
      valeur = valeur.plus(valeurMouvement);
      lots.push({ quantite: q, cout });
    } else {
      if (q.gt(quantite)) throw new StockMouvementInvalide(`Sortie supérieure au stock au ${m.at}`);
      if (params.methode === "cump") {
        const cump = quantite.isZero() ? D(0) : valeur.div(quantite);
        valeurMouvement = q.times(cump).negated();
      } else {
        let reste = q;
        let cout = D(0);
        while (reste.gt(0)) {
          const lot = lots[0];
          if (!lot) throw new StockMouvementInvalide(`Lots épuisés au ${m.at}`);
          const prise = Decimal.min(lot.quantite, reste);
          cout = cout.plus(prise.times(lot.cout));
          lot.quantite = lot.quantite.minus(prise);
          reste = reste.minus(prise);
          if (lot.quantite.lte(0)) lots.shift();
        }
        valeurMouvement = cout.negated();
      }
      quantite = quantite.minus(q);
      valeur = valeur.plus(valeurMouvement);
      sortiesValorisees = sortiesValorisees.plus(valeurMouvement.abs());
      if (params.methode === "cump" && quantite.isZero()) {
        valeur = D(0);
        lots.length = 0;
      }
    }

    const cump = quantite.isZero() ? D(0) : valeur.div(quantite);
    lignes.push({
      at: m.at,
      sens: m.sens,
      quantite: toFixedStr(q, params.quantiteDecimals),
      valeur_mouvement: toFixedStr(valeurMouvement, params.decimals),
      quantite_apres: toFixedStr(quantite, params.quantiteDecimals),
      valeur_apres: toFixedStr(valeur, params.decimals),
      cump: toFixedStr(cump, params.decimals),
    });
  }

  return {
    contract: "stock.v1",
    currency: params.currency,
    methode: params.methode,
    quantite_decimals: params.quantiteDecimals,
    lignes,
    totals: {
      quantite: toFixedStr(quantite, params.quantiteDecimals),
      valeur: toFixedStr(valeur, params.decimals),
      sorties_valorisees: toFixedStr(sortiesValorisees, params.decimals),
    },
  };
}

/** Variation de stock d'une période — entre dans le résultat via une écriture proposée. */
export function computeStockVariation(input: {
  currency: string;
  decimals: number;
  period: string;
  initial: string;
  final: string;
}): StockVariationV1 {
  const initial = D(input.initial);
  const final = D(input.final);
  return {
    contract: "stock_variation.v1",
    currency: input.currency,
    period: input.period,
    initial: toFixedStr(initial, input.decimals),
    final: toFixedStr(final, input.decimals),
    variation: toFixedStr(final.minus(initial), input.decimals),
  };
}

/**
 * Dépréciation de stock — la provision comble l'écart entre le coût et la
 * valeur nette de réalisation. Une reprise ne dépasse jamais le cumul constaté.
 */
export function computeStockDepreciation(input: {
  currency: string;
  decimals: number;
  at: string;
  valeurStock: string;
  valeurNette: string;
  cumulAvant: string;
}): StockDepreciationV1 {
  const stock = D(input.valeurStock);
  const nette = D(input.valeurNette);
  const cumulAvant = D(input.cumulAvant);
  const requise = Decimal.max(stock.minus(nette), D(0));
  const perte = requise.minus(cumulAvant);
  const mouvement = perte.lt(0) && perte.abs().gt(cumulAvant) ? cumulAvant.negated() : perte;

  return {
    contract: "stock_depreciation.v1",
    currency: input.currency,
    at: input.at,
    valeur_stock: toFixedStr(stock, input.decimals),
    valeur_nette: toFixedStr(nette, input.decimals),
    mouvement: toFixedStr(mouvement, input.decimals),
    cumul_apres: toFixedStr(cumulAvant.plus(mouvement), input.decimals),
  };
}
