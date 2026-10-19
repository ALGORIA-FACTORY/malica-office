/**
 * Les prestataires de paiement, sans réseau : ClicToPay est remplacé par une
 * fausse réponse, et l'on vérifie ce qu'on lui demande et ce qu'on en lit.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { clictopay, enMillimes, prestataireDuReglage } from "./prestataires.ts";

function fauxFetch(reponse: Record<string, unknown>, vus: Array<{ url: string; corps: string }>) {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    vus.push({ url: String(url), corps: String(init?.body ?? "") });
    return new Response(JSON.stringify(reponse), { status: 200 });
  }) as typeof fetch;
}

describe("les prestataires de paiement", () => {
  it("un montant de la base se lit en millimes, sans flottant", () => {
    assert.equal(enMillimes("17.850"), 17850);
    assert.equal(enMillimes("5.95"), 5950);
    assert.equal(enMillimes("20"), 20000);
    assert.throws(() => enMillimes("vingt"));
  });

  it("ClicToPay reçoit le montant en millimes, en dinars (788), et rend son lien", async () => {
    const vus: Array<{ url: string; corps: string }> = [];
    const p = clictopay(
      { url: "https://test.clictopay.com/payment/rest", utilisateur: "u", motDePasse: "m" },
      fauxFetch({ orderId: "ORD-1", formUrl: "https://test.clictopay.com/pay/ORD-1" }, vus),
    );
    const r = await p.creerLien({
      paiementId: "11111111-2222-3333-4444-555555555555",
      millimes: 17850,
      libelle: "Passage Solo -> Team",
      retour: "https://app.exemple.tn/pme/paiement?p=1",
    });
    assert.deepEqual(r, { reference: "ORD-1", lien: "https://test.clictopay.com/pay/ORD-1" });
    assert.equal(vus[0]!.url, "https://test.clictopay.com/payment/rest/register.do");
    const corps = new URLSearchParams(vus[0]!.corps);
    assert.equal(corps.get("amount"), "17850");
    assert.equal(corps.get("currency"), "788");
    assert.equal(corps.get("orderNumber"), "11111111222233334444555555555555");
  });

  it("ClicToPay : 2 est payé, 3/4/6 refusé, le reste attend", async () => {
    for (const [statut, attendu] of [
      [2, "paye"],
      [4, "refuse"],
      [0, "en_attente"],
    ] as const) {
      const p = clictopay(
        { url: "https://x/", utilisateur: "u", motDePasse: "m" },
        fauxFetch({ orderStatus: statut, errorCode: "0" }, []),
      );
      assert.equal((await p.etat("ORD-1")).etat, attendu);
    }
  });

  it("la tour choisit ; ClicToPay sans ses secrets reste fermé, et les secrets ne viennent que du serveur", () => {
    const retour = "https://staging.exemple.tn/";
    assert.equal(
      prestataireDuReglage({ prestataire: "aucun", url_api: null, url_retour: retour }),
      null,
    );
    const sim = prestataireDuReglage(
      { prestataire: "simulateur", url_api: null, url_retour: retour },
      {},
    );
    assert.equal(sim?.prestataire.nom, "simulateur");
    assert.equal(sim?.urlPublique, "https://staging.exemple.tn");
    const reglage = {
      prestataire: "clictopay" as const,
      url_api: "https://test.clictopay.com/payment/rest/",
      url_retour: retour,
    };
    assert.equal(prestataireDuReglage(reglage, {}), null, "sans secrets, pas de ClicToPay");
    assert.equal(
      prestataireDuReglage(reglage, { CLICTOPAY_UTILISATEUR: "u", CLICTOPAY_MOT_DE_PASSE: "m" })
        ?.prestataire.nom,
      "clictopay",
    );
  });
});
