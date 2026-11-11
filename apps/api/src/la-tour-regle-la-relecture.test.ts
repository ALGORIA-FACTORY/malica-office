/**
 * The tower sets what Malica does with an answer the firm must review, and
 * with a corpus that stays silent (decision of 11 November 2026).
 *
 * Delivered default: `annoncer` and `marquer`. The tower writes a new dated
 * decision; nobody else reads or writes it; the server and the fallback
 * conversation read the decision in force. Everything runs in a transaction
 * that is rolled back.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";

import pg from "pg";

import "./rpc.ts";
import { conseil } from "./depots/conseil.ts";
import { tour } from "./depots/tour.ts";
import { personnesDEssai } from "./personne-d-essai.ts";

const ADMIN = process.env["DATABASE_URL_ADMIN"];
const pool = ADMIN ? new pg.Pool({ connectionString: ADMIN, max: 1 }) : null;

async function aBlanc<T>(
  corps: (db: pg.PoolClient, m: { operateur: string; dirigeant: string }) => Promise<T>,
): Promise<T> {
  const db = await pool!.connect();
  try {
    await db.query("begin");
    const [operateur, dirigeant] = [randomUUID(), randomUUID()];
    await personnesDEssai(db, operateur, dirigeant);
    await db.query("insert into app.platform_operators (user_id) values ($1)", [operateur]);
    return await corps(db, { operateur, dirigeant });
  } finally {
    await db.query("rollback");
    db.release();
  }
}

async function sous(db: pg.PoolClient, personne: string, serveur = false): Promise<void> {
  await db.query("reset role");
  await db.query("select set_config('malica.origine', $1, true)", [serveur ? "serveur" : ""]);
  await db.query("set local role authenticated");
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [personne]);
}

async function refus(
  db: pg.PoolClient,
  appel: () => Promise<unknown>,
): Promise<{ code: string; message: string } | null> {
  await db.query("savepoint essai");
  try {
    await appel();
    await db.query("release savepoint essai");
    return null;
  } catch (e) {
    await db.query("rollback to savepoint essai");
    const err = e as { code?: string; message?: string };
    return { code: err.code ?? "inconnu", message: err.message ?? "" };
  }
}

const configuration = async (db: pg.PoolClient) =>
  (await db.query<{ c: Record<string, unknown> }>("select public.assistant_configuration() as c"))
    .rows[0]!.c;

describe("the tower sets the review mode of the assistant", { skip: !ADMIN }, () => {
  after(async () => {
    await pool?.end();
  });

  it("the delivered default announces the review and marks a figure from memory", async () => {
    await aBlanc(async (db, m) => {
      await sous(db, m.operateur);
      const etat = (await tour.relectureDeLAssistant(db)) as Record<string, unknown>;
      assert.equal(etat["mode"], "annoncer");
      assert.equal(etat["sans_texte"], "marquer");
      assert.ok(String(etat["motif"]).length > 0);

      await sous(db, m.dirigeant);
      assert.equal(await conseil.relecture(db), "annoncer");

      await sous(db, m.dirigeant, true);
      const c = await configuration(db);
      assert.equal(c["relecture"], "annoncer");
      assert.equal(c["sans_texte"], "marquer");
      assert.ok((c["unites_marquables"] as string[]).includes("jours"));
      // Internet search is delivered on; its tool type is data, not code.
      assert.equal(etat["web"], "active");
      assert.deepEqual(c["web"], { active: true, outil: "web_search_20250305", recherches_max: 3 });
    });
  });

  it("only the platform reads and writes the decision", async () => {
    await aBlanc(async (db, m) => {
      await sous(db, m.dirigeant);
      for (const appel of [
        () => tour.relectureDeLAssistant(db),
        () => tour.reglerRelectureDeLAssistant(db, "retenir", "retirer", "coupee", "essai"),
      ]) {
        const r = await refus(db, appel);
        assert.equal(r?.code, "42501");
        assert.match(r!.message, /refus\.reserve\.plateforme/);
      }
      const direct = await refus(db, () =>
        db.query(
          "insert into plateforme.assistant_relectures (mode, motif) values ('retenir', 'essai')",
        ),
      );
      assert.equal(direct?.code, "42501", "a client wrote the table directly");
    });
  });

  it("a new decision takes effect at once, for the server and the fallback, and the old one stays", async () => {
    await aBlanc(async (db, m) => {
      await sous(db, m.operateur);
      const avant = (
        await db.query<{ n: string }>("select count(*) as n from plateforme.assistant_relectures")
      ).rows[0]!.n;
      const etat = (await tour.reglerRelectureDeLAssistant(
        db,
        "retenir",
        "retirer",
        "coupee",
        "Retour à la règle du 4 octobre, pour l'essai.",
      )) as Record<string, unknown>;
      assert.equal(etat["mode"], "retenir");
      assert.equal(etat["sans_texte"], "retirer");
      assert.equal(etat["web"], "coupee");
      const apres = (
        await db.query<{ n: string }>("select count(*) as n from plateforme.assistant_relectures")
      ).rows[0]!.n;
      assert.equal(Number(apres), Number(avant) + 1, "the previous decision was rewritten");

      await sous(db, m.dirigeant);
      assert.equal(await conseil.relecture(db), "retenir");
      await sous(db, m.dirigeant, true);
      const c = await configuration(db);
      assert.equal(c["relecture"], "retenir");
      assert.equal(c["sans_texte"], "retirer");
      // The list of markable units is not a choice of the card: it is carried over.
      assert.ok((c["unites_marquables"] as string[]).includes("%"));
      // Internet search is switched off, and its tool type and ceiling are carried over.
      assert.deepEqual(c["web"], {
        active: false,
        outil: "web_search_20250305",
        recherches_max: 3,
      });
    });
  });

  it("an unknown mode or an empty reason is refused", async () => {
    await aBlanc(async (db, m) => {
      await sous(db, m.operateur);
      for (const [mode, sansTexte, web, motif] of [
        ["cacher", "marquer", "active", "essai"],
        ["annoncer", "inventer", "active", "essai"],
        ["annoncer", "marquer", "peut-etre", "essai"],
        ["annoncer", "marquer", "active", "  "],
      ] as const) {
        const r = await refus(db, () =>
          tour.reglerRelectureDeLAssistant(db, mode, sansTexte, web, motif),
        );
        assert.match(r?.message ?? "", /refus\.assistant\.saisie/);
      }
    });
  });
});
