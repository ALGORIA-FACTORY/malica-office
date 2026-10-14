/**
 * Le journal des appels ne peut plus se désaccorder du modèle appelé.
 *
 * ================================================= LE DÉFAUT QUI L'A FAIT NAÎTRE
 *
 * 14 octobre 2026. Question du dirigeant : « 36 secondes, c'est trop, pourquoi
 * la conception est mauvaise ? »
 *
 * La conception ne l'était pas : le dépôt avait DÉJÀ quitté le modèle de
 * raisonnement, le 5 octobre, pour cette raison exacte — trente-six secondes
 * d'attente pour quelqu'un qui tient son téléphone.
 *
 * Mais en cherchant, voici ce que la base a dit :
 *
 *     agent                        modèle              jour         appels
 *     malica.lecture.designation   deepseek-reasoner   2026-10-04        4
 *
 * Et plus rien. Aucune désignation journalisée depuis, alors que des pièces
 * ont été lues les 11 et 13 octobre.
 *
 * ============================================================= LA CAUSE EXACTE
 *
 * `agents.model_pricing` cherche un tarif par le COUPLE (modèle, rôle). Le
 * journal écrivait le rôle EN DUR — « reasoner » — pendant que l'appel passait
 * par `ROLE_DESIGNATION`, devenu « chat ». Il n'existe aucun tarif pour
 * (deepseek-chat, reasoner) : l'écriture était refusée, en silence.
 *
 * Conséquence : l'étape la plus lente de la chaîne n'était plus mesurée, et sa
 * dépense échappait au plafond de `agents.budgets`.
 *
 * C'est exactement le défaut que `modeles.ts` décrit — « dériver rend la
 * désynchronisation impossible, plutôt qu'interdite » — recréé une ligne plus
 * loin, dans le journal.
 *
 *   node --experimental-strip-types --test src/malica/lecture/le-journal-ne-peut-plus-se-desaccorder.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import { MODELE_DESIGNATION, ROLE_DESIGNATION } from "../modeles.ts";

/** Le code de production, commentaires retirés — un exemple ne prouve rien. */
function sansCommentaires(chemin: string): string {
  return readFileSync(resolve(process.cwd(), chemin), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*\/\//.test(l))
    .join("\n");
}

describe("le journal ne peut plus se désaccorder du modèle appelé", () => {
  it("le couple (modèle, rôle) est celui du paramétrage", () => {
    // Le tarif se cherche par le couple. S'ils divergent, l'appel s'exécute et
    // son coût n'est pas inscrit — ce qui ne casse rien, et c'est le pire.
    assert.equal(MODELE_DESIGNATION, "deepseek-chat");
    assert.equal(ROLE_DESIGNATION, "chat");
  });

  it("le journal n'écrit AUCUN rôle en dur pour la désignation", () => {
    /*
     * Le garde qui compte. Un rôle littéral ici est précisément ce qui a fait
     * disparaître dix jours de mesures, sans qu'aucune épreuve ne tombe.
     */
    const code = sansCommentaires("src/malica/lecture/read-flow.ts");
    const ligne = code.split("\n").find((l) => l.includes("malica.lecture.designation"));
    assert.ok(ligne, "la ligne de journal de la désignation existe");
    assert.ok(
      !/["'](reasoner|chat)["']/.test(ligne),
      `le rôle est écrit en dur dans le journal : ${ligne.trim()}`,
    );
    assert.match(ligne, /selectRole/);
  });

  it("le relevé suit la même règle", () => {
    // Son rôle est « vision » et ne dépend d'aucun choix de modèle : il peut
    // rester littéral. Ce qu'on vérifie, c'est qu'il n'emprunte pas celui de
    // la désignation par copier-coller.
    const code = sansCommentaires("src/malica/lecture/read-flow.ts");
    const ligne = code.split("\n").find((l) => l.includes("malica.lecture.releve"));
    assert.ok(ligne);
    assert.match(ligne, /"vision"/);
  });
});
