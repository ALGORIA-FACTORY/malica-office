import { z } from "zod";

const CONTRACT_VERSION = "tva.v1" as const;
const decimalString = z.string().regex(/^-?\d+(\.\d+)?$/);

export const TvaBucket = z.object({
  tax_code: z.string(),
  rate: decimalString,
  base: decimalString,
  vat: decimalString,
});

export const TvaV1 = z.object({
  contract: z.literal(CONTRACT_VERSION),
  period: z.string().regex(/^\d{4}-\d{2}$/),
  currency: z.string().length(3),
  collectee: z.array(TvaBucket),
  deductible: z.array(TvaBucket),
  totals: z.object({
    collectee: decimalString,
    deductible: decimalString,
    solde: decimalString, // collectée - déductible ; >0 = à payer
  }),
  refused: z.array(z.object({ reason: z.string(), item_id: z.string().nullable() })).default([]),
});
export type TvaV1 = z.infer<typeof TvaV1>;
