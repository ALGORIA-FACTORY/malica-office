/**
 * Le circuit ne se contourne pas (revue indépendante de #146, P2 et P3).
 *
 * Chaque épreuve rejoue un contournement relevé par la revue, sous l'identité
 * de la personne, par la porte qu'elle a réellement en main (RPC ou SQL brut
 * sous `authenticated`) :
 *   - un siège reprend une pièce que le comptable a retournée (un « Garder »
 *     de fait), y compris en se disant « par accord » ;
 *   - un membre écrit des notifications à la place de la base ;
 *   - le cabinet est prévenu d'une pièce qu'on ne lui a jamais envoyée ;
 *   - un siège lit les pièces prises en charge d'un autre ;
 *   - la chaîne des versions d'une autre société se lit par son identifiant ;
 *   - un siège se fait passer pour un remplacement de photo pour transmettre ;
 *   - les droits du Socle et ceux de la base divergent.
 *
 *   node --experimental-strip-types --test src/le-circuit-ne-se-contourne-pas.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { DROITS } from "@malica/socle/ports/repositories";

import { creerCompte } from "./auth.ts";
import {
  BASE_CONFIGUREE,
  monterUneSociete,
  type Personne,
  type SocieteDEssai,
} from "./circuit-d-essai.ts";
import { fermerLePool, sousIdentiteDuServeur } from "./db.ts";

describe("le circuit ne se contourne pas", { skip: !BASE_CONFIGUREE }, () => {
  let s: SocieteDEssai;

  before(async () => {
    s = await monterUneSociete(`contourne-${Date.now()}`);
  });

  after(async () => {
    try {
      await s?.fermer();
    } finally {
      await fermerLePool();
    }
  });

  const sql = (qui: Personne | string, q: string, args: unknown[] = []) =>
    sousIdentiteDuServeur(
      qui in (s?.gens ?? {}) ? s.gens[qui as Personne].id : qui,
      async (db) => (await db.query(q, args)).rows,
    );

  /** Une pièce de Sami, passée chez le comptable par Amel. */
  const chezLeComptable = async () => {
    const id = await s.deposer("sami", "entite");
    await s.lire("sami", id);
    await s.fait("sami", "collab.envoyer", id);
    await s.fait("amel", "collab.envoyer", id);
    return id;
  };

  it("un siège ne reprend pas la pièce que le comptable a retournée : elle revient par le propriétaire", async () => {
    const id = await chezLeComptable();
    await s.fait("expert", "supervision.retourner", {
      pieceId: id,
      motifId: s.motifs["piece_illisible"],
      note: "Illisible",
    });
    await assert.rejects(
      s.fait("sami", "collab.setPieceVis", id, "entite"),
      /refus\.envoi\.reserve_au_proprietaire/,
    );
    await assert.rejects(
      sql("sami", `select public.capture_piece_set_vis($1, 'entite'::app.vis_t, true)`, [id]),
      /refus\.envoi\.reserve_au_proprietaire/,
      "« par accord » ne se déclare pas soi-même",
    );
    const { rows } = await s.admin.query(`select vis from capture.pieces where id = $1`, [id]);
    assert.equal(rows[0]?.vis, "partage");
    // Le propriétaire, lui, la garde.
    await s.fait("amel", "collab.garderPiece", id);
    const apres = await s.admin.query(`select vis from capture.pieces where id = $1`, [id]);
    assert.equal(apres.rows[0]?.vis, "entite");
  });

  it("personne n'écrit une notification à la place de la base", async () => {
    const id = await s.deposer("sami", "entite");
    await assert.rejects(
      sql(
        "sonia",
        `select app.notifier_les_receveurs($1, 'piece.retournee_par_le_proprietaire',
                                           jsonb_build_object('piece_id', $2::text, 'note', 'FORGEE'))`,
        [s.pme, id],
      ),
      /permission denied/,
    );
    const { rows } = await s.admin.query(
      `select count(*)::int as n from collab.notifications where payload ->> 'note' = 'FORGEE'`,
    );
    assert.equal(rows[0]?.n, 0);
  });

  it("le cabinet n'est pas prévenu d'une pièce qu'on ne lui a pas envoyée ; les propriétaires le sont", async () => {
    const id = await s.deposer("sami", "personnel");
    await s.fait("sami", "collab.setPieceVis", id, "entite");
    const { rows } = await s.admin.query<{ user_id: string | null }>(
      `select user_id from collab.notifications
        where kind = 'piece.a_valider' and payload ->> 'piece_id' = $1`,
      [id],
    );
    assert.deepEqual(
      rows.map((r) => r.user_id).sort(),
      [s.gens.amel.id, s.gens.bilel.id].sort(),
      "adressée à chaque propriétaire, jamais à toute la société",
    );
    // Même une notification de société sur cette pièce reste dans la société.
    await s.admin.query(
      `insert into collab.notifications (tenant_id, kind, payload)
       values ($1, 'piece.a_valider', jsonb_build_object('piece_id', $2::text))`,
      [s.pme, id],
    );
    const duCabinet = (await s.fait("expert", "collab.notifications", [s.pme])) as unknown[];
    assert.ok(!JSON.stringify(duCabinet).includes(id));
  });

  it("un siège ne lit pas les pièces prises en charge d'un autre", async () => {
    const id = await chezLeComptable();
    await s.priseEnCharge(id);
    const q = `select piece_id from app.pieces_prises_en_charge() where piece_id = $1`;
    assert.equal((await sql("sonia", q, [id])).length, 0);
    assert.equal((await sql("sami", q, [id])).length, 1);
    assert.equal((await sql("expert", q, [id])).length, 1);
  });

  it("la chaîne des versions d'une autre société ne se lit pas par son identifiant", async () => {
    const ancienne = await s.deposer("amel", "entite");
    const nouvelle = (await s.fait("amel", "capture.enregistrer", {
      tenantId: s.pme,
      source: "photo",
      vis: "entite",
      idempotencyKey: `contourne-reprise-${Date.now()}`,
      contentType: "image/jpeg",
      pageCount: 1,
      remplace: ancienne,
    })) as { id: string };
    const q = `select app.version_courante($1) as courante,
                      (select array_agg(v order by v) from app.versions_de_la_piece($1) v) as chaine`;
    const [lui] = await sql("amel", q, [ancienne]);
    assert.equal(lui?.courante, nouvelle.id, "la société suit sa chaîne");

    const etranger = await creerCompte(
      `contourne-${Date.now()}-x@essai.local`,
      "MotDePasseTresLong2026!",
    );
    assert.ok(etranger);
    const [lu] = await sql(etranger.id, q, [ancienne]);
    assert.equal(lu?.courante, ancienne, "rien de plus que ce qu'il a donné");
    assert.deepEqual(lu?.chaine, [ancienne]);
  });

  it("un siège ne se fait pas passer pour un remplacement de photo pour transmettre", async () => {
    const id = await s.deposer("sami", "entite");
    await assert.rejects(
      sousIdentiteDuServeur(s.gens.sami.id, async (db) => {
        await db.query(`select set_config('malica.remplacement', $1, true)`, [id]);
        await db.query(`update capture.pieces set vis = 'partage' where id = $1`, [id]);
      }),
      /refus\.envoi\.reserve_au_proprietaire/,
    );
    const { rows } = await s.admin.query(`select vis from capture.pieces where id = $1`, [id]);
    assert.equal(rows[0]?.vis, "entite");
  });

  it("les droits que le Socle connaît sont ceux du référentiel", async () => {
    const { rows } = await s.admin.query<{ code: string }>(
      `select code from ref.droits order by sort_order, code`,
    );
    assert.deepEqual(
      rows.map((r) => r.code),
      [...DROITS],
    );
  });
});
