/**
 * La désignation a un principal et un repli — ce que la BASE en tient.
 *
 * Décision du dirigeant du 8 novembre 2026 : Claude désigne, DeepSeek prend la
 * main en cas de panne ou de budget épuisé, les deux budgets épuisés on
 * s'arrête. La logique de la chaîne est éprouvée sans base ni réseau
 * (`malica/lecture/designation.test.ts`) ; ici, ce que la base décide :
 *
 *   — la chaîne n'est lue que par le serveur (la dépense d'un fournisseur est
 *     celle de toute la plateforme) ;
 *   — semée telle que décidée : Claude au rang 1, DeepSeek au rang 2 ;
 *   — un maillon est `epuise` dès que la dépense de SA période atteint son
 *     plafond, et la dépense est celle du FOURNISSEUR, au journal ;
 *   — la tour règle un rang (modèle, période, plafond), daté et motivé ; elle
 *     ne peut nommer qu'un modèle tarifé (R8) et jamais deux fois le même
 *     fournisseur ; personne d'autre ne règle ni ne voit ;
 *   — une bascule inscrite au journal se voit dans la tour.
 *
 * Sous les VRAIS rôles (`authenticated`, la personne en claim), dans une
 * transaction toujours annulée : rien ne reste en base.
 *
 *   DATABASE_URL_ADMIN=… node --experimental-strip-types --test src/la-designation-a-un-principal-et-un-repli.test.ts
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";

import pg from "pg";

// Le registre d'abord : il charge les dépôts dans l'ordre que leurs imports croisés exigent.
import "./rpc.ts";
import { capture } from "./depots/capture.ts";
import { tour } from "./depots/tour.ts";
import { lireLaChaine } from "./malica/lecture/designation.ts";
import { personnesDEssai } from "./personne-d-essai.ts";

const ADMIN = process.env["DATABASE_URL_ADMIN"];
const pool = ADMIN ? new pg.Pool({ connectionString: ADMIN, max: 1 }) : null;

interface Monde {
  operateur: string;
  dirigeant: string;
  pme: string;
}

async function aBlanc<T>(corps: (db: pg.PoolClient, m: Monde) => Promise<T>): Promise<T> {
  const db = await pool!.connect();
  try {
    await db.query("begin");
    const [operateur, dirigeant] = [randomUUID(), randomUUID()];
    await personnesDEssai(db, operateur, dirigeant);
    await db.query("insert into app.platform_operators (user_id) values ($1)", [operateur]);
    const { rows } = await db.query<{ id: string }>(
      `insert into identity.organizations (kind, name, jurisdiction, currency)
       values ('pme', 'PME de la chaîne de désignation', 'TN', 'TND') returning id`,
    );
    const pme = rows[0]!.id;
    await db.query(
      "insert into identity.memberships (tenant_id, user_id, role) values ($1, $2, 'dirigeant')",
      [pme, dirigeant],
    );
    return await corps(db, { operateur, dirigeant, pme });
  } finally {
    await db.query("rollback");
    db.release();
  }
}

async function sous(db: pg.PoolClient, personne: string, serveur = false): Promise<void> {
  await db.query("reset role");
  await db.query("select set_config('malica.origine', $1, true)", [serveur ? "serveur" : ""]);
  await db.query("set local role authenticated");
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [personne]);
}

/** Le refus (code et message), ou `null` si l'appel est passé ; le point de reprise survit. */
async function refus(
  db: pg.PoolClient,
  appel: () => Promise<unknown>,
): Promise<{ code: string; message: string } | null> {
  await db.query("savepoint essai");
  try {
    await appel();
    await db.query("release savepoint essai");
    return null;
  } catch (e) {
    await db.query("rollback to savepoint essai");
    const err = e as { code?: string; message?: string };
    return { code: err.code ?? "inconnu", message: err.message ?? "" };
  }
}

const chaine = async (db: pg.PoolClient) => lireLaChaine(await capture.chaineDeDesignation(db));

describe("la chaîne de désignation, en base", { skip: !ADMIN }, () => {
  after(async () => {
    await pool?.end();
  });

  it("n'est lue que par le serveur, et porte la décision : Claude, puis DeepSeek", async () => {
    await aBlanc(async (db, m) => {
      await sous(db, m.dirigeant);
      const r = await refus(db, () => capture.chaineDeDesignation(db));
      assert.equal(r?.code, "42501");
      assert.match(r!.message, /refus\.reserve\.serveur/);

      await sous(db, m.dirigeant, true);
      const c = await chaine(db);
      assert.deepEqual(
        c.map((x) => [x.rang, x.fournisseur]),
        [
          [1, "anthropic"],
          [2, "deepseek"],
        ],
      );
      assert.ok(c[0]!.modele.startsWith("claude-"), "le principal est un modèle Claude");
    });
  });

  it("chaque maillon en vigueur a un tarif en vigueur (R8) : son coût s'inscrit", async () => {
    await aBlanc(async (db) => {
      const { rows } = await db.query<{ modele: string; role: string }>(
        `select m->>'modele' as modele, m->>'role' as role
           from jsonb_array_elements(app.chaine_de_designation()) m
          where not exists (
            select 1 from agents.model_pricing p
             where p.model = m->>'modele' and p.role = m->>'role'
               and p.effective_from <= current_date
               and (p.effective_to is null or p.effective_to >= current_date))`,
      );
      assert.deepEqual(rows, [], "maillon sans tarif : son appel ne laisserait ni coût ni plafond");
    });
  });

  it("un maillon s'épuise sur la dépense de son fournisseur, et pas de l'autre", async () => {
    await aBlanc(async (db, m) => {
      await sous(db, m.dirigeant, true);
      const avant = await chaine(db);
      const depense = (f: string, c: typeof avant) =>
        Number(c.find((x) => x.fournisseur === f)!.depense);

      // Une désignation Claude coûtée au journal : 1,5 $ chez Anthropic.
      await db.query("reset role");
      await db.query(
        `insert into agents.agent_runs (tenant_id, agent, model, sovereign, cost, status, created_by)
         values ($1, 'malica.lecture.designation', $2, false, 1.5, 'ok', $3)`,
        [m.pme, avant[0]!.modele, m.dirigeant],
      );
      await sous(db, m.dirigeant, true);
      const apres = await chaine(db);
      assert.equal(depense("anthropic", apres) - depense("anthropic", avant), 1.5);
      assert.equal(depense("deepseek", apres), depense("deepseek", avant), "l'autre ne bouge pas");

      // La tour coupe Claude (plafond à zéro) : épuisé ; DeepSeek ne l'est pas.
      await sous(db, m.operateur);
      await tour.reglerDesignation(
        db,
        1,
        avant[0]!.modele,
        "chat",
        "jour",
        "0",
        "Essai : Claude coupé",
      );
      await sous(db, m.dirigeant, true);
      const coupe = await chaine(db);
      assert.equal(coupe[0]!.epuise, true);
      assert.equal(coupe[0]!.periode, "jour");
      assert.equal(coupe[1]!.epuise, false);

      // Les deux coupés : les deux épuisés — le serveur s'arrêtera.
      await sous(db, m.operateur);
      await tour.reglerDesignation(
        db,
        2,
        "deepseek-chat",
        "chat",
        "mois",
        "0",
        "Essai : tout coupé",
      );
      await sous(db, m.dirigeant, true);
      assert.deepEqual(
        (await chaine(db)).map((x) => x.epuise),
        [true, true],
      );
    });
  });

  it("la tour règle un rang : un modèle tarifé, deux fournisseurs distincts, un motif", async () => {
    await aBlanc(async (db, m) => {
      // Personne d'autre que l'opérateur ne règle, ni ne voit.
      await sous(db, m.dirigeant);
      for (const appel of [
        () => tour.reglerDesignation(db, 1, "claude-haiku-5-5", "chat", "mois", "5", "x"),
        () => tour.designation(db),
      ]) {
        const r = await refus(db, appel);
        assert.equal(r?.code, "42501");
        assert.match(r!.message, /refus\.reserve\.plateforme/);
      }

      await sous(db, m.operateur);
      const sansTarif = await refus(db, () =>
        tour.reglerDesignation(db, 1, "claude-inexistant", "chat", "mois", "5", "Essai"),
      );
      assert.match(sansTarif!.message, /refus\.designation\.modele_sans_tarif/);

      const memeFournisseur = await refus(db, () =>
        tour.reglerDesignation(db, 1, "deepseek-reasoner", "reasoner", "mois", "5", "Essai"),
      );
      assert.match(memeFournisseur!.message, /refus\.designation\.meme_fournisseur/);

      for (const [periode, plafond, motif] of [
        ["an", "5", "Essai"],
        ["mois", "-1", "Essai"],
        ["mois", "5", "  "],
      ] as const) {
        const r = await refus(db, () =>
          tour.reglerDesignation(db, 1, "claude-haiku-5-5", "chat", periode, plafond, motif),
        );
        assert.match(
          r!.message,
          /refus\.designation\.saisie/,
          `${periode} ${plafond} « ${motif} »`,
        );
      }

      const regle = (await tour.reglerDesignation(
        db,
        1,
        "claude-haiku-5-5",
        "chat",
        "mois",
        "12.5",
        "Essai : Haiku désigne",
      )) as Record<string, unknown>;
      assert.equal(regle["fournisseur"], "anthropic", "le fournisseur vient du tarif");
      assert.ok(regle["decide_le"], "daté");
      assert.equal(regle["decide_par"], undefined, "qui a décidé ne sort pas");

      const etat = (await tour.designation(db)) as {
        maillons: Array<{ rang: number; modele: string; plafond: number; motif: string }>;
        modeles: Array<{ modele: string }>;
      };
      assert.equal(etat.maillons[0]!.modele, "claude-haiku-5-5");
      assert.equal(Number(etat.maillons[0]!.plafond), 12.5);
      assert.equal(etat.maillons[0]!.motif, "Essai : Haiku désigne");
      const choix = etat.modeles.map((x) => x.modele);
      for (const attendu of ["claude-sonnet-5-5", "claude-haiku-5-5", "deepseek-chat"])
        assert.ok(choix.includes(attendu), `${attendu} se choisit dans la tour`);

      // Rien ne se réécrit.
      await db.query("reset role");
      const r = await refus(db, () =>
        db.query("update plateforme.reglages_designation set plafond_usd = 1"),
      );
      assert.ok(r, "une décision ne se réécrit pas");
    });
  });

  it("une bascule inscrite au journal se voit dans la tour, avec son motif", async () => {
    await aBlanc(async (db, m) => {
      await sous(db, m.dirigeant, true);
      await capture.journaliserAgent(db, {
        tenantId: m.pme,
        agent: "malica.lecture.designation",
        model: "claude-sonnet-5-5",
        role: "chat",
        status: "error",
        latencyMs: 0,
        erreur: "bascule.budget",
      });
      await capture.journaliserAgent(db, {
        tenantId: m.pme,
        agent: "malica.lecture.designation",
        model: "deepseek-chat",
        role: "chat",
        status: "degraded",
        latencyMs: 1200,
        tokensIn: 1000,
        tokensOut: 100,
        erreur: "repli.budget",
      });
      await sous(db, m.operateur);
      const etat = (await tour.designation(db)) as {
        bascules: Array<{ modele: string; statut: string; motif: string }>;
      };
      // D'autres épreuves peuvent journaliser en même temps : on cherche les nôtres.
      for (const [modele, statut, motif] of [
        ["claude-sonnet-5-5", "error", "bascule.budget"],
        ["deepseek-chat", "degraded", "repli.budget"],
      ])
        assert.ok(
          etat.bascules.some(
            (b) => b.modele === modele && b.statut === statut && b.motif === motif,
          ),
          `${modele} ${statut} ${motif}`,
        );
    });
  });
});
