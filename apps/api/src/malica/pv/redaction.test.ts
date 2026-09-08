/**
 * La forme du procès-verbal : lire ce que le modèle a rendu, et mettre bout à
 * bout ce qu'un lecteur en verra — c'est ce texte-là que la garde relit.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { nombresEtrangers } from "../conseil/redaction.ts";
import { lireSections, texteDesSections } from "./redaction.ts";

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
