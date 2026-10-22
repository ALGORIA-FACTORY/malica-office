/**
 * L'application installée depuis un store ne vend rien (22 octobre 2026).
 *
 * Règles de Google Play sur les biens numériques : ni prix, ni offre, ni
 * paiement, ni acceptation d'un abonnement dans la coque — tout cela se fait
 * sur le web et la PWA. L'écran de la coque n'en porte rien ; le serveur
 * refuse toute méthode commerciale à une coque, d'après UNE liste.
 *
 *   node --experimental-strip-types --test src/la-coque-ne-vend-rien.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

import { METHODES_COMMERCIALES } from "@malica/socle/commerce";

const contrat = JSON.parse(
  readFileSync(new URL("../../../contrat/rpc.json", import.meta.url), "utf8"),
) as Record<string, string[]>;

describe("la liste des méthodes commerciales", () => {
  it("ne nomme que des méthodes qui existent au contrat", () => {
    const connues = new Set(contrat["facturation"] ?? []);
    const inconnues = [...METHODES_COMMERCIALES].filter((m) => !connues.has(m));
    assert.deepEqual(inconnues, []);
  });

  it("ne nomme rien qu'un autre dépôt porte aussi : la garde du bundle cherche ces noms seuls", () => {
    const ailleurs = Object.entries(contrat)
      .filter(([depot]) => depot !== "facturation")
      .flatMap(([depot, methodes]) =>
        methodes.filter((m) => METHODES_COMMERCIALES.has(m)).map((m) => `${depot}.${m}`),
      );
    assert.deepEqual(ailleurs, []);
  });

  it("laisse à la coque ce qui ne vend rien : le forfait et le nom des offres", () => {
    for (const m of ["monForfait", "catalogueDesOffres", "libellesDesStatuts", "sieges"]) {
      assert.equal(METHODES_COMMERCIALES.has(m), false, m);
    }
  });
});

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

describe("le serveur refuse à la coque tout geste commercial", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `coque-vend-${Date.now()}`;
  const COQUE = { "X-Malica-Client": "coque-android/0.2.70" };
  let base = "";
  let jeton = "";
  let arret: (() => Promise<void>) | null = null;

  before(async () => {
    const { app } = await import("./app.ts");
    const serveur = app.listen(0);
    await new Promise((resoudre) => serveur.once("listening", resoudre));
    base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
    arret = () => new Promise<void>((resoudre) => serveur.close(() => resoudre()));
    const r = await fetch(`${base}/auth/inscription`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...COQUE },
      body: JSON.stringify({
        email: `${marque}@essai.local`,
        motDePasse: "MotDePasseTresLong2026!",
      }),
    });
    assert.equal(r.status, 201);
    jeton = ((await r.json()) as { jeton: string }).jeton;
  });

  after(async () => {
    await arret?.();
    const { fermerLePool } = await import("./db.ts");
    await fermerLePool();
  });

  const appeler = (methode: string, entetes: Record<string, string>) =>
    fetch(`${base}/rpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${jeton}`, ...entetes },
      body: JSON.stringify({ depot: "facturation", methode, args: [] }),
    });

  it("chaque méthode commerciale est refusée à la coque, sans dire où payer", async () => {
    for (const m of METHODES_COMMERCIALES) {
      const r = await appeler(m, COQUE);
      assert.equal(r.status, 403, m);
      const corps = (await r.json()) as { erreur: string };
      assert.doesNotMatch(corps.erreur, /pay|navigateur|web/i, m);
    }
  });

  it("le nom des offres reste lisible depuis la coque", async () => {
    const r = await appeler("catalogueDesOffres", COQUE);
    assert.equal(r.status, 200);
    const { resultat } = (await r.json()) as { resultat: Array<Record<string, unknown>> };
    assert.ok(resultat.length > 0);
    for (const o of resultat) assert.equal("prix_mensuel_ht" in o, false);
  });

  it("le navigateur n'est pas visé par ce refus", async () => {
    const r = await appeler("mesOffres", {});
    assert.notEqual(r.status, 403);
  });
});
