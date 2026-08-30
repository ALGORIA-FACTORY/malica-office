/**
 * Les charges — familles, seuils d'anomalie, articles, questions.
 *
 * Les familles et les seuils viennent du pack, versionnés par date d'effet :
 * le filtre « en vigueur » n'est pas une commodité, c'est ce qui empêche de
 * lire le seuil d'un autre exercice.
 */

import type { Requete } from "../db.ts";
import { dec, decOuNul, enVigueur } from "./decimal.ts";

export const charges = {
  async familles(db: Requete, packId: string) {
    const { rows } = await db.query(
      `select code, label, ordinal, is_fallback, valid_from, valid_to
         from ref_charge_familles_v where pack_version_id = $1`,
      [packId],
    );
    return enVigueur(rows as Record<string, unknown>[])
      .map((r) => ({
        code: r["code"] as string,
        label: r["label"] as string,
        ordinal: Number(r["ordinal"] ?? 999),
        isFallback: Boolean(r["is_fallback"]),
      }))
      .sort((a, b) => a.ordinal - b.ordinal);
  },

  async anomalyThreshold(db: Requete, packId: string, code: string) {
    const { rows } = await db.query(
      `select code, min_periods, deviation_ratio, min_amount, valid_from, valid_to
         from ref_anomaly_thresholds_v where pack_version_id = $1 and code = $2`,
      [packId, code],
    );
    const ligne = enVigueur(rows as Record<string, unknown>[])[0];
    if (!ligne) return null;
    return {
      code: ligne["code"] as string,
      minPeriods: Number(ligne["min_periods"]),
      deviationRatio: dec(ligne["deviation_ratio"], 4),
      minAmount: dec(ligne["min_amount"], 3),
    };
  },

  async articles(db: Requete, tenantId: string, fromPeriod: string, toPeriod: string) {
    const { rows } = await db.query(
      `select piece_id, ordinal, designation, quantity, unit_price_ht, unit_price_ttc,
              total_ht, famille_code, famille_source, period, document_date,
              citation_field, citation_quantity, citation_unit_price_ht,
              citation_unit_price_ttc, citation_total_ht
         from piece_articles_v
        where tenant_id = $1 and period >= $2 and period <= $3
        order by period desc, ordinal asc`,
      [tenantId, fromPeriod, toPeriod],
    );
    return rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        pieceId: row["piece_id"] as string,
        ordinal: Number(row["ordinal"] ?? 0),
        designation: row["designation"] as string,
        quantity: decOuNul(row["quantity"], 3),
        unitPriceHt: decOuNul(row["unit_price_ht"], 3),
        unitPriceTtc: decOuNul(row["unit_price_ttc"], 3),
        totalHt: decOuNul(row["total_ht"], 3),
        familleCode: row["famille_code"] as string,
        familleSource: (row["famille_source"] as string) ?? "fallback",
        period: row["period"] as string,
        documentDate: (row["document_date"] as string | null) ?? null,
        citationField: (row["citation_field"] as string | null) ?? null,
        citationQuantity: (row["citation_quantity"] as string | null) ?? null,
        citationUnitPriceHt: (row["citation_unit_price_ht"] as string | null) ?? null,
        citationUnitPriceTtc: (row["citation_unit_price_ttc"] as string | null) ?? null,
        citationTotalHt: (row["citation_total_ht"] as string | null) ?? null,
      };
    });
  },

  async questions(db: Requete, tenantId: string) {
    const { rows } = await db.query(
      `select id, period, famille_code, observed, baseline, deviation_ratio,
              threshold_code, answer, answered_at
         from charge_questions_v where tenant_id = $1 order by created_at desc`,
      [tenantId],
    );
    return rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        id: row["id"] as string,
        period: row["period"] as string,
        familleCode: row["famille_code"] as string,
        observed: dec(row["observed"], 3),
        baseline: dec(row["baseline"], 3),
        deviationRatio: dec(row["deviation_ratio"], 4),
        thresholdCode: row["threshold_code"] as string,
        answer: (row["answer"] as string | null) ?? null,
        answeredAt: (row["answered_at"] as string | null) ?? null,
      };
    });
  },

  async answer(
    db: Requete,
    input: {
      tenantId: string;
      period: string;
      familleCode: string;
      observed: string;
      baseline: string;
      deviationRatio: string;
      thresholdCode: string;
      packVersionId: string;
      answer: string;
    },
  ): Promise<string> {
    // Les montants restent des CHAÎNES décimales jusqu'à la base : aucun passage
    // par un flottant JavaScript (R1). `pg` les transmet telles quelles au type
    // `numeric`, ce que le client précédent ne pouvait pas garantir.
    const { rows } = await db.query<{ id: string }>(
      `select public.charge_question_answer($1, $2, $3, $4, $5, $6, $7, $8, $9) as id`,
      [
        input.tenantId,
        input.period,
        input.familleCode,
        input.observed,
        input.baseline,
        input.deviationRatio,
        input.thresholdCode,
        input.packVersionId,
        input.answer,
      ],
    );
    return rows[0]!.id;
  },
};
