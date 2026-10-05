import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SYSTEM_CARTE } from "./lire-carte.ts";
import { SYSTEM_SELECT } from "./vision.ts";

/**
 * La consigne de désignation — ce qu'elle ne doit plus jamais interdire.
 *
 * ================================================================= POURQUOI
 *
 * Cause racine du défaut le plus coûteux du 4 octobre 2026 : une phrase. Pas
 * un moteur, pas un schéma, pas une requête — une phrase de l'invite.
 *
 *   « Un MONTANT ou une DATE ne porte jamais "ordinal_end" : un seul token. »
 *
 * Or le plan de tokens découpe sur l'espace. « 2 800,000 » EST deux tokens.
 * Le modèle, sommé de n'en choisir qu'un, prenait le premier, et le produit
 * lisait 2,000 au lieu de 2 800,000. La troncature n'était pas une
 * hallucination : c'était l'obéissance exacte à une consigne fausse.
 *
 * Tout le reste de la chaîne était prêt — `texteDeLaPlage` recollait déjà la
 * plage, `normaliser-montants` lisait déjà « 2 800,000 », et le schéma
 * acceptait déjà `ordinal_end` sur tous les champs. On avait seulement
 * interdit de s'en servir.
 *
 * ============================================================= CE QU'IL TIENT
 *
 * Tester le texte d'une invite est inhabituel, et c'est pourtant le seul
 * endroit où cette garantie peut vivre : l'artefact fautif était du texte. Ce
 * test ne vérifie pas que le modèle obéit — c'est l'affaire de l'épreuve
 * réelle et du jeu d'or. Il vérifie qu'on ne lui a pas de nouveau interdit de
 * bien faire, ce qui est arrivé une fois et ne se voyait nulle part.
 */
describe("la consigne de désignation d'une facture", () => {
  it("n'interdit plus la plage sur un montant ni sur une date", () => {
    /*
     * Le motif cherche la forme de l'interdiction, pas sa lettre : une
     * reformulation qui la rétablirait doit tomber ici aussi.
     */
    const interdiction = /(MONTANT|DATE|montant|date)[^.]{0,80}jamais\s+"?ordinal_end"?/;
    assert.doesNotMatch(
      SYSTEM_SELECT,
      interdiction,
      "la phrase qui a coûté la lecture de tous les montants à quatre chiffres",
    );
  });

  it("nomme le cas qui l'a fait naître : l'espace des milliers", () => {
    // Lever l'interdiction ne suffit pas : le modèle doit savoir QUAND la
    // plage s'applique. Un silence se comblerait par l'ancienne habitude.
    assert.match(SYSTEM_SELECT, /espace des milliers/);
  });

  it("demande la plage pour une date en toutes lettres", () => {
    // « 1 septembre 2026 » : trois tokens, et c'est la forme la plus courante
    // sur une facture tunisienne bureautique.
    assert.match(SYSTEM_SELECT, /lettres/);
  });

  it("garde l'exemple de plage dans le gabarit JSON", () => {
    // Un gabarit qui ne montre `ordinal_end` que sur une désignation d'article
    // enseignait, par l'exemple, que les montants n'en portent pas.
    assert.match(SYSTEM_SELECT, /"ordinal_end"/);
  });

  it("continue d'interdire l'invention, qui est l'autre moitié de R2", () => {
    // La plage est une autorisation de CITER plus large, jamais de deviner.
    // `\s+` et non une espace : l'invite est écrite à la main, et ses retours
    // à la ligne tombent où ils tombent.
    assert.match(SYSTEM_SELECT, /ne\s+devine jamais/);
  });
});

describe("la consigne de désignation d'une carte fiscale", () => {
  it("n'interdit plus la plage sur une date", () => {
    // « début d'activité » peut être imprimé en toutes lettres comme ailleurs.
    assert.doesNotMatch(SYSTEM_CARTE, /DATE[^.]{0,80}jamais\s+"?ordinal_end"?/);
  });

  it("garde la règle du matricule, qui est fondée", () => {
    /*
     * Ici l'interdiction du token unique n'est pas une erreur : un matricule
     * tunisien s'écrit 1234567/A/M/000, et quand l'œil l'éclate, la consigne
     * dit lequel désigner. On ne retire pas une règle juste parce qu'une autre,
     * voisine et mal fondée, vient de tomber.
     */
    assert.match(SYSTEM_CARTE, /MATRICULE FISCAL/);
    assert.match(SYSTEM_CARTE, /sept chiffres/);
  });
});
