/**
 * L'équipe de la comptabilité se nomme (recette du 11 novembre 2026, 4.4) :
 * `collab.members` rend le nom que chacun a donné, l'adresse restant à côté.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";

import pg from "pg";

import { personnesDEssai } from "./personne-d-essai.ts";
import { executerRpc } from "./rpc.ts";

const ADMIN = process.env["DATABASE_URL_ADMIN"];
const pool = ADMIN ? new pg.Pool({ connectionString: ADMIN, max: 1 }) : null;

describe("collab.members", { skip: !pool }, () => {
  after(async () => {
    await pool?.end();
  });

  it("rend le nom de l'inscription, ou le prénom et le nom écrits ; null sans nom", async () => {
    const db = await pool!.connect();
    try {
      await db.query("begin");
      const [karim, leila, sansNom] = [randomUUID(), randomUUID(), randomUUID()];
      await personnesDEssai(db, karim, leila, sansNom);
      await db.query(
        `insert into identity.profiles (user_id, display_name, prenom, nom)
         values ($1, 'Karim Trabelsi', null, null), ($2, 'L. B. S.', 'Leïla', 'Ben Salah')
         on conflict (user_id) do update
           set display_name = excluded.display_name, prenom = excluded.prenom, nom = excluded.nom`,
        [karim, leila],
      );
      const { rows } = await db.query<{ id: string }>(
        `insert into identity.organizations (kind, name, jurisdiction, currency)
         select 'cabinet', 'Équipe nommée', p.jurisdiction, p.currency
           from ref.jurisdiction_packs p order by p.jurisdiction limit 1 returning id`,
      );
      const cabinet = rows[0]!.id;
      await db.query(
        `insert into identity.memberships (tenant_id, user_id, role)
         values ($1, $2, 'expert'), ($1, $3, 'collaborateur'), ($1, $4, 'collaborateur')`,
        [cabinet, karim, leila, sansNom],
      );
      await db.query("set local role authenticated");
      await db.query("select set_config('request.jwt.claim.sub', $1, true)", [karim]);
      const membres = (await executerRpc(db, {
        depot: "collab",
        methode: "members",
        args: [cabinet],
      })) as Array<{ userId: string; nom: string | null; email: string }>;
      const nomDe = (id: string) => membres.find((m) => m.userId === id)?.nom;
      assert.equal(nomDe(karim), "Karim Trabelsi");
      assert.equal(nomDe(leila), "Leïla Ben Salah");
      assert.equal(nomDe(sansNom), null);
      assert.ok(membres.every((m) => m.email.length > 0));
    } finally {
      await db.query("rollback");
      db.release();
    }
  });
});
