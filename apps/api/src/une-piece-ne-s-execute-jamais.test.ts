/**
 * Une pièce se lit, elle ne s'exécute jamais — audit de sécurité du
 * 6 novembre 2026, constat S1 (`docs/audit-2026-11-06/securite.md`).
 *
 * Le scénario reproduit : un collaborateur enregistre une « pièce » de type
 * `text/html`, y dépose une page qui porte un script, et quiconque l'ouvre
 * (le dirigeant, l'expert du cabinet) l'exécute sur l'origine de
 * l'application, avec sa session.
 *
 * Trois verrous, éprouvés ici par la vraie application Express :
 *   — la porte (`capture_piece_poser_chemin`) n'admet qu'une liste fermée de
 *     types : ce que le scanner, l'import et le dépôt de PDF produisent ;
 *   — le dépôt lit les premiers octets : un type déclaré que les octets
 *     démentent est refusé (415), rien n'est scellé ;
 *   — le service ne rend jamais un contenu actif : pièce jointe, `nosniff`,
 *     et une CSP `sandbox` — y compris pour une ligne ancienne dont le type
 *     n'est pas dans la liste.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, emettreJeton, type Utilisateur } from "./auth.ts";
import { fermerLePool, sousIdentite } from "./db.ts";
import { executerRpc } from "./rpc.ts";

const BASE_CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["DATABASE_URL_ADMIN"] && process.env["JWT_SECRET"],
);

const PAGE = Buffer.from(
  "<html><body><script>fetch('/rpc',{method:'POST'})</script></body></html>",
  "utf8",
);
const PDF = Buffer.from("%PDF-1.4\nune vraie pièce\n%%EOF\n", "utf8");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);

describe(
  "une pièce se lit, elle ne s'exécute jamais (audit S1)",
  { skip: !BASE_CONFIGUREE },
  () => {
    const marque = `s1-${Date.now()}`;
    let racineEssai = "";
    let base = "";
    let arret: (() => Promise<void>) | null = null;
    let admin: pg.Pool;
    let qui: Utilisateur;
    let jeton = "";
    let org = "";

    before(async () => {
      racineEssai = await mkdtemp(path.join(tmpdir(), "malica-s1-"));
      process.env["STOCKAGE_RACINE"] = racineEssai;
      admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });

      const { app } = await import("./app.ts");
      const serveur = app.listen(0);
      await new Promise((resoudre) => serveur.once("listening", resoudre));
      base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
      arret = () => new Promise<void>((resoudre) => serveur.close(() => resoudre()));

      const compte = await creerCompte(`s1-${marque}@essai.local`, "MotDePasseTresLong2026!");
      assert.ok(compte);
      qui = compte;
      jeton = emettreJeton(qui);
      org = await sousIdentite(qui.id, async (db) => {
        const { rows } = await db.query<{ id: string }>(
          `select public.create_organization($1, $2, $3, null, $4, $5) as id`,
          ["pme", `ESSAI S1 ${marque}`, "autonome", "TN", "TND"],
        );
        return rows[0]!.id;
      });
    });

    after(async () => {
      if (arret) await arret();
      if (org) {
        await admin.query(
          `update identity.organizations
            set archived_at = now(), archived_reason = 'fixture de test automatisé'
          where id = $1 and archived_at is null`,
          [org],
        );
      }
      await admin.end();
      if (racineEssai) await rm(racineEssai, { recursive: true, force: true });
      await fermerLePool();
    });

    const enregistrer = (cle: string, contentType: string | null) =>
      sousIdentite(qui.id, (db) =>
        executerRpc(db, {
          depot: "capture",
          methode: "enregistrer",
          args: [
            {
              tenantId: org,
              source: "photo",
              vis: "personnel",
              idempotencyKey: `${marque}-${cle}`,
              contentType,
              pageCount: 1,
            },
          ],
        }),
      ) as Promise<{ id: string }>;

    const deposer = (pieceId: string, type: string, octets: Buffer) =>
      fetch(`${base}/pieces/${pieceId}/contenu`, {
        method: "POST",
        headers: { Authorization: `Bearer ${jeton}`, "Content-Type": type },
        body: octets,
      });

    const lire = (pieceId: string) =>
      fetch(`${base}/pieces/${pieceId}/contenu`, { headers: { Authorization: `Bearer ${jeton}` } });

    /** Les en-têtes qui empêchent tout contenu servi de devenir une page active. */
    function assertInerte(r: Response): void {
      assert.match(r.headers.get("content-disposition") ?? "", /^attachment\b/);
      assert.equal(r.headers.get("x-content-type-options"), "nosniff");
      const csp = r.headers.get("content-security-policy") ?? "";
      assert.match(csp, /\bsandbox\b/);
      assert.match(csp, /default-src 'none'/);
    }

    it("la porte refuse une pièce déclarée text/html", async () => {
      await assert.rejects(enregistrer("html", "text/html"), /refus\.piece\.type_de_contenu/);
    });

    it("la porte refuse une pièce déclarée image/svg+xml", async () => {
      await assert.rejects(enregistrer("svg", "image/svg+xml"), /refus\.piece\.type_de_contenu/);
    });

    it("la porte admet ce que produisent le scanner, l'import et le dépôt de PDF", async () => {
      for (const type of [
        "application/pdf",
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/heic",
      ]) {
        const { id } = await enregistrer(`admis-${type}`, type);
        assert.match(id, /^[0-9a-f-]{36}$/);
      }
    });

    it("un PDF déclaré dont les octets sont une page HTML est refusé (415), rien n'est scellé", async () => {
      const { id } = await enregistrer("pdf-force", "application/pdf");
      const depot = await deposer(id, "application/pdf", PAGE);
      assert.equal(depot.status, 415);
      assert.deepEqual(await depot.json(), { erreur: "refus.piece.type_de_contenu" });
      await assert.rejects(stat(path.join(racineEssai, org, id)), "aucun octet sur le disque");
      const { rows } = await admin.query<{ sha256: string | null }>(
        `select sha256 from capture.pieces where id = $1`,
        [id],
      );
      assert.equal(rows[0]!.sha256, null, "aucune empreinte scellée");
      // Les bons octets passent ensuite : le refus n'a rien bloqué.
      assert.equal((await deposer(id, "application/pdf", PDF)).status, 201);
    });

    it("un JPEG déclaré dont les octets sont un PNG est refusé (415)", async () => {
      const { id } = await enregistrer("jpeg-png", "image/jpeg");
      assert.equal((await deposer(id, "image/jpeg", PNG)).status, 415);
      assert.equal((await deposer(id, "image/jpeg", JPEG)).status, 201);
    });

    it("une pièce servie l'est en pièce jointe, nosniff, sous une CSP sandbox", async () => {
      const { id } = await enregistrer("servie", "application/pdf");
      assert.equal((await deposer(id, "application/pdf", PDF)).status, 201);
      const r = await lire(id);
      assert.equal(r.status, 200);
      assert.equal(r.headers.get("content-type"), "application/pdf");
      assertInerte(r);
      assert.ok(Buffer.from(await r.arrayBuffer()).equals(PDF));
    });

    it("une ligne ancienne de type hors liste n'est jamais servie comme contenu actif", async () => {
      const { id } = await enregistrer("ancienne", "application/pdf");
      // Une ligne d'avant la liste fermée : le type posé à la main, les octets aussi.
      await admin.query(`update capture.pieces set content_type = 'text/html' where id = $1`, [id]);
      await mkdir(path.join(racineEssai, org), { recursive: true });
      await writeFile(path.join(racineEssai, org, id), PAGE);

      const r = await lire(id);
      assert.equal(r.status, 200);
      assert.equal(r.headers.get("content-type"), "application/octet-stream");
      assertInerte(r);
    });
  },
);
