/**
 * La photo de profil — le seul octet de personne que `/rpc` ne porte pas.
 *
 * Même raison d'être que `stockage.ts` : un flux binaire n'a pas sa place dans
 * un appel JSON. Même discipline, en plus petit.
 *
 * **Le chemin ne vient jamais du client.** `<STOCKAGE_RACINE>/profils/<user_id>.jpg` :
 * l'identifiant est celui de la SESSION pour écrire, et celui d'une ligne que
 * la base a rendue pour lire. `profils` n'est pas un uuid : aucun dossier de
 * tenant ne peut s'y confondre.
 *
 * **L'autorisation de lire est un `select`.** On demande le profil à la base,
 * sous l'identité de l'appelant : la RLS (`profiles_own`) rend les membres de
 * ses organisations, soi-même, l'accès total — et personne d'autre. Ligne
 * absente, ou sans photo : 404, jamais 403, qui dirait « cette personne existe
 * mais pas pour vous ».
 *
 * **Écrire, c'est ré-encoder.** Les octets reçus ne sont jamais gardés : ils
 * deviennent un carré JPEG de 256 px (`fabriquerPortrait`), sans métadonnées.
 * L'empreinte de CE fichier est ce que la base retient (`ma_photo_ecrire`).
 *
 * **La personne n'écrit que la sienne**, et le dirigeant n'écrit pas celle
 * d'un autre : la route n'a pas d'identifiant, la porte non plus.
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";

import type { Request, Response } from "express";

import { sousIdentite } from "./db.ts";
import { fabriquerPortrait } from "./miniature.ts";
import { borneDeTaille, PieceTropGrosse, racine, UUID } from "./stockage.ts";

/** Ce qu'une photo de téléphone pèse, avec marge : au-delà, ce n'est pas un portrait. */
const TAILLE_MAX_DE_LA_PHOTO = 8 * 1024 * 1024;

function cheminDeLaPhoto(userId: string): string {
  const base = racine();
  const resolu = path.resolve(base, "profils", `${userId}.jpg`);
  if (!resolu.startsWith(path.join(base, "profils") + path.sep)) {
    throw new Error("chemin hors du stockage");
  }
  return resolu;
}

async function lireLeCorps(req: Request): Promise<Buffer> {
  const morceaux: Buffer[] = [];
  await pipeline(
    req,
    borneDeTaille(TAILLE_MAX_DE_LA_PHOTO),
    new Writable({
      write(morceau: Buffer, _encodage, suite) {
        morceaux.push(morceau);
        suite();
      },
    }),
  );
  return Buffer.concat(morceaux);
}

/** `PUT /moi/photo` — poser ma photo. Rend la version (l'empreinte) du fichier gardé. */
export async function poserMaPhoto(req: Request, res: Response): Promise<void> {
  const userId = req.utilisateur!.id;
  let octets: Buffer;
  try {
    octets = await lireLeCorps(req);
  } catch (erreur) {
    if (erreur instanceof PieceTropGrosse) {
      res.status(413).json({ erreur: "refus.photo.trop_grosse" });
      return;
    }
    throw erreur;
  }
  let portrait: Buffer | null = null;
  try {
    portrait = await fabriquerPortrait(octets);
  } catch {
    // Un décodeur qui lève : des octets qui ne sont pas une image que l'on sait lire.
    portrait = null;
  }
  if (!portrait) {
    res.status(415).json({ erreur: "refus.photo.format_refuse" });
    return;
  }
  const version = createHash("sha256").update(portrait).digest("hex");

  const destination = cheminDeLaPhoto(userId);
  await mkdir(path.dirname(destination), { recursive: true });
  // À côté puis renommé : jamais un fichier à moitié écrit servi comme un visage.
  const provisoire = `${destination}.${randomUUID()}.partiel`;
  try {
    await writeFile(provisoire, portrait);
    await rename(provisoire, destination);
  } catch (erreur) {
    await rm(provisoire, { force: true });
    throw erreur;
  }
  await sousIdentite(userId, (db) => db.query(`select public.ma_photo_ecrire($1)`, [version]));
  res.status(200).json({ version });
}

/** `DELETE /moi/photo` — ôter ma photo : la base d'abord, le fichier ensuite. */
export async function oterMaPhoto(req: Request, res: Response): Promise<void> {
  const userId = req.utilisateur!.id;
  await sousIdentite(userId, (db) => db.query(`select public.ma_photo_ecrire(null)`));
  await rm(cheminDeLaPhoto(userId), { force: true });
  res.status(204).end();
}

/** `GET /moi/photos/:id` — la photo d'une personne que la base me laisse voir. */
export async function servirUnePhoto(req: Request, res: Response): Promise<void> {
  const id = req.params["id"];
  if (typeof id !== "string" || !UUID.test(id)) {
    res.status(404).json({ erreur: "photo introuvable" });
    return;
  }
  const ligne = await sousIdentite(req.utilisateur!.id, async (db) => {
    const { rows } = await db.query<{ user_id: string }>(
      `select user_id from identity.profiles where user_id = $1 and photo_version is not null`,
      [id],
    );
    return rows[0] ?? null;
  });
  if (!ligne) {
    res.status(404).json({ erreur: "photo introuvable" });
    return;
  }
  let octets: Buffer;
  try {
    octets = await readFile(cheminDeLaPhoto(ligne.user_id));
  } catch (erreur) {
    if ((erreur as NodeJS.ErrnoException).code === "ENOENT") {
      res.status(404).json({ erreur: "photo introuvable" });
      return;
    }
    throw erreur;
  }
  // Pas de cache HTTP : il ne distingue pas deux comptes sur un même appareil
  // (même raison que la miniature d'une pièce). L'écran garde la sienne, par version.
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Type", "image/jpeg");
  res.setHeader("Content-Length", String(octets.length));
  res.end(octets);
}
