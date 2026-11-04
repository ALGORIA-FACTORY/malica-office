/**
 * LE SUDOKU, BRANCHÉ — la désignation des montants par la preuve.
 *
 * ================================================================ CE QU'IL FAIT
 *
 * Les nombres d'une facture se désignent eux-mêmes : parmi toutes les
 * affectations des montants lus aux champs de la grille, celle qui ferme
 * l'arithmétique de la pièce (HT + TVA + droits = TTC, base × taux = TVA par
 * taux, droit fixe du pack…) est la lecture. Une seule : elle est PROUVÉE et
 * elle remplace la désignation des montants. Aucune ou plusieurs : rien ne
 * change, et la pièce garde la désignation du modèle avec ses contrôles.
 *
 * Contrat : `docs/sudoku/contrat-du-moteur.md`. Moteur : `@malica/sudoku`.
 *
 * ========================================================= CE QU'IL NE FAIT PAS
 *
 * - Il ne LIT aucun montant (règle ① de la fabrique). Les lectures viennent du
 *   treillis existant (`treillisMontant`) et des dates de `normalizeDate` ; il
 *   rend des désignations (page, ordinal), et l'aval de R2 relit les valeurs
 *   dans le plan, exactement comme pour le modèle et la recette.
 * - Il ne porte aucune constante réglementaire (R4) : la grille, ses preuves,
 *   les taux, les droits et les formats viennent de la base, par le pack.
 * - Il ne tranche ni l'émetteur, ni la date, ni le sens de la pièce : ce ne
 *   sont pas des montants, aucune arithmétique ne les prouve. Ils restent
 *   désignés par la chaîne existante.
 * - Il ne choisit pas encore le TYPE de document : la lecture citée lit des
 *   factures (contrat extract.v1), donc la grille « facture ». Le routage
 *   par type viendra avec les preuves des autres familles, banc par banc.
 *
 * ============================================================ SANS RÉGRESSION
 *
 * Un sudoku qui échoue — moteur absent, grille illisible, plafond atteint — ne
 * prive personne de sa lecture : il crie dans le journal et rend la lecture
 * telle qu'il l'a reçue. La seule décision de repli est vers le chemin éprouvé.
 */

import { lettreDeControle, normaliserMatricule } from "@malica/socle/matricule";
import type { DeviseLue } from "@malica/socle/montant-imprime";
import { depuisUniteMineure } from "@malica/socle/somme-decimale";
import {
  resoudre,
  type Cite,
  type Connus,
  type EntreeDuSudoku,
  type Grille,
  type JetonDuSudoku,
  type PackDuSudoku,
  type RefDeJeton,
  type SortieDuSudoku,
} from "@malica/sudoku";

import type { AppelApi } from "../appel-local.ts";
import type { Requete } from "../../db.ts";
import { dateDeLaPiece } from "../../depots/dates.ts";
import type { ReglagesResolus } from "../../scan/reglages-comptables.ts";

import type { VerdictDuSudoku } from "./etapes-de-lecture.ts";
import { cleDeJeton, datesDuPlan, identifiantsDuPlan, lettresDuPlan } from "./experts.ts";
import { treillisMontant } from "./montants.ts";
import { lireLesReglesDeLecture, type ReglesDeLecture } from "./regles-de-lecture.ts";
import {
  resolveFromTokenPlan,
  type ConventionDeDate,
  type PageToken,
  type TokenRef,
} from "./token-plan.ts";
import type { VisionRead, VisionSelection } from "./vision.ts";

/** La grille de la lecture citée : elle lit des factures (voir l'en-tête). */
export const GRILLE_DE_LA_LECTURE_CITEE = "facture";

/* ================================================ LES RÔLES DES CHAMPS (§2) = */

/** Un nom de champ d'une expression, sans son « ? » de champ facultatif. */
function nomDuChamp(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v.replace(/\?$/u, "") : null;
}

/** L'expression d'une preuve, lue comme un objet (le moteur en a vérifié la forme). */
function expressionDe(p: Grille["preuves"][number]): Readonly<Record<string, unknown>> {
  return p.expression !== null && typeof p.expression === "object"
    ? (p.expression as Record<string, unknown>)
    : {};
}

/**
 * Les champs que la sélection de la chaîne connaît, DÉDUITS des preuves de la
 * grille — aucun code de champ n'est écrit ici :
 *
 *   - `groupe_taux` : la base et le montant par taux, et le total des bases (le HT) ;
 *   - `somme` au rôle `ttc` : le TTC que la chaîne reçoit, variante par variante
 *     (le net à payer, quand le TTC est imprimé avant le timbre) ;
 *   - `lignes` : la cellule de chaque colonne du tableau, par la clé du moteur.
 */
export interface ChampsDeLaGrille {
  readonly ht: string | null;
  readonly base: string | null;
  readonly tva: string | null;
  readonly ttc: readonly { readonly variante: string | null; readonly champ: string }[];
  /** Le champ du montant en lettres (preuve `lettres`), s'il y en a une. */
  readonly lettres: string | null;
  /** Clé de la sortie du moteur (`quantite`, `prix`…) → code du champ de la grille. */
  readonly lignes: Readonly<Record<string, string>>;
}

export function champsDeLaGrille(grille: Grille): ChampsDeLaGrille {
  const preuves = grille.preuves.map((p) => ({ p, e: expressionDe(p) }));
  const groupe = preuves.find((x) => x.e["op"] === "groupe_taux")?.e;
  const lignes = preuves.find((x) => x.e["op"] === "lignes")?.e;
  return {
    ht: nomDuChamp(groupe?.["total_base"]),
    base: nomDuChamp(groupe?.["base"]),
    tva: nomDuChamp(groupe?.["montant"]),
    lettres: nomDuChamp(preuves.find((x) => x.e["op"] === "lettres")?.e["champ"]),
    ttc: preuves.flatMap(({ p, e }) => {
      const champ = e["op"] === "somme" && e["role"] === "ttc" ? nomDuChamp(e["total"]) : null;
      return champ ? [{ variante: p.variante ?? null, champ }] : [];
    }),
    lignes: Object.fromEntries(
      Object.entries(lignes ?? {}).flatMap(([cle, v]) => {
        const champ = cle === "op" ? null : nomDuChamp(v);
        return champ ? [[cle, champ]] : [];
      }),
    ),
  };
}

/* ======================================================== LES JETONS (§3) === */

/**
 * Le plan de jetons, au format du moteur.
 *
 * Une lecture décimale IMPRIMÉE est FORTE ; « milliers », « entier » et la
 * virgule perdue sont des lectures de repli, que le moteur n'accepte que si aucune solution forte
 * n'existe. C'est la distinction mesurée sur le banc : sans elle, une quantité
 * ou une année devient un montant qui ferme une somme par hasard.
 */
const SEPARATEUR = /[.,]/u;

export function jetonsDuSudoku(
  plan: readonly PageToken[],
  devise: DeviseLue,
  /**
   * Les règles de lecture du pack, la grille dont la preuve `lettres` nomme le champ, et
   * les formats d'identifiants du pack (`ref.identifiant_formats`), quand on les a.
   */
  contexte: Pick<ContexteDuSudoku, "regles" | "grille"> & {
    readonly pack?: Pick<ContexteDuSudoku["pack"], "formats">;
  },
): JetonDuSudoku[] {
  const dates = datesDuPlan(plan, contexte.regles);
  const identifiants = identifiantsDuPlan(plan, contexte.regles, contexte.pack?.formats ?? {});
  const lettres = lettresDuPlan(plan, contexte.regles, contexte.grille, devise);
  return plan.map((t, i) => ({
    page: t.page,
    ordinal: t.ordinal,
    texte: t.text,
    x0: t.x0,
    y0: t.y0,
    x1: t.x1,
    y1: t.y1,
    montants: treillisMontant(t.text, devise).map((h) => ({
      v: h.millimes,
      // « 16000 » se lit aussi 16,000 (virgule perdue) : le treillis l'appelle
      // décimale, mais aucun séparateur n'est imprimé. Elle reste faible.
      forte: h.lecture === "decimale" && SEPARATEUR.test(t.text),
    })),
    ...dates[i]!,
    ...(identifiants[i]!.length > 0 ? { identifiants: identifiants[i]! } : {}),
    ...(lettres.has(cleDeJeton(t)) ? { lettres: lettres.get(cleDeJeton(t))! } : {}),
    ...decoupesDe(t.text, devise),
  }));
}

/**
 * Les COUPES possibles d'un jeton où l'OCR a collé deux cellules voisines :
 * « 12400,000 » peut être « 1 » | « 2400,000 » (quantité, prix). Chaque partie
 * est lue par le lecteur de montants de production, ici, jamais par le moteur
 * (règle ①). Le moteur ne s'en sert que si la géométrie du tableau et le
 * calcul l'exigent (lecture middle-out) ; sinon il les ignore.
 *
 * Seulement un nombre sans espace, dont la partie gauche est un entier d'un à
 * trois chiffres et la droite un montant à décimales imprimées. Mesuré le
 * 1er novembre 2026 (jeu de 50 achats, pièce 11).
 */
function decoupesDe(
  texte: string,
  devise: DeviseLue,
): { decoupes?: { coupe: number; gauche: number; droite: { v: number; forte: boolean }[] }[] } {
  const brut = texte.trim();
  if (!/^\d{4,}[.,]\d+$/u.test(brut)) return {};
  const decoupes = [];
  for (let k = 1; k <= 3; k++) {
    const gauche = brut.slice(0, k);
    const droite = brut.slice(k);
    if (/^0/u.test(droite)) continue;
    const g = treillisMontant(gauche, devise).find((h) => h.lecture === "entier");
    const d = treillisMontant(droite, devise)
      .filter((h) => h.lecture === "decimale")
      .map((h) => ({ v: h.millimes, forte: SEPARATEUR.test(droite) }));
    if (g && d.length > 0) decoupes.push({ coupe: k, gauche: g.millimes, droite: d });
  }
  return decoupes.length > 0 ? { decoupes } : {};
}

/* ===================================================== LA GRILLE ET LE PACK = */

export interface ContexteDuSudoku {
  /** Le jour où les règles se lisent : la date de la pièce, à défaut sa réception. */
  readonly jour: string;
  readonly grille: Grille;
  readonly pack: PackDuSudoku;
  /** Les formes juridiques du pack : le nom d'un tiers se compare sans elles. */
  readonly formesJuridiques: readonly string[];
  /** Comment le pack écrit une date, un matricule et un montant en lettres. */
  readonly regles: ReglesDeLecture;
}

/** Un nombre de la base en parties par million, sans flottant au bout. */
function ppm(x: unknown): number {
  return Math.round(Number(x) * 1_000_000);
}

/**
 * La grille et les paramètres du pack, lus par les vues `security_invoker`, AU
 * JOUR DIT — la date de la pièce, à défaut sa réception, comme le jugement
 * (`analyse.ts`) : jamais la date du jour.
 *
 * Rien n'a de valeur par défaut : un paramètre absent lève, une charge que le
 * pack définit deux fois avec deux valeurs différentes lève aussi — le moteur
 * ne choisit pas entre deux référentiels.
 */
export async function lireLeContexteDuSudoku(
  db: Requete,
  packId: string,
  grilleCode: string,
  /** La devise de la pièce : son exposant (`ref.devises`) met les montants à l'échelle. */
  deviseCode: string,
  /** Le jour des règles, `AAAA-MM-JJ`. */
  jour: string,
): Promise<ContexteDuSudoku> {
  if (dateDeLaPiece(jour, null) === null) throw new Error(`sudoku : jour illisible : ${jour}`);
  const { rows: grilles } = await db.query<{ id: string }>(
    `select id from ref_grilles_v
      where pack_version_id = $1 and code = $2
        and valid_from <= $3::date and (valid_to is null or valid_to >= $3::date)`,
    [packId, grilleCode, jour],
  );
  if (grilles.length !== 1) {
    throw new Error(`sudoku : grille « ${grilleCode} » — ${grilles.length} en vigueur, 1 attendue`);
  }
  const grilleId = grilles[0]!.id;

  const [champs, preuves, params, devises, taux, charges, tranches, formats, formes, regles] =
    await Promise.all([
      // Chaque champ avec la famille d'experts de son concept, et sa parcelle : l'anneau 3
      // lit les champs que nulle preuve ne lit, par leur famille (`ref.concepts.expert`).
      db.query<{
        code: string;
        type: string;
        reperes_fr: string[] | null;
        reperes_ar: string[] | null;
        format_code: string | null;
        parcelle: string;
        expert: string;
        role: string | null;
      }>(
        `select c.code, c.type, c.reperes_fr, c.reperes_ar, c.format_code, c.parcelle, k.expert, c.role
           from ref_grille_champs_v c join ref_concepts_v k on k.id = c.concept_id
          where c.grille_id = $1 order by c.code`,
        [grilleId],
      ),
      db.query<{ code: string; expression: unknown; statut: string; variante: string | null }>(
        `select code, expression, statut, variante from ref_grille_preuves_v
        where grille_id = $1 and expression is not null order by code`,
        [grilleId],
      ),
      db.query<{ code: string; value_num: string | null }>(
        `select distinct on (code) code, value_num from ref_socle_params_v
        where pack_version_id = $1
          and code = 'lecture.tolerance_arrondi_mineure'
          and valid_from <= $2::date and (valid_to is null or valid_to >= $2::date)
        order by code, valid_from desc`,
        [packId, jour],
      ),
      db.query<{ exposant: number }>(`select exposant from ref.devises where code = $1`, [
        deviseCode,
      ]),
      // Un taux nul n'est pas un taux du barème : l'exonération est un chemin à
      // part dans la grille (la mention lue), jamais une instance « 0 % » que
      // n'importe quel zéro imprimé fermerait.
      db.query<{ code: string; rate: string }>(
        `select code, rate from ref_tva_rates_v
        where pack_version_id = $1 and rate > 0
          and valid_from <= $2::date and (valid_to is null or valid_to >= $2::date)
        order by code`,
        [packId, jour],
      ),
      db.query<{
        code: string;
        fixed_amount: string | null;
        rate: string | null;
        taxable: boolean;
      }>(
        `select code, fixed_amount, rate, taxable from ref_fiscal_charges_v
        where pack_version_id = $1
          and valid_from <= $2::date and (valid_to is null or valid_to >= $2::date)
        order by code`,
        [packId, jour],
      ),
      // Les montants qu'un barème admet pour un droit au jour dit, TOUTES
      // catégories d'émetteur (`ref.baremes_des_droits`) : le lecteur reconnaît
      // un montant admis ; il ne juge pas si c'est celui de l'émetteur — le
      // Socle le fait ensuite (`bareme-du-timbre.ts`).
      db.query<{ droit: string; montant: string }>(
        `select distinct droit, montant_du_droit::text as montant from ref.baremes_des_droits
        where pack_version_id = $1
          and valid_from <= $2::date and (valid_to is null or valid_to >= $2::date)
        order by droit, montant`,
        [packId, jour],
      ),
      db.query<{ kind: string; pattern: string }>(
        `select distinct on (kind) kind, pattern from ref.identifiant_formats
        where pack_version_id = $1
          and valid_from <= $2::date and (valid_to is null or valid_to >= $2::date)
        order by kind, valid_from desc`,
        [packId, jour],
      ),
      db.query<{ code: string }>(
        `select distinct code from ref.formes_juridiques
        where pack_version_id = $1
          and valid_from <= $2::date and (valid_to is null or valid_to >= $2::date)
        order by code`,
        [packId, jour],
      ),
      lireLesReglesDeLecture(db, packId, jour),
    ]);

  const param = (code: string): number => {
    const v = params.rows.find((r) => r.code === code)?.value_num;
    if (v === null || v === undefined)
      throw new Error(`sudoku : paramètre absent du pack : ${code}`);
    return Number(v);
  };
  const exposant = devises.rows[0]?.exposant;
  if (exposant === undefined)
    throw new Error(`sudoku : devise inconnue du référentiel : ${deviseCode}`);
  const decimales = Number(exposant);

  // Une charge par code. Le pack la porte une fois par sens de facture (achat,
  // vente) : identiques, elles n'en font qu'une ; différentes, on refuse.
  const mineures = (x: string) => Math.round(Number(x) * 10 ** decimales);
  const parCode = new Map<string, PackDuSudoku["charges"][number]>();
  for (const c of charges.rows) {
    const fixe = c.fixed_amount === null ? null : mineures(c.fixed_amount);
    const une = {
      code: c.code,
      montant_fixe: fixe,
      // Le droit standard, et chaque tranche du barème au jour dit.
      montants_admis: [
        ...new Set([
          ...(fixe === null ? [] : [fixe]),
          ...tranches.rows.filter((t) => t.droit === c.code).map((t) => mineures(t.montant)),
        ]),
      ].sort((a, b) => a - b),
      taux_ppm: c.rate === null ? null : ppm(c.rate),
      assiette_tva: c.taxable,
    };
    const deja = parCode.get(c.code);
    if (deja && JSON.stringify(deja) !== JSON.stringify(une)) {
      throw new Error(`sudoku : la charge ${c.code} a deux valeurs dans le pack`);
    }
    parCode.set(c.code, une);
  }

  return {
    jour,
    grille: {
      code: grilleCode,
      champs: champs.rows.map((c) => ({
        code: c.code,
        type: c.type,
        reperes_fr: c.reperes_fr ?? [],
        reperes_ar: c.reperes_ar ?? [],
        format_code: c.format_code,
        parcelle: c.parcelle,
        expert: c.expert,
        role: c.role,
      })),
      preuves: preuves.rows.map((p) => ({
        code: p.code,
        expression: p.expression,
        statut: p.statut,
        variante: p.variante,
      })),
    },
    pack: {
      decimales,
      tolerance: param("lecture.tolerance_arrondi_mineure"),
      baremes: { tva: taux.rows.map((t) => ({ code: t.code, ppm: ppm(t.rate) })) },
      charges: [...parCode.values()],
      formats: Object.fromEntries(formats.rows.map((f) => [f.kind, f.pattern])),
    },
    formesJuridiques: formes.rows.map((f) => f.code),
    regles,
  };
}

/* ============================================ LES VARIANTES D'UNE GRILLE === */

/**
 * Résoudre une pièce avec toutes les variantes de sa grille.
 *
 * Une même pièce s'imprime de plusieurs façons (le timbre dans le TTC, ou
 * après lui) : la grille porte des preuves communes et des preuves propres à
 * chaque variante, en base. Chaque variante se joue seule ; la pièce est
 * prouvée si toutes celles qui la prouvent s'accordent sur ses montants, et
 * ambiguë si deux la prouvent autrement. L'unicité reste la preuve.
 */
/**
 * La précision IMPRIMÉE de la pièce : le plus grand nombre de décimales que
 * portent ses montants lus en lecture forte.
 *
 * Une facture en dinars imprimée à deux décimales (« 204,21 ») arrondit déjà
 * chaque taux au centime : 1 074,80 × 19 % = 204,212 s'imprime 204,21. La
 * tolérance d'arrondi d'un TAUX ou d'un PRODUIT devient alors la moitié de
 * l'unité imprimée (5 millimes), jamais celle d'une SOMME, qui reste exacte.
 * Mesuré le 31 octobre 2026 (jeu de 100 factures, D-08).
 */
function precisionImprimee(jetons: readonly JetonDuSudoku[]): number | null {
  let max: number | null = null;
  for (const j of jetons) {
    if (!j.montants.some((m) => m.forte)) continue;
    const d = /[.,](\d+)\D*$/u.exec(j.texte);
    if (d) max = Math.max(max ?? 0, d[1]!.length);
  }
  return max;
}

function packALaPrecision(pack: PackDuSudoku, jetons: readonly JetonDuSudoku[]): PackDuSudoku {
  const imprimee = precisionImprimee(jetons);
  if (imprimee === null || imprimee === 0 || imprimee >= pack.decimales) return pack;
  const demiUnite = Math.ceil(10 ** (pack.decimales - imprimee) / 2);
  return demiUnite > pack.tolerance ? { ...pack, tolerance: demiUnite } : pack;
}

export function resoudreLaPiece(
  jetons: readonly JetonDuSudoku[],
  contexte: ContexteDuSudoku,
  moteur: (entree: EntreeDuSudoku) => SortieDuSudoku = resoudre,
  connus?: Connus,
): SortieDuSudoku {
  const grille = contexte.grille;
  const pack = packALaPrecision(contexte.pack, jetons);
  const avecConnus = connus ? { connus } : {};
  const noms = [...new Set(grille.preuves.flatMap((p) => (p.variante ? [p.variante] : [])))].sort();
  if (noms.length === 0) return moteur({ jetons, grille, pack, ...avecConnus });

  const jouees = noms.map((variante) => ({
    variante,
    sortie: moteur({
      jetons,
      pack,
      ...avecConnus,
      grille: {
        ...grille,
        preuves: grille.preuves.filter((p) => !p.variante || p.variante === variante),
      },
    }),
  }));
  const prouvees = jouees.filter((j) => j.sortie.issue === "prouvee");
  if (prouvees.length === 0) {
    // Une variante dont les chiffres ferment mais que les lettres contredisent : la pièce
    // est signalée, et c'est ce qu'on en dit d'abord.
    const signalee = jouees.find((j) => j.sortie.issue === "signalee");
    if (signalee) return { ...signalee.sortie, variante: signalee.variante };
    const ambigue = jouees.find((j) => j.sortie.issue === "ambigue");
    return (ambigue ?? jouees[0]!).sortie;
  }
  const roles = champsDeLaGrille(grille);
  const empreinte = (o: SortieDuSudoku) =>
    JSON.stringify([
      roles.ht ? (o.champs[roles.ht]?.valeur ?? null) : null,
      (roles.tva ? (o.champs[roles.tva]?.instances ?? []) : []).map((i) => [i.taux, i.valeur]),
    ]);
  const premiere = prouvees[0]!;
  if (prouvees.some((j) => empreinte(j.sortie) !== empreinte(premiere.sortie))) {
    return { ...premiere.sortie, issue: "ambigue", solutions: prouvees.length };
  }
  return { ...premiere.sortie, variante: premiere.variante };
}

/* ============================================ LA SÉLECTION, PAR LA PREUVE === */

/** Une plage de jetons d'une même page : la désignation d'un article. */
function plage(refs: readonly RefDeJeton[] | undefined): TokenRef | null {
  if (!refs || refs.length === 0) return null;
  const page = refs[0]!.page;
  const ords = refs.filter((r) => r.page === page).map((r) => r.ordinal);
  const debut = Math.min(...ords);
  const fin = Math.max(...ords);
  return fin > debut ? { page, ordinal: debut, ordinalEnd: fin } : { page, ordinal: debut };
}

function ref(refs: readonly RefDeJeton[] | undefined): TokenRef | null {
  const r = refs?.[0];
  return r ? { page: r.page, ordinal: r.ordinal } : null;
}

/**
 * La sélection de la chaîne, dont les MONTANTS sont remplacés par ceux que le
 * sudoku a prouvés. Rendue telle quelle si la pièce n'est pas prouvée.
 *
 * Les champs se lisent par leur RÔLE dans les preuves de la grille
 * (`champsDeLaGrille`), jamais par un code écrit ici.
 *
 * - totaux : HT et TTC prouvés ; la TVA totale l'est quand la facture n'a
 *   qu'un taux (c'est alors l'instance unique). À plusieurs taux, le total de
 *   TVA n'est pas un champ de la grille : la chaîne garde le sien, et ses
 *   contrôles le vérifient contre les lignes prouvées.
 * - TTC : le total de la preuve `somme` au rôle `ttc` de la variante qui a
 *   prouvé la pièce — le montant qui ferme HT + TVA + droits.
 * - lignes de TVA : une par taux prouvé, nommée par le barème du pack. Une
 *   facture exonérée n'a aucune instance : les lignes de la chaîne restent.
 * - droits : ceux que la grille prouve (les codes de charges du pack) sont
 *   remplacés — ajoutés s'ils sont imprimés, retirés s'ils ne le sont pas ;
 *   les autres droits de la chaîne restent.
 */
export function selectionParLeSudoku(
  selection: VisionSelection,
  sortie: SortieDuSudoku,
  grille: Grille,
  codesDeCharges: readonly string[],
): VisionSelection {
  if (sortie.issue !== "prouvee") return selection;
  const c = sortie.champs;
  const roles = champsDeLaGrille(grille);
  const champsDeCharges = champsDesCharges(grille);

  const bases = (roles.base ? c[roles.base]?.instances : undefined) ?? [];
  const montants = (roles.tva ? c[roles.tva]?.instances : undefined) ?? [];
  const lignes =
    montants.length === 0
      ? selection.lines
      : montants.map((m) => {
          const deLaChaine = selection.lines.find((l) => l.tax_code === m.taux);
          return {
            label: deLaChaine?.label || "Ligne",
            tax_code: m.taux,
            base_ht: ref(bases.find((b) => b.taux === m.taux)?.refs),
            vat_amount: ref(m.refs),
            ttc: null,
          };
        });

  const prouvees = codesDeCharges.filter((code) => champsDeCharges[code] !== undefined);
  const droits = [
    ...selection.other_charges.filter((d) => !prouvees.includes(d.code)),
    ...prouvees.flatMap((code) => {
      const champ = c[champsDeCharges[code]!];
      const r = ref(champ?.refs);
      return r && champ?.valeur !== null && champ?.valeur !== "0" ? [{ code, amount: r }] : [];
    }),
  ];

  // L'anneau 1 : les lignes d'articles prouvées remplacent celles de la chaîne.
  // La rubrique de chaque article se résout ensuite comme avant, en base, sur
  // sa désignation (`charge_famille_resolve`) : rien n'est classé ici.
  // Une cellule déduite ou lue dans une coupe ne se relit pas dans son jeton
  // (il porte deux cases, ou aucune) : elle reste nulle dans la chaîne, et ne
  // vit qu'inscrite, avec son statut (`champsLusAInscrire`).
  const imprimee = (c: Cite) =>
    c.statut === "deduit" || c.statut === "coupe" ? undefined : c.refs;
  const articles =
    sortie.lignes?.statut === "prouve"
      ? sortie.lignes.instances.map((l) => ({
          designation: plage(l.designation?.refs),
          quantity: ref(imprimee(l.quantite)),
          // Un prix imprimé TTC (la grille le déclare, `prix_ttc`) se rend comme tel.
          unit_price_ht: l.prix_ttc ? null : ref(imprimee(l.prix)),
          unit_price_ttc: l.prix_ttc ? ref(imprimee(l.prix)) : null,
          total_ht: ref(imprimee(l.montant)),
          tax_code: l.taux?.code ?? null,
        }))
      : selection.articles;

  // L'anneau 2 : les parties prouvées par le matricule du dossier. Seul ce qui
  // est PROUVÉ remplace la désignation de la chaîne ; un nom seulement
  // « conforme » (tiers inconnu) ne remplace rien.
  const parties = sortie.parties?.statut === "prouve" ? sortie.parties : null;
  const prouve = (v: { statut: string; refs: readonly RefDeJeton[] } | null | undefined) =>
    v && v.statut === "prouve" ? v.refs : undefined;
  const mfEmetteur = parties ? ref(prouve(parties.emetteur.matricule)) : null;
  const mfClient = parties ? ref(prouve(parties.client.matricule)) : null;
  const nomEmetteur = parties ? plage(prouve(parties.emetteur.nom)) : null;
  const references = {
    ...selection.references,
    ...(mfEmetteur ? { matricule_fiscal: mfEmetteur } : {}),
    ...(mfClient ? { matricule_fiscal_client: mfClient } : {}),
  };

  // Le TTC que la chaîne reçoit : la preuve au rôle `ttc` de la variante qui a
  // prouvé (ou commune), dont le total est prouvé et cité. Sur une pièce qui
  // imprime son TTC AVANT le timbre, c'est le net à payer (M04).
  const ttcProuve = roles.ttc
    .filter((t) => t.variante === null || t.variante === sortie.variante)
    .map((t) => ({ champ: t.champ, lu: c[t.champ] }))
    .find((x) => x.lu?.statut === "prouve" && x.lu.refs.length > 0);
  /*
   * Un total que le moteur a pris dans le montant EN LETTRES (`par_lettres`) :
   * les chiffres relevés ne fermaient pas. Il se cite sur toute la phrase, pour
   * que l'aval relise ce que la pièce imprime — des mots, pas un nombre — et que
   * le contrôle le dise (« le total en chiffres ne se lit pas »).
   */
  const lettres = roles.lettres ? c[roles.lettres] : undefined;
  const ttc =
    ttcProuve && sortie.par_lettres === ttcProuve.champ
      ? plage(lettres?.refs ?? ttcProuve.lu?.refs)
      : ref(ttcProuve?.lu?.refs);

  return {
    ...selection,
    issuer: nomEmetteur ?? selection.issuer,
    references,
    lines: lignes,
    articles,
    other_charges: droits,
    totals: {
      base_ht: roles.ht ? ref(c[roles.ht]?.refs) : null,
      vat: montants.length === 1 ? ref(montants[0]!.refs) : selection.totals.vat,
      ttc,
    },
  };
}

/**
 * Ce que le sudoku a rendu, pour le journal (`etapes-de-lecture.ts`) : son
 * issue, ce qui tranche, et les montants qu'il prouve — en décimales de la
 * devise, comme la lecture les porte. Les champs se lisent par leur RÔLE dans
 * la grille, jamais par un code écrit ici.
 */
function verdictDuSudoku(
  sortie: SortieDuSudoku,
  contexte: Pick<ContexteDuSudokuBranche, "grille" | "mode">,
  jetons: readonly JetonDuSudoku[],
  designee: boolean,
  decimales: number,
): VerdictDuSudoku {
  const c = sortie.champs;
  const roles = champsDeLaGrille(contexte.grille);
  const enDecimales = (v: string | null | undefined): string | null =>
    v === null || v === undefined || !/^-?\d+$/u.test(v)
      ? null
      : depuisUniteMineure(Number(v), decimales);
  const somme = (valeurs: readonly (string | null)[]): string | null => {
    const lues = valeurs.filter((v): v is string => v !== null && /^-?\d+$/u.test(v));
    return lues.length === 0
      ? null
      : depuisUniteMineure(
          lues.reduce((s, v) => s + Number(v), 0),
          decimales,
        );
  };
  const champTtc = roles.ttc.find(
    (t) => (t.variante === null || t.variante === sortie.variante) && c[t.champ]?.valeur != null,
  )?.champ;
  const tva = roles.tva ? c[roles.tva] : undefined;
  const lettres = jetons.find((j) => j.lettres)?.lettres;
  const preuveLettres = contexte.grille.preuves.find((p) => expressionDe(p)["op"] === "lettres");
  return {
    mode: contexte.mode,
    issue: sortie.issue,
    designee,
    regle: sortie.par_lettres
      ? `lettres:${sortie.par_lettres}`
      : sortie.variante
        ? `variante:${sortie.variante}`
        : null,
    raison: sortie.raison ?? null,
    solutions: sortie.solutions,
    baseHt: roles.ht ? enDecimales(c[roles.ht]?.valeur) : null,
    tva: tva?.instances?.length
      ? somme(tva.instances.map((i) => i.valeur))
      : enDecimales(tva?.valeur),
    ttc: champTtc ? enDecimales(c[champTtc]?.valeur) : null,
    droits: somme(
      Object.values(champsDesCharges(contexte.grille)).map((ch) => c[ch]?.valeur ?? null),
    ),
    lettres: lettres ? depuisUniteMineure(lettres.v, decimales) : null,
    preuveLettres: preuveLettres ? (sortie.preuves[preuveLettres.code] ?? null) : null,
    erreur: null,
  };
}

/** Quel champ de la grille porte quelle charge du pack ? Les preuves `charge` le disent. */
function champsDesCharges(grille: Grille): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of grille.preuves) {
    const e = expressionDe(p);
    const champ = nomDuChamp(e["montant"]);
    if (e["op"] === "charge" && typeof e["code"] === "string" && champ) out[e["code"]] = champ;
  }
  return out;
}

/* ================================================== LE BRANCHEMENT ======= */

/** Une ligne de `capture.champs_lus`, telle que la porte la reçoit. */
interface ChampLuAInscrire {
  /** Le code du champ de la grille ; nul : la ligne de tentative. */
  readonly champ: string | null;
  /** La n-ième ligne d'un tableau, à partir de 1. */
  readonly rang: number | null;
  /** L'instance d'un champ de groupe : le code du taux. */
  readonly instance: string | null;
  readonly valeur: string | null;
  readonly statut: string | null;
  readonly citations: readonly (RefDeJeton | { readonly case: object })[];
  /** Ce que l'expert dit du champ sans le refuser (`ref.avertissements_de_lecture`). */
  readonly avertissement?: string;
}

/** Ce que `capture.inscrireChampsLus` reçoit : la sortie, champ par champ. */
export interface ChampsLusAInscrire {
  readonly pieceId: string;
  /** Le pack et le jour où la porte résout la grille et ses champs. */
  readonly packId: string;
  readonly jour: string;
  readonly grille: string;
  readonly issue: SortieDuSudoku["issue"];
  readonly champs: readonly ChampLuAInscrire[];
}

/**
 * Les lignes à inscrire. Un champ SIGNALÉ s'inscrit aussi, sans valeur ni
 * citation : c'est la trace d'une lecture que le sudoku n'a pas pu prouver, et
 * la mesure du recours à la chaîne en dépend. Une valeur, elle, n'est jamais
 * écrite sans sa citation (R2) : sans citation, elle s'inscrit nulle, avec son
 * statut. Si aucun champ n'est lu, une ligne de tentative (champ nul) porte
 * l'issue : un échec ne disparaît pas.
 *
 * Le rang d'une ligne de tableau et le taux d'une instance ont leur colonne ;
 * le code de chaque cellule vient de la preuve `lignes` de la grille.
 */
/**
 * L'avertissement de la lettre de contrôle : un matricule lu, de la forme du pack,
 * dont la lettre ne tient pas la règle (`ref.identifiant_controles`). Il ne bloque
 * rien — la DGI ne publie pas l'algorithme (décision du 1er novembre 2026).
 */
const LETTRE_DISCORDANTE = "lettre_de_controle_discordante";

function avertissementDe(
  champ: string,
  valeur: string | null,
  contexte: Pick<ContexteDuSudoku, "grille" | "regles">,
): { avertissement?: string } {
  const format = contexte.grille.champs.find((c) => c.code === champ)?.format_code;
  if (valeur === null || format !== contexte.regles.codeDuMatricule) return {};
  const lu = normaliserMatricule(valeur, contexte.regles.matricule);
  return lettreDeControle(lu, contexte.regles.matricule) === "discordante"
    ? { avertissement: LETTRE_DISCORDANTE }
    : {};
}

export function champsLusAInscrire(
  piece: { readonly pieceId: string; readonly packId: string },
  contexte: Pick<ContexteDuSudoku, "jour" | "grille" | "regles">,
  sortie: SortieDuSudoku,
): ChampsLusAInscrire {
  const ligne = (
    champ: string,
    statut: string,
    valeur: string | null,
    citations: ChampLuAInscrire["citations"],
    place: { rang?: number; instance?: string } = {},
  ): ChampLuAInscrire => ({
    champ,
    rang: place.rang ?? null,
    instance: place.instance ?? null,
    valeur: citations.length > 0 ? valeur : null,
    statut,
    citations,
    ...avertissementDe(champ, citations.length > 0 ? valeur : null, contexte),
  });

  const champs: ChampLuAInscrire[] = Object.entries(sortie.champs).flatMap(([champ, lu]) => {
    if (lu.statut === "absent") return [];
    const inst = lu.instances ?? [];
    if (inst.length > 0) {
      return inst.map((i) => ligne(champ, lu.statut, i.valeur, i.refs, { instance: i.taux }));
    }
    return [ligne(champ, lu.statut, lu.valeur, lu.refs)];
  });

  // Les lignes d'articles : une ligne inscrite par cellule citée.
  const lignes = sortie.lignes;
  if (lignes && lignes.statut !== "absent") {
    const roles = champsDeLaGrille(contexte.grille).lignes;
    const champDe = (cle: string): string => {
      const champ = roles[cle];
      if (!champ) throw new Error(`sudoku : la preuve « lignes » ne nomme pas la cellule ${cle}`);
      return champ;
    };
    lignes.instances.forEach((l, i) => {
      const cellules: Array<[string, Cite | null]> = [
        ["designation", l.designation],
        ["quantite", l.quantite],
        [l.prix_ttc ? "prix_ttc" : "prix", l.prix],
        ["remise", l.remise],
        ["montant", l.montant],
        ["taux", l.taux ? { valeur: l.taux.code, refs: l.taux.refs } : null],
      ];
      for (const [cle, c] of cellules) {
        if (!c) continue;
        // Une cellule DÉDUITE (lecture middle-out) n'est pas imprimée : elle
        // s'inscrit comme telle, avec l'endroit où elle devrait l'être, pour
        // une relecture ciblée — jamais comme une valeur prouvée et citée.
        // Une cellule lue dans une COUPE cite son jeton et la coupe retenue :
        // la valeur n'est pas tout le texte du jeton.
        const deduite = c.statut === "deduit";
        const coupee = c.statut === "coupe";
        champs.push(
          ligne(
            champDe(cle),
            deduite || coupee ? c.statut! : lignes.statut,
            c.valeur,
            deduite && c.case
              ? [{ case: c.case }]
              : coupee
                ? c.refs.map((r) => ({ ...r, coupe: c.coupe }))
                : c.refs,
            { rang: i + 1 },
          ),
        );
      }
    });
    // La remise globale qui a fermé les lignes, quand le centre ne l'a pas déjà lue.
    const remise = lignes.remise_globale;
    const champRemise = remise ? champDe("remise_globale") : null;
    if (remise && champRemise && !champs.some((c) => c.champ === champRemise)) {
      champs.push(ligne(champRemise, lignes.statut, remise.valeur, remise.refs));
    }
  }
  return {
    pieceId: piece.pieceId,
    packId: piece.packId,
    jour: contexte.jour,
    grille: contexte.grille.code,
    issue: sortie.issue,
    champs:
      champs.length > 0
        ? champs
        : [{ champ: null, rang: null, instance: null, valeur: null, statut: null, citations: [] }],
  };
}

/* ================================================ LE MODE, PAR UN RÉGLAGE === */

/** Le réglage qui branche le sudoku, et ses deux options (`ref.reglages_comptables`). */
const REGLAGE_DU_SUDOKU = "lecture.sudoku";
const MODES = ["observe", "designe"] as const;
type ModeDuSudoku = (typeof MODES)[number];

/**
 * Le mode du dossier : `observe` (le défaut du pack) ou `designe`. Le cabinet
 * l'arrête comme tout réglage (« Réglages comptabilité », sujet `lecture`) ;
 * aucun déploiement n'est requis. Absent ou inconnu : une erreur nommée, que
 * le sudoku crie au journal — il ne devine pas un mode (R4).
 */
export function modeDuSudoku(r: ReglagesResolus): ModeDuSudoku {
  const v = r.get(REGLAGE_DU_SUDOKU);
  const mode = MODES.find((m) => m === v);
  if (!mode) throw new Error("reglage.lecture.illisible");
  return mode;
}

/** Le contexte d'une pièce, avec le mode que son dossier a arrêté. */
export interface ContexteDuSudokuBranche extends ContexteDuSudoku {
  readonly mode: ModeDuSudoku;
}

/**
 * Le jour des règles d'une lecture : la date que la chaîne a lue
 * (`selection.document_date`, relue dans le plan par `normalizeDate`), à
 * défaut celle de la réception de la pièce — la règle du jugement.
 */
export function jourDeLaLecture(
  lecture: VisionRead,
  recueLe: string,
  dates: ConventionDeDate,
): string {
  const lue = resolveFromTokenPlan(
    lecture.tokens,
    "document_date",
    lecture.selection.document_date,
    { date: dates },
  ).value;
  return dateDeLaPiece(lue, null) ?? recueLe;
}

export interface Sudoku {
  /** La lecture, dont les montants sont désignés par la preuve quand elle est prouvée. */
  lire(lecture: VisionRead): Promise<VisionRead>;
  /**
   * Inscrire ce que le sudoku a lu sur la lecture RETENUE — après sa
   * persistance, jamais avant : un rattrapage écarté ne laisse pas de champs
   * dont les citations pointeraient dans un plan de jetons qui n'est pas
   * celui de la pièce (R2).
   */
  inscrire(retenue: VisionRead): Promise<void>;
  /**
   * Cette lecture a-t-elle été DÉSIGNÉE par une preuve ? Vrai seulement en mode
   * `designe` et pour une pièce prouvée : ses totaux sont alors ceux de la
   * preuve, et un rattrapage par un autre lecteur ne peut pas faire mieux.
   * En observation, toujours faux : la chaîne garde son comportement entier.
   */
  prouvee(lecture: VisionRead): boolean;
  /** Ce que le sudoku a rendu de cette lecture, pour le journal ; rien s'il ne l'a pas vue. */
  verdict(lecture: VisionRead): VerdictDuSudoku | null;
}

/** Le verdict d'un sudoku qui n'a pas pu juger : seule son erreur est dite. */
const SANS_VERDICT: VerdictDuSudoku = {
  mode: null,
  issue: "panne",
  designee: false,
  regle: null,
  raison: null,
  solutions: null,
  baseHt: null,
  tva: null,
  ttc: null,
  droits: null,
  lettres: null,
  preuveLettres: null,
  erreur: null,
};

/**
 * Le sudoku branché sur la base, pour une pièce.
 *
 * DEUX MODES, réglés par dossier (`lecture.sudoku`), et le premier est le
 * défaut du pack :
 *
 *   OBSERVE  — il lit chaque pièce et inscrit ce qu'il a lu dans
 *              `capture.champs_lus`, prouvé ou non, mais la lecture de la
 *              chaîne ressort à l'identique, à l'octet près. C'est l'épreuve
 *              en vrai : sur les vraies pièces, à côté de la chaîne, sans rien
 *              pouvoir casser.
 *   DÉSIGNE  — quand la pièce est prouvée, les montants désignés par la preuve
 *              remplacent ceux de la chaîne.
 *
 * Le passage de l'un à l'autre se décide sur les mesures de l'observation, et
 * le cabinet l'arrête dans « Réglages comptabilité » : aucun déploiement.
 *
 * Les règles se lisent au jour de la pièce (`jourDeLaLecture`) ; le contexte
 * est gardé par jour.
 */
export function creerLeSudoku(
  api: AppelApi,
  piece: {
    readonly pieceId: string;
    /** Le dossier de la pièce : son réglage dit le mode. */
    readonly dossierId: string;
    readonly packId: string;
    /** Le jour de réception de la pièce (`AAAA-MM-JJ`) : le jour des règles à défaut de date lue. */
    readonly recueLe: string;
    /** La convention de date du pack : le jour des règles se lit dans la date de la pièce. */
    readonly dates: ConventionDeDate;
    /** La devise du dossier, telle que `lireLesDevises` la rend ; absente, il ne lit pas. */
    readonly devise: DeviseLue | undefined;
    /** Le dossier et ses tiers, tels que la base les connaît (anneau 2). */
    readonly dossier: { readonly matricule: string | null; readonly raisonSociale: string };
    readonly tiers: readonly {
      readonly code: string;
      readonly identifiantFiscal: string | null;
      readonly raisonSociale: string;
    }[];
  },
): Sudoku {
  const contextes = new Map<string, Promise<ContexteDuSudokuBranche>>();
  const lus = new WeakMap<VisionRead, ChampsLusAInscrire>();
  const designees = new WeakSet<VisionRead>();
  const verdicts = new WeakMap<VisionRead, VerdictDuSudoku>();
  return {
    async lire(lecture) {
      let jour: string | null = null;
      try {
        if (!piece.devise) throw new Error("la devise du dossier est absente du référentiel");
        jour = jourDeLaLecture(lecture, piece.recueLe, piece.dates);
        let contexte = contextes.get(jour);
        if (!contexte) {
          contexte = api.rpc<ContexteDuSudokuBranche>("capture", "contexteSudoku", [
            piece.dossierId,
            piece.packId,
            GRILLE_DE_LA_LECTURE_CITEE,
            piece.devise.code,
            jour,
          ]);
          contextes.set(jour, contexte);
        }
        const ctx = await contexte;
        const connus: Connus = {
          dossier: piece.dossier.matricule
            ? { matricule: piece.dossier.matricule, raison_sociale: piece.dossier.raisonSociale }
            : null,
          tiers: piece.tiers.flatMap((t) =>
            t.identifiantFiscal
              ? [{ code: t.code, matricule: t.identifiantFiscal, raison_sociale: t.raisonSociale }]
              : [],
          ),
          formes_juridiques: ctx.formesJuridiques,
        };
        const jetons = jetonsDuSudoku(lecture.tokens, piece.devise, ctx);
        const sortie = resoudreLaPiece(jetons, ctx, resoudre, connus);
        const aInscrire = champsLusAInscrire(piece, ctx, sortie);

        const rendue: VisionRead =
          ctx.mode !== "designe" || sortie.issue !== "prouvee"
            ? lecture
            : {
                ...lecture,
                selection: selectionParLeSudoku(
                  lecture.selection,
                  sortie,
                  ctx.grille,
                  ctx.pack.charges.map((ch) => ch.code),
                ),
              };
        lus.set(rendue, aInscrire);
        if (rendue !== lecture) designees.add(rendue);
        verdicts.set(
          rendue,
          verdictDuSudoku(sortie, ctx, jetons, rendue !== lecture, piece.devise.decimales),
        );
        return rendue;
      } catch (e: unknown) {
        if (jour !== null) contextes.delete(jour);
        console.error(`sudoku : lecture non prouvée — pièce ${piece.pieceId} : ${message(e)}`);
        verdicts.set(lecture, { ...SANS_VERDICT, erreur: e instanceof Error ? e.name : typeof e });
        return lecture;
      }
    },

    verdict(lecture) {
      return verdicts.get(lecture) ?? null;
    },

    async inscrire(retenue) {
      const aInscrire = lus.get(retenue);
      if (!aInscrire) return;
      await api.rpc<void>("capture", "inscrireChampsLus", [aInscrire]).catch((e: unknown) => {
        console.error(`sudoku : champs NON inscrits — pièce ${piece.pieceId} : ${message(e)}`);
      });
    },

    prouvee(lecture) {
      return designees.has(lecture);
    },
  };
}

function message(e: unknown): string {
  return e instanceof Error ? e.message.slice(0, 400) : String(e);
}
