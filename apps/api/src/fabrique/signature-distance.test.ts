import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  classerLesCandidats,
  distanceEntreSignatures,
  ossatureCommune,
  type Composante,
  type ParametresDeClassement,
  type ParametresDeDistance,
  type VerdictDeProximite,
} from "./signature-distance.ts";
import {
  FACTURE_A,
  FACTURE_A_AUTRES_VALEURS,
  FACTURE_A_AUTRE_CLIENT,
  FACTURE_A_DEUX_PAGES,
  FACTURE_A_SIX_LIGNES,
  FACTURE_B_TTC,
  PAGE_DE_TOTAUX,
  recadrer,
} from "./signature-plans-synthetiques.ts";
import { signerLePlan, type ParametresDeSignature } from "./signature.ts";

/**
 * La distance entre deux signatures, et l'aveu d'ambiguïté.
 *
 * ================================================================= POURQUOI
 *
 * Classer, c'est facile ; refuser de classer, non. Une mesure qui rend
 * toujours un premier candidat est une mesure qui se trompe en silence le jour
 * où deux formats voisins sont également plausibles — et ce jour-là, la
 * recette d'un format s'appliquera à l'autre.
 *
 * Ce banc exige donc les DEUX : que des formats proches soient distingués, et
 * que l'égalité se dise « je ne sais pas » au lieu de choisir le premier.
 *
 * Plans SYNTHÉTIQUES. Aucun appel de modèle, aucun fournisseur payant.
 */

const PARAMETRES: ParametresDeSignature = {
  longueurMinimaleDAncre: 2,
  bandesParPage: 3,
  partMinimaleDuSens: 0.6,
  recouvrementDeLigne: 0.5,
  recouvrementDeColonne: 0.5,
  ancresEnRelationMax: 40,
};

/*
 * Les poids ne sont pas un jugement du produit : ils arrivent par argument.
 * En exécution ils viennent du paramétrage daté (R10) ; ici, ils sont ceux du
 * banc, et deux jeux différents donnent deux verdicts différents — c'est
 * d'ailleurs l'objet du dernier cas de ce fichier.
 */
const POIDS: ParametresDeDistance = {
  poids: { ancres: 3, zones: 1, relations: 2, tableau: 3, pagination: 1 },
};

const LARGE: ParametresDeClassement = { distanceMax: 0.5, ecartMinimal: 0.02 };

const signer = (tokens: ReturnType<typeof FACTURE_A>) => signerLePlan(tokens, PARAMETRES);

const composante = (
  ecart: ReturnType<typeof distanceEntreSignatures>,
  nom: Composante["nom"],
): number | null => ecart.composantes.find((c) => c.nom === nom)?.distance ?? null;

describe("le même format, d'autres valeurs", () => {
  it("rend une distance NULLE", () => {
    const d = distanceEntreSignatures(
      signer(FACTURE_A()),
      signer(FACTURE_A_AUTRES_VALEURS()),
      POIDS,
    );
    assert.equal(d.distance, 0);
  });

  /*
   * Le piège du comptage. Une facture de six lignes d'articles a exactement
   * la même forme qu'une facture de deux lignes : le nombre de lignes est une
   * donnée, pas une structure. Une mesure qui pèserait les occurrences les
   * éloignerait — et refuserait la recette au client qui commande beaucoup.
   */
  it("six lignes d'articles au lieu de deux : distance NULLE elle aussi", () => {
    const d = distanceEntreSignatures(signer(FACTURE_A()), signer(FACTURE_A_SIX_LIGNES()), POIDS);
    assert.equal(d.distance, 0);
  });

  it("recadré et mis à l'échelle, rend une distance NULLE", () => {
    const d = distanceEntreSignatures(
      signer(FACTURE_A()),
      signer(recadrer(FACTURE_A(), 0.07, -0.02, 0.86)),
      POIDS,
    );
    assert.equal(d.distance, 0);
  });
});

describe("deux formats voisins mais INCOMPATIBLES", () => {
  const a = signer(FACTURE_A());
  const b = signer(FACTURE_B_TTC());

  it("ne se confondent pas", () => {
    assert.ok(distanceEntreSignatures(a, b, POIDS).distance > 0);
  });

  it("se séparent sur la colonne de prix", () => {
    assert.ok((composante(distanceEntreSignatures(a, b, POIDS), "tableau") ?? 0) > 0);
  });

  /*
   * CE QUE CE CAS GARDE, ET POURQUOI IL EST CHIFFRÉ.
   *
   * Le 20 octobre 2026, cette composante valait 0,0330 alors que le pied de
   * la facture est INVERSÉ : trois couples contredits noyés dans
   * quatre-vingt-onze, parce que tous les couples lointains d'une page
   * s'accordent gratuitement. La suite de lecture ne garde que « ce qui suit
   * quoi », et la même discordance vaut 0,2353 ici — quatre liens sur
   * dix-sept — et 0,3077 sur l'ossature, où la chaîne réelle juge.
   *
   * Le seuil est écrit ici pour qu'un retour en arrière se voie : une borne
   * à 0 serait restée verte avec la mesure diluée.
   */
  it("se séparent sur l'ordre du pied, et la discordance se VOIT", () => {
    const mesure = composante(distanceEntreSignatures(a, b, POIDS), "relations") ?? 0;
    assert.ok(mesure > 0.2, `la discordance du pied est retombée à ${mesure.toFixed(4)}`);
  });

  it("et le classement désigne le bon, sans hésiter", () => {
    const verdict = classerLesCandidats(
      a,
      [
        { id: "format-ht", signature: signer(FACTURE_A_AUTRES_VALEURS()) },
        { id: "format-ttc", signature: b },
      ],
      POIDS,
      LARGE,
    );
    assert.equal(verdict.verdict.sorte, "un");
    assert.equal(verdict.verdict.sorte === "un" ? verdict.verdict.id : null, "format-ht");
  });
});

describe("l'ambiguïté", () => {
  it("deux candidats à égalité rendent « je ne sais pas », jamais le premier", () => {
    const sujet = signer(FACTURE_A());
    const verdict = classerLesCandidats(
      sujet,
      [
        { id: "premier", signature: signer(FACTURE_A_AUTRES_VALEURS()) },
        { id: "second", signature: signer(recadrer(FACTURE_A(), 0.07, -0.02, 0.86)) },
      ],
      POIDS,
      LARGE,
    );
    assert.equal(verdict.verdict.sorte, "ambigu");
    assert.deepEqual(
      verdict.verdict.sorte === "ambigu" ? [...verdict.verdict.exAequo].sort() : null,
      ["premier", "second"],
    );
  });

  it("deux candidats trop proches l'un de l'autre sont ambigus, même inégaux", () => {
    const serre: ParametresDeClassement = { distanceMax: 0.9, ecartMinimal: 0.9 };
    const verdict = classerLesCandidats(
      signer(FACTURE_A()),
      [
        { id: "format-ht", signature: signer(FACTURE_A_AUTRES_VALEURS()) },
        { id: "format-ttc", signature: signer(FACTURE_B_TTC()) },
      ],
      POIDS,
      serre,
    );
    assert.equal(verdict.verdict.sorte, "ambigu");
  });

  it("au-delà de la distance maximale, il n'y a AUCUN candidat", () => {
    const strict: ParametresDeClassement = { distanceMax: 0.01, ecartMinimal: 0.001 };
    const verdict = classerLesCandidats(
      signer(FACTURE_A()),
      [{ id: "format-ttc", signature: signer(FACTURE_B_TTC()) }],
      POIDS,
      strict,
    );
    assert.equal(verdict.verdict.sorte, "aucun");
  });

  it("sans aucun candidat, le verdict est « aucun » et non une erreur", () => {
    const verdict: VerdictDeProximite = classerLesCandidats(
      signer(FACTURE_A()),
      [],
      POIDS,
      LARGE,
    ).verdict;
    assert.equal(verdict.sorte, "aucun");
  });

  /*
   * LE SEUIL EST UN ARGUMENT, PAS UNE CONSTANTE.
   *
   * Les mêmes signatures, deux paramétrages, deux verdicts : la preuve
   * exécutable qu'aucun seuil de distance n'est écrit dans ce code. En
   * production ils viennent du référentiel, datés et surchargeables par le
   * cabinet (R10) ; ici ils viennent du banc.
   */
  it("change de verdict quand le paramétrage change, sans toucher au code", () => {
    const sujet = signer(FACTURE_A());
    const candidats = [{ id: "format-ttc", signature: signer(FACTURE_B_TTC()) }];
    assert.equal(classerLesCandidats(sujet, candidats, POIDS, LARGE).verdict.sorte, "un");
    assert.equal(
      classerLesCandidats(sujet, candidats, POIDS, { distanceMax: 0.01, ecartMinimal: 0.001 })
        .verdict.sorte,
      "aucun",
    );
  });
});

describe("les ancres répétées ne trompent pas la mesure", () => {
  it("une page qui ne porte qu'un libellé répété douze fois reste LOIN d'une facture", () => {
    const d = distanceEntreSignatures(signer(FACTURE_A()), signer(PAGE_DE_TOTAUX()), POIDS);
    assert.ok(d.distance > 0.5, `distance ${d.distance}`);
  });

  it("et le classement la refuse", () => {
    const verdict = classerLesCandidats(
      signer(FACTURE_A()),
      [{ id: "page-de-totaux", signature: signer(PAGE_DE_TOTAUX()) }],
      POIDS,
      LARGE,
    );
    assert.equal(verdict.verdict.sorte, "aucun");
  });
});

describe("l'ossature — ce que plusieurs exemplaires ont en commun", () => {
  const a = signer(FACTURE_A());
  const autre = signer(FACTURE_A_AUTRE_CLIENT());

  it("un client qui change écarte les deux signatures brutes", () => {
    assert.ok(distanceEntreSignatures(a, autre, POIDS).distance > 0);
  });

  it("l'ossature ne retient ni le client ni les désignations d'articles", () => {
    const os = ossatureCommune([a, autre]);
    for (const partie of ["dream", "optic", "baraka", "cartouche", "papier"])
      assert.ok(!os.includes(partie), `« ${partie} » varie : il n'est pas de l'ossature`);
  });

  it("l'ossature retient l'émetteur, les libellés et les mentions", () => {
    const os = ossatureCommune([a, autre]);
    for (const partie of ["sotupap", "facture", "matricule", "designation", "tva"])
      assert.ok(os.includes(partie), `« ${partie} » ne varie pas : il est de l'ossature`);
  });

  it("mesurée SUR l'ossature, la distance redevient nulle", () => {
    assert.equal(distanceEntreSignatures(a, autre, POIDS, ossatureCommune([a, autre])).distance, 0);
  });
});

describe("la pagination", () => {
  it("compte dans la distance : une page contre deux", () => {
    const d = distanceEntreSignatures(signer(FACTURE_A()), signer(FACTURE_A_DEUX_PAGES()), POIDS);
    assert.equal(composante(d, "pagination"), 0.5);
    assert.ok(d.distance > 0);
  });
});

/*
 * ===================================================== LE BANC DE SEPARATION
 *
 * Les trois nombres qui decident si la reconnaissance est sure, et la marge
 * qu'ils laissent au seuil livre. Ils sont ECRITS ici, pas resumes dans un
 * rapport : un rapport ne devient pas rouge quand la mesure bouge.
 *
 * Le dispositif est celui de l'interprete : une reference, l'ossature de
 * TROIS exemplaires du meme format, et le seuil `distance_max` du
 * referentiel. C'est a cette distance-la que la chaine reelle juge.
 */
describe("la separation, mesuree", () => {
  const exemples = [FACTURE_A(), FACTURE_A_AUTRES_VALEURS(), FACTURE_A_AUTRE_CLIENT()].map(signer);
  const ossature = ossatureCommune(exemples);
  const reference = exemples[0]!;
  const vers = (plan: ReturnType<typeof FACTURE_A>) =>
    distanceEntreSignatures(reference, signer(plan), POIDS, ossature).distance;

  /** Le seuil livre par `fabrique.seuil.signature.distance_max`. */
  const DISTANCE_MAX_LIVREE = 0.08;

  it("le meme format, quelles que soient ses valeurs, est a 0,0000", () => {
    for (const [nom, plan] of [
      ["autres valeurs", FACTURE_A_AUTRES_VALEURS()],
      ["six lignes d'articles", FACTURE_A_SIX_LIGNES()],
      ["un autre client", FACTURE_A_AUTRE_CLIENT()],
      ["un autre cadrage", recadrer(FACTURE_A(), 0.07, -0.02, 0.86)],
    ] as const)
      assert.equal(vers(plan), 0, `${nom} : ${vers(plan).toFixed(4)}`);
  });

  it("le voisin incompatible est a 0,1542, et les deux pages a 0,1529", () => {
    assert.equal(vers(FACTURE_B_TTC()).toFixed(4), "0.1542");
    assert.equal(vers(FACTURE_A_DEUX_PAGES()).toFixed(4), "0.1529");
  });

  /*
   * LA MARGE, ET CE QU'ELLE VALAIT AVANT.
   *
   * Le voisin incompatible etait a 0,0992 pour un seuil livre de 0,08 : une
   * marge de 0,019. Un scan plus clair, une colonne de plus, et elle
   * disparaissait. Elle vaut desormais 0,0742, et le plus proche des
   * non-appariements est a 0,1529 — le seuil peut etre pose n'importe ou
   * dans cet intervalle.
   */
  it("et la marge au seuil livre est de 0,0742, contre 0,019 avant", () => {
    const marge = vers(FACTURE_B_TTC()) - DISTANCE_MAX_LIVREE;
    assert.equal(marge.toFixed(4), "0.0742");
    assert.ok(marge > 0.019 * 3, "la marge n'a pas au moins triple");
  });

  it("aucun non-appariement ne descend sous le seuil livre", () => {
    for (const plan of [FACTURE_B_TTC(), FACTURE_A_DEUX_PAGES(), PAGE_DE_TOTAUX()])
      assert.ok(vers(plan) > DISTANCE_MAX_LIVREE, `${vers(plan).toFixed(4)} passe le seuil`);
  });
});
