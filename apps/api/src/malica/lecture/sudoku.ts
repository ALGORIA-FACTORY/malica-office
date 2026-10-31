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

import type { DeviseLue } from "@malica/socle/montant-imprime";
import {
  resoudre,
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

import { treillisMontant } from "./montants.ts";
import { normalizeDate, type PageToken, type TokenRef } from "./token-plan.ts";
import type { VisionRead, VisionSelection } from "./vision.ts";

/** La grille de la lecture citée : elle lit des factures (voir l'en-tête). */
export const GRILLE_DE_LA_LECTURE_CITEE = "facture";

/** Les codes de champs de la grille facture que la sélection connaît. */
const CHAMP = {
  ht: "total_ht",
  ttc: "total_ttc",
  net: "net_a_payer",
  base: "base_tva_par_taux",
  tva: "montant_tva_par_taux",
} as const;

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

export function jetonsDuSudoku(plan: readonly PageToken[], devise: DeviseLue): JetonDuSudoku[] {
  return plan.map((t) => ({
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
    date: normalizeDate(t.text),
  }));
}

/* ===================================================== LA GRILLE ET LE PACK = */

export interface ContexteDuSudoku {
  readonly grille: Grille;
  readonly pack: PackDuSudoku;
  /** Les formes juridiques du pack : le nom d'un tiers se compare sans elles. */
  readonly formesJuridiques: readonly string[];
}

/** Un nombre de la base en parties par million, sans flottant au bout. */
function ppm(x: unknown): number {
  return Math.round(Number(x) * 1_000_000);
}

/**
 * La grille et les paramètres du pack, lus par les vues `security_invoker`.
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
): Promise<ContexteDuSudoku> {
  const { rows: grilles } = await db.query<{ id: string }>(
    `select id from ref_grilles_v
      where pack_version_id = $1 and code = $2
        and valid_from <= current_date and (valid_to is null or valid_to >= current_date)`,
    [packId, grilleCode],
  );
  if (grilles.length !== 1) {
    throw new Error(`sudoku : grille « ${grilleCode} » — ${grilles.length} en vigueur, 1 attendue`);
  }
  const grilleId = grilles[0]!.id;

  const [champs, preuves, params, devises, taux, charges, formats, formes] = await Promise.all([
    db.query<{
      code: string;
      type: string;
      reperes_fr: string[] | null;
      reperes_ar: string[] | null;
      format_code: string | null;
    }>(
      `select code, type, reperes_fr, reperes_ar, format_code
         from ref_grille_champs_v where grille_id = $1 order by code`,
      [grilleId],
    ),
    db.query<{ code: string; expression: unknown; statut: string; variante: string | null }>(
      `select code, expression, statut, variante from ref_grille_preuves_v
        where grille_id = $1 and expression is not null order by code`,
      [grilleId],
    ),
    db.query<{ code: string; value_num: string | null }>(
      `select code, value_num from ref_socle_params_v
        where pack_version_id = $1
          and code = 'lecture.tolerance_arrondi_mineure'`,
      [packId],
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
          and valid_from <= current_date and (valid_to is null or valid_to >= current_date)
        order by code`,
      [packId],
    ),
    db.query<{
      code: string;
      fixed_amount: string | null;
      rate: string | null;
      taxable: boolean;
    }>(
      `select code, fixed_amount, rate, taxable from ref_fiscal_charges_v
        where pack_version_id = $1
          and valid_from <= current_date and (valid_to is null or valid_to >= current_date)
        order by code`,
      [packId],
    ),
    db.query<{ kind: string; pattern: string }>(
      `select distinct on (kind) kind, pattern from ref.identifiant_formats
        where pack_version_id = $1
          and valid_from <= current_date and (valid_to is null or valid_to >= current_date)
        order by kind, valid_from desc`,
      [packId],
    ),
    db.query<{ code: string }>(
      `select distinct code from ref.formes_juridiques
        where pack_version_id = $1
          and valid_from <= current_date and (valid_to is null or valid_to >= current_date)
        order by code`,
      [packId],
    ),
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
  const parCode = new Map<string, PackDuSudoku["charges"][number]>();
  for (const c of charges.rows) {
    const une = {
      code: c.code,
      montant_fixe:
        c.fixed_amount === null ? null : Math.round(Number(c.fixed_amount) * 10 ** decimales),
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
    grille: {
      code: grilleCode,
      champs: champs.rows.map((c) => ({
        code: c.code,
        type: c.type,
        reperes_fr: c.reperes_fr ?? [],
        reperes_ar: c.reperes_ar ?? [],
        format_code: c.format_code,
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
export function resoudreLaPiece(
  jetons: readonly JetonDuSudoku[],
  contexte: ContexteDuSudoku,
  moteur: (entree: EntreeDuSudoku) => SortieDuSudoku = resoudre,
  connus?: Connus,
): SortieDuSudoku {
  const { grille, pack } = contexte;
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
    const ambigue = jouees.find((j) => j.sortie.issue === "ambigue");
    return (ambigue ?? jouees[0]!).sortie;
  }
  const empreinte = (o: SortieDuSudoku) =>
    JSON.stringify([
      o.champs[CHAMP.ht]?.valeur ?? null,
      (o.champs[CHAMP.tva]?.instances ?? []).map((i) => [i.taux, i.valeur]),
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
 * - totaux : HT et TTC prouvés ; la TVA totale l'est quand la facture n'a
 *   qu'un taux (c'est alors l'instance unique). À plusieurs taux, le total de
 *   TVA n'est pas un champ de la grille : la chaîne garde le sien, et ses
 *   contrôles le vérifient contre les lignes prouvées.
 * - lignes de TVA : une par taux prouvé, nommée par le barème du pack. Une
 *   facture exonérée n'a aucune instance : les lignes de la chaîne restent.
 * - droits : ceux que la grille prouve (les codes de charges du pack) sont
 *   remplacés — ajoutés s'ils sont imprimés, retirés s'ils ne le sont pas ;
 *   les autres droits de la chaîne restent.
 */
export function selectionParLeSudoku(
  selection: VisionSelection,
  sortie: SortieDuSudoku,
  codesDeCharges: readonly string[],
  champsDeCharges: Readonly<Record<string, string>>,
): VisionSelection {
  if (sortie.issue !== "prouvee") return selection;
  const c = sortie.champs;

  const bases = c[CHAMP.base]?.instances ?? [];
  const montants = c[CHAMP.tva]?.instances ?? [];
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
  const articles =
    sortie.lignes?.statut === "prouve"
      ? sortie.lignes.instances.map((l) => ({
          designation: plage(l.designation?.refs),
          quantity: ref(l.quantite.refs),
          unit_price_ht: ref(l.prix.refs),
          unit_price_ttc: null,
          total_ht: ref(l.montant.refs),
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

  return {
    ...selection,
    issuer: nomEmetteur ?? selection.issuer,
    references,
    lines: lignes,
    articles,
    other_charges: droits,
    totals: {
      base_ht: ref(c[CHAMP.ht]?.refs),
      vat: montants.length === 1 ? ref(montants[0]!.refs) : selection.totals.vat,
      // Le TTC de la chaîne est le montant qui ferme HT + TVA + droits : sur une
      // pièce qui imprime son TTC AVANT le timbre, c'est le net à payer prouvé.
      ttc: ref(
        (c[CHAMP.net]?.statut === "prouve" && c[CHAMP.net]?.refs.length
          ? c[CHAMP.net]
          : c[CHAMP.ttc]
        )?.refs,
      ),
    },
  };
}

/** Quel champ de la grille porte quelle charge du pack ? Les preuves `charge` le disent. */
export function champsDesCharges(grille: Grille): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of grille.preuves) {
    const e = p.expression as { op?: unknown; code?: unknown; montant?: unknown } | null;
    if (e?.op === "charge" && typeof e.code === "string" && typeof e.montant === "string") {
      out[e.code] = e.montant;
    }
  }
  return out;
}

/* ================================================== LE BRANCHEMENT ======= */

/** Ce que `capture.inscrireChampsLus` reçoit : la sortie, champ par champ. */
export interface ChampsLusAInscrire {
  readonly pieceId: string;
  readonly grille: string;
  readonly issue: SortieDuSudoku["issue"];
  readonly champs: readonly {
    champ: string | null;
    valeur: string | null;
    statut: string | null;
    citations: readonly RefDeJeton[];
  }[];
}

/**
 * Les lignes à inscrire. Un champ SIGNALÉ s'inscrit aussi, sans valeur ni
 * citation : c'est la trace d'une lecture que le sudoku n'a pas pu prouver, et
 * la mesure du recours à la chaîne en dépend. Une valeur, elle, n'est jamais
 * écrite sans sa citation (R2). Si aucun champ n'est lu, une ligne de
 * tentative (champ nul) porte l'issue : un échec ne disparaît pas.
 */
export function champsLusAInscrire(
  pieceId: string,
  grille: string,
  sortie: SortieDuSudoku,
): ChampsLusAInscrire {
  const champs: Array<ChampsLusAInscrire["champs"][number]> = Object.entries(sortie.champs).flatMap(
    ([champ, lu]) => {
      if (lu.statut === "absent") return [];
      const inst = lu.instances ?? [];
      if (inst.length > 0) {
        return inst.map((i) => ({
          champ: `${champ}:${i.taux}`,
          valeur: i.refs.length > 0 ? i.valeur : null,
          statut: lu.statut,
          citations: i.refs,
        }));
      }
      return [
        {
          champ,
          valeur: lu.refs.length > 0 ? lu.valeur : null,
          statut: lu.statut,
          citations: lu.refs,
        },
      ];
    },
  );
  // Les lignes d'articles : une ligne inscrite par cellule citée.
  const lignes = sortie.lignes;
  if (lignes && lignes.statut !== "absent") {
    lignes.instances.forEach((l, i) => {
      const n = i + 1;
      const cellules: Array<[string, { valeur: string; refs: readonly RefDeJeton[] } | null]> = [
        ["designation", l.designation],
        ["quantite", l.quantite],
        ["prix_unitaire_ht", l.prix],
        ["remise_ligne", l.remise],
        ["montant_ligne_ht", l.montant],
        ["taux_tva_ligne", l.taux ? { valeur: l.taux.code, refs: l.taux.refs } : null],
      ];
      for (const [code, c] of cellules) {
        if (c) {
          champs.push({
            champ: `${code}#${n}`,
            valeur: c.valeur,
            statut: lignes.statut,
            citations: c.refs,
          });
        }
      }
    });
  }
  return {
    pieceId,
    grille,
    issue: sortie.issue,
    champs:
      champs.length > 0 ? champs : [{ champ: null, valeur: null, statut: null, citations: [] }],
  };
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
}

/**
 * Le sudoku branché sur la base, pour une pièce.
 *
 * DEUX MODES, et le premier est celui par défaut :
 *
 *   OBSERVE  (`designe: false`) — il lit chaque pièce et inscrit ce qu'il a
 *            lu dans `capture.champs_lus`, prouvé ou non, mais la lecture de
 *            la chaîne ressort à l'identique, à l'octet près. C'est l'épreuve
 *            en vrai : sur les vraies pièces, à côté de la chaîne, sans rien
 *            pouvoir casser.
 *   DÉSIGNE  (`designe: true`) — quand la pièce est prouvée, les montants
 *            désignés par la preuve remplacent ceux de la chaîne.
 *
 * Le passage de l'un à l'autre est une décision du dirigeant, prise sur les
 * mesures de l'observation : `SUDOKU_DESIGNE=1` dans l'environnement de l'API,
 * comme `OCR_URL` branche PaddleOCR. Aucun déploiement de code n'est requis.
 */
export function creerLeSudoku(
  api: AppelApi,
  piece: {
    readonly pieceId: string;
    readonly packId: string;
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
  mode: { readonly designe: boolean },
): Sudoku {
  let contexte: Promise<ContexteDuSudoku> | null = null;
  const lus = new WeakMap<VisionRead, ChampsLusAInscrire>();
  return {
    async lire(lecture) {
      try {
        if (!piece.devise) throw new Error("la devise du dossier est absente du référentiel");
        contexte ??= api.rpc<ContexteDuSudoku>("capture", "contexteSudoku", [
          piece.packId,
          GRILLE_DE_LA_LECTURE_CITEE,
          piece.devise.code,
        ]);
        const ctx = await contexte;
        const { grille, pack } = ctx;
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
        const sortie = resoudreLaPiece(
          jetonsDuSudoku(lecture.tokens, piece.devise),
          ctx,
          resoudre,
          connus,
        );
        const aInscrire = champsLusAInscrire(piece.pieceId, grille.code, sortie);

        const rendue: VisionRead =
          !mode.designe || sortie.issue !== "prouvee"
            ? lecture
            : {
                ...lecture,
                selection: selectionParLeSudoku(
                  lecture.selection,
                  sortie,
                  pack.charges.map((ch) => ch.code),
                  champsDesCharges(grille),
                ),
              };
        lus.set(rendue, aInscrire);
        return rendue;
      } catch (e: unknown) {
        contexte = null;
        console.error(`sudoku : lecture non prouvée — pièce ${piece.pieceId} : ${message(e)}`);
        return lecture;
      }
    },

    async inscrire(retenue) {
      const aInscrire = lus.get(retenue);
      if (!aInscrire) return;
      await api.rpc<void>("capture", "inscrireChampsLus", [aInscrire]).catch((e: unknown) => {
        console.error(`sudoku : champs NON inscrits — pièce ${piece.pieceId} : ${message(e)}`);
      });
    },
  };
}

function message(e: unknown): string {
  return e instanceof Error ? e.message.slice(0, 400) : String(e);
}
