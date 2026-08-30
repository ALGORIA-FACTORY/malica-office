import { z } from "zod";

const CONTRACT_VERSION = "fx.v1" as const;
const decimalString = z.string().regex(/^-?\d+(\.\d+)?$/);

export const FxRateV1 = z.object({
  base: z.string().length(3),
  quote: z.string().length(3),
  rate: decimalString,          // 1 base = rate quote
  valid_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  valid_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  source: z.string(),
});
export type FxRateV1 = z.infer<typeof FxRateV1>;

export const FxConversionV1 = z.object({
  contract: z.literal(CONTRACT_VERSION),
  amount_in: decimalString,
  currency_in: z.string().length(3),
  amount_out: decimalString,
  currency_out: z.string().length(3),
  rate_used: decimalString,
  rate_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type FxConversionV1 = z.infer<typeof FxConversionV1>;
