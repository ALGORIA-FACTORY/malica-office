/**
 * Le courriel d'invitation et son envoi par Brevo.
 *
 *   node --experimental-strip-types --test src/courriel/courriel.test.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { configurationCourriel, envoyerParBrevo, type Expedition } from "./brevo.ts";
import { courrielInvitation, envoyerInvitation } from "./invitation.ts";

const INVITATION = {
  cabinet: "Cabinet d'Expertises CADG",
  pme: "ALGORIA FACTORY SARL",
  lien: "https://app.malica.tn/invitation/" + "a".repeat(64),
  expireLe: new Date("2026-10-18T10:00:00Z"),
};

describe("le courriel d'invitation", () => {
  it("dit qui invite, pour quel dossier, et porte le lien", () => {
    const c = courrielInvitation(INVITATION);
    assert.match(c.sujet, /Cabinet d'Expertises CADG/);
    for (const texte of [c.html, c.texte]) {
      assert.ok(texte.includes("ALGORIA FACTORY SARL"), "le nom du dossier");
      assert.ok(texte.includes(INVITATION.lien), "le lien");
    }
    assert.ok(c.html.includes(`href="${INVITATION.lien}"`), "le bouton mène au lien");
  });

  it("dit jusqu'à quand le lien vaut, en date lisible", () => {
    const c = courrielInvitation(INVITATION);
    assert.match(c.texte, /18 octobre 2026/);
    assert.match(c.html, /18 octobre 2026/);
  });

  it("échappe ce que le cabinet a saisi", () => {
    const c = courrielInvitation({ ...INVITATION, pme: `<script>alert("x")</script> & fils` });
    assert.ok(!c.html.includes("<script>"), "aucune balise injectée");
    assert.ok(c.html.includes("&lt;script&gt;"));
    assert.ok(c.html.includes("&amp; fils"));
  });

  it("refuse un lien qui n'est pas http(s)", () => {
    assert.throws(() => courrielInvitation({ ...INVITATION, lien: "javascript:alert(1)" }));
  });

  it("tient sans feuille de style externe ni image distante", () => {
    const c = courrielInvitation(INVITATION);
    assert.ok(!/<link\b/i.test(c.html), "aucune feuille externe");
    assert.ok(!/<img\b/i.test(c.html), "aucune image à télécharger");
    assert.match(c.html, /^<!doctype html>/i);
  });
});

describe("la configuration d'envoi", () => {
  it("sans clé, rien n'est configuré — et on le dit", () => {
    assert.equal(configurationCourriel({}), null);
  });

  it("avec clé, expéditeur et adresse publique, elle est complète", () => {
    const c = configurationCourriel({
      BREVO_API_KEY: "cle",
      MALICA_COURRIEL_EXPEDITEUR: "w.barouni@algoria-factory.com",
      MALICA_COURRIEL_NOM: "Malica Office",
      MALICA_URL_PUBLIQUE: "http://localhost:8080/",
    });
    assert.deepEqual(c, {
      cle: "cle",
      expediteur: { email: "w.barouni@algoria-factory.com", nom: "Malica Office" },
      urlPublique: "http://localhost:8080",
    });
  });

  it("une clé sans expéditeur ni adresse publique est une erreur, pas un silence", () => {
    assert.throws(
      () => configurationCourriel({ BREVO_API_KEY: "cle" }),
      /MALICA_COURRIEL_EXPEDITEUR/,
    );
  });
});

describe("l'envoi par Brevo", () => {
  const expedition: Expedition = {
    cle: "cle-secrete",
    expediteur: { email: "w.barouni@algoria-factory.com", nom: "Malica Office" },
    destinataire: "contact@algoria-factory.com",
    sujet: "Sujet",
    html: "<p>corps</p>",
    texte: "corps",
  };

  it("poste le courriel transactionnel à l'API de Brevo, la clé en en-tête", async () => {
    let appel: { url: string; init: RequestInit } | undefined;
    const faux = async (url: string | URL | Request, init?: RequestInit) => {
      appel = { url: String(url), init: init ?? {} };
      return new Response(JSON.stringify({ messageId: "<m@brevo>" }), { status: 201 });
    };
    const r = await envoyerParBrevo(expedition, faux as typeof fetch);
    assert.equal(r.messageId, "<m@brevo>");
    assert.equal(appel!.url, "https://api.brevo.com/v3/smtp/email");
    assert.equal(appel!.init.method, "POST");
    const entetes = new Headers(appel!.init.headers);
    assert.equal(entetes.get("api-key"), "cle-secrete");
    const corps = JSON.parse(String(appel!.init.body));
    assert.deepEqual(corps.sender, {
      email: "w.barouni@algoria-factory.com",
      name: "Malica Office",
    });
    assert.deepEqual(corps.to, [{ email: "contact@algoria-factory.com" }]);
    assert.equal(corps.htmlContent, "<p>corps</p>");
    assert.equal(corps.textContent, "corps");
  });

  it("un refus de Brevo remonte avec son statut, sans la clé", async () => {
    const faux = async () => new Response('{"message":"unauthorized"}', { status: 401 });
    await assert.rejects(envoyerParBrevo(expedition, faux as typeof fetch), (e: Error) => {
      assert.match(e.message, /401/);
      assert.ok(!e.message.includes("cle-secrete"));
      return true;
    });
  });
});

describe("l'envoi d'une invitation", () => {
  const invitation = {
    cabinet: "Cabinet d'Expertises CADG",
    pme: "ALGORIA FACTORY SARL",
    email: "contact@algoria-factory.com",
    jeton: "b".repeat(64),
    expireLe: new Date("2026-10-18T10:00:00Z"),
  };
  const config = {
    cle: "cle",
    expediteur: { email: "w.barouni@algoria-factory.com", nom: "Malica Office" },
    urlPublique: "http://localhost:8080",
  };

  it("sans configuration : rien ne part, et le lien reste à transmettre", async () => {
    const r = await envoyerInvitation(invitation, null);
    assert.deepEqual(r, { courriel: "non_configure", lien: null });
  });

  it("configuré : le courriel part, et porte le lien de l'adresse publique", async () => {
    let corps: { to: { email: string }[]; htmlContent: string } | undefined;
    const faux = async (_u: string | URL | Request, init?: RequestInit) => {
      corps = JSON.parse(String(init?.body));
      return new Response("{}", { status: 201 });
    };
    const r = await envoyerInvitation(invitation, config, faux as typeof fetch);
    const lien = "http://localhost:8080/invitation#" + "b".repeat(64);
    assert.deepEqual(r, { courriel: "envoye", lien });
    assert.deepEqual(corps!.to, [{ email: "contact@algoria-factory.com" }]);
    assert.ok(corps!.htmlContent.includes(lien));
  });

  it("Brevo refuse : l'invitation vaut quand même, et le lien reste à transmettre", async () => {
    const faux = async () => new Response("{}", { status: 401 });
    const r = await envoyerInvitation(invitation, config, faux as typeof fetch);
    assert.equal(r.courriel, "echec");
    assert.equal(r.lien, "http://localhost:8080/invitation#" + "b".repeat(64));
  });
});
