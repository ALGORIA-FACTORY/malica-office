/**
 * La photo de profil, côté appareil : refuser tôt ce que le serveur refuserait,
 * lire un 404 comme « pas de photo », dire les refus par leur clé.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const appeler = vi.hoisted(() => vi.fn());
vi.mock("@/lib/transport", () => ({ transport: () => ({ appeler }) }));

import { ErreurApi } from "@/lib/transport/erreurs";

import { lirePhoto, poserMaPhoto, TAILLE_MAX_DE_LA_PHOTO } from "../photo-de-profil";

beforeEach(() => appeler.mockReset());

describe("la photo de profil", () => {
  it("une image trop lourde n'est pas envoyée", async () => {
    const lourde = new Blob([new Uint8Array(TAILLE_MAX_DE_LA_PHOTO + 1)], { type: "image/jpeg" });
    await expect(poserMaPhoto(lourde)).rejects.toMatchObject({
      message: "refus.photo.trop_grosse",
      statut: 413,
    });
    expect(appeler).not.toHaveBeenCalled();
  });

  it("pose la photo sur la route de la personne et rend sa version", async () => {
    appeler.mockResolvedValue(Response.json({ version: "a".repeat(64) }));
    const version = await poserMaPhoto(new Blob(["x"], { type: "image/png" }));
    expect(version).toBe("a".repeat(64));
    expect(appeler).toHaveBeenCalledWith(
      "/moi/photo",
      expect.objectContaining({ method: "PUT", headers: { "Content-Type": "image/png" } }),
    );
  });

  it("un refus du serveur se lève avec sa clé, pour être dit dans la langue de la personne", async () => {
    appeler.mockResolvedValue(
      Response.json({ erreur: "refus.photo.format_refuse" }, { status: 415 }),
    );
    const echec = await poserMaPhoto(new Blob(["x"])).catch((e: unknown) => e);
    expect(echec).toBeInstanceOf(ErreurApi);
    expect((echec as ErreurApi).message).toBe("refus.photo.format_refuse");
  });

  it("lire la photo de quelqu'un que la base ne montre pas : null, pas une erreur", async () => {
    appeler.mockResolvedValue(new Response(null, { status: 404 }));
    expect(await lirePhoto("00000000-0000-4000-8000-000000000001")).toBeNull();
  });
});
