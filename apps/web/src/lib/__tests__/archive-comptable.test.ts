/**
 * L'archive comptable — ce que le cabinet reçoit en ZIP doit être fidèle et sûr.
 *
 * Garantit que les originaux passent octet pour octet, sans doublon, avec l'empreinte
 * scellée à la réception et sans la recalculer ; que l'ordre du dossier est gardé même
 * si les pièces arrivent dans le désordre ; que le téléchargement reste borné à quatre
 * pièces à la fois, s'arrête dès qu'une pièce manque ou que la personne annule, et ne
 * rend jamais une archive incomplète. Les noms de fichiers sont neutralisés contre la
 * traversée de chemins, et les formules des CSV aussi : l'archive est ouverte dans un
 * tableur, qui ne doit rien exécuter.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import type { DossierComptable, DocumentComptable } from "@malica/socle/ports/repositories";
import { construireArchiveComptable } from "../archive-comptable";
import { extensionDuContenu } from "../nom-de-fichier";

const doc = (id: string, reference = "Même référence"): DocumentComptable => ({
  id,
  reference,
  tenantId: "client",
  type: "facture_achat",
  status: "lue",
  tiers: "Tiers d’essai",
  dateDocument: "2026-10-20",
  dateDeClassement: "2026-10-20",
  recuLe: "2026-10-21",
  empreinte: null,
  montant: "12.345",
  devise: "XXX",
  sourcePieceId: null,
});

/** L'archive est un Blob construit en flux ; on la relit en entier pour l'épreuve. */
async function ouvrir(archive: Blob | Uint8Array) {
  const octets =
    archive instanceof Uint8Array ? archive : new Uint8Array(await archive.arrayBuffer());
  return unzipSync(octets);
}

afterEach(() => vi.restoreAllMocks());

describe("archive comptable", () => {
  it("conserve les octets et types, déduplique les pièces et distingue les références identiques", async () => {
    const documents = [doc("a"), doc("b"), doc("a")];
    const progression: number[] = [];
    const archive = await construireArchiveComptable(
      { documents, ecritures: [] },
      async (id) =>
        new Response(id === "a" ? "original pdf" : "original image", {
          headers: { "content-type": id === "a" ? "application/pdf" : "image/png" },
        }),
      (n) => progression.push(n),
    );
    const fichiers = await ouvrir(archive);
    const originaux = Object.keys(fichiers).filter((n) => n.startsWith("Originaux/"));
    expect(originaux).toHaveLength(2);
    expect(strFromU8(fichiers[originaux.find((n) => n.endsWith(".png"))!]!)).toBe("original image");
    expect(strFromU8(fichiers[originaux.find((n) => n.endsWith(".pdf"))!]!)).toBe("original pdf");
    expect(progression).toEqual([1, 2]);
    expect(strFromU8(fichiers["Index.csv"]!)).toContain("sha256");
    expect(JSON.parse(strFromU8(fichiers["Dossier.json"]!)).documents).toHaveLength(2);
  });

  it("ne remet pas d'archive si une seule pièce manque ou devient interdite", async () => {
    const dossier = { documents: [doc("a"), doc("b")], ecritures: [] };
    await expect(
      construireArchiveComptable(
        dossier,
        async (id) => new Response("x", { status: id === "a" ? 200 : 404 }),
        () => {},
      ),
    ).rejects.toThrow("cab.biblio.missing");
  });

  it("ne plafonne plus le dossier à 100 Mo : seule la borne du format ZIP arrête", async () => {
    // Le serveur annonce 200 Mo : l'ancienne garde refusait avant même de lire.
    const archive = await construireArchiveComptable(
      { documents: [doc("a")], ecritures: [] },
      async () =>
        new Response("petit", { headers: { "content-length": String(200 * 1024 * 1024) } }),
      () => {},
    );
    const fichiers = await ouvrir(archive);
    expect(Object.keys(fichiers).some((n) => n.startsWith("Originaux/"))).toBe(true);
  });

  it("respecte l'annulation et ne charge aucune pièce après celle-ci", async () => {
    const arret = new AbortController();
    arret.abort();
    let appels = 0;
    await expect(
      construireArchiveComptable(
        { documents: [doc("a")], ecritures: [] },
        async () => {
          appels++;
          return new Response("x");
        },
        () => {},
        arret.signal,
      ),
    ).rejects.toThrow();
    expect(appels).toBe(0);
  });

  it("neutralise traversée de chemins et formules CSV sans modifier les originaux", async () => {
    const dossier: DossierComptable = {
      documents: [doc("a", "../../=HYPERLINK(1)")],
      ecritures: [
        {
          id: "e",
          pieceId: "a",
          paiementId: null,
          nature: "piece",
          journal: "J",
          date: "2026-10-20",
          libelle: "=1+1",
          statut: "proposee",
          compte: "A",
          debit: "12.345",
          credit: "0",
        },
      ],
    };
    const fichiers = await ouvrir(
      await construireArchiveComptable(
        dossier,
        async () => new Response("x"),
        () => {},
      ),
    );
    expect(Object.keys(fichiers).some((n) => n.includes(".."))).toBe(false);
    expect(strFromU8(fichiers["Ecritures.csv"]!)).toContain("'=1+1");
    expect(strFromU8(fichiers["Ecritures.csv"]!)).toContain("proposee");
  });

  it("ne prétend pas convertir un contenu inconnu en PDF", () => {
    expect(extensionDuContenu("image/jpeg; charset=binary")).toBe("jpg");
    expect(extensionDuContenu("application/octet-stream")).toBe("bin");
  });

  it("télécharge en parallèle, mais jamais plus de quatre pièces à la fois", async () => {
    let enCours = 0;
    let maximum = 0;
    const documents = Array.from({ length: 12 }, (_, i) => doc(`p${i}`, `R${i}`));
    const archive = await construireArchiveComptable(
      { documents, ecritures: [] },
      async (id) => {
        enCours++;
        maximum = Math.max(maximum, enCours);
        await new Promise((r) => setTimeout(r, 5));
        enCours--;
        return new Response(`contenu ${id}`);
      },
      () => {},
    );
    expect(maximum).toBeGreaterThan(1);
    expect(maximum).toBeLessThanOrEqual(4);
    const fichiers = await ouvrir(archive);
    expect(Object.keys(fichiers).filter((n) => n.startsWith("Originaux/"))).toHaveLength(12);
  });

  it("garde l'ordre du dossier même quand les pièces arrivent dans le désordre", async () => {
    const documents = [doc("lente", "R1"), doc("rapide", "R2")];
    const progression: number[] = [];
    const fichiers = await ouvrir(
      await construireArchiveComptable(
        { documents, ecritures: [] },
        async (id) => {
          await new Promise((r) => setTimeout(r, id === "lente" ? 30 : 0));
          return new Response(id);
        },
        (n) => progression.push(n),
      ),
    );
    const index = strFromU8(fichiers["Index.csv"]!).split("\r\n").slice(1, 3);
    expect(index[0]).toContain('"lente"');
    expect(index[1]).toContain('"rapide"');
    expect(progression).toEqual([1, 2]);
  });

  it("inscrit l'empreinte scellée à la réception, sans la recalculer", async () => {
    const digest = vi.spyOn(crypto.subtle, "digest");
    const scellee = "b".repeat(64);
    const fichiers = await ouvrir(
      await construireArchiveComptable(
        { documents: [{ ...doc("a"), empreinte: scellee }, doc("b", "R2")], ecritures: [] },
        async () => new Response("octets"),
        () => {},
      ),
    );
    const index = strFromU8(fichiers["Index.csv"]!);
    expect(index).toContain(`"${scellee}"`);
    expect(digest).not.toHaveBeenCalled();
  });

  it("arrête les téléchargements en cours dès qu'une pièce manque", async () => {
    const arretes: string[] = [];
    await expect(
      construireArchiveComptable(
        { documents: [doc("a"), doc("b", "R2"), doc("c", "R3")], ecritures: [] },
        (id, signal) =>
          id === "a"
            ? Promise.resolve(new Response("x", { status: 404 }))
            : new Promise<Response>((_, rejeter) =>
                signal.addEventListener("abort", () => {
                  arretes.push(id);
                  rejeter(signal.reason);
                }),
              ),
        () => {},
      ),
    ).rejects.toThrow("cab.biblio.missing");
    expect(arretes.sort()).toEqual(["b", "c"]);
  });

  it("rend un Blob ZIP, sans copie intermédiaire en Uint8Array", async () => {
    const archive = await construireArchiveComptable(
      { documents: [doc("a")], ecritures: [] },
      async () => new Response("x"),
      () => {},
    );
    expect(archive).toBeInstanceOf(Blob);
    expect((archive as Blob).type).toBe("application/zip");
  });
});
