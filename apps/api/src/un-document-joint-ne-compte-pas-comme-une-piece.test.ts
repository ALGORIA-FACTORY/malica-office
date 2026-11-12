/**
 * Un document joint ne compte pas comme une pièce (recette du 11 novembre
 * 2026, point 2.1).
 *
 * Un bon de livraison joint à une facture retournée partait bien avec elle
 * (#301), mais la comptabilité le recevait dans sa file comme une pièce « Pas
 * encore lue », ses compteurs le comptaient, et l'écran de la facture ne le
 * montrait pas.
 *
 *   node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/un-document-joint-ne-compte-pas-comme-une-piece.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { BASE_CONFIGUREE, monterUneSociete, type SocieteDEssai } from "./circuit-d-essai.ts";
import { fermerLePool } from "./db.ts";

interface Client {
  tenantId: string;
  counts: Record<string, number>;
  aTraiter: number;
}

describe("un document joint ne compte pas comme une pièce", { skip: !BASE_CONFIGUREE }, () => {
  let s: SocieteDEssai;
  let facture: string;
  let bl: string;

  const file = async () =>
    ((await s.fait("expert", "supervision.queue", s.cabinet)) as Array<{ pieceId: string }>).map(
      (r) => r.pieceId,
    );
  const client = async () =>
    ((await s.fait("expert", "supervision.listClients", s.cabinet)) as Client[]).find(
      (c) => c.tenantId === s.pme,
    )!;

  before(async () => {
    s = await monterUneSociete(`joint-compte-${Date.now()}`);
    // La facture part, la comptabilité la retourne, la PME y joint un bon de
    // livraison importé (non lu) puis la renvoie.
    facture = await s.deposer("amel", "entite");
    await s.lire("amel", facture);
    await s.fait("amel", "collab.envoyer", facture);
    await s.fait("expert", "supervision.retourner", {
      pieceId: facture,
      motifId: s.motifs["montant_incoherent"]!,
      note: "Le bon de livraison manque.",
    });
    bl = await s.deposer("amel", "entite");
    await s.fait("amel", "capture.rattacher", facture, bl);
    await s.fait("amel", "collab.envoyer", facture);
  });
  after(async () => {
    await s.fermer();
    await fermerLePool();
  });

  it("le document joint est parti avec la facture, sans lecture", async () => {
    const { rows } = await s.admin.query<{ id: string; vis: string; status: string }>(
      `select id, vis, status from capture.pieces where id = any($1::uuid[])`,
      [[facture, bl]],
    );
    assert.equal(rows.find((r) => r.id === bl)!.vis, "partage");
    assert.equal(rows.find((r) => r.id === bl)!.status, "capturee");
    assert.notEqual(rows.find((r) => r.id === facture)!.status, "retournee");
  });

  it("la file de la comptabilité porte la facture, pas le document joint", async () => {
    const ids = await file();
    assert.ok(ids.includes(facture), "la facture est dans la file");
    assert.ok(!ids.includes(bl), "le document joint n'est pas une pièce de la file");
  });

  it("les compteurs du client ne le comptent pas", async () => {
    const c = await client();
    assert.equal(c.counts["capturee"], 0, "« Déposées, pas encore lues »");
    assert.equal(c.aTraiter, 1, "une seule pièce à traiter : la facture");
  });

  it("la comptabilité le voit à côté de la facture", async () => {
    const joints = (await s.fait("expert", "capture.piecesRattachees", facture)) as Array<{
      id: string;
    }>;
    assert.deepEqual(
      joints.map((j) => j.id),
      [bl],
    );
  });

  it("la PME le lit joint, jamais comme une pièce transmise à part", async () => {
    const liste = (await s.fait("amel", "capture.listAvecLecture", s.pme)) as Array<{
      id: string;
      vis: string;
      jointe?: boolean;
    }>;
    assert.equal(liste.find((p) => p.id === bl)?.jointe, true);
    assert.equal(liste.find((p) => p.id === facture)?.jointe, false);
  });
});
