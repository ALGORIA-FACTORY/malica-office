/**
 * Deux dépôts d'octets qui arrivent ensemble sur la MÊME pièce.
 *
 * ================================================================== POURQUOI
 *
 * 18 octobre 2026, éprouvé à l'exécution sur l'atelier. Deux `POST
 * /pieces/:id/contenu` lancés en parallèle avec les MÊMES octets :
 *
 *     201 {"pieceId":"318e417e…","octets":44,"sha256":"c4253fea…"}
 *     500 {"erreur":"erreur interne"}
 *
 * Le même rejeu fait l'un APRÈS l'autre rend deux fois 201 — c'est ce que tient
 * déjà `outils/epreuves/hors-ligne.mjs`. Simultanés, le second tombe.
 *
 * La cause tient dans un nom de fichier : `deposerContenu` écrit à côté, sous
 * `<destination>.<pid>.partiel`, puis renomme. Le nom ne porte que le numéro du
 * PROCESSUS — donc deux requêtes du même processus sur la même pièce visent le
 * même fichier provisoire. La première renomme, le provisoire disparaît, et le
 * renommage de la seconde ne trouve plus rien : `ENOENT`, qui n'est ni 413 ni
 * 23514, donc relancé en 500.
 *
 * ====================================================== POURQUOI CE N'EST PAS THÉORIQUE
 *
 * La file hors ligne ne tourne qu'une fois à la fois DANS UN ONGLET. Elle ne
 * sait rien des autres : deux onglets, ou l'application rouverte pendant qu'un
 * dépôt lent est en vol, et deux passes visent la même pièce. Le dédoublonnage
 * de la file est en mémoire de processus ; le dépôt, lui, est la seule chose
 * qui porte réellement les octets.
 *
 * Et le coût n'est pas seulement un 500 : tant que les deux requêtes écrivent
 * dans le même fichier provisoire, les octets de l'une s'intercalent dans ceux
 * de l'autre, pendant que chacune hache SON propre flux. Le renommage peut donc
 * sceller une empreinte qui ne décrit pas le fichier posé — et R2 promet
 * exactement le contraire.
 *
 *   node --experimental-strip-types --env-file-if-exists=.env \
 *     --env-file-if-exists=.env.test --import ./src/garde-base-de-test.ts \
 *     --test src/depots/deux-depots-simultanes-ne-se-marchent-pas-dessus.test.ts
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, emettreJeton, type Utilisateur } from "../auth.ts";
import { fermerLePool, sousIdentite } from "../db.ts";
import { executerRpc } from "../rpc.ts";

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

/**
 * Des octets propres à chaque épreuve.
 *
 * Deux épreuves qui déposeraient les MÊMES octets dans le même dossier
 * fabriqueraient un doublon strict entre elles : la seconde pièce naîtrait
 * `doublon_de` au lieu d'être scellée, et l'épreuve mesurerait sa propre
 * fixture. Chaque cas a donc son contenu.
 */
function octetsDe(quoi: string): Buffer {
  return Buffer.concat([
    Buffer.from(`%PDF-1.4\n% ${quoi}\n`),
    Buffer.from("x".repeat(64 * 1024)),
    Buffer.from("\n%%EOF\n"),
  ]);
}

describe("deux dépôts simultanés ne se marchent pas dessus", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `depots-${Date.now()}`;
  let racine = "";
  let base = "";
  let arret: (() => Promise<void>) | null = null;
  let u: Utilisateur;
  let jeton = "";
  let org = "";

  const enregistrer = (cle: string) =>
    sousIdentite(u.id, (db) =>
      executerRpc(db, {
        depot: "capture",
        methode: "enregistrer",
        args: [
          {
            tenantId: org,
            source: "photo",
            vis: "partage",
            idempotencyKey: `${marque}-${cle}`,
            contentType: "application/pdf",
            pageCount: 1,
          },
        ],
      }),
    ) as Promise<{ id: string }>;

  const deposer = (pieceId: string, octets: Buffer) =>
    fetch(`${base}/pieces/${pieceId}/contenu`, {
      method: "POST",
      headers: { Authorization: `Bearer ${jeton}`, "content-type": "application/pdf" },
      body: new Uint8Array(octets),
    });

  before(async () => {
    racine = await mkdtemp(path.join(tmpdir(), "malica-depots-"));
    process.env["STOCKAGE_RACINE"] = racine;
    const { app } = await import("../app.ts");
    const serveur = app.listen(0);
    await new Promise((r) => serveur.once("listening", r));
    base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
    arret = () => new Promise<void>((r) => serveur.close(() => r()));

    const c = await creerCompte(`${marque}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(c);
    u = c;
    jeton = emettreJeton(u);
    org = await sousIdentite(u.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('pme', $1, 'autonome', null, 'TN', 'TND') as id`,
        [`DEPOTS ${marque}`],
      );
      return rows[0]!.id;
    });
  });

  /*
   * R7 : l'organisation d'essai s'ARCHIVE, elle ne se supprime pas. Les tables
   * de capture sont en ajout seul, et les pièces de la fixture restent.
   */
  after(async () => {
    await arret?.();
    const pool = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
    await pool
      .query(
        `update identity.organizations set archived_at = now(),
              archived_reason = 'fixture de test automatisé' where id = $1`,
        [org],
      )
      .finally(() => pool.end());
    if (racine) await rm(racine, { recursive: true, force: true });
    await fermerLePool();
  });

  it("les mêmes octets, lancés ensemble sur la même pièce, sont acceptés autant de fois", async () => {
    /*
     * Quatre, pas deux : la course se joue entre la fin du flux de l'une et le
     * renommage de l'autre, et deux requêtes la manquent une fois sur deux. Un
     * rejeu simultané n'est pas plus une faute qu'un rejeu différé.
     */
    const piece = (await enregistrer("simultane")).id;
    const octets = octetsDe("simultane");
    const reponses = await Promise.all([1, 2, 3, 4].map(() => deposer(piece, octets)));
    const statuts = reponses.map((r) => r.status);
    const corps = await Promise.all(reponses.map((r) => r.text()));

    assert.deepEqual(
      [...new Set(statuts)],
      [201],
      `un rejeu simultané n'est pas une faute : réponses reçues ${JSON.stringify(corps)}`,
    );
  });

  it("et ce qui est posé est bien ce qui a été envoyé, sous l'empreinte scellée", async () => {
    const piece = (await enregistrer("integrite")).id;
    const octets = octetsDe("integrite");
    await Promise.all([1, 2, 3, 4].map(() => deposer(piece, octets)));

    const relu = await fetch(`${base}/pieces/${piece}/contenu`, {
      headers: { Authorization: `Bearer ${jeton}` },
    });
    assert.equal(relu.status, 200, "les octets se relisent");
    const posés = Buffer.from(await relu.arrayBuffer());
    const empreinte = createHash("sha256").update(posés).digest("hex");

    assert.equal(
      posés.length,
      octets.length,
      "aucun octet d'une requête ne s'est glissé dans l'autre",
    );
    assert.equal(
      empreinte,
      createHash("sha256").update(octets).digest("hex"),
      "le fichier posé est celui dont l'empreinte a été scellée (R2)",
    );

    const pool = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
    try {
      const { rows } = await pool.query<{ sha256: string | null; doublon_de: string | null }>(
        `select sha256, doublon_de from capture.pieces where id = $1`,
        [piece],
      );
      assert.equal(
        rows[0]?.doublon_de,
        null,
        "une pièce déposée une seule fois n'est pas un doublon",
      );
      assert.equal(rows[0]?.sha256, empreinte, "et la base porte cette empreinte-là");
    } finally {
      await pool.end();
    }
  });

  it("deux photos de la même facture font deux pièces, dont la seconde est désignée doublon", async () => {
    /*
     * Deux clés d'idempotence différentes : ce n'est pas un rejeu, c'est le
     * dirigeant qui photographie la même facture deux fois. La seconde pièce
     * existe — on ne refuse jamais une capture — et la réponse du dépôt
     * désigne l'original.
     */
    const octets = octetsDe("deux-photos");
    const une = (await enregistrer("photo-1")).id;
    const deux = (await enregistrer("photo-2")).id;
    const premiere = (await deposer(une, octets).then((r) => r.json())) as {
      doublonDe: string | null;
    };
    const seconde = (await deposer(deux, octets).then((r) => r.json())) as {
      doublonDe: string | null;
    };

    assert.equal(premiere.doublonDe, null, "la première est l'original");
    assert.equal(seconde.doublonDe, une, "la réponse du dépôt nomme l'original");
  });
});
