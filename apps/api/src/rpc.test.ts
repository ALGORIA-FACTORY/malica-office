/**
 * Le transport et le premier dépôt porté.
 *
 * Ce que ces vérifications garantissent : le référentiel rendu par l'API est
 * celui du pack en base — mêmes vues, mêmes transformations que l'adaptateur
 * qu'il remplace — et le registre ne laisse atteindre que ce qu'il déclare.
 */

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { creerCompte } from "./auth.ts";
import { fermerLePool, sousIdentite } from "./db.ts";
import { executerRpc, RpcIntrouvable } from "./rpc.ts";

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

describe("transport RPC et référentiel", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `rpc-${Date.now()}`;
  let identite = "";

  async function appeler(methode: string, args: unknown[] = []): Promise<unknown> {
    if (!identite) {
      const compte = await creerCompte(`${marque}@essai.local`, "MotDePasseTresLong2026!");
      assert.ok(compte);
      identite = compte.id;
    }
    return sousIdentite(identite, (db) => executerRpc(db, { depot: "referentiel", methode, args }));
  }

  after(async () => {
    await fermerLePool();
  });

  it("rend le pack tunisien en vigueur", async () => {
    const pack = (await appeler("activePack", ["TN"])) as { id: string; jurisdiction: string };
    assert.ok(pack, "un pack doit être en vigueur pour la Tunisie");
    assert.equal(pack.jurisdiction, "TN");
  });

  it("rend les taux de TVA du pack, en chaîne décimale", async () => {
    const pack = (await appeler("activePack", ["TN"])) as { id: string };
    const taux = (await appeler("taxRates", [pack.id, "TN"])) as Array<{
      code: string;
      rate: string;
    }>;
    assert.ok(taux.length > 0, "le pack doit porter des taux");
    // R4 : le taux vient du pack, jamais du code. On vérifie la forme, pas la
    // valeur — écrire « 19 » ici reviendrait à coder en dur ce que la règle
    // interdit.
    for (const t of taux) {
      assert.equal(typeof t.rate, "string", "un taux se transporte en chaîne, pas en flottant");
      assert.match(t.rate, /^\d+\.\d{4}$/, "quatre décimales, comme l'adaptateur d'origine");
    }
  });

  it("rend les paramètres du Socle", async () => {
    const pack = (await appeler("activePack", ["TN"])) as { id: string };
    const params = (await appeler("socleParams", [pack.id])) as {
      moneyDecimals: number;
      stockMethode: string;
    };
    assert.equal(typeof params.moneyDecimals, "number");
    assert.ok(["cump", "fifo"].includes(params.stockMethode));
  });

  it("refuse un dépôt inconnu", async () => {
    await assert.rejects(
      sousIdentite(identite || "00000000-0000-4000-8000-000000000000", (db) =>
        executerRpc(db, { depot: "inexistant", methode: "activePack", args: [] }),
      ),
      RpcIntrouvable,
    );
  });

  it("refuse une méthode héritée du prototype", async () => {
    // Sans `Object.hasOwn`, `constructor` ou `toString` seraient atteignables.
    for (const methode of ["constructor", "toString", "__proto__"]) {
      await assert.rejects(
        sousIdentite(identite, (db) =>
          executerRpc(db, { depot: "referentiel", methode, args: [] }),
        ),
        RpcIntrouvable,
        `« ${methode} » ne doit pas être atteignable`,
      );
    }
  });
  /*
   * Audit du 6 novembre 2026 (S6) : `{"depot":"<b>x</b>"}` rendait « dépôt
   * inconnu : <b>x</b> » — l'écho de la saisie, HTML compris —, une méthode
   * réservée au serveur se trahissait par son nom, et la tour répondait une
   * phrase française brute. L'écran ne reçoit plus qu'une clé `refus.*`.
   */
  it("ne renvoie jamais le nom reçu : un appel introuvable se dit par une clé fixe", async () => {
    const essais = [
      { depot: "<b>x</b>", methode: "activePack" },
      { depot: "referentiel", methode: "<img src=x>" },
      // Réservée au serveur : la même réponse qu'une méthode qui n'existe pas.
      { depot: "capture", methode: "persisterLecture" },
      { depot: "capture", methode: "nexistePas" },
    ];
    for (const { depot, methode } of essais) {
      await assert.rejects(
        sousIdentite(identite || "00000000-0000-4000-8000-000000000000", (db) =>
          executerRpc(db, { depot, methode, args: [] }),
        ),
        (e: unknown) => e instanceof RpcIntrouvable && e.message === "refus.introuvable",
        `${depot}.${methode}`,
      );
    }
  });

  it("la tour refuse un non-opérateur par une clé, jamais par une phrase", async () => {
    await appeler("activePack", ["TN"]);
    await assert.rejects(
      sousIdentite(identite, (db) =>
        executerRpc(db, { depot: "tour", methode: "licences", args: [] }),
      ),
      (e: unknown) =>
        e instanceof Error &&
        e.message === "refus.reserve.plateforme" &&
        (e as { code?: string }).code === "42501",
    );
  });
});
