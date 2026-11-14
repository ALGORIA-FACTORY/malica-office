/**
 * Le matricule fiscal se saisit après l'inscription, une seule fois (recette du 14 novembre 2026, point 3).
 *
 * Le matricule est facultatif à l'inscription. La PME doit pouvoir le saisir ensuite, mais une
 * fois seulement : la base contrôle le format du pack, refuse un changement, et redit un même
 * matricule sans rien écrire de faux.
 *
 *   node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/le-matricule-se-saisit-apres-l-inscription.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "./auth.ts";
import { fermerLePool, sousIdentite } from "./db.ts";
import { matriculeDEssai } from "./matricule-d-essai.ts";
import { executerRpc } from "./rpc.ts";

const BASE_CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["JWT_SECRET"] && process.env["DATABASE_URL_ADMIN"],
);

describe("le matricule se saisit après l'inscription, une fois", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `matricule-apres-${Date.now()}`;
  const mdp = "MotDePasseTresLong2026!";
  const mf = matriculeDEssai("A", "M");
  const autre = matriculeDEssai("A", "M");
  let dirigeant: Utilisateur;
  let pme = "";
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });

  const definir = (legalId: string | null, name = `PME ${marque}`) =>
    sousIdentite(dirigeant.id, (db) =>
      executerRpc(db, {
        depot: "identite",
        methode: "definirOrganisation",
        args: [{ tenantId: pme, name, legalId, jurisdiction: "TN" }],
      }),
    );

  before(async () => {
    dirigeant = (await creerCompte(`dirigeant-${marque}@essai.local`, mdp))!;
    assert.ok(dirigeant);
    pme = await sousIdentite(dirigeant.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('pme', $1, 'autonome', null, 'TN', 'TND') as id`,
        [`PME ${marque}`],
      );
      return rows[0]!.id;
    });
  });

  after(async () => {
    try {
      await admin.query(
        `update identity.organizations
            set archived_at = now(), archived_reason = 'fixture de test automatisé'
          where id = $1::uuid and archived_at is null`,
        [pme],
      );
    } finally {
      await admin.end();
      await fermerLePool();
    }
  });

  it("une société sans matricule le reçoit, en majuscules, après l'inscription", async () => {
    const r = (await definir(mf.toLowerCase())) as { legalId: string };
    assert.equal(r.legalId, mf);
  });

  it("le même matricule redit ne change rien et ne refuse pas", async () => {
    const r = (await definir(mf)) as { legalId: string };
    assert.equal(r.legalId, mf);
  });

  it("un matricule inscrit ne change plus", async () => {
    await assert.rejects(definir(autre), /refus\.organisation\.matricule_fige/);
    await assert.rejects(definir(null), /refus\.organisation\.matricule_fige/);
    const { rows } = await admin.query<{ legal_id: string }>(
      `select legal_id from identity.organizations where id = $1::uuid`,
      [pme],
    );
    assert.equal(rows[0]!.legal_id, mf, "le matricule inscrit est resté le même");
  });

  it("un matricule au mauvais format est refusé par le pack", async () => {
    const ailleurs = await sousIdentite(dirigeant.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('pme', $1, 'autonome', null, 'TN', 'TND') as id`,
        [`PME FORMAT ${marque}`],
      );
      return rows[0]!.id;
    });
    try {
      await assert.rejects(
        sousIdentite(dirigeant.id, (db) =>
          executerRpc(db, {
            depot: "identite",
            methode: "definirOrganisation",
            args: [
              { tenantId: ailleurs, name: "x", legalId: "PAS-UN-MATRICULE", jurisdiction: "TN" },
            ],
          }),
        ),
        /refus\.identifiant/,
      );
    } finally {
      await admin.query(
        `update identity.organizations
            set archived_at = now(), archived_reason = 'fixture de test automatisé'
          where id = $1::uuid and archived_at is null`,
        [ailleurs],
      );
    }
  });
});
