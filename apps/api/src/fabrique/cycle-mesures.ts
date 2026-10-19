/**
 * Ce qu'une évaluation MESURE — module pur.
 *
 * ================================================================= POURQUOI
 *
 * `fabrique.verifier_promotion()` refuse l'activation tant qu'une mesure
 * exigée par le référentiel manque à l'évaluation : « une mesure absente
 * reste absente », et c'est la base qui le tient. Encore faut-il que les
 * mesures qu'on lui donne soient calculées sur quelque chose.
 *
 * ======================================== LA RÈGLE QUI DÉCIDE DE TOUT ICI
 *
 * UNE MESURE SANS OBSERVATION N'EST PAS UNE BONNE MESURE : ELLE EST ABSENTE.
 *
 * Zéro montant faux accepté sur zéro montant observé vaut 0, et 0 franchit le
 * seuil « au plus 0 ». Une recette qu'aucun exemple d'évaluation ne met à
 * l'épreuve sur les totaux deviendrait donc active en ayant tout réussi de
 * rien. C'est la forme la plus coûteuse du repli implicite, et ce module ne
 * la produit pas : une mesure dont le dénominateur est nul n'est pas écrite,
 * la base refuse l'activation, et la recette reste en observation avec sa
 * raison.
 *
 * ========================================================== R4 — AUCUN SEUIL
 *
 * Aucun nombre qui décide n'est écrit ici. Les seuils vivent au référentiel
 * (`fabrique.seuil.promotion.*`), la base les lit, et ce module ne les
 * consulte même pas : il COMPTE, il ne juge pas.
 *
 * ========================================================== CE QU'IL NE LIT PAS
 *
 * Aucune valeur. La comparaison porte sur des `page`/`ordinal` : un montant
 * faux accepté est un montant DÉSIGNÉ AILLEURS que là où l'exemple l'attend,
 * ce qui se constate sans lire un seul chiffre.
 */
import type { TokenRef } from "@malica/socle/ports/malica";

import { memeReference } from "./generateur.ts";
import {
  CHAMPS_DE_PIECE,
  CHAMPS_DE_TOTAUX,
  type ResultatDeChamp,
  type ResultatDeRecette,
} from "./recette.ts";

/**
 * Les mesures que ce module sait produire.
 *
 * Elles portent le nom que `fabrique.seuils_exiges` rend dans sa colonne
 * `mesure` — c'est-à-dire le suffixe du code de référentiel. Un seuil ajouté
 * au référentiel sans mesure correspondante refuserait TOUTE activation en
 * silence ; `cycle.test.ts` confronte les deux listes et nomme l'écart.
 */
export const MESURES_CONNUES = [
  "exactitude_champs_critiques",
  "montants_faux_acceptes",
  "taux_abstention",
] as const;

/**
 * Les champs CRITIQUES d'une pièce.
 *
 * Ce ne sont pas un sous-ensemble choisi : ce sont exactement les champs du
 * contrat de désignation (`CHAMPS_DE_PIECE`). En choisir une partie
 * reviendrait à écrire dans le code qu'un montant compte plus qu'une date,
 * ce qui est une décision de cabinet et non d'architecture.
 *
 * Les DROITS hors TVA ne sont pas dans cette liste et sont pourtant critiques,
 * tous : ils ne sont pas des champs du contrat de désignation, ils ont leur
 * propre section dans le langage. Ils sont comptés comme critiques au point
 * d'appel, sans exception à choisir — un droit qu'un exemple attend est un
 * montant qui entre dans une écriture.
 */
const CHAMPS_CRITIQUES: readonly string[] = CHAMPS_DE_PIECE;

/** Ce qu'une exécution d'évaluation a donné sur un exemple. */
export interface ComparaisonDUnExemple {
  readonly pieceId: string;
  readonly attendu: Readonly<Record<string, TokenRef>>;
  /**
   * Les DROITS hors TVA attendus, par code du référentiel.
   *
   * ================================================ POURQUOI PAR CODE, PAS PAR RANG
   *
   * La chaîne cite un droit par son rang — `other_charges[0].amount` — mais le
   * rang appartient à la RECETTE : c'est l'ordre de ses déclarations. Un
   * exemple, lui, ne connaît pas la recette qu'on lui comparera ; il sait
   * qu'un droit de timbre est imprimé à tel jeton. Indexer l'attente par rang
   * rendrait la mesure dépendante de l'ordre d'écriture de la recette, donc
   * fausse dès qu'on en réécrit une.
   *
   * Le rang réapparaît à la SORTIE, dans l'écart : il est cherché dans la
   * recette, pour que le motif se lise à l'écran sous le nom que la chaîne
   * cite.
   */
  readonly droitsAttendus: Readonly<Record<string, TokenRef>>;
  readonly obtenu: ResultatDeRecette;
}

/** Un écart, nommé — pour que « pourquoi 0,94 » se lise sans enquête. */
export interface EcartMesure {
  readonly pieceId: string;
  readonly champ: string;
  readonly quoi: "faux" | "abstention" | "absent";
  readonly detail: string;
}

export interface Mesures {
  /** Ce qui s'écrit dans `fabrique.evaluations.mesures`. */
  readonly mesures: Readonly<Record<string, number>>;
  /** Les mesures qu'on n'a pas pu calculer, et pourquoi — en clair. */
  readonly absentes: readonly string[];
  readonly exemplesComptes: number;
  readonly ecarts: readonly EcartMesure[];
}

/**
 * Mesure une recette contre un jeu d'ÉVALUATION.
 *
 * L'appelant garantit que ces exemples sont bien ceux d'évaluation : la base
 * le garantit aussi, par une clé étrangère qui refuse un exemple
 * d'apprentissage (`fabrique.evaluation_exemples`). La séparation est de
 * construction, et ce module n'a pas à la redire.
 */
export function mesurer(comparaisons: readonly ComparaisonDUnExemple[]): Mesures {
  let critiquesAttendus = 0;
  let critiquesJustes = 0;
  let abstentions = 0;
  let montantsObserves = 0;
  let montantsFaux = 0;
  const ecarts: EcartMesure[] = [];

  /**
   * Compter UNE attente, et une seule façon de le faire.
   *
   * Les droits passaient par ici le 19 octobre 2026 : ils n'y passaient pas.
   * `mesurer` parcourait `attendu` et cherchait dans `obtenu.champs`, et les
   * droits vivent dans `obtenu.droits` — une désignation de droit fausse
   * n'entrait donc pas dans l'exactitude, et une recette pouvait être activée
   * en désignant mal son timbre.
   *
   * Le compte est maintenant écrit UNE fois et appelé deux. Ce n'est pas une
   * élégance : c'était la seule façon de garantir qu'un droit pèse
   * exactement ce que pèse un champ, sans qu'une deuxième copie dérive. Un
   * montant de timbre faux entre dans une écriture au même titre qu'un total ;
   * la distinction `champs` / `droits` est une commodité de structure du
   * langage, pas une hiérarchie d'importance.
   */
  const compter = (
    pieceId: string,
    champ: string,
    attendu: TokenRef,
    obtenu: ResultatDeChamp | undefined,
    critique: boolean,
    montant: boolean,
  ): void => {
    if (critique) critiquesAttendus += 1;
    if (montant) montantsObserves += 1;

    if (obtenu && "designe" in obtenu) {
      if (memeReference(obtenu.designe, attendu)) {
        if (critique) critiquesJustes += 1;
        return;
      }
      if (montant) montantsFaux += 1;
      ecarts.push({
        pieceId,
        champ,
        quoi: "faux",
        detail: "désigné ailleurs que là où l'exemple l'attend",
      });
      return;
    }
    if (obtenu && "abstention" in obtenu) {
      abstentions += 1;
      ecarts.push({ pieceId, champ, quoi: "abstention", detail: obtenu.abstention });
      return;
    }
    // `absent` ou rien du tout : la recette ne porte pas ce champ, et
    // l'exemple l'attendait. Ce n'est pas une abstention — personne ne s'est
    // abstenu — mais ce n'est pas juste non plus.
    ecarts.push({
      pieceId,
      champ,
      quoi: "absent",
      detail: "la recette ne désigne pas ce champ",
    });
  };

  for (const c of comparaisons) {
    for (const [champ, attendu] of Object.entries(c.attendu)) {
      compter(
        c.pieceId,
        champ,
        attendu,
        c.obtenu.champs[champ],
        CHAMPS_CRITIQUES.includes(champ),
        (CHAMPS_DE_TOTAUX as readonly string[]).some((t) => champ === `totals.${t}`),
      );
    }

    /*
     * LES DROITS HORS TVA — critiques, et comptés comme des MONTANTS.
     *
     * Le rang est cherché dans la recette pour que l'écart porte le nom que la
     * chaîne cite : `other_charges[<rang>].amount`, la clé sous laquelle
     * `read-piece.ts` relève, cite et contrôle un droit. Quand la recette ne
     * déclare pas ce code du tout, il n'y a pas de rang — le nom porte alors
     * le CODE, parce qu'un rang inventé renverrait l'expert vers un autre
     * droit, ou vers aucun.
     *
     * Ce qui n'est pas mesuré ici : le code lui-même. Un droit désigné au bon
     * jeton sous un code que le pack ignore bloque l'écriture par
     * `MISSING_ACCOUNT_MAPPING`, pour un code venu du modèle comme d'une
     * recette. Ce qui ne se voit nulle part ailleurs, c'est un montant
     * plausible pris au mauvais jeton : l'écriture boucle, aucun motif ne
     * parle. C'est celui-là qu'on compte.
     */
    for (const [code, attendu] of Object.entries(c.droitsAttendus)) {
      const rang = c.obtenu.droits.findIndex((d) => d.code === code);
      const ou = rang === -1 ? code : String(rang);
      compter(
        c.pieceId,
        `other_charges[${ou}].amount`,
        attendu,
        rang === -1 ? undefined : c.obtenu.droits[rang]!.resultat,
        true,
        true,
      );
    }
  }

  const mesures: Record<string, number> = {};
  const absentes: string[] = [];

  if (critiquesAttendus > 0) {
    mesures["exactitude_champs_critiques"] = critiquesJustes / critiquesAttendus;
    mesures["taux_abstention"] = abstentions / critiquesAttendus;
  } else {
    absentes.push(
      "exactitude_champs_critiques : aucun exemple d'évaluation n'attend de champ critique",
    );
    absentes.push("taux_abstention : aucun champ attendu, donc aucune occasion de s'abstenir");
  }

  if (montantsObserves > 0) {
    mesures["montants_faux_acceptes"] = montantsFaux;
  } else {
    absentes.push(
      "montants_faux_acceptes : aucun exemple d'évaluation n'attend de montant " +
        "ni de droit hors TVA — zéro faux sur zéro observé n'est pas une réussite",
    );
  }

  return { mesures, absentes, exemplesComptes: comparaisons.length, ecarts };
}
