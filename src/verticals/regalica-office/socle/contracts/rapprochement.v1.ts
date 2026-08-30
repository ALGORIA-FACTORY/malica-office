import { z } from "zod";

const decimalString = z.string().regex(/^-?\d+(\.\d+)?$/);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Une ligne de relevé bancaire importée telle quelle. */
export const BankLine = z.object({
  id: z.string(),
  at: isoDate,
  label: z.string(),
  /** > 0 = crédit reçu ; < 0 = débit payé. */
  montant: decimalString,
  reference: z.string().nullable(),
});
export type BankLine = z.infer<typeof BankLine>;

/** Une ligne comptable candidate au lettrage. */
export const BookLine = z.object({
  id: z.string(),
  at: isoDate,
  label: z.string(),
  montant: decimalString,
  reference: z.string().nullable(),
});
export type BookLine = z.infer<typeof BookLine>;

export const RapprochementPaire = z.object({
  bank_id: z.string(),
  book_id: z.string(),
  /** Score déterministe 0..100 — montant, date, référence. Aucun modèle. */
  score: z.number().int().min(0).max(100),
  ecart_montant: decimalString,
  ecart_jours: z.number().int(),
  reference_exacte: z.boolean(),
});
export type RapprochementPaire = z.infer<typeof RapprochementPaire>;

export const RapprochementV1 = z.object({
  contract: z.literal("rapprochement.v1"),
  currency: z.string().length(3),
  /** Tolérances lues au pack, jamais en dur. */
  tolerance_jours: z.number().int().min(0),
  tolerance_montant: decimalString,
  paires: z.array(RapprochementPaire),
  bank_orphelines: z.array(z.string()),
  book_orphelines: z.array(z.string()),
  totals: z.object({
    bank: decimalString,
    book: decimalString,
    ecart: decimalString,
  }),
});
export type RapprochementV1 = z.infer<typeof RapprochementV1>;
