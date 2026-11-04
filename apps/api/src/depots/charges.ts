/**
 * Les charges — familles, seuils d'anomalie, articles, questions.
 *
 * Les familles et les seuils viennent du pack, versionnés par date d'effet :
 * le filtre « en vigueur » n'est pas une commodité, c'est ce qui empêche de
 * lire le seuil d'un autre exercice.
 */

import { sommeDecimale } from "@malica/socle/somme-decimale";

import type { Requete } from "../db.ts";
import { exposantDuPack } from "../scan/analyse.ts";
import { dec, decOuNul, enVigueur } from "./decimal.ts";
import { conversionsDesPieces, montantConverti } from "./en-devise-du-dossier.ts";

/**
 * Les articles LUS qui sont des charges du mois (`charges_lues`) : un achat
 * qui compte, dont le cabinet n'a pas pris les montants (`source =
 * 'lecture'`), et qui n'est pas une immobilisation acquise (3 novembre 2026).
 * Une fois une écriture prise en charge (validée, ou forcée sans se lire comme
 * une facture), ce sont SES comptes qui décident ; avant, la famille de
 * l'article rangée au plan (`app.articles_immobilises`). Les articles sont lus
 * UNE fois et passés à la fonction : la vue des pièces n'est pas relue (revue
 * de #145). Une immobilisation est HT, jamais une charge du mois. `$1` est le
 * dossier.
 */
const CHARGES_LUES = `with lus as (
         select a.*, q.document_kind as kind,
                coalesce(a.document_date,
                         (select v.recue_le from pieces_v v where v.id = q.id)) as jour,
                -- La devise de la pièce, telle que son jugement l'a décidée
                -- (deviseDeLaPiece), à défaut celle de sa lecture.
                coalesce((select y.normalisation ->> 'devise' from capture.analyses y
                           where y.piece_id = a.piece_id order by y.created_at desc limit 1),
                         (select z.payload ->> 'currency' from extractions_v z
                           where z.piece_id = a.piece_id order by z.created_at desc limit 1))
                  as devise
           from piece_articles_v a
           join pieces_qui_comptent_v q on q.id = a.piece_id
          where a.tenant_id = $1 and q.source = 'lecture'
            and q.document_kind <> 'facture_vente'
       ),
       immobilises as materialized (
         select x as id
           from app.articles_immobilises($1, (
                  select coalesce(jsonb_agg(jsonb_build_object(
                           'id', i.id, 'piece_id', i.piece_id, 'pack', i.pack_version_id,
                           'famille', i.famille_code, 'kind', i.kind, 'jour', i.jour)), '[]'::jsonb)
                    from lus i)) x
       ),
       charges_lues as (
         select l.* from lus l
          where not exists (select 1 from immobilises m where m.id = l.id)
       )`;

/** La devise des livres du dossier, et son exposant (`ref.devises`). */
async function deviseDuDossier(
  db: Requete,
  tenantId: string,
): Promise<{ code: string; exposant: number }> {
  const { rows } = await db.query<{ code: string; exposant: number }>(
    `select o.currency as code, d.exposant
       from organizations_v o join ref.devises d on d.code = o.currency
      where o.id = $1`,
    [tenantId],
  );
  const d = rows[0];
  if (!d) throw new Error(`dossier introuvable, ou devise inconnue du référentiel : ${tenantId}`);
  return { code: d.code, exposant: Number(d.exposant) };
}

/**
 * Les articles lus d'une pièce en devise, dans la devise du dossier, au cours
 * de son jugement (`en-devise-du-dossier.ts`). Un article sans cours n'entre
 * dans aucun total : il est rendu à part (`sansCours`), et l'écran le compte
 * (`enAttenteDeCours`) — jamais en silence, jamais en devise étrangère.
 */
async function enDeviseDuDossier<
  T extends {
    piece_id: string;
    devise: string | null;
    total_ht: string | null;
    unit_price_ht?: string | null;
    unit_price_ttc?: string | null;
  },
>(db: Requete, tenantId: string, lignes: readonly T[]) {
  const dossier = await deviseDuDossier(db, tenantId);
  const enDevise = lignes.filter((l) => l.devise !== null && l.devise !== dossier.code);
  const conversions = await conversionsDesPieces(
    db,
    enDevise.map((l) => l.piece_id),
  );
  const converties: T[] = [];
  const sansCours: T[] = [];
  for (const l of lignes) {
    if (l.devise === null || l.devise === dossier.code) {
      converties.push(l);
      continue;
    }
    const c = conversions.get(l.piece_id);
    if (!c || c.de.code !== l.devise) {
      sansCours.push(l);
      continue;
    }
    converties.push({
      ...l,
      total_ht: montantConverti(l.total_ht, c),
      ...(l.unit_price_ht !== undefined
        ? { unit_price_ht: montantConverti(l.unit_price_ht, c) }
        : {}),
      ...(l.unit_price_ttc !== undefined
        ? { unit_price_ttc: montantConverti(l.unit_price_ttc, c) }
        : {}),
    });
  }
  return { dossier, converties, sansCours };
}

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
      // Un seuil du pack, dans la devise du pack, à son exposant (revue de #148).
      minAmount: dec(ligne["min_amount"], await exposantDuPack(db, packId)),
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
    // Forcée, la pièce a la date de l'écriture du cabinet : elle n'est pas lue ici.
    // Additionnée dans la devise du dossier : une pièce en devise sans cours
    // n'y entre pas — elle attend aussi son cours (`enAttenteDeCours`).
    const { rows } = await db.query<{
      piece_id: string;
      devise: string | null;
      total_ht: string | null;
    }>(
      `${CHARGES_LUES}
       select a.piece_id, a.devise, a.total_ht::text as total_ht
         from charges_lues a
        where a.period is null`,
      [tenantId],
    );
    const { dossier, converties, sansCours } = await enDeviseDuDossier(db, tenantId, rows);
    const totaux = converties.flatMap((l) => (l.total_ht === null ? [] : [l.total_ht]));
    /*
     * Les comptes et la somme ne portent pas sur les mêmes pièces (revue de
     * #148) : une pièce en devise sans cours attend sa date, mais son montant
     * n'est pas dans le total. Chaque compte se dit.
     */
    const sansCoursIds = new Set(sansCours.map((r) => r.piece_id));
    return {
      articles: rows.length,
      pieces: new Set(rows.map((r) => r.piece_id)).size,
      totalHt: totaux.length === 0 ? null : sommeDecimale(totaux, dossier.exposant),
      piecesSansCours: sansCoursIds.size,
    };
  },

  /**
   * Ce qui attend son cours de change : les articles lus d'une pièce en devise
   * dont le jugement n'a trouvé aucun cours (31 octobre 2026). Ils n'entrent
   * dans aucun total — un montant en euros ne s'additionne pas à des dinars —,
   * et l'écran le dit, comme ce qui attend sa date.
   */
  async enAttenteDeCours(db: Requete, tenantId: string) {
    const { rows } = await db.query<{
      piece_id: string;
      devise: string | null;
      total_ht: string | null;
    }>(
      `${CHARGES_LUES}
       select a.piece_id, a.devise, a.total_ht::text as total_ht from charges_lues a`,
      [tenantId],
    );
    const { sansCours } = await enDeviseDuDossier(db, tenantId, rows);
    return {
      articles: sansCours.length,
      pieces: new Set(sansCours.map((r) => r.piece_id)).size,
      devises: [...new Set(sansCours.flatMap((r) => (r.devise ? [r.devise] : [])))].sort(),
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
      `${CHARGES_LUES}
       select * from (
         select a.piece_id, a.ordinal, a.designation, a.quantity, a.unit_price_ht::text,
                a.unit_price_ttc::text, a.total_ht::text, a.devise, a.famille_code,
                a.famille_source, a.period,
                a.document_date, a.citation_field, a.citation_quantity,
                a.citation_unit_price_ht, a.citation_unit_price_ttc, a.citation_total_ht,
                'lecture' as source
           from charges_lues a
         union all
         -- Prise en charge (1er novembre 2026) : la charge est ce que le
         -- cabinet a inscrit en base, au mois de son écriture, rangée dans sa
         -- famille par le même résolveur que les articles lus — le compte
         -- d'abord, puis le libellé. La PME y lit l'émetteur, pas l'écriture.
         select q.id, l.ordinal, coalesce(app.emetteur_dit(q.id), x.payload ->> 'issuer', ''),
                null::numeric, null::text, null::text, l.montant::text, null::text, l.famille_code,
                l.famille_source, to_char(l.date_ecriture, 'YYYY-MM'), l.date_ecriture,
                null, null, null, null, null, 'cabinet'
           from pieces_qui_comptent_v q
           cross join lateral app.charges_prises_en_charge(q.id) l
           left join lateral (select z.payload from extractions_v z where z.piece_id = q.id
                               order by z.created_at desc limit 1) x on true
          where q.tenant_id = $1 and q.source = 'cabinet'
            and q.document_kind <> 'facture_vente'
       ) a
       where a.period >= $2 and a.period <= $3
       order by a.period desc, a.ordinal asc`,
      [tenantId, fromPeriod, toPeriod],
    );
    // Une pièce en devise, convertie au cours de son jugement ; sans cours,
    // hors du total, et comptée à part (`enAttenteDeCours`).
    const { dossier, converties } = await enDeviseDuDossier(
      db,
      tenantId,
      rows as Array<{
        piece_id: string;
        devise: string | null;
        total_ht: string | null;
        unit_price_ht: string | null;
        unit_price_ttc: string | null;
      }>,
    );
    return converties.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        pieceId: row["piece_id"] as string,
        ordinal: Number(row["ordinal"] ?? 0),
        designation: row["designation"] as string,
        quantity: decOuNul(row["quantity"], 3),
        unitPriceHt: decOuNul(row["unit_price_ht"], dossier.exposant),
        unitPriceTtc: decOuNul(row["unit_price_ttc"], dossier.exposant),
        totalHt: decOuNul(row["total_ht"], dossier.exposant),
        familleCode: row["famille_code"] as string,
        familleSource: (row["famille_source"] as string) ?? "fallback",
        period: row["period"] as string,
        documentDate: (row["document_date"] as string | null) ?? null,
        citationField: (row["citation_field"] as string | null) ?? null,
        citationQuantity: (row["citation_quantity"] as string | null) ?? null,
        citationUnitPriceHt: (row["citation_unit_price_ht"] as string | null) ?? null,
        citationUnitPriceTtc: (row["citation_unit_price_ttc"] as string | null) ?? null,
        citationTotalHt: (row["citation_total_ht"] as string | null) ?? null,
        source: row["source"] as "lecture" | "cabinet",
      };
    });
  },

  async questions(db: Requete, tenantId: string) {
    const dossier = await deviseDuDossier(db, tenantId);
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
        // Des montants du dossier, à l'exposant de sa devise (revue de #148).
        observed: dec(row["observed"], dossier.exposant),
        baseline: dec(row["baseline"], dossier.exposant),
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
