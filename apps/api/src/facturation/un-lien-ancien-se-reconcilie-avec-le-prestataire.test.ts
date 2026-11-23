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
/** Ce que le faux prestataire rend d'une commande payée : son numéro et son montant. */
let commande = { numero: "", unites: 0 };
/** Le faux prestataire est en panne : chaque appel échoue. */
let enPanne = false;
const vraiFetch = globalThis.fetch;
const vraiEnv = {
  u: process.env["CLICTOPAY_UTILISATEUR"],
  m: process.env["CLICTOPAY_MOT_DE_PASSE"],
};

beforeEach(() => {
  appels.length = 0;
  enPanne = false;
  process.env["CLICTOPAY_UTILISATEUR"] = "marchand-d-essai";
  process.env["CLICTOPAY_MOT_DE_PASSE"] = "secret-d-essai";
  globalThis.fetch = (async (url: string | URL | Request) => {
    const operation = String(url).split("/").pop()!;
    appels.push(operation);
    if (enPanne) throw new TypeError("fetch failed");
    const corps =
      operation === "register.do"
        ? { orderId: "ORDRE-NEUF", formUrl: "https://test.clictopay.com/pay/ORDRE-NEUF" }
        : {
            orderStatus: statutDeLaCommande,
            errorCode: "0",
            orderNumber: commande.numero,
            amount: commande.unites,
          };
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
      "select plateforme.paiement_regler('clictopay', 'https://test.clictopay.com/payment/rest/', 'https://app.test', 'Essai')",
    ),
  );
  const p = await changerDOffre(db, d, "team");
  assert.ok(p);
  await db.query(
    `insert into facturation.paiement_evenements (paiement_id, etat, prestataire, reference, lien, le)
     values ($1, 'lien_cree', 'clictopay', 'ORDRE-ANCIEN', 'https://test.clictopay.com/pay/ORDRE-ANCIEN',
             now() - make_interval(mins => $2))`,
    [p.paiement_id, minutes],
  );
  commande = {
    numero: p.paiement_id.replace(/-/g, ""),
    unites: Number(
      (
        await db.query<{ u: string }>(
          `select trunc(p.montant_ttc * power(10::numeric, d.exposant))::text as u
             from facturation.paiements_en_ligne p join ref.devises d on d.code = p.devise
            where p.id = $1`,
          [p.paiement_id],
        )
      ).rows[0]!.u,
    ),
  };
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
      assert.equal(r.lien, "https://test.clictopay.com/pay/ORDRE-NEUF");
      assert.deepEqual(appels, ["getOrderStatusExtended.do", "register.do"]);
    });
  });

  it("non abouti et refusé chez le prestataire : une commande neuve aussi", async () => {
    await aBlanc(async (db) => {
      const { d, paiement } = await unLienOuvert(db, (await ttl(db)) + 5);
      statutDeLaCommande = 6; // annulée
      const r = await payer(db, d, paiement);
      assert.equal(r.lien, "https://test.clictopay.com/pay/ORDRE-NEUF");
      assert.deepEqual(appels, ["getOrderStatusExtended.do", "register.do"]);
    });
  });

  it("un lien encore dans sa durée et en attente chez le prestataire : le même lien sert, rien n'est créé", async () => {
    await aBlanc(async (db) => {
      const { d, paiement } = await unLienOuvert(db, 1);
      statutDeLaCommande = 0;
      const r = await payer(db, d, paiement);
      assert.equal(r.lien, "https://test.clictopay.com/pay/ORDRE-ANCIEN");
      assert.deepEqual(appels, ["getOrderStatusExtended.do"]);
    });
  });
  it("la tour change de prestataire après le paiement : le lien payé est quand même constaté, chez celui qui l'a créé", async () => {
    await aBlanc(async (db) => {
      const { d, paiement } = await unLienOuvert(db, 1);
      await enPersonne(db, d.operateur, () =>
        db.query("select plateforme.paiement_regler('aucun', null, null, 'fermé')"),
      );
      statutDeLaCommande = 2;
      const p = await enPersonne(db, d.titulaire, () => facturation.verifierPaiement(db, paiement));
      assert.equal(p.etat, "paye");
      assert.deepEqual(appels, ["getOrderStatusExtended.do"]);
    });
  });

  it("deux liens ouverts, l'ancien est payé : on le trouve, rien n'est payé deux fois", async () => {
    await aBlanc(async (db) => {
      const { d, paiement } = await unLienOuvert(db, (await ttl(db)) + 5);
      statutDeLaCommande = 0;
      const r1 = await payer(db, d, paiement);
      assert.equal(r1.lien, "https://test.clictopay.com/pay/ORDRE-NEUF", "une commande neuve");
      appels.length = 0;
      // Le client paie finalement sur l'ancienne page, restée ouverte.
      globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        const operation = String(url).split("/").pop()!;
        appels.push(operation);
        const ordre = new URLSearchParams(String(init?.body ?? "")).get("orderId");
        return new Response(
          JSON.stringify({
            orderStatus: ordre === "ORDRE-ANCIEN" ? 2 : 0,
            errorCode: "0",
            orderNumber: commande.numero,
            amount: commande.unites,
          }),
          { status: 200 },
        );
      }) as typeof fetch;
      const p = await enPersonne(db, d.titulaire, () => facturation.verifierPaiement(db, paiement));
      assert.equal(p.etat, "paye");
      const n = await db.query(
        "select reference from facturation.paiement_evenements where paiement_id = $1 and etat = 'paye'",
        [paiement],
      );
      assert.deepEqual(
        n.rows.map((r) => r.reference),
        ["ORDRE-ANCIEN"],
      );
    });
  });

  it("« payé » pour un autre montant : rien ne se solde, la tour le lit au journal", async () => {
    await aBlanc(async (db) => {
      const { d, paiement } = await unLienOuvert(db, 1);
      statutDeLaCommande = 2;
      commande = { ...commande, unites: 1 };
      const p = await enPersonne(db, d.titulaire, () => facturation.verifierPaiement(db, paiement));
      assert.notEqual(p.etat, "paye");
      const j = await db.query(
        "select 1 from audit.event_log where object_id = $1 and action = 'paiement.anomalie'",
        [paiement],
      );
      assert.equal(j.rows.length, 1);
      // La base, elle aussi, refuse un « payé » au mauvais montant.
      await assert.rejects(
        enPersonne(db, d.titulaire, () =>
          db.query(
            "select public.paiement_inscrire($1, 'paye', 'clictopay', 'ORDRE-ANCIEN', null, '{\"unites_encaissees\": \"1\"}')",
            [paiement],
          ),
        ),
        /paiement\.montant_different/,
      );
    });
  });

  it("le prestataire ne répond pas sur un lien ouvert : pas de seconde commande à l'aveugle, une clé à l'écran", async () => {
    await aBlanc(async (db) => {
      const { d, paiement } = await unLienOuvert(db, (await ttl(db)) + 5);
      enPanne = true;
      await assert.rejects(payer(db, d, paiement), /refus\.paiement\.prestataire_indisponible/);
      assert.deepEqual(appels, ["getOrderStatusExtended.do"], "rien n'a été créé");
    });
  });
  it("la notification ne désigne le payeur que pour un lien de ce prestataire, sous cette référence, encore à constater", async () => {
    await aBlanc(async (db) => {
      const { d, paiement } = await unLienOuvert(db, 1);
      const qui = async (prestataire: string, reference: string) =>
        (
          await db.query<{ u: string | null }>(
            "select public.paiement_payeur_a_relire($1, $2, $3) as u",
            [paiement, prestataire, reference],
          )
        ).rows[0]!.u;
      assert.equal(await qui("clictopay", "ORDRE-ANCIEN"), d.titulaire);
      assert.equal(await qui("clictopay", "DEVINE"), null);
      assert.equal(await qui("flouci", "ORDRE-ANCIEN"), null);
      statutDeLaCommande = 2;
      await enPersonne(db, d.titulaire, () => facturation.verifierPaiement(db, paiement));
      assert.equal(await qui("clictopay", "ORDRE-ANCIEN"), null, "payé : plus rien à relire");
      const droits = await db.query<{ ok: boolean }>(
        "select has_function_privilege('authenticated', 'public.paiement_payeur_a_relire(uuid, text, text)', 'execute') as ok",
      );
      assert.equal(droits.rows[0]!.ok, false, "réservée à l'API, jamais à un client");
    });
  });
});
