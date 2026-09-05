import { describe, expect, it } from "vitest";

import { blobDepuisBase64, numeriseur, PAGES_MAX, type PontNatif } from "../numerisation";

/** Un pont de laboratoire : ce que la coque native ferait, sans coque native. */
function pont(
  estNatif: boolean,
  reponse: { images: string[]; annule: boolean } = { images: [], annule: false },
): PontNatif & { demande: number[] } {
  const demande: number[] = [];
  return {
    demande,
    estNatif: () => estNatif,
    scanner: async (maxPages) => {
      demande.push(maxPages);
      return reponse;
    },
  };
}

/** Un JPEG minuscule mais valide, en base64. */
const JPEG =
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a" +
  "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA" +
  "AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

describe("numérisation — qui cadre le document", () => {
  it("dans un navigateur, il n'y a pas de scanner d'appareil", () => {
    // `null` n'est pas une panne : c'est le cas normal sur un poste, dans
    // l'aperçu et dans les épreuves. L'écran cadre alors lui-même.
    expect(numeriseur(pont(false))).toBeNull();
  });

  it("dans la coque native, le scanner de l'appareil prend la main", () => {
    const n = numeriseur(pont(true));
    expect(n).not.toBeNull();
    expect(n!.origine).toBe("natif");
  });

  it("rend une page par image scannée", async () => {
    const n = numeriseur(pont(true, { images: [JPEG, JPEG], annule: false }));
    const pages = await n!.capturer();
    expect(pages).toHaveLength(2);
    expect(pages[0]!.type).toBe("image/jpeg");
    expect(pages[0]!.size).toBeGreaterThan(100);
  });

  it("un abandon rend zéro page, et n'est pas une erreur", async () => {
    // L'utilisateur qui ferme le scanner ne doit pas voir de message d'échec.
    const n = numeriseur(pont(true, { images: [], annule: true }));
    await expect(n!.capturer()).resolves.toEqual([]);
  });

  it("borne le nombre de pages à ce que les deux plateformes acceptent", async () => {
    // VisionKit s'arrête à 24 : demander plus ferait échouer la capture sur iOS
    // seulement, et le défaut ne se verrait pas sur Android.
    const p = pont(true);
    await numeriseur(p)!.capturer(500);
    await numeriseur(p)!.capturer(0);
    await numeriseur(p)!.capturer(3);
    expect(p.demande).toEqual([PAGES_MAX, 1, 3]);
  });
});

describe("numérisation — les octets rendus par l'appareil", () => {
  it("lit une image base64 nue", () => {
    const blob = blobDepuisBase64(JPEG);
    expect(blob.size).toBeGreaterThan(100);
    expect(blob.type).toBe("image/jpeg");
  });

  it("lit aussi une image préfixée d'un en-tête data:", () => {
    // Les deux formes arrivent selon la plateforme. Ne traiter qu'une seule
    // donnerait un fichier corrompu sur un des deux téléphones — et sur un
    // seul, ce qui est le plus difficile à diagnostiquer.
    const nu = blobDepuisBase64(JPEG);
    const prefixe = blobDepuisBase64(`data:image/jpeg;base64,${JPEG}`);
    expect(prefixe.size).toBe(nu.size);
  });
});
