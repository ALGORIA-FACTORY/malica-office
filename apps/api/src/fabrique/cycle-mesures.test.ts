/**
 * UN DROIT MAL DÉSIGNÉ PÈSE DANS LA PROMOTION COMME UN CHAMP MAL DÉSIGNÉ.
 *
 *   node --experimental-strip-types --test src/fabrique/cycle-mesures.test.ts
 *
 * ==================================================================== POURQUOI
 *
 * Le 19 octobre 2026, le langage apprend à désigner un droit hors TVA. Son
 * auteur a nommé le trou qu'il laissait, sans pouvoir le combler :
 *
 *   « `mesurer()` parcourt `obtenu.champs`, les droits sont dans
 *     `obtenu.droits`. Une désignation de droit fausse n'entre pas dans
 *     `exactitude_champs_critiques`. »
 *
 * Autrement dit : une recette pouvait être ACTIVÉE en désignant mal son
 * timbre. L'évaluation ne regardait pas ses droits, donc elle les réussissait
 * tous — et la base, qui refuse l'activation sur une mesure absente, n'avait
 * aucun moyen de savoir que cette mesure-là ne mesurait rien.
 *
 * ================================================= POURQUOI ÇA PÈSE AUTANT, ET PAS MOINS
 *
 * Un montant de timbre faux entre dans une écriture comptable au même titre
 * qu'un total. La distinction `champs` / `droits` est une commodité de
 * structure du langage — un droit porte un code en plus —, pas une hiérarchie
 * d'importance. Un droit compte donc DEUX fois, comme un total : dans
 * `exactitude_champs_critiques`, et dans `montants_faux_acceptes`.
 *
 * ============================================== CE QUE CE MODULE NE MESURE PAS
 *
 * Le CODE. Un droit désigné au bon jeton sous un code que le pack ignore est
 * refusé par `computePivot` (`MISSING_ACCOUNT_MAPPING`, bloquant), à l'écriture
 * et pour un code venu du modèle comme pour un code venu d'une recette — c'est
 * mesuré dans `une-recette-lit-une-facture-a-timbre.test.ts`. Ce qui ne se
 * voit nulle part ailleurs, c'est un montant PLAUSIBLE pris au mauvais jeton :
 * l'écriture boucle, aucun motif ne parle, et c'est la pire forme d'erreur de
 * ce dépôt. C'est donc celle-là que l'évaluation doit compter.
 *
 * Module pur : aucune base, aucun réseau, aucun fournisseur.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { TokenRef } from "@malica/socle/ports/malica";

import { mesurer, type ComparaisonDUnExemple } from "./cycle-mesures.ts";
import { absent, designer, sAbstenir, type ResultatDeRecette } from "./recette.ts";

const LE_TIMBRE: TokenRef = { page: 1, ordinal: 41 };
const UN_AUTRE_JETON: TokenRef = { page: 1, ordinal: 44 };

/** Un résultat de recette, dont on ne renseigne que ce que le cas éprouve. */
function obtenu(p: Partial<ResultatDeRecette>): ResultatDeRecette {
  return {
    version: "recette/1",
    champs: {},
    lignes: [],
    articles: [],
    codesDeTaux: { lignes: [], articles: [] },
    droits: [],
    ...p,
  };
}

/** Un exemple d'évaluation qui n'attend QU'un droit — le cas qui isole. */
function exempleAUnDroit(
  pieceId: string,
  code: string,
  ou: TokenRef,
  resultat: ResultatDeRecette,
): ComparaisonDUnExemple {
  return { pieceId, attendu: {}, droitsAttendus: { [code]: ou }, obtenu: resultat };
}

describe("les droits entrent dans la mesure de l'évaluation", () => {
  it("un droit JUSTE compte comme un champ juste, et comme un montant observé", () => {
    const m = mesurer([
      exempleAUnDroit(
        "p1",
        "DROIT_TIMBRE",
        LE_TIMBRE,
        obtenu({
          droits: [{ nom: "timbre", code: "DROIT_TIMBRE", resultat: designer(LE_TIMBRE) }],
        }),
      ),
    ]);
    assert.equal(m.mesures["exactitude_champs_critiques"], 1);
    assert.equal(m.mesures["montants_faux_acceptes"], 0);
    assert.deepEqual(m.ecarts, []);
    assert.deepEqual(
      m.absentes,
      [],
      "un exemple qui n'attend qu'un droit doit suffire à rendre les trois mesures : " +
        "sinon un format à timbre seul ne s'évalue pas",
    );
  });

  it("un droit désigné AILLEURS fait tomber l'exactitude ET compte un montant faux", () => {
    const m = mesurer([
      exempleAUnDroit(
        "p1",
        "DROIT_TIMBRE",
        LE_TIMBRE,
        obtenu({
          droits: [{ nom: "timbre", code: "DROIT_TIMBRE", resultat: designer(UN_AUTRE_JETON) }],
        }),
      ),
    ]);
    assert.equal(
      m.mesures["exactitude_champs_critiques"],
      0,
      "un timbre désigné ailleurs laisse l'exactitude à 1 : la recette serait promue",
    );
    assert.equal(
      m.mesures["montants_faux_acceptes"],
      1,
      "un montant de timbre faux n'est pas compté comme un montant faux",
    );
    assert.deepEqual(
      m.ecarts.map((e) => [e.champ, e.quoi]),
      [["other_charges[0].amount", "faux"]],
      "l'écart doit porter le nom que la CHAÎNE cite, pas le nom de la recette",
    );
  });

  it("un droit ABSTENU se compte comme une abstention, sous le nom de la chaîne", () => {
    const m = mesurer([
      exempleAUnDroit(
        "p1",
        "DROIT_TIMBRE",
        LE_TIMBRE,
        obtenu({
          droits: [
            {
              nom: "timbre",
              code: "DROIT_TIMBRE",
              resultat: sAbstenir("TOKEN_NOT_FOUND", "l'étiquette n'est pas sur la pièce"),
            },
          ],
        }),
      ),
    ]);
    assert.equal(m.mesures["exactitude_champs_critiques"], 0);
    assert.equal(m.mesures["taux_abstention"], 1);
    assert.equal(
      m.mesures["montants_faux_acceptes"],
      0,
      "une abstention n'est pas un montant faux : personne n'a rien inscrit",
    );
    assert.deepEqual(
      m.ecarts.map((e) => [e.champ, e.quoi, e.detail]),
      [["other_charges[0].amount", "abstention", "TOKEN_NOT_FOUND"]],
    );
  });

  it("un droit que la recette ne déclare PAS se dit, et nomme le code attendu", () => {
    /*
     * Le cas du 19 octobre, exactement : une recette sans section `droits` sur
     * un format à timbre. Elle ne s'abstient pas — personne ne s'est abstenu —
     * et elle n'est pas juste non plus. Le rang n'existe pas, donc l'écart
     * nomme le CODE : « other_charges[0] » désignerait un droit qui n'a pas
     * été déclaré.
     */
    const m = mesurer([exempleAUnDroit("p1", "DROIT_TIMBRE", LE_TIMBRE, obtenu({}))]);
    assert.equal(m.mesures["exactitude_champs_critiques"], 0);
    assert.equal(m.mesures["montants_faux_acceptes"], 0);
    assert.deepEqual(
      m.ecarts.map((e) => [e.champ, e.quoi]),
      [["other_charges[DROIT_TIMBRE].amount", "absent"]],
    );
  });

  it("un droit FACULTATIF absent qu'un exemple attend quand même n'est pas une réussite", () => {
    const m = mesurer([
      exempleAUnDroit(
        "p1",
        "DROIT_TIMBRE",
        LE_TIMBRE,
        obtenu({ droits: [{ nom: "timbre", code: "DROIT_TIMBRE", resultat: absent() }] }),
      ),
    ]);
    assert.equal(m.mesures["exactitude_champs_critiques"], 0);
    assert.deepEqual(
      m.ecarts.map((e) => [e.champ, e.quoi]),
      [["other_charges[0].amount", "absent"]],
    );
  });

  it("le rang cité est celui de la DÉCLARATION, pour que le motif se lise à l'écran", () => {
    /*
     * Deux droits déclarés, et c'est le second qui est mal désigné. La chaîne
     * cite un droit par son rang dans `other_charges` ; un écart qui nommerait
     * le rang 0 renverrait l'expert vers le droit qui est juste.
     */
    const m = mesurer([
      {
        pieceId: "p1",
        attendu: {},
        droitsAttendus: { DROIT_TIMBRE: LE_TIMBRE, FODEC: UN_AUTRE_JETON },
        obtenu: obtenu({
          droits: [
            { nom: "timbre", code: "DROIT_TIMBRE", resultat: designer(LE_TIMBRE) },
            { nom: "fodec", code: "FODEC", resultat: designer(LE_TIMBRE) },
          ],
        }),
      },
    ]);
    assert.equal(m.mesures["exactitude_champs_critiques"], 0.5);
    assert.deepEqual(
      m.ecarts.map((e) => e.champ),
      ["other_charges[1].amount"],
    );
  });

  it("sans aucun droit attendu, rien ne change de ce qui était mesuré", () => {
    /*
     * La non-régression de ce travail, et elle est structurelle : un exemple
     * qui n'attend aucun droit rend exactement les mêmes mesures qu'avant.
     */
    const m = mesurer([
      {
        pieceId: "p1",
        attendu: { "totals.base_ht": LE_TIMBRE },
        droitsAttendus: {},
        obtenu: obtenu({ champs: { "totals.base_ht": designer(LE_TIMBRE) } }),
      },
    ]);
    assert.deepEqual(m.mesures, {
      exactitude_champs_critiques: 1,
      taux_abstention: 0,
      montants_faux_acceptes: 0,
    });
    assert.deepEqual(m.absentes, []);
  });

  it("un jeu d'évaluation sans aucun montant NI aucun droit laisse la mesure ABSENTE", () => {
    /*
     * « Une mesure sans observation n'est pas une bonne mesure : elle est
     * absente. » Les droits entrent dans le dénominateur des montants, donc
     * ils pouvaient le rendre non nul par erreur : ici il reste nul, et la
     * mesure reste absente, avec sa raison.
     */
    const m = mesurer([
      {
        pieceId: "p1",
        attendu: { issuer: LE_TIMBRE },
        droitsAttendus: {},
        obtenu: obtenu({ champs: { issuer: designer(LE_TIMBRE) } }),
      },
    ]);
    assert.equal(m.mesures["montants_faux_acceptes"], undefined);
    assert.equal(m.absentes.length, 1);
    assert.match(m.absentes[0]!, /montants_faux_acceptes/);
  });
});
