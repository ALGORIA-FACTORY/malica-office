/**
 * La facture dit à qui elle s'adresse : les coordonnées du payeur viennent de son compte, et
 * elles sont complètes AVANT de payer (décision du dirigeant, 24 novembre 2026 — 20261231290000).
 *
 *   node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/facturation/la-facture-dit-a-qui-elle-s-adresse.test.ts
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";

import type pg from "pg";

import { ADRESSE_D_ESSAI, matriculeDEssai } from "../matricule-d-essai.ts";
import { personnesDEssai } from "../personne-d-essai.ts";
import {
  ADMIN,
  pool,
  aBlanc,
  enPersonne,
  passer,
  socle,
  regler,
  unePme,
  jourDe,
  demander,
  type Pme,
} from "./decor-d-avance.ts";

interface FactureA {
  tenant_id: string;
  nom: string;
  matricule: string | null;
  adresse: string | null;
  juridiction: string;
  complet: boolean;
}

/** La montée Basic → Solo d'une société qui a payé Basic d'avance, et qui n'a rien saisi. */
async function unPaiementSansCoordonnees(db: pg.PoolClient): Promise<{ p: Pme; id: string }> {
  const s = await socle(db);
  const ancre = await jourDe(db, -5);
  await regler(db, s, "pme", true);
  const p = await unePme(db, ancre, "basic");
  await passer(db, ancre);
  const r = await demander(db, p, "solo");
  await db.query("reset role");
  await db.query(
    "update identity.organizations set legal_id = null, adresse = null where id = $1",
    [p.tenant],
  );
  return { p, id: r.paiement!.paiement_id };
}

async function factureA(db: pg.PoolClient, id: string): Promise<FactureA> {
  const { rows } = await db.query<{ f: FactureA }>("select public.paiement_facture_a($1) as f", [
    id,
  ]);
  return rows[0]!.f;
}

async function refuse(db: pg.PoolClient, sql: string, args: unknown[], cle: RegExp) {
  await db.query("savepoint refus");
  await assert.rejects(db.query(sql, args), cle);
  await db.query("rollback to savepoint refus");
}

const ACCEPTER = "select public.paiement_cgv_accepter($1, (plateforme.cgv_en_vigueur()).id)";

describe("la facture dit à qui elle s'adresse", { skip: !ADMIN }, () => {
  after(async () => {
    await pool?.end();
  });

  it("sans matricule ni adresse, on ne paie pas ; saisis dans le compte, on paie", async () => {
    await aBlanc(async (db) => {
      const { p, id } = await unPaiementSansCoordonnees(db);
      await enPersonne(db, p.titulaire);
      const avant = await factureA(db, id);
      assert.equal(avant.tenant_id, p.tenant, "la société de la licence");
      assert.equal(avant.complet, false);
      assert.equal(avant.matricule, null);
      await refuse(db, ACCEPTER, [id], /refus\.facturation\.coordonnees_incompletes/);

      // Le dirigeant complète par les portes de son organisation ; la facture les reprendra.
      const mf = matriculeDEssai();
      await db.query("select public.organisation_definir($1, $2, $3, $4)", [
        p.tenant,
        avant.nom,
        mf,
        avant.juridiction,
      ]);
      await refuse(db, ACCEPTER, [id], /refus\.facturation\.coordonnees_incompletes/);
      await db.query("select public.organisation_adresse_poser($1, $2)", [
        p.tenant,
        ADRESSE_D_ESSAI,
      ]);
      const apres = await factureA(db, id);
      assert.equal(apres.complet, true);
      assert.equal(apres.matricule, mf.toUpperCase());
      assert.equal(apres.adresse, ADRESSE_D_ESSAI);
      await db.query(ACCEPTER, [id]);
      await db.query("reset role");
    });
  });

  it("personne d'autre ne lit à qui le paiement s'adresse", async () => {
    await aBlanc(async (db) => {
      const { id } = await unPaiementSansCoordonnees(db);
      const autre = randomUUID();
      await personnesDEssai(db, autre);
      await enPersonne(db, autre);
      await refuse(
        db,
        "select public.paiement_facture_a($1)",
        [id],
        /refus\.introuvable\.paiement/,
      );
      await db.query("reset role");
    });
  });
});
