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
