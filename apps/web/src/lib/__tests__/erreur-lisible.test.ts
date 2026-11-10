/**
 * Ce qu'on montre d'une erreur — la phrase prévue et une référence, jamais le moteur.
 *
 * Garantit qu'aucun message de moteur, de base, de pilote ou de validation n'atteint
 * l'écran : seule une clé de refus venant de notre API se dit, dans la langue de la
 * personne et avec la valeur qu'elle cite ; tout le reste devient la phrase prévue et
 * une référence, et le détail part au journal sous la même référence. Une même erreur
 * rendue deux fois garde sa référence et ne s'inscrit qu'une fois. Le journal se relit
 * en clair dans les réglages.
 */
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const journal = vi.hoisted(() => ({
  notes: [] as Array<{ ou: string; raison: unknown; ref?: string }>,
}));
vi.mock("../journal-atelier", () => ({
  noterAuJournal: (ou: string, raison: unknown, ref?: string) =>
    journal.notes.push({ ou, raison, ...(ref === undefined ? {} : { ref }) }),
}));

import { direUnRefus, estIntrouvable, texteDeLErreur, vientDeNous } from "../erreur-lisible";
import { estUnIdentifiant } from "../identifiant";
import { ErreurApi } from "../transport/erreurs";
import { chargerLaLangue } from "@/i18n/dictionnaires";

const DEFAUT = "Une erreur est survenue.";
/** La phrase prévue, suivie de sa référence : ce que l'écran dit d'une panne. */
const AVEC_REFERENCE = /^Une erreur est survenue\. \(réf\. ([0-9A-F]{8})\)$/;

beforeEach(() => {
  journal.notes.length = 0;
});

describe("ce qu'on montre d'une erreur", () => {
  /*
   * LE DÉFAUT QUE CECI VERROUILLE
   *
   * « Cannot transfer object of unsupported type. » s'est affiché tel quel,
   * en anglais, sur le téléphone d'un dirigeant de PME. Puis un tableau JSON
   * de validation. Quatorze écrans affichaient `e.message` sans filtre.
   */
  it("ne montre jamais le message d'un moteur : la phrase prévue, une référence, et le journal", () => {
    const moteur = new Error("Cannot transfer object of unsupported type.");
    const texte = texteDeLErreur(moteur, "épreuve", DEFAUT);
    const ref = AVEC_REFERENCE.exec(texte)?.[1];
    expect(ref).toBeDefined();
    // La même référence au journal : c'est elle qui retrouve la ligne.
    expect(journal.notes).toEqual([{ ou: "épreuve", raison: moteur, ref }]);
  });

  it("une panne de l'API (5xx) part au journal, pas à l'écran", () => {
    const panne = new ErreurApi("R7 : DELETE interdit sur fabrique.executions", 500);
    expect(texteDeLErreur(panne, "épreuve", DEFAUT)).toMatch(AVEC_REFERENCE);
    expect(journal.notes).toHaveLength(1);
  });

  it("ne montre jamais un tableau de validation", () => {
    const zod = new Error('[{"validation":"regex","path":["document_date"]}]');
    expect(texteDeLErreur(zod, "épreuve", DEFAUT)).toMatch(AVEC_REFERENCE);
  });

  /*
   * Audit du 6 novembre 2026 (web, constat 2) : un refus 4xx qui n'était pas
   * une clé du dictionnaire était « rendu tel quel » — un message de base, de
   * pilote, du HTML renvoyé en écho atteignait l'écran. Règle du dirigeant :
   * seule une CLÉ se dit ; tout le reste est la phrase prévue, et le journal.
   */
  it("un refus de l'API qui n'est pas une clé ne s'affiche pas : il va au journal", () => {
    for (const brut of [
      "Ce matricule appartient déjà à un autre dossier.",
      "dépôt inconnu : <b>x</b>",
      "La tour est réservée aux opérateurs d'ALGORIA.",
      "refus.cle.que.personne.n.a.ecrite",
    ]) {
      expect(texteDeLErreur(new ErreurApi(brut, 400), "épreuve", DEFAUT), brut).toMatch(
        AVEC_REFERENCE,
      );
    }
    expect(journal.notes).toHaveLength(4);
  });

  it("distingue par l'origine, pas par le texte", () => {
    // Même clé, deux origines : seule celle de notre API se dit.
    expect(texteDeLErreur(new ErreurApi("refus.introuvable", 404), "épreuve", DEFAUT)).toBe(
      "Introuvable, ou vous n’y avez pas accès.",
    );
    expect(texteDeLErreur(new Error("refus.introuvable"), "épreuve", DEFAUT)).toMatch(
      AVEC_REFERENCE,
    );
    // Un refus connu n'est pas une panne : rien au journal pour lui.
    expect(journal.notes).toHaveLength(1);
  });

  it("une même erreur rendue deux fois garde sa référence, et ne s'inscrit qu'une fois", () => {
    // Un écran rend `texteDeLErreur(mutation.error, …)` à chaque rendu.
    const panne = new ErreurApi("erreur interne", 500);
    const premier = texteDeLErreur(panne, "épreuve", DEFAUT);
    expect(texteDeLErreur(panne, "épreuve", DEFAUT)).toBe(premier);
    expect(journal.notes).toHaveLength(1);
  });

  it("tient devant ce qui n'est même pas une erreur", () => {
    expect(texteDeLErreur("une chaîne", "épreuve", DEFAUT)).toMatch(AVEC_REFERENCE);
    expect(texteDeLErreur(null, "épreuve", DEFAUT)).toMatch(AVEC_REFERENCE);
    expect(texteDeLErreur(undefined, "épreuve", DEFAUT)).toMatch(AVEC_REFERENCE);
    expect(texteDeLErreur({ erreur: "objet nu" }, "épreuve", DEFAUT)).toMatch(AVEC_REFERENCE);
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

describe("le journal se relit en clair", () => {
  it("une clé de refus rangée au journal se dit en phrase, avec sa valeur", async () => {
    await chargerLaLangue("fr");
    expect(direUnRefus("refus.moteur.valeur_non_admise?valeur=829e3c34")).toBe(
      "Cette valeur n’est pas admise : « 829e3c34 ».",
    );
  });

  it("une ligne du journal qui n'est pas une clé se dit par la phrase prévue, avec sa référence", async () => {
    await chargerLaLangue("fr");
    // Le journal garde le détail ; l'écran de réglages n'en montre rien.
    expect(direUnRefus("TypeError: Cannot read properties of undefined")).toBe(DEFAUT);
    expect(direUnRefus("[ref 7F3A21C9] permission denied for table pieces")).toBe(
      "Une erreur est survenue. (réf. 7F3A21C9)",
    );
    expect(direUnRefus("[ref 7F3A21C9] refus.introuvable")).toBe(
      "Introuvable, ou vous n’y avez pas accès.",
    );
  });

  it("une adresse tronquée n'est pas un identifiant : rien ne part à la base", () => {
    expect(estUnIdentifiant("829e3c34")).toBe(false);
    expect(estUnIdentifiant("829e3c34-c8ed-43ba-8599-8957c0a458c1")).toBe(true);
  });
});
