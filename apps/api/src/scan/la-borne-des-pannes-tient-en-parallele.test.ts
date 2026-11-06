/**
 * The out-of-dossier fault door (`public.journal_hors_dossier_consigner`,
 * 20261202120000) promises "twenty per person per ten minutes", enforced in
 * the database. It counts the caller's rows, then inserts — with no lock. Two
 * transactions that count at the same time both see fewer than twenty and
 * both insert, so parallel calls (a render loop of distinct errors, fired
 * without awaiting, or several API instances) write past the bound.
 *
 * Verifier's failing test (lot e-erreurs): the bound must hold when the calls
 * arrive together, not only when they arrive one after another.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "../auth.ts";
import { fermerLePool, sousIdentite } from "../db.ts";
import { executerRpc } from "../rpc.ts";

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

describe("the fault bound holds under parallel calls", { skip: !BASE_CONFIGUREE }, () => {
  let u: Utilisateur;

  before(async () => {
    const c = await creerCompte(
      `borne-parallele-${Date.now()}@essai.local`,
      "MotDePasseTresLong2026!",
    );
    assert.ok(c);
    u = c;
  });

  after(async () => {
    await fermerLePool();
  });

  it("never writes more than twenty faults in ten minutes, even when they arrive together", async () => {
    await Promise.allSettled(
      Array.from({ length: 60 }, (_, i) =>
        sousIdentite(u.id, (db) =>
          executerRpc(db, {
            depot: "journal",
            methode: "consignerHorsDossier",
            args: [{ ou: "parallel", code: `c${i}` }],
          }),
        ),
      ),
    );
    const p = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
    try {
      const { rows } = await p.query<{ n: string }>(
        `select count(*) as n from app.signalements where user_id = $1 and origine = 'panne'`,
        [u.id],
      );
      assert.ok(Number(rows[0]!.n) <= 20, `${rows[0]!.n} faults written, the bound is 20`);
    } finally {
      await p.end();
    }
  });
});
