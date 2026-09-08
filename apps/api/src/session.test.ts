/**
 * Le client se présente, et une coque dépassée est refusée à la porte.
 *
 * Deux moitiés : la lecture de l'en-tête et la comparaison de versions, pures ;
 * puis le 426 par le réseau, sur la vraie application — parce que c'est
 * l'ordre de montage qui décide qu'un 426 précède toute route.
 */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

import { clientDepasse, lireClient, versionInferieure } from "./session.ts";

describe("ce que le client dit de lui", () => {
  it("lit « nom/version », et ignore l'empreinte du bundle après le +", () => {
    assert.deepEqual(lireClient("coque-android/0.3.1+abc123"), {
      nom: "coque-android",
      version: "0.3.1",
    });
    assert.deepEqual(lireClient("web/abc1234"), null);
    assert.deepEqual(lireClient("Web/1"), { nom: "web", version: "1" });
  });

  it("refuse ce qui n'a pas cette forme", () => {
    assert.equal(lireClient(undefined), null);
    assert.equal(lireClient(""), null);
    assert.equal(lireClient("coque-android"), null);
    assert.equal(lireClient("coque-android/1.2.3/4"), null);
    assert.equal(lireClient("<script>/1"), null);
  });

  it("compare les versions composante par composante, pas lettre à lettre", () => {
    assert.equal(versionInferieure("0.9.0", "0.10.0"), true);
    assert.equal(versionInferieure("1.0", "1.0.0"), false);
    assert.equal(versionInferieure("1.0.1", "1.0"), false);
    assert.equal(versionInferieure("2", "10"), true);
  });

  it("ne refuse que les coques, et seulement sous la version minimale", () => {
    assert.equal(clientDepasse({ nom: "coque-android", version: "0.1.0" }, "0.2.0"), true);
    assert.equal(clientDepasse({ nom: "coque-android", version: "0.2.0" }, "0.2.0"), false);
    assert.equal(clientDepasse({ nom: "web", version: "0.0.1" }, "0.2.0"), false);
    assert.equal(clientDepasse(null, "0.2.0"), false);
    assert.equal(clientDepasse({ nom: "coque-android", version: "0.1.0" }, undefined), false);
  });
});

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

describe("le 426 par le réseau", { skip: !BASE_CONFIGUREE }, () => {
  let base = "";
  let arret: (() => Promise<void>) | null = null;
  let minimaleAvant: string | undefined;

  before(async () => {
    minimaleAvant = process.env["CLIENT_MIN_VERSION"];
    process.env["CLIENT_MIN_VERSION"] = "0.2.0";
    const { app } = await import("./app.ts");
    const serveur = app.listen(0);
    await new Promise((resoudre) => serveur.once("listening", resoudre));
    base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
    arret = () => new Promise<void>((resoudre) => serveur.close(() => resoudre()));
  });

  after(async () => {
    if (minimaleAvant === undefined) delete process.env["CLIENT_MIN_VERSION"];
    else process.env["CLIENT_MIN_VERSION"] = minimaleAvant;
    await arret?.();
    const { fermerLePool } = await import("./db.ts");
    await fermerLePool();
  });

  const sante = (client?: string) =>
    fetch(`${base}/sante`, { headers: client ? { "X-Malica-Client": client } : {} });

  it("une coque trop ancienne reçoit 426, avant toute route", async () => {
    const r = await sante("coque-android/0.1.9");
    assert.equal(r.status, 426);
    const corps = (await r.json()) as { versionMinimale: string };
    assert.equal(corps.versionMinimale, "0.2.0");
  });

  it("une coque à jour, un navigateur, ou un client muet passent", async () => {
    assert.equal((await sante("coque-android/0.2.0")).status, 200);
    assert.equal((await sante("coque-android/1.0.0+deadbeef")).status, 200);
    assert.equal((await sante("web/abc1234")).status, 200);
    assert.equal((await sante()).status, 200);
  });
});
