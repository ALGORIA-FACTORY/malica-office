/**
 * Le jeton de rafraîchissement, par le réseau.
 *
 * Ce qu'il établit : seule une coque en reçoit un ; il tourne à chaque usage
 * et l'ancien ne vaut plus rien ; la déconnexion le révoque ; et le jeton
 * d'accès qu'il produit ouvre bien une session.
 */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

describe("le jeton de rafraîchissement", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `rafraichir-${Date.now()}`;
  const COQUE = { "X-Regalica-Client": "coque-android/0.1.0" };
  let base = "";
  let arret: (() => Promise<void>) | null = null;

  before(async () => {
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
  });

  const json = (entetes: Record<string, string>, corps: unknown) => ({
    method: "POST",
    headers: { "Content-Type": "application/json", ...entetes },
    body: JSON.stringify(corps),
  });

  async function inscrire(suffixe: string, entetes: Record<string, string>) {
    const r = await fetch(
      `${base}/auth/inscription`,
      json(entetes, {
        email: `${suffixe}-${marque}@essai.local`,
        motDePasse: "MotDePasseTresLong2026!",
      }),
    );
    assert.equal(r.status, 201);
    return (await r.json()) as { jeton: string; jetonRafraichissement?: string };
  }

  it("le navigateur n'en reçoit pas ; la coque, oui", async () => {
    const web = await inscrire("web", {});
    assert.equal(web.jetonRafraichissement, undefined);
    const coque = await inscrire("coque", COQUE);
    assert.equal(typeof coque.jetonRafraichissement, "string");
    assert.ok(coque.jetonRafraichissement!.length >= 32);
  });

  it("tourne à chaque usage : l'ancien ne vaut plus rien, le neuf ouvre une session", async () => {
    const { jetonRafraichissement: premier } = await inscrire("rotation", COQUE);

    const r = await fetch(
      `${base}/auth/rafraichir`,
      json(COQUE, { jetonRafraichissement: premier }),
    );
    assert.equal(r.status, 200);
    const tourne = (await r.json()) as {
      jeton: string;
      jetonRafraichissement: string;
      utilisateur: { email: string };
    };
    assert.notEqual(tourne.jetonRafraichissement, premier);
    assert.equal(tourne.utilisateur.email, `rotation-${marque}@essai.local`);

    // Le jeton d'accès rendu est un vrai jeton : il ouvre la session, en porteur.
    const session = await fetch(`${base}/auth/session`, {
      headers: { Authorization: `Bearer ${tourne.jeton}` },
    });
    assert.equal(session.status, 200);

    // L'ancien est tourné : le présenter encore est refusé.
    const rejoue = await fetch(
      `${base}/auth/rafraichir`,
      json(COQUE, { jetonRafraichissement: premier }),
    );
    assert.equal(rejoue.status, 401);

    // Le neuf, lui, tourne à son tour.
    const encore = await fetch(
      `${base}/auth/rafraichir`,
      json(COQUE, { jetonRafraichissement: tourne.jetonRafraichissement }),
    );
    assert.equal(encore.status, 200);
  });

  it("la déconnexion révoque le jeton long", async () => {
    const { jetonRafraichissement } = await inscrire("deconnexion", COQUE);
    const sortie = await fetch(`${base}/auth/deconnexion`, json(COQUE, { jetonRafraichissement }));
    assert.equal(sortie.status, 204);
    const apres = await fetch(`${base}/auth/rafraichir`, json(COQUE, { jetonRafraichissement }));
    assert.equal(apres.status, 401);
  });

  it("un jeton inventé ou mal formé ne dit rien de plus qu'un refus", async () => {
    const invente = await fetch(
      `${base}/auth/rafraichir`,
      json(COQUE, { jetonRafraichissement: "x".repeat(43) }),
    );
    assert.equal(invente.status, 401);
    const court = await fetch(
      `${base}/auth/rafraichir`,
      json(COQUE, { jetonRafraichissement: "abc" }),
    );
    assert.equal(court.status, 400);
  });
});
