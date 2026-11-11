/**
 * Les blocs d'une réponse, en pur : le serveur compose, le navigateur dessine.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { blocDeLaTva, blocDesEcheances, jourEnClair, moisEnClair, montant } from "./blocs.ts";

const TVA = {
  period: "2026-11",
  currency: "TND",
  totals: { collectee: "0.000", deductible: "342.000", solde: "-342.000" },
};

describe("un montant se compose à la précision de la devise et à l'usage de la langue", () => {
  it("français, anglais, arabe : trois décimales, chiffres occidentaux", () => {
    assert.equal(montant("1800", 3, "fr").replace(/\s/g, " "), "1 800,000");
    assert.equal(montant("1800", 3, "en"), "1,800.000");
    assert.match(montant("1800", 3, "ar"), /^1.800[.,٫]000$/);
    assert.doesNotMatch(montant("1800", 3, "ar"), /[٠-٩]/);
  });
  it("une valeur illisible n'est pas un zéro", () => {
    assert.equal(montant("n'importe quoi", 3, "fr"), "—");
  });
  it("un jour s'écrit à l'usage de la langue, et reste tel quel s'il est illisible", () => {
    assert.equal(jourEnClair("2026-10-28", "fr"), "28/10/2026");
    assert.equal(jourEnClair("2026-10-28", "en"), "10/28/2026");
    assert.doesNotMatch(jourEnClair("2026-10-28", "ar"), /[٠-٩]/);
    assert.equal(jourEnClair("bientôt", "fr"), "bientôt");
  });
  it("le mois s'écrit dans la langue de la personne", () => {
    assert.equal(moisEnClair("2026-11", "fr"), "Novembre 2026");
    assert.equal(moisEnClair("2026-11", "en"), "November 2026");
    assert.match(moisEnClair("2026-11", "ar"), /2026/);
  });
});

describe("le bloc de la TVA", () => {
  it("un solde négatif est un crédit, dit positivement, avec ses deux composantes", () => {
    const b = blocDeLaTva(TVA, 3, 1, "SOTUMAG SARL", "fr");
    assert.equal(b.type, "reponse_cle");
    if (b.type !== "reponse_cle") return;
    assert.equal(b.cle.libelle, "Crédit de TVA");
    assert.equal(b.cle.valeur.replace(/\s/g, ""), "342,000");
    assert.equal(b.cle.ton, "positif");
    assert.equal(b.cle.unite, "TND");
    assert.deepEqual(
      b.details.map((d) => d.libelle),
      ["TVA collectée", "TVA déductible"],
    );
    assert.equal(b.periode, "Novembre 2026");
    assert.equal(b.perimetre, "SOTUMAG SARL");
    assert.match(b.source, /pièces prises en compte : 1/);
  });
  it("un solde positif est une TVA à payer, sans couleur de victoire", () => {
    const b = blocDeLaTva(
      { ...TVA, totals: { ...TVA.totals, solde: "120.500" } },
      3,
      3,
      null,
      "fr",
    );
    if (b.type !== "reponse_cle") throw new Error("type");
    assert.equal(b.cle.libelle, "TVA à payer");
    assert.equal(b.cle.ton, "neutre");
    assert.equal(b.perimetre, null);
  });
  it("les libellés suivent la langue", () => {
    const b = blocDeLaTva(TVA, 3, 1, null, "ar");
    if (b.type !== "reponse_cle") throw new Error("type");
    assert.match(b.cle.libelle, /[؀-ۿ]/);
    assert.match(b.titre, /[؀-ۿ]/);
  });
});

describe("le bloc du calendrier fiscal", () => {
  const E = [
    { label: "Déclaration de TVA", dueDate: "2026-10-28", status: "a_faire" },
    { label: "Acompte provisionnel", dueDate: "2026-12-15", status: "a_faire" },
    { label: "Retenues", dueDate: "2026-10-15", status: "fait" },
  ];
  it("l'état est dit par le serveur : en retard, à faire, faite", () => {
    const b = blocDesEcheances(E, "2026-11-10", "SOTUMAG SARL", "fr");
    if (b.type !== "tableau") throw new Error("type");
    assert.deepEqual(
      b.lignes.map((l) => l["etat"]),
      ["En retard", "À faire", "Faite"],
    );
    assert.deepEqual(
      b.colonnes.map((c) => c.id),
      ["echeance", "limite", "etat"],
    );
    assert.deepEqual(
      b.lignes.map((l) => l["limite"]),
      ["28/10/2026", "15/12/2026", "15/10/2026"],
    );
    assert.equal(b.total, null);
  });
});
