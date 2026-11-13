/**
 * Un paiement abandonné se dit (recette du 13 novembre 2026, B2).
 *
 * Un lien ouvert que personne ne conclut restait « lien_cree » pour toujours.
 * Il devient « non_abouti » une fois la durée arrêtée en base écoulée — durée
 * versionnée dans le réglage d'abonnement de la tour, jamais écrite dans le
 * code — et la décision suivante de la tour ne la remet pas à zéro.
 *
 *   node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/facturation/un-paiement-abandonne-se-dit.test.ts
 */
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import pg from "pg";

import { changerDOffre, decor, enPersonne, type Decor } from "./decor-de-facture.ts";

const ADMIN = process.env["DATABASE_URL_ADMIN"];
const pool = ADMIN ? new pg.Pool({ connectionString: ADMIN, max: 1 }) : null;

async function aBlanc(corps: (db: pg.PoolClient) => Promise<void>) {
  const db = await pool!.connect();
  try {
    await db.query("begin");
    await corps(db);
  } finally {
    await db.query("rollback");
    db.release();
  }
}

const etatDe = (db: pg.PoolClient, d: Decor, paiement: string) =>
  enPersonne(db, d.titulaire, async () => {
    const { rows } = await db.query<{ etat: string }>(
      "select etat from facturation.paiements_en_ligne_v where paiement_id = $1",
      [paiement],
    );
    return rows[0]!.etat;
  });

/** Un lien ouvert il y a `minutes` minutes, chez le prestataire. */
async function lienOuvert(db: pg.PoolClient, paiement: string, minutes: number) {
  await db.query(
    `insert into facturation.paiement_evenements (paiement_id, etat, prestataire, reference, lien, le)
     values ($1, 'lien_cree', 'clictopay', 'REF-1', 'https://x.tn', now() - make_interval(mins => $2))`,
    [paiement, minutes],
  );
}

const duree = async (db: pg.PoolClient) =>
  Number(
    (
      await db.query<{ n: number }>(
        "select (public.abonnement_reglage() ->> 'lien_valide_minutes')::int as n",
      )
    ).rows[0]!.n,
  );

describe("un paiement abandonné se dit", { skip: !ADMIN }, () => {
  after(async () => {
    await pool?.end();
  });

  it("la durée vient du réglage de la tour ; un lien plus jeune reste en cours, plus vieux, non abouti", async () => {
    await aBlanc(async (db) => {
      const ttl = await duree(db);
      assert.ok(ttl > 0, "la durée est arrêtée en base");
      const d = await decor(db, "solo");
      const p = await changerDOffre(db, d, "team");
      assert.ok(p);
      assert.equal(await etatDe(db, d, p.paiement_id), "a_payer");

      await lienOuvert(db, p.paiement_id, ttl - 2);
      assert.equal(await etatDe(db, d, p.paiement_id), "lien_cree", "dans la durée : en cours");
    });
    await aBlanc(async (db) => {
      const ttl = await duree(db);
      const d = await decor(db, "solo");
      const p = await changerDOffre(db, d, "team");
      await lienOuvert(db, p!.paiement_id, ttl + 2);
      assert.equal(await etatDe(db, d, p!.paiement_id), "non_abouti", "durée écoulée : non abouti");
    });
  });

  it("changer la durée en base change le verdict, sans déploiement ; une décision de la tour la garde", async () => {
    await aBlanc(async (db) => {
      const d = await decor(db, "solo");
      const p = await changerDOffre(db, d, "team");
      await lienOuvert(db, p!.paiement_id, 30);
      // La tour arrête une durée de dix minutes (une ligne de plus, versionnée).
      await db.query(
        `insert into plateforme.reglages_abonnement
           (report_mois, annuel_ouvert, annuel_mois_offerts, lien_valide_minutes, motif, decide_le)
         select report_mois, annuel_ouvert, annuel_mois_offerts, 10, 'Essai : lien de dix minutes', now() + interval '1 second'
           from plateforme.reglages_abonnement order by decide_le desc limit 1`,
      );
      assert.equal(await duree(db), 10);
      assert.equal(await etatDe(db, d, p!.paiement_id), "non_abouti");

      // Une décision de la tour sur le report ne remet pas la durée à son défaut.
      await enPersonne(db, d.operateur, () =>
        db.query(
          "select plateforme.abonnement_regler(1::smallint, true, 2::smallint, 'Essai : report inchangé')",
        ),
      );
      assert.equal(await duree(db), 10);
    });
  });

  it("un paiement payé reste payé, quel que soit l'âge de son lien", async () => {
    await aBlanc(async (db) => {
      const d = await decor(db, "solo");
      const p = await changerDOffre(db, d, "team");
      await lienOuvert(db, p!.paiement_id, 100000);
      await db.query(
        "insert into facturation.paiement_evenements (paiement_id, etat, prestataire, reference) values ($1, 'paye', 'clictopay', 'CTP-1')",
        [p!.paiement_id],
      );
      assert.equal(await etatDe(db, d, p!.paiement_id), "paye");
    });
  });
});
