/**
 * Le travailleur des relances, sans base ni réseau : il ne décide de rien, il
 * réserve, envoie et inscrit. Ce qui est éprouvé ici : l'ordre des trois temps,
 * et le fait qu'aucune transaction n'est ouverte pendant l'envoi.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { libellesDEssai } from "../courriel/libelles-d-essai.ts";
import type { Requete } from "../db.ts";

import { tourDeRelances } from "./travailleur.ts";

const COURRIEL = {
  envoi_id: "e1",
  email: "titulaire@essai.local",
  locale: "ar",
  titre: "Facture <ALG-1> en retard",
  corps: "Reste 12,000 TND.",
  action_libelle: "Payer",
  action_route: "/pme/reglages",
  ton: "alerte",
  // Ce que la file rend depuis 20261229090000 : le genre (l'étiquette) et la société (la pastille).
  code: "impaye.rappel",
  organisation: "SOCIETE ESSAI",
  donnees: null,
  frise: null,
  sujet: null,
  libelles: libellesDEssai("fr"),
  carte: null,
};

/**
 * Une base qui se comporte comme la vraie file pour ce test : la réservation
 * rend le courriel une fois, puis la file se vide. `ouverte` dit si une
 * transaction est en cours au moment où l'on appelle la base.
 */
function fausseBase() {
  const appels: Array<{ sql: string; params: unknown[] | undefined }> = [];
  let ouverte = false;
  const db = {
    query: async (sql: string, params?: unknown[]) => {
      appels.push({ sql, params });
      if (sql.includes("relancer_les_impayes"))
        return { rows: [{ r: { actives: true, postes: 1 } }] };
      if (sql.includes("prevenir_les_abonnements")) return { rows: [{ n: 0 }] };
      if (sql.includes("reserver_courriels")) {
        const servi = appels.filter((a) => a.sql.includes("reserver_courriels")).length;
        return { rows: servi === 1 ? [COURRIEL] : [] };
      }
      return { rows: [] };
    },
  } as unknown as Requete;
  const executer = async <T>(t: (d: Requete) => Promise<T>): Promise<T> => {
    ouverte = true;
    try {
      return await t(db);
    } finally {
      ouverte = false;
    }
  };
  return { appels, executer, estOuverte: () => ouverte };
}

const ENV = {
  BREVO_API_KEY: "cle-d-essai",
  MALICA_COURRIEL_EXPEDITEUR: "noreply@essai.local",
  MALICA_URL_PUBLIQUE: "https://app.essai.local/",
};

describe("le travailleur des relances", () => {
  it("sans clé Brevo : il laisse décider la base, ne réserve rien, n'envoie rien", async () => {
    const b = fausseBase();
    const r = await tourDeRelances({ executer: b.executer, env: {} });
    assert.equal(r.sansCle, true);
    // La base décide les relances, puis les avis de l'abonnement ; rien d'autre.
    assert.equal(b.appels.length, 2);
    assert.match(b.appels[0]!.sql, /relancer_les_impayes/);
    assert.match(b.appels[1]!.sql, /prevenir_les_abonnements/);
  });

  it("réserve, envoie hors transaction, puis inscrit « remis » — dans cet ordre", async () => {
    const b = fausseBase();
    const ordre: string[] = [];
    const r = await tourDeRelances({
      executer: b.executer,
      env: ENV,
      envoyer: async (e) => {
        ordre.push("envoi");
        // Aucune transaction ne tient pendant l'appel au transport.
        assert.equal(b.estOuverte(), false, "aucune transaction pendant l'envoi");
        assert.equal(e.sujet, COURRIEL.titre);
        assert.equal(e.destinataire, COURRIEL.email);
        assert.match(e.html, /https:\/\/app\.essai\.local\/pme\/reglages/);
        return { messageId: "m1" };
      },
    });
    assert.equal(r.remis, 1);
    const sqls = b.appels.map((a) => a.sql);
    const iReserve = sqls.findIndex((s) => s.includes("reserver_courriels"));
    const iRemet = sqls.findIndex((s) => s.includes("notif.remettre"));
    assert.ok(iReserve >= 0 && iRemet > iReserve, "réservation avant inscription");
    assert.deepEqual(ordre, ["envoi"]);
    const remise = b.appels.find((a) => a.sql.includes("notif.remettre"));
    assert.deepEqual(remise?.params, ["e1", "remis", null]);
  });

  it("un échec d'envoi s'inscrit « echoue », avec l'erreur, et ne bloque pas la file", async () => {
    const b = fausseBase();
    const r = await tourDeRelances({
      executer: b.executer,
      env: ENV,
      envoyer: async () => {
        throw new Error("Brevo a refusé le courriel (401) : clé refusée");
      },
    });
    assert.equal(r.echecs, 1);
    assert.equal(r.remis, 0);
    const remise = b.appels.find((a) => a.sql.includes("notif.remettre"));
    assert.equal(remise?.params?.[1], "echoue");
    assert.match(String(remise?.params?.[2]), /clé refusée/);
  });

  it("une réservation demande une échéance explicite, en intervalle", async () => {
    const b = fausseBase();
    await tourDeRelances({ executer: b.executer, env: ENV, envoyer: async () => ({}) });
    const reserve = b.appels.find((a) => a.sql.includes("reserver_courriels"));
    assert.deepEqual(reserve?.params, [10, "10 minutes"]);
  });
});
