/**
 * Le Sudoku d'abord — une pièce prouvée par le moteur seul n'appelle aucun modèle.
 *
 * Décision du dirigeant du 8 novembre 2026 : « J'ai fait le Sudoku pour
 * minimiser au maximum le GPU et l'IA. » Le relevé passe d'abord par le moteur
 * seul ; si la pièce est prouvée pour TOUT ce que l'écriture exige
 * (`ref.lecture_sans_ia` : montants, sens, émetteur, numéro, date), aucun
 * modèle n'est appelé. Sinon seulement, la chaîne Claude → DeepSeek → arrêt.
 *
 * Deux étages :
 *   — la règle pure (`prouveePourLEcriture`, `selectionSansIa`), sans base ;
 *   — le chemin de production : le vrai moteur, le vrai référentiel en base,
 *     une facture prouvée → zéro appel ; une facture non prouvée → la chaîne.
 * `fetch` est interdit pour tout le fichier : un appel réseau fait tomber
 * l'épreuve.
 *
 *   node --experimental-strip-types --test src/malica/lecture/le-sudoku-d-abord.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { moteurDisponible, type SortieDuSudoku } from "@malica/sudoku";

import { deviseDEssai } from "../../scan/devise-d-essai.ts";
import { REGLES_DE_LECTURE_D_ESSAI } from "../../scan/referentiel-d-essai.ts";
import type { MaillonDeDesignation } from "./designation.ts";
import { JEU_D_OR } from "./jeu-d-or.ts";
import { entreesDuJournal } from "./read-flow.ts";
import { recollerLesMilliers } from "./recoller-les-milliers.ts";
import {
  GRILLE_DE_LA_LECTURE_CITEE,
  creerLeSudoku,
  lireLeContexteDuSudoku,
  prouveePourLEcriture,
  selectionSansIa,
  type ContexteDuSudoku,
  type ContexteDuSudokuBranche,
  type ExigenceSansIa,
} from "./sudoku.ts";
import type { PageToken } from "./token-plan.ts";
import { runVisionRead } from "./vision.ts";

const FETCH_D_ORIGINE = globalThis.fetch;
before(() => {
  globalThis.fetch = (() => {
    throw new Error("appel réseau interdit dans cette épreuve");
  }) as typeof fetch;
});
after(() => {
  globalThis.fetch = FETCH_D_ORIGINE;
});

/* ------------------------------------------------------------ LA RÈGLE PURE */

const EXIGENCES: ExigenceSansIa[] = [
  { exigence: "montants", champ: null, minimum: "prouve" },
  { exigence: "sens", champ: null, minimum: "prouve" },
  { exigence: "emetteur_matricule", champ: null, minimum: "prouve" },
  { exigence: "emetteur_nom", champ: null, minimum: "conforme" },
  { exigence: "numero", champ: "numero_facture", minimum: "conforme" },
  { exigence: "date", champ: "date_operation", minimum: "conforme" },
  { exigence: "date", champ: "date_emission", minimum: "conforme" },
];

const r = (ordinal: number) => [{ page: 1, ordinal }];

function sortie(change: Partial<SortieDuSudoku> = {}): SortieDuSudoku {
  return {
    issue: "prouvee",
    solutions: 1,
    combinaisons: 1,
    preuves: {},
    champs: {
      numero_facture: { valeur: "2026-0042", refs: r(1), statut: "conforme" },
      date_emission: { valeur: "2026-09-15", refs: r(3), statut: "conforme" },
    },
    parties: {
      sens: "achat",
      statut: "prouve",
      emetteur: {
        matricule: { valeur: "1456987L/A/P/000", refs: r(6), statut: "prouve" },
        nom: { valeur: "SOCIETE ALPHA", refs: r(4), statut: "conforme" },
      },
      client: {
        matricule: { valeur: "1876543W/A/M/000", refs: r(9), statut: "prouve" },
        nom: null,
      },
      tiers: null,
    },
    ...change,
  };
}

describe("la porte « Sudoku d'abord », la règle", () => {
  it("tout ce que l'écriture exige est tenu : la porte s'ouvre", () => {
    assert.equal(prouveePourLEcriture(sortie(), EXIGENCES), true);
  });

  it("une seule exigence manque, et la porte reste fermée", () => {
    assert.equal(prouveePourLEcriture(sortie({ issue: "ambigue" }), EXIGENCES), false, "montants");
    const base = sortie();
    const sansParties = { ...base, parties: { ...base.parties!, statut: "signale" as const } };
    assert.equal(prouveePourLEcriture(sansParties, EXIGENCES), false, "sens et émetteur");
    const sansNumero = sortie({
      champs: { date_emission: base.champs["date_emission"]! },
    });
    assert.equal(prouveePourLEcriture(sansNumero, EXIGENCES), false, "numéro");
    const numeroSignale = sortie({
      champs: {
        ...base.champs,
        numero_facture: { valeur: "x", refs: r(1), statut: "signale" },
      },
    });
    assert.equal(prouveePourLEcriture(numeroSignale, EXIGENCES), false, "un signalé ne suffit pas");
  });

  it("aucune exigence au pack : la porte ne s'ouvre pas sur un référentiel muet", () => {
    assert.equal(prouveePourLEcriture(sortie(), []), false);
  });

  it("la sélection sans IA ne porte que ce qui est tenu, cité dans le plan", () => {
    const grille = { code: "facture", champs: [], preuves: [] };
    const s = selectionSansIa(sortie(), grille, [], EXIGENCES);
    assert.equal(s.document_kind, "facture_achat");
    assert.deepEqual(s.issuer, { page: 1, ordinal: 4 });
    assert.deepEqual(s.document_date, { page: 1, ordinal: 3 });
    assert.deepEqual(s.references["numero"], { page: 1, ordinal: 1 });
    assert.deepEqual(s.references["matricule_fiscal"], { page: 1, ordinal: 6 });
    assert.deepEqual(s.totals, { base_ht: null, vat: null, ttc: null }, "rien d'inventé");
  });
});

/* ------------------------------------------------ LA PORTE DANS LA LECTURE */

const PLAN_MINIMAL: PageToken[] = ["FACTURE", "TOTAL", "118,000"].map((text, ordinal) => ({
  page: 1,
  ordinal,
  text,
  x0: 0.1,
  y0: 0.1 + ordinal * 0.1,
  x1: 0.4,
  y1: 0.15 + ordinal * 0.1,
})) as PageToken[];

const CHAINE: MaillonDeDesignation[] = [
  {
    rang: 1,
    fournisseur: "anthropic",
    modele: "claude-haiku-5-5",
    role: "chat",
    periode: "mois",
    plafond: 500,
    depense: 0,
    epuise: false,
  },
];

describe("la porte dans la lecture", () => {
  it("prouvée : aucun modèle appelé, et le journal compte une pièce lue sans IA", async () => {
    let appels = 0;
    let chaineLue = false;
    const lu = await runVisionRead({
      dataUrl: "data:,",
      tokens: PLAN_MINIMAL,
      releveur: "pdf-text",
      taxCodes: [],
      sudokuDAbord: async () => ({
        ...selectionSansIa(
          sortie({ issue: "aucune" }),
          { code: "f", champs: [], preuves: [] },
          [],
          EXIGENCES,
        ),
      }),
      designation: {
        chaine: async () => {
          chaineLue = true;
          return CHAINE;
        },
        appeler: async () => {
          appels += 1;
          throw new Error("aucun modèle ne doit être appelé");
        },
      },
    });
    assert.equal(appels, 0);
    assert.equal(chaineLue, false, "la chaîne n'est même pas lue en base");
    assert.equal(lu.prouveeSansIa, true);
    assert.equal(lu.selectModel, "sudoku");
    const journal = entreesDuJournal(lu).map((e) => [e.agent, e.model, e.role, e.status]);
    assert.deepEqual(journal, [
      ["malica.lecture.releve", "pdf-text", "vision", "ok"],
      ["malica.lecture.designation", "sudoku", "sudoku", "ok"],
    ]);
  });

  it("non prouvée : la chaîne est appelée, comme avant", async () => {
    let appels = 0;
    const lu = await runVisionRead({
      dataUrl: "data:,",
      tokens: PLAN_MINIMAL,
      releveur: "pdf-text",
      taxCodes: [],
      sudokuDAbord: async () => null,
      designation: {
        chaine: async () => CHAINE,
        appeler: async () => {
          appels += 1;
          return { answer: "{}", tokensIn: 10, tokensOut: 2, latencyMs: 1 };
        },
      },
    });
    assert.equal(appels, 1);
    assert.equal(lu.prouveeSansIa, undefined);
    assert.equal(lu.selectModel, "claude-haiku-5-5");
  });
});

/* -------------------------------------------- LE CHEMIN DE PRODUCTION (vrai moteur) */

const MOTEUR = moteurDisponible();
const BASE = process.env["DATABASE_URL_ADMIN"];
const devise = deviseDEssai(3);
const JOUR = "2026-09-15";
const MF_DOSSIER = JEU_D_OR[0]!.matriculeDossier!;
const MF_FOURNISSEUR = String(JEU_D_OR[0]!.attendu["references.matricule_fiscal"]);

const mot = (ordinal: number, y: number, x: number, text: string): PageToken => ({
  page: 1,
  ordinal,
  text,
  x0: x,
  y0: y,
  // La largeur suit le texte : des boîtes qui se chevauchent ne se lisent pas en rangée.
  x1: x + text.length * 0.008,
  y1: y + 0.015,
});

/** Une facture fictive complète : émetteur, client, numéro, date, totaux et timbre. */
const FACTURE: PageToken[] = [
  mot(0, 0.05, 0.05, "SOCIETE"),
  mot(1, 0.05, 0.12, "ALPHA"),
  mot(2, 0.05, 0.19, "SARL"),
  mot(3, 0.07, 0.05, "Matricule"),
  mot(4, 0.07, 0.12, "fiscal"),
  mot(5, 0.07, 0.2, ":"),
  mot(6, 0.07, 0.23, MF_FOURNISSEUR),
  mot(7, 0.12, 0.05, "Facture"),
  mot(8, 0.12, 0.13, "N°"),
  mot(9, 0.12, 0.17, "2026-0042"),
  mot(10, 0.14, 0.05, "Date"),
  mot(11, 0.14, 0.1, ":"),
  mot(12, 0.14, 0.13, "15/09/2026"),
  mot(13, 0.18, 0.55, "Client"),
  mot(14, 0.18, 0.62, ":"),
  mot(15, 0.18, 0.65, "ALGORIA"),
  mot(16, 0.18, 0.72, "FACTORY"),
  mot(17, 0.2, 0.55, "MF"),
  mot(18, 0.2, 0.6, "client"),
  mot(19, 0.2, 0.67, ":"),
  mot(20, 0.2, 0.7, MF_DOSSIER),
  mot(21, 0.38, 0.54, "Total"),
  mot(22, 0.38, 0.58, "HT"),
  mot(23, 0.38, 0.84, "9 835,000"),
  mot(24, 0.4, 0.54, "TVA"),
  mot(25, 0.4, 0.57, "19 %"),
  mot(26, 0.4, 0.84, "1 868,650"),
  mot(27, 0.42, 0.54, "Total"),
  mot(28, 0.42, 0.58, "TTC"),
  mot(29, 0.42, 0.84, "11 703,650"),
  mot(30, 0.44, 0.54, "Timbre"),
  mot(31, 0.44, 0.87, "1,000"),
  mot(32, 0.46, 0.54, "Net"),
  mot(33, 0.46, 0.57, "à"),
  mot(34, 0.46, 0.59, "payer"),
  mot(35, 0.46, 0.83, "11 704,650"),
];

describe("le Sudoku d'abord, sur le vrai moteur", { skip: !(MOTEUR && BASE) }, () => {
  let pool: pg.Pool;
  let contexte: ContexteDuSudoku;

  before(async () => {
    pool = new pg.Pool({ connectionString: BASE });
    const { rows } = await pool.query<{ id: string }>(
      `select id from ref_packs_v where jurisdiction = 'TN'
        and effective_from <= $1::date order by effective_from desc limit 1`,
      [JOUR],
    );
    const c = await pool.connect();
    try {
      contexte = await lireLeContexteDuSudoku(
        c,
        rows[0]!.id,
        GRILLE_DE_LA_LECTURE_CITEE,
        "TND",
        JOUR,
      );
    } finally {
      c.release();
    }
  });
  after(async () => {
    await pool.end();
  });

  const sudokuDe = (tiers: { code: string; identifiantFiscal: string; raisonSociale: string }[]) =>
    creerLeSudoku(
      {
        async rpc<T>(_d: string, methode: string): Promise<T> {
          if (methode === "contexteSudoku")
            return { ...contexte, mode: "observe" } satisfies ContexteDuSudokuBranche as T;
          return undefined as T;
        },
        async contenu(): Promise<never> {
          throw new Error("hors base");
        },
      },
      {
        pieceId: "p",
        dossierId: "d",
        packId: "k",
        recueLe: JOUR,
        dates: REGLES_DE_LECTURE_D_ESSAI.dates,
        devise,
        dossier: { matricule: MF_DOSSIER, raisonSociale: "ALGORIA FACTORY" },
        tiers,
      },
    );

  it("le référentiel porte ses exigences : la porte a de quoi juger", () => {
    const ex = contexte.exigencesSansIa ?? [];
    assert.deepEqual([...new Set(ex.map((e) => e.exigence))].sort(), [
      "date",
      "emetteur_matricule",
      "emetteur_nom",
      "montants",
      "numero",
      "sens",
    ]);
  });

  it("une facture prouvée de bout en bout : zéro appel, et ce qui est lu est cité", async () => {
    const sudoku = sudokuDe([
      { code: "F001", identifiantFiscal: MF_FOURNISSEUR, raisonSociale: "SOCIETE ALPHA SARL" },
    ]);
    let appels = 0;
    const lu = await runVisionRead({
      dataUrl: "data:,",
      tokens: FACTURE,
      releveur: "pdf-text",
      taxCodes: [],
      sudokuDAbord: (plan) => sudoku.sansIa(plan),
      designation: {
        chaine: async () => CHAINE,
        appeler: async () => {
          appels += 1;
          throw new Error("aucun modèle ne doit être appelé");
        },
      },
    });
    assert.equal(appels, 0, "aucun modèle appelé");
    assert.equal(lu.prouveeSansIa, true);
    assert.equal(lu.selection.document_kind, "facture_achat");
    assert.deepEqual(lu.selection.totals.ttc, { page: 1, ordinal: 35 }, "le net à payer");
    assert.deepEqual(lu.selection.references["numero"], { page: 1, ordinal: 9 });
    assert.deepEqual(lu.selection.document_date, { page: 1, ordinal: 12 });
    assert.deepEqual(lu.selection.references["matricule_fiscal"], { page: 1, ordinal: 6 });
  });

  it("une facture prouvée en montants mais sans ses parties : la chaîne est appelée", async () => {
    const cas = JEU_D_OR[0]!;
    const sudoku = sudokuDe([]);
    let appels = 0;
    await runVisionRead({
      dataUrl: "data:,",
      tokens: recollerLesMilliers(cas.tokens),
      releveur: "pdf-text",
      taxCodes: [],
      sudokuDAbord: (plan) => sudoku.sansIa(plan),
      designation: {
        chaine: async () => CHAINE,
        appeler: async () => {
          appels += 1;
          return { answer: "{}", tokensIn: 10, tokensOut: 2, latencyMs: 1 };
        },
      },
    });
    assert.equal(appels, 1, "non prouvée pour l'écriture : la chaîne part");
  });
});
