/**
 * Le « + » suit la main — planche 5, approuvée le 7 novembre 2026.
 *
 * Le côté du bouton « + » est un réglage du COMPTE : à droite par défaut, à
 * gauche sur demande, relu sur chaque appareil. Il ne s'écrit que par sa
 * porte, pour soi seul, et n'accepte que « gauche » ou « droite ».
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { fermerLePool, sousIdentite } from "./db.ts";
import { executerRpc } from "./rpc.ts";
import { personnesDEssai } from "./personne-d-essai.ts";

const ADMIN = process.env["DATABASE_URL_ADMIN"];
const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && ADMIN);

describe("le « + » suit la main", { skip: !BASE_CONFIGUREE }, () => {
  const admin = new pg.Pool({ connectionString: ADMIN, max: 2 });
  const amel = randomUUID();
  const bilel = randomUUID();

  const rpc = (qui: string, methode: string, ...args: unknown[]) =>
    sousIdentite(qui, (db) => executerRpc(db, { depot: "identite", methode, args }));

  before(async () => {
    await personnesDEssai(admin, amel, bilel);
  });

  after(async () => {
    await admin.end();
    await fermerLePool();
  });

  it("à droite par défaut, comme avant", async () => {
    await rpc(amel, "ecrireMonProfil", "Amel", null);
    const p = (await rpc(amel, "monProfil")) as { cote_du_plus: string };
    assert.equal(p.cote_du_plus, "droite");
  });

  it("à gauche, sur le compte : relu partout, et rendu avec le nom", async () => {
    assert.equal(await rpc(amel, "ecrireCoteDuPlus", "gauche"), "gauche");
    const relu = (await rpc(amel, "monProfil")) as { cote_du_plus: string };
    assert.equal(relu.cote_du_plus, "gauche");
    const avecLeNom = (await rpc(amel, "ecrireMonProfil", "Amel", "Ben Salah")) as {
      cote_du_plus: string;
    };
    assert.equal(avecLeNom.cote_du_plus, "gauche");
  });

  it("pour soi seul : le réglage d'Amel ne touche pas Bilel", async () => {
    assert.equal(await rpc(bilel, "ecrireCoteDuPlus", "droite"), "droite");
    const amelRelue = (await rpc(amel, "monProfil")) as { cote_du_plus: string };
    assert.equal(amelRelue.cote_du_plus, "gauche");
  });

  it("rien d'autre que gauche ou droite, ni par l'API ni par la base", async () => {
    await assert.rejects(rpc(amel, "ecrireCoteDuPlus", "milieu"));
    await assert.rejects(
      sousIdentite(amel, (db) => db.query(`select public.mon_cote_du_plus_ecrire('haut')`)),
    );
    const relu = (await rpc(amel, "monProfil")) as { cote_du_plus: string };
    assert.equal(relu.cote_du_plus, "gauche");
  });
});
