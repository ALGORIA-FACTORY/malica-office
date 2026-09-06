/**
 * Le dépôt IndexedDB, sur une base factice : écrire, relire, garder les octets
 * quand seules les métadonnées changent, supprimer, compter.
 */
import "fake-indexeddb/auto";

import { describe, expect, it } from "vitest";

import { creerDepotIdb } from "../depot-idb";
import { nouvelElement } from "../file";

const T0 = Date.parse("2026-09-05T20:00:00Z");
const entree = (cle: string, taille: number) =>
  nouvelElement(
    {
      cle,
      tenantId: "t",
      entityId: null,
      source: "photo",
      vis: "personnel",
      contentType: "application/pdf",
      nomFichier: `${cle}.pdf`,
      taille,
    },
    T0,
  );

describe("le dépôt IndexedDB", () => {
  it("écrit, relit, garde les octets à travers une mise à jour, supprime", async () => {
    const depot = creerDepotIdb();
    const octets = new Blob([new Uint8Array([1, 2, 3])], { type: "application/pdf" });
    await depot.ecrire(entree("k1", 3), octets);
    await depot.ecrire(entree("k2", 5), new Blob([new Uint8Array(5)]));

    expect((await depot.lister()).map((e) => e.cle).sort()).toEqual(["k1", "k2"]);
    expect(await depot.tailleTotale()).toBe(8);

    // Les métadonnées changent, les octets restent.
    await depot.ecrire({ ...entree("k1", 3), etat: "enregistree", pieceId: "p1" });
    const relu = await depot.octets("k1");
    expect(relu).not.toBeNull();
    expect(new Uint8Array(await relu!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect((await depot.lister()).find((e) => e.cle === "k1")).toMatchObject({
      etat: "enregistree",
      pieceId: "p1",
    });

    await depot.supprimer("k1");
    expect(await depot.octets("k1")).toBeNull();
    expect((await depot.lister()).map((e) => e.cle)).toEqual(["k2"]);
  });
});
