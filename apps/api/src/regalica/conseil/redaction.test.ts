/**
 * La garde des rédactions doit attraper le nombre inventé — et se taire quand
 * le texte s'en tient aux faits. Un garde-fou qui crie à tort est désactivé
 * en trois jours ; la moitié de ces épreuves vérifie donc qu'il se tait.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Fait } from "@regalica/socle/ports/regalica";

import { nombresAutorises, nombresEtrangers } from "./redaction.ts";

const FAITS: Fait[] = [
  { label: "Chiffre d'affaires, cumul d'exercice", valeur: "12400.500 TND", source: "moteur P&L" },
  { label: "Charges, cumul d'exercice", valeur: "3180.250 TND", source: "moteur P&L" },
  { label: "Résultat, cumul d'exercice", valeur: "9220.250 TND", source: "moteur P&L" },
  { label: "TVA du mois", valeur: "640.000 TND", source: "moteur TVA" },
  { label: "Crédit de TVA", valeur: "-120.500 TND", source: "moteur TVA" },
  { label: "Pièces transmises dans le mois", valeur: "7", source: "file de supervision" },
];

describe("les nombres autorisés viennent des faits", () => {
  it("retient chaque montant sous sa forme canonique", () => {
    const autorises = nombresAutorises(FAITS);
    assert.equal(autorises.has("12400.5"), true);
    assert.equal(autorises.has("640"), true);
    assert.equal(autorises.has("120.5"), true);
  });
});

describe("aucun nombre étranger dans le texte", () => {
  it("se tait quand chaque montant vient des faits, quelle que soit sa graphie", () => {
    const texte =
      "Le chiffre d'affaires atteint 12 400,500 TND en cumul ; les charges s'élèvent à 3180,25 TND " +
      "et le résultat ressort à 9 220,250 TND. La TVA du mois est de 640,000 TND.";
    assert.deepEqual(nombresEtrangers(texte, FAITS), []);
  });

  it("attrape un montant qu'aucun moteur n'a produit", () => {
    const texte = "Le chiffre d'affaires atteint 12 400,500 TND, soit une marge de 8 500,000 TND.";
    assert.deepEqual(nombresEtrangers(texte, FAITS), ["8500"]);
  });

  it("attrape un pourcentage déduit", () => {
    assert.deepEqual(nombresEtrangers("La TVA représente 5,2 % du chiffre d'affaires.", FAITS), [
      "5.2",
    ]);
  });

  it("ne crie pas sur une date, une année ou un article", () => {
    const texte =
      "Réunion du 18/08/2026, cumul au 31 août 2026, conformément à l'article 7 du code.";
    assert.deepEqual(nombresEtrangers(texte, FAITS), []);
  });

  it("compare des valeurs, pas des chaînes : le signe et les zéros ne comptent pas", () => {
    assert.deepEqual(
      nombresEtrangers("Un crédit de TVA de 120,5 TND reste à reporter.", FAITS),
      [],
    );
  });

  it("laisse passer un petit comptage, qui n'engage rien", () => {
    assert.deepEqual(
      nombresEtrangers("Sept pièces, soit 7 documents, ont été transmises.", FAITS),
      [],
    );
  });
});
