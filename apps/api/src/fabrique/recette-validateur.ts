/**
 * Le VALIDATEUR strict des recettes.
 *
 * ================================================================= POURQUOI
 *
 * Une recette remplace un appel de modèle. Elle hérite donc de toute la
 * confiance qu'on plaçait dans ce modèle, et d'aucun de ses garde-fous : rien
 * ne relit une désignation déterministe, puisqu'elle est déterministe.
 *
 * Un validateur qui ne refuse rien n'est pas un validateur. Celui-ci refuse
 * quatre familles de fautes, et chacune a son épreuve :
 *
 *   — un opérateur inconnu, ou une forme qui n'est pas celle du langage ;
 *   — une référence qui ne mène nulle part, ou qui tourne en rond ;
 *   — une recette calée sur des coordonnées, qu'un document photographié de
 *     biais invalide toutes — et c'est le cas ordinaire ici ;
 *   — une règle si large qu'elle désignerait n'importe quoi.
 *
 * ======================================================= CE QU'IL NE FAIT PAS
 *
 * Il n'exécute rien. Il ne voit aucune pièce, aucun plan de tokens, aucun
 * réseau. Il juge une donnée, et il termine toujours : le langage n'est pas
 * récursif, donc le parcours est fini par construction.
 *
 * Il ne juge donc pas non plus un CODE DE DROIT hors TVA : savoir si
 * `DROIT_TIMBRE` existe demande de lire `ref.fiscal_charges` au pack de
 * l'organisation et à la date de la pièce, c'est-à-dire tout ce que ce module
 * n'a pas. La chaîne le fait déjà, et au bon endroit : `computePivot` cherche
 * la règle du pack et bloque l'écriture par `MISSING_ACCOUNT_MAPPING` faute de
 * compte — pour un code venu d'une recette comme pour un code venu du modèle.
 * Un second juge ici serait une règle écrite deux fois, et c'est de là que
 * viennent les huit appariements muets de ce dépôt.
 *
 * ============================================== R4 — LES BORNES SONT PASSÉES
 *
 * Aucun seuil n'est écrit ici. `ExigencesDeValidation` vient de l'appelant,
 * qui la lit au référentiel, datée et surchargeable par cabinet (R10). Il n'y
 * a pas de valeur par défaut : un référentiel silencieusement absent
 * produirait un validateur silencieusement permissif, et c'est la pire forme
 * d'erreur.
 */
import { empruntAuVocabulaireReserve } from "@malica/socle/sens-de-la-piece";

import {
  CHAMPS_DE_LIGNE,
  CHAMPS_DE_PIECE,
  CHAMPS_D_ARTICLE,
  RecetteSchema,
  REFERENCES_QUI_TRANCHENT_LE_SENS,
  VERSIONS_LUES,
  type Champ,
  type Recette,
  type Selecteur,
} from "./recette.ts";

/* ================================================== CE QU'ON LUI DONNE === */

/**
 * Les bornes au-delà desquelles une recette n'est plus une description mais
 * un programme. Elles viennent du référentiel, jamais du code.
 */
export interface ExigencesDeValidation {
  /** En deçà, un texte d'ancre ne discrimine rien : « D » est sur toute la pièce. */
  readonly ancre_texte_min: number;
  /** Combien de sélecteurs au total — ancres, champs, colonnes réunis. */
  readonly selecteurs_max: number;
  /** Combien de champs désignés. */
  readonly champs_max: number;
  /** La plus longue plage de jetons qu'une recette peut recoller d'un coup. */
  readonly jetons_max: number;
  /** Le plus grand rang qu'un `nieme` peut viser. */
  readonly rang_max: number;
}

/* =================================================== CE QU'IL REND ======= */

/**
 * Les motifs de refus.
 *
 * Ce n'est PAS un second vocabulaire d'abstention : une recette refusée ici
 * ne s'exécutera jamais, donc elle ne lira jamais de pièce et ne peut pas
 * s'abstenir. L'abstention, qui arrive à l'exécution, reste dite en `ReadFlag`
 * et seulement en `ReadFlag`.
 */
export type MotifDeRefus =
  | "VERSION_INCONNUE"
  | "FORME_INVALIDE"
  | "CHAMP_INCONNU"
  | "REFERENCE_INTROUVABLE"
  | "REFERENCE_CIRCULAIRE"
  | "COORDONNEES_SEULES"
  | "SANS_ANCRE_TEXTUELLE"
  | "ANCRE_TROP_COURTE"
  | "ZONE_IMPOSSIBLE"
  | "BORNE_DEPASSEE"
  | "TAILLE_EXCESSIVE"
  | "DECLARATION_MORTE"
  | "REFERENCE_RESERVEE";

export interface Refus {
  readonly code: MotifDeRefus;
  /** Où, dans la recette. Un chemin, pour que la personne trouve sans chercher. */
  readonly ou: string;
  readonly detail: string;
}

export type Validation =
  | { readonly ok: true; readonly recette: Recette }
  | { readonly ok: false; readonly refus: readonly Refus[] };

/* ============================ LE VOCABULAIRE QUE LES LIBRES N'ONT PAS ==== */

/*
 * La règle qui refuse un nom libre empruntant au vocabulaire réservé vit dans
 * le Socle — `empruntAuVocabulaireReserve`, importée ci-dessus. Elle y est
 * pure et PARAMÉTRÉE (R1) : c'est l'appelant qui lui passe la liste réservée,
 * et c'est ce qui lui permet de servir ici ET à la relecture d'une réponse de
 * modèle, sans que le Socle sache quoi que ce soit du contrat d'extraction.
 *
 * Elle a vécu quelques heures en DEUX exemplaires — une copie privée ici, avec
 * ses propres `MOTS_RESERVES` et `SIGLES_RESERVES` — parce que deux agents
 * écrivaient en parallèle et qu'aucun n'avait le droit d'écrire chez l'autre.
 * Les deux corps étaient équivalents ; c'est précisément ce qui rend un
 * doublon dangereux, puisque rien n'aurait signalé qu'ils cessent de l'être.
 */

/* ================================================== LE PARCOURS ========= */

/** Les genres de motif qui s'appuient sur un texte imprimé sur la pièce. */
function motifTextuel(s: Selecteur): string | null {
  const d = s.depuis;
  if (d.genre !== "ancre") return null;
  return d.motif.genre === "forme" ? null : d.motif.texte;
}

/** Les ancres qu'un sélecteur NOMME, tous emplacements confondus. */
function ancresNommees(s: Selecteur): string[] {
  const noms: string[] = [];
  if (s.depuis.genre === "voisin") noms.push(s.depuis.de);
  for (const c of s.ou) {
    if (c.genre === "meme_ligne" || c.genre === "meme_colonne") noms.push(c.que);
  }
  return noms;
}

/**
 * Un sélecteur ne discrimine-t-il QUE par des coordonnées ?
 *
 * C'est le cas précis que le plan interdit : une zone est un rectangle en
 * fractions de page, et un document photographié de biais les déplace toutes.
 * Une page (« la dernière ») n'est pas une coordonnée — elle reste fausse si
 * elle est seule, mais pour une autre raison, et le refus doit le dire.
 */
function seulementCoordonnees(s: Selecteur): boolean {
  if (s.depuis.genre !== "ancre" || s.depuis.motif.genre !== "forme") return false;
  if (!s.ou.some((c) => c.genre === "zone")) return false;
  return s.ou.every((c) => c.genre === "zone" || c.genre === "page" || c.genre === "forme");
}

/* ================================================== LE VALIDATEUR ======= */

/**
 * Valider une recette sérialisée.
 *
 * Rend la recette typée, ou la liste COMPLÈTE des refus — pas le premier.
 * Une personne qui corrige une recette veut tout voir d'un coup ; livrer les
 * fautes une par une fait dix allers-retours et décourage la correction.
 */
export function validerRecette(brut: unknown, exigences: ExigencesDeValidation): Validation {
  const refus: Refus[] = [];

  /* ① La version, avant tout le reste : on ne juge pas une forme qu'on ne
     prétend pas savoir lire. */
  const versionBrute =
    typeof brut === "object" && brut !== null && "version" in brut
      ? (brut as { version: unknown }).version
      : undefined;
  if (typeof versionBrute !== "string" || !VERSIONS_LUES.includes(versionBrute as never)) {
    return {
      ok: false,
      refus: [
        {
          code: "VERSION_INCONNUE",
          ou: "version",
          detail:
            "version de langage non lue par ce dépôt : " +
            String(versionBrute) +
            " ; versions lues : " +
            VERSIONS_LUES.join(", "),
        },
      ],
    };
  }

  /* ② La forme. `.strict()` partout, enums partout : un opérateur inconnu, une
     clé en trop ou une valeur glissée à côté d'une désignation tombent ici. */
  const lu = RecetteSchema.safeParse(brut);
  if (!lu.success) {
    return {
      ok: false,
      refus: lu.error.issues.map((i) => ({
        code: "FORME_INVALIDE" as const,
        ou: i.path.join("."),
        detail: i.message,
      })),
    };
  }
  const r = lu.data;

  const ajouter = (code: MotifDeRefus, ou: string, detail: string) =>
    refus.push({ code, ou, detail });

  /* ③ Les zones : une fraction renversée ne décrit aucune surface. */
  for (const [nom, z] of Object.entries(r.zones)) {
    if (z.x1 <= z.x0 || z.y1 <= z.y0) {
      ajouter("ZONE_IMPOSSIBLE", "zones." + nom, "la zone est vide ou renversée");
    }
  }

  /* ④ Les champs désignés existent dans le contrat de désignation. */
  for (const nom of Object.keys(r.champs)) {
    if (!CHAMPS_DE_PIECE.includes(nom as never)) {
      ajouter(
        "CHAMP_INCONNU",
        "champs." + nom,
        "champ hors du contrat de désignation ; champs admis : " + CHAMPS_DE_PIECE.join(", "),
      );
    }
  }

  /* ⑤ Les références libres n'empruntent pas au vocabulaire réservé : un nom
     mal écrit désignerait juste et casserait le sens de la pièce en silence. */
  for (const nom of Object.keys(r.references)) {
    if (empruntAuVocabulaireReserve(nom, REFERENCES_QUI_TRANCHENT_LE_SENS)) {
      ajouter(
        "REFERENCE_RESERVEE",
        "references." + nom,
        "ce nom emprunte au vocabulaire qui tranche le sens de la pièce ; " +
          "désigne-le sous champs.references." +
          REFERENCES_QUI_TRANCHENT_LE_SENS.join(" / champs.references.") +
          ", ou choisis un nom étranger à ce vocabulaire",
      );
    }
  }

  /* ⑥ Les colonnes d'un tableau sont des colonnes de sa destination. */
  for (const [nomT, t] of Object.entries(r.tableaux)) {
    const admises: readonly string[] =
      t.destination === "lignes" ? CHAMPS_DE_LIGNE : CHAMPS_D_ARTICLE;
    if (Object.keys(t.colonnes).length === 0) {
      ajouter("FORME_INVALIDE", "tableaux." + nomT + ".colonnes", "un tableau sans colonne");
    }
    for (const nomC of Object.keys(t.colonnes)) {
      if (!admises.includes(nomC)) {
        ajouter(
          "CHAMP_INCONNU",
          "tableaux." + nomT + ".colonnes." + nomC,
          "colonne hors du contrat ; colonnes admises : " + admises.join(", "),
        );
      }
    }
  }

  /* ⑦ Les références : chaque nom cité est déclaré. On collecte en même temps
     ce qui est ATTEINT, pour repérer plus bas ce qui est mort. */
  const ancresVues = new Set<string>();
  const zonesVues = new Set<string>();

  const verifierSelecteur = (s: Selecteur, ou: string) => {
    for (const nom of ancresNommees(s)) {
      ancresVues.add(nom);
      if (!(nom in r.ancres)) {
        ajouter("REFERENCE_INTROUVABLE", ou, "ancre non déclarée : " + nom);
      }
    }
    if (s.depuis.genre === "cellule") {
      const t = r.tableaux[s.depuis.tableau];
      if (!t) {
        ajouter("REFERENCE_INTROUVABLE", ou, "tableau non déclaré : " + s.depuis.tableau);
      } else if (!(s.depuis.colonne in t.colonnes)) {
        ajouter("REFERENCE_INTROUVABLE", ou, "colonne non déclarée : " + s.depuis.colonne);
      }
    }
    for (const c of s.ou) {
      if (c.genre === "zone") {
        zonesVues.add(c.zone);
        if (!(c.zone in r.zones)) {
          ajouter("REFERENCE_INTROUVABLE", ou, "zone non déclarée : " + c.zone);
        }
      }
      if (c.genre === "page" && c.page === "numero" && c.numero === undefined) {
        ajouter("FORME_INVALIDE", ou, "page « numero » sans numéro");
      }
    }
    /* Les bornes arrêtées par le paramétrage. */
    if (s.prendre.genre === "nieme" && s.prendre.rang > exigences.rang_max) {
      ajouter("BORNE_DEPASSEE", ou + ".prendre", "rang au-delà de la borne du paramétrage");
    }
    if (s.etendre?.genre === "jetons" && s.etendre.nombre > exigences.jetons_max) {
      ajouter("BORNE_DEPASSEE", ou + ".etendre", "plage au-delà de la borne du paramétrage");
    }
  };

  for (const [nom, s] of Object.entries(r.ancres)) verifierSelecteur(s, "ancres." + nom);
  for (const [nom, c] of Object.entries(r.champs))
    verifierSelecteur(c.designation, "champs." + nom + ".designation");
  for (const [nom, c] of Object.entries(r.references))
    verifierSelecteur(c.designation, "references." + nom + ".designation");
  for (const [nom, d] of Object.entries(r.droits))
    verifierSelecteur(d.designation, "droits." + nom + ".designation");
  for (const [nomT, t] of Object.entries(r.tableaux)) {
    for (const nom of [t.entete, ...(t.fin === undefined ? [] : [t.fin])]) {
      ancresVues.add(nom);
      if (!(nom in r.ancres)) {
        ajouter("REFERENCE_INTROUVABLE", "tableaux." + nomT, "ancre non déclarée : " + nom);
      }
    }
    for (const [nomC, col] of Object.entries(t.colonnes)) {
      ancresVues.add(col.entete);
      if (!(col.entete in r.ancres)) {
        ajouter(
          "REFERENCE_INTROUVABLE",
          "tableaux." + nomT + ".colonnes." + nomC,
          "ancre d'en-tête non déclarée : " + col.entete,
        );
      }
      if (col.etendre?.genre === "jetons" && col.etendre.nombre > exigences.jetons_max) {
        ajouter(
          "BORNE_DEPASSEE",
          "tableaux." + nomT + ".colonnes." + nomC,
          "plage au-delà de la borne du paramétrage",
        );
      }
    }
  }

  /* ⑧ Le graphe des ancres est acyclique. Le langage n'est pas récursif, et
     cela se VÉRIFIE au lieu de se supposer : sans ce parcours, deux ancres qui
     se citent l'une l'autre feraient tourner l'interprète sans fin. */
  const etat = new Map<string, "en_cours" | "fini">();
  const descendre = (nom: string, chemin: readonly string[]): void => {
    if (etat.get(nom) === "fini") return;
    if (etat.get(nom) === "en_cours") {
      ajouter(
        "REFERENCE_CIRCULAIRE",
        "ancres." + nom,
        "cycle entre ancres : " + [...chemin, nom].join(" → "),
      );
      return;
    }
    const s = r.ancres[nom];
    if (!s) return;
    etat.set(nom, "en_cours");
    for (const suivant of ancresNommees(s)) descendre(suivant, [...chemin, nom]);
    etat.set(nom, "fini");
  };
  for (const nom of Object.keys(r.ancres)) descendre(nom, []);

  /* ⑨ L'ancrage textuel — la règle qui empêche une recette de désigner
     n'importe quoi. Tout champ doit, par sa chaîne d'ancres, remonter à un
     texte IMPRIMÉ sur la pièce. Une forme (« un nombre ») et une zone
     (« en haut à droite ») n'en sont pas : la première reconnaît une classe,
     la seconde une surface, et un document photographié de biais déplace la
     seconde sans prévenir. */
  const texteDeAncre = (nom: string, vus: ReadonlySet<string>): string[] => {
    if (vus.has(nom)) return [];
    const s = r.ancres[nom];
    if (!s) return [];
    const suite = new Set([...vus, nom]);
    const t = motifTextuel(s);
    const herite = ancresNommees(s).flatMap((n) => texteDeAncre(n, suite));
    return t === null ? herite : [t, ...herite];
  };

  const jugerAncrage = (s: Selecteur, ou: string) => {
    const propre = motifTextuel(s);
    const textes = [
      ...(propre === null ? [] : [propre]),
      ...ancresNommees(s).flatMap((n) => texteDeAncre(n, new Set())),
    ];
    if (textes.length === 0 && s.depuis.genre !== "cellule") {
      if (seulementCoordonnees(s)) {
        ajouter(
          "COORDONNEES_SEULES",
          ou,
          "ce champ n'est calé que sur une zone ou une page ; un document pris de biais les invalide",
        );
      } else {
        ajouter(
          "SANS_ANCRE_TEXTUELLE",
          ou,
          "aucun texte imprimé n'ancre ce champ : cette règle désignerait n'importe quoi",
        );
      }
    }
    for (const t of textes) {
      if ([...t.trim()].length < exigences.ancre_texte_min) {
        ajouter(
          "ANCRE_TROP_COURTE",
          ou,
          "texte d'ancre trop court pour discriminer : « " + t + " »",
        );
      }
    }
  };

  const jugerChamp = (c: Champ, ou: string) => jugerAncrage(c.designation, ou);
  for (const [nom, c] of Object.entries(r.champs)) jugerChamp(c, "champs." + nom + ".designation");
  for (const [nom, c] of Object.entries(r.references))
    jugerChamp(c, "references." + nom + ".designation");
  /*
   * Un DROIT s'ancre comme un champ, et il n'y a aucune raison qu'il s'en
   * dispense : un montant de timbre calé sur une seule zone — « en bas à
   * droite » — se déplace avec le cadrage, et ce qui se désignerait alors
   * serait le TTC. La même règle, le même refus.
   */
  for (const [nom, d] of Object.entries(r.droits))
    jugerAncrage(d.designation, "droits." + nom + ".designation");
  for (const [nomT, t] of Object.entries(r.tableaux)) {
    const ancre = r.ancres[t.entete];
    if (ancre) jugerAncrage(ancre, "tableaux." + nomT + ".entete");
  }

  /* ⑩ R9 dans la donnée : une ancre, une zone ou un tableau que rien n'atteint
     est du code mort, et il se supprime comme tel. */
  for (const nom of Object.keys(r.ancres)) {
    if (!ancresVues.has(nom)) {
      ajouter("DECLARATION_MORTE", "ancres." + nom, "ancre déclarée et jamais utilisée");
    }
  }
  for (const nom of Object.keys(r.zones)) {
    if (!zonesVues.has(nom)) {
      ajouter("DECLARATION_MORTE", "zones." + nom, "zone déclarée et jamais utilisée");
    }
  }

  /* ⑪ La taille. Une recette est une description ; passé un certain volume,
     c'est un programme déguisé, et il faut un autre outil pour le relire. */
  const selecteurs =
    Object.keys(r.ancres).length +
    Object.keys(r.champs).length +
    Object.keys(r.references).length +
    Object.keys(r.droits).length +
    Object.values(r.tableaux).reduce((n, t) => n + Object.keys(t.colonnes).length, 0);
  if (selecteurs > exigences.selecteurs_max) {
    ajouter("TAILLE_EXCESSIVE", "", "trop de sélecteurs : " + String(selecteurs));
  }
  const champs =
    Object.keys(r.champs).length + Object.keys(r.references).length + Object.keys(r.droits).length;
  if (champs > exigences.champs_max) {
    ajouter("TAILLE_EXCESSIVE", "champs", "trop de champs : " + String(champs));
  }

  return refus.length === 0 ? { ok: true, recette: r } : { ok: false, refus };
}
