/**
 * Les comptages du PV suivent la règle de la file (staging, 5 novembre 2026) :
 * le PV disait 2 pièces « en attente de supervision » quand la file en
 * montrait 84.
 *
 * Et ce qui a été retourné dans le mois vient du journal, pas de l'état du
 * moment (recette du 11 novembre 2026) : deux pièces retournées puis renvoyées
 * dans la journée, et Malica écrivait « aucune pièce n'a été retournée ».
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { chiffresDeLaFile, consigne } from "./rediger.ts";

describe("les comptages du PV", () => {
  const file = [
    { createdAt: "2026-11-02T10:00:00Z", statut: "recue" as const },
    { createdAt: "2026-11-03T10:00:00Z", statut: "vue" as const },
    { createdAt: "2026-10-30T10:00:00Z", statut: "corrigee" as const },
    { createdAt: "2026-11-04T10:00:00Z", statut: "validee" as const },
    { createdAt: "2026-11-04T11:00:00Z", statut: "retournee" as const },
  ];

  it("comptent ce qui attend le cabinet par la règle de la file", () => {
    const parLibelle = Object.fromEntries(
      chiffresDeLaFile(file, "2026-11", 1, 1).map((c) => [c.label, c.valeur]),
    );
    assert.deepEqual(parLibelle, {
      pieces: "4",
      aSuperviser: "3",
      retournees: "1",
      retourneesDuMois: "1",
    });
  });

  it("disent les pièces retournées dans le mois, même renvoyées depuis", () => {
    const parLibelle = Object.fromEntries(
      chiffresDeLaFile(file, "2026-11", 0, 2).map((c) => [c.label, c.valeur]),
    );
    assert.equal(parLibelle["retournees"], "0");
    assert.equal(parLibelle["retourneesDuMois"], "2");
  });
});

describe("la consigne du PV", () => {
  const messages = consigne({
    locale: "fr",
    ton: "sobre",
    cabinet: "Compta Trabelsi",
    client: "Atelier Samia",
    jour: "2026-11-11",
    arrete: "2026-11-11",
    presents: null,
    chiffres: "- Pièces retournées au client dans le mois : 2 (file de supervision)",
  });
  const systeme = messages.find((m) => m.role === "system")!.content;

  it("parle de la comptabilité, et interdit « le cabinet »", () => {
    assert.match(systeme, /assistante de la comptabilité « Compta Trabelsi »/);
    assert.doesNotMatch(systeme, /assistante du cabinet/);
    assert.match(systeme, /jamais du « cabinet »/);
  });

  it("n'admet un fait sur les pièces que depuis les chiffres", () => {
    assert.match(systeme, /n'affirmes rien sur les pièces/);
  });
});
