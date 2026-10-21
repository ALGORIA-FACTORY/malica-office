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
  /**
   * Les familles de charges du pack, traduites.
   *
   * Le libellé vient de `ref.labels`, pas de la colonne `label` de la table,
   * qui est FRANÇAISE. L'espace de noms `charge_famille` existait depuis le 24 août 2026
   * et aucun code ne le joignait : un écran en arabe affichait du français au
   * milieu de l'arabe, alors que la traduction était à côté. Le repli sur le
   * français est explicite — un libellé sans traduction s'affiche, il ne vide
   * pas l'écran.
   */
  async familles(db: Requete, packId: string, locale = "fr") {
    const { rows } = await db.query(
      `select f.code, f.ordinal, f.is_fallback, f.valid_from, f.valid_to,
              coalesce(demandee.value, francais.value, f.label) as label
         from ref_charge_familles_v f
         left join ref_labels_v demandee
           on demandee.ns = 'charge_famille' and demandee.key = f.code
          and demandee.locale = $2
         left join ref_labels_v francais
           on francais.ns = 'charge_famille' and francais.key = f.code
          and francais.locale = 'fr'
        where f.pack_version_id = $1`,
      [packId, locale],
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

  /**
   * Ce qui attend sa date, et n'entre donc dans aucun mois.
   *
   * Depuis le 5 octobre 2026, une pièce sans date lue a une période NULLE : le
   * filtre `period >= … and period <= …` d'`articles` l'écarte, et c'est voulu.
   * Mais l'écarter d'un total sans le dire reviendrait à remplacer un chiffre
   * faux par un silence — l'écran doit pouvoir nommer ce qui manque et dire
   * quel geste le débloque.
   */
  async enAttenteDeDate(db: Requete, tenantId: string) {
    const { rows } = await db.query(
      `select count(*) as articles, count(distinct a.piece_id) as pieces,
              sum(a.total_ht) as total_ht
         from piece_articles_v a
         join pieces_qui_comptent_v q on q.id = a.piece_id
        where a.tenant_id = $1 and a.period is null
          and q.document_kind <> 'facture_vente'`,
      [tenantId],
    );
    const r = (rows as Record<string, unknown>[])[0] ?? {};
    return {
      articles: Number(r["articles"] ?? 0),
      pieces: Number(r["pieces"] ?? 0),
      totalHt: decOuNul(r["total_ht"], 3),
    };
  },

  /**
   * Les articles des ACHATS du mois qui comptent (ANO-005, 21 octobre 2026).
   *
   * L'écran additionnait toutes les pièces lues : la vente, le doublon, la
   * pièce de l'espace personnel, l'avoir, la pièce pas encore confirmée —
   * « Vos charges » montrait 16 189,550 pour 8 944,600 de charges. La pièce
   * qui compte est définie une fois, en base (`pieces_qui_comptent_v`) ; une
   * charge est une pièce qui compte et qui n'est pas une vente.
   */
  async articles(db: Requete, tenantId: string, fromPeriod: string, toPeriod: string) {
    const { rows } = await db.query(
      `select a.piece_id, a.ordinal, a.designation, a.quantity, a.unit_price_ht,
              a.unit_price_ttc, a.total_ht, a.famille_code, a.famille_source, a.period,
              a.document_date, a.citation_field, a.citation_quantity,
              a.citation_unit_price_ht, a.citation_unit_price_ttc, a.citation_total_ht
         from piece_articles_v a
         join pieces_qui_comptent_v q on q.id = a.piece_id
        where a.tenant_id = $1 and a.period >= $2 and a.period <= $3
          and q.document_kind <> 'facture_vente'
        order by a.period desc, a.ordinal asc`,
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
              threshold_code, answer, answered_at, answered_side
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
        // « pme » ou « cabinet » : un « exceptionnel » dit par l'expert est un
        // avis professionnel, pas une déclaration du dirigeant.
        answeredSide: (row["answered_side"] as string | null) ?? null,
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
