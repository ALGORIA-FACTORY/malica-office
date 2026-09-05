/**
 * Une date sort de l'API comme une date.
 *
 * Le pilote `pg` convertissait une colonne `date` en `Date` JavaScript à
 * minuit local, rendue ensuite en instant UTC : « 2026-09-30 » devenait
 * « 2026-09-29T23:00:00.000Z » sur un poste en UTC+1, et tous les écrans
 * lisaient la veille. `db.ts` pose un analyseur qui laisse la date telle
 * que la base l'écrit. Cette épreuve le tient.
 */
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { fermerLePool, horsRlsAuthentificationSeule } from "./db.ts";

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

describe("une date est une date", { skip: !BASE_CONFIGUREE }, () => {
  after(() => fermerLePool());

  it("rend une colonne date en « YYYY-MM-DD », jamais en instant", async () => {
    const { d, ts } = await horsRlsAuthentificationSeule(async (db) => {
      const { rows } = await db.query<{ d: unknown; ts: unknown }>(
        "select date '2026-09-30' as d, timestamptz '2026-09-30T10:00:00Z' as ts",
      );
      return rows[0]!;
    });
    assert.equal(d, "2026-09-30");
    // Un instant, lui, reste un instant : l'analyseur ne touche que le type date.
    assert.ok(ts instanceof Date);
  });
});
