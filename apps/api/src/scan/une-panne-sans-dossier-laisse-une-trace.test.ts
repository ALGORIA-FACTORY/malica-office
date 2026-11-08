/**
 * Une panne vue hors de tout dossier laisse sa trace en base — bornée, et
 * relue par l'opérateur seul.
 *
 * Règle du dirigeant (6 novembre 2026) : l'écran dit une phrase humaine, le
 * détail va au journal EN BASE. Le journal des pannes exige un dossier ;
 * accepter une invitation, ouvrir un dossier depuis le cabinet, la tour n'en
 * ont pas. Leur panne va donc à `app.signalements`, origine `panne`
 * (`20261205093300_une_panne_sans_dossier_laisse_une_trace.sql`).
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "../auth.ts";
import { fermerLePool, sousIdentite } from "../db.ts";
import { executerRpc } from "../rpc.ts";

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

describe("une panne sans dossier laisse une trace", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `panne-hors-dossier-${Date.now()}`;
  let u: Utilisateur;

  const rpc = (depot: string, methode: string, ...args: unknown[]) =>
    sousIdentite(u.id, (db) => executerRpc(db, { depot, methode, args }));

  const admin = async <T>(f: (p: pg.Pool) => Promise<T>) => {
    const p = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
    try {
      return await f(p);
    } finally {
      await p.end();
    }
  };

  const lignes = () =>
    admin(async (p) => {
      const { rows } = await p.query<{
        user_id: string;
        tenant_id: string | null;
        ou: string;
        message: string;
        version_client: string;
      }>(
        `select user_id, tenant_id, ou, message, version_client from app.signalements
          where user_id = $1 and origine = 'panne' order by cree_le`,
        [u.id],
      );
      return rows;
    });

  before(async () => {
    const c = await creerCompte(`${marque}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(c);
    u = c;
  });

  after(async () => {
    await fermerLePool();
  });

  it("qui, où, le code et un détail coupé — signé de la session, sans dossier", async () => {
    const r = await rpc("journal", "consignerHorsDossier", {
      ou: "routes/invitation : accepter",
      code: "ErreurApi 400",
      detail: "x".repeat(500),
      version: "0.4.0",
      plateforme: "Android 14 / WebView 131",
    });
    assert.deepEqual(r, { inscrite: true });
    const [l] = await lignes();
    assert.ok(l);
    assert.equal(l.user_id, u.id);
    assert.equal(l.tenant_id, null);
    assert.equal(l.ou, "routes/invitation : accepter");
    assert.ok(l.message.startsWith("ErreurApi 400 : x"));
    assert.ok(l.message.length <= 2000);
    assert.equal(l.version_client, "0.4.0");
  });

  it("un détail trop long est refusé avant la porte, jamais versé entier", async () => {
    await assert.rejects(
      rpc("journal", "consignerHorsDossier", { ou: "x", code: "y", detail: "z".repeat(501) }),
    );
  });

  it("est bornée : au-delà de vingt en dix minutes, rien n'est écrit, et rien ne lève", async () => {
    for (let i = 0; i < 25; i++)
      await rpc("journal", "consignerHorsDossier", { ou: "boucle", code: `essai ${i}` });
    const toutes = await lignes();
    assert.equal(toutes.length, 20);
    const derniere = await rpc("journal", "consignerHorsDossier", { ou: "boucle", code: "encore" });
    assert.deepEqual(derniere, { inscrite: false });
  });

  it("l'auteur ne relit pas ce qu'il a signalé : seul l'opérateur relit", async () => {
    const vues = await sousIdentite(u.id, async (db) => {
      const { rows } = await db.query("select id from app.signalements where origine = 'panne'");
      return rows.length;
    });
    assert.equal(vues, 0);
  });
});
