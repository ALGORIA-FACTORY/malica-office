import { describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import type { DossierComptable, DocumentComptable } from "@malica/socle/ports/repositories";
import { construireArchiveComptable, extensionDuContenu } from "../archive-comptable";

const doc = (id: string, reference = "Même référence"): DocumentComptable => ({
  id,
  reference,
  tenantId: "client",
  type: "facture_achat",
  status: "lue",
  tiers: "Tiers d’essai",
  dateDocument: "2026-10-20",
  recuLe: "2026-10-21",
  montant: "12.345",
  devise: "XXX",
  sourcePieceId: null,
});

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
    const fichiers = unzipSync(archive);
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

  it("arrête les gros fichiers avant de dépasser la borne, même sans Content-Length", async () => {
    const flux = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array(101 * 1024 * 1024));
      },
    });
    await expect(
      construireArchiveComptable(
        { documents: [doc("a")], ecritures: [] },
        async () => new Response(flux),
        () => {},
      ),
    ).rejects.toThrow("cab.biblio.tooLarge");
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
    const fichiers = unzipSync(
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
});
