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
  });

  it("Flouci refuse une autre devise que le dinar, et un refus de sa part se dit", async () => {
    const p = flouci({ ...FLC, url: "https://x" }, fauxFetch({ result: { success: true } }, []));
    const d = { paiementId: "p", unites: 1, devise: "952", libelle: "x", retour: "https://r" };
    await assert.rejects(p.creerLien(d), /devise 952/);
    const refus = flouci(
      { ...FLC, url: "https://x" },
      fauxFetch({ result: { status: 400, message: "Bad Request" } }, [], 400),
    );
    await assert.rejects(refus.creerLien({ ...d, devise: "788" }), /HTTP 400/);
  });

  it("Flouci : SUCCESS est payé, FAILURE/EXPIRED refusé, PENDING attend, sans success rien n'est cru", async () => {
    const vus: Array<{ url: string; corps: string }> = [];
    for (const [reponse, attendu] of [
      [{ success: true, result: { status: "SUCCESS", amount: 17850 } }, "paye"],
      [{ success: true, result: { status: "FAILURE" } }, "refuse"],
      [{ success: true, result: { status: "EXPIRED" } }, "refuse"],
      [{ success: true, result: { status: "PENDING" } }, "en_attente"],
      [{ success: false, result: { status: "SUCCESS" } }, "en_attente"],
    ] as const) {
      const p = flouci({ ...FLC, url: "https://developers.flouci.com" }, fauxFetch(reponse, vus));
      assert.equal((await p.etat("AgCK")).etat, attendu);
    }
    assert.equal(vus[0]!.url, "https://developers.flouci.com/api/v2/verify_payment/AgCK");
  });

  it("Flouci ne s'ouvre qu'avec ses deux clés, posées sur le serveur", () => {
    const reglage: ReglagePaiement = {
      prestataire: "flouci",
      adaptateur: "flouci",
      ouvre_le_paiement: true,
      langue: null,
      url_api: "https://developers.flouci.com",
      url_retour: "https://staging.exemple.tn/",
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
});
