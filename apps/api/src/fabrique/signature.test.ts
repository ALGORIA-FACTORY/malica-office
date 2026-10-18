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
import type {
  RelationHorizontale,
  RelationSignature,
  RelationVerticale,
} from "./signature-relations.ts";
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

/** La relation d'un couple, orientée depuis `x` quel que soit son rangement. */
function relationOrientee(
  relations: readonly RelationSignature[],
  x: string,
  y: string,
): RelationSignature | null {
  const r = relations.find((v) => (v.a === x && v.b === y) || (v.a === y && v.b === x));
  if (!r) return null;
  if (r.a === x) return r;
  const v: RelationVerticale =
    r.v === "dessus" ? "dessous" : r.v === "dessous" ? "dessus" : ("meme_ligne" as const);
  const h: RelationHorizontale =
    r.h === "avant" ? "apres" : r.h === "apres" ? "avant" : ("meme_colonne" as const);
  return { a: x, b: y, v, h };
}

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

  it("n'entrent dans AUCUNE relation : un libellé répété ne désigne rien seul", () => {
    const page = signerLePlan(FACTURE_A(), PARAMETRES).pages[0]!;
    for (const r of page.relations) assert.ok(r.a !== "total" && r.b !== "total");
  });

  it("sont vues dans plusieurs bandes de la page — entête ET pied", () => {
    const signature = signerLePlan(FACTURE_A(), PARAMETRES);
    const total = signature.ancres.find((a) => a.cle === "total");
    assert.deepEqual(total?.bandes, [1, 2]);
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
   * LECTURE, tout en étant plus à DROITE sur le papier. Une relation calculée
   * sur l'abscisse seule rendrait l'inverse, et deux formats miroirs se
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

    const r = relationOrientee(page.relations, quantite, prixUnitaire);
    assert.equal(r?.h, "avant", "à la lecture, elle le précède");
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
