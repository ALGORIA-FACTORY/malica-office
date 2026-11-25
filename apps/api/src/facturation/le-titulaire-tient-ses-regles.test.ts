/**
 * Le propriétaire principal (titulaire) tient ses règles — celles qu'aucune épreuve ne gardait
 * (revue du 24 novembre 2026, T6, T8, T10 — 20261231340000).
 *
 *   - titulaire de plusieurs licences, son année, son report et sa montée ne visent jamais une
 *     licence au hasard : il dit laquelle (T8) ;
 *   - un titulaire qui n'est plus dirigeant d'aucune société de sa licence ne décide plus rien ;
 *   - une société ne se détache jamais de sa licence : aucun client ne le peut ;
 *   - une société ne se rattache qu'à la licence de son dirigeant, dans la limite de l'offre ;
 *   - une descente que l'échéance refuse se dit au titulaire (T6).
 *
 *   node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/facturation/le-titulaire-tient-ses-regles.test.ts
 */
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import type pg from "pg";

import { ADMIN, aBlanc, pool } from "./decor-d-avance.ts";
import { type Decor, decor } from "./decor-de-facture.ts";

async function commeLui(db: pg.PoolClient, personne: string): Promise<void> {
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [personne]);
}

async function refuse(db: pg.PoolClient, sql: string, args: unknown[], cle: RegExp) {
  await db.query("savepoint refus");
  await assert.rejects(db.query(sql, args), cle);
  await db.query("rollback to savepoint refus");
}

/** Une société de plus, dont `dirigeant` est le dirigeant, non rattachée. */
async function uneSociete(db: pg.PoolClient, d: Decor, dirigeant: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into identity.organizations (kind, name, jurisdiction, currency)
     select 'pme', 'Autre société', o.jurisdiction, o.currency
       from identity.organizations o where o.id = $1
     returning id`,
    [d.tenant],
  );
  await db.query(
    "insert into identity.memberships (tenant_id, user_id, role) values ($1, $2, 'dirigeant')",
    [rows[0]!.id, dirigeant],
  );
  return rows[0]!.id;
}

describe("le titulaire tient ses règles", { skip: !ADMIN }, () => {
  after(async () => {
    await pool?.end();
  });

  it("titulaire de deux licences, il dit laquelle : jamais la première au hasard (T8)", async () => {
    await aBlanc(async (db) => {
      const a = await decor(db, "solo", "2026-11-01");
      const b = await decor(db, "solo", "2026-11-01");
      // La licence B passe au titulaire de A (la transmission est la seule voie : on l'ouvre).
      await db.query("select set_config('facturation.transmission', $1, true)", [b.licence]);
      await db.query("update facturation.licences set titulaire = $1 where id = $2", [
        a.titulaire,
        b.licence,
      ]);
      await db.query(
        "insert into identity.memberships (tenant_id, user_id, role) values ($1, $2, 'dirigeant')",
        [b.tenant, a.titulaire],
      );
      await commeLui(db, a.titulaire);
      for (const sql of [
        "select public.mon_annuel(null)",
        "select public.mon_report(null)",
        "select public.annuel_souscrire(null)",
        "select public.paiement_montee_preparer(null)",
      ]) {
        await refuse(db, sql, [], /plusieurs licences/);
      }
      // Avec la société, chacune vise la sienne.
      const { rows } = await db.query<{ a: unknown; b: unknown }>(
        "select public.mon_report($1) as a, public.mon_report($2) as b",
        [a.tenant, b.tenant],
      );
      assert.ok(rows[0]!.a !== null && rows[0]!.b !== null);
    });
  });

  it("un titulaire qui n'est plus dirigeant ne décide plus rien", async () => {
    await aBlanc(async (db) => {
      const d = await decor(db, "solo", "2026-11-01");
      await db.query(
        "update identity.memberships set role = 'collaborateur' where tenant_id = $1 and user_id = $2",
        [d.tenant, d.titulaire],
      );
      await commeLui(db, d.titulaire);
      const { rows } = await db.query<{ t: boolean }>("select facturation.titulaire_de($1) as t", [
        d.licence,
      ]);
      assert.equal(rows[0]!.t, false);
      await refuse(
        db,
        "select public.paiement_montee_preparer($1)",
        [d.tenant],
        /refus\.reserve\.proprietaire_principal/,
      );
    });
  });

  it("aucun client ne détache une société de sa licence", async () => {
    await aBlanc(async (db) => {
      const { rows: droits } = await db.query<{ p: string }>(
        `select privilege_type as p from information_schema.role_table_grants
          where table_schema = 'facturation' and table_name = 'licence_organisations'
            and grantee in ('authenticated', 'anon', 'public', 'portier')
            and privilege_type in ('DELETE', 'UPDATE', 'TRUNCATE')`,
      );
      assert.deepEqual(droits, [], "ni suppression ni modification pour un client");
      const { rows: fonctions } = await db.query<{ f: string }>(
        `select p.oid::regprocedure::text as f from pg_proc p
          where p.prosrc ~* '(delete\\s+from|update)\\s+facturation\\.licence_organisations'`,
      );
      assert.deepEqual(fonctions, [], "aucune fonction ne détache ni ne déplace une société");
    });
  });

  it("une société ne se rattache qu'à la licence de son dirigeant, dans la limite de l'offre", async () => {
    await aBlanc(async (db) => {
      const d = await decor(db, "solo", "2026-11-01");
      const autre = await decor(db, "solo", "2026-11-01");
      // Une société dont le titulaire n'est pas dirigeant : refusée.
      await refuse(
        db,
        "insert into facturation.licence_organisations (licence_id, tenant_id) values ($1, $2)",
        [d.licence, await uneSociete(db, d, autre.titulaire)],
        /refus\.licence\.rattachement_illegitime/,
      );
      // Solo n'accueille qu'une société : la seconde, même du titulaire, est refusée.
      await refuse(
        db,
        "insert into facturation.licence_organisations (licence_id, tenant_id) values ($1, $2)",
        [d.licence, await uneSociete(db, d, d.titulaire)],
        /refus\.licence\.organisation_de_plus/,
      );
    });
  });

  it("une descente que l'échéance refuse se dit au titulaire (T6)", async () => {
    await aBlanc(async (db) => {
      const d = await decor(db, "premium", "2026-11-01");
      const seconde = await uneSociete(db, d, d.titulaire);
      await db.query(
        "insert into facturation.licence_organisations (licence_id, tenant_id) values ($1, $2)",
        [d.licence, seconde],
      );
      // Basic n'accueille qu'une société : la descente programmée ne peut que refuser.
      const { rows: p } = await db.query<{ id: string }>(
        `insert into facturation.descentes_programmees (licence_id, offre_code, effet_le, demandee_par)
         values ($1, 'basic', current_date, $2) returning id`,
        [d.licence, d.titulaire],
      );
      await db.query("select facturation.descentes_dues_appliquer($1, current_date)", [d.licence]);
      const { rows: etat } = await db.query<{ statut: string }>(
        "select statut from facturation.descentes_programmees where id = $1",
        [p[0]!.id],
      );
      assert.equal(etat[0]!.statut, "refusee");
      const { rows: envois } = await db.query<{ destinataire: string; canal: string }>(
        `select destinataire::text, canal from notif.envois
          where code = 'abonnement.descente_refusee' and sujet_cle = $1 order by canal`,
        [`descente:${p[0]!.id}`],
      );
      assert.deepEqual(
        envois.map((e) => [e.destinataire, e.canal]),
        [
          [d.titulaire, "app"],
          [d.titulaire, "email"],
        ],
      );
    });
  });
});
