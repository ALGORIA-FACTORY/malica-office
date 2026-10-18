/**
 * La grille publiée le 17 octobre est celle que la base calcule.
 *
 * ================================================= POURQUOI ELLE EXISTE
 *
 * Le 17 octobre 2026, la grille d'abonnement a été publiée avec cinq scénarios
 * chiffrés : une licence, un nombre d'organisations, un nombre de sièges, un
 * prix mensuel et un droit de lectures. Ces chiffres sont des ARBITRAGES
 * COMMERCIAUX — ils se recopient, ils ne se corrigent pas pour faire passer une
 * épreuve. Si la base rend autre chose, c'est la grille publiée ou le
 * paramétrage qui est faux, et c'est exactement ce que cette épreuve existe
 * pour dire.
 *
 * Le point n'est donc pas de tester une formule : les nombres attendus ci-dessous
 * sont ceux de la grille, et `facturation.droits_v` les recalcule depuis
 * le paramétrage de l'offre, sans qu'aucun montant ne soit lu dans le code mesuré
 * (R4). Une migration qui change un prix, un siège inclus ou un droit de lecture
 * fait rougir cette épreuve — et c'est voulu : une grille publiée ne bouge pas
 * en silence.
 *
 * Mesuré le 18 octobre 2026, sur une base neuve : cinq scénarios, cinq « OK ».
 *
 * Tout se passe dans une transaction annulée : rien n'est écrit, donc rien à
 * archiver (R7).
 *
 *   node --experimental-strip-types --test src/facturation/la-grille-du-17-octobre.test.ts
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";

import pg from "pg";

const ADMIN = process.env["DATABASE_URL_ADMIN"];
const pool = ADMIN ? new pg.Pool({ connectionString: ADMIN, max: 1 }) : null;

interface Scenario {
  offre: string;
  organisations: number;
  sieges: number;
  /** Le prix mensuel hors taxe publié, en dinars. */
  prix: string;
  /** Le droit de lectures publié, par mois. */
  lectures: number;
}

/** Les cinq scénarios publiés le 17 octobre 2026. */
const GRILLE: Scenario[] = [
  { offre: "team", organisations: 1, sieges: 4, prix: "45.000", lectures: 210 },
  { offre: "team", organisations: 1, sieges: 6, prix: "61.000", lectures: 260 },
  { offre: "team", organisations: 1, sieges: 10, prix: "93.000", lectures: 360 },
  { offre: "premium", organisations: 2, sieges: 5, prix: "57.000", lectures: 265 },
  { offre: "premium", organisations: 3, sieges: 8, prix: "110.000", lectures: 460 },
];

interface Droits {
  offre_code: string;
  organisations: number;
  sieges_occupes: number;
  lectures_droit: number;
  prix_mensuel_ht: string;
}

async function ajouterCollaborateur(db: pg.PoolClient, tenant: string): Promise<void> {
  await db.query(
    "insert into identity.memberships (tenant_id, user_id, role) values ($1, $2, 'collaborateur')",
    [tenant, randomUUID()],
  );
}

/**
 * Une licence, ses organisations, et `sieges` collaborateurs sur la première :
 * c'est la fixture exacte du script de vérification de la livraison.
 */
async function monter(
  db: pg.PoolClient,
  offre: string,
  organisations: number,
  sieges: number,
): Promise<string> {
  const titulaire = randomUUID();
  const { rows } = await db.query<{ id: string }>(
    `insert into facturation.licences (titulaire, offre_code, offre_depuis)
     values ($1, $2, date '2026-10-17') returning id`,
    [titulaire, offre],
  );
  const licence = rows[0]!.id;
  for (let j = 1; j <= organisations; j++) {
    const org = await db.query<{ id: string }>(
      `insert into identity.organizations (kind, name, jurisdiction, currency)
       values ('pme', $1, 'TN', 'TND') returning id`,
      [`SOC ${offre}-${j}`],
    );
    const tenant = org.rows[0]!.id;
    await db.query(
      "insert into identity.memberships (tenant_id, user_id, role) values ($1, $2, 'dirigeant')",
      [tenant, titulaire],
    );
    await db.query(
      "insert into facturation.licence_organisations (licence_id, tenant_id) values ($1, $2)",
      [licence, tenant],
    );
    if (j === 1) {
      for (let k = 0; k < sieges; k++) await ajouterCollaborateur(db, tenant);
    }
  }
  return licence;
}

async function droits(db: pg.PoolClient, licence: string): Promise<Droits> {
  const { rows } = await db.query<Droits>(
    `select offre_code, organisations, sieges_occupes, lectures_droit, prix_mensuel_ht
       from facturation.droits_v where licence_id = $1`,
    [licence],
  );
  assert.equal(rows.length, 1, "la vue des droits rend une ligne par licence");
  return rows[0]!;
}

describe("la grille du 17 octobre est celle que la base calcule", { skip: !ADMIN }, () => {
  after(async () => {
    await pool?.end();
  });

  async function dansUneTransaction(corps: (db: pg.PoolClient) => Promise<void>): Promise<void> {
    const db = await pool!.connect();
    try {
      await db.query("begin");
      await corps(db);
    } finally {
      await db.query("rollback");
      db.release();
    }
  }

  for (const s of GRILLE) {
    it(`${s.offre}, ${s.organisations} organisation(s), ${s.sieges} sièges : ${s.prix} DT et ${s.lectures} lectures`, async () => {
      await dansUneTransaction(async (db) => {
        const d = await droits(db, await monter(db, s.offre, s.organisations, s.sieges));

        assert.equal(d.organisations, s.organisations);
        assert.equal(d.sieges_occupes, s.sieges);
        // Les deux nombres de la grille publiée. Pas un de plus, pas un de moins.
        assert.equal(Number(d.prix_mensuel_ht), Number(s.prix), "le prix mensuel hors taxe");
        assert.equal(d.lectures_droit, s.lectures, "le droit de lectures");
      });
    });
  }

  it("une licence Team sans siège rend 160 lectures à 29 DT", async () => {
    await dansUneTransaction(async (db) => {
      const d = await droits(db, await monter(db, "team", 1, 0));
      assert.equal(d.offre_code, "team");
      assert.equal(Number(d.prix_mensuel_ht), 29);
      assert.equal(d.lectures_droit, 160);
    });
  });

  it("trois sièges de plus : 160 + 25 = 185 lectures, 29 + 8 = 37 DT", async () => {
    // Les sièges se paient et se lisent ensemble : un siège ajouté ne change pas
    // seulement la facture, il élargit aussi le droit de lectures.
    await dansUneTransaction(async (db) => {
      const d = await droits(db, await monter(db, "team", 1, 3));
      assert.equal(d.sieges_occupes, 3);
      assert.equal(d.lectures_droit, 185);
      assert.equal(Number(d.prix_mensuel_ht), 37);
    });
  });

  it("le plafond de sièges mord : Team compte 10 places, la 11ᵉ est refusée", async () => {
    await dansUneTransaction(async (db) => {
      const licence = await monter(db, "team", 1, 10);
      const { rows } = await db.query<{ tenant_id: string }>(
        "select tenant_id from facturation.licence_organisations where licence_id = $1",
        [licence],
      );
      assert.equal((await droits(db, licence)).sieges_occupes, 10, "les dix premières passent");

      await db.query("savepoint onzieme");
      await assert.rejects(
        ajouterCollaborateur(db, rows[0]!.tenant_id),
        (e: { code?: string }) => {
          // 23514 : check_violation. Le refus vient de la base, pas de l'écran.
          assert.equal(e.code, "23514");
          return true;
        },
        "la 11ᵉ place doit être refusée",
      );
      await db.query("rollback to savepoint onzieme");

      assert.equal(
        (await droits(db, licence)).sieges_occupes,
        10,
        "et le refus ne laisse aucune place occupée en plus",
      );
    });
  });
});
