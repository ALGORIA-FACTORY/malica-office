import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cleDAncre } from "./signature-ecriture.ts";
import {
  FACTURE_A,
  FACTURE_ARABE,
  FACTURE_A_AUTRES_VALEURS,
  FACTURE_A_DEUX_PAGES,
  FACTURE_MIXTE,
  MOTS_AR,
  incliner,
  recadrer,
} from "./signature-plans-synthetiques.ts";
import type { AncreEnLecture } from "./signature-relations.ts";
import { signerLePlan, type ParametresDeSignature, type SignatureDePage } from "./signature.ts";

/**
 * La signature structurelle — ce qu'elle contient, et ce qu'elle refuse.
 *
 * ================================================================= POURQUOI
 *
 * Reconnaître qu'une pièce « a la même forme » qu'une autre est ce qui permet
 * de cesser d'appeler un modèle sur les documents récurrents. Le danger n'est
 * pas de ne pas reconnaître : c'est de reconnaître À TORT deux formats
 * voisins, car la suite de la chaîne appliquera alors une recette juste à un
 * document qui n'est pas le sien.
 *
 * Les cas ci-dessous sont donc écrits à l'envers de la complaisance : chacun
 * est un piège qui rendrait une mesure naïve verte.
 *
 * Les plans sont SYNTHÉTIQUES, et le disent (`signature-plans-synthetiques.ts`).
 */

/*
 * Aucun de ces nombres n'est une constante du produit : ce sont les réglages
 * de CE banc. En exécution, ils viennent du paramétrage daté et surchargeable
 * (R10) et descendent jusqu'ici par argument — `signerLePlan` n'en connaît
 * aucun par défaut, et c'est exprès.
 */
const PARAMETRES: ParametresDeSignature = {
  longueurMinimaleDAncre: 2,
  bandesParPage: 3,
  partMinimaleDuSens: 0.6,
  recouvrementDeLigne: 0.5,
  recouvrementDeColonne: 0.5,
  ancresEnRelationMax: 40,
};

const cles = (tokens: ReturnType<typeof FACTURE_A>) =>
  signerLePlan(tokens, PARAMETRES).ancres.map((a) => a.cle);

/** Le rang d'une ancre dans la suite de lecture, ou -1 si elle n'y est pas. */
const rangDansLaLecture = (lecture: readonly AncreEnLecture[], cle: string) =>
  lecture.findIndex((a) => a.cle === cle);

describe("ce qu'une signature contient", () => {
  it("porte les libellés, les mentions et l'ossature de l'entête", () => {
    const presentes = cles(FACTURE_A());
    for (const attendue of ["facture", "matricule", "fiscal", "designation", "qte", "total", "tva"])
      assert.ok(presentes.includes(attendue), `« ${attendue} » devrait être une ancre`);
  });

  it("distingue l'entête « P.U.HT » de l'entête « P.U.TTC »", () => {
    assert.ok(cles(FACTURE_A()).includes("puht"));
  });
});

describe("ce qu'une signature REFUSE de contenir", () => {
  it("aucune ancre ne porte de chiffre : ni montant, ni date, ni numéro", () => {
    for (const cle of cles(FACTURE_A()))
      assert.ok(!/[0-9]/.test(cle), `« ${cle} » porte un chiffre et n'est pas de la structure`);
  });

  it("le numéro de pièce, la date, le matricule et les montants sont absents", () => {
    const presentes = cles(FACTURE_A());
    for (const valeur of ["fa-2026-118", "04/10/2026", "1234567a", "1180,000", "1404,200"])
      assert.ok(!presentes.includes(valeur));
  });

  it("une valeur purement numérique ne produit aucune clé", () => {
    assert.equal(cleDAncre("1 404,200"), null);
    assert.equal(cleDAncre("04/10/2026"), null);
    assert.equal(cleDAncre("FA-2026-118"), null);
    assert.equal(cleDAncre(":"), null);
  });

  it("une clé ignore la casse, les accents et la vocalisation", () => {
    assert.equal(cleDAncre("Février"), cleDAncre("FEVRIER"));
    assert.equal(cleDAncre("P.U. HT"), cleDAncre("pu ht"));
  });

  /*
   * LA LIMITE, ÉCRITE ICI PLUTÔT QUE TUE.
   *
   * Rien dans UNE page ne distingue « SOTUPAP », qui est l'émetteur et donc de
   * la structure, de « DREAM OPTIC », qui est le client et donc une valeur.
   * Les deux sont alphabétiques, tous deux à côté d'un libellé. La signature
   * d'un document seul les retient donc toutes les deux — et c'est l'ossature,
   * calculée sur PLUSIEURS signatures du même format, qui fait tomber ce qui
   * varie (`signature-distance.test.ts`).
   */
  it("retient encore la raison sociale du client — et c'est l'ossature qui l'écarte", () => {
    assert.ok(cles(FACTURE_A()).includes("dream"));
  });
});

describe("deux photos de la même facture", () => {
  it("cadrées différemment, donnent la MÊME empreinte", () => {
    const droite = signerLePlan(FACTURE_A(), PARAMETRES);
    const decalee = signerLePlan(recadrer(FACTURE_A(), 0.07, -0.02, 0.86), PARAMETRES);
    assert.equal(decalee.empreinte, droite.empreinte);
  });

  it("posée de travers sur la vitre, donne la MÊME empreinte", () => {
    const droite = signerLePlan(FACTURE_A(), PARAMETRES);
    const penchee = signerLePlan(incliner(FACTURE_A(), 0.01), PARAMETRES);
    assert.equal(penchee.empreinte, droite.empreinte);
  });

  it("aux valeurs changées — numéro, date, quantités, montants — donne la MÊME empreinte", () => {
    const octobre = signerLePlan(FACTURE_A(), PARAMETRES);
    const novembre = signerLePlan(FACTURE_A_AUTRES_VALEURS(), PARAMETRES);
    assert.equal(novembre.empreinte, octobre.empreinte);
  });
});

describe("les ancres répétées", () => {
  it("sont comptées, et non confondues avec une ancre unique", () => {
    const signature = signerLePlan(FACTURE_A(), PARAMETRES);
    const total = signature.ancres.find((a) => a.cle === "total");
    assert.equal(total?.occurrences, 3, "« Total » : l'entête de colonne et deux lignes de pied");
  });

  /*
   * LA RÈGLE N'A PAS BOUGÉ, L'ÉPREUVE OUI. Jusqu'au 19 octobre 2026, elle
   * lisait `page.relations` — tous les couples d'ancres. La suite de lecture a
   * remplacé ces couples, et le refus est le même : une ancre répétée n'entre
   * pas dans ce qui dit « ce qui suit quoi », parce que dire ce qui suit
   * « Total » reviendrait à choisir laquelle des trois occurrences.
   */
  it("n'entrent pas dans la SUITE DE LECTURE : un libellé répété ne désigne rien seul", () => {
    const page = signerLePlan(FACTURE_A(), PARAMETRES).pages[0]!;
    assert.equal(page.ancres.find((a) => a.cle === "total")?.occurrences, 3);
    assert.equal(rangDansLaLecture(page.lecture, "total"), -1);
    for (const a of page.lecture)
      assert.equal(
        page.ancres.find((x) => x.cle === a.cle)?.occurrences,
        1,
        `« ${a.cle} » entre dans la suite sans être unique`,
      );
  });

  it("sont vues dans plusieurs bandes de la page — entête ET pied", () => {
    const signature = signerLePlan(FACTURE_A(), PARAMETRES);
    const total = signature.ancres.find((a) => a.cle === "total");
    assert.deepEqual(total?.bandes, [1, 2]);
  });
});

describe("la suite de lecture", () => {
  it("suit les lignes de haut en bas, puis l'ordre de lecture dans la ligne", () => {
    const page = signerLePlan(FACTURE_A(), PARAMETRES).pages[0]!;
    const rang = (cle: string) => rangDansLaLecture(page.lecture, cle);
    assert.ok(rang("sotupap") < rang("matricule"), "l'entete avant le bloc du matricule");
    assert.ok(rang("matricule") < rang("date"), "le matricule avant la date");
    assert.ok(rang("date") < rang("designation"), "l'entete avant le tableau");
    assert.ok(rang("designation") < rang("ht"), "le tableau avant le pied");
    assert.ok(rang("ht") < rang("tva") && rang("tva") < rang("ttc"), "HT, puis TVA, puis TTC");
  });

  /*
   * LE PLAFOND NE SE TAIT PAS.
   *
   * `ancresEnRelationMax` bornait un cout quadratique ; la suite est
   * lineaire, et il borne desormais la taille de ce qu'on stocke. Mais une
   * suite coupee comparee comme si elle etait entiere rendrait une distance
   * trop PETITE — donc une reconnaissance trop facile, dans la direction qui
   * fait mal. Elle se declare donc partielle, et la composante vaut 1.
   */
  it("se declare TRONQUEE quand le plafond la coupe, au lieu de se taire", () => {
    const serre: ParametresDeSignature = { ...PARAMETRES, ancresEnRelationMax: 4 };
    const page = signerLePlan(FACTURE_A(), serre).pages[0]!;
    assert.equal(page.lecture.length, 4);
    assert.equal(page.lectureTronquee, true);
  });

  it("et ne se declare pas tronquee quand le plafond ne la coupe pas", () => {
    const page = signerLePlan(FACTURE_A(), PARAMETRES).pages[0]!;
    assert.equal(page.lectureTronquee, false);
    assert.ok(page.lecture.length > 4);
  });
});

describe("le sens de lecture", () => {
  it("une page arabe se dit « rtl »", () => {
    assert.equal(signerLePlan(FACTURE_ARABE(), PARAMETRES).sens, "rtl");
  });

  it("une page qui porte les deux écritures se dit « mixte »", () => {
    assert.equal(signerLePlan(FACTURE_MIXTE(), PARAMETRES).sens, "mixte");
  });

  it("une page française se dit « ltr »", () => {
    assert.equal(signerLePlan(FACTURE_A(), PARAMETRES).sens, "ltr");
  });

  /*
   * « À gauche de » n'a pas le même sens dans les deux écritures. En arabe,
   * « الكمية » (quantité) précède « سعرالوحدة » (prix unitaire) À LA
   * LECTURE, tout en étant plus à DROITE sur le papier. Une suite calculée
   * sur l'abscisse croissante rendrait l'inverse, et deux formats miroirs se
   * confondraient.
   */
  it("en arabe, l'ancre qui précède est celle de DROITE", () => {
    const tokens = FACTURE_ARABE();
    const page: SignatureDePage = signerLePlan(tokens, PARAMETRES).pages[0]!;
    const quantite = cleDAncre(MOTS_AR.quantite)!;
    const prixUnitaire = cleDAncre(MOTS_AR.prixUnitaire)!;

    const abscisse = (texte: string) => {
      const t = tokens.find((x) => x.text === texte)!;
      return (t.x0 + t.x1) / 2;
    };
    assert.ok(
      abscisse(MOTS_AR.quantite) > abscisse(MOTS_AR.prixUnitaire),
      "sur le papier, la quantité est à droite du prix unitaire",
    );

    const rangQuantite = rangDansLaLecture(page.lecture, quantite);
    const rangPrix = rangDansLaLecture(page.lecture, prixUnitaire);
    assert.ok(rangQuantite >= 0 && rangPrix >= 0, "les deux ancres sont dans la suite");
    assert.ok(rangQuantite < rangPrix, "à la lecture, la quantité précède le prix unitaire");
    assert.equal(
      page.lecture[rangQuantite]!.ligne,
      page.lecture[rangPrix]!.ligne,
      "et les deux sont sur la même ligne : c'est bien l'abscisse qui les ordonne",
    );
  });

  /*
   * Le miroir, pour que la règle ne soit pas vraie par accident : la MÊME
   * géométrie lue de gauche à droite rend l'ordre INVERSE. Sans le sens de
   * lecture, les deux pages se signeraient pareil.
   */
  it("et la même page lue de gauche à droite rend l'ordre inverse", () => {
    const page = signerLePlan(FACTURE_A(), PARAMETRES).pages[0]!;
    assert.equal(signerLePlan(FACTURE_A(), PARAMETRES).sens, "ltr");
    assert.ok(
      rangDansLaLecture(page.lecture, "matricule") < rangDansLaLecture(page.lecture, "fiscal"),
      "en français, l'ancre qui précède est celle de GAUCHE",
    );
  });

  it("l'entête d'une page arabe se lit de droite à gauche", () => {
    const page = signerLePlan(FACTURE_ARABE(), PARAMETRES).pages[0]!;
    assert.deepEqual(
      page.colonnes.map((c) => c.colonne),
      ["quantity", "unit_price_ht", "total_ht"],
    );
  });
});

describe("la pagination", () => {
  it("un tableau réparti sur deux pages laisse DEUX pages de même structure", () => {
    const signature = signerLePlan(FACTURE_A_DEUX_PAGES(), PARAMETRES);
    assert.equal(signature.pages.length, 2);
    assert.deepEqual(
      signature.pages[1]!.colonnes.map((c) => c.colonne),
      signature.pages[0]!.colonnes.map((c) => c.colonne),
    );
  });

  it("les rangs de page sont ceux du document, pas ceux du plan", () => {
    const signature = signerLePlan(FACTURE_A_DEUX_PAGES(), PARAMETRES);
    assert.deepEqual(
      signature.pages.map((p) => p.rang),
      [1, 2],
    );
  });
});

describe("la structure de tableau", () => {
  it("rend les colonnes reconnues dans l'ordre de lecture", () => {
    const page = signerLePlan(FACTURE_A(), PARAMETRES).pages[0]!;
    assert.deepEqual(
      page.colonnes.map((c) => c.colonne),
      ["quantity", "unit_price_ht", "total_ht"],
    );
  });
});
