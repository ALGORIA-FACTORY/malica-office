/**
 * « Demander l'avis de ma comptabilité » : ce que le serveur lit du fil, et ce
 * qu'il remet à la file. Sans base : les dépôts sont simulés.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AppelApi } from "../appel-local.ts";
import { demanderLAvis, dernierEchange } from "./avis.ts";

const ligne = (role: "user" | "assistant", contenu: string) => ({ role, contenu, sources: null });

function apiSimulee(options: {
  cabinetId: string | null;
  fil: Array<ReturnType<typeof ligne>>;
  deja?: boolean;
}) {
  const appels: Array<{ nom: string; args: unknown[] }> = [];
  const api: AppelApi = {
    async rpc<T>(depot: string, methode: string, args: unknown[] = []): Promise<T> {
      const nom = `${depot}.${methode}`;
      appels.push({ nom, args });
      switch (nom) {
        case "conseil.contexte":
          return { cabinetId: options.cabinetId } as T;
        case "conversations.ouvrir":
          return options.fil as T;
        case "conseil.creer":
          return { id: "arb-1", cabinetId: options.cabinetId, deja: options.deja === true } as T;
        default:
          throw new Error(`appel non prévu : ${nom}`);
      }
    },
  } as AppelApi;
  return { api, appels };
}

const DEMANDE = { tenantId: "t", conversationId: "c", locale: "fr" };

describe("le dernier échange d'un fil", () => {
  it("prend la dernière question qui a reçu une réponse", () => {
    const fil = [
      ligne("user", "Première ?"),
      ligne("assistant", "Réponse une."),
      ligne("user", "Seconde ?"),
      ligne("assistant", "Réponse deux."),
    ];
    assert.deepEqual(dernierEchange(fil), {
      question: "Seconde ?",
      reponse: "Réponse deux.",
      sources: null,
    });
  });

  it("ignore une question restée sans réponse, et un fil vide", () => {
    assert.equal(
      dernierEchange([
        ligne("user", "Première ?"),
        ligne("assistant", "Réponse."),
        ligne("user", "En attente ?"),
      ])?.question,
      "Première ?",
    );
    assert.equal(dernierEchange([]), null);
    assert.equal(dernierEchange([ligne("user", "Seule ?")]), null);
  });
});

describe("demander l'avis de la comptabilité", () => {
  it("remet la question et la réponse à la file, comme une réponse déjà donnée", async () => {
    const { api, appels } = apiSimulee({
      cabinetId: "cab",
      fil: [ligne("user", "Dois-je retenir ?"), ligne("assistant", "Oui.")],
    });
    assert.deepEqual(await demanderLAvis(api, DEMANDE), { etat: "envoye", deja: false });
    const pose = appels.find((a) => a.nom === "conseil.creer")!.args[0] as Record<string, unknown>;
    assert.equal(pose["question"], "Dois-je retenir ?");
    assert.equal(pose["reponse"], "Oui.");
    assert.equal(pose["canal"], "avis");
    assert.equal(pose["statut"], "repondue");
    assert.equal(pose["certitude"], 0);
    assert.ok(String(pose["doute"]).includes("comptabilité"));
  });

  it("dit que la réponse y était déjà, sans rien d'autre", async () => {
    const { api } = apiSimulee({
      cabinetId: "cab",
      fil: [ligne("user", "Dois-je retenir ?"), ligne("assistant", "Oui.")],
      deja: true,
    });
    assert.deepEqual(await demanderLAvis(api, DEMANDE), { etat: "envoye", deja: true });
  });

  it("sans comptabilité reliée : rien n'est lu ni écrit", async () => {
    const { api, appels } = apiSimulee({ cabinetId: null, fil: [] });
    assert.deepEqual(await demanderLAvis(api, DEMANDE), { etat: "sans_comptabilite" });
    assert.deepEqual(
      appels.map((a) => a.nom),
      ["conseil.contexte"],
    );
  });

  it("sans réponse au fil : rien ne part", async () => {
    const { api, appels } = apiSimulee({ cabinetId: "cab", fil: [ligne("user", "Seule ?")] });
    assert.deepEqual(await demanderLAvis(api, DEMANDE), { etat: "sans_reponse" });
    assert.ok(!appels.some((a) => a.nom === "conseil.creer"));
  });
});
