/**
 * La signature structurelle d'un document — module pur.
 *
 * ================================================================= POURQUOI
 *
 * Pour cesser d'appeler un modèle distant sur les documents récurrents, il
 * faut d'abord reconnaître qu'une pièce « a la même forme » qu'une autre —
 * sans jamais confondre deux formats voisins, car une recette juste appliquée
 * au mauvais format produit un résultat plausible et faux.
 *
 * Ce module calcule cette forme à partir du PLAN DE JETONS SEUL. Il ne voit
 * pas la pièce, n'appelle rien, ne lit aucune base.
 *
 * ================================================== CE QU'UNE SIGNATURE PORTE
 *
 *   des ANCRES      les mots qui ne varient pas : libellés, mentions,
 *                   ossature de l'entête. Comptées, et situées en bandes.
 *   des RELATIONS   l'ordre spatial entre ancres uniques, dans le sens de
 *                   lecture de la page.
 *   des COLONNES    la structure du tableau imprimé, dans l'ordre de lecture.
 *   des PAGES       leur nombre et leur rang, pour qu'un tableau réparti sur
 *                   plusieurs pages se voie.
 *
 * ============================================= CE QU'ELLE REFUSE DE PORTER
 *
 *   — AUCUNE COORDONNÉE FIXE. Tout est ordinal ou relatif à la boîte de
 *     contenu : un document scanné de travers ou cadré autrement les
 *     invaliderait toutes, et c'est le cas ordinaire de ce produit.
 *   — AUCUNE VALEUR VARIABLE. Un montant, une date, un numéro de pièce ne
 *     sont pas de la structure : une signature qui les contient ne
 *     reconnaîtrait qu'un seul document, le sien.
 *
 * ============================================== CE QU'ELLE NE DÉCIDE PAS
 *
 * Elle DÉCRIT et elle CLASSE. Qu'une recette s'applique, qu'il faille
 * s'abstenir, ce qu'on fait d'une ambiguïté : ce sont les tâches de
 * l'interpréteur et du branchement, en aval. L'interface s'arrête ici, et
 * `signature-distance.ts` ne rend jamais autre chose qu'une distance et un
 * verdict de PROXIMITÉ — jamais une probabilité de justesse, qui serait un
 * score non calibré affiché comme une certitude.
 *
 * ======================================================== OÙ VIVENT LES SEUILS
 *
 * Nulle part ici. Tout nombre qui décide arrive par `ParametresDeSignature`,
 * sans valeur par défaut : le compilateur refuse un appel qui en oublie un.
 * En exécution ils viennent du paramétrage daté et surchargeable par le
 * cabinet (R10) ; aucun n'est écrit en TypeScript (R4).
 */
import { createHash } from "node:crypto";

import type { PageToken } from "@malica/socle/ports/malica";

import { ancresDeLaPage, type AncreSignature } from "./signature-ancres.ts";
import { sensDominant, type Sens } from "./signature-ecriture.ts";
import { relationsEntreAncres, type RelationSignature } from "./signature-relations.ts";
import { colonnesDeLaPage, type ColonneSignature } from "./signature-tableau.ts";

/** Les réglages de la signature. Aucun défaut : ils viennent du référentiel. */
export interface ParametresDeSignature {
  /** En deçà, une clé est du bruit (« N° », « à ») et n'est pas une ancre. */
  longueurMinimaleDAncre: number;
  /** Découpage horizontal de la boîte de contenu. Trois : entête, corps, pied. */
  bandesParPage: number;
  /** Part des jetons d'une écriture pour que la page soit dite de ce sens. */
  partMinimaleDuSens: number;
  /** Recouvrement vertical minimal pour dire « même ligne ». */
  recouvrementDeLigne: number;
  /** Recouvrement horizontal minimal pour dire « même colonne ». */
  recouvrementDeColonne: number;
  /** Plafond du nombre d'ancres entrant dans les relations (coût quadratique). */
  ancresEnRelationMax: number;
}

export interface SignatureDePage {
  /** Rang dans le document, de 1 à N — jamais le numéro de page du plan. */
  rang: number;
  sens: Sens;
  ancres: AncreSignature[];
  relations: RelationSignature[];
  colonnes: ColonneSignature[];
}

export interface SignatureDeDocument {
  /** La forme de cette signature. Deux versions ne se comparent pas. */
  version: number;
  sens: Sens;
  pages: SignatureDePage[];
  /** Les ancres du document entier : occurrences cumulées, bandes réunies. */
  ancres: AncreSignature[];
  /** Empreinte reproductible : deux plans de même forme la partagent. */
  empreinte: string;
}

/**
 * La version de la FORME d'une signature.
 *
 * Elle n'est pas un seuil : changer la façon de signer rend les signatures
 * déjà stockées incomparables, et il faut que cela se voie plutôt que de
 * produire des distances silencieusement fausses. Elle monte quand la
 * composition change, jamais quand un paramètre change.
 */
const VERSION = 1;

function cumuler(pages: readonly SignatureDePage[]): AncreSignature[] {
  const total = new Map<string, { occurrences: number; bandes: Set<number> }>();
  for (const page of pages) {
    for (const a of page.ancres) {
      const vu = total.get(a.cle);
      if (vu) {
        vu.occurrences += a.occurrences;
        for (const b of a.bandes) vu.bandes.add(b);
      } else {
        total.set(a.cle, { occurrences: a.occurrences, bandes: new Set(a.bandes) });
      }
    }
  }
  return [...total.entries()]
    .map(([cle, v]) => ({
      cle,
      occurrences: v.occurrences,
      bandes: [...v.bandes].sort((x, y) => x - y),
    }))
    .sort((x, y) => (x.cle < y.cle ? -1 : x.cle > y.cle ? 1 : 0));
}

/**
 * Signe un plan de jetons.
 *
 * Les pages sont prises dans l'ordre de leurs numéros, et renumérotées par
 * RANG : un plan qui commencerait à la page 3 signe comme un plan qui
 * commence à la page 1, puisque c'est la même forme.
 */
export function signerLePlan(
  tokens: readonly PageToken[],
  parametres: ParametresDeSignature,
): SignatureDeDocument {
  const numeros = [...new Set(tokens.map((t) => t.page))].sort((a, b) => a - b);

  const pages: SignatureDePage[] = numeros.map((numero, index) => {
    const deLaPage = tokens.filter((t) => t.page === numero);
    const sens = sensDominant(
      deLaPage.map((t) => t.text),
      parametres.partMinimaleDuSens,
    );
    const { ancres, placees } = ancresDeLaPage(
      deLaPage,
      parametres.longueurMinimaleDAncre,
      parametres.bandesParPage,
    );
    return {
      rang: index + 1,
      sens,
      ancres,
      relations: relationsEntreAncres(
        placees,
        ancres,
        sens === "rtl",
        parametres.recouvrementDeLigne,
        parametres.recouvrementDeColonne,
        parametres.ancresEnRelationMax,
      ),
      colonnes: colonnesDeLaPage(deLaPage, sens),
    };
  });

  const sansEmpreinte = {
    version: VERSION,
    sens: sensDominant(
      tokens.map((t) => t.text),
      parametres.partMinimaleDuSens,
    ),
    pages,
    ancres: cumuler(pages),
  };

  return {
    ...sansEmpreinte,
    empreinte: createHash("sha256").update(JSON.stringify(sansEmpreinte)).digest("hex"),
  };
}
