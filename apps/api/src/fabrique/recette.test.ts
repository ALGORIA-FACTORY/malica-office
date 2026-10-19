import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { VisionArticle, VisionSelection } from "../malica/lecture/vision.ts";
import {
  CHAMPS_DE_LIGNE,
  CHAMPS_DE_PIECE,
  CHAMPS_DE_TOTAUX,
  REFERENCES_QUI_TRANCHENT_LE_SENS,
  CHAMPS_D_ARTICLE,
  CHAMPS_RACINE,
  CHOIX,
  CODES_D_ABSTENTION,
  CONTRAINTES,
  DESTINATIONS_DE_TABLEAU,
  DIRECTIONS,
  ETENDUES,
  FORMES,
  MOTIFS,
  PAGES,
  ROLES_DE_ZONE,
  SENS_DE_LECTURE,
  SOURCES,
  SYSTEMES_DE_CHIFFRES,
  VERSION_DU_LANGAGE,
  absent,
  designer,
  sAbstenir,
  type Motif,
  type ResultatDeChamp,
  type ResultatDeRecette,
  type Tableau,
  type VersionDuLangage,
  type Zone,
} from "./recette.ts";
import {
  validerRecette,
  type ExigencesDeValidation,
  type MotifDeRefus,
  type Refus,
} from "./recette-validateur.ts";

/**
 * Le langage des recettes — ses épreuves.
 *
 * ================================================================= POURQUOI
 *
 * Une recette est la description d'un lecteur spécialisé. Elle remplace un
 * appel de modèle sur les formats récurrents, donc elle hérite de toute la
 * confiance qu'on plaçait dans ce modèle — et d'aucun de ses garde-fous.
 *
 * Deux dangers, et les épreuves d'ici ne couvrent qu'eux :
 *
 * 1. Qu'une recette RENDE UNE VALEUR. Le 18 octobre 2026, une facture arabe
 *    est sortie valide à 650 000 D là où le papier portait 5 650 000 D, parce
 *    qu'un recollage écrit treize jours plus tôt n'était branché nulle part.
 *    Un second lecteur de montants referait la même amputation, et les
 *    équations la confirmeraient. Le contrat doit rendre cela IMPOSSIBLE, pas
 *    déconseillé : aucune branche du résultat ne porte de valeur.
 *
 * 2. Qu'une recette DÉSIGNE N'IMPORTE QUOI. Une règle sans ancre textuelle,
 *    ou calée sur des coordonnées fixes, désigne un token sur un document
 *    photographié de biais — un token faux, cité, donc crédible.
 *
 * Un validateur qui refuse tout est aussi faux qu'un validateur qui accepte
 * tout : la dernière section éprouve qu'une recette honnête passe.
 */

/* --------------------------------------------------------------- outillage */

/**
 * Les exigences ne sont PAS écrites ici : R4 interdit le seuil en TypeScript,
 * et le validateur n'en porte aucun par défaut. Ce sont les valeurs qu'un
 * paramétrage de cabinet arrêtera (R10) ; l'épreuve les fournit à la main,
 * exactement comme le fera l'appelant.
 */
const EXIGENCES: ExigencesDeValidation = {
  ancre_texte_min: 3,
  selecteurs_max: 200,
  champs_max: 50,
  jetons_max: 12,
  rang_max: 50,
};

/** Une recette honnête, minimale : une ancre textuelle, un champ, rien de mort. */
function recetteHonnete(): Record<string, unknown> {
  return {
    version: VERSION_DU_LANGAGE,
    sens_de_lecture: "ltr",
    chiffres: "latins",
    zones: {},
    ancres: {
      libelle_total: {
        depuis: { genre: "ancre", motif: { genre: "contient", texte: "Total TTC" } },
        ou: [],
        prendre: { genre: "dernier" },
      },
    },
    tableaux: {},
    champs: {
      "totals.ttc": {
        designation: {
          depuis: { genre: "voisin", de: "libelle_total", direction: "apres" },
          ou: [
            { genre: "meme_ligne", que: "libelle_total" },
            { genre: "forme", forme: "nombre" },
          ],
          prendre: { genre: "premier" },
        },
        facultatif: false,
        si_absent: "TOKEN_NOT_FOUND",
        si_ambigu: "TOKEN_NOT_FOUND",
      },
    },
    references: {},
  };
}

function refus(brut: Record<string, unknown>): MotifDeRefus[] {
  const v = validerRecette(brut, EXIGENCES);
  assert.equal(v.ok, false, "cette recette aurait dû être refusée");
  const liste: readonly Refus[] = v.ok ? [] : v.refus;
  // Chaque refus dit OÙ : une recette se corrige sans chercher.
  for (const r of liste) assert.equal(typeof r.ou, "string");
  return liste.map((r) => r.code);
}

/* ------------------------------------------- ① le langage est énumérable */

describe("le langage est énumérable — sinon il n'est pas validable", () => {
  it("chaque famille d'opérateurs est une liste close et sans doublon", () => {
    const familles = [
      MOTIFS,
      FORMES,
      SYSTEMES_DE_CHIFFRES,
      SENS_DE_LECTURE,
      DIRECTIONS,
      SOURCES,
      CONTRAINTES,
      PAGES,
      CHOIX,
      ETENDUES,
      ROLES_DE_ZONE,
      DESTINATIONS_DE_TABLEAU,
    ];
    for (const famille of familles) {
      assert.ok(famille.length > 0);
      assert.equal(new Set(famille).size, famille.length, `doublon dans ${famille.join(",")}`);
    }
  });

  it("aucune direction physique : « à gauche de » ne veut pas dire la même chose en arabe", () => {
    for (const interdit of ["gauche", "droite", "left", "right"]) {
      assert.ok(!DIRECTIONS.includes(interdit as never), `direction physique : ${interdit}`);
    }
    assert.deepEqual([...DIRECTIONS], ["avant", "apres", "dessus", "dessous"]);
    assert.deepEqual([...SENS_DE_LECTURE], ["ltr", "rtl"]);
  });

  it("les chiffres arabes sont dans le langage, pas dans une rustine", () => {
    assert.ok(SYSTEMES_DE_CHIFFRES.includes("arabes"));
    assert.ok(SYSTEMES_DE_CHIFFRES.includes("les_deux"));
  });
});

/* ------------------------- ② une recette ne peut pas produire de valeur */

describe("une recette produit une désignation, jamais une valeur", () => {
  it("le résultat d'un champ n'a que trois formes, et aucune ne porte de valeur", () => {
    const d = designer({ page: 1, ordinal: 42, ordinalEnd: 43 });
    const a = sAbstenir("TOKEN_NOT_FOUND", "deux candidats");
    const n = absent();
    assert.deepEqual(Object.keys(d), ["designe"]);
    assert.deepEqual(Object.keys(a), ["abstention", "detail"]);
    assert.deepEqual(Object.keys(n), ["absent"]);
    // La désignation n'est QUE page / ordinal / ordinalEnd : rien du texte.
    assert.deepEqual(Object.keys(d.designe), ["page", "ordinal", "ordinalEnd"]);
  });

  it("le motif d'abstention vient du vocabulaire FERMÉ de ReadFlag", () => {
    for (const code of CODES_D_ABSTENTION) {
      assert.equal(sAbstenir(code).abstention, code);
    }
    assert.ok(CODES_D_ABSTENTION.length > 0);
  });

  it("une recette qui écrit une valeur en dur est refusée", () => {
    const r = recetteHonnete();
    (r["champs"] as Record<string, unknown>)["totals.ttc"] = { valeur: "650,000" };
    assert.ok(refus(r).includes("FORME_INVALIDE"));
  });

  it("une recette qui glisse une valeur À CÔTÉ de la désignation est refusée", () => {
    const r = recetteHonnete();
    const champ = (r["champs"] as Record<string, Record<string, unknown>>)["totals.ttc"]!;
    champ["valeur_attendue"] = "650,000";
    assert.ok(refus(r).includes("FORME_INVALIDE"));
  });
});

/* --------------------------------------- ③ ce que le validateur refuse */

describe("le validateur refuse — un opérateur inconnu", () => {
  it("un genre de source qui n'existe pas", () => {
    const r = recetteHonnete();
    const champ = (r["champs"] as Record<string, Record<string, unknown>>)["totals.ttc"]!;
    champ["designation"] = {
      depuis: { genre: "regex", motif: ".*" },
      ou: [],
      prendre: { genre: "premier" },
    };
    assert.ok(refus(r).includes("FORME_INVALIDE"));
  });

  it("une contrainte qui n'existe pas", () => {
    const r = recetteHonnete();
    const champ = (r["champs"] as Record<string, Record<string, unknown>>)["totals.ttc"]!;
    (champ["designation"] as Record<string, unknown>)["ou"] = [{ genre: "eval", code: "1+1" }];
    assert.ok(refus(r).includes("FORME_INVALIDE"));
  });

  it("une version de langage inconnue — une recette d'un an doit encore se lire", () => {
    const r = recetteHonnete();
    r["version"] = "recette/42";
    assert.ok(refus(r).includes("VERSION_INCONNUE"));
    assert.equal(VERSION_DU_LANGAGE, "recette/1");
  });
});

describe("le validateur refuse — une référence invalide", () => {
  it("un champ qui n'existe pas dans le contrat de désignation", () => {
    const r = recetteHonnete();
    const champs = r["champs"] as Record<string, unknown>;
    champs["totals.timbre"] = champs["totals.ttc"];
    assert.ok(refus(r).includes("CHAMP_INCONNU"));
  });

  it("une ancre jamais déclarée", () => {
    const r = recetteHonnete();
    const champ = (r["champs"] as Record<string, Record<string, unknown>>)["totals.ttc"]!;
    (champ["designation"] as Record<string, Record<string, unknown>>)["depuis"]!["de"] =
      "libelle_jamais_declare";
    assert.ok(refus(r).includes("REFERENCE_INTROUVABLE"));
  });

  it("une colonne de tableau qui n'est pas un champ de ligne", () => {
    const r = recetteHonnete();
    r["tableaux"] = {
      corps: {
        destination: "lignes",
        entete: "libelle_total",
        colonnes: {
          remise_commerciale: { entete: "libelle_total", si_absent: "TOKEN_NOT_FOUND" },
        },
      },
    };
    assert.ok(refus(r).includes("CHAMP_INCONNU"));
  });

  it("un cycle entre ancres — le langage n'est pas récursif, et cela se vérifie", () => {
    const r = recetteHonnete();
    r["ancres"] = {
      a: {
        depuis: { genre: "voisin", de: "b", direction: "apres" },
        ou: [],
        prendre: { genre: "premier" },
      },
      b: {
        depuis: { genre: "voisin", de: "a", direction: "avant" },
        ou: [],
        prendre: { genre: "premier" },
      },
      libelle_total: {
        depuis: { genre: "ancre", motif: { genre: "contient", texte: "Total TTC" } },
        ou: [],
        prendre: { genre: "dernier" },
      },
    };
    assert.ok(refus(r).includes("REFERENCE_CIRCULAIRE"));
  });
});

describe("le validateur refuse — une recette purement coordonnées", () => {
  it("un champ calé sur une zone et rien d'autre", () => {
    const r = recetteHonnete();
    r["zones"] = { haut_droite: { role: "en_tete", x0: 0.6, y0: 0, x1: 1, y1: 0.2 } };
    r["ancres"] = {};
    r["champs"] = {
      document_date: {
        designation: {
          depuis: { genre: "ancre", motif: { genre: "forme", forme: "date" } },
          ou: [{ genre: "zone", zone: "haut_droite" }],
          prendre: { genre: "premier" },
        },
        facultatif: false,
        si_absent: "DATE_UNREADABLE",
        si_ambigu: "DATE_UNREADABLE",
      },
    };
    assert.ok(refus(r).includes("COORDONNEES_SEULES"));
  });

  it("une zone dont les fractions sont impossibles", () => {
    const r = recetteHonnete();
    r["zones"] = { renversee: { role: "pied", x0: 0.9, y0: 0.1, x1: 0.2, y1: 0.05 } };
    assert.ok(refus(r).includes("ZONE_IMPOSSIBLE"));
  });
});

describe("le validateur refuse — une règle qui désignerait n'importe quoi", () => {
  it("un champ sans aucune ancre textuelle dans sa chaîne", () => {
    const r = recetteHonnete();
    r["ancres"] = {};
    r["champs"] = {
      "totals.ttc": {
        designation: {
          depuis: { genre: "ancre", motif: { genre: "forme", forme: "nombre" } },
          ou: [{ genre: "page", page: "derniere" }],
          prendre: { genre: "premier" },
        },
        facultatif: false,
        si_absent: "TOKEN_NOT_FOUND",
        si_ambigu: "TOKEN_NOT_FOUND",
      },
    };
    assert.ok(refus(r).includes("SANS_ANCRE_TEXTUELLE"));
  });

  it("une ancre textuelle trop courte pour discriminer", () => {
    const r = recetteHonnete();
    const ancres = r["ancres"] as Record<string, Record<string, unknown>>;
    (ancres["libelle_total"]!["depuis"] as Record<string, Record<string, unknown>>)["motif"] = {
      genre: "contient",
      texte: "D",
    };
    assert.ok(refus(r).includes("ANCRE_TROP_COURTE"));
  });

  it("un rang ou une étendue hors des bornes arrêtées par le paramétrage", () => {
    const r = recetteHonnete();
    const champ = (r["champs"] as Record<string, Record<string, unknown>>)["totals.ttc"]!;
    (champ["designation"] as Record<string, unknown>)["prendre"] = {
      genre: "nieme",
      rang: EXIGENCES.rang_max + 1,
    };
    (champ["designation"] as Record<string, unknown>)["etendre"] = {
      genre: "jetons",
      nombre: EXIGENCES.jetons_max + 1,
    };
    const codes = refus(r);
    assert.equal(codes.filter((c) => c === "BORNE_DEPASSEE").length, 2);
  });

  it("une déclaration morte — R9 vaut aussi pour la donnée", () => {
    const r = recetteHonnete();
    (r["zones"] as Record<string, unknown>)["jamais_utilisee"] = {
      role: "pied",
      x0: 0,
      y0: 0.9,
      x1: 1,
      y1: 1,
    };
    assert.ok(refus(r).includes("DECLARATION_MORTE"));
  });
});

/* ------------------------------------ ④ et il accepte une recette honnête */

describe("le validateur accepte — sinon il ne vaut rien", () => {
  it("la recette minimale honnête passe, et ressort telle quelle", () => {
    const v = validerRecette(recetteHonnete(), EXIGENCES);
    assert.ok(v.ok, v.ok ? "" : JSON.stringify(v.refus));
    assert.equal(v.recette.version, VERSION_DU_LANGAGE);
    assert.equal(Object.keys(v.recette.champs).length, 1);
  });

  it("une facture arabe : sens rtl, chiffres arabes, champ facultatif, ancre répétée", () => {
    const r = recetteHonnete();
    r["sens_de_lecture"] = "rtl";
    r["chiffres"] = "les_deux";
    const ancres = r["ancres"] as Record<string, unknown>;
    // La même ancre apparaît plusieurs fois sur la pièce : on prend la dernière.
    ancres["mention_tva"] = {
      depuis: { genre: "ancre", motif: { genre: "contient", texte: "الأداء", chiffres: "arabes" } },
      ou: [],
      prendre: { genre: "nieme", rang: 2 },
    };
    const champs = r["champs"] as Record<string, unknown>;
    champs["totals.vat"] = {
      designation: {
        depuis: { genre: "voisin", de: "mention_tva", direction: "apres", sens: "rtl" },
        ou: [{ genre: "meme_ligne", que: "mention_tva" }],
        prendre: { genre: "premier" },
      },
      facultatif: true,
      si_absent: "MISSING_CITATION",
      si_ambigu: "TOKEN_NOT_FOUND",
    };
    const v = validerRecette(r, EXIGENCES);
    assert.ok(v.ok, v.ok ? "" : JSON.stringify(v.refus));
    assert.equal(v.recette.sens_de_lecture, "rtl");
    assert.equal(v.recette.champs["totals.vat"]?.facultatif, true);
  });

  it("un tableau réparti sur plusieurs pages, avec en-tête répété et pied", () => {
    const r = recetteHonnete();
    const ancres = r["ancres"] as Record<string, unknown>;
    ancres["entete_designation"] = {
      depuis: { genre: "ancre", motif: { genre: "exact", texte: "Désignation" } },
      ou: [],
      prendre: { genre: "premier" },
    };
    ancres["entete_montant"] = {
      depuis: { genre: "ancre", motif: { genre: "commence", texte: "Montant" } },
      ou: [],
      prendre: { genre: "premier" },
    };
    r["tableaux"] = {
      articles: {
        destination: "articles",
        entete: "entete_designation",
        fin: "libelle_total",
        pages: "toutes",
        entete_repete: true,
        continue_sur_pages_suivantes: true,
        colonnes: {
          designation: { entete: "entete_designation", si_absent: "TOKEN_NOT_FOUND" },
          total_ht: {
            entete: "entete_montant",
            si_absent: "TOKEN_NOT_FOUND",
            etendre: { genre: "jusqu_a_fin_de_ligne" },
          },
        },
      },
    };
    const v = validerRecette(r, EXIGENCES);
    assert.ok(v.ok, v.ok ? "" : JSON.stringify(v.refus));
    assert.equal(v.recette.tableaux["articles"]?.continue_sur_pages_suivantes, true);
  });
});

/* -------------- ⑤ le contrat ne peut pas dériver de la chaîne existante */

/** Sous-ensemble non distributif : échoue à la compilation, pas à l'exécution. */
type Sous<A extends string, B extends string> = [A] extends [B] ? true : never;

describe("les champs désignables sont ceux de la chaîne, et tsc le vérifie", () => {
  it("les champs racine sont des clés de VisionSelection", () => {
    const preuve: Sous<(typeof CHAMPS_RACINE)[number], keyof VisionSelection & string> = true;
    assert.equal(preuve, true);
  });

  it("les totaux sont des clés de VisionSelection.totals", () => {
    const preuve: Sous<
      (typeof CHAMPS_DE_TOTAUX)[number],
      keyof NonNullable<VisionSelection["totals"]> & string
    > = true;
    assert.equal(preuve, true);
  });

  it("les colonnes de ligne et d'article sont celles de la chaîne", () => {
    const ligne: Sous<
      (typeof CHAMPS_DE_LIGNE)[number],
      keyof VisionSelection["lines"][number] & string
    > = true;
    const article: Sous<(typeof CHAMPS_D_ARTICLE)[number], keyof VisionArticle & string> = true;
    assert.equal(ligne, true);
    assert.equal(article, true);
  });

  it("CHAMPS_DE_PIECE est racine ∪ totaux ∪ les références qui tranchent le sens", () => {
    assert.deepEqual(
      [...CHAMPS_DE_PIECE],
      [
        ...CHAMPS_RACINE,
        ...CHAMPS_DE_TOTAUX.map((c) => "totals." + c),
        ...REFERENCES_QUI_TRANCHENT_LE_SENS.map((c) => "references." + c),
      ],
    );
  });
});

/* ------- ⑦ un nom de référence ne casse plus le SENS de la pièce */

/**
 * Le défaut trouvé en branchant la recette dans la chaîne, le 19 octobre 2026.
 *
 * `read-piece.ts` déduit le sens de la pièce — achat ou vente — de
 * `references["matricule_fiscal"]` et `references["matricule_fiscal_client"]`.
 * Ces deux noms sont IMPOSÉS au modèle par l'invite du désignateur, et ils
 * n'étaient imposés à personne du côté recette : le langage acceptait
 * n'importe quel nom sous `references`.
 *
 * Une recette qui écrivait « mf » désignait le BON jeton, le citait
 * correctement, et la pièce sortait « sens à confirmer » — une lecture juste,
 * et un achat qui ne sait pas qu'il en est un, sans qu'aucun drapeau
 * n'explique pourquoi. C'est la cinquième fois dans ce dépôt qu'un nom
 * composé librement casse un appariement muet, et le symptôme est toujours le
 * même : ça marche, et une mesure disparaît.
 */
describe("un nom de référence ne casse plus le sens de la pièce", () => {
  /** Pose une référence libre portant ce nom, sur une recette par ailleurs juste. */
  function sousLeNom(nom: string): Record<string, unknown> {
    const r = recetteHonnete();
    (r["references"] as Record<string, unknown>)[nom] = {
      designation: {
        depuis: { genre: "voisin", de: "libelle_total", direction: "apres" },
        ou: [{ genre: "meme_ligne", que: "libelle_total" }],
        prendre: { genre: "premier" },
      },
      facultatif: false,
      si_absent: "TOKEN_NOT_FOUND",
      si_ambigu: "TOKEN_NOT_FOUND",
    };
    return r;
  }

  it("le nom réservé lui-même ne peut plus être une référence libre", () => {
    for (const nom of REFERENCES_QUI_TRANCHENT_LE_SENS) {
      assert.ok(refus(sousLeNom(nom)).includes("REFERENCE_RESERVEE"), nom);
    }
  });

  it("le sigle et les variantes sont refusés — c'est le cas mesuré par le branchement", () => {
    for (const nom of [
      "mf",
      "mfc",
      "matricule",
      "fiscal",
      "matricule_client",
      "mf_client",
      "matricule_fiscal_du_client",
    ]) {
      assert.ok(refus(sousLeNom(nom)).includes("REFERENCE_RESERVEE"), nom);
    }
  });

  it("sous le nom du CONTRAT, la même désignation passe", () => {
    const r = recetteHonnete();
    (r["champs"] as Record<string, unknown>)["references.matricule_fiscal"] = {
      designation: {
        depuis: { genre: "voisin", de: "libelle_total", direction: "apres" },
        ou: [{ genre: "meme_ligne", que: "libelle_total" }],
        prendre: { genre: "premier" },
      },
      facultatif: false,
      si_absent: "TOKEN_NOT_FOUND",
      si_ambigu: "TOKEN_NOT_FOUND",
    };
    const v = validerRecette(r, EXIGENCES);
    assert.ok(v.ok, v.ok ? "" : JSON.stringify(v.refus));
  });

  it("et il reste des références libres — sinon la fermeture serait un mur", () => {
    for (const nom of [
      "bon_de_commande",
      "numero_de_marche",
      "numero_de_piece",
      "numero_client",
      "code_chantier",
    ]) {
      const v = validerRecette(sousLeNom(nom), EXIGENCES);
      assert.ok(v.ok, nom + " : " + (v.ok ? "" : JSON.stringify(v.refus)));
    }
  });
});

/* ------------------- ⑥ le contrat public se tient tout seul */

describe("le contrat public — ce que l'interprète recevra", () => {
  it("un résultat de recette s'écrit, et aucune de ses branches ne porte de valeur", () => {
    const champs: Record<string, ResultatDeChamp> = {
      issuer: designer({ page: 1, ordinal: 3, ordinalEnd: 5 }),
      "totals.ttc": sAbstenir("TOKEN_NOT_FOUND", "l'ancre n'est pas sur la pièce"),
      document_date: absent(),
    };
    const version: VersionDuLangage = VERSION_DU_LANGAGE;
    const resultat: ResultatDeRecette = { version, champs, lignes: [], articles: [] };
    assert.equal(resultat.version, VERSION_DU_LANGAGE);
    const clefs = new Set(Object.values(resultat.champs).flatMap((c) => Object.keys(c)));
    assert.deepEqual([...clefs].sort(), ["absent", "abstention", "designe", "detail"]);
  });

  it("les types publics décrivent bien la forme sérialisée", () => {
    const motif: Motif = { genre: "contient", texte: "Facture" };
    const zone: Zone = { role: "en_tete", x0: 0, y0: 0, x1: 1, y1: 0.2 };
    const tableau: Tableau = {
      destination: "lignes",
      entete: "entete_tva",
      pages: "toutes",
      entete_repete: false,
      continue_sur_pages_suivantes: false,
      colonnes: {
        base_ht: { entete: "entete_tva", facultatif: false, si_absent: "TOKEN_NOT_FOUND" },
      },
    };
    assert.equal(motif.genre, "contient");
    assert.equal(zone.role, "en_tete");
    assert.equal(tableau.destination, "lignes");
  });
});
