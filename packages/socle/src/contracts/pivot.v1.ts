/**
 * pivot.v1 — écriture comptable proposée par le socle.
 * Contient les lignes débit/crédit équilibrées, le feu de confiance et les motifs.
 */
import { z } from "zod";

const CONTRACT_VERSION = "pivot.v1" as const;

const decimalString = z.string().regex(/^-?\d+(\.\d+)?$/);

export const TrafficLight = z.enum(["VERT", "ORANGE", "ROUGE"]);
export type TrafficLight = z.infer<typeof TrafficLight>;

export const MotifCode = z.enum([
  "OK",
  "UNBALANCED",
  "MISSING_TAX_RATE",
  "TAX_RATE_MISMATCH",
  "LOW_CONFIDENCE",
  "MISSING_ACCOUNT_MAPPING",
  "ROUNDING_WITHIN_TOLERANCE",
  "CURRENCY_UNSUPPORTED",
  // Résidu de pied de facture : TTC imprimé − (HT + TVA + droits déclarés).
  "RESIDUAL_MATCHED_PACK_CHARGE",
  "RESIDUAL_UNEXPLAINED",
]);
export type MotifCode = z.infer<typeof MotifCode>;

export const Motif = z.object({
  code: MotifCode,
  severity: z.enum(["info", "warn", "block"]),
  message: z.string(),
  detail: z.record(z.string(), z.unknown()).optional(),
});
export type Motif = z.infer<typeof Motif>;

export const JournalLineV1 = z.object({
  account_code: z.string().min(1),
  label: z.string(),
  debit: decimalString, // "0" si crédit
  credit: decimalString, // "0" si débit
  /**
   * Le code de taxe de la ligne, pour les lignes de TVA. Nul ailleurs.
   *
   * Ajouté le 11 octobre 2026 : le moteur posait une seule ligne de TVA, somme
   * de tous les taux, et la proposition la timbrait du code de la PREMIÈRE
   * ligne de la pièce. Une facture à 7 % et 19 % voyait donc toute sa TVA
   * déclarée à un seul taux — écriture équilibrée, ventilation fausse.
   *
   * Facultatif par compatibilité : les pivots écrits avant ce jour n'en
   * portent pas.
   */
  tax_code: z.string().min(1).nullable().optional(),
});
export type JournalLineV1 = z.infer<typeof JournalLineV1>;

export const PivotV1 = z.object({
  contract: z.literal(CONTRACT_VERSION),
  source_item_id: z.string().uuid().nullable(),
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period: z.string().regex(/^\d{4}-\d{2}$/),
  currency: z.string().length(3),
  lines: z.array(JournalLineV1).min(2),
  totals: z.object({
    debit: decimalString,
    credit: decimalString,
  }),
  traffic_light: TrafficLight,
  motifs: z.array(Motif),
  // approuvable côté moteur : false ⇒ aucune approbation possible, quel que soit le rôle.
  approvable: z.boolean(),
});
export type PivotV1 = z.infer<typeof PivotV1>;
