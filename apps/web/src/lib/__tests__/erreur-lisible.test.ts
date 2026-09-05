import { describe, expect, it } from "vitest";

import { texteDeLErreur, vientDeNous } from "../erreur-lisible";
import { ErreurApi } from "../transport/erreurs";

const DEFAUT = "Une erreur est survenue.";

describe("ce qu'on montre d'une erreur", () => {
  /*
   * LE DÉFAUT QUE CECI VERROUILLE
   *
   * « Cannot transfer object of unsupported type. » s'est affiché tel quel,
   * en anglais, sur le téléphone d'un dirigeant de PME. Puis un tableau JSON
   * de validation. Quatorze écrans affichaient `e.message` sans filtre.
   */
  it("ne montre jamais le message d'un moteur", () => {
    const moteur = new Error("Cannot transfer object of unsupported type.");
    expect(texteDeLErreur(moteur, "épreuve", DEFAUT)).toBe(DEFAUT);
  });

  it("ne montre jamais un tableau de validation", () => {
    const zod = new Error('[{"validation":"regex","path":["document_date"]}]');
    expect(texteDeLErreur(zod, "épreuve", DEFAUT)).toBe(DEFAUT);
  });

  /*
   * ET CE QU'IL NE FAUT PAS PERDRE
   *
   * Un refus de notre API dit exactement quoi faire, dans la langue du
   * client. L'écraser par « une erreur est survenue » ferait perdre
   * l'information la plus utile de l'écran.
   */
  it("montre le refus de notre API, qui est notre phrase", () => {
    const refus = new ErreurApi("Ce matricule appartient déjà à un autre dossier.", 409);
    expect(texteDeLErreur(refus, "épreuve", DEFAUT)).toBe(
      "Ce matricule appartient déjà à un autre dossier.",
    );
  });

  it("distingue par l'origine, pas par le texte", () => {
    // Même phrase, deux origines : seule celle qui vient de nous s'affiche.
    const phrase = "La période est close.";
    expect(texteDeLErreur(new ErreurApi(phrase, 409), "épreuve", DEFAUT)).toBe(phrase);
    expect(texteDeLErreur(new Error(phrase), "épreuve", DEFAUT)).toBe(DEFAUT);
  });

  it("tient devant ce qui n'est même pas une erreur", () => {
    expect(texteDeLErreur("une chaîne", "épreuve", DEFAUT)).toBe(DEFAUT);
    expect(texteDeLErreur(null, "épreuve", DEFAUT)).toBe(DEFAUT);
    expect(texteDeLErreur(undefined, "épreuve", DEFAUT)).toBe(DEFAUT);
    expect(texteDeLErreur({ erreur: "objet nu" }, "épreuve", DEFAUT)).toBe(DEFAUT);
  });

  it("reconnaît ce qui vient de nous", () => {
    expect(vientDeNous(new ErreurApi("refus", 400))).toBe(true);
    expect(vientDeNous(new Error("autre chose"))).toBe(false);
    expect(vientDeNous("pas une erreur")).toBe(false);
  });
});
