/**
 * L'adresse du siège se donne à la création de la société (recette du
 * 11 novembre 2026, 4.2) : elle va sur l'organisation, et l'établissement
 * principal garde la raison sociale. La porte ne s'ouvre qu'aux dirigeants.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";

import pg from "pg";

import { personnesDEssai } from "./personne-d-essai.ts";
import { refusLisible } from "./refus.ts";
import { executerRpc } from "./rpc.ts";

const ADMIN = process.env["DATABASE_URL_ADMIN"];
const pool = ADMIN ? new pg.Pool({ connectionString: ADMIN, max: 1 }) : null;

describe("identite.createOrganization avec une adresse", { skip: !pool }, () => {
  after(async () => {
    await pool?.end();
  });

  it("pose l'adresse sur la société ; un étranger ne la change pas", async () => {
    const db = await pool!.connect();
    try {
      await db.query("begin");
      const [moi, etranger] = [randomUUID(), randomUUID()];
      await personnesDEssai(db, moi, etranger);
      const { rows: p } = await db.query<{ jurisdiction: string; currency: string }>(
        `select jurisdiction, currency from ref.jurisdiction_packs
          where effective_from <= current_date order by jurisdiction limit 1`,
      );
      const enPersonne = async (qui: string) => {
        await db.query("reset role");
        await db.query("set local role authenticated");
        await db.query("select set_config('request.jwt.claim.sub', $1, true)", [qui]);
      };
      await enPersonne(moi);
      const id = (await executerRpc(db, {
        depot: "identite",
        methode: "createOrganization",
        args: [
          {
            kind: "pme",
            name: "Atelier d'essai du siège",
            jurisdiction: p[0]!.jurisdiction,
            currency: p[0]!.currency,
            adresse: "  12 rue de Marseille, Tunis ",
          },
        ],
      })) as string;
      await db.query("reset role");
      const { rows } = await db.query<{ adresse: string | null; etab: string }>(
        `select o.adresse, e.name as etab from identity.organizations o
           join identity.entities e on e.tenant_id = o.id and e.is_default
          where o.id = $1`,
        [id],
      );
      assert.equal(rows[0]?.adresse, "12 rue de Marseille, Tunis");
      assert.equal(rows[0]?.etab, "Atelier d'essai du siège");

      await enPersonne(etranger);
      await db.query("savepoint x");
      const refus = await db
        .query("select public.organisation_adresse_poser($1, 'ailleurs')", [id])
        .then(() => null)
        .catch((e: unknown) => refusLisible(e));
      await db.query("rollback to savepoint x");
      assert.equal(refus, "refus.introuvable.organisation");
    } finally {
      await db.query("rollback");
      db.release();
    }
  });
});
