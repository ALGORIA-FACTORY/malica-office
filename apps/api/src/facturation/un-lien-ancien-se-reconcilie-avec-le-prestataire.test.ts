/**
 * Un lien ancien se réconcilie avec le prestataire (relevé de #381).
 *
 * Un lien « non abouti » n'est qu'un lien ancien : le temps écoulé ne prouve
 * pas que la commande n'a pas été payée (fenêtre fermée avant le retour). Au
 * « Réessayer », l'API interroge le prestataire AVANT d'ouvrir une seconde
 * commande — sinon le client paierait deux fois.
 *
 * Le prestataire est un faux : `fetch` est remplacé pour la durée de l'épreuve,
 * l'adaptateur ClicToPay est le vrai, et chaque appel est compté.
 *
 *   node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/facturation/un-lien-ancien-se-reconcilie-avec-le-prestataire.test.ts
 */
import assert from "node:assert/strict";
import { after, afterEach, beforeEach, describe, it } from "node:test";

import pg from "pg";

import { facturation } from "../depots/facturation.ts";
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

/** Ce que le faux prestataire a reçu, et ce qu'il répond au statut d'une commande. */
const appels: string[] = [];
let statutDeLaCommande = 0;
const vraiFetch = globalThis.fetch;
const vraiEnv = {
  u: process.env["CLICTOPAY_UTILISATEUR"],
  m: process.env["CLICTOPAY_MOT_DE_PASSE"],
};

beforeEach(() => {
  appels.length = 0;
  process.env["CLICTOPAY_UTILISATEUR"] = "marchand-d-essai";
  process.env["CLICTOPAY_MOT_DE_PASSE"] = "secret-d-essai";
  globalThis.fetch = (async (url: string | URL | Request) => {
    const operation = String(url).split("/").pop()!;
    appels.push(operation);
    const corps =
      operation === "register.do"
        ? { orderId: "ORDRE-NEUF", formUrl: "https://page.prestataire.test/ORDRE-NEUF" }
        : { orderStatus: statutDeLaCommande, errorCode: "0" };
    return new Response(JSON.stringify(corps), { status: 200 });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = vraiFetch;
  if (vraiEnv.u === undefined) delete process.env["CLICTOPAY_UTILISATEUR"];
  else process.env["CLICTOPAY_UTILISATEUR"] = vraiEnv.u;
  if (vraiEnv.m === undefined) delete process.env["CLICTOPAY_MOT_DE_PASSE"];
  else process.env["CLICTOPAY_MOT_DE_PASSE"] = vraiEnv.m;
});

/** La tour ouvre ClicToPay ; une montée à payer ; un lien ouvert il y a `minutes` minutes. */
async function unLienOuvert(db: pg.PoolClient, minutes: number) {
  const d = await decor(db, "solo");
  await enPersonne(db, d.operateur, () =>
    db.query(
      "select plateforme.paiement_regler('clictopay', 'https://api.prestataire.test/', 'https://app.test', 'Essai')",
    ),
  );
  const p = await changerDOffre(db, d, "team");
  assert.ok(p);
  await db.query(
    `insert into facturation.paiement_evenements (paiement_id, etat, prestataire, reference, lien, le)
     values ($1, 'lien_cree', 'clictopay', 'ORDRE-ANCIEN', 'https://page.prestataire.test/ORDRE-ANCIEN',
             now() - make_interval(mins => $2))`,
    [p.paiement_id, minutes],
  );
  return { d, paiement: p.paiement_id };
}

const payer = (db: pg.PoolClient, d: Decor, paiement: string) =>
  enPersonne(db, d.titulaire, () => facturation.payerEnLigne(db, paiement, "visa"));

const ttl = async (db: pg.PoolClient) =>
  Number(
    (
      await db.query<{ n: number }>(
        "select (public.abonnement_reglage() ->> 'lien_valide_minutes')::int as n",
      )
    ).rows[0]!.n,
  );

describe("un lien ancien se réconcilie avec le prestataire", { skip: !ADMIN }, () => {
  after(async () => {
    await pool?.end();
  });

  it("non abouti, mais payé chez le prestataire : on constate le paiement, on n'ouvre PAS de seconde commande", async () => {
    await aBlanc(async (db) => {
      const { d, paiement } = await unLienOuvert(db, (await ttl(db)) + 5);
      statutDeLaCommande = 2; // payée chez le prestataire
      const r = await payer(db, d, paiement);
      assert.equal(r.paiement.etat, "paye");
      assert.equal(r.lien, null);
      assert.deepEqual(appels, ["getOrderStatusExtended.do"], "il a demandé, il n'a rien créé");
    });
  });

  it("non abouti et toujours en attente chez le prestataire : une commande neuve, le client réessaie", async () => {
    await aBlanc(async (db) => {
      const { d, paiement } = await unLienOuvert(db, (await ttl(db)) + 5);
      statutDeLaCommande = 0; // créée, jamais payée
      const r = await payer(db, d, paiement);
      assert.equal(r.paiement.etat, "lien_cree");
      assert.equal(r.lien, "https://page.prestataire.test/ORDRE-NEUF");
      assert.deepEqual(appels, ["getOrderStatusExtended.do", "register.do"]);
    });
  });

  it("non abouti et refusé chez le prestataire : une commande neuve aussi", async () => {
    await aBlanc(async (db) => {
      const { d, paiement } = await unLienOuvert(db, (await ttl(db)) + 5);
      statutDeLaCommande = 6; // annulée
      const r = await payer(db, d, paiement);
      assert.equal(r.lien, "https://page.prestataire.test/ORDRE-NEUF");
      assert.deepEqual(appels, ["getOrderStatusExtended.do", "register.do"]);
    });
  });

  it("un lien encore dans sa durée et en attente chez le prestataire : le même lien sert, rien n'est créé", async () => {
    await aBlanc(async (db) => {
      const { d, paiement } = await unLienOuvert(db, 1);
      statutDeLaCommande = 0;
      const r = await payer(db, d, paiement);
      assert.equal(r.lien, "https://page.prestataire.test/ORDRE-ANCIEN");
      assert.deepEqual(appels, ["getOrderStatusExtended.do"]);
    });
  });
});
