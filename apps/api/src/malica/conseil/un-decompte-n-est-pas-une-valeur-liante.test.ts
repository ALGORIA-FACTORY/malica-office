/**
 * La frontière de R3 : ce qui ENGAGE, pas ce qui compte.
 *
 * ================================================================= LE DÉFAUT
 *
 * Défaut 10 du 5 octobre 2026 (`docs/diagnostic-essai-reel-2-et-3.md`) : Malica
 * a le chiffre et l'interdiction de s'en servir. `loadMalicaContext` transmet
 * `pieces: Record<string, number>` — pour quatre pièces lues, l'invite porte
 * littéralement `"pieces":{"lue":4}` — et la doctrine lui interdisait « aucune
 * addition, aucun cumul ». Un décompte EST un cumul au sens littéral.
 *
 * Mesuré sur le modèle, doctrine d'avant, dossier portant
 * `"pieces":{"lue":4,"capturee":2}`, question « combien de factures attendent
 * ma réponse ? » :
 *
 *   « Je ne peux pas vous le dire : aucune facture ne figure dans les éléments
 *     que j'ai sous les yeux. »
 *
 * Ce n'est pas un refus prudent : c'est une réponse FAUSSE sur une donnée que
 * le dossier portait. La pire des trois issues — plausible et invérifiable.
 *
 * ============================================================== L'ARBITRAGE
 *
 * La frontière est la valeur LIANTE, pas l'arithmétique. Un décompte d'objets
 * que la base a déjà comptés et que le contexte porte se restitue. Un montant,
 * un solde, un taux, une échéance, une imputation : jamais, même présents au
 * contexte — Malica appelle un moteur du Socle et cite son résultat (R3).
 *
 * ===================================================== POURQUOI ÉPROUVER UN TEXTE
 *
 * Même raison que `../lecture/consigne-de-designation.test.ts`, et c'est la
 * seule place où cette garantie puisse vivre : l'artefact fautif était du
 * texte, et rien ne le vérifiait. Deux semaines ont passé avant qu'on le voie.
 *
 * Ce test ne prouve pas que le modèle obéit — l'essai réel s'en charge. Il
 * prouve qu'on ne lui a pas de nouveau interdit de bien faire, et qu'on ne lui
 * a pas, du même geste, permis de chiffrer.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { systemPrompt } from "./ask.ts";
import { chiffresEngageants, controler } from "./controles.ts";
import type { FragmentDeDroit } from "./corpus.ts";

const DOCTRINE = systemPrompt("fr");

describe("la doctrine de Malica, sur les nombres", () => {
  it("permet de restituer un décompte que le dossier porte", () => {
    /*
     * On cherche la FORME de la permission, pas sa lettre : le mot qui dit
     * l'acte (compter, dénombrer, décompte) tenu dans la même phrase que ce
     * qui le rend licite — la base a déjà compté, le dossier le porte.
     */
    assert.match(
      DOCTRINE,
      /(d[ée]compte|d[ée]nombre|combien)/i,
      "la doctrine ne dit nulle part ce qu'il faut faire d'un décompte",
    );
  });

  it("nomme la clé du dossier qui porte les décomptes", () => {
    /*
     * La doctrine disait « LES CHIFFRES » sans jamais nommer `pieces` ni le
     * vocabulaire des statuts. Le modèle recevait la donnée sans savoir que
     * c'en était une : il a répondu qu'elle n'existait pas.
     */
    assert.match(DOCTRINE, /\bpieces\b/, "la clé `pieces` n'est pas nommée");
    assert.match(
      DOCTRINE,
      /\bcapturee\b|\blue\b|statut/i,
      "le vocabulaire des statuts de pièce n'est pas donné",
    );
  });

  it("interdit toujours de former une valeur qui engage", () => {
    for (const liant of ["montant", "solde", "taux", "échéance", "imputation"]) {
      assert.ok(
        DOCTRINE.toLowerCase().includes(liant),
        `la doctrine ne nomme plus « ${liant} » parmi ce qu'elle ne forme pas`,
      );
    }
    assert.match(
      DOCTRINE,
      /Tu ne calcules jamais/,
      "l'interdiction de calculer a disparu de la doctrine",
    );
  });

  it("n'interdit plus le cumul sans dire l'exception, dans la même phrase", () => {
    /*
     * LE GARDE-FOU DE CE TEST, et sa raison d'être.
     *
     * « aucune addition, aucun cumul », seul, est l'interdiction qui a produit
     * le défaut. Une reformulation qui la rétablirait sans son exception doit
     * tomber ici — sinon la correction ne tiendrait qu'un commit.
     */
    for (const ligne of DOCTRINE.split("\n")) {
      if (!/\bcumul/i.test(ligne)) continue;
      assert.match(
        ligne,
        /(d[ée]compte|d[ée]nombre|nombre d|combien)/i,
        `« ${ligne.slice(0, 90)}… » interdit le cumul sans dire ce qu'un décompte devient`,
      );
    }
  });

  it("dit que la présence au contexte ne suffit pas pour un montant", () => {
    /*
     * La moitié qui compte vraiment. « Restitue ce que le dossier porte » est
     * vrai d'un décompte et FAUX d'un montant : un montant du contexte se cite
     * avec son origine, il ne se recompose pas.
     */
    assert.match(
      DOCTRINE,
      /Socle/,
      "la doctrine ne renvoie plus au Socle pour les valeurs qui engagent",
    );
  });
});

/**
 * Les gardes ne bougent pas.
 *
 * Le diagnostic conclut que l'obstacle était ENTIÈREMENT dans la consigne. Ces
 * deux épreuves le tiennent dans le temps : une correction de doctrine qui
 * aurait aussi desserré les contrôles ne serait pas la correction demandée.
 */
describe("les contrôles, face à un décompte et face à un montant", () => {
  it("laissent passer un décompte : ce n'est pas un chiffre qui engage", () => {
    assert.deepEqual(chiffresEngageants("quatre factures attendent votre réponse"), []);
    assert.deepEqual(chiffresEngageants("il vous reste 4 pièces à valider"), []);
  });

  it("retiennent un montant que rien ne fonde", () => {
    const fragments: readonly FragmentDeDroit[] = [];
    const verdicts = controler({
      reponse: "Votre TVA est de 741,000 dinars.",
      fragments,
      chiffresAutorises: [],
      aujourdhui: "2026-10-18",
    });
    assert.deepEqual(
      verdicts.map((v) => v.code),
      ["chiffre_sans_source"],
    );
    assert.equal(verdicts[0]?.suite, "retirer");
  });
});
