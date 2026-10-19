/**
 * Des recettes SYNTHÉTIQUES, écrites à la main pour les bancs — et rien d'autre.
 *
 * ================================================================= POURQUOI
 *
 * Le générateur de recettes (tâche 7) n'existe pas encore, et l'interprète ne
 * peut pas attendre d'en avoir un pour être éprouvé : c'est lui qui dira si
 * le langage tient. Ces recettes sont donc écrites à la main, contre les
 * plans synthétiques de `signature-plans-synthetiques.ts`, et elles sont
 * déclarées synthétiques pour qu'aucune mesure ne les prenne pour des
 * recettes produites.
 *
 * Elles passent toutes par `validerRecette` dans le banc : une recette de
 * banc qui ne serait pas valide n'éprouverait rien de ce que le produit
 * exécutera.
 *
 * Aucun appel de modèle, aucun fournisseur payant.
 */
import { VERSION_DU_LANGAGE } from "./recette.ts";

/**
 * La recette du format français de référence (`FACTURE_A`).
 *
 * Elle est écrite comme une vraie : des ancres textuelles, des voisinages le
 * long de l'axe de lecture, des contraintes de forme, un tableau borné par
 * deux ancres. Aucune coordonnée n'y figure seule — le validateur refuserait.
 */
export const RECETTE_FACTURE_A: unknown = {
  version: VERSION_DU_LANGAGE,
  sens_de_lecture: "ltr",
  chiffres: "latins",
  ancres: {
    titre: {
      depuis: { genre: "ancre", motif: { genre: "exact", texte: "FACTURE" } },
      prendre: { genre: "premier" },
    },
    etiquette_date: {
      depuis: { genre: "ancre", motif: { genre: "exact", texte: "Date" } },
      prendre: { genre: "unique" },
    },
    etiquette_numero: {
      depuis: { genre: "ancre", motif: { genre: "exact", texte: "Numero" } },
      prendre: { genre: "unique" },
    },
    etiquette_ht: {
      depuis: { genre: "ancre", motif: { genre: "exact", texte: "HT" } },
      prendre: { genre: "unique" },
    },
    etiquette_tva: {
      depuis: { genre: "ancre", motif: { genre: "exact", texte: "TVA" } },
      prendre: { genre: "unique" },
    },
    etiquette_ttc: {
      depuis: { genre: "ancre", motif: { genre: "exact", texte: "TTC" } },
      prendre: { genre: "unique" },
    },
    entete_designation: {
      depuis: { genre: "ancre", motif: { genre: "exact", texte: "Designation" } },
      prendre: { genre: "premier" },
    },
    entete_quantite: {
      depuis: { genre: "ancre", motif: { genre: "exact", texte: "Qte" } },
      prendre: { genre: "premier" },
    },
    entete_prix: {
      depuis: { genre: "ancre", motif: { genre: "exact", texte: "P.U.HT" } },
      prendre: { genre: "premier" },
    },
    entete_total: {
      depuis: { genre: "ancre", motif: { genre: "exact", texte: "Total" } },
      prendre: { genre: "premier" },
    },
  },
  champs: {
    issuer: {
      designation: {
        depuis: { genre: "voisin", de: "titre", direction: "avant" },
        prendre: { genre: "premier" },
      },
      si_absent: "MISSING_CITATION",
      si_ambigu: "DESIGNATION_AMBIGUE",
    },
    document_date: {
      designation: {
        depuis: { genre: "voisin", de: "etiquette_date", direction: "apres" },
        ou: [{ genre: "forme", forme: "date" }],
        prendre: { genre: "unique" },
      },
      si_absent: "DATE_UNREADABLE",
      si_ambigu: "DESIGNATION_AMBIGUE",
    },
    "totals.base_ht": {
      designation: {
        depuis: { genre: "voisin", de: "etiquette_ht", direction: "apres" },
        ou: [{ genre: "forme", forme: "nombre" }],
        prendre: { genre: "unique" },
      },
      si_absent: "TOKEN_NOT_FOUND",
      si_ambigu: "DESIGNATION_AMBIGUE",
    },
    "totals.vat": {
      designation: {
        depuis: { genre: "voisin", de: "etiquette_tva", direction: "apres" },
        ou: [{ genre: "forme", forme: "nombre" }],
        prendre: { genre: "unique" },
      },
      si_absent: "TOKEN_NOT_FOUND",
      si_ambigu: "DESIGNATION_AMBIGUE",
    },
    "totals.ttc": {
      designation: {
        depuis: { genre: "voisin", de: "etiquette_ttc", direction: "apres" },
        ou: [{ genre: "forme", forme: "nombre" }],
        prendre: { genre: "unique" },
      },
      si_absent: "TOKEN_NOT_FOUND",
      si_ambigu: "DESIGNATION_AMBIGUE",
    },
  },
  references: {
    numero_de_piece: {
      designation: {
        depuis: { genre: "voisin", de: "etiquette_numero", direction: "apres" },
        prendre: { genre: "unique" },
      },
      si_absent: "TOKEN_NOT_FOUND",
      si_ambigu: "DESIGNATION_AMBIGUE",
    },
  },
  tableaux: {
    articles: {
      destination: "articles",
      entete: "entete_designation",
      fin: "etiquette_ht",
      colonnes: {
        designation: { entete: "entete_designation", si_absent: "TOKEN_NOT_FOUND" },
        quantity: { entete: "entete_quantite", si_absent: "TOKEN_NOT_FOUND" },
        unit_price_ht: { entete: "entete_prix", si_absent: "TOKEN_NOT_FOUND" },
        total_ht: { entete: "entete_total", si_absent: "TOKEN_NOT_FOUND" },
      },
    },
  },
};

/**
 * La recette de la facture tunisienne ORDINAIRE (`FACTURE_A_TIMBRE`).
 *
 * ============================================ CE QU'ELLE ÉPROUVE, ET POURQUOI
 *
 * Elle est `RECETTE_FACTURE_A`, plus un droit hors TVA. C'est la seule
 * différence, et c'est celle qui décide de l'intérêt de la fabrique : « sur une
 * facture à timbre — c'est-à-dire la plupart en Tunisie — le contrat sortait
 * PARTIEL et la chaîne reprenait la main » (limite n° 1 du 19 octobre 2026).
 *
 * ================================================ LE CODE N'EST PAS UN TEXTE LU
 *
 * `code: "DROIT_TIMBRE"` est le code que `ref.fiscal_charges` porte depuis le
 * 26 août 2026, avec son compte et sa date d'effet. La recette le NOMME ; elle
 * ne le lit pas sur la pièce, et elle ne le définit pas. C'est le même geste
 * que le modèle désignateur, à qui l'invite donne « les codes de droits hors
 * TVA autorisés » et qui en choisit un (`vision.ts`). Un code étranger au pack
 * est refusé en aval, par `MISSING_ACCOUNT_MAPPING` — « aucun compte au pack
 * pour le droit » —, exactement comme un code venu du modèle.
 *
 * Le MONTANT, lui, est désigné : la règle n° 1 ne bouge pas.
 */
const BASE_A = RECETTE_FACTURE_A as Record<string, unknown> & {
  ancres: Record<string, unknown>;
};

export const RECETTE_FACTURE_A_TIMBRE: unknown = {
  ...BASE_A,
  ancres: {
    ...BASE_A.ancres,
    etiquette_timbre: {
      depuis: { genre: "ancre", motif: { genre: "exact", texte: "timbre" } },
      prendre: { genre: "unique" },
    },
    etiquette_matricule: {
      depuis: { genre: "ancre", motif: { genre: "exact", texte: "Matricule" } },
      prendre: { genre: "unique" },
    },
    entete_taux: {
      depuis: { genre: "ancre", motif: { genre: "exact", texte: "Taux" } },
      prendre: { genre: "unique" },
    },
    entete_base: {
      depuis: { genre: "ancre", motif: { genre: "exact", texte: "BaseHT" } },
      prendre: { genre: "unique" },
    },
    entete_taxe: {
      depuis: { genre: "ancre", motif: { genre: "exact", texte: "Taxe" } },
      prendre: { genre: "unique" },
    },
    entete_total_ttc: {
      depuis: { genre: "ancre", motif: { genre: "exact", texte: "TotalTTC" } },
      prendre: { genre: "unique" },
    },
  },
  tableaux: {
    /*
     * LE TABLEAU D'ARTICLES SE REFERME PLUS HAUT.
     *
     * `RECETTE_FACTURE_A` le bornait par l'étiquette « HT » du pied, parce que
     * rien ne s'imprimait entre les deux. Le récapitulatif par taux s'y
     * imprime désormais, et sa ligne tombe dans la colonne « Designation » :
     * le tableau d'articles y verrait une ligne de plus, sans quantité, donc
     * une ABSTENTION — et toute la recette rendrait la main. Le tableau se
     * referme donc sur l'en-tête du récapitulatif.
     */
    articles: {
      ...(BASE_A["tableaux"] as { articles: Record<string, unknown> }).articles,
      fin: "entete_taux",
    },
    /*
     * LES LIGNES PAR TAUX — ce que `extract.v1` exige (`lines` min 1).
     *
     * `label` n'est pas désigné : le récapitulatif n'imprime pas de libellé,
     * et la chaîne pose « Ligne » plutôt qu'un texte inventé.
     *
     * Le CODE DE TAUX, lui, est NOMMÉ — `code_de_taux` — et il ne figure plus
     * parmi les colonnes. C'était le dernier endroit où le banc était plus
     * facile que le réel : il imprimait « TVA19 » pour que la désignation
     * rende un code valide, et son commentaire le disait. Le plan imprime
     * maintenant « 19% », ce qu'imprime une facture, et le code vient du
     * référentiel.
     */
    lignes_par_taux: {
      destination: "lignes",
      entete: "entete_taux",
      fin: "etiquette_ht",
      code_de_taux: "TVA19",
      colonnes: {
        base_ht: { entete: "entete_base", si_absent: "TOKEN_NOT_FOUND" },
        vat_amount: { entete: "entete_taxe", si_absent: "TOKEN_NOT_FOUND" },
        ttc: { entete: "entete_total_ttc", si_absent: "TOKEN_NOT_FOUND" },
      },
    },
  },
  champs: {
    ...(BASE_A["champs"] as Record<string, unknown>),
    /*
     * LE MATRICULE, ET POURQUOI IL EST ICI PLUTÔT QU'EN RÉFÉRENCE LIBRE.
     *
     * Sans lui, `document_kind` reste `null`, et `extract.v1` n'a pas d'énuméré
     * pour `null` : le contrat ne PARSE pas, et « complet » serait une opinion.
     * Il est désigné sous le nom du contrat — `references.matricule_fiscal`,
     * pris à `REFERENCES_QUI_TRANCHENT_LE_SENS` — parce que c'est ce nom-là,
     * et aucun autre, que `read-piece.ts` relit pour trancher achat/vente.
     * Sous « mf », la lecture serait juste et le sens perdu (mesuré le
     * 19 octobre, et le banc du branchement le fige).
     */
    "references.matricule_fiscal": {
      designation: {
        depuis: { genre: "voisin", de: "etiquette_matricule", direction: "apres" },
        ou: [{ genre: "forme", forme: "identifiant" }],
        prendre: { genre: "unique" },
      },
      si_absent: "TOKEN_NOT_FOUND",
      si_ambigu: "DESIGNATION_AMBIGUE",
    },
  },
  droits: {
    timbre: {
      code: "DROIT_TIMBRE",
      designation: {
        depuis: { genre: "voisin", de: "etiquette_timbre", direction: "apres" },
        ou: [{ genre: "forme", forme: "nombre" }],
        prendre: { genre: "unique" },
      },
      si_absent: "TOKEN_NOT_FOUND",
      si_ambigu: "DESIGNATION_AMBIGUE",
    },
  },
};

/**
 * La recette de la facture arabe (`FACTURE_ARABE`).
 *
 * Elle existe pour le point que le langage a tranché exprès : « avant » et
 * « après » sont LOGIQUES, le long de l'axe de lecture. En arabe, le libellé
 * est à DROITE de ce qu'il qualifie, et la même recette écrite avec « à
 * gauche » aurait désigné le vide.
 *
 * `issuer` y est FACULTATIF : cette pièce ne porte pas de nom d'émetteur, et
 * un champ facultatif absent est une information, pas un trou à combler.
 */
export const RECETTE_FACTURE_ARABE: unknown = {
  version: VERSION_DU_LANGAGE,
  sens_de_lecture: "rtl",
  chiffres: "les_deux",
  ancres: {
    etiquette_date: {
      depuis: { genre: "ancre", motif: { genre: "exact", texte: "التاريخ" } },
      prendre: { genre: "unique" },
    },
    etiquette_total: {
      depuis: { genre: "ancre", motif: { genre: "exact", texte: "المجموع" } },
      prendre: { genre: "dernier" },
    },
    etiquette_taxe: {
      depuis: { genre: "ancre", motif: { genre: "exact", texte: "الأداء" } },
      prendre: { genre: "unique" },
    },
    etiquette_emetteur: {
      depuis: { genre: "ancre", motif: { genre: "exact", texte: "المزود" } },
      prendre: { genre: "unique" },
    },
  },
  champs: {
    issuer: {
      designation: {
        depuis: { genre: "voisin", de: "etiquette_emetteur", direction: "apres" },
        prendre: { genre: "premier" },
      },
      facultatif: true,
      si_absent: "MISSING_CITATION",
      si_ambigu: "DESIGNATION_AMBIGUE",
    },
    document_date: {
      designation: {
        depuis: { genre: "voisin", de: "etiquette_date", direction: "apres" },
        ou: [{ genre: "forme", forme: "date" }],
        prendre: { genre: "unique" },
      },
      si_absent: "DATE_UNREADABLE",
      si_ambigu: "DESIGNATION_AMBIGUE",
    },
    "totals.ttc": {
      designation: {
        depuis: { genre: "voisin", de: "etiquette_total", direction: "apres" },
        ou: [{ genre: "forme", forme: "nombre" }],
        prendre: { genre: "unique" },
      },
      si_absent: "TOKEN_NOT_FOUND",
      si_ambigu: "DESIGNATION_AMBIGUE",
    },
    "totals.vat": {
      designation: {
        depuis: { genre: "voisin", de: "etiquette_taxe", direction: "apres" },
        ou: [{ genre: "forme", forme: "nombre" }],
        prendre: { genre: "unique" },
      },
      si_absent: "TOKEN_NOT_FOUND",
      si_ambigu: "DESIGNATION_AMBIGUE",
    },
  },
};
