/**
 * L'essai gratuit (décision du 25 novembre 2026 — 20261231350000).
 *
 *   - la tour règle le nombre de jours ; 0 = pas d'essai ; il ne touche que les NOUVELLES entrées ;
 *   - pendant l'essai, aucune facture ne naît : la société s'ouvre sans payer ;
 *   - passer à l'abonnement se paie d'abord ; au paiement, l'essai se clôt et la première base
 *     naît réglée, datée du jour (la date anniversaire) ;
 *   - un essai échu et non payé ferme le dossier et ne fabrique aucune dette ;
 *   - une société amenée par une comptabilité n'a pas d'essai ; une prise en charge le clôt ;
 *   - la fin proche et la fin se disent une fois chacune au titulaire.
 *
 *   node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/facturation/l-essai-gratuit-ouvre-sans-payer.test.ts
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";

import type pg from "pg";

import { personnesDEssai } from "../personne-d-essai.ts";

import {
  ADMIN,
  aBlanc,
  demander,
  enPersonne,
  facturesDuTitulaire,
  jourDe,
  passer,
  payer,
  pool,
  regler,
  resteDu,
  socle,
  type Pme,
  type Socle,
} from "./decor-d-avance.ts";
import { uneOrganisation } from "./decor-de-facture.ts";

/** La tour règle l'essai à `jours` (le reste de l'abonnement tel quel). */
async function reglerLEssai(db: pg.PoolClient, s: Socle, jours: number) {
  await enPersonne(db, s.operateur);
  await db.query(
    "select plateforme.abonnement_regler(1::smallint, true, 2::smallint, $1::smallint, 14::smallint, 'Essai gratuit')",
    [jours],
  );
  await db.query("reset role");
}

/** Une PME qui s'inscrit seule, née le `le` par la porte de naissance. */
async function uneEntree(db: pg.PoolClient, le: string, creePar?: string): Promise<Pme> {
  const titulaire = randomUUID();
  await personnesDEssai(db, titulaire);
  // La facture nomme son destinataire : le titulaire a un nom.
  await db.query("insert into identity.profiles (user_id, display_name) values ($1, $2)", [
    titulaire,
    "Amira Trabelsi",
  ]);
  const tenant = await uneOrganisation(db, "pme", "Nouvelle entrée");
  if (creePar) {
    await db.query("update identity.organizations set created_by = $1 where id = $2", [
      creePar,
      tenant,
    ]);
  }
  await db.query(
    "insert into identity.memberships (tenant_id, user_id, role) values ($1, $2, 'dirigeant')",
    [tenant, titulaire],
  );
  const { rows } = await db.query<{ l: string }>(
    "select facturation.licence_naitre($1, $2, null, $3::date) as l",
    [tenant, titulaire, le],
  );
  return { titulaire, tenant, licence: rows[0]!.l };
}

async function essai(db: pg.PoolClient, licence: string) {
  await db.query("reset role");
  const { rows } = await db.query<{
    jours: number;
    converti_le: string | null;
    motif_fin: string | null;
  }>("select jours, converti_le::text, motif_fin from facturation.essais where licence_id = $1", [
    licence,
  ]);
  return rows[0] ?? null;
}

async function active(db: pg.PoolClient, tenant: string): Promise<boolean> {
  await db.query("reset role");
  const { rows } = await db.query<{ a: boolean }>("select app.licence_active($1) as a", [tenant]);
  return rows[0]!.a;
}

describe("l'essai gratuit ouvre sans payer", { skip: !ADMIN }, () => {
  after(async () => {
    await pool?.end();
  });

  it("la tour le règle ; il ne touche que les nouvelles entrées", async () => {
    await aBlanc(async (db) => {
      const s = await socle(db);
      const jour = await jourDe(db);
      const avant = await uneEntree(db, jour);
      assert.equal(await essai(db, avant.licence), null, "sans réglage, pas d'essai");

      await reglerLEssai(db, s, 14);
      const apres = await uneEntree(db, jour);
      const e = await essai(db, apres.licence);
      assert.equal(e?.jours, 14);
      assert.equal(await essai(db, avant.licence), null, "l'ancienne licence ne change pas");

      // Un client ne règle pas l'essai.
      await enPersonne(db, apres.titulaire);
      await db.query("savepoint refus");
      await assert.rejects(
        db.query(
          "select plateforme.abonnement_regler(1::smallint, true, 2::smallint, 30::smallint, 14::smallint, 'x')",
        ),
        /refus\.reserve\.plateforme/,
      );
      await db.query("rollback to savepoint refus");
      await db.query("reset role");
    });
  });

  it("pendant l'essai, aucune facture ; le passage se paie d'abord et la première base naît réglée", async () => {
    await aBlanc(async (db) => {
      const s = await socle(db);
      await regler(db, s, "pme", true);
      await reglerLEssai(db, s, 14);
      const jour = await jourDe(db);
      const p = await uneEntree(db, await jourDe(db, -5));
      for (let d = -5; d <= 0; d++) await passer(db, await jourDe(db, d));
      assert.deepEqual(await facturesDuTitulaire(db, p.licence), [], "rien n'est dû en essai");
      assert.equal(await active(db, p.tenant), true);

      // Interrompre l'essai : payer plus tôt, en un geste.
      const demande = await demander(db, p, "basic");
      assert.equal(demande.change, false);
      assert.ok(demande.paiement, "le passage se paie d'abord");
      assert.equal(
        (await essai(db, p.licence))?.converti_le,
        null,
        "rien n'a changé avant paiement",
      );

      await payer(db, p, demande.paiement!.paiement_id);
      const e = await essai(db, p.licence);
      assert.deepEqual([e?.converti_le, e?.motif_fin], [jour, "paiement"]);
      const factures = await facturesDuTitulaire(db, p.licence);
      assert.equal(factures.length, 1);
      assert.equal(factures[0]!.couvre_du, jour, "la date anniversaire est le jour du paiement");
      assert.equal(await resteDu(db, factures[0]!.id), 0, "la première base naît réglée");
      assert.equal(Number(demande.paiement!.montant_ttc) > 0, true);

      // Le robot du lendemain ne refacture rien.
      await passer(db, await jourDe(db, 1));
      assert.equal((await facturesDuTitulaire(db, p.licence)).length, 1);
    });
  });

  it("un essai échu et non payé ferme le dossier sans fabriquer de dette, et se dit une fois", async () => {
    await aBlanc(async (db) => {
      const s = await socle(db);
      await regler(db, s, "pme", true);
      await reglerLEssai(db, s, 7);
      const p = await uneEntree(db, await jourDe(db, -10));
      for (let d = -10; d <= 0; d++) await passer(db, await jourDe(db, d));
      assert.deepEqual(await facturesDuTitulaire(db, p.licence), [], "aucune dette après l'essai");
      assert.equal(await active(db, p.tenant), false, "le dossier est fermé");

      await enPersonne(db, p.titulaire);
      const { rows } = await db.query<{ e: { etat: string; jours_restants: number } }>(
        "select public.mon_essai($1) as e",
        [p.tenant],
      );
      assert.deepEqual([rows[0]!.e.etat, rows[0]!.e.jours_restants], ["termine", 0]);
      await db.query("reset role");

      await db.query("set local role malica_api");
      const { rows: n1 } = await db.query<{ n: number }>(
        "select notif.prevenir_les_abonnements() as n",
      );
      const { rows: n2 } = await db.query<{ n: number }>(
        "select notif.prevenir_les_abonnements() as n",
      );
      await db.query("reset role");
      assert.equal(n2[0]!.n, 0, "l'avis ne se répète pas");
      const { rows: envois } = await db.query<{ code: string; canal: string }>(
        `select code, canal from notif.envois
          where sujet_cle = $1 and destinataire = $2 order by canal`,
        [`essai:${p.licence}:essai.termine`, p.titulaire],
      );
      assert.ok(n1[0]!.n >= 1);
      assert.deepEqual(
        envois.map((x) => x.canal),
        ["app", "email"],
      );

      // Le paiement rouvre le dossier.
      const demande = await demander(db, p, "basic");
      await payer(db, p, demande.paiement!.paiement_id);
      assert.equal(await active(db, p.tenant), true);
    });
  });

  it("une société amenée par une comptabilité n'a pas d'essai ; une prise en charge le clôt", async () => {
    await aBlanc(async (db) => {
      const s = await socle(db);
      await reglerLEssai(db, s, 14);
      const jour = await jourDe(db);

      const expert = randomUUID();
      await personnesDEssai(db, expert);
      const cabinet = await uneOrganisation(db, "cabinet", "Cabinet d'essai");
      await db.query(
        "insert into identity.memberships (tenant_id, user_id, role) values ($1, $2, 'expert')",
        [cabinet, expert],
      );
      const amenee = await uneEntree(db, jour, expert);
      assert.equal(await essai(db, amenee.licence), null);

      const seule = await uneEntree(db, jour);
      assert.ok(await essai(db, seule.licence));
      await db.query(
        `insert into identity.engagements (pme_org_id, cabinet_org_id, status, starts_on)
         values ($1, $2, 'actif', $3::date)`,
        [seule.tenant, cabinet, jour],
      );
      await db.query(
        `insert into facturation.acces
           (tenant_id, licence_id, canal, cabinet_tenant_id, offre_code, offre_depuis, statut,
            propose_le, propose_par, repondu_le, repondu_par, effet_du)
         values ($1, $2, 'cabinet', $3, 'solo', $4::date, 'actif', $4::date, $5, $4::date, $6,
                 $4::date)`,
        [seule.tenant, seule.licence, cabinet, jour, expert, seule.titulaire],
      );
      const e = await essai(db, seule.licence);
      assert.deepEqual([e?.converti_le, e?.motif_fin], [jour, "prise_en_charge"]);
    });
  });

  it("un essai ne se réécrit pas", async () => {
    await aBlanc(async (db) => {
      const s = await socle(db);
      await reglerLEssai(db, s, 14);
      const p = await uneEntree(db, await jourDe(db));
      await db.query("savepoint refus");
      await assert.rejects(
        db.query("update facturation.essais set jours = 90 where licence_id = $1", [p.licence]),
        /refus\.essai\.fige/,
      );
      await db.query("rollback to savepoint refus");
    });
  });
});
