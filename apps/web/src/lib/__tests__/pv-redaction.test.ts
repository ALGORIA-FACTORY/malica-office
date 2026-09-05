/**
 * La forme du procès-verbal : lire ce que le modèle a rendu, et mettre bout à
 * bout ce qu'un lecteur en verra — c'est ce texte-là que la garde relit.
 */
import { describe, expect, it } from "vitest";

import { nombresEtrangers } from "../regalica/redaction.server";
import { lireSections, texteDesSections } from "../pv-redaction";

describe("lire ce que le modèle a rendu", () => {
  it("isole l'objet JSON même entouré de texte", () => {
    const reponse =
      'Voici le procès-verbal :\n```json\n{"sections":[{"kicker":"Situation","corps":"Un texte."},{"kicker":"Suite","corps":"Une suite."}]}\n```';
    const sections = lireSections(reponse);
    expect(sections).not.toBeNull();
    expect(sections!.map((s) => s.kicker)).toEqual(["Situation", "Suite"]);
  });

  it("refuse une forme qui ne tient pas : une seule section, ou un corps vide", () => {
    expect(lireSections('{"sections":[{"kicker":"Seule","corps":"Un texte."}]}')).toBeNull();
    expect(
      lireSections('{"sections":[{"kicker":"A","corps":""},{"kicker":"B","corps":"x"}]}'),
    ).toBeNull();
    expect(lireSections("pas de JSON ici")).toBeNull();
  });

  it("met bout à bout intitulés et corps, pour que la garde relise tout", () => {
    const texte = texteDesSections([
      { kicker: "Situation", corps: "CA 12 400,500 TND." },
      { kicker: "Suite", corps: "Marge de 99 999,000 TND." },
    ]);
    const faits = [{ label: "Chiffre d'affaires", valeur: "12400.500 TND", source: "moteur P&L" }];
    expect(nombresEtrangers(texte, faits)).toEqual(["99999"]);
  });
});
