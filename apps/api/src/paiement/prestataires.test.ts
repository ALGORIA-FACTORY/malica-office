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
  flouci,
  hoteAutorise,
  prestataireDuReglage,
  type ReglagePaiement,
} from "./prestataires.ts";

function fauxFetch(
  reponse: Record<string, unknown>,
  vus: Array<{ url: string; corps: string; entetes?: Record<string, string> }>,
  statut = 200,
) {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    vus.push({
      url: String(url),
      corps: String(init?.body ?? ""),
      entetes: init?.headers as Record<string, string>,
    });
    return new Response(JSON.stringify(reponse), { status: statut });
  }) as typeof fetch;
}

const FLC = { code: "flouci", clePublique: "pub", clePrivee: "priv" };

const CTP = { code: "clictopay", langue: "fr", utilisateur: "u", motDePasse: "m" };

const PAIEMENT = "11111111-2222-3333-4444-555555555555";
const ATTENDU = { paiementId: PAIEMENT, unites: 17850 };
const COMMANDE = "11111111222233334444555555555555";

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

  it("ClicToPay : 2 est payé pour CE paiement et CE montant, 3/4/6 refusé, le reste attend", async () => {
    for (const [reponse, attendu] of [
      [{ orderStatus: 2, amount: 17850, orderNumber: COMMANDE }, "paye"],
      [{ orderStatus: 2, amount: "17850", orderNumber: COMMANDE }, "paye"],
      [{ orderStatus: 2, amount: 1, orderNumber: COMMANDE }, "anomalie"],
      [{ orderStatus: 2, amount: 17850, orderNumber: "autre" }, "anomalie"],
      [{ orderStatus: 2 }, "anomalie"],
      [{ orderStatus: 4 }, "refuse"],
      [{ orderStatus: 0 }, "en_attente"],
    ] as const) {
      const p = clictopay(
        { ...CTP, url: "https://x/" },
        fauxFetch({ ...reponse, errorCode: "0" }, []),
      );
      assert.equal((await p.etat("ORD-1", ATTENDU)).etat, attendu, JSON.stringify(reponse));
    }
  });

  it("une seule adresse de retour, et le simulateur y revient marqué", async () => {
    assert.equal(
      adresseDeRetour("https://staging.exemple.tn", "societe", "p-1"),
      "https://staging.exemple.tn/pme/reglages?page=abonnement&paiement=p-1",
    );
    assert.equal(
      adresseDeRetour("https://staging.exemple.tn", "cabinet", "p-1"),
      "https://staging.exemple.tn/cabinet/payer/p-1?paiement=p-1",
    );
    const sim = prestataireDuReglage(
      {
        prestataire: "simulateur",
        adaptateur: "simulateur",
        ouvre_le_paiement: true,
        langue: null,
        url_api: null,
        url_retour: "https://staging.exemple.tn/",
        hotes_api: [],
      },
      {},
    );
    const { lien } = await sim!.prestataire.creerLien({
      paiementId: "p-1",
      unites: 1,
      devise: "788",
      libelle: "x",
      retour: adresseDeRetour(sim!.urlPublique, "societe", "p-1"),
    });
    assert.equal(
      lien,
      "https://staging.exemple.tn/pme/reglages?page=abonnement&paiement=p-1&simulateur=1",
    );
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
      hotes_api: [],
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
      hotes_api: ["ipay.clictopay.com", "test.clictopay.com"],
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
  it("Flouci reçoit les millimes et l'identifiant du paiement, et rend son lien", async () => {
    const vus: Array<{ url: string; corps: string; entetes?: Record<string, string> }> = [];
    const p = flouci(
      { ...FLC, url: "https://developers.flouci.com/" },
      fauxFetch(
        {
          result: { success: true, payment_id: "AgCK", link: "https://checkout.flouci.com/x/AgCK" },
        },
        vus,
      ),
    );
    const r = await p.creerLien({
      paiementId: "p-1",
      unites: 17850,
      devise: "788",
      libelle: "Passage Solo -> Team",
      retour: "https://app.exemple.tn/pme/reglages?paiement=p-1",
      notification: "https://app.exemple.tn/notifications-de-paiement/flouci",
      dureeSecondes: 3600,
    });
    assert.deepEqual(r, { reference: "AgCK", lien: "https://checkout.flouci.com/x/AgCK" });
    assert.equal(vus[0]!.url, "https://developers.flouci.com/api/v2/generate_payment");
    assert.equal(vus[0]!.entetes?.["authorization"], "Bearer pub:priv");
    const corps = JSON.parse(vus[0]!.corps) as Record<string, unknown>;
    assert.equal(corps["amount"], "17850");
    assert.equal(corps["developer_tracking_id"], "p-1");
    assert.equal(corps["success_link"], "https://app.exemple.tn/pme/reglages?paiement=p-1");
    assert.equal(corps["fail_link"], corps["success_link"]);
    assert.equal(corps["accept_card"], true);
    assert.equal(corps["webhook"], "https://app.exemple.tn/notifications-de-paiement/flouci");
    assert.equal(corps["webhook_version"], 2);
    assert.equal(corps["session_timeout_secs"], 3600, "la page ferme avec notre lien (8.3)");
  });

  it("un refus de Flouci se dit", async () => {
    const refus = flouci(
      { ...FLC, url: "https://x" },
      fauxFetch({ result: { status: 400, message: "Bad Request" } }, [], 400),
    );
    await assert.rejects(
      refus.creerLien({
        paiementId: "p",
        unites: 1,
        devise: "788",
        libelle: "x",
        retour: "https://r",
      }),
      /HTTP 400/,
    );
  });

  it("Flouci : SUCCESS est payé pour CE paiement et CE montant, FAILURE/EXPIRED refusé, PENDING attend, sans success rien n'est cru", async () => {
    const vus: Array<{ url: string; corps: string }> = [];
    const ok = { amount: 17850, developer_tracking_id: PAIEMENT };
    for (const [reponse, attendu] of [
      [{ success: true, result: { status: "SUCCESS", ...ok } }, "paye"],
      [{ success: true, result: { status: "SUCCESS", ...ok, amount: 1 } }, "anomalie"],
      [{ success: true, result: { status: "SUCCESS", ...ok, amount: 17849 } }, "anomalie"],
      [
        { success: true, result: { status: "SUCCESS", ...ok, developer_tracking_id: "x" } },
        "anomalie",
      ],
      [{ success: true, result: { status: "SUCCESS" } }, "anomalie"],
      [{ success: true, result: { status: "PREAUTH_SUCCESS", ...ok } }, "en_attente"],
      [{ success: true, result: { status: "FAILURE" } }, "refuse"],
      [{ success: true, result: { status: "EXPIRED" } }, "refuse"],
      [{ success: true, result: { status: "SYSTEM_FAILURE" } }, "refuse"],
      [{ success: true, result: { status: "PENDING" } }, "en_attente"],
      [{ success: false, result: { status: "SUCCESS", ...ok } }, "en_attente"],
    ] as const) {
      const p = flouci({ ...FLC, url: "https://developers.flouci.com" }, fauxFetch(reponse, vus));
      assert.equal((await p.etat("AgCK", ATTENDU)).etat, attendu, JSON.stringify(reponse));
    }
    assert.equal(vus[0]!.url, "https://developers.flouci.com/api/v2/verify_payment/AgCK");
  });

  it("Flouci : le montant encaissé est rendu pour que la base le recoupe", async () => {
    const p = flouci(
      { ...FLC, url: "https://developers.flouci.com" },
      fauxFetch(
        {
          success: true,
          result: { status: "SUCCESS", amount: 17850, developer_tracking_id: PAIEMENT },
        },
        [],
      ),
    );
    const r = await p.etat("AgCK", ATTENDU);
    assert.equal(r.detail.unites_encaissees, 17850);
  });

  it("Flouci : une session rendue pour un autre identifiant de suivi est refusée", async () => {
    const p = flouci(
      { ...FLC, url: "https://developers.flouci.com" },
      fauxFetch(
        {
          result: {
            success: true,
            payment_id: "AgCK",
            link: "https://checkout.flouci.com/x/AgCK",
            developer_tracking_id: "un-autre",
          },
        },
        [],
      ),
    );
    await assert.rejects(
      p.creerLien({
        paiementId: PAIEMENT,
        unites: 1,
        devise: "788",
        libelle: "x",
        retour: "https://r",
      }),
      /identifiant de suivi/,
    );
  });

  it("Flouci ne s'ouvre qu'avec ses deux clés, posées sur le serveur", () => {
    const reglage: ReglagePaiement = {
      prestataire: "flouci",
      adaptateur: "flouci",
      ouvre_le_paiement: true,
      langue: null,
      url_api: "https://developers.flouci.com",
      url_retour: "https://staging.exemple.tn/",
      hotes_api: ["developers.flouci.com"],
    };
    assert.equal(prestataireDuReglage(reglage, {}), null);
    assert.equal(prestataireDuReglage(reglage, { FLOUCI_CLE_PUBLIQUE: "pub" }), null);
    const ouvert = prestataireDuReglage(reglage, {
      FLOUCI_CLE_PUBLIQUE: "pub",
      FLOUCI_CLE_PRIVEE: "priv",
    });
    assert.equal(ouvert?.prestataire.code, "flouci");
    assert.equal(ouvert?.prestataire.simule, false);
  });

  it("les clés ne partent que vers un hôte du prestataire, en https", () => {
    const cles = { FLOUCI_CLE_PUBLIQUE: "pub", FLOUCI_CLE_PRIVEE: "priv" };
    const reglage: ReglagePaiement = {
      prestataire: "flouci",
      adaptateur: "flouci",
      ouvre_le_paiement: true,
      langue: null,
      url_api: "https://developers.flouci.com",
      url_retour: "https://staging.exemple.tn/",
      hotes_api: ["developers.flouci.com"],
    };
    for (const url of [
      "https://exfil.attaquant.test",
      "https://developers.flouci.com.attaquant.test",
      "https://developers.flouci.com@attaquant.test",
      "http://developers.flouci.com",
    ]) {
      assert.equal(prestataireDuReglage({ ...reglage, url_api: url }, cles), null, url);
    }
    assert.equal(
      hoteAutorise("https://DEVELOPERS.flouci.com/api", ["developers.flouci.com"]),
      true,
    );
    assert.equal(
      prestataireDuReglage({ ...reglage, url_retour: "http://staging.exemple.tn/" }, cles),
      null,
      "le retour du client se fait en https",
    );
  });

  it("le simulateur n'existe pas en production, sauf sur un serveur de recette qui le déclare", () => {
    const sim: ReglagePaiement = {
      prestataire: "simulateur",
      adaptateur: "simulateur",
      ouvre_le_paiement: true,
      langue: null,
      url_api: null,
      url_retour: "https://staging.exemple.tn/",
      hotes_api: [],
    };
    assert.equal(prestataireDuReglage(sim, { NODE_ENV: "production" }), null);
    assert.equal(
      prestataireDuReglage(sim, { NODE_ENV: "production", PAIEMENT_SIMULATEUR: "oui" })?.prestataire
        .simule,
      true,
    );
    assert.equal(prestataireDuReglage(sim, {})?.prestataire.simule, true);
  });
});
