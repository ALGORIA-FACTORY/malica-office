/**
 * La banque — comptes, relevés, rapprochement, lettrage.
 *
 * Les gestes qui engagent — comptabiliser, lettrer, délettrer — sont des
 * fonctions de la base. Elles portent l'écart, le score et le motif ; les
 * refaire ici les sortirait de la transaction qui les rend atomiques.
 *
 * Signatures relues avant écriture : `banque_book_lignes` rend une TABLE,
 * `banque_lettrer` et `banque_delettrer` rendent du `jsonb`. On extrait, on
 * ne suppose pas.
 */

import { createHash } from "node:crypto";

import type { Requete } from "../db.ts";
import { dec } from "./decimal.ts";

const FORME_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Le lot d'import est un identifiant unique en base. Un appelant qui nomme
 * son lot autrement (« relevé-2026-09 ») obtient le même identifiant à
 * chaque fois : le nom reste idempotent, et la base n'a pas à refuser.
 */
function lotEnUuid(batchId: string): string {
  const lot = batchId.trim();
  if (FORME_UUID.test(lot)) return lot.toLowerCase();
  const h = createHash("sha256").update(`malica.banque.lot:${lot}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export const banque = {
  async listAccounts(db: Requete, tenantId: string) {
    const { rows } = await db.query(
      `select id, tenant_id, label, iban, devise, account_code, active
         from banque_comptes_v where tenant_id = $1 order by label`,
      [tenantId],
    );
    return (rows as Record<string, unknown>[]).map((r) => ({
      id: r["id"] as string,
      tenantId: r["tenant_id"] as string,
      label: r["label"] as string,
      iban: (r["iban"] as string | null) ?? null,
      devise: r["devise"] as string,
      accountCode: r["account_code"] as string,
      active: Boolean(r["active"]),
    }));
  },

  async createAccount(
    db: Requete,
    input: {
      tenantId: string;
      entityId: string | null;
      label: string;
      iban?: string | null;
      devise: string;
      accountCode: string;
    },
  ): Promise<string> {
    const { rows } = await db.query<{ id: string }>(
      `insert into banque_comptes_v (tenant_id, entity_id, label, iban, devise, account_code)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [
        input.tenantId,
        input.entityId,
        input.label,
        input.iban ?? null,
        input.devise,
        input.accountCode,
      ],
    );
    return rows[0]!.id;
  },

  async lines(db: Requete, tenantId: string, compteId: string) {
    const { rows } = await db.query(
      `select id, compte_id, at, label, montant, reference, status
         from banque_lignes_v where tenant_id = $1 and compte_id = $2 order by at`,
      [tenantId, compteId],
    );
    return (rows as Record<string, unknown>[]).map((r) => ({
      id: r["id"] as string,
      compteId: r["compte_id"] as string,
      at: r["at"] as string,
      label: r["label"] as string,
      montant: dec(r["montant"]),
      reference: (r["reference"] as string | null) ?? null,
      status: r["status"] as string,
    }));
  },

  async importLines(
    db: Requete,
    input: {
      tenantId: string;
      compteId: string;
      batchId: string;
      lines: Array<{
        at: string;
        label: string;
        montant: string;
        reference: string | null;
        idempotencyKey: string;
      }>;
    },
  ): Promise<number> {
    if (input.lines.length === 0) return 0;

    // `unnest` insère le lot en une seule instruction, et la clé
    // d'idempotence écarte les lignes déjà importées : réimporter le même
    // relevé n'en duplique aucune. `montant` reste une chaîne décimale jusqu'au
    // type `numeric` — aucun flottant sur le chemin (R1).
    const { rows } = await db.query(
      `insert into banque_lignes_v
         (tenant_id, compte_id, at, label, montant, reference, import_batch, idempotency_key)
       select $1, $2, u.at::date, u.label, u.montant::numeric, u.reference, $3, u.cle
         from unnest($4::date[], $5::text[], $6::text[], $7::text[], $8::text[])
              as u(at, label, montant, reference, cle)
       on conflict (tenant_id, idempotency_key) do nothing
       returning id`,
      [
        input.tenantId,
        input.compteId,
        lotEnUuid(input.batchId),
        input.lines.map((l) => l.at),
        input.lines.map((l) => l.label),
        input.lines.map((l) => l.montant),
        input.lines.map((l) => l.reference),
        input.lines.map((l) => l.idempotencyKey),
      ],
    );
    return rows.length;
  },

  async bookLines(
    db: Requete,
    input: { tenantId: string; accountCode: string; from: string; to: string },
  ) {
    const { rows } = await db.query(`select * from public.banque_book_lignes($1, $2, $3, $4)`, [
      input.tenantId,
      input.accountCode,
      input.from,
      input.to,
    ]);
    return (rows as Record<string, unknown>[]).map((r) => ({
      id: r["ecriture_id"] as string,
      pieceId: (r["piece_id"] as string | null) ?? null,
      at: r["date_ecriture"] as string,
      journal: (r["journal"] as string | null) ?? "",
      label: (r["libelle"] as string | null) ?? "",
      // Débit d'un compte de trésorerie = encaissement ; crédit = décaissement.
      montant: dec(r["montant"]),
      reference: (r["reference"] as string | null) ?? null,
      lettree: Boolean(r["lettree"]),
    }));
  },

  async etat(db: Requete, tenantId: string) {
    const { rows } = await db.query(
      `select ligne_id, ecriture_id, active, score, ecart_montant, ecart_jours,
              reference_exacte, updated_at
         from banque_lettrage_etat_v where tenant_id = $1`,
      [tenantId],
    );
    return (rows as Record<string, unknown>[]).map((r) => ({
      ligneId: r["ligne_id"] as string,
      ecritureId: r["ecriture_id"] as string,
      active: Boolean(r["active"]),
      score: Number(r["score"]),
      ecartMontant: dec(r["ecart_montant"]),
      ecartJours: Number(r["ecart_jours"]),
      referenceExacte: Boolean(r["reference_exacte"]),
      updatedAt: r["updated_at"] as string,
    }));
  },

  async lettrages(db: Requete, tenantId: string) {
    const { rows } = await db.query(
      `select id, ligne_id, ecriture_id, action, seq, score, ecart_montant,
              ecart_jours, reference_exacte, motif_id, note, created_at
         from banque_lettrages_v where tenant_id = $1
        order by created_at desc limit 200`,
      [tenantId],
    );
    return (rows as Record<string, unknown>[]).map((r) => ({
      id: r["id"] as string,
      ligneId: r["ligne_id"] as string,
      ecritureId: r["ecriture_id"] as string,
      action: r["action"] as string,
      seq: Number(r["seq"]),
      score: Number(r["score"]),
      ecartMontant: dec(r["ecart_montant"]),
      ecartJours: Number(r["ecart_jours"]),
      referenceExacte: Boolean(r["reference_exacte"]),
      motifId: (r["motif_id"] as string | null) ?? null,
      note: (r["note"] as string | null) ?? null,
      createdAt: r["created_at"] as string,
    }));
  },

  async lettrer(
    db: Requete,
    input: {
      ligneId: string;
      ecritureId: string;
      score: number;
      ecartMontant: string;
      ecartJours: number;
      referenceExacte: boolean;
      packVersionId: string;
    },
  ): Promise<string> {
    const { rows } = await db.query<{ id: string | null }>(
      `select public.banque_lettrer($1, $2, $3::smallint, $4::numeric, $5::smallint, $6, $7)
                ->> 'lettrage_id' as id`,
      [
        input.ligneId,
        input.ecritureId,
        input.score,
        input.ecartMontant,
        input.ecartJours,
        input.referenceExacte,
        input.packVersionId,
      ],
    );
    return rows[0]?.id ?? "";
  },

  async delettrer(
    db: Requete,
    input: { ligneId: string; motifId: string; note?: string | null },
  ): Promise<string> {
    const { rows } = await db.query<{ id: string | null }>(
      `select public.banque_delettrer($1, $2, $3) ->> 'lettrage_id' as id`,
      [input.ligneId, input.motifId, input.note ?? null],
    );
    return rows[0]?.id ?? "";
  },

  async audit(db: Requete, tenantId: string) {
    const { rows } = await db.query(
      `select id, action, actor, at, motif_id, payload
         from event_log_v where tenant_id = $1 and object_schema = 'banque'
        order by at desc limit 100`,
      [tenantId],
    );
    return (rows as Record<string, unknown>[]).map((r) => ({
      id: r["id"] as string,
      action: r["action"] as string,
      actor: (r["actor"] as string | null) ?? null,
      at: r["at"] as string,
      motifId: (r["motif_id"] as string | null) ?? null,
      payload: r["payload"],
    }));
  },

  async setLineStatus(db: Requete, ligneId: string, status: string): Promise<void> {
    await db.query(`update banque_lignes_v set status = $2 where id = $1`, [ligneId, status]);
  },
};
