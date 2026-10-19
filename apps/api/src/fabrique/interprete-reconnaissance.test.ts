/**
 * La reconnaissance d'un format, éprouvée — pas relue.
 *
 *   node --experimental-strip-types --env-file-if-exists=.env \
 *     --env-file-if-exists=.env.test --import ./src/garde-base-de-test.ts \
 *     --test src/fabrique/interprete-reconnaissance.test.ts
 *
 * ================================================================= POURQUOI
 *
 * C'est ICI que se joue l'erreur grave. Une recette juste appliquée au
 * mauvais format rend un résultat plausible et faux — l'interprète, lui, n'a
 * aucun moyen de s'en apercevoir, et son propre banc le montre.
 *
 * Deux garanties, et la seconde est celle que le spécialiste de la signature
 * a nommée sans pouvoir la poser lui-même :
 *
 *   — deux formats voisins ne se confondent pas, et l'égalité se dit ;
 *   — une ossature tirée d'UN SEUL exemple n'est pas une ossature, et le
 *     format ne concourt pas.
 *
 * Les réglages de ce banc sont CEUX QUE LA MIGRATION LIVRE
 * (`20261020100000`), à la valeur près : un banc qui s'en écarterait
 * éprouverait autre chose que ce que le produit exécute.
 *
 * Plans SYNTHÉTIQUES. Aucun appel de modèle, aucun fournisseur payant.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  EXEMPLES_MINIMUM_POUR_UNE_OSSATURE,
  reconnaitre,
  type FormatConnu,
} from "./interprete-reconnaissance.ts";
import type { ParametresDeClassement, ParametresDeDistance } from "./signature-distance.ts";
import {
  FACTURE_A,
  FACTURE_ARABE,
  FACTURE_A_AUTRES_VALEURS,
  FACTURE_A_AUTRE_CLIENT,
  FACTURE_A_SIX_LIGNES,
  FACTURE_B_TTC,
  PAGE_DE_TOTAUX,
  recadrer,
} from "./signature-plans-synthetiques.ts";
import { signerLePlan, type ParametresDeSignature } from "./signature.ts";

/** Les six réglages livrés par `fabrique.seuil.signature.*`. */
const PARAMETRES: ParametresDeSignature = {
  longueurMinimaleDAncre: 2,
  bandesParPage: 3,
  partMinimaleDuSens: 0.6,
  recouvrementDeLigne: 0.5,
  recouvrementDeColonne: 0.5,
  ancresEnRelationMax: 40,
};
/** Les cinq poids livrés. */
const POIDS: ParametresDeDistance = {
  poids: { ancres: 3, zones: 1, relations: 2, tableau: 3, pagination: 1 },
};
/** Les deux seuils livrés. */
const LIVRE: ParametresDeClassement = { distanceMax: 0.08, ecartMinimal: 0.05 };

const signer = (tokens: ReturnType<typeof FACTURE_A>) => signerLePlan(tokens, PARAMETRES);

/** Le format français de référence, appris sur TROIS exemplaires. */
const FORMAT_A: FormatConnu = {
  id: "format-a",
  exemples: [FACTURE_A(), FACTURE_A_AUTRES_VALEURS(), FACTURE_A_AUTRE_CLIENT()].map(signer),
};

/** Le format voisin et incompatible, appris sur deux exemplaires. */
const FORMAT_B: FormatConnu = {
  id: "format-b",
  exemples: [FACTURE_B_TTC(), recadrer(FACTURE_B_TTC(), 0.03, 0.02, 0.94)].map(signer),
};

const juger = (plan: ReturnType<typeof FACTURE_A>, formats: readonly FormatConnu[]) =>
  reconnaitre(plan, formats, PARAMETRES, POIDS, LIVRE);

/* ====================================================================== */

describe("le même format, d'autres valeurs", () => {
  it("est reconnu, et la distance est nulle", () => {
    const r = juger(FACTURE_A_SIX_LIGNES(), [FORMAT_A]);
    assert.equal(r.classement.verdict.sorte, "un");
    assert.deepEqual(r.classement.verdict, { sorte: "un", id: "format-a", distance: 0 });
  });

  it("et un autre client ne l'éloigne pas, PARCE QUE l'ossature l'a fait tomber", () => {
    /*
     * La mesure, et c'est le second temps au grand complet : sans ossature, un
     * autre client met le document à 0,0960 de sa propre référence — « dream »
     * et « optic » étant entrés dans la signature comme s'ils étaient la forme
     * du papier. Avec l'ossature de trois exemples, 0,0000.
     */
    const r = juger(FACTURE_A_AUTRE_CLIENT(), [FORMAT_A]);
    assert.equal(r.classement.verdict.sorte, "un");
    assert.ok(r.ossature && !r.ossature.includes("dream"), "le nom du client est dans l'ossature");
    assert.ok(r.ossature?.includes("matricule"), "l'ossature a perdu un libellé de structure");
  });
});

describe("une ossature tirée d'un seul exemple", () => {
  it("n'est pas une ossature : le format ne concourt pas", () => {
    const unSeul: FormatConnu = { id: "format-a", exemples: [signer(FACTURE_A())] };
    const r = juger(FACTURE_A_SIX_LIGNES(), [unSeul]);
    assert.equal(r.classement.verdict.sorte, "aucun");
    assert.deepEqual(
      r.ecartes.map((e) => [e.id, e.motif]),
      [["format-a", "ossature_insuffisante"]],
    );
    assert.match(r.ecartes[0]!.detail, /1 exemple/);
  });

  it("et c'est bien le nom du client qui serait appris", () => {
    /*
     * La raison, montrée plutôt qu'affirmée. À un exemple, l'ossature porte
     * « dream », « optic », « papier », « encre » — un nom de client et deux
     * désignations d'articles, c'est-à-dire des VALEURS. Un format appris
     * ainsi ne reconnaîtrait plus jamais qu'une facture : la sienne.
     */
    const unSeul: FormatConnu = { id: "format-a", exemples: [signer(FACTURE_A())] };
    assert.equal(
      juger(FACTURE_A_AUTRE_CLIENT(), [unSeul]).classement.verdict.sorte,
      "aucun",
      "le même format, un autre client, a été reconnu sur une ossature d'un exemple",
    );
    assert.equal(EXEMPLES_MINIMUM_POUR_UNE_OSSATURE, 2);
  });

  it("deux exemples qui ne partagent aucune ancre ne font pas davantage une ossature", () => {
    const sansRien: FormatConnu = {
      id: "melange",
      exemples: [signer(FACTURE_A()), signer(FACTURE_ARABE())],
    };
    const r = juger(FACTURE_A(), [sansRien]);
    assert.equal(r.classement.verdict.sorte, "aucun");
    assert.match(r.ecartes[0]!.detail, /aucune ancre/);
  });
});

describe("deux formats proches mais incompatibles", () => {
  it("le voisin seul n'est PAS reconnu comme la référence", () => {
    /*
     * MESURÉ : `FACTURE_B_TTC` est à **0,1542** de `FACTURE_A` sur l'ossature
     * de A. Le seuil livré vaut 0,08, donc B n'entre pas — et la main revient
     * au modèle, ce que le produit sait déjà faire.
     *
     * ================================================ CE CHIFFRE A CHANGÉ, ET
     *                                                  C'EST UNE BONNE NOUVELLE
     *
     * Il valait 0,0992 quand ce banc a été écrit, pour une marge de 0,019 au
     * seuil livré. La composante des relations ne pesait alors que 0,0330 entre
     * deux formats dont le PIED EST INVERSÉ : trois couples contredits sur
     * quatre-vingt-onze, parce que la quasi-totalité des couples d'une page
     * s'accordent gratuitement — que l'en-tête soit au-dessus du pied est vrai
     * de toute facture du monde, et ce couple-là ne sépare jamais rien.
     *
     * Le dénominateur était donc le défaut, pas les poids. Les relations sont
     * devenues une SUITE DE LECTURE : seuls les liens de succession, ceux qui
     * peuvent être contredits. La composante passe à 0,3077, la distance à
     * 0,1542, et la marge quadruple — 0,0742.
     *
     * Ce cas reste là pour que sa disparition se voie : si la distance change,
     * ou si un cabinet relève `distance_max`, c'est ici que cela doit casser,
     * pas en production sur une facture.
     */
    const r = juger(FACTURE_B_TTC(), [FORMAT_A]);
    assert.equal(r.classement.verdict.sorte, "aucun");
    const mesure = r.classement.candidats[0]!.distance;
    assert.ok(
      mesure > LIVRE.distanceMax,
      `le format voisin est à ${mesure.toFixed(4)}, en deçà du seuil livré ${String(LIVRE.distanceMax)}`,
    );
    assert.ok(mesure < 0.16, "la distance au format voisin a bougé : les poids ont changé");
  });

  it("et un seuil relâché le ferait passer pour la référence — le relevé, pas une opinion", () => {
    /*
     * La contre-épreuve. Elle n'éprouve pas une protection : elle montre ce
     * qui tombe quand on relâche le seul réglage qui protège. Un cabinet qui
     * remonte `distance_max` assez haut applique la recette des prix HT à une
     * facture en prix TTC, et rien ne le lui dit.
     *
     * Le seuil dangereux était 0,15 ; il est maintenant 0,16, parce que la
     * distance au voisin est passée de 0,0992 à 0,1542. **Le danger a reculé
     * d'un cran** — mais il n'a pas disparu, et c'est pourquoi ce cas reste.
     */
    const relache: ParametresDeClassement = { distanceMax: 0.16, ecartMinimal: 0.05 };
    const r = reconnaitre(FACTURE_B_TTC(), [FORMAT_A], PARAMETRES, POIDS, relache);
    assert.equal(r.classement.verdict.sorte, "un");
  });

  it("les deux formats déclarés, le voisin va au SIEN", () => {
    const r = juger(FACTURE_B_TTC(), [FORMAT_A, FORMAT_B]);
    assert.deepEqual(r.classement.verdict, { sorte: "un", id: "format-b", distance: 0 });
    assert.equal(juger(FACTURE_A(), [FORMAT_A, FORMAT_B]).classement.verdict.sorte, "un");
  });

  it("deux formats que rien ne départage : on ne choisit pas, on le DIT", () => {
    /*
     * Le même format déclaré deux fois sous deux identifiants — ce qui arrive
     * réellement quand un cabinet enregistre deux fois la même facture. Les
     * deux sont à 0,0000 : aucun écart, donc aucun des deux ne gagne.
     */
    const jumeau: FormatConnu = { ...FORMAT_A, id: "format-a-bis" };
    const r = juger(FACTURE_A(), [FORMAT_A, jumeau]);
    assert.equal(r.classement.verdict.sorte, "ambigu");
    assert.deepEqual(
      r.classement.verdict.sorte === "ambigu" ? [...r.classement.verdict.exAequo].sort() : [],
      ["format-a", "format-a-bis"],
    );
    assert.equal(r.ossature, null, "une ambiguïté a quand même rendu une ossature");
  });
});

describe("ce qui n'a rien à voir", () => {
  for (const [nom, plan] of [
    ["une facture arabe", FACTURE_ARABE],
    ["une page qui ne porte qu'un libellé répété", PAGE_DE_TOTAUX],
  ] as const) {
    it(`${nom} n'est reconnue par aucun format français`, () => {
      assert.equal(juger(plan(), [FORMAT_A, FORMAT_B]).classement.verdict.sorte, "aucun");
    });
  }

  it("sans aucun format déclaré, il n'y a rien à reconnaître — et pas d'erreur", () => {
    const r = juger(FACTURE_A(), []);
    assert.equal(r.classement.verdict.sorte, "aucun");
    assert.deepEqual(r.ecartes, []);
    assert.ok(r.signature.empreinte.length === 64, "la signature du sujet n'est pas rendue");
  });
});
