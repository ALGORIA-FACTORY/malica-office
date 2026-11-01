/**
 * Son Mon espace part avec son compte (« Malica sans blocage », lot 4).
 *
 * Un siège qui quitte la société y laisse ses pièces de la société ; son Mon
 * espace, lui, reste à lui seul. La base le gardait lisible de son auteur,
 * mais rien ne le lui montrait hors de la société, et rien ne lui permettait
 * de le supprimer (« piece introuvable » : la porte exigeait l'adhésion). Il
 * le voit, le télécharge, le supprime — et ne l'envoie jamais à une société
 * dont il n'est plus membre.
 *
 *   node --experimental-strip-types --test src/le-mon-espace-part-avec-son-compte.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import {
  BASE_CONFIGUREE,
  monterUneSociete,
  type Personne,
  type SocieteDEssai,
} from "./circuit-d-essai.ts";
import { fermerLePool, sousIdentiteDuServeur } from "./db.ts";

describe("son Mon espace part avec son compte", { skip: !BASE_CONFIGUREE }, () => {
  let s: SocieteDEssai;
  let privee = "";
  let autre = "";
  let deSonia = "";

  before(async () => {
    s = await monterUneSociete(`mon-espace-${Date.now()}`);
    privee = await s.deposer("sami", "personnel");
    autre = await s.deposer("sami", "personnel");
    deSonia = await s.deposer("sonia", "personnel");
    const r = (await s.fait("amel", "facturation.libererPlace", s.pme, s.gens.sami.id)) as {
      libere: boolean;
    };
    assert.equal(r.libere, true);
  });

  after(async () => {
    try {
      await s?.fermer();
    } finally {
      await fermerLePool();
    }
  });

  const monEspace = (qui: Personne) =>
    s.fait(qui, "capture.monEspaceHorsSociete") as Promise<
      Array<{ id: string; societe: string; createdAt: string }>
    >;

  it("hors de la société, il voit son Mon espace, avec le nom de la société quittée", async () => {
    const liste = await monEspace("sami");
    assert.deepEqual(liste.map((p) => p.id).sort(), [privee, autre].sort());
    for (const p of liste) assert.match(p.societe, /^SOCIETE mon-espace-/);
  });

  it("personne d'autre ne le voit, et un membre n'y lit pas son propre Mon espace en cours", async () => {
    assert.deepEqual(await monEspace("amel"), []);
    assert.deepEqual(
      await monEspace("sonia"),
      [],
      "Sonia est encore membre : il est dans sa société",
    );
    const lu = (qui: Personne, id: string) =>
      sousIdentiteDuServeur(s.gens[qui].id, async (db) => {
        const { rows } = await db.query(`select 1 from pieces_v where id = $1`, [id]);
        return rows.length === 1;
      });
    assert.equal(await lu("amel", privee), false);
    assert.equal(await lu("sami", deSonia), false);
    // Le téléchargement passe par `pieces_v` (route `/pieces/:id/contenu`) : il la lit.
    assert.equal(await lu("sami", privee), true);
  });

  it("il ne l'envoie jamais à une société dont il n'est plus membre", async () => {
    await assert.rejects(
      s.fait("sami", "collab.setPieceVis", privee, "entite"),
      /refus\.introuvable\.piece$/,
    );
    await assert.rejects(s.fait("sami", "collab.envoyer", privee), /refus\.introuvable\.piece$/);
    const { rows } = await s.admin.query<{ vis: string }>(
      `select vis::text as vis from capture.pieces where id = $1`,
      [privee],
    );
    assert.equal(rows[0]!.vis, "personnel");
  });

  it("il le supprime ; le propriétaire, non", async () => {
    assert.equal(await s.fait("amel", "capture.supprimer", autre), false);
    assert.equal(await s.fait("sami", "capture.supprimer", autre), true);
    const { rows } = await s.admin.query(`select 1 from capture.pieces where id = $1`, [autre]);
    assert.equal(rows.length, 0);
    assert.deepEqual(
      (await monEspace("sami")).map((p) => p.id),
      [privee],
    );
  });
});
