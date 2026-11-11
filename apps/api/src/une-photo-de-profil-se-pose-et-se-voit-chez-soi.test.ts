/**
 * Une photo de profil se pose, et ne se voit que chez soi.
 *
 * Ce que ce fichier établit :
 *   — la personne pose SA photo ; ce qui est gardé est un carré JPEG de 256 px
 *     refait par le serveur, sans métadonnées (un EXIF forgé n'en sort pas) ;
 *   — un membre de la même organisation la voit ; une personne d'une autre
 *     organisation, ou sans session, non — 404, jamais 403 ;
 *   — des octets qui ne sont pas une image admise sont refusés (415), une photo
 *     démesurée aussi (413), et rien ne change ;
 *   — `photosDesProfils` ne rend que les personnes que la RLS laisse voir ;
 *   — l'ôter l'efface du disque et de la base.
 */
import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { createCanvas, loadImage } from "@napi-rs/canvas";
import pg from "pg";

import { creerCompte, emettreJeton, type Utilisateur } from "./auth.ts";
import { fermerLePool, sousIdentiteDuServeur } from "./db.ts";
import { matriculeDEssai } from "./matricule-d-essai.ts";
import { executerRpc } from "./rpc.ts";

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

/** Un PNG 600 × 300 : ni carré ni petit, pour que le recadrage se voie. */
async function paysage(): Promise<Buffer> {
  const toile = createCanvas(600, 300);
  const ctx = toile.getContext("2d");
  ctx.fillStyle = "#3A8F54";
  ctx.fillRect(0, 0, 600, 300);
  return await toile.encode("png");
}

/** Un JPEG qui porte un segment « Exif » : ce que fait un téléphone, position GPS comprise. */
async function jpegAvecExif(): Promise<Buffer> {
  const toile = createCanvas(64, 64);
  const ctx = toile.getContext("2d");
  ctx.fillStyle = "#2968A5";
  ctx.fillRect(0, 0, 64, 64);
  const nu = await toile.encode("jpeg", 80);
  const exif = Buffer.concat([Buffer.from("Exif\0\0"), Buffer.from("GPS:36.80N,10.18E")]);
  const segment = Buffer.concat([Buffer.from([0xff, 0xe1, 0, exif.length + 2]), exif]);
  return Buffer.concat([nu.subarray(0, 2), segment, nu.subarray(2)]);
}

describe(
  "une photo de profil se pose, et ne se voit que chez soi",
  { skip: !BASE_CONFIGUREE },
  () => {
    const marque = `photo-${Date.now()}`;
    let racineEssai = "";
    let base = "";
    let arret: (() => Promise<void>) | null = null;
    let dirigeant: Utilisateur;
    let siege: Utilisateur;
    let tiers: Utilisateur;
    let pme = "";
    let autre = "";

    const admin = async <T>(f: (p: pg.Pool) => Promise<T>) => {
      const p = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
      try {
        return await f(p);
      } finally {
        await p.end();
      }
    };
    const entetes = (qui: Utilisateur) => ({
      Authorization: `Bearer ${emettreJeton(qui, new Date())}`,
    });
    const poser = (qui: Utilisateur, octets: Uint8Array | Buffer) =>
      fetch(`${base}/moi/photo`, { method: "PUT", headers: entetes(qui), body: octets });
    const voir = (qui: Utilisateur | null, de: Utilisateur) =>
      fetch(`${base}/moi/photos/${de.id}`, { headers: qui ? entetes(qui) : {} });
    const photos = (qui: Utilisateur, ids: string[]) =>
      sousIdentiteDuServeur(qui.id, (db) =>
        executerRpc(db, { depot: "identite", methode: "photosDesProfils", args: [ids] }, "serveur"),
      ) as Promise<Record<string, string>>;
    const organisation = (qui: Utilisateur, nom: string) =>
      sousIdentiteDuServeur(qui.id, async (db) => {
        const { rows } = await db.query<{ id: string }>(
          `select public.create_organization('pme', $1, 'autonome', $2, 'TN', 'TND') as id`,
          [nom, matriculeDEssai()],
        );
        return rows[0]!.id;
      });

    before(async () => {
      racineEssai = await mkdtemp(path.join(tmpdir(), "malica-photo-"));
      process.env["STOCKAGE_RACINE"] = racineEssai;
      const { app } = await import("./app.ts");
      const serveur = app.listen(0);
      await new Promise((resoudre) => serveur.once("listening", resoudre));
      base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
      arret = () => new Promise<void>((resoudre) => serveur.close(() => resoudre()));

      const d = await creerCompte(`${marque}-dir@essai.local`, "MotDePasseTresLong2026!");
      const s = await creerCompte(`${marque}-siege@essai.local`, "MotDePasseTresLong2026!");
      const t = await creerCompte(`${marque}-tiers@essai.local`, "MotDePasseTresLong2026!");
      assert.ok(d && s && t);
      dirigeant = d;
      siege = s;
      tiers = t;
      pme = await organisation(dirigeant, `PAPETERIE ESSAI ${marque}`);
      autre = await organisation(tiers, `QUINCAILLERIE ESSAI ${marque}`);
      // Une licence Team ouvre les sièges, par la vraie porte.
      await sousIdentiteDuServeur(dirigeant.id, (db) =>
        db.query("select public.forfait_changer('team', $1, current_date)", [pme]),
      );
      await admin((p) =>
        p.query(
          "insert into identity.memberships (tenant_id, user_id, role) values ($1, $2, 'collaborateur')",
          [pme, siege.id],
        ),
      );
    });

    after(async () => {
      if (arret) await arret();
      await admin((p) =>
        p.query(
          `update identity.organizations set archived_at = now(),
                archived_reason = 'fixture de test automatisé' where id = any($1)`,
          [[pme, autre]],
        ),
      );
      if (racineEssai) await rm(racineEssai, { recursive: true, force: true });
      await fermerLePool();
    });

    it("sans photo posée, personne n'en voit : 404, et aucune version", async () => {
      assert.equal((await voir(dirigeant, siege)).status, 404);
      assert.deepEqual(await photos(dirigeant, [siege.id]), {});
    });

    it("la photo posée devient un carré JPEG de 256 px, vu d'un membre de la même organisation", async () => {
      const pose = await poser(siege, await paysage());
      assert.equal(pose.status, 200);
      const { version } = (await pose.json()) as { version: string };
      assert.match(version, /^[0-9a-f]{64}$/);

      const vue = await voir(dirigeant, siege);
      assert.equal(vue.status, 200);
      assert.equal(vue.headers.get("content-type"), "image/jpeg");
      assert.equal(vue.headers.get("cache-control"), "private, no-store");
      const image = await loadImage(Buffer.from(await vue.arrayBuffer()));
      assert.deepEqual([image.width, image.height], [256, 256]);

      assert.deepEqual(await photos(dirigeant, [siege.id, dirigeant.id]), { [siege.id]: version });
    });

    it("ce qui est gardé ne porte pas les métadonnées reçues", async () => {
      const entree = await jpegAvecExif();
      assert.ok(entree.includes("GPS:36.80N"), "l'entrée porte bien le segment forgé");
      assert.equal((await poser(siege, entree)).status, 200);
      const sortie = Buffer.from(await (await voir(siege, siege)).arrayBuffer());
      assert.ok(!sortie.includes("GPS:"), "la position ne ressort pas");
      assert.ok(!sortie.includes("Exif"), "aucun segment Exif ne ressort");
    });

    it("une personne d'une autre organisation, ou sans session, ne la voit pas", async () => {
      assert.equal((await voir(tiers, siege)).status, 404);
      assert.deepEqual(await photos(tiers, [siege.id]), {});
      assert.equal((await voir(null, siege)).status, 401);
    });

    it("des octets qui ne sont pas une image admise sont refusés, et la photo reste", async () => {
      const avant = (await photos(dirigeant, [siege.id]))[siege.id];
      for (const octets of [
        Buffer.from("<svg xmlns='http://www.w3.org/2000/svg' width='9' height='9'/>"),
        Buffer.from("%PDF-1.4\n%%EOF"),
        Buffer.from("pas une image"),
      ]) {
        assert.equal((await poser(siege, octets)).status, 415);
      }
      assert.equal((await photos(dirigeant, [siege.id]))[siege.id], avant);
    });

    it("une photo démesurée est refusée avant d'être lue en entier", async () => {
      // Le serveur coupe le flux : la connexion ne se réemploie pas, et le dit.
      const reponse = await fetch(`${base}/moi/photo`, {
        method: "PUT",
        headers: { ...entetes(siege), Connection: "close" },
        body: Buffer.alloc(9 * 1024 * 1024, 1),
      });
      assert.equal(reponse.status, 413);
    });

    it("la porte refuse une empreinte qui n'en est pas une", async () => {
      await assert.rejects(
        sousIdentiteDuServeur(siege.id, (db) => db.query("select public.ma_photo_ecrire('x')")),
      );
    });

    it("l'ôter l'efface de la base et du disque", async () => {
      const chemin = path.join(racineEssai, "profils", `${siege.id}.jpg`);
      await access(chemin);
      const retrait = await fetch(`${base}/moi/photo`, {
        method: "DELETE",
        headers: entetes(siege),
      });
      assert.equal(retrait.status, 204);
      await assert.rejects(access(chemin));
      assert.equal((await voir(dirigeant, siege)).status, 404);
      assert.deepEqual(await photos(dirigeant, [siege.id]), {});
    });
  },
);
