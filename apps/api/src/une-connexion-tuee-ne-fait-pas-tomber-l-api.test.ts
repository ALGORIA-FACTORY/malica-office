/**
 * PostgreSQL peut couper une connexion en pleine transaction. La requête qui
 * s'en servait échoue ; le processus de l'API, lui, doit rester debout.
 * Sans écouteur, l'événement « error » du client arrête Node : ce test ne
 * finirait pas.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  fermerLePool,
  horsRlsAuthentificationEnUneRequete,
  horsRlsAuthentificationSeule,
} from "./db.ts";

test("une connexion tuée fait échouer sa requête, pas l'API", async () => {
  await assert.rejects(
    horsRlsAuthentificationSeule((db) => db.query("select pg_terminate_backend(pg_backend_pid())")),
  );
  // Laisse à l'événement du client le temps d'arriver.
  await new Promise((fin) => setTimeout(fin, 200));
  const { rows } = await horsRlsAuthentificationEnUneRequete<{ ok: number }>("select 1 as ok", []);
  assert.equal(rows[0]?.ok, 1);
  await fermerLePool();
});
