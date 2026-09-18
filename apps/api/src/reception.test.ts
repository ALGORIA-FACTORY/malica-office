/**
 * 3B-1 — La réception : l'empreinte SHA-256 est calculée sur les octets reçus
 * et posée sur la pièce ; le doublon strict se détecte À CE MOMENT.
 *
 * Jusqu'au 18 septembre 2026, `capture.enregistrer` passait `p_sha256 => null`
 * et la route de dépôt écrivait le flux sans le hacher : l'index d'unicité par
 * tenant existait, vide. Un même PDF déposé deux fois donnait deux pièces.
 *
 * Par HTTP, à travers l'application réelle.
 *
 *   node --experimental-strip-types --test src/reception.test.ts
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, emettreJeton, type Utilisateur } from "./auth.ts";
import { fermerLePool, sousIdentite } from "./db.ts";
import { executerRpc } from "./rpc.ts";

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

const FACTURE = Buffer.from("%PDF-1.4\nune facture\n%%EOF\n", "utf8");
const AUTRE = Buffer.from("%PDF-1.4\nune autre facture\n%%EOF\n", "utf8");
const empreinte = (b: Buffer) => createHash("sha256").update(b).digest("hex");

describe(
  "3B-1 — la réception scelle l'empreinte et voit le doublon",
  { skip: !BASE_CONFIGUREE },
  () => {
    const marque = `reception-${Date.now()}`;
    let racine = "";
    let base = "";
    let arret: (() => Promise<void>) | null = null;
    let a: Utilisateur;
    let b: Utilisateur;
    let jetonA = "";
    let jetonB = "";
    let orgA = "";
    let orgB = "";
    let premiere = "";

    const creerOrg = (u: Utilisateur, nom: string) =>
      sousIdentite(u.id, async (db) => {
        const { rows } = await db.query<{ id: string }>(
          `select public.create_organization('pme', $1, 'autonome', null, 'TN', 'TND') as id`,
          [nom],
        );
        return rows[0]!.id;
      });

    const enregistrer = (u: Utilisateur, tenantId: string, cle: string) =>
      sousIdentite(u.id, (db) =>
        executerRpc(db, {
          depot: "capture",
          methode: "enregistrer",
          args: [
            {
              tenantId,
              source: "pdf",
              vis: "partage",
              idempotencyKey: cle,
              contentType: "application/pdf",
              pageCount: 1,
            },
          ],
        }),
      ) as Promise<{ id: string }>;

    const deposer = (jeton: string, pieceId: string, octets: Buffer) =>
      fetch(`${base}/pieces/${pieceId}/contenu`, {
        method: "POST",
        headers: { Authorization: `Bearer ${jeton}`, "content-type": "application/pdf" },
        body: octets,
      });

    const ligne = async (pieceId: string) => {
      const pool = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
      try {
        const { rows } = await pool.query<{ sha256: string | null; doublon_de: string | null }>(
          `select sha256, doublon_de from capture.pieces where id = $1`,
          [pieceId],
        );
        return rows[0]!;
      } finally {
        await pool.end();
      }
    };

    before(async () => {
      racine = await mkdtemp(path.join(tmpdir(), "malica-reception-"));
      process.env["STOCKAGE_RACINE"] = racine;
      const { app } = await import("./app.ts");
      const serveur = app.listen(0);
      await new Promise((r) => serveur.once("listening", r));
      base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
      arret = () => new Promise<void>((r) => serveur.close(() => r()));

      const ca = await creerCompte(`a-${marque}@essai.local`, "MotDePasseTresLong2026!");
      const cb = await creerCompte(`b-${marque}@essai.local`, "MotDePasseTresLong2026!");
      assert.ok(ca && cb);
      [a, b] = [ca, cb];
      [jetonA, jetonB] = [emettreJeton(a), emettreJeton(b)];
      orgA = await creerOrg(a, `RECEPTION A ${marque}`);
      orgB = await creerOrg(b, `RECEPTION B ${marque}`);
    });

    after(async () => {
      await arret?.();
      const pool = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
      await pool
        .query(
          `update identity.organizations set archived_at = now(),
                archived_reason = 'fixture de test automatisé' where id = any($1::uuid[])`,
          [[orgA, orgB]],
        )
        .finally(() => pool.end());
      if (racine) await rm(racine, { recursive: true, force: true });
      await fermerLePool();
    });

    it("l'empreinte des octets reçus est calculée, posée, et rendue", async () => {
      premiere = (await enregistrer(a, orgA, `${marque}-1`)).id;
      const r = await deposer(jetonA, premiere, FACTURE);
      assert.equal(r.status, 201);
      const corps = (await r.json()) as { sha256: string; doublonDe: string | null };
      assert.equal(corps.sha256, empreinte(FACTURE));
      assert.equal(corps.doublonDe, null);
      assert.deepEqual(await ligne(premiere), { sha256: empreinte(FACTURE), doublon_de: null });
    });

    it("redéposer les mêmes octets est sans effet", async () => {
      const r = await deposer(jetonA, premiere, FACTURE);
      assert.equal(r.status, 201);
      assert.equal(((await r.json()) as { sha256: string }).sha256, empreinte(FACTURE));
    });

    it("une pièce scellée refuse d'autres octets, et garde les siens", async () => {
      const r = await deposer(jetonA, premiere, AUTRE);
      assert.equal(r.status, 409);
      const relu = await fetch(`${base}/pieces/${premiere}/contenu`, {
        headers: { Authorization: `Bearer ${jetonA}` },
      });
      assert.deepEqual(Buffer.from(await relu.arrayBuffer()), FACTURE);
      assert.equal((await ligne(premiere)).sha256, empreinte(FACTURE));
    });

    it("le même fichier déposé une seconde fois est reconnu comme doublon, à la réception", async () => {
      const seconde = (await enregistrer(a, orgA, `${marque}-2`)).id;
      const r = await deposer(jetonA, seconde, FACTURE);
      assert.equal(
        r.status,
        201,
        "le dépôt n'est pas refusé : les versions installées réessaieraient",
      );
      const corps = (await r.json()) as { sha256: string; doublonDe: string | null };
      assert.equal(corps.sha256, empreinte(FACTURE));
      assert.equal(corps.doublonDe, premiere);
      assert.deepEqual(await ligne(seconde), { sha256: null, doublon_de: premiere });
    });

    it("le même fichier dans un AUTRE tenant n'est pas un doublon — et rien ne le révèle", async () => {
      const ailleurs = (await enregistrer(b, orgB, `${marque}-b`)).id;
      const r = await deposer(jetonB, ailleurs, FACTURE);
      assert.equal(r.status, 201);
      assert.equal(((await r.json()) as { doublonDe: string | null }).doublonDe, null);
      assert.deepEqual(await ligne(ailleurs), { sha256: empreinte(FACTURE), doublon_de: null });
    });

    it("la réception s'écrit dans l'audit, avec l'empreinte", async () => {
      const pool = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
      try {
        const { rows } = await pool.query<{ payload: { sha256: string } }>(
          `select payload from audit.event_log
          where object_id = $1 and action = 'piece.recue'`,
          [premiere],
        );
        assert.equal(rows.length, 1, "une seule réception journalisée, redépôt compris");
        assert.equal(rows[0]!.payload.sha256, empreinte(FACTURE));
      } finally {
        await pool.end();
      }
    });
  },
);
