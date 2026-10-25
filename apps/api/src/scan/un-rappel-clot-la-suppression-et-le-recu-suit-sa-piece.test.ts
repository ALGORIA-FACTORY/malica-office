/**
 * Un rappel accordé clôt la demande de suppression ; un reçu suit sa pièce.
 *
 * ================================================================= POURQUOI
 *
 * 25 octobre 2026, deux défauts vus sur la recette :
 *
 * 1. Une PME demande la suppression d'une pièce transmise, puis son rappel.
 *    Le cabinet accorde le rappel : la pièce revient au privé, mais la
 *    demande de suppression restait « demandée ». L'écran disait « Votre
 *    comptabilité doit l'accorder » sur une pièce que la PME pouvait effacer
 *    seule.
 *
 * 2. Un reçu généré depuis une pièce PRIVÉE naissait « partage » : la
 *    visibilité venait de l'écran. Le cabinet recevait le reçu d'une facture
 *    qu'on ne lui avait pas transmise.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "../auth.ts";
import { fermerLePool, sousIdentite } from "../db.ts";
import { executerRpc } from "../rpc.ts";

import { matriculeDEssai } from "../matricule-d-essai.ts";
const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

describe("le rappel accordé et ce qui suit la pièce", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `rappel-recu-${Date.now()}`;
  let u: Utilisateur;
  let org = "";
  let expert: Utilisateur;
  let cabinet = "";

  const rpc = (depot: string, methode: string, ...args: unknown[]) =>
    sousIdentite(u.id, (db) => executerRpc(db, { depot, methode, args }));
  const rpcCab = (depot: string, methode: string, ...args: unknown[]) =>
    sousIdentite(expert.id, (db) => executerRpc(db, { depot, methode, args }));

  const admin = async <T>(f: (p: pg.Pool) => Promise<T>) => {
    const p = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
    try {
      return await f(p);
    } finally {
      await p.end();
    }
  };

  const deposer = async (cle: string, extra: Record<string, unknown> = {}) =>
    (
      (await rpc("capture", "enregistrer", {
        tenantId: org,
        source: "pdf",
        vis: "personnel",
        idempotencyKey: `${marque}-${cle}`,
        contentType: "application/pdf",
        pageCount: 1,
        ...extra,
      })) as { id: string }
    ).id;

  const visDe = (id: string) =>
    admin(async (p) => {
      const { rows } = await p.query<{ vis: string }>(
        `select vis from capture.pieces where id = $1`,
        [id],
      );
      return rows[0]!.vis;
    });

  const faits = (id: string, objet: string) =>
    admin(async (p) => {
      const { rows } = await p.query<{ fait: string }>(
        `select fait from collab.demandes_sur_piece
          where piece_id = $1 and objet = $2 order by created_at`,
        [id, objet],
      );
      return rows.map((r) => r.fait);
    });

  before(async () => {
    const c = await creerCompte(`${marque}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(c);
    u = c;
    org = await sousIdentite(u.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('pme', 'PME D''ESSAI SUARL', 'autonome',
                                           '${matriculeDEssai("A", "M")}', 'TN', 'TND') as id`,
      );
      return rows[0]!.id;
    });
    const e = await creerCompte(`${marque}-cab@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(e);
    expert = e;
    cabinet = await sousIdentite(expert.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('cabinet', 'CABINET D''ESSAI', 'autonome',
                                           '${matriculeDEssai("B", "C")}', 'TN', 'TND') as id`,
      );
      return rows[0]!.id;
    });
    await admin((p) =>
      p.query(
        `insert into identity.engagements (cabinet_org_id, pme_org_id, status, starts_on)
         values ($1, $2, 'actif', current_date - 1)`,
        [cabinet, org],
      ),
    );
  });

  after(async () => {
    await admin((p) =>
      p.query(
        `update identity.organizations set archived_at = now(),
                archived_reason = 'fixture de test automatisé' where id = any($1)`,
        [[org, cabinet]],
      ),
    );
    await fermerLePool();
  });

  /* ===================================== 1. LE RAPPEL CLÔT LA SUPPRESSION */

  it("le rappel accordé clôt la demande de suppression en attente, sans la réécrire", async () => {
    const id = await deposer("suppression-puis-rappel");
    await rpc("collab", "setPieceVis", id, "partage");
    await rpc("collab", "demanderSurPiece", id, "suppression");
    await rpc("collab", "demanderSurPiece", id, "rappel");

    await rpcCab("collab", "repondreSurPiece", id, "rappel", true, null);

    assert.equal(await visDe(id), "personnel");
    assert.deepEqual(
      await faits(id, "suppression"),
      ["demandee", "retiree"],
      "R7 : la ligne « demandee » reste, le fait qui la clôt s'ajoute",
    );

    // Ce que l'écran de la PME lit : le dernier fait n'est plus « demandee ».
    const demandes = (await rpc("collab", "demandesDUnePiece", id)) as {
      objet: string;
      fait: string;
    }[];
    assert.equal(demandes.find((d) => d.objet === "suppression")?.fait, "retiree");

    // Le cabinet n'a plus rien à trancher : la pièce n'est même plus chez lui.
    await assert.rejects(
      () => rpcCab("collab", "repondreSurPiece", id, "suppression", true, null),
      /piece introuvable ou non autorisee|aucune demande en attente/,
    );

    // Et la PME efface elle-même ce qui est redevenu son brouillon.
    assert.equal(await rpc("capture", "supprimer", id), true);
  });

  it("un rappel accordé sans demande de suppression n'en invente pas", async () => {
    const id = await deposer("rappel-seul");
    await rpc("collab", "setPieceVis", id, "partage");
    await rpc("collab", "demanderSurPiece", id, "rappel");
    await rpcCab("collab", "repondreSurPiece", id, "rappel", true, null);
    assert.deepEqual(await faits(id, "suppression"), []);
  });

  it("un rappel REFUSÉ laisse la demande de suppression en attente", async () => {
    const id = await deposer("rappel-refuse");
    await rpc("collab", "setPieceVis", id, "partage");
    await rpc("collab", "demanderSurPiece", id, "suppression");
    await rpc("collab", "demanderSurPiece", id, "rappel");
    await rpcCab("collab", "repondreSurPiece", id, "rappel", false, "Déjà déclarée.");
    assert.deepEqual(await faits(id, "suppression"), ["demandee"]);
  });

  it("personne n'inscrit « retiree » en direct : seule la base le fait", async () => {
    const id = await deposer("retiree-forge");
    await rpc("collab", "setPieceVis", id, "partage");
    await rpc("collab", "demanderSurPiece", id, "suppression");
    for (const qui of [u, expert]) {
      await assert.rejects(
        sousIdentite(qui.id, (db) =>
          db.query(
            `insert into collab.demandes_sur_piece (tenant_id, piece_id, objet, fait, auteur)
             values ($1, $2, 'suppression', 'retiree', $3)`,
            [org, id, qui.id],
          ),
        ),
        (e: { code?: string }) => e.code === "42501",
      );
    }
    assert.deepEqual(await faits(id, "suppression"), ["demandee"]);
  });

  /* ============================================ 2. LE REÇU SUIT SA PIÈCE */

  it("un reçu d'une pièce PRIVÉE reste privé, même déclaré partagé", async () => {
    const facture = await deposer("facture-privee");
    const recu = await deposer("recu-de-privee", {
      vis: "partage",
      documentKind: "recu_de_paiement",
      sourcePieceId: facture,
    });
    assert.equal(await visDe(recu), "personnel");
  });

  it("un reçu d'une pièce transmise est transmis avec elle", async () => {
    const facture = await deposer("facture-partagee");
    await rpc("collab", "setPieceVis", facture, "partage");
    const recu = await deposer("recu-de-partagee", {
      vis: "personnel",
      documentKind: "recu_de_paiement",
      sourcePieceId: facture,
    });
    assert.equal(await visDe(recu), "partage");
  });

  it("la file du cabinet et ses compteurs ne prennent pas un reçu pour une pièce à lire", async () => {
    const facture = await deposer("facture-file");
    await rpc("collab", "setPieceVis", facture, "partage");
    const recu = await deposer("recu-file", {
      documentKind: "recu_de_paiement",
      sourcePieceId: facture,
    });
    const file = (await rpcCab("supervision", "queue", cabinet, org)) as Array<{
      pieceId?: string;
      id?: string;
    }>;
    const ids = file.map((l) => l.pieceId ?? l.id);
    assert.ok(ids.includes(facture), "la facture transmise est dans la file");
    assert.ok(!ids.includes(recu), "son reçu l'accompagne, il n'y entre pas");
    const clients = (await rpcCab("supervision", "listClients", cabinet)) as Array<{
      tenantId: string;
      counts: Record<string, number>;
    }>;
    const avant = clients.find((c) => c.tenantId === org)!.counts["capturee"] ?? 0;
    await deposer("recu-file-2", { documentKind: "recu_de_paiement", sourcePieceId: facture });
    const apres =
      (
        (await rpcCab("supervision", "listClients", cabinet)) as Array<{
          tenantId: string;
          counts: Record<string, number>;
        }>
      ).find((c) => c.tenantId === org)!.counts["capturee"] ?? 0;
    assert.equal(apres, avant, "un reçu de plus ne fait pas une pièce « pas encore lue » de plus");
  });

  it("le rappel accordé ramène aussi le reçu qui en est issu", async () => {
    const facture = await deposer("facture-rappelee");
    await rpc("collab", "setPieceVis", facture, "partage");
    const recu = await deposer("recu-rappele", {
      documentKind: "recu_de_paiement",
      sourcePieceId: facture,
    });
    assert.equal(await visDe(recu), "partage");

    await rpc("collab", "demanderSurPiece", facture, "rappel");
    await rpcCab("collab", "repondreSurPiece", facture, "rappel", true, null);

    assert.equal(await visDe(facture), "personnel");
    assert.equal(
      await visDe(recu),
      "personnel",
      "un reçu n'est jamais partagé si sa source ne l'est pas",
    );
  });
});
