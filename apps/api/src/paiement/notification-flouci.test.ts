/**
 * La notification de Flouci : la signature, la lecture, et la route HTTP.
 *
 * Sans réseau vers Flouci. La route est appelée à travers l'application réelle
 * quand une base est configurée ; la signature se vérifie partout.
 *
 *   node --experimental-strip-types --test src/paiement/notification-flouci.test.ts
 */
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

import {
  adresseDeNotification,
  FENETRE_MS,
  lireNotification,
  signatureFlouciValide,
} from "./notification-flouci.ts";

const CLE = "cle-privee-d-essai";

function signer(corps: string, t: number, cle = CLE): string {
  const v1 = createHmac("sha256", cle).update(`${t}.${corps}`).digest("hex");
  return `t=${t},v1=${v1}`;
}

describe("la notification de Flouci", () => {
  const maintenant = 1_795_000_000_000;
  const t = Math.floor(maintenant / 1000);
  const corps = JSON.stringify({
    event: "payment.succeeded",
    payment_id: "AgCK",
    developer_tracking_id: "11111111-2222-3333-4444-555555555555",
    amount: 7030,
  });

  it("une signature juste, sur le corps brut, dans la fenêtre, est admise", () => {
    assert.equal(
      signatureFlouciValide(signer(corps, t), Buffer.from(corps), CLE, maintenant),
      true,
    );
  });

  it("tout le reste est refusé : autre clé, corps retouché, horodatage hors fenêtre, en-tête mal formé", () => {
    const b = Buffer.from(corps);
    assert.equal(signatureFlouciValide(signer(corps, t, "autre"), b, CLE, maintenant), false);
    assert.equal(
      signatureFlouciValide(
        signer(corps, t),
        Buffer.from(corps.replace("7030", "1")),
        CLE,
        maintenant,
      ),
      false,
    );
    const vieux = t - FENETRE_MS / 1000 - 1;
    assert.equal(signatureFlouciValide(signer(corps, vieux), b, CLE, maintenant), false, "rejeu");
    for (const entete of [
      undefined,
      "",
      "t=abc,v1=00",
      `v1=${"0".repeat(64)}`,
      `t=${t}`,
      `t=${t},v1=zz`,
    ]) {
      assert.equal(signatureFlouciValide(entete, b, CLE, maintenant), false, String(entete));
    }
    assert.equal(
      signatureFlouciValide(signer(corps, t), b, "", maintenant),
      false,
      "sans clé, rien",
    );
  });

  it("on ne retient que le paiement et la session ; un corps douteux ne se lit pas", () => {
    assert.deepEqual(lireNotification(Buffer.from(corps)), {
      paiementId: "11111111-2222-3333-4444-555555555555",
      reference: "AgCK",
    });
    for (const c of [
      "pas du json",
      JSON.stringify({ payment_id: "AgCK" }),
      JSON.stringify({ payment_id: "AgCK", developer_tracking_id: "x" }),
      JSON.stringify({ payment_id: "a b", developer_tracking_id: randomUUID() }),
      "null",
    ]) {
      assert.equal(lireNotification(Buffer.from(c)), null, c);
    }
  });

  it("l'adresse de notification est celle de l'environnement", () => {
    assert.equal(
      adresseDeNotification("https://pilote.exemple.tn/"),
      "https://pilote.exemple.tn/notifications-de-paiement/flouci",
    );
  });
});

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

describe("la route de notification, par HTTP", { skip: !BASE_CONFIGUREE }, () => {
  let base = "";
  let arret: (() => Promise<void>) | null = null;
  const avant = process.env["FLOUCI_CLE_PRIVEE"];

  before(async () => {
    process.env["FLOUCI_CLE_PRIVEE"] = CLE;
    const { app } = await import("../app.ts");
    const serveur = app.listen(0);
    await new Promise((r) => serveur.once("listening", r));
    base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
    arret = () => new Promise<void>((r) => serveur.close(() => r()));
  });

  after(async () => {
    await arret?.();
    if (avant === undefined) delete process.env["FLOUCI_CLE_PRIVEE"];
    else process.env["FLOUCI_CLE_PRIVEE"] = avant;
    const { fermerLePool } = await import("../db.ts");
    await fermerLePool();
  });

  const envoyer = (corps: string, entete?: string) =>
    fetch(`${base}/notifications-de-paiement/flouci`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(entete ? { "x-flouci-signature": entete } : {}),
      },
      body: corps,
    });

  it("sans signature, ou avec une fausse : 401, rien n'est lu", async () => {
    const corps = JSON.stringify({ payment_id: "AgCK", developer_tracking_id: randomUUID() });
    assert.equal((await envoyer(corps)).status, 401);
    const t = Math.floor(Date.now() / 1000);
    assert.equal((await envoyer(corps, signer(corps, t, "autre"))).status, 401);
  });

  it("signée, pour un paiement inconnu sous cette référence : 200, rien à faire", async () => {
    const corps = JSON.stringify({ payment_id: "AgCK", developer_tracking_id: randomUUID() });
    const r = await envoyer(corps, signer(corps, Math.floor(Date.now() / 1000)));
    assert.equal(r.status, 200);
    assert.equal(await r.text(), "", "la réponse ne dit rien de l'état d'un paiement");
  });

  it("signée mais illisible : 400", async () => {
    const corps = JSON.stringify({ payment_id: "AgCK" });
    assert.equal((await envoyer(corps, signer(corps, Math.floor(Date.now() / 1000)))).status, 400);
  });
});
