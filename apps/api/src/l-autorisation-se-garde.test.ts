/**
 * L'autorisation se garde — 9 novembre 2026.
 *
 * La coque (`https://localhost`) appelle l'API d'un autre domaine : sans
 * `Access-Control-Max-Age`, la WebView redemande l'autorisation (OPTIONS)
 * toutes les cinq secondes, et chaque écran paie deux allers-retours.
 *
 *   node --experimental-strip-types --test src/l-autorisation-se-garde.test.ts
 */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

describe("l'autorisation d'appeler l'API se garde", () => {
  let base = "";
  let arret: (() => Promise<void>) | null = null;
  const ORIGINE = (process.env["CORS_ORIGINS"] ?? "http://localhost:8080").split(",")[0]!;

  before(async () => {
    const { app } = await import("./app.ts");
    const serveur = app.listen(0);
    await new Promise((resoudre) => serveur.once("listening", resoudre));
    base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
    arret = () => new Promise<void>((resoudre) => serveur.close(() => resoudre()));
  });
  after(async () => {
    await arret?.();
  });

  const demander = (origine: string) =>
    fetch(`${base}/rpc`, {
      method: "OPTIONS",
      headers: {
        Origin: origine,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type",
      },
    });

  it("une origine déclarée reçoit l'autorisation pour deux heures", async () => {
    const r = await demander(ORIGINE);
    assert.equal(r.headers.get("access-control-allow-origin"), ORIGINE);
    assert.equal(r.headers.get("access-control-max-age"), "7200");
  });

  it("une origine inconnue n'en reçoit aucune", async () => {
    const r = await demander("https://imitation.example");
    assert.equal(r.headers.get("access-control-allow-origin"), null);
  });
});
