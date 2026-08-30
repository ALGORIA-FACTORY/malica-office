import { z } from "zod";

const CONTRACT_VERSION = "amortissement.v1" as const;
const decimalString = z.string().regex(/^-?\d+(\.\d+)?$/);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Une dotation annuelle : base, taux appliqué, dotation, cumul, VNC de fin. */
export const AmortissementLigne = z.object({
  exercice: z.number().int(),
  from: isoDate,
  to: isoDate,
  months: z.number().int().min(0).max(12),
  base: decimalString,
  taux: decimalString,
  dotation: decimalString,
  cumul: decimalString,
  vnc: decimalString,
});
export type AmortissementLigne = z.infer<typeof AmortissementLigne>;

export const AmortissementV1 = z.object({
  contract: z.literal(CONTRACT_VERSION),
  currency: z.string().length(3),
  method: z.enum(["lineaire", "degressif"]),
  /** Durée d'usage en années — lue au pack, jamais en dur. */
  duree_annees: z.number().int().positive(),
  coefficient: decimalString,
  valeur_brute: decimalString,
  valeur_residuelle: decimalString,
  mise_en_service: isoDate,
  lignes: z.array(AmortissementLigne),
  totals: z.object({
    dotations: decimalString,
    vnc_finale: decimalString,
  }),
});
export type AmortissementV1 = z.infer<typeof AmortissementV1>;

/** Dépréciation (ou reprise) constatée à une date, adossée à un indice de perte. */
export const DepreciationV1 = z.object({
  contract: z.literal("depreciation.v1"),
  currency: z.string().length(3),
  at: isoDate,
  vnc: decimalString,
  valeur_recouvrable: decimalString,
  /** > 0 = dépréciation à constater ; < 0 = reprise. */
  mouvement: decimalString,
  cumul_apres: decimalString,
});
export type DepreciationV1 = z.infer<typeof DepreciationV1>;

/** Cession : prix, VNC à la date, plus ou moins-value. */
export const CessionV1 = z.object({
  contract: z.literal("cession.v1"),
  currency: z.string().length(3),
  at: isoDate,
  prix: decimalString,
  vnc: decimalString,
  resultat: decimalString,
});
export type CessionV1 = z.infer<typeof CessionV1>;
