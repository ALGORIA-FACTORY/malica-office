/**
 * La forme du procès-verbal : lire ce que le modèle a rendu, et mettre bout à
 * bout ce qu'un lecteur en verra — c'est ce texte-là que la garde relit.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { nombresEtrangers } from "../conseil/redaction.ts";
import { lireSections, misEnForme, texteDesSections } from "./redaction.ts";

describe("lire ce que le modèle a rendu", () => {
  it("isole l'objet JSON même entouré de texte", () => {
    const reponse =
      'Voici le procès-verbal :\n```json\n{"sections":[{"kicker":"Situation","corps":"Un texte."},{"kicker":"Suite","corps":"Une suite."}]}\n```';
    const sections = lireSections(reponse);
    assert.notEqual(sections, null);
    assert.deepEqual(
      sections!.map((s) => s.kicker),
      ["Situation", "Suite"],
    );
  });

  it("refuse une forme qui ne tient pas : une seule section, ou un corps vide", () => {
    assert.equal(lireSections('{"sections":[{"kicker":"Seule","corps":"Un texte."}]}'), null);
    assert.equal(
      lireSections('{"sections":[{"kicker":"A","corps":""},{"kicker":"B","corps":"x"}]}'),
      null,
    );
    assert.equal(lireSections("pas de JSON ici"), null);
  });

  it("met bout à bout intitulés et corps, pour que la garde relise tout", () => {
    const texte = texteDesSections([
      { kicker: "Situation", corps: "CA 12 400,500 TND." },
      { kicker: "Suite", corps: "Marge de 99 999,000 TND." },
    ]);
    const faits = [{ label: "Chiffre d'affaires", valeur: "12400.500 TND", source: "moteur P&L" }];
    assert.deepEqual(nombresEtrangers(texte, faits), ["99999"]);
  });
});

describe("mettre le texte relu dans la langue du lecteur", () => {
  // Le PV de SOTUMAG, staging, 5 novembre 2026 : la prose disait « 3600.000 TND »
  // et « 2026-11-30 » sous un tableau qui disait « 3 600,000 TND ».
  const chiffres = [
    { valeur: "3600.000", genre: "montant" as const },
    { valeur: "-601.000", genre: "montant" as const },
    { valeur: "600", genre: "nombre" as const },
  ];
  const sections = [
    {
      kicker: "Situation au 2026-11-30",
      corps:
        "Le chiffre d'affaires s'établit à 3600.000 TND. Le résultat ressort à -601.000 TND, soit un déficit de 601.000 TND. 600 pièces.",
    },
    { kicker: "Suite", corps: "Réunion tenue le 2026-11-05." },
  ];

  it("formate chaque montant et chaque date, comme le tableau du même PV", () => {
    const rendu = misEnForme(sections, chiffres, "fr");
    assert.equal(rendu[0]!.kicker, "Situation au 30 novembre 2026");
    assert.equal(
      rendu[0]!.corps,
      "Le chiffre d'affaires s'établit à 3 600,000 TND. Le résultat ressort à −601,000 TND, soit un déficit de 601,000 TND. 600 pièces.",
    );
    assert.equal(rendu[1]!.corps, "Réunion tenue le 5 novembre 2026.");
    assert.equal(
      misEnForme(sections, chiffres, "en")[1]!.corps,
      "Réunion tenue le November 5, 2026.",
    );
  });

  it("ne crée aucun nombre : le texte formaté ne porte que ceux des faits", () => {
    const faits = [
      { label: "CA", valeur: "3600.000 TND", source: "P&L" },
      { label: "Résultat", valeur: "-601.000 TND", source: "P&L" },
      { label: "Pièces transmises", valeur: "600", source: "file" },
    ];
    assert.deepEqual(
      nombresEtrangers(texteDesSections(misEnForme(sections, chiffres, "fr")), faits),
      [],
    );
  });

  it("ne touche pas un nombre qui n'est qu'en partie un montant", () => {
    const [s] = misEnForme(
      [{ kicker: "A", corps: "13600.000 et 3600.0001" }, sections[1]!],
      chiffres,
      "fr",
    );
    assert.equal(s!.corps, "13600.000 et 3600.0001");
  });
});
