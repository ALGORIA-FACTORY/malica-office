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
 * Et `lines[].label` / `lines[].tax_code` sont des TEXTES dans
 * `VisionSelection` : les remplir ici voudrait dire LIRE, ce que l'interprète
 * ne fait pas. Ils sortent donc désignés, et c'est la relecture partagée du
 * plan — celle qui passe par `recollerLesMilliers` — qui en tire le texte.
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

/** Une ligne de TVA désignée : chaque colonne est une référence ou rien. */
type LigneDesignee = Readonly<Record<(typeof CHAMPS_DE_LIGNE)[number], TokenRef | null>>;

/** Un article désigné. `tax_code` reste une désignation, jamais un code lu. */
type ArticleDesigne = Readonly<Record<(typeof CHAMPS_D_ARTICLE)[number], TokenRef | null>>;

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

  const lines = resultat.lignes.map(
    (l, i) => ligneDesignee(CHAMPS_DE_LIGNE, l, i, "lines", flags) as unknown as LigneDesignee,
  );
  const articles = resultat.articles.map(
    (a, i) => ligneDesignee(CHAMPS_D_ARTICLE, a, i, "articles", flags) as unknown as ArticleDesigne,
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
      references,
    },
    flags,
    sAbstient: flags.length > 0,
  };
}
