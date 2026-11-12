/**
 * « Suis-je opérateur de la plateforme ? » se répond, il ne se refuse pas
 * (recette du 11 novembre 2026, point 5.5).
 *
 * Le portail et la tour posent la question à chaque chargement, pour TOUT
 * compte : c'est elle qui décide de montrer la carte de la tour. Le dépôt
 * `tour` étant réservé aux opérateurs, l'appel répondait 400
 * (`refus.reserve.plateforme`) à qui ne l'est pas — une erreur rouge dans la
 * console de chaque dirigeant et de chaque comptable. La question rend
 * désormais `false`, sans erreur ; tout le reste de la tour reste refusé.
 *
 *   node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/suis-je-plateforme-repond-sans-refus.test.ts
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";

import pg from "pg";

import { personnesDEssai } from "./personne-d-essai.ts";
import { executerRpc } from "./rpc.ts";

const ADMIN = process.env["DATABASE_URL_ADMIN"];
const pool = ADMIN ? new pg.Pool({ connectionString: ADMIN, max: 1 }) : null;

async function sousIdentite<T>(
  preparer: (db: pg.PoolClient, id: string) => Promise<void>,
  corps: (db: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const db = await pool!.connect();
  try {
    await db.query("begin");
    const id = randomUUID();
    await personnesDEssai(db, id);
    await preparer(db, id);
    await db.query("set local role authenticated");
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [id]);
    return await corps(db);
  } finally {
    await db.query("rollback");
    db.release();
  }
}

describe("tour.suisJePlateforme", { skip: !pool }, () => {
  after(async () => {
    await pool?.end();
  });

  it("répond false, sans erreur, à un compte qui n'est pas opérateur", async () => {
    const reponse = await sousIdentite(
      async () => undefined,
      (db) => executerRpc(db, { depot: "tour", methode: "suisJePlateforme", args: [] }),
    );
    assert.equal(reponse, false);
  });

  it("répond true à un opérateur", async () => {
    const reponse = await sousIdentite(
      (db, id) => db.query("insert into app.platform_operators (user_id) values ($1)", [id]).then(),
      (db) => executerRpc(db, { depot: "tour", methode: "suisJePlateforme", args: [] }),
    );
    assert.equal(reponse, true);
  });

  it("le reste de la tour reste refusé à qui n'est pas opérateur, en lecture aussi", async () => {
    await sousIdentite(
      async () => undefined,
      async (db) => {
        for (const methode of ["licences", "reglagePaiement", "reglageFacturationAuto"]) {
          await assert.rejects(
            executerRpc(db, { depot: "tour", methode, args: [] }),
            /refus\.reserve\.plateforme/,
            methode,
          );
        }
      },
    );
  });
});
