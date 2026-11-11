/**
 * Le contrat d'échéance — la forme d'une date limite fiscale ou déclarative.
 *
 * Une échéance porte sa juridiction, sa nature (par exemple une TVA mensuelle), son
 * libellé, la période concernée, la date limite et, si on la connaît, sa référence légale.
 * Utilisé par le moteur `engines/echeance` (`computeEcheances`), qui en dresse la
 * liste pour une période.
 */
import { z } from "zod";

const CONTRACT_VERSION = "echeance.v1" as const;

export const EcheanceV1 = z.object({
  contract: z.literal(CONTRACT_VERSION),
  jurisdiction: z.string(),
  kind: z.string(), // ex. "TVA_MENSUELLE"
  label: z.string(),
  period: z.string(), // "YYYY-MM"
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  legal_reference: z.string().optional(),
});
export type EcheanceV1 = z.infer<typeof EcheanceV1>;

export const EcheanceListV1 = z.array(EcheanceV1);
