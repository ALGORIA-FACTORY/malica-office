import "fake-indexeddb/auto";

import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it } from "vitest";

import { garderLeCache, oublierLeCache, restaurerLeCache } from "../cache-de-l-appareil";

/*
 * Ce que l'appareil garde : seulement des lectures de la liste blanche, d'un
 * compte, d'une version, de moins de sept jours. La déconnexion efface tout.
 */
const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

async function remplir(qc: QueryClient, compte: string, version = "1.0.0") {
  const arreter = garderLeCache(qc, compte, version, 5);
  qc.setQueryData(["pieces-lues", "societe-a"], [{ id: "p1" }]);
  qc.setQueryData(["mes-paiements", "societe-a"], [{ montant: "10" }]);
  qc.setQueryData(["apercu", "p1"], "blob:mort");
  await attendre(40);
  arreter();
}

afterEach(async () => {
  await oublierLeCache();
});

describe("le cache de l'appareil", () => {
  it("remet à l'ouverture ce que ce compte avait lu", async () => {
    await remplir(client(), "amel");
    const qc = client();
    expect(await restaurerLeCache(qc, "amel", "1.0.0")).toBe(true);
    expect(qc.getQueryData(["pieces-lues", "societe-a"])).toEqual([{ id: "p1" }]);
  });

  it("ne garde ni paiements, ni aperçus : la liste blanche décide", async () => {
    await remplir(client(), "amel");
    const qc = client();
    await restaurerLeCache(qc, "amel", "1.0.0");
    expect(qc.getQueryData(["mes-paiements", "societe-a"])).toBeUndefined();
    expect(qc.getQueryData(["apercu", "p1"])).toBeUndefined();
  });

  it("une autre personne sur le même appareil ne lit rien", async () => {
    await remplir(client(), "amel");
    const qc = client();
    expect(await restaurerLeCache(qc, "bilel", "1.0.0")).toBe(false);
    expect(qc.getQueryData(["pieces-lues", "societe-a"])).toBeUndefined();
  });

  it("une nouvelle version de l'application jette le cache", async () => {
    await remplir(client(), "amel", "1.0.0");
    expect(await restaurerLeCache(client(), "amel", "1.0.1")).toBe(false);
    // Et l'entrée périmée est effacée.
    expect(await restaurerLeCache(client(), "amel", "1.0.0")).toBe(false);
  });

  it("au-delà de sept jours, mieux vaut attendre le réseau", async () => {
    await remplir(client(), "amel");
    const dans8Jours = Date.now() + 8 * 24 * 60 * 60 * 1000;
    expect(await restaurerLeCache(client(), "amel", "1.0.0", dans8Jours)).toBe(false);
  });

  it("la déconnexion efface tout", async () => {
    await remplir(client(), "amel");
    await oublierLeCache();
    expect(await restaurerLeCache(client(), "amel", "1.0.0")).toBe(false);
  });

  it("ce qui est déjà en mémoire, plus récent, n'est jamais écrasé", async () => {
    await remplir(client(), "amel");
    const qc = client();
    qc.setQueryData(["pieces-lues", "societe-a"], [{ id: "p1" }, { id: "p2" }]);
    await restaurerLeCache(qc, "amel", "1.0.0");
    expect(qc.getQueryData(["pieces-lues", "societe-a"])).toHaveLength(2);
  });
});
