/**
 * La photo de profil, côté appareil.
 *
 * Les octets ne passent pas par `/rpc` (voir `apps/api/src/photo-de-profil.ts`) :
 * trois routes, avec la session — un `<img src>` vers l'API n'emporterait ni
 * cookie ni jeton, la photo se lit donc en octets, puis se pose en `blob:`.
 *
 * Choisir une photo ne demande rien de plus que le fichier : le serveur la
 * recadre en carré, la réduit et la ré-encode. Ce fichier-ci ne fait que
 * refuser tôt ce que le serveur refuserait (une image trop lourde), pour ne pas
 * envoyer dix mégaoctets afin d'apprendre que c'est trop.
 */
import { transport } from "@/lib/transport";
import { ErreurApi } from "@/lib/transport/erreurs";

/** La borne du serveur (`photo-de-profil.ts`, 8 Mo) : la même, côté appareil. */
export const TAILLE_MAX_DE_LA_PHOTO = 8 * 1024 * 1024;

async function lireLErreur(reponse: Response, repli: string): Promise<never> {
  const corps = (await reponse.json().catch(() => null)) as { erreur?: string } | null;
  throw new ErreurApi(corps?.erreur ?? repli, reponse.status);
}

/** Poser ma photo ; rend sa version. */
export async function poserMaPhoto(fichier: Blob): Promise<string> {
  if (fichier.size > TAILLE_MAX_DE_LA_PHOTO) throw new ErreurApi("refus.photo.trop_grosse", 413);
  const reponse = await transport().appeler("/moi/photo", {
    method: "PUT",
    headers: fichier.type ? { "Content-Type": fichier.type } : {},
    body: fichier,
  });
  if (!reponse.ok) return lireLErreur(reponse, "photo.depot_impossible");
  return ((await reponse.json()) as { version: string }).version;
}

/** Ôter ma photo. */
export async function oterMaPhoto(): Promise<void> {
  const reponse = await transport().appeler("/moi/photo", { method: "DELETE" });
  if (!reponse.ok) return lireLErreur(reponse, "photo.retrait_impossible");
}

/** Les octets de la photo d'une personne ; `null` si la base ne m'en montre pas. */
export async function lirePhoto(userId: string): Promise<Blob | null> {
  const reponse = await transport().appeler(`/moi/photos/${userId}`);
  if (reponse.status === 404) return null;
  if (!reponse.ok) return lireLErreur(reponse, "photo.lecture_impossible");
  return await reponse.blob();
}
