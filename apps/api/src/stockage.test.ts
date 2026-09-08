/**
 * La route de stockage, éprouvée par le réseau.
 *
 * Ces vérifications passent par la vraie application Express — mêmes
 * intergiciels, même ordre de montage, mêmes jetons — parce que c'est
 * précisément l'assemblage qui peut se tromper. Appeler les gestionnaires à la
 * main prouverait qu'ils sont bien écrits, pas que la route est bien montée.
 *
 * Ce qu'elles établissent :
 *   — un tenant ne peut pas lire la pièce d'un autre, et reçoit 404 (pas 403) ;
 *   — un chemin ne peut pas sortir de la racine, même construit à la main ;
 *   — ce qu'on dépose est exactement ce qu'on relit, octet pour octet.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, emettreJeton, type Utilisateur } from "./auth.ts";
import { fermerLePool, sousIdentite } from "./db.ts";
import { executerRpc } from "./rpc.ts";

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

/** Un PDF minuscule mais authentique : la visionneuse reconnaît « %PDF- ». */
const OCTETS = Buffer.from("%PDF-1.4\nsept octets de plus\n%%EOF\n", "utf8");

describe("la route de stockage", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `stockage-${Date.now()}`;
  let racineEssai = "";
  let base = "";
  let arret: (() => Promise<void>) | null = null;

  let a: Utilisateur;
  let b: Utilisateur;
  let jetonA = "";
  let jetonB = "";
  let orgA = "";
  let orgB = "";
  let pieceA = "";

  before(async () => {
    // La racine est posée AVANT le premier import de l'application : elle est
    // lue au montage, et un test qui la poserait après ne testerait rien.
    racineEssai = await mkdtemp(path.join(tmpdir(), "malica-stockage-"));
    process.env["STOCKAGE_RACINE"] = racineEssai;

    const { app } = await import("./app.ts");
    const serveur = app.listen(0);
    await new Promise((resoudre) => serveur.once("listening", resoudre));
    base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
    arret = () => new Promise<void>((resoudre) => serveur.close(() => resoudre()));

    const compteA = await creerCompte(`a-${marque}@essai.local`, "MotDePasseTresLong2026!");
    const compteB = await creerCompte(`b-${marque}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(compteA && compteB);
    a = compteA;
    b = compteB;
    jetonA = emettreJeton(a);
    jetonB = emettreJeton(b);

    orgA = await creerOrg(a.id, `ESSAI A ${marque}`);
    orgB = await creerOrg(b.id, `ESSAI B ${marque}`);

    const piece = (await sousIdentite(a.id, (db) =>
      executerRpc(db, {
        depot: "capture",
        methode: "enregistrer",
        args: [
          {
            tenantId: orgA,
            source: "pdf",
            vis: "personnel",
            idempotencyKey: marque,
            contentType: "application/pdf",
          },
        ],
      }),
    )) as { id: string };
    pieceA = piece.id;
  });

  async function creerOrg(utilisateur: string, nom: string): Promise<string> {
    return sousIdentite(utilisateur, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization($1, $2, $3, null, $4, $5) as id`,
        // La juridiction et la devise ne sont plus devinées par la base :
        // le test les fournit comme le ferait l'écran.
        ["pme", nom, "autonome", "TN", "TND"],
      );
      return rows[0]!.id;
    });
  }

  function entetes(jeton: string): Record<string, string> {
    return { Authorization: `Bearer ${jeton}` };
  }

  after(async () => {
    if (arret) await arret();

    const admin = process.env["DATABASE_URL_ADMIN"];
    if (admin && orgA) {
      const pool = new pg.Pool({ connectionString: admin });
      try {
        await pool.query(
          `update identity.organizations
              set archived_at = now(), archived_reason = 'fixture de test automatisé'
            where id = any($1::uuid[]) and archived_at is null`,
          [[orgA, orgB]],
        );
      } finally {
        await pool.end();
      }
    }
    if (racineEssai) await rm(racineEssai, { recursive: true, force: true });
    await fermerLePool();
  });

  it("dépose puis relit exactement les mêmes octets", async () => {
    const depot = await fetch(`${base}/pieces/${pieceA}/contenu`, {
      method: "POST",
      headers: { ...entetes(jetonA), "Content-Type": "application/pdf" },
      body: OCTETS,
    });
    assert.equal(depot.status, 201);
    assert.deepEqual(await depot.json(), { pieceId: pieceA, octets: OCTETS.length });

    const lecture = await fetch(`${base}/pieces/${pieceA}/contenu`, { headers: entetes(jetonA) });
    assert.equal(lecture.status, 200);
    // Le type vient de la base, pas de l'extension ni du contenu.
    assert.equal(lecture.headers.get("content-type"), "application/pdf");
    assert.equal(lecture.headers.get("cache-control"), "private, no-store");
    const relus = Buffer.from(await lecture.arrayBuffer());
    assert.ok(relus.equals(OCTETS), "les octets relus doivent être identiques aux octets déposés");
  });

  it("écrit sous <racine>/<tenant>/<piece>, et nulle part ailleurs", async () => {
    const attendu = path.join(racineEssai, orgA, pieceA);
    const surDisque = await readFile(attendu);
    assert.ok(surDisque.equals(OCTETS));
  });

  it("un tiers ne lit pas la pièce d'un autre, et reçoit 404 — jamais 403", async () => {
    const lecture = await fetch(`${base}/pieces/${pieceA}/contenu`, { headers: entetes(jetonB) });
    // 403 dirait « elle existe, mais pas pour vous » : de quoi sonder les
    // identifiants d'un concurrent une requête à la fois.
    assert.equal(lecture.status, 404);
    assert.notEqual(lecture.status, 403);
  });

  it("un tiers ne peut pas non plus écraser la pièce d'un autre", async () => {
    const depot = await fetch(`${base}/pieces/${pieceA}/contenu`, {
      method: "POST",
      headers: { ...entetes(jetonB), "Content-Type": "application/pdf" },
      body: Buffer.from("tentative"),
    });
    assert.equal(depot.status, 404);

    // Et les octets d'origine sont intacts.
    const surDisque = await readFile(path.join(racineEssai, orgA, pieceA));
    assert.ok(surDisque.equals(OCTETS));
  });

  it("une pièce inexistante ne se distingue pas d'une pièce interdite", async () => {
    const inexistante = await fetch(`${base}/pieces/00000000-0000-4000-8000-000000000000/contenu`, {
      headers: entetes(jetonA),
    });
    assert.equal(inexistante.status, 404);
  });

  it("refuse une traversée de chemin, même écrite à la main dans l'URL", async () => {
    // Le chemin ne vient jamais du client : il se calcule à partir de la ligne
    // lue. Ces requêtes ne peuvent donc pas atteindre le disque — elles butent
    // avant, sur l'identifiant qui n'est pas un uuid. On le vérifie tout de
    // même : c'est la garantie qu'on ne veut pas voir dépendre d'une relecture.
    for (const chemin of [
      "..%2f..%2fetc%2fpasswd",
      "..",
      `${pieceA}%2f..%2f..%2fautre`,
      "%2e%2e%2f%2e%2e%2fbase",
    ]) {
      const reponse = await fetch(`${base}/pieces/${chemin}/contenu`, { headers: entetes(jetonA) });
      assert.ok(
        reponse.status === 404 || reponse.status === 400,
        `« ${chemin} » doit être refusé, reçu ${reponse.status}`,
      );
      assert.notEqual(reponse.status, 200, `« ${chemin} » ne doit RIEN servir`);
    }
  });

  it("sans jeton, la route ne dit rien du tout", async () => {
    const lecture = await fetch(`${base}/pieces/${pieceA}/contenu`);
    assert.equal(lecture.status, 401);
  });

  it("une pièce enregistrée sans octets se dit vide, elle n'en invente pas", async () => {
    const vide = (await sousIdentite(a.id, (db) =>
      executerRpc(db, {
        depot: "capture",
        methode: "enregistrer",
        args: [
          {
            tenantId: orgA,
            source: "pdf",
            vis: "personnel",
            idempotencyKey: `${marque}-vide`,
            contentType: "application/pdf",
          },
        ],
      }),
    )) as { id: string };

    const lecture = await fetch(`${base}/pieces/${vide.id}/contenu`, { headers: entetes(jetonA) });
    assert.equal(lecture.status, 404);
    assert.deepEqual(await lecture.json(), { erreur: "contenu absent" });
  });
});
