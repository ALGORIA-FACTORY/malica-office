// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { estIntrouvable, texteDeLErreur, vientDeNous } from "../erreur-lisible";
import { ErreurApi } from "../transport/erreurs";
import { chargerLaLangue } from "@/i18n/dictionnaires";

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

  it("une panne de l'API (5xx) part au journal, pas à l'écran", () => {
    const panne = new ErreurApi("R7 : DELETE interdit sur fabrique.executions", 500);
    expect(texteDeLErreur(panne, "épreuve", DEFAUT)).toBe(DEFAUT);
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

  /*
   * Audit d'intégrité du 1er novembre 2026 : la frontière de l'API rendait
   * ses refus en français (« introuvable, ou vous n'y avez pas accès »,
   * « cette valeur n'est pas admise : « … » ») à un écran réglé en arabe.
   * Elle rend désormais une clé, et la valeur citée la suit.
   */
  it("dit un refus de l'API dans la langue de la personne, avec la valeur qu'il cite", async () => {
    // L'écran n'affiche une langue qu'une fois son dictionnaire chargé
    // (i18n/dictionnaires.ts) : l'essai la charge comme lui.
    await chargerLaLangue("ar");
    window.localStorage.setItem("malica.locale", "ar");
    try {
      expect(texteDeLErreur(new ErreurApi("refus.introuvable", 404), "épreuve", DEFAUT)).toBe(
        "غير موجود، أو ليس لك حق الوصول إليه.",
      );
      const valeur = new ErreurApi("refus.moteur.valeur_non_admise?valeur=assistee", 400);
      expect(texteDeLErreur(valeur, "épreuve", DEFAUT)).toBe("هذه القيمة غير مقبولة: «assistee».");
    } finally {
      window.localStorage.removeItem("malica.locale");
    }
    const valeur = new ErreurApi("refus.moteur.valeur_non_admise?valeur=a%26b", 400);
    expect(texteDeLErreur(valeur, "épreuve", DEFAUT)).toBe(
      "Cette valeur n’est pas admise : « a&b ».",
    );
  });

  it("dit un refus levé par la base, chaque valeur à sa place, et la répète au besoin", async () => {
    // `app.refus_avec_valeurs` encode chaque octet ; la phrase cite le compte
    // deux fois (« 401 », puis « 4011, 4012… »).
    await chargerLaLangue("en");
    window.localStorage.setItem("malica.locale", "en");
    try {
      const refus = new ErreurApi("refus.plan.compte_livre?compte=401", 400);
      expect(texteDeLErreur(refus, "épreuve", DEFAUT)).toBe(
        "Account 401 already exists in the delivered chart: open a sub-account (4011, 4012…) rather than a duplicate.",
      );
      const collectif = new ErreurApi(
        "refus.plan.compte_collectif?compte=411&libelle=Clients%20%26%20comptes%20rattach%C3%A9s",
        400,
      );
      expect(texteDeLErreur(collectif, "épreuve", DEFAUT)).toMatch(
        /^Account 411 \(Clients & comptes rattachés\) is a control account/,
      );
    } finally {
      window.localStorage.removeItem("malica.locale");
    }
  });

  it("reconnaît ce qui vient de nous", () => {
    expect(vientDeNous(new ErreurApi("refus", 400))).toBe(true);
    expect(vientDeNous(new Error("autre chose"))).toBe(false);
    expect(vientDeNous("pas une erreur")).toBe(false);
  });
});

describe("une pièce qui n'existe plus", () => {
  // Audit du 25 octobre 2026 : une pièce effacée par une suppression accordée
  // s'ouvrait sur « Une erreur est survenue », sans chemin de retour.
  it("se reconnaît au 404 de l'API, et à lui seul", () => {
    expect(estIntrouvable(new ErreurApi("introuvable", 404))).toBe(true);
    expect(estIntrouvable(new ErreurApi("refus", 400))).toBe(false);
    expect(estIntrouvable(new Error("introuvable"))).toBe(false);
    expect(estIntrouvable(null)).toBe(false);
  });
});
