import { z } from "zod";

const decimalString = z.string().regex(/^-?\d+(\.\d+)?$/);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Un mouvement d'article : entrée valorisée, sortie en quantité. */
export const StockMouvement = z.object({
  at: isoDate,
  sens: z.enum(["entree", "sortie"]),
  quantite: decimalString,
  /** Coût unitaire — obligatoire à l'entrée, ignoré à la sortie. */
  cout_unitaire: decimalString.nullable(),
  reference: z.string().nullable(),
});
export type StockMouvement = z.infer<typeof StockMouvement>;

export const StockLigne = z.object({
  at: isoDate,
  sens: z.enum(["entree", "sortie"]),
  quantite: decimalString,
  valeur_mouvement: decimalString,
  quantite_apres: decimalString,
  valeur_apres: decimalString,
  cump: decimalString,
});
export type StockLigne = z.infer<typeof StockLigne>;

export const StockV1 = z.object({
  contract: z.literal("stock.v1"),
  currency: z.string().length(3),
  /** Méthode de valorisation lue au pack de juridiction. */
  methode: z.enum(["cump", "fifo"]),
  quantite_decimals: z.number().int().min(0).max(6),
  lignes: z.array(StockLigne),
  totals: z.object({
    quantite: decimalString,
    valeur: decimalString,
    sorties_valorisees: decimalString,
  }),
});
export type StockV1 = z.infer<typeof StockV1>;

/** Variation de stock d'une période : stock final - stock initial. */
export const StockVariationV1 = z.object({
  contract: z.literal("stock_variation.v1"),
  currency: z.string().length(3),
  period: z.string().regex(/^\d{4}-\d{2}$/),
  initial: decimalString,
  final: decimalString,
  variation: decimalString,
});
export type StockVariationV1 = z.infer<typeof StockVariationV1>;

/** Dépréciation d'un stock : valeur nette de réalisation inférieure au coût. */
export const StockDepreciationV1 = z.object({
  contract: z.literal("stock_depreciation.v1"),
  currency: z.string().length(3),
  at: isoDate,
  valeur_stock: decimalString,
  valeur_nette: decimalString,
  mouvement: decimalString,
  cumul_apres: decimalString,
});
export type StockDepreciationV1 = z.infer<typeof StockDepreciationV1>;
