/**
 * Ce que l'interprète rend à la chaîne — module pur.
 *
 * ================================================================= POURQUOI
 *
 * Le branchement (tâche 5) remplace un appel de modèle par un appel de
 * recette. Pour que « rien ne change en aval », il faut que l'interprète
 * rende la MÊME chose que le désignateur : des `page` / `ordinal`, aux mêmes
 * noms de champs, et des drapeaux pris au vocabulaire fermé de `ReadFlag`.
 *
 * ===================================== POURQUOI PAS UN `VisionSelection` ENTIER
 *
 * Parce qu'une recette ne peut pas le remplir, et qu'un objet à moitié
 * rempli par un défaut inventé est très exactement ce que R4 appelle un repli
 * implicite. Trois champs de `VisionSelection` ne sont PAS des désignations :
 *
 *   `document_kind`      se déduit de la position du matricule du dossier ;
 *   `currency`           vient du dossier quand la pièce ne l'imprime pas ;
 *   `overall_confidence` est un score, et un score non calibré ne s'affiche
 *                        jamais comme une probabilité de justesse.
 *
 * Et `lines[].label` est un TEXTE dans `VisionSelection` : le remplir ici
 * voudrait dire LIRE, ce que l'interprète ne fait pas. Il sort donc désigné, et
 * c'est la relecture partagée du plan — celle qui passe par
 * `recollerLesMilliers` — qui en tire le texte.
 *
 * `lines[].tax_code` est un texte lui aussi, et il ne sort PAS désigné : il
 * sort nommé. La pièce n'imprime pas un code, elle imprime un taux, et un taux
 * relu est un code que le pack ne connaît pas — l'écriture bloquait sur
 * `MISSING_TAX_RATE`. Le tableau le NOMME depuis `ref.tva_rates`, comme le
 * modèle le nomme déjà dans `vision.ts`.
 *
 * Ce module rend donc le SOUS-ENSEMBLE désignable, et le type est vérifié
 * contre `VisionSelection` par le compilateur dans le banc : le jour où la
 * chaîne renomme un champ, l'épreuve ne compile plus.
 */
import type { ReadFlag, TokenRef } from "@malica/socle/ports/malica";

import {
  CHAMPS_DE_LIGNE,
  CHAMPS_D_ARTICLE,
  type ResultatDeChamp,
  type ResultatDeRecette,
} from "./recette.ts";

/**
 * Une ligne de TVA désignée : chaque colonne est une référence ou rien, et le
 * code de taux est une CHAÎNE NOMMÉE.
 *
 * C'est la seule place de ce module où une chaîne apparaît à côté de
 * références, et elle ne vient pas de la pièce : le tableau l'a déclarée, et
 * il la tient de `ref.tva_rates`. La désigner — l'état d'avant — revenait à
 * produire le code que la pièce imprime, c'est-à-dire « 19 % », inconnu du
 * pack et bloquant à l'écriture.
 */
type LigneDesignee = Readonly<Record<(typeof CHAMPS_DE_LIGNE)[number], TokenRef | null>> & {
  readonly tax_code: string | null;
};

/** Un article désigné. Son code de taux est nommé, lui aussi. */
type ArticleDesigne = Readonly<Record<(typeof CHAMPS_D_ARTICLE)[number], TokenRef | null>> & {
  readonly tax_code: string | null;
};

/**
 * Un droit hors TVA désigné, à la forme que `VisionSelection.other_charges`
 * attend : un code, et une référence de jeton.
 *
 * Le code est la SEULE chaîne de caractères que ce module laisse passer, et
 * elle ne vient pas de la pièce : elle vient de la recette, qui la tient du
 * référentiel. Le montant n'est pas là — il est pointé, et la chaîne partagée
 * le relira dans le plan.
 */
interface ChargeDesignee {
  readonly code: string;
  readonly amount: TokenRef | null;
}

/**
 * Ce qu'une recette désigne d'une pièce.
 *
 * Les noms sont ceux de `VisionSelection`, à la lettre. Ce qui n'y figure pas
 * n'est pas désignable — voir l'en-tête.
 */
export interface DesignationDeRecette {
  readonly issuer: TokenRef | null;
  readonly document_date: TokenRef | null;
  readonly totals: {
    readonly base_ht: TokenRef | null;
    readonly vat: TokenRef | null;
    readonly ttc: TokenRef | null;
  };
  readonly lines: readonly LigneDesignee[];
  readonly articles: readonly ArticleDesigne[];
  readonly other_charges: readonly ChargeDesignee[];
  readonly references: Readonly<Record<string, TokenRef | null>>;
}

export interface SortieDeRecette {
  readonly designation: DesignationDeRecette;
  /** Les abstentions, dites une fois chacune, au vocabulaire fermé de `ReadFlag`. */
  readonly flags: readonly ReadFlag[];
  /**
   * Y a-t-il au moins une abstention ?
   *
   * L'appelant s'en sert pour rendre la main ; il n'a pas à parcourir les
   * champs pour le savoir, et il ne peut donc pas oublier un cas.
   */
  readonly sAbstient: boolean;
}

const PREFIXE_DE_REFERENCE = "references.";

function refDe(resultat: ResultatDeChamp | undefined): TokenRef | null {
  return resultat && "designe" in resultat ? resultat.designe : null;
}

function drapeau(champ: string, resultat: ResultatDeChamp | undefined): ReadFlag | null {
  if (!resultat || !("abstention" in resultat)) return null;
  return {
    field: champ,
    code: resultat.abstention,
    ...(resultat.detail === undefined ? {} : { detail: resultat.detail }),
  };
}

function ligneDesignee<C extends readonly string[]>(
  colonnes: C,
  brut: Readonly<Record<string, ResultatDeChamp>>,
  rang: number,
  prefixe: string,
  flags: ReadFlag[],
): Record<string, TokenRef | null> {
  const sortie: Record<string, TokenRef | null> = {};
  for (const colonne of colonnes) {
    sortie[colonne] = refDe(brut[colonne]);
    const f = drapeau(`${prefixe}[${String(rang)}].${colonne}`, brut[colonne]);
    if (f) flags.push(f);
  }
  return sortie;
}

/**
 * Traduit un résultat de recette en désignation, et en drapeaux.
 *
 * Un champ ABSENT ne produit ni référence ni drapeau : la pièce ne le porte
 * pas, et c'est une information, pas un trou à combler. Un champ ABSTENU
 * produit un drapeau et aucune référence — la main revient à la chaîne avec
 * son motif inscrit, ce qui est exactement ce que le produit sait déjà faire
 * d'un champ non désigné.
 */
export function sortieDeRecette(resultat: ResultatDeRecette): SortieDeRecette {
  const flags: ReadFlag[] = [];
  const champs = resultat.champs;

  for (const [nom, valeur] of Object.entries(champs)) {
    const f = drapeau(nom, valeur);
    if (f) flags.push(f);
  }

  const references: Record<string, TokenRef | null> = {};
  for (const [nom, valeur] of Object.entries(champs)) {
    if (!nom.startsWith(PREFIXE_DE_REFERENCE)) continue;
    references[nom.slice(PREFIXE_DE_REFERENCE.length)] = refDe(valeur);
  }

  /*
   * LES DROITS HORS TVA.
   *
   * Un droit ABSENT — facultatif, et la pièce ne le porte pas — ne produit
   * aucune entrée : `other_charges` vide est ce que le modèle rend lui aussi
   * sur une pièce sans timbre, et une entrée à montant nul entrerait dans
   * l'équation du pied comme un zéro qu'aucun jeton ne porte.
   *
   * Un droit ABSTENU produit un drapeau et aucune entrée. Le nom du drapeau
   * est celui de la chaîne — `other_charges[<rang>].amount`, la clé sous
   * laquelle `read-piece.ts` relève, cite et contrôle un droit —, pour que le
   * motif se lise à l'écran au lieu de nommer une recette que personne ne
   * regarde. C'est le même geste que pour `lines[i].*` juste en dessous.
   *
   * Le rang est celui de la DÉCLARATION, pas celui de la sortie : un droit
   * abstenu en deuxième position ne renumérote pas le premier, et le drapeau
   * désigne bien le droit qui a manqué.
   */
  const other_charges: ChargeDesignee[] = [];
  resultat.droits.forEach((droit, rang) => {
    const f = drapeau(`other_charges[${String(rang)}].amount`, droit.resultat);
    if (f) flags.push(f);
    const amount = refDe(droit.resultat);
    if (amount) other_charges.push({ code: droit.code, amount });
  });

  const lines = resultat.lignes.map(
    (l, i) =>
      ({
        ...ligneDesignee(CHAMPS_DE_LIGNE, l, i, "lines", flags),
        tax_code: resultat.codesDeTaux.lignes[i] ?? null,
      }) as unknown as LigneDesignee,
  );
  const articles = resultat.articles.map(
    (a, i) =>
      ({
        ...ligneDesignee(CHAMPS_D_ARTICLE, a, i, "articles", flags),
        tax_code: resultat.codesDeTaux.articles[i] ?? null,
      }) as unknown as ArticleDesigne,
  );

  return {
    designation: {
      issuer: refDe(champs["issuer"]),
      document_date: refDe(champs["document_date"]),
      totals: {
        base_ht: refDe(champs["totals.base_ht"]),
        vat: refDe(champs["totals.vat"]),
        ttc: refDe(champs["totals.ttc"]),
      },
      lines,
      articles,
      other_charges,
      references,
    },
    flags,
    sAbstient: flags.length > 0,
  };
}
