/**
 * D29 — une pièce d'un autre tenant ne se distingue pas d'une pièce qui
 * n'existe nulle part.
 *
 * Si la réponse différait — un statut, un message, un corps —, elle
 * confirmerait à un inconnu qu'un identifiant désigne bien une pièce, chez
 * quelqu'un : un canal de confirmation d'existence. Ce test compare, pour CHAQUE
 * chemin qui prend un identifiant de pièce, la réponse à un étranger sur la
 * pièce d'un tenant à la réponse sur un identifiant jamais émis. Elles doivent
 * être identiques, octet pour octet.
 *
 * Par HTTP, à travers l'application réelle : c'est ce qu'un appelant voit.
 *
 *   node --experimental-strip-types --test src/existence-des-pieces.test.ts
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, emettreJeton } from "./auth.ts";
import { fermerLePool, sousIdentite } from "./db.ts";
import { executerRpc } from "./rpc.ts";

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

describe("D29 — l'existence d'une pièce ne se confirme pas", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `existence-${Date.now()}`;
  let base = "";
  let arret: (() => Promise<void>) | null = null;
  let jetonEtranger = "";
  let orgA = "";
  let pieceA = "";
  let proprietaire = "";

  before(async () => {
    process.env["STOCKAGE_RACINE"] = await mkdtemp(path.join(tmpdir(), "malica-existence-"));
    // Aucun modèle n'est appelé par ce test : une lecture qui passerait la garde
    // échouerait sans clé plutôt que de coûter un appel.
    delete process.env["DEEPSEEK_API_KEY"];
    delete process.env["QWEN_API_KEY"];
    const { app } = await import("./app.ts");
    const serveur = app.listen(0);
    await new Promise((r) => serveur.once("listening", r));
    base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
    arret = () => new Promise<void>((r) => serveur.close(() => r()));

    const a = await creerCompte(`a-${marque}@essai.local`, "MotDePasseTresLong2026!");
    const b = await creerCompte(`b-${marque}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(a && b);
    proprietaire = a.id;
    jetonEtranger = emettreJeton(b);
    orgA = await sousIdentite(a.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('pme', $1, 'autonome', null, 'TN', 'TND') as id`,
        [`EXISTENCE ${marque}`],
      );
      return rows[0]!.id;
    });
    const piece = (await sousIdentite(a.id, (db) =>
      executerRpc(db, {
        depot: "capture",
        methode: "enregistrer",
        args: [
          {
            tenantId: orgA,
            source: "pdf",
            vis: "partage",
            idempotencyKey: marque,
            contentType: "application/pdf",
            pageCount: 1,
          },
        ],
      }),
    )) as { id: string };
    pieceA = piece.id;
  });

  after(async () => {
    const admin = process.env["DATABASE_URL_ADMIN"];
    if (admin && orgA) {
      const pool = new pg.Pool({ connectionString: admin });
      await pool
        .query(
          `update identity.organizations set archived_at = now(),
                  archived_reason = 'fixture de test automatisé' where id = $1`,
          [orgA],
        )
        .finally(() => pool.end());
    }
    await arret?.();
    await fermerLePool();
  });

  /** Statut et corps, avec l'identifiant remplacé : seul le reste doit compter. */
  async function reponse(chemin: string, init: RequestInit, id: string) {
    const r = await fetch(`${base}${chemin}`, {
      ...init,
      headers: { authorization: `Bearer ${jetonEtranger}`, ...(init.headers ?? {}) },
    });
    const corps = (await r.text()).replaceAll(id, "<ID>");
    return { statut: r.status, corps };
  }

  const rpc = (depot: string, methode: string, args: (id: string) => unknown[]) => ({
    chemin: "/rpc",
    init: (id: string): RequestInit => ({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ depot, methode, args: args(id) }),
    }),
  });

  const CHEMINS: Record<
    string,
    { chemin: string | ((id: string) => string); init: (id: string) => RequestInit }
  > = {
    "GET /pieces/:id/contenu": { chemin: (id) => `/pieces/${id}/contenu`, init: () => ({}) },
    "POST /pieces/:id/contenu": {
      chemin: (id) => `/pieces/${id}/contenu`,
      init: () => ({
        method: "POST",
        headers: { "content-type": "application/pdf" },
        body: "%PDF-1.4\n%%EOF\n",
      }),
    },
    "GET /malica/lectures/:id": { chemin: (id) => `/malica/lectures/${id}`, init: () => ({}) },
    "POST /malica/lectures/:id": {
      chemin: (id) => `/malica/lectures/${id}`,
      init: () => ({ method: "POST", headers: { "content-type": "application/json" }, body: "{}" }),
    },
    "capture.dossier": rpc("capture", "dossier", (id) => [id]),
    "capture.contexteLecture": rpc("capture", "contexteLecture", (id) => [id]),
    "capture.contexteAssistant": rpc("capture", "contexteAssistant", (id) => [orgA, id]),
    "capture.preciser": rpc("capture", "preciser", (id) => [id, "numero", "X"]),
    "capture.supprimer": rpc("capture", "supprimer", (id) => [id]),
    "collab.setPieceVis": rpc("collab", "setPieceVis", (id) => [id, "personnel"]),
    "office.ecrituresForPiece": rpc("office", "ecrituresForPiece", (id) => [id]),
    "supervision.auditForPiece": rpc("supervision", "auditForPiece", (id) => [id]),
  };

  for (const [nom, c] of Object.entries(CHEMINS)) {
    it(`${nom} : la pièce d'un autre tenant répond comme une pièce inexistante`, async () => {
      const inexistante = randomUUID();
      const chemin = (id: string) => (typeof c.chemin === "string" ? c.chemin : c.chemin(id));
      const etrangere = await reponse(chemin(pieceA), c.init(pieceA), pieceA);
      const nulle = await reponse(chemin(inexistante), c.init(inexistante), inexistante);
      assert.deepEqual(etrangere, nulle);
    });
  }

  it("et la pièce existe bien : son propriétaire la lit", async () => {
    // Sans ce témoin, deux réponses identiques pourraient venir de ce que la
    // pièce n'a jamais été créée.
    const lue = (await sousIdentite(proprietaire, (db) =>
      executerRpc(db, { depot: "capture", methode: "dossier", args: [pieceA] }),
    )) as { piece: { id: string } } | { id: string };
    assert.equal("piece" in lue ? lue.piece.id : lue.id, pieceA);
  });
});
