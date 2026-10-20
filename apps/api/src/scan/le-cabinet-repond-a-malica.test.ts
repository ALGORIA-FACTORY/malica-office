/**
 * Le cabinet répond aux questions de Malica.
 *
 * ================================================================= POURQUOI
 *
 * 11 octobre 2026 : « aussi la réponse du comptable aux questions envoyées
 * par Malica ».
 *
 * La question — « votre électricité fait trois fois le mois ordinaire » — est
 * partagée, donc visible du cabinet. Et `charge_question_answer` n'autorisait
 * que les MEMBRES du dossier : l'expert voyait une question qu'il ne pouvait
 * pas trancher, alors que c'est lui qui sait si une facture de septembre est
 * exceptionnelle ou douteuse.
 *
 * Ces épreuves tiennent les trois choses qui comptent : le mandat autorise,
 * l'étranger est refusé, et l'on sait qui a répondu.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "../auth.ts";
import { fermerLePool, sousIdentite } from "../db.ts";
import { executerRpc } from "../rpc.ts";

import { matriculeDEssai } from "../matricule-d-essai.ts";
const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

describe("la réponse à une question de charge", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `question-${Date.now()}`;
  let dirigeant: Utilisateur;
  let expert: Utilisateur;
  let etranger: Utilisateur;
  let pme = "";
  let cabinet = "";
  let packId = "";

  const parMoi = (u: Utilisateur, depot: string, methode: string, ...args: unknown[]) =>
    sousIdentite(u.id, (db) => executerRpc(db, { depot, methode, args }));

  const admin = async <T>(f: (p: pg.Pool) => Promise<T>) => {
    const p = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
    try {
      return await f(p);
    } finally {
      await p.end();
    }
  };

  /** La question telle que Malica la poserait, puis la réponse. */
  const repondre = (u: Utilisateur, reponse: "exceptionnel" | "a_verifier") =>
    parMoi(u, "charges", "answer", {
      tenantId: pme,
      period: "2026-09",
      familleCode: "ENERGIE",
      observed: "3200.000",
      baseline: "1050.000",
      deviationRatio: "3.0476",
      thresholdCode: "ecart_charge",
      packVersionId: packId,
      answer: reponse,
    });

  const faits = () =>
    admin(async (p) => {
      const { rows } = await p.query<{
        answer: string;
        answered_side: string | null;
        seq: number;
      }>(
        `select answer, answered_side, seq from collab.charge_questions
          where tenant_id = $1 order by seq`,
        [pme],
      );
      return rows;
    });

  before(async () => {
    const d = await creerCompte(`${marque}-pme@essai.local`, "MotDePasseTresLong2026!");
    const e = await creerCompte(`${marque}-cab@essai.local`, "MotDePasseTresLong2026!");
    const x = await creerCompte(`${marque}-autre@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(d && e && x);
    dirigeant = d;
    expert = e;
    etranger = x;

    pme = await sousIdentite(dirigeant.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('pme', 'ALGORIA FACTORY SUARL', 'autonome',
                                           '${matriculeDEssai("A", "M")}', 'TN', 'TND') as id`,
      );
      return rows[0]!.id;
    });
    cabinet = await sousIdentite(expert.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('cabinet', 'AUDICORP', 'autonome',
                                           '${matriculeDEssai("B", "C")}', 'TN', 'TND') as id`,
      );
      return rows[0]!.id;
    });

    // Le mandat, actif et daté : c'est lui, et lui seul, qui ouvre la porte.
    await admin((p) =>
      p.query(
        `insert into identity.engagements (cabinet_org_id, pme_org_id, status, starts_on)
         values ($1, $2, 'actif', current_date - 1)`,
        [cabinet, pme],
      ),
    );

    packId = await admin(async (p) => {
      const { rows } = await p.query<{ id: string }>(
        `select id from ref.jurisdiction_packs where jurisdiction = 'TN'
          order by effective_from desc limit 1`,
      );
      return rows[0]!.id;
    });
  });

  after(async () => {
    await admin((p) =>
      p.query(
        `update identity.organizations set archived_at = now(),
                archived_reason = 'fixture de test automatisé' where id = any($1)`,
        [[pme, cabinet]],
      ),
    );
    await fermerLePool();
  });

  it("l'expert sous mandat peut trancher, et sa réponse est marquée « cabinet »", async () => {
    await repondre(expert, "exceptionnel");
    const h = await faits();
    assert.equal(h.length, 1);
    assert.equal(h[0]!.answer, "exceptionnel");
    assert.equal(
      h[0]!.answered_side,
      "cabinet",
      "« exceptionnel » dit par l'expert est un avis professionnel, pas une déclaration",
    );
  });

  it("le dirigeant aussi, et sa réponse est marquée « pme »", async () => {
    await repondre(dirigeant, "a_verifier");
    const h = await faits();
    assert.equal(h.length, 2, "R7 : la seconde réponse s'AJOUTE, elle n'écrase pas la première");
    assert.equal(h[1]!.answered_side, "pme");
    assert.deepEqual(
      h.map((f) => f.answer),
      ["exceptionnel", "a_verifier"],
      "les deux avis restent lisibles, dans l'ordre",
    );
  });

  it("et la dernière est celle qui vaut, sans que l'autre disparaisse", async () => {
    const liste = (await parMoi(dirigeant, "charges", "questions", pme)) as Array<{
      answer: string | null;
      answeredSide: string | null;
    }>;
    // La vue marque `courante` ; la lecture rend la plus récente en tête.
    assert.equal(liste[0]!.answer, "a_verifier");
    assert.equal(liste[0]!.answeredSide, "pme");
  });

  it("un tiers sans mandat est refusé, et c'est la base qui refuse", async () => {
    await assert.rejects(
      () => repondre(etranger, "exceptionnel"),
      /organisation non autorisee/,
      "sans ce refus, n'importe quel compte trancherait les charges d'un dossier qui n'est pas le sien",
    );
  });
});
