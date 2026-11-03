/**
 * Une pièce non lue ne part pas au cabinet (3 novembre 2026).
 *
 * Sur le staging, une facture photographiée et jamais lue était chez le
 * cabinet : le lot de la Bibliothèque (« Transmettre ce qui reste ») et
 * l'envoi à l'unité passaient toute pièce de la société, lue ou non. La règle
 * est maintenant dans la base (`une_piece_non_lue_ne_part_pas`) ; chaque
 * épreuve rejoue une porte réelle, sous l'identité de la personne.
 *
 *   node --experimental-strip-types --test src/une-piece-non-lue-ne-part-pas.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { BASE_CONFIGUREE, monterUneSociete, type SocieteDEssai } from "./circuit-d-essai.ts";
import { fermerLePool, sousIdentiteDuServeur } from "./db.ts";

describe("une pièce non lue ne part pas au cabinet", { skip: !BASE_CONFIGUREE }, () => {
  let s: SocieteDEssai;

  before(async () => {
    s = await monterUneSociete(`non-lue-${Date.now()}`);
  });

  after(async () => {
    try {
      await s?.fermer();
    } finally {
      await fermerLePool();
    }
  });

  const visDe = async (id: string) =>
    (await s.admin.query<{ vis: string }>(`select vis from capture.pieces where id = $1`, [id]))
      .rows[0]?.vis;

  it("« Envoyer » à l'unité : refusé tant qu'elle n'est pas lue, et rien ne bouge", async () => {
    const id = await s.deposer("amel", "entite");
    await assert.rejects(s.fait("amel", "collab.envoyer", id), /refus\.envoi\.pas_lue/);
    assert.equal(await visDe(id), "entite");
  });

  it("le lot de la Bibliothèque : tout part, ou rien — et le refus dit pourquoi", async () => {
    const lue = await s.deposer("amel", "entite");
    await s.lire("amel", lue);
    const nonLue = await s.deposer("amel", "entite");
    await assert.rejects(
      s.fait("amel", "collab.transmettreLesPieces", [lue, nonLue]),
      /refus\.envoi\.pas_lue/,
    );
    assert.equal(await visDe(lue), "entite", "la transaction du lot n'a rien laissé partir");
    assert.equal(await visDe(nonLue), "entite");
  });

  it("la porte SQL de la visibilité tient la même règle", async () => {
    const id = await s.deposer("amel", "entite");
    await assert.rejects(
      sousIdentiteDuServeur(s.gens.amel.id, (db) =>
        db.query(`select public.capture_piece_set_vis($1, 'partage')`, [id]),
      ),
      /refus\.envoi\.pas_lue/,
    );
    assert.equal(await visDe(id), "entite");
  });

  it("lue, elle part — et l'audit le dit", async () => {
    const id = await s.deposer("amel", "entite");
    await s.lire("amel", id);
    await s.fait("amel", "collab.envoyer", id);
    assert.equal(await visDe(id), "partage");
    const { rows } = await s.admin.query<{ n: number }>(
      `select count(*)::int as n from audit.event_log
        where object_id = $1 and action = 'piece.vis_changed' and payload ->> 'to' = 'partage'`,
      [id],
    );
    assert.equal(rows[0]?.n, 1);
  });

  it("reprendre la photo d'une pièce déjà partie reste possible : ce n'est pas un envoi", async () => {
    const ancienne = await s.deposer("amel", "entite");
    await s.lire("amel", ancienne);
    await s.fait("amel", "collab.envoyer", ancienne);
    const nouvelle = (await s.fait("amel", "capture.enregistrer", {
      tenantId: s.pme,
      source: "photo",
      vis: "entite",
      idempotencyKey: `non-lue-reprise-${Date.now()}`,
      contentType: "image/jpeg",
      pageCount: 1,
      remplace: ancienne,
    })) as { id: string };
    const { rows } = await s.admin.query<{ vis: string; status: string }>(
      `select vis, status from capture.pieces where id = $1`,
      [nouvelle.id],
    );
    assert.deepEqual(rows[0], { vis: "partage", status: "capturee" });
  });
});
