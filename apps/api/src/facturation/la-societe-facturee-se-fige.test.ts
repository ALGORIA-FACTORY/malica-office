/**
 * La société facturée se désigne en un seul endroit, et la facture la fige à l'émission
 * (revue du 24 novembre 2026, trous T1, T4, T5 — 20261231330000).
 *
 *   - une facture émise garde la raison sociale, le matricule et l'adresse du jour de son
 *     émission, même si la société modifie sa fiche ensuite ;
 *   - la société facturée est la première rattachée qui n'est pas archivée ;
 *   - une seule fonction la désigne : aucune autre ne la recalcule à sa façon.
 *
 *   node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/facturation/la-societe-facturee-se-fige.test.ts
 */
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { facturation } from "../depots/facturation.ts";
import { ADMIN, aBlanc, pool } from "./decor-d-avance.ts";
import { decor } from "./decor-de-facture.ts";

interface Client {
  nom: string;
  matricule: string | null;
  adresse: string | null;
}

describe("la société facturée se fige", { skip: !ADMIN }, () => {
  after(async () => {
    await pool?.end();
  });

  it("une facture émise ne change pas quand la société modifie sa fiche", async () => {
    await aBlanc(async (db) => {
      const d = await decor(db, "solo", "2026-11-01");
      const { rows: e } = await db.query<{ r: { facture_id: string } }>(
        "select facturation.emission_de_la_licence($1, date '2026-11-01') as r",
        [d.licence],
      );
      const facture = e[0]!.r.facture_id;
      const { rows: avant } = await db.query<{ name: string; legal_id: string; adresse: string }>(
        "select name, legal_id, adresse from identity.organizations where id = $1",
        [d.tenant],
      );
      // L'en-tête de la facture ne se lit que par son payeur (ou la plateforme).
      await db.query("select set_config('request.jwt.claim.sub', $1, true)", [d.titulaire]);
      const lu = (await facturation.factureDetail(db, facture)) as { client: Client };
      assert.equal(lu.client.nom, avant[0]!.name);
      assert.equal(lu.client.matricule, avant[0]!.legal_id);
      assert.equal(lu.client.adresse, avant[0]!.adresse);

      // La société change de nom et d'adresse : la facture déjà émise ne bouge pas.
      await db.query(
        "update identity.organizations set name = 'Autre nom', adresse = 'Autre adresse' where id = $1",
        [d.tenant],
      );
      const relu = (await facturation.factureDetail(db, facture)) as { client: Client };
      assert.deepEqual(relu.client, lu.client);
    });
  });

  it("la société facturée est la première rattachée qui n'est pas archivée", async () => {
    await aBlanc(async (db) => {
      const d = await decor(db, "premium", "2026-11-01");
      const { rows: seconde } = await db.query<{ id: string }>(
        `insert into identity.organizations (kind, name, jurisdiction, currency)
         select 'pme', 'Seconde société', o.jurisdiction, o.currency
           from identity.organizations o where o.id = $1
         returning id`,
        [d.tenant],
      );
      await db.query(
        "insert into identity.memberships (tenant_id, user_id, role) values ($1, $2, 'dirigeant')",
        [seconde[0]!.id, d.titulaire],
      );
      await db.query(
        `insert into facturation.licence_organisations (licence_id, tenant_id, rattachee_le)
         values ($1, $2, now() + interval '1 day')`,
        [d.licence, seconde[0]!.id],
      );
      const principale = async () =>
        (await db.query<{ t: string }>("select facturation.societe_facturee($1) as t", [d.licence]))
          .rows[0]!.t;
      assert.equal(await principale(), d.tenant, "la première rattachée");
      await db.query(
        "update identity.organizations set archived_at = now(), archived_reason = 'essai' where id = $1",
        [d.tenant],
      );
      assert.equal(await principale(), seconde[0]!.id, "l'archivée cède la place");
    });
  });

  it("aucune autre fonction ne désigne la société de la licence à sa façon", async () => {
    await aBlanc(async (db) => {
      const { rows } = await db.query<{ f: string }>(
        `select p.oid::regprocedure::text as f
           from pg_proc p
          where p.prosrc ~* 'from\\s+facturation\\.licence_organisations\\s+\\w+\\s+where\\s+\\w+\\.licence_id\\s*=\\s*[^\\s]+\\s+order\\s+by\\s+\\w+\\.(rattachee_le|tenant_id)'
            and p.oid <> 'facturation.societe_facturee(uuid)'::regprocedure
          order by 1`,
      );
      assert.deepEqual(
        rows.map((r) => r.f),
        [],
        "désigner la société facturée passe par facturation.societe_facturee",
      );
    });
  });
});
