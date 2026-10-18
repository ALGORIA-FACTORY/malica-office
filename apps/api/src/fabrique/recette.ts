/**
 * Le LANGAGE des recettes — le contrat, et rien d'autre.
 *
 * ================================================================= POURQUOI
 *
 * Un format documentaire suffisamment éprouvé doit devenir un lecteur
 * spécialisé, pour que Malica cesse d'appeler un modèle distant sur les
 * documents récurrents. Une recette est la DESCRIPTION de ce lecteur.
 *
 * ========================================== LA RÈGLE QUI DÉCIDE DE TOUT ICI
 *
 * Une recette produit une DÉSIGNATION, jamais une valeur.
 *
 * Son résultat a la même forme que ce que le modèle désignateur renvoie : des
 * `page` / `ordinal`, éventuellement un `ordinalEnd`. Tout ce qui suit — le
 * recollage des milliers, la relecture du plan, la normalisation, la citation,
 * les contrôles — est PARTAGÉ avec la chaîne existante et ne se duplique pas.
 *
 * La raison tient en un chiffre : le 18 octobre 2026, une facture arabe est
 * sortie `extract.v1` VALIDE à 650 000 D là où le papier portait 5 650 000 D,
 * parce qu'une fonction de recollage écrite treize jours plus tôt n'était
 * branchée nulle part. Un second lecteur de montants referait la même
 * amputation, sur les trois totaux à la fois — et les équations la
 * confirmeraient, puisqu'une amputation systématique boucle.
 *
 * C'est pour cela que `ResultatDeChamp`, plus bas, n'a AUCUNE branche portant
 * un texte lu, un nombre ou une date. Ce n'est pas une consigne : c'est le
 * type. Un interprète qui voudrait rendre une valeur n'aurait pas où l'écrire.
 *
 * ====================================================== CE QU'ELLE N'EST PAS
 *
 * Une recette n'est pas du code. Pas d'expression à évaluer, pas de rappel de
 * fonction, pas d'expression régulière, pas de chaîne qu'on `eval`. Chaque
 * opérateur est pris dans une liste CLOSE, énumérée ici, et le langage n'est
 * pas récursif : un sélecteur ne contient jamais un sélecteur, il NOMME une
 * ancre déclarée à part. La validation termine donc toujours, et le graphe des
 * noms s'éprouve par un parcours, pas par un pari.
 *
 * ============================================== R4 — AUCUN SEUIL ICI DEDANS
 *
 * Aucun nom de format, aucun libellé réglementaire, aucun taux, aucun seuil
 * n'est écrit dans ce fichier. Les textes d'ancre sont de la DONNÉE, portée
 * par la recette ; les bornes du validateur lui sont PASSÉES par l'appelant,
 * qui les lit au référentiel (R10).
 */
import { z } from "zod";

import type { ReadFlag, TokenRef } from "@malica/socle/ports/malica";

/* ======================================================= LA VERSION ======= */

/**
 * La version du langage, écrite dans chaque recette sous la clé `version`.
 *
 * Une recette écrite aujourd'hui doit encore se lire dans un an. Elle porte
 * donc la version du langage qui l'a écrite, et le validateur refuse ce qu'il
 * ne sait pas lire au lieu d'en deviner le sens — un opérateur mal interprété
 * désigne un autre token, et un autre token cité reste crédible.
 */
export const VERSION_DU_LANGAGE = "recette/1";
export type VersionDuLangage = typeof VERSION_DU_LANGAGE;

/** Les versions que ce module sait lire. Une seule aujourd'hui ; la liste grandit. */
export const VERSIONS_LUES = [VERSION_DU_LANGAGE] as const;

/* ============================================ LES OPÉRATEURS, UN PAR UN === */

/**
 * Comment un texte se reconnaît.
 *
 * `exact`, `commence` et `contient` prennent un texte — celui que la pièce
 * IMPRIME, donc de la donnée. `forme` prend une classe de forme, et ne
 * reconnaît aucun texte en particulier : une recette qui ne s'appuie que sur
 * `forme` désignerait n'importe quoi, et le validateur la refuse.
 *
 * Il n'y a pas d'expression régulière, et c'est délibéré : une expression
 * régulière est un programme, donc ni énumérable, ni bornée en temps.
 */
export const MOTIFS = ["exact", "commence", "contient", "forme"] as const;

/** Les classes de forme — ce qu'un token EST, sans dire ce qu'il vaut. */
export const FORMES = ["nombre", "date", "pourcentage", "identifiant", "mot"] as const;

/**
 * Les systèmes de chiffres admis à la reconnaissance.
 *
 * Une facture tunisienne en arabe imprime ses montants en chiffres
 * arabo-indiens (٠-٩, et parfois ۰-۹). Les ignorer revient à ne pas voir ses
 * nombres ; les convertir ici reviendrait à LIRE, ce que la recette ne fait
 * pas. Le langage dit seulement lesquels comptent comme chiffres.
 */
export const SYSTEMES_DE_CHIFFRES = ["latins", "arabes", "les_deux"] as const;

/** Le sens de lecture, qui donne leur sens aux directions. */
export const SENS_DE_LECTURE = ["ltr", "rtl"] as const;

/**
 * Les directions, et pourquoi aucune ne s'appelle « gauche ».
 *
 * En arabe, « à gauche de l'étiquette » ne désigne pas ce qu'il désigne en
 * français : c'est l'AMONT dans un cas, l'AVAL dans l'autre. Une recette qui
 * pourrait écrire « gauche » porterait l'ambiguïté jusqu'à l'interprète, où
 * elle se tranche en silence. Les directions sont donc LOGIQUES, le long de
 * l'axe de lecture, et le sens est déclaré — par la recette, ou par le
 * sélecteur quand une page mélange les deux écritures.
 */
export const DIRECTIONS = ["avant", "apres", "dessus", "dessous"] as const;

/** D'où viennent les candidats d'un sélecteur. */
export const SOURCES = ["ancre", "voisin", "cellule"] as const;

/** Ce qui restreint les candidats. Toutes les contraintes se cumulent (ET). */
export const CONTRAINTES = ["forme", "zone", "meme_ligne", "meme_colonne", "page"] as const;

/** La pagination : sur quelles pages un sélecteur ou un tableau porte. */
export const PAGES = ["premiere", "derniere", "toutes", "numero"] as const;

/** Lequel des candidats restants. `unique` s'abstient dès qu'il y en a deux. */
export const CHOIX = ["premier", "dernier", "unique", "nieme"] as const;

/**
 * Jusqu'où étendre la plage — ce qui produit `ordinalEnd`.
 *
 * « DREAM OPTIC SARL » est trois tokens contigus ; la chaîne sait déjà les
 * concaténer sans compléter un mot absent. On ne fait que désigner la plage.
 */
export const ETENDUES = ["jusqu_a_fin_de_ligne", "jusqu_a", "jetons"] as const;

/** Les rôles d'une zone de page. */
export const ROLES_DE_ZONE = ["en_tete", "corps", "pied"] as const;

/** Ce qu'un tableau alimente dans la désignation. */
export const DESTINATIONS_DE_TABLEAU = ["lignes", "articles"] as const;

/* =================================== LE VOCABULAIRE DE L'ABSTENTION ======= */

/**
 * Les motifs d'abstention qu'une recette a le droit d'invoquer.
 *
 * Ils sont PRIS dans `ReadFlag`, dont l'ensemble de codes est fermé. On n'en
 * ouvre pas un second : deux vocabulaires d'erreur dans un produit, c'est un
 * vocabulaire qu'on finit par ne plus lire. Le sous-ensemble se limite à ce
 * qu'une recette peut constater AVANT toute lecture de valeur — elle ne lit
 * pas, donc elle ne peut rien dire d'un nombre ou d'une équation.
 *
 * `satisfies` en fait une vérification du compilateur : ajouter ici un code
 * qui n'existe pas dans `ReadFlag` ne compile pas.
 */
export const CODES_D_ABSTENTION = [
  "MISSING_CITATION",
  "TOKEN_NOT_FOUND",
  "DATE_UNREADABLE",
] as const satisfies ReadonlyArray<ReadFlag["code"]>;

export type CodeDAbstention = (typeof CODES_D_ABSTENTION)[number];

/* ============================= LES CHAMPS QU'UNE RECETTE PEUT DÉSIGNER === */

/**
 * Le contrat de désignation — exactement les champs de `VisionSelection` qui
 * sont des références de token, et rien de plus.
 *
 * Ce qui n'y figure pas n'y figure pas par décision : `document_kind` se
 * déduit de la position du matricule du dossier, `currency` vient du dossier
 * quand la pièce ne l'imprime pas, `overall_confidence` est un score. Aucun
 * des trois n'est une désignation, donc aucun n'est exprimable par une
 * recette.
 *
 * Les épreuves vérifient par tsc que ces noms sont bien des clés de la chaîne
 * existante : le jour où elle en renomme un, la compilation le dit.
 */
export const CHAMPS_RACINE = ["issuer", "document_date"] as const;
export const CHAMPS_DE_TOTAUX = ["base_ht", "vat", "ttc"] as const;
export const CHAMPS_DE_PIECE = [
  "issuer",
  "document_date",
  "totals.base_ht",
  "totals.vat",
  "totals.ttc",
] as const;

/** Les colonnes admises d'un tableau de lignes de TVA. */
export const CHAMPS_DE_LIGNE = ["label", "tax_code", "base_ht", "vat_amount", "ttc"] as const;

/** Les colonnes admises d'un tableau d'articles. */
export const CHAMPS_D_ARTICLE = [
  "designation",
  "quantity",
  "unit_price_ht",
  "unit_price_ttc",
  "total_ht",
  "tax_code",
] as const;

/* ============================================ LA FORME SÉRIALISÉE ======== */

/**
 * Un nom déclaré dans la recette : ancre, zone, tableau, colonne.
 *
 * Restreint à l'ASCII minuscule pour une raison de sécurité ordinaire : deux
 * noms qui se RESSEMBLENT sans être égaux font référence à deux choses
 * différentes, et personne ne le voit en relisant. Le texte cherché sur la
 * pièce, lui, n'est pas restreint — c'est de l'arabe la moitié du temps.
 */
const NomSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/);

const FractionSchema = z.number().min(0).max(1);

const MotifTexteSchema = <G extends (typeof MOTIFS)[number]>(genre: G) =>
  z
    .object({
      genre: z.literal(genre),
      texte: z.string().min(1).max(200),
      chiffres: z.enum(SYSTEMES_DE_CHIFFRES).optional(),
    })
    .strict();

const MotifSchema = z.discriminatedUnion("genre", [
  MotifTexteSchema("exact"),
  MotifTexteSchema("commence"),
  MotifTexteSchema("contient"),
  z
    .object({
      genre: z.literal("forme"),
      forme: z.enum(FORMES),
      chiffres: z.enum(SYSTEMES_DE_CHIFFRES).optional(),
    })
    .strict(),
]);

const SourceSchema = z.discriminatedUnion("genre", [
  z.object({ genre: z.literal("ancre"), motif: MotifSchema }).strict(),
  z
    .object({
      genre: z.literal("voisin"),
      /** Le NOM d'une ancre déclarée — jamais un sélecteur imbriqué. */
      de: NomSchema,
      direction: z.enum(DIRECTIONS),
      /** Le sens, quand il diffère de celui de la recette (page mixte). */
      sens: z.enum(SENS_DE_LECTURE).optional(),
      /** Une borne de proximité en fraction de page, pas une position. */
      ecart_max: FractionSchema.optional(),
    })
    .strict(),
  z.object({ genre: z.literal("cellule"), tableau: NomSchema, colonne: NomSchema }).strict(),
]);

const ContrainteSchema = z.discriminatedUnion("genre", [
  z.object({ genre: z.literal("forme"), forme: z.enum(FORMES) }).strict(),
  z.object({ genre: z.literal("zone"), zone: NomSchema }).strict(),
  z.object({ genre: z.literal("meme_ligne"), que: NomSchema }).strict(),
  z.object({ genre: z.literal("meme_colonne"), que: NomSchema }).strict(),
  z
    .object({
      genre: z.literal("page"),
      page: z.enum(PAGES),
      numero: z.number().int().min(1).optional(),
    })
    .strict(),
]);

const ChoixSchema = z.discriminatedUnion("genre", [
  z.object({ genre: z.literal("premier") }).strict(),
  z.object({ genre: z.literal("dernier") }).strict(),
  z.object({ genre: z.literal("unique") }).strict(),
  z.object({ genre: z.literal("nieme"), rang: z.number().int().min(1) }).strict(),
]);

const EtendueSchema = z.discriminatedUnion("genre", [
  z.object({ genre: z.literal("jusqu_a_fin_de_ligne") }).strict(),
  z.object({ genre: z.literal("jusqu_a"), motif: MotifSchema }).strict(),
  z.object({ genre: z.literal("jetons"), nombre: z.number().int().min(1) }).strict(),
]);

const SelecteurSchema = z
  .object({
    depuis: SourceSchema,
    /** Les contraintes se cumulent. Pas de OU, pas de NON : le langage reste décidable. */
    ou: z.array(ContrainteSchema).default([]),
    prendre: ChoixSchema,
    etendre: EtendueSchema.optional(),
  })
  .strict();

const ZoneSchema = z
  .object({
    role: z.enum(ROLES_DE_ZONE),
    x0: FractionSchema,
    y0: FractionSchema,
    x1: FractionSchema,
    y1: FractionSchema,
  })
  .strict();

/**
 * Un champ : une désignation, et ce qu'on dit quand elle ne tient pas.
 *
 * `facultatif` sépare les deux interdits du plan. Un champ facultatif absent
 * est une information — la pièce ne le porte pas — et ne produit rien. Un
 * champ attendu qui manque produit une ABSTENTION, avec son motif. Dans les
 * deux cas, aucune valeur n'est inventée, et la main revient à la chaîne.
 */
const ChampSchema = z
  .object({
    designation: SelecteurSchema,
    facultatif: z.boolean().default(false),
    si_absent: z.enum(CODES_D_ABSTENTION),
    si_ambigu: z.enum(CODES_D_ABSTENTION),
  })
  .strict();

/**
 * Une colonne de tableau. La cellule se déduit de la géométrie — l'abscisse de
 * l'en-tête croisée avec l'ordonnée de la ligne — donc elle n'a pas besoin
 * d'un sélecteur à elle.
 */
const ColonneSchema = z
  .object({
    entete: NomSchema,
    facultatif: z.boolean().default(false),
    si_absent: z.enum(CODES_D_ABSTENTION),
    etendre: EtendueSchema.optional(),
  })
  .strict();

const TableauSchema = z
  .object({
    destination: z.enum(DESTINATIONS_DE_TABLEAU),
    /** L'ancre qui ouvre le tableau — la ligne d'en-tête. */
    entete: NomSchema,
    /** L'ancre qui le clôt. Sans elle, le tableau court jusqu'au bas de page. */
    fin: NomSchema.optional(),
    pages: z.enum(PAGES).default("toutes"),
    /** L'en-tête est réimprimé en haut de chaque page. */
    entete_repete: z.boolean().default(false),
    /** Le tableau reprend page suivante sans que la première se close. */
    continue_sur_pages_suivantes: z.boolean().default(false),
    colonnes: z.record(z.string(), ColonneSchema),
  })
  .strict();

/**
 * La recette elle-même.
 *
 * Les clés de `champs` ne sont pas typées par le schéma, et c'est voulu : un
 * champ inconnu doit produire un REFUS nommé, lisible par la personne qui
 * écrit la recette, et non un message de forme invalide.
 */
export const RecetteSchema = z
  .object({
    /**
     * La version du LANGAGE, pas celle de la recette.
     *
     * Le rang d'une recette et son libellé vivent déjà sur la ligne
     * (`fabrique.recette_versions.rang`, `fabrique.recettes.libelle`) : les
     * réécrire ici en ferait deux vérités qui dérivent. La définition ne porte
     * donc que le langage, et la base l'exige — `definition ? 'version'`.
     */
    version: z.literal(VERSION_DU_LANGAGE),
    sens_de_lecture: z.enum(SENS_DE_LECTURE),
    chiffres: z.enum(SYSTEMES_DE_CHIFFRES),
    zones: z.record(NomSchema, ZoneSchema).default({}),
    ancres: z.record(NomSchema, SelecteurSchema).default({}),
    tableaux: z.record(NomSchema, TableauSchema).default({}),
    champs: z.record(z.string(), ChampSchema).default({}),
    /** Les références libres de la pièce (bon de commande, marché…), par nom. */
    references: z.record(NomSchema, ChampSchema).default({}),
  })
  .strict();

/* ================================================ LES TYPES DU CONTRAT === */

export type Motif = z.infer<typeof MotifSchema>;
export type Selecteur = z.infer<typeof SelecteurSchema>;
export type Zone = z.infer<typeof ZoneSchema>;
export type Champ = z.infer<typeof ChampSchema>;
export type Tableau = z.infer<typeof TableauSchema>;

/**
 * Le type ET le schéma sont la même définition : le second est dérivé du
 * premier par `z.infer`. Ils ne peuvent donc pas diverger — c'est la forme la
 * plus courte de R9 appliquée à un contrat.
 */
export type Recette = z.infer<typeof RecetteSchema>;

/* ===================================== CE QU'UNE RECETTE PEUT PRODUIRE === */

/**
 * Le résultat d'un champ — trois formes, et aucune ne porte de valeur.
 *
 * Il n'existe ni `valeur`, ni `texte`, ni `montant`, ni `date` dans ce type.
 * C'est la garantie de la règle ① du plan, rendue structurelle : un interprète
 * qui voudrait lire un montant lui-même n'aurait aucun endroit où l'écrire, et
 * le compilateur le lui dirait. La valeur se relit dans le plan de tokens, par
 * la chaîne existante, après `recollerLesMilliers`.
 */
export type ResultatDeChamp =
  | { readonly designe: TokenRef }
  | { readonly abstention: CodeDAbstention; readonly detail: string | undefined }
  | { readonly absent: true };

/** Ce qu'un interprète rend pour une pièce entière. */
export interface ResultatDeRecette {
  readonly version: VersionDuLangage;
  readonly champs: Readonly<Record<string, ResultatDeChamp>>;
  readonly lignes: ReadonlyArray<Readonly<Record<string, ResultatDeChamp>>>;
  readonly articles: ReadonlyArray<Readonly<Record<string, ResultatDeChamp>>>;
}

/** Désigner : la seule façon de rendre quelque chose de positif. */
export function designer(ref: TokenRef): { readonly designe: TokenRef } {
  return {
    designe: {
      page: ref.page,
      ordinal: ref.ordinal,
      // `exactOptionalPropertyTypes` : une plage absente ne s'ecrit pas
      // `undefined`, elle ne s'ecrit pas du tout.
      ...(ref.ordinalEnd === undefined ? {} : { ordinalEnd: ref.ordinalEnd }),
    },
  };
}

/** S'abstenir, avec son motif pris au vocabulaire fermé de `ReadFlag`. */
export function sAbstenir(
  code: CodeDAbstention,
  detail?: string,
): { readonly abstention: CodeDAbstention; readonly detail: string | undefined } {
  return { abstention: code, detail };
}

/** Le champ n'est pas sur la pièce, et c'était prévu : rien n'est inventé. */
export function absent(): { readonly absent: true } {
  return { absent: true };
}
