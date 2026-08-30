import { supabase } from "@/integrations/supabase/client";

import { throwIf } from "./errors";
import type {
  AnomalyThresholdRow,
  ChargeFamille,
  ChargeQuestionRow,
  ChargesRepository,
  PieceArticle,
} from "../../ports/repositories";

function dec(v: unknown, decimals = 3): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v;
  return Number(v).toFixed(decimals);
}

const today = () => new Date().toISOString().slice(0, 10);

function inForce<T extends { valid_from: unknown; valid_to: unknown }>(rows: T[]): T[] {
  const d = today();
  return rows.filter(
    (r) => (r.valid_from as string) <= d && (!r.valid_to || (r.valid_to as string) >= d),
  );
}

export function createSupabaseChargesRepository(): ChargesRepository {
  return {
    async familles(packId: string): Promise<ChargeFamille[]> {
      const { data, error } = await supabase
        .from("ref_charge_familles_v")
        .select("code, label, ordinal, is_fallback, valid_from, valid_to")
        .eq("pack_version_id", packId);
      throwIf(error, "Familles de charges");
      return inForce(data ?? [])
        .map((r) => ({
          code: r.code as string,
          label: r.label as string,
          ordinal: Number(r.ordinal ?? 999),
          isFallback: Boolean(r.is_fallback),
        }))
        .sort((a, b) => a.ordinal - b.ordinal);
    },

    async anomalyThreshold(packId: string, code: string): Promise<AnomalyThresholdRow | null> {
      const { data, error } = await supabase
        .from("ref_anomaly_thresholds_v")
        .select("code, min_periods, deviation_ratio, min_amount, valid_from, valid_to")
        .eq("pack_version_id", packId)
        .eq("code", code);
      throwIf(error, "Seuil d'anomalie");
      const row = inForce(data ?? [])[0];
      if (!row) return null;
      return {
        code: row.code as string,
        minPeriods: Number(row.min_periods),
        deviationRatio: dec(row.deviation_ratio, 4) ?? "0",
        minAmount: dec(row.min_amount, 3) ?? "0",
      };
    },

    async articles(tenantId: string, fromPeriod: string, toPeriod: string): Promise<PieceArticle[]> {
      const { data, error } = await supabase
        .from("piece_articles_v")
        .select(
          "piece_id, ordinal, designation, quantity, unit_price_ht, unit_price_ttc, total_ht, famille_code, famille_source, period, document_date, citation_field, citation_quantity, citation_unit_price_ht, citation_unit_price_ttc, citation_total_ht",
        )
        .eq("tenant_id", tenantId)
        .gte("period", fromPeriod)
        .lte("period", toPeriod)
        .order("period", { ascending: false })
        .order("ordinal", { ascending: true });
      throwIf(error, "Articles des pièces");
      return (data ?? []).map((r) => ({
        pieceId: r.piece_id as string,
        ordinal: Number(r.ordinal ?? 0),
        designation: r.designation as string,
        quantity: dec(r.quantity, 3),
        unitPriceHt: dec(r.unit_price_ht, 3),
        unitPriceTtc: dec(r.unit_price_ttc, 3),
        totalHt: dec(r.total_ht, 3),
        familleCode: r.famille_code as string,
        familleSource: (r.famille_source as string) ?? "fallback",
        period: r.period as string,
        documentDate: (r.document_date as string | null) ?? null,
        citationField: (r.citation_field as string | null) ?? null,
        citationQuantity: (r.citation_quantity as string | null) ?? null,
        citationUnitPriceHt: (r.citation_unit_price_ht as string | null) ?? null,
        citationUnitPriceTtc: (r.citation_unit_price_ttc as string | null) ?? null,
        citationTotalHt: (r.citation_total_ht as string | null) ?? null,
      }));
    },

    async questions(tenantId: string): Promise<ChargeQuestionRow[]> {
      const { data, error } = await supabase
        .from("charge_questions_v")
        .select(
          "id, period, famille_code, observed, baseline, deviation_ratio, threshold_code, answer, answered_at",
        )
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false });
      throwIf(error, "Questions de charges");
      return (data ?? []).map((r) => ({
        id: r.id as string,
        period: r.period as string,
        familleCode: r.famille_code as string,
        observed: dec(r.observed, 3) ?? "0",
        baseline: dec(r.baseline, 3) ?? "0",
        deviationRatio: dec(r.deviation_ratio, 4) ?? "0",
        thresholdCode: r.threshold_code as string,
        answer: (r.answer as ChargeQuestionRow["answer"]) ?? null,
        answeredAt: (r.answered_at as string | null) ?? null,
      }));
    },

    async answer(input): Promise<string> {
      const { data, error } = await supabase.rpc("charge_question_answer", {
        p_tenant: input.tenantId,
        p_period: input.period,
        p_famille: input.familleCode,
        // Les montants restent des chaînes décimales jusqu'à la base : aucun
        // passage par un flottant JS (R1).
        p_observed: input.observed as unknown as number,
        p_baseline: input.baseline as unknown as number,
        p_ratio: input.deviationRatio as unknown as number,
        p_threshold: input.thresholdCode,
        p_pack: input.packVersionId,
        p_answer: input.answer,
      });
      throwIf(error, "Réponse à la question de charges");
      return data as unknown as string;
    },
  };
}
