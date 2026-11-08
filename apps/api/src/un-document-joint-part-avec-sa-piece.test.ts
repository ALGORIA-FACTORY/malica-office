/**
 * Un document joint part avec sa pièce — planche 3, approuvée le 7 novembre 2026.
 *
 * « Un BL ou un avoir lié part avec sa facture ; un BL ne consomme pas de
 * lecture. » Recette du 7 novembre : le BL joint devait être lu pour partir,
 * puis s'affichait « À envoyer » à côté d'une facture déjà chez le cabinet.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { BASE_CONFIGUREE, monterUneSociete, type SocieteDEssai } from "./circuit-d-essai.ts";
import { fermerLePool } from "./db.ts";

describe("un document joint part avec sa pièce", { skip: !BASE_CONFIGUREE }, () => {
  let s: SocieteDEssai;
  const vis = async (id: string) =>
    (await s.admin.query<{ vis: string }>(`select vis from capture.pieces where id = $1`, [id]))
      .rows[0]!.vis;
  const jointe = async (id: string) => {
    const liste = (await s.fait("amel", "capture.listAvecLecture", s.pme)) as Array<{
      id: string;
      jointe?: boolean;
    }>;
    return liste.find((p) => p.id === id)?.jointe;
  };

  before(async () => {
    s = await monterUneSociete(`joint-${Date.now()}`);
  });
  after(async () => {
    await s.fermer();
    await fermerLePool();
  });

  it("un document non lu, joint à une facture lue, part avec elle sans lecture", async () => {
    const facture = await s.deposer("amel", "entite");
    await s.lire("amel", facture);
    const bl = await s.deposer("amel", "entite");
    await s.fait("amel", "capture.rattacher", facture, bl);

    assert.equal(await jointe(bl), true, "la liste le marque joint");
    assert.equal(await jointe(facture), false, "la facture, elle, ne l'est pas");

    await s.fait("amel", "collab.envoyer", facture);
    assert.equal(await vis(facture), "partage");
    assert.equal(await vis(bl), "partage", "le BL est parti avec sa facture, non lu");
    const lu = await s.admin.query(`select 1 from capture.extractions where piece_id = $1`, [bl]);
    assert.equal(lu.rowCount, 0, "aucune lecture consommée");
  });

  it("joint à une pièce déjà chez le cabinet, il la rejoint aussitôt", async () => {
    const facture = await s.deposer("amel", "entite");
    await s.lire("amel", facture);
    await s.fait("amel", "collab.envoyer", facture);
    const bl = await s.deposer("amel", "entite");
    await s.fait("amel", "capture.rattacher", facture, bl);
    assert.equal(await vis(bl), "partage");
  });

  it("une pièce non lue, seule, reste refusée à l'envoi", async () => {
    const seule = await s.deposer("amel", "entite");
    await assert.rejects(s.fait("amel", "collab.envoyer", seule), /pas_lue/);
  });

  it("deux factures lues rattachées ne s'accompagnent pas", async () => {
    const a = await s.deposer("amel", "entite");
    const b = await s.deposer("amel", "entite");
    await s.lire("amel", a);
    await s.lire("amel", b);
    await s.fait("amel", "capture.rattacher", a, b);
    await s.fait("amel", "collab.envoyer", a);
    assert.equal(await vis(a), "partage");
    assert.equal(await vis(b), "entite", "chacune part par son propre geste");
  });
});
