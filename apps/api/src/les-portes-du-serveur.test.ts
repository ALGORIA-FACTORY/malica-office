/**
 * Les portes du serveur — les trois critiques de la campagne du 21 octobre 2026.
 *
 *   ANO-001 — un collaborateur ne s'affecte pas un dossier : affecter est un
 *             geste de l'expert, en fonction et en politique.
 *   ANO-002 — une PME n'écrit pas une lecture : les étapes internes de la
 *             lecture ne sont plus servies au client, et la base refuse de
 *             les écrire hors d'une transaction du serveur.
 *   ANO-003 — une lecture en cours ne se rejoint que par qui voit la pièce.
 *
 * Par HTTP, à travers l'application réelle, comme l'appelant malveillant de
 * la campagne : c'est ce qu'il voyait, c'est ce qui doit changer.
 */
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, emettreJeton, type Utilisateur } from "./auth.ts";
import { fermerLePool, sousIdentite } from "./db.ts";
import { identite } from "./depots/identite.ts";
import { registre } from "./malica/lecture/lectures-en-cours.ts";
import { matriculeDEssai } from "./matricule-d-essai.ts";
import { contratRpc, executerRpc } from "./rpc.ts";

const BASE_CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["JWT_SECRET"] && process.env["DATABASE_URL_ADMIN"],
);

describe("les portes du serveur", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `portes-${Date.now()}`;
  const legalId = matriculeDEssai();
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
  let base = "";
  let arret: (() => Promise<void>) | null = null;
  let dirigeant: Utilisateur;
  let etranger: Utilisateur;
  let expert: Utilisateur;
  let collaborateur: Utilisateur;
  let pme = "";
  let cabinet = "";
  let piece = "";

  const appeler = async (u: Utilisateur, depot: string, methode: string, args: unknown[]) => {
    const r = await fetch(`${base}/rpc`, {
      method: "POST",
      headers: { authorization: `Bearer ${emettreJeton(u)}`, "content-type": "application/json" },
      body: JSON.stringify({ depot, methode, args }),
    });
    return { statut: r.status, corps: (await r.json()) as Record<string, unknown> };
  };

  before(async () => {
    process.env["STOCKAGE_RACINE"] = await mkdtemp(path.join(tmpdir(), "malica-portes-"));
    delete process.env["DEEPSEEK_API_KEY"];
    delete process.env["QWEN_API_KEY"];
    const { app } = await import("./app.ts");
    const serveur = app.listen(0);
    await new Promise((r) => serveur.once("listening", r));
    base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
    arret = () => new Promise<void>((r) => serveur.close(() => r()));

    const mdp = "MotDePasseTresLong2026!";
    const [d, e, x, c] = await Promise.all([
      creerCompte(`dirigeant-${marque}@essai.local`, mdp),
      creerCompte(`etranger-${marque}@essai.local`, mdp),
      creerCompte(`expert-${marque}@essai.local`, mdp),
      creerCompte(`collab-${marque}@essai.local`, mdp),
    ]);
    assert.ok(d && e && x && c);
    dirigeant = d;
    etranger = e;
    expert = x;
    collaborateur = c;
    const creer = (u: Utilisateur, kind: string, nom: string, mf: string | null) =>
      sousIdentite(u.id, async (db) => {
        const { rows } = await db.query<{ id: string }>(
          `select public.create_organization($1, $2, 'autonome', $3, 'TN', 'TND') as id`,
          [kind, nom, mf],
        );
        return rows[0]!.id;
      });
    pme = await creer(dirigeant, "pme", `PME ${marque}`, legalId);
    cabinet = await creer(expert, "cabinet", `COMPTA ${marque}`, null);
    await admin.query(
      `insert into identity.memberships (tenant_id, user_id, role) values ($1, $2, 'collaborateur')`,
      [cabinet, collaborateur.id],
    );
    await sousIdentite(expert.id, (db) => identite.proposerMandat(db, cabinet, legalId));
    const [propose] = await sousIdentite(dirigeant.id, (db) => identite.mandatsProposes(db, pme));
    await sousIdentite(dirigeant.id, (db) => identite.repondreAuMandat(db, propose!.id, true));

    const p = (await sousIdentite(dirigeant.id, (db) =>
      executerRpc(db, {
        depot: "capture",
        methode: "enregistrer",
        args: [
          {
            tenantId: pme,
            source: "pdf",
            vis: "partage",
            idempotencyKey: marque,
            contentType: "application/pdf",
          },
        ],
      }),
    )) as string | { id: string };
    piece = typeof p === "string" ? p : p.id;
  });

  after(async () => {
    try {
      await admin.query(
        `update identity.organizations
            set archived_at = now(), archived_reason = 'fixture de test automatisé'
          where id = any($1::uuid[]) and archived_at is null`,
        [[pme, cabinet].filter(Boolean)],
      );
    } finally {
      await admin.end();
      await arret?.();
      await fermerLePool();
    }
  });

  /* ------------------------------------------------------------- ANO-001 */
  it("un collaborateur ne s'affecte pas un dossier, l'expert l'affecte", async () => {
    const tente = await appeler(collaborateur, "collab", "assign", [
      { cabinetTenantId: cabinet, clientTenantId: pme, collaboratorId: collaborateur.id },
    ]);
    assert.notEqual(tente.statut, 200, "le collaborateur ne doit pas pouvoir s'affecter");
    await assert.rejects(
      sousIdentite(collaborateur.id, (db) =>
        db.query("select public.collab_assign($1, $2, $3)", [cabinet, pme, collaborateur.id]),
      ),
      /expert/,
    );
    // Et l'insertion directe ne contourne pas la fonction.
    await assert.rejects(
      sousIdentite(collaborateur.id, (db) =>
        db.query(
          `insert into collab.assignments (cabinet_tenant_id, client_tenant_id, collaborator_id)
           values ($1, $2, $3)`,
          [cabinet, pme, collaborateur.id],
        ),
      ),
      /row-level security|sécurité/i,
    );
    const { rows } = await sousIdentite(expert.id, (db) =>
      db.query<{ id: string }>("select public.collab_assign($1, $2, $3) as id", [
        cabinet,
        pme,
        collaborateur.id,
      ]),
    );
    assert.ok(rows[0]?.id, "l'expert affecte");
  });

  /* ------------------------------------------------------------- ANO-002 */
  it("les étapes internes de la lecture ne sont pas servies au client", async () => {
    for (const [depot, methode, args] of [
      ["capture", "persisterLecture", [{ pieceId: piece }]],
      ["capture", "consommerLecture", [piece]],
      ["capture", "journaliserAgent", [{}]],
      ["capture", "contexteLecture", [piece]],
      ["conversations", "ajouter", [{}]],
      ["fabrique", "inscrireExecution", [{}]],
    ] as const) {
      const r = await appeler(dirigeant, depot, methode, [...args]);
      assert.equal(r.statut, 404, `${depot}.${methode} doit répondre comme une méthode inconnue`);
      assert.ok(!contratRpc()[depot]?.includes(methode), `${depot}.${methode} hors du contrat`);
    }
  });

  it("la base refuse d'écrire une lecture hors d'une transaction du serveur", async () => {
    await assert.rejects(
      sousIdentite(dirigeant.id, (db) => db.query("select public.lecture_consommer($1)", [piece])),
      /reserve au serveur/,
    );
    // Le serveur, lui, passe la garde : l'erreur, s'il y en a une, n'est plus la sienne.
    await sousIdentite(dirigeant.id, async (db) => {
      await db.query("select set_config('malica.origine', 'serveur', true)");
      await db.query("savepoint s");
      try {
        await db.query("select public.lecture_consommer($1)", [piece]);
      } catch (e) {
        assert.doesNotMatch(String((e as Error).message), /reserve au serveur/);
      }
      await db.query("rollback to savepoint s");
    });
  });

  /* ------------------------------------------------------------- ANO-003 */
  it("une lecture en cours ne se rejoint que par qui voit la pièce", async () => {
    let finir: (v: unknown) => void = () => undefined;
    const enCours = registre<unknown>().lireOuRejoindre(
      piece,
      () => new Promise((r) => (finir = r)),
    );
    try {
      const vue = (jeton: Utilisateur, init: RequestInit = {}) =>
        fetch(`${base}/malica/lectures/${piece}`, {
          ...init,
          headers: { authorization: `Bearer ${emettreJeton(jeton)}`, ...(init.headers ?? {}) },
        });
      const parLeProprietaire = await vue(dirigeant);
      assert.equal(parLeProprietaire.status, 200);
      assert.equal(((await parLeProprietaire.json()) as { enCours: boolean }).enCours, true);

      assert.equal((await vue(etranger)).status, 404, "l'étranger ne voit pas l'état");
      const rejoindre = await vue(etranger, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      assert.equal(rejoindre.status, 404, "l'étranger ne rejoint pas la lecture");
    } finally {
      finir({ verdict: "fin de l'épreuve" });
      await enCours;
    }
  });
});
