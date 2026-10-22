/**
 * Les prestataires de paiement, sans réseau : ClicToPay est remplacé par une
 * fausse réponse, et l'on vérifie ce qu'on lui demande et ce qu'on en lit.
 * Ce que la table dit du prestataire (adaptateur, langue, devise) est passé
 * tel que la base le rendrait.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  adresseDeRetour,
  clictopay,
  prestataireDuReglage,
  type ReglagePaiement,
} from "./prestataires.ts";

function fauxFetch(reponse: Record<string, unknown>, vus: Array<{ url: string; corps: string }>) {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    vus.push({ url: String(url), corps: String(init?.body ?? "") });
    return new Response(JSON.stringify(reponse), { status: 200 });
  }) as typeof fetch;
}

const CTP = { code: "clictopay", langue: "fr", utilisateur: "u", motDePasse: "m" };

describe("les prestataires de paiement", () => {
  it("ClicToPay reçoit les unités, la devise et la langue que la table donne, et rend son lien", async () => {
    const vus: Array<{ url: string; corps: string }> = [];
    const p = clictopay(
      { ...CTP, url: "https://test.clictopay.com/payment/rest" },
      fauxFetch({ orderId: "ORD-1", formUrl: "https://test.clictopay.com/pay/ORD-1" }, vus),
    );
    const r = await p.creerLien({
      paiementId: "11111111-2222-3333-4444-555555555555",
      unites: 17850,
      devise: "788",
      libelle: "Passage Solo -> Team",
      retour: "https://app.exemple.tn/pme/reglages?paiement=1",
    });
    assert.deepEqual(r, { reference: "ORD-1", lien: "https://test.clictopay.com/pay/ORD-1" });
    assert.equal(vus[0]!.url, "https://test.clictopay.com/payment/rest/register.do");
    const corps = new URLSearchParams(vus[0]!.corps);
    assert.equal(corps.get("amount"), "17850");
    assert.equal(corps.get("currency"), "788");
    assert.equal(corps.get("language"), "fr");
    assert.equal(corps.get("orderNumber"), "11111111222233334444555555555555");
  });

  it("ClicToPay : 2 est payé, 3/4/6 refusé, le reste attend", async () => {
    for (const [statut, attendu] of [
      [2, "paye"],
      [4, "refuse"],
      [0, "en_attente"],
    ] as const) {
      const p = clictopay(
        { ...CTP, url: "https://x/" },
        fauxFetch({ orderStatus: statut, errorCode: "0" }, []),
      );
      assert.equal((await p.etat("ORD-1")).etat, attendu);
    }
  });

  it("une seule adresse de retour, et le simulateur y revient marqué", async () => {
    assert.equal(
      adresseDeRetour("https://staging.exemple.tn", "p-1"),
      "https://staging.exemple.tn/pme/reglages?paiement=p-1",
    );
    const sim = prestataireDuReglage(
      {
        prestataire: "simulateur",
        adaptateur: "simulateur",
        ouvre_le_paiement: true,
        langue: null,
        url_api: null,
        url_retour: "https://staging.exemple.tn/",
      },
      {},
    );
    const { lien } = await sim!.prestataire.creerLien({
      paiementId: "p-1",
      unites: 1,
      devise: "788",
      libelle: "x",
      retour: adresseDeRetour(sim!.urlPublique, "p-1"),
    });
    assert.equal(lien, "https://staging.exemple.tn/pme/reglages?paiement=p-1&simulateur=1");
  });

  it("la tour choisit ; un adaptateur sans ses secrets reste fermé, et les secrets ne viennent que du serveur", () => {
    const retour = "https://staging.exemple.tn/";
    const ferme: ReglagePaiement = {
      prestataire: "aucun",
      adaptateur: null,
      ouvre_le_paiement: false,
      langue: null,
      url_api: null,
      url_retour: retour,
    };
    assert.equal(prestataireDuReglage(ferme), null);
    const sim = prestataireDuReglage(
      { ...ferme, prestataire: "simulateur", adaptateur: "simulateur", ouvre_le_paiement: true },
      {},
    );
    assert.equal(sim?.prestataire.code, "simulateur");
    assert.equal(sim?.prestataire.simule, true);
    assert.equal(sim?.urlPublique, "https://staging.exemple.tn");
    const reglage: ReglagePaiement = {
      prestataire: "clictopay",
      adaptateur: "clictopay",
      ouvre_le_paiement: true,
      langue: "fr",
      url_api: "https://test.clictopay.com/payment/rest/",
      url_retour: retour,
    };
    assert.equal(prestataireDuReglage(reglage, {}), null, "sans secrets, pas de ClicToPay");
    const ouvert = prestataireDuReglage(reglage, {
      CLICTOPAY_UTILISATEUR: "u",
      CLICTOPAY_MOT_DE_PASSE: "m",
    });
    assert.equal(ouvert?.prestataire.code, "clictopay");
    assert.equal(ouvert?.prestataire.simule, false);
    assert.equal(
      prestataireDuReglage({ ...reglage, adaptateur: "inconnu" }, {}),
      null,
      "un adaptateur que ce serveur ne connaît pas ferme le paiement",
    );
  });
});
