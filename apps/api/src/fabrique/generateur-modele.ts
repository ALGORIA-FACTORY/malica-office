/**
 * L'adaptateur PAYANT du générateur — DeepSeek, et rien d'autre.
 *
 * ================================================================= POURQUOI
 *
 * `generateur.ts` est pur : il reçoit un port `AppelDeGenerateur` et ne sait
 * pas qui répond. Ce fichier est le seul endroit où un fournisseur payant est
 * appelé pour fabriquer une recette, et il est isolé pour une raison simple :
 * AUCUNE ÉPREUVE AUTOMATIQUE NE DOIT LE TOUCHER. Les épreuves branchent un
 * adaptateur simulé ; le vrai appel s'éprouve à la main, et la commande est
 * écrite dans `docs/fabrique-de-lecteurs/01-generer-une-recette.md`.
 *
 * ============================================================= R8 — LE COUPLE
 *
 * Le journal cherche un tarif par le COUPLE (modèle, rôle), et un organe sans
 * ligne de tarif ne se journalise pas, EN SILENCE. Ce défaut s'est manifesté
 * quatre fois dans ce dépôt. Ici, le couple rendu dans la réponse est celui
 * de `modeles.ts`, dérivé d'une seule déclaration : il n'y a pas deux endroits
 * où il pourrait se désaccorder, et `modeles.test.ts` confronte le couple à la
 * table des tarifs.
 */
import { callDeepSeek } from "../malica/conseil/deepseek.ts";
import { ROLE_GENERATION, ROLE_DEEPSEEK_DE_GENERATION } from "../malica/modeles.ts";

import type { AppelDeGenerateur, ReponseDeGenerateur } from "./generateur.ts";

/**
 * Branche le générateur sur DeepSeek.
 *
 * La réponse n'est pas crue : elle est rendue telle quelle à
 * `proposerUneRecette`, qui la passe par la barrière d'ossature, le
 * validateur strict et l'épreuve de reproduction. Un JSON illisible rend un
 * objet vide, et c'est `REPONSE_ILLISIBLE` qui le dit — jamais une exception
 * qui perdrait le journal de l'appel au passage.
 */
export function generateurDeepSeek(apiKey: string): AppelDeGenerateur {
  return async (invite): Promise<ReponseDeGenerateur> => {
    const resultat = await callDeepSeek({
      apiKey,
      role: ROLE_DEEPSEEK_DE_GENERATION,
      format: "json",
      messages: [
        { role: "system", content: invite.consigne },
        { role: "user", content: invite.observation },
      ],
    });

    let propose: unknown = null;
    try {
      propose = JSON.parse(resultat.answer);
    } catch {
      propose = null;
    }

    return {
      /*
       * Le modèle journalisé est celui que l'appel a RÉELLEMENT employé, pris
       * dans la réponse de `callDeepSeek` et non recopié d'une constante. Le
       * couple (modèle, rôle) ne peut donc pas se désaccorder par réécriture
       * d'un seul côté — c'est exactement la faute du 5 octobre, où un rôle
       * écrit en dur à côté d'un modèle dérivé d'ailleurs a fait disparaître
       * dix jours de mesures.
       */
      recetteProposee: propose,
      modele: resultat.model,
      role: ROLE_GENERATION,
      tokensIn: resultat.tokensIn,
      tokensOut: resultat.tokensOut,
      latenceMs: resultat.latencyMs,
    };
  };
}
