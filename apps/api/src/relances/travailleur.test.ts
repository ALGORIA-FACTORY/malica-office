/**
 * Le travailleur des relances, sans base ni réseau : il ne décide de rien,
 * il remet ce que la base a décidé et inscrit chaque tentative.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Requete } from "../db.ts";

import { courrielDeNotification } from "./courriel-de-notification.ts";
import { tourDeRelances } from "./travailleur.ts";

const COURRIEL = {
  envoi_id: "e1",
  email: "titulaire@essai.local",
  locale: "ar",
  titre: "Facture <ALG-1> en retard",
  corps: "Reste 12,000 TND.",
  action_libelle: "Payer",
  action_route: "/pme/reglages",
};

function fausseBase() {
  const appels: Array<{ sql: string; params: unknown[] | undefined }> = [];
  const db = {
    query: async (sql: string, params?: unknown[]) => {
      appels.push({ sql, params });
      if (sql.includes("relancer_les_impayes"))
        return { rows: [{ r: { actives: true, postes: 1 } }] };
      // La file rend le courriel une fois, puis se vide (il est inscrit).
      if (sql.includes("courriels_a_remettre")) {
        const servi = appels.filter((a) => a.sql.includes("courriels_a_remettre")).length;
        return { rows: servi === 1 ? [COURRIEL] : [] };
      }
      return { rows: [] };
    },
  } as unknown as Requete;
  return { appels, executer: <T>(t: (d: Requete) => Promise<T>) => t(db) };
}

const ENV = {
  BREVO_API_KEY: "cle-d-essai",
  MALICA_COURRIEL_EXPEDITEUR: "noreply@essai.local",
  MALICA_URL_PUBLIQUE: "https://app.essai.local/",
};

describe("le travailleur des relances", () => {
  it("sans clé Brevo : il laisse décider la base, n'envoie rien, n'inscrit rien", async () => {
    const b = fausseBase();
    const r = await tourDeRelances({ executer: b.executer, env: {} });
    assert.equal(r.sansCle, true);
    assert.equal(b.appels.length, 1);
    assert.match(b.appels[0]!.sql, /relancer_les_impayes/);
  });

  it("remet par Brevo et inscrit « remis »", async () => {
    const b = fausseBase();
    const envoyes: Array<Record<string, unknown>> = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      envoyes.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ messageId: "m1" }), { status: 201 });
    }) as typeof fetch;
    const r = await tourDeRelances({ executer: b.executer, env: ENV, fetchImpl });
    assert.equal(r.remis, 1);
    assert.equal(envoyes.length, 1);
    assert.equal(envoyes[0]!["subject"], COURRIEL.titre);
    assert.match(String(envoyes[0]!["htmlContent"]), /https:\/\/app\.essai\.local\/pme\/reglages/);
    const remise = b.appels.find((a) => a.sql.includes("notif.remettre"));
    assert.deepEqual(remise?.params, ["e1", "remis", null]);
  });

  it("un refus de Brevo s'inscrit « echoue », avec l'erreur", async () => {
    const b = fausseBase();
    const fetchImpl = (async () => new Response("non", { status: 401 })) as typeof fetch;
    const r = await tourDeRelances({ executer: b.executer, env: ENV, fetchImpl });
    assert.equal(r.echecs, 1);
    const remise = b.appels.find((a) => a.sql.includes("notif.remettre"));
    assert.equal(remise?.params?.[1], "echoue");
    assert.ok(String(remise?.params?.[2]).length > 0);
  });
});

describe("le courriel d'une notification", () => {
  it("échappe le texte, se lit de droite à gauche en arabe, garde le lien", () => {
    const c = courrielDeNotification({
      locale: "ar",
      titre: COURRIEL.titre,
      corps: COURRIEL.corps,
      action: { libelle: "Payer", url: "https://app.essai.local/pme/reglages" },
    });
    assert.equal(c.sujet, COURRIEL.titre);
    assert.match(c.html, /<html lang="ar" dir="rtl">/);
    assert.ok(c.html.includes("&lt;ALG-1&gt;"));
    assert.ok(!c.html.includes("<ALG-1>"));
    assert.ok(c.texte.includes("https://app.essai.local/pme/reglages"));
  });

  it("une langue inconnue retombe sur le français ; un lien non http est refusé", () => {
    const c = courrielDeNotification({ locale: "xx", titre: "T", corps: "C", action: null });
    assert.match(c.html, /<html lang="fr" dir="ltr">/);
    assert.throws(() =>
      courrielDeNotification({
        locale: "fr",
        titre: "T",
        corps: "C",
        action: { libelle: "x", url: "javascript:alert(1)" },
      }),
    );
  });
});
