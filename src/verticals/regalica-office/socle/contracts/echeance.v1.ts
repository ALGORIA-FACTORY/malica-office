import { z } from "zod";

const CONTRACT_VERSION = "echeance.v1" as const;

export const EcheanceV1 = z.object({
  contract: z.literal(CONTRACT_VERSION),
  jurisdiction: z.string(),
  kind: z.string(),          // ex. "TVA_MENSUELLE"
  label: z.string(),
  period: z.string(),        // "YYYY-MM"
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  legal_reference: z.string().optional(),
});
export type EcheanceV1 = z.infer<typeof EcheanceV1>;

export const EcheanceListV1 = z.array(EcheanceV1);
