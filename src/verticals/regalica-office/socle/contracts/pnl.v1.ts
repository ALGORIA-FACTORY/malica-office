import { z } from "zod";

const CONTRACT_VERSION = "pnl.v1" as const;
const decimalString = z.string().regex(/^-?\d+(\.\d+)?$/);

export const PnlV1 = z.object({
  contract: z.literal(CONTRACT_VERSION),
  period: z.string().regex(/^\d{4}-\d{2}$/),
  currency: z.string().length(3),
  produits: decimalString,
  charges: decimalString,
  resultat: decimalString,
  by_account: z.array(z.object({
    account_code: z.string(),
    label: z.string(),
    debit: decimalString,
    credit: decimalString,
    solde: decimalString,
  })),
});
export type PnlV1 = z.infer<typeof PnlV1>;
