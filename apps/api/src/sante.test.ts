/**
 * La sonde profonde : la base sous le rôle de l'API, le stockage qui écrit et
 * relit. Ce que la surveillance verra en production, éprouvé ici sur une
 * racine de stockage jetable.
 */
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

describe("la sonde profonde", { skip: !BASE_CONFIGUREE }, () => {
  let racineEssai = "";
  let base = "";
  let arret: (() => Promise<void>) | null = null;

  before(async () => {
    racineEssai = await mkdtemp(path.join(tmpdir(), "regalica-sante-"));
    process.env["STOCKAGE_RACINE"] = racineEssai;
    const { app } = await import("./app.ts");
    const serveur = app.listen(0);
    await new Promise((resoudre) => serveur.once("listening", resoudre));
    base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
    arret = () => new Promise<void>((resoudre) => serveur.close(() => resoudre()));
  });

  after(async () => {
    await arret?.();
    const { fermerLePool } = await import("./db.ts");
    await fermerLePool();
    await rm(racineEssai, { recursive: true, force: true });
  });

  it("dit ok quand la base et le stockage répondent, et ne laisse rien derrière elle", async () => {
    const r = await fetch(`${base}/sante/profonde`);
    assert.equal(r.status, 200);
    const corps = (await r.json()) as {
      etat: string;
      base: string;
      stockage: string;
      version: string;
    };
    assert.deepEqual(
      { etat: corps.etat, base: corps.base, stockage: corps.stockage },
      { etat: "ok", base: "ok", stockage: "ok" },
    );
    assert.equal(typeof corps.version, "string");
    // Le témoin est effacé : la sonde ne sème pas de fichiers.
    assert.deepEqual(await readdir(racineEssai), []);
  });

  it("reste gratuite : aucune identité n'est exigée", async () => {
    const r = await fetch(`${base}/sante/profonde`, { headers: { "X-Regalica-Client": "web/x" } });
    assert.equal(r.status, 200);
  });
});
