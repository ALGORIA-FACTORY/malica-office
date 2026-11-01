import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import pg from "pg";

import { moteurDisponible, type Grille, type SortieDuSudoku } from "@malica/sudoku";

import { deviseDEssai, devisesDEssai } from "../../scan/devise-d-essai.ts";
import { REGLES_DE_LECTURE_D_ESSAI } from "../../scan/referentiel-d-essai.ts";
import { JEU_D_OR } from "./jeu-d-or.ts";
import { buildExtractFromTokenPlan } from "./read-piece.ts";
import { recollerLesMilliers } from "./recoller-les-milliers.ts";
import {
  champsDeLaGrille,
  champsLusAInscrire,
  creerLeSudoku,
  type ChampsLusAInscrire,
  type ContexteDuSudokuBranche,
  GRILLE_DE_LA_LECTURE_CITEE,
  jetonsDuSudoku,
  jourDeLaLecture,
  lireLeContexteDuSudoku,
  modeDuSudoku,
  resoudreLaPiece,
  selectionParLeSudoku,
  type ContexteDuSudoku,
} from "./sudoku.ts";
import type { PageToken } from "./token-plan.ts";
import type { VisionRead } from "./vision.ts";

/**
 * Le sudoku, par le chemin de production.
 *
 * Deux étages. Le premier est pur : la conversion du plan en jetons, la
 * sélection rendue, les champs inscrits. Le second rejoue les bancs avec le
 * VRAI chemin — treillis TypeScript, grille et pack lus en base par
 * l'adaptateur, moteur WebAssembly — et tient les seuils mesurés :
 *
 *   — zéro fausse preuve, sur les factures comme sur 3 000 lectures corrompues ;
 *   — 59 factures sur 60 prouvées justes (F008 imprime son total HT
 *     « 165.747.027 » : l'OCR a remplacé la virgule, le treillis n'en tire
 *     que la lecture en milliers, et la pièce est signalée — pas prouvée fausse) ;
 *   — les 6 tickets, qui ne sont pas des factures, jamais prouvés ;
 *   — la facture réelle du jeu d'or prouvée, et son extrait identique à celui
 *     de la désignation enregistrée.
 *
 * Le second étage exige le moteur construit (`npm run build -w @malica/sudoku`)
 * et une base migrée. La CI pose `MALICA_SUDOKU_EXIGE=1` : là, un moteur absent
 * est un échec, pas un test sauté.
 */

const devise = deviseDEssai(3);
/** Le dossier de la facture réelle du jeu d'or : son matricule dit le sens. */
const DOSSIER_D_OR = { matricule: JEU_D_OR[0]!.matriculeDossier, raisonSociale: "ALGORIA FACTORY" };
/** Les règles de lecture du pack d'essai, et une grille sans preuve de lettres. */
const LECTURE = {
  regles: REGLES_DE_LECTURE_D_ESSAI,
  grille: { code: "facture", champs: [], preuves: [] } satisfies Grille,
};

describe("sudoku — les jetons du plan", () => {
  const plan: PageToken[] = [
    { page: 1, ordinal: 0, text: "3 020,000", x0: 0, y0: 0, x1: 1, y1: 1 },
    { page: 1, ordinal: 1, text: "16000", x0: 0, y0: 0, x1: 1, y1: 1 },
    { page: 1, ordinal: 2, text: "01/09/2026", x0: 0, y0: 0, x1: 1, y1: 1 },
    { page: 1, ordinal: 3, text: "Total HT", x0: 0, y0: 0, x1: 1, y1: 1 },
  ];
  const j = jetonsDuSudoku(plan, devise, LECTURE);

  it("une décimale imprimée est forte", () => {
    assert.deepEqual(j[0]!.montants, [{ v: 3_020_000, forte: true }]);
  });

  it("une virgule perdue reste faible : aucun séparateur n'est imprimé", () => {
    assert.ok(j[1]!.montants.length > 0);
    assert.ok(j[1]!.montants.every((m) => !m.forte));
  });

  it("une date n'est pas un montant, et se lit en date", () => {
    assert.deepEqual(j[2]!.montants, []);
    assert.equal(j[2]!.date, "2026-09-01");
  });

  it("un libellé n'a aucune lecture", () => {
    assert.deepEqual(j[3]!.montants, []);
    assert.equal(j[3]!.date, null);
  });

  it("les experts de l'adaptateur lisent avec les règles du pack : date en morceaux, matricule vu", () => {
    const rangee = (texts: string[]): PageToken[] =>
      texts.map((text, ordinal) => ({
        page: 1,
        ordinal,
        text,
        x0: 0.1 * ordinal,
        y0: 0.1,
        x1: 0.1 * ordinal + 0.08,
        y1: 0.12,
      }));
    const [, jour, mois, annee] = jetonsDuSudoku(
      rangee(["Date", "13", "mai", "2026"]),
      devise,
      LECTURE,
    );
    // Portée par le premier morceau, citée jusqu'au dernier.
    assert.equal(jour!.date, "2026-05-13");
    assert.equal(jour!.date_fin, 3);
    assert.equal(mois!.date, null);
    assert.equal(annee!.date, null);
    // L'étiquette collée, le « l » pour « 1 » : le lecteur du pack le rend normalisé.
    const [mf] = jetonsDuSudoku(rangee(["MF:l876543W/A/M/000"]), devise, LECTURE);
    assert.deepEqual(mf!.identifiants, [
      { format: REGLES_DE_LECTURE_D_ESSAI.codeDuMatricule, valeur: "1876543W/A/M/000", fin: 0 },
    ]);
  });

  it("deux cases collées par l'OCR offrent leurs coupes, lues par le lecteur de production", () => {
    const [colle, seul] = jetonsDuSudoku(
      [
        { page: 1, ordinal: 0, text: "12400,000", x0: 0, y0: 0, x1: 1, y1: 1 },
        { page: 1, ordinal: 1, text: "3 020,000", x0: 0, y0: 0, x1: 1, y1: 1 },
      ],
      devise,
      LECTURE,
    );
    assert.deepEqual(colle!.decoupes, [
      { coupe: 1, gauche: 1_000, droite: [{ v: 2_400_000, forte: true }] },
      { coupe: 2, gauche: 12_000, droite: [{ v: 400_000, forte: true }] },
    ]);
    // Un montant à espace de milliers n'est pas une case collée.
    assert.equal(seul!.decoupes, undefined);
  });
});

/** Une grille comme celle de la base : les rôles des champs viennent de ses preuves. */
const GRILLE: Grille = {
  code: "facture",
  champs: [],
  preuves: [
    {
      code: "P03",
      statut: "defaut_a_valider",
      variante: null,
      expression: {
        op: "groupe_taux",
        base: "base_tva_par_taux",
        montant: "montant_tva_par_taux",
        total_base: "total_ht",
        bareme: "tva",
      },
    },
    {
      code: "P04",
      statut: "defaut_a_valider",
      variante: "ttc_avec_timbre",
      expression: { op: "somme", total: "total_ttc", parties: [], role: "ttc" },
    },
    {
      code: "M03",
      statut: "defaut_a_valider",
      variante: "ttc_hors_timbre",
      expression: { op: "somme", total: "total_ttc", parties: [] },
    },
    {
      code: "M04",
      statut: "defaut_a_valider",
      variante: "ttc_hors_timbre",
      expression: { op: "somme", total: "net_a_payer", parties: [], role: "ttc" },
    },
    {
      code: "M01",
      statut: "defaut_a_valider",
      variante: null,
      expression: { op: "charge", code: "DROIT_TIMBRE", montant: "droit_timbre" },
    },
    {
      code: "M02",
      statut: "defaut_a_valider",
      variante: null,
      expression: { op: "charge", code: "FODEC", montant: "montant_fodec", base: "total_ht" },
    },
    {
      code: "L01",
      statut: "defaut_a_valider",
      variante: null,
      expression: {
        op: "lignes",
        designation: "designation",
        quantite: "quantite",
        prix: "prix_unitaire_ht",
        remise: "remise_ligne?",
        montant: "montant_ligne_ht",
        taux: "taux_tva_ligne?",
        total: "total_ht",
        remise_globale: "remise_globale?",
      },
    },
  ],
};
const CONTEXTE = { jour: "2026-09-01", grille: GRILLE, regles: REGLES_DE_LECTURE_D_ESSAI };
const PIECE = { pieceId: "p", packId: "k" };

describe("sudoku — la sélection rendue", () => {
  const cas = JEU_D_OR[0]!;
  const ref = (ordinal: number) => [{ page: 1, ordinal }];
  const prouvee: SortieDuSudoku = {
    issue: "prouvee",
    variante: "ttc_avec_timbre",
    solutions: 1,
    combinaisons: 1,
    preuves: {},
    champs: {
      total_ht: { valeur: "3020000", refs: ref(107), statut: "prouve" },
      total_ttc: { valeur: "3594800", refs: ref(114), statut: "prouve" },
      base_tva_par_taux: {
        valeur: null,
        refs: [],
        statut: "prouve",
        instances: [{ taux: "TVA19", valeur: "3020000", refs: ref(107) }],
      },
      montant_tva_par_taux: {
        valeur: null,
        refs: [],
        statut: "prouve",
        instances: [{ taux: "TVA19", valeur: "573800", refs: ref(110) }],
      },
      droit_timbre: { valeur: "1000", refs: ref(112), statut: "prouve" },
      montant_fodec: { valeur: null, refs: [], statut: "absent" },
    },
  };
  it("une pièce non prouvée garde la sélection de la chaîne, à l'identique", () => {
    const s = selectionParLeSudoku(cas.designation, { ...prouvee, issue: "ambigue" }, GRILLE, []);
    assert.equal(s, cas.designation);
  });

  it("les champs se lisent par leur rôle dans les preuves, pas par un code écrit", () => {
    // Le même rôle sous d'autres noms : la sélection suit la grille.
    const renommee: Grille = {
      ...GRILLE,
      preuves: GRILLE.preuves.map((p) => ({
        ...p,
        expression: JSON.parse(
          JSON.stringify(p.expression)
            .replaceAll('"total_ht"', '"ht_x"')
            .replaceAll('"total_ttc"', '"ttc_x"'),
        ) as unknown,
      })),
    };
    const sortie: SortieDuSudoku = {
      ...prouvee,
      champs: {
        ...prouvee.champs,
        ht_x: prouvee.champs["total_ht"]!,
        ttc_x: { valeur: "3594800", refs: ref(99), statut: "prouve" },
      },
    };
    const s = selectionParLeSudoku(cas.designation, sortie, renommee, []);
    assert.deepEqual(s.totals.base_ht, { page: 1, ordinal: 107 });
    assert.deepEqual(s.totals.ttc, { page: 1, ordinal: 99 });
    // Le TTC de la chaîne vient de la preuve au rôle « ttc » de la variante qui a prouvé.
    const net = selectionParLeSudoku(
      cas.designation,
      {
        ...prouvee,
        variante: "ttc_hors_timbre",
        champs: {
          ...prouvee.champs,
          net_a_payer: { valeur: "3595800", refs: ref(116), statut: "prouve" },
        },
      },
      GRILLE,
      [],
    );
    assert.deepEqual(net.totals.ttc, { page: 1, ordinal: 116 });
  });

  it("prouvée : totaux, ligne de TVA et droits sont ceux de la preuve", () => {
    const s = selectionParLeSudoku(
      { ...cas.designation, other_charges: [{ code: "AUTRE", amount: { page: 1, ordinal: 1 } }] },
      prouvee,
      GRILLE,
      ["DROIT_TIMBRE", "FODEC"],
    );
    assert.deepEqual(s.totals, {
      base_ht: { page: 1, ordinal: 107 },
      vat: { page: 1, ordinal: 110 },
      ttc: { page: 1, ordinal: 114 },
    });
    assert.deepEqual(
      s.lines.map((l) => [l.tax_code, l.base_ht, l.vat_amount]),
      [["TVA19", { page: 1, ordinal: 107 }, { page: 1, ordinal: 110 }]],
    );
    // Le droit que la grille ne prouve pas reste ; le FODEC absent n'est pas ajouté.
    assert.deepEqual(
      s.other_charges.map((c) => c.code),
      ["AUTRE", "DROIT_TIMBRE"],
    );
    // Ce qui n'est pas un montant n'est pas touché.
    assert.equal(s.issuer, cas.designation.issuer);
    assert.equal(s.document_date, cas.designation.document_date);
    assert.equal(s.document_kind, cas.designation.document_kind);
  });

  it("une lecture non prouvée s'inscrit aussi : champs signalés, sans valeur ni citation", () => {
    const a = champsLusAInscrire(PIECE, CONTEXTE, {
      issue: "ambigue",
      solutions: 2,
      combinaisons: 9,
      preuves: {},
      champs: {
        total_ht: { valeur: null, refs: [], statut: "signale" },
        montant_fodec: { valeur: null, refs: [], statut: "absent" },
      },
    });
    assert.equal(a.issue, "ambigue");
    assert.deepEqual(a.champs, [
      {
        champ: "total_ht",
        rang: null,
        instance: null,
        valeur: null,
        statut: "signale",
        citations: [],
      },
    ]);
    assert.deepEqual([a.packId, a.jour, a.grille], ["k", "2026-09-01", "facture"]);
  });

  it("une sortie sans aucun champ laisse une ligne de tentative", () => {
    const a = champsLusAInscrire(PIECE, CONTEXTE, {
      issue: "aucune",
      solutions: 0,
      combinaisons: 0,
      preuves: {},
      champs: {},
      raison: "entrée invalide",
    });
    assert.deepEqual(a.champs, [
      { champ: null, rang: null, instance: null, valeur: null, statut: null, citations: [] },
    ]);
  });

  it("seule la lecture retenue s'inscrit, après sa persistance", async () => {
    const appels: Array<{ methode: string; args: unknown[] }> = [];
    const api = {
      async rpc<T>(_depot: string, methode: string, args: unknown[] = []): Promise<T> {
        appels.push({ methode, args });
        throw new Error("hors base");
      },
      async contenu() {
        throw new Error("hors base");
      },
    };
    const sudoku = creerLeSudoku(api, {
      pieceId: "p",
      dossierId: "d",
      packId: "k",
      recueLe: "2026-10-02",
      dates: REGLES_DE_LECTURE_D_ESSAI.dates,
      devise,
      dossier: DOSSIER_D_OR,
      tiers: [],
    });
    const lecture = { tokens: [], selection: cas.designation } as unknown as VisionRead;
    // Le contexte est illisible : la lecture ressort à l'identique, rien ne s'inscrit.
    assert.equal(await sudoku.lire(lecture), lecture);
    await sudoku.inscrire(lecture);
    assert.deepEqual(
      appels.map((a) => a.methode),
      ["contexteSudoku"],
    );
    // Sans date lue, les règles se lisent au jour de la réception.
    assert.deepEqual(appels[0]!.args, ["d", "k", "facture", devise.code, "2026-10-02"]);
  });

  it("les règles se lisent au jour de la pièce : la date lue, à défaut la réception", () => {
    const jeton = (ordinal: number, text: string) => ({
      page: 1,
      ordinal,
      text,
      x0: 0,
      y0: 0,
      x1: 1,
      y1: 1,
    });
    const avec = (date: { page: number; ordinal: number } | null, texte: string) =>
      ({
        tokens: [jeton(0, "Date"), jeton(1, texte)],
        selection: { ...cas.designation, document_date: date },
      }) as unknown as VisionRead;
    assert.equal(
      jourDeLaLecture(
        avec({ page: 1, ordinal: 1 }, "15/03/2026"),
        "2026-10-02",
        REGLES_DE_LECTURE_D_ESSAI.dates,
      ),
      "2026-03-15",
    );
    assert.equal(
      jourDeLaLecture(avec(null, "15/03/2026"), "2026-10-02", REGLES_DE_LECTURE_D_ESSAI.dates),
      "2026-10-02",
    );
    // Une date illisible n'est pas devinée : la réception.
    assert.equal(
      jourDeLaLecture(
        avec({ page: 1, ordinal: 1 }, "31/02/2026"),
        "2026-10-02",
        REGLES_DE_LECTURE_D_ESSAI.dates,
      ),
      "2026-10-02",
    );
  });

  it("le mode vient du réglage du dossier ; absent ou inconnu, il n'est pas deviné", () => {
    assert.equal(modeDuSudoku(new Map([["lecture.sudoku", "observe"]])), "observe");
    assert.equal(modeDuSudoku(new Map([["lecture.sudoku", "designe"]])), "designe");
    assert.throws(() => modeDuSudoku(new Map()), /reglage\.lecture\.illisible/);
    assert.throws(
      () => modeDuSudoku(new Map([["lecture.sudoku", "oui"]])),
      /reglage\.lecture\.illisible/,
    );
  });

  it("une cellule lue dans une coupe s'inscrit avec sa coupe, et ne se relit pas dans son jeton", () => {
    const cite = (valeur: string, ordinal: number) => ({ valeur, refs: ref(ordinal) });
    const lignes: SortieDuSudoku["lignes"] = {
      statut: "prouve",
      taux_par_base: "ligne",
      instances: [
        {
          designation: cite("Article", 80),
          quantite: { ...cite("1000", 88), statut: "coupe", coupe: 1 },
          prix: { ...cite("2400000", 88), statut: "coupe", coupe: 1 },
          remise: null,
          montant: cite("2400000", 90),
          taux: null,
        },
      ],
      remise_globale: cite("406000", 120),
    };
    const sortie = { ...prouvee, lignes };
    const a = champsLusAInscrire(PIECE, CONTEXTE, sortie);
    // Le rang de la ligne a sa colonne ; le code de la cellule vient de la preuve « lignes ».
    const q = a.champs.find((c) => c.champ === "quantite" && c.rang === 1)!;
    assert.equal(q.statut, "coupe");
    assert.deepEqual(q.citations, [{ page: 1, ordinal: 88, coupe: 1 }]);
    assert.deepEqual(a.champs.find((c) => c.champ === "prix_unitaire_ht")?.rang, 1);
    assert.deepEqual(
      a.champs.find((c) => c.champ === "remise_globale"),
      {
        champ: "remise_globale",
        rang: null,
        instance: null,
        valeur: "406000",
        statut: "prouve",
        citations: ref(120),
      },
    );
    // Dans la chaîne, le jeton collé porte deux cases : ni quantité ni prix n'y sont relus.
    const s = selectionParLeSudoku(cas.designation, sortie, GRILLE, []);
    assert.deepEqual(
      s.articles.map((x) => [x.quantity, x.unit_price_ht, x.total_ht]),
      [[null, null, { page: 1, ordinal: 90 }]],
    );
  });

  it("les champs inscrits portent tous leur citation, un par taux, le taux dans sa colonne", () => {
    const a = champsLusAInscrire(PIECE, CONTEXTE, prouvee);
    assert.deepEqual(
      a.champs.map((c) => [c.champ, c.instance]),
      [
        ["total_ht", null],
        ["total_ttc", null],
        ["base_tva_par_taux", "TVA19"],
        ["montant_tva_par_taux", "TVA19"],
        ["droit_timbre", null],
      ],
    );
    assert.ok(a.champs.every((c) => c.citations.length > 0));
  });

  it("un matricule dont la lettre de contrôle ne tient pas sa règle s'inscrit, averti", () => {
    const format = REGLES_DE_LECTURE_D_ESSAI.codeDuMatricule;
    const grille: Grille = {
      ...GRILLE,
      champs: ["matricule_fiscal_emetteur", "matricule_fiscal_client"].map((code) => ({
        code,
        type: "identifiant",
        reperes_fr: [],
        reperes_ar: [],
        format_code: format,
      })),
    };
    const lu = (valeur: string, ordinal: number) => ({
      valeur,
      refs: ref(ordinal),
      statut: "prouve" as const,
    });
    const a = champsLusAInscrire(
      PIECE,
      { ...CONTEXTE, grille },
      {
        ...prouvee,
        champs: {
          // 1876543 appelle « C » : « W » ne tient pas la règle (non publiée) — averti.
          matricule_fiscal_client: lu("1876543W/A/M/000", 4),
          matricule_fiscal_emetteur: lu("1876543C/A/M/000", 5),
        },
      },
    );
    assert.deepEqual(
      a.champs.map((c) => [c.champ, c.statut, c.avertissement ?? null]),
      [
        ["matricule_fiscal_client", "prouve", "lettre_de_controle_discordante"],
        ["matricule_fiscal_emetteur", "prouve", null],
      ],
    );
  });

  it("une valeur sans citation s'inscrit nulle, avec son statut (R2)", () => {
    const lignes: SortieDuSudoku["lignes"] = {
      statut: "prouve",
      taux_par_base: "ligne",
      instances: [
        {
          designation: null,
          quantite: { valeur: "1000", refs: ref(1) },
          prix: { valeur: "5000", refs: ref(2) },
          remise: null,
          montant: { valeur: "5000", refs: ref(3) },
          // Le taux d'une ligne déduit de sa base, sans jeton imprimé.
          taux: { code: "TVA19", refs: [] },
        },
      ],
    };
    const a = champsLusAInscrire(PIECE, CONTEXTE, { ...prouvee, lignes });
    assert.deepEqual(
      a.champs.find((c) => c.champ === "taux_tva_ligne"),
      {
        champ: "taux_tva_ligne",
        rang: 1,
        instance: null,
        valeur: null,
        statut: "prouve",
        citations: [],
      },
    );
    assert.ok(a.champs.every((c) => c.valeur === null || c.citations.length > 0));
  });
});

/* =========================== LE CHEMIN DE PRODUCTION : moteur + base ===== */

const EXIGE = process.env["MALICA_SUDOKU_EXIGE"] === "1";
const BASE = process.env["DATABASE_URL_ADMIN"];
const MOTEUR = moteurDisponible();
if (EXIGE) {
  assert.ok(MOTEUR, "MALICA_SUDOKU_EXIGE=1 : le moteur WebAssembly doit être construit");
  assert.ok(BASE, "MALICA_SUDOKU_EXIGE=1 : la base migrée doit être configurée");
}

const DONNEES = new URL("../../../../../packages/sudoku/tests/donnees/", import.meta.url);
const lire = (nom: string): unknown => JSON.parse(readFileSync(new URL(nom, DONNEES), "utf8"));

interface Ligne {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
interface Verite {
  id: string;
  type: string;
  ht: number;
  ttc: number;
  timbre?: number | null;
  fodec_mt?: number | null;
  tva?: Record<string, number>;
}

describe("sudoku — le chemin de production", { skip: !(MOTEUR && BASE) }, () => {
  let contexte: ContexteDuSudoku;
  let pool: pg.Pool;
  let packId = "";
  /** Le jour des pièces du banc : septembre 2026. */
  const JOUR = "2026-09-15";
  const contexteAu = async (jour: string) => {
    const c = await pool.connect();
    try {
      return await lireLeContexteDuSudoku(c, packId, GRILLE_DE_LA_LECTURE_CITEE, "TND", jour);
    } finally {
      c.release();
    }
  };

  before(async () => {
    pool = new pg.Pool({ connectionString: BASE });
    const { rows } = await pool.query<{ id: string }>(
      `select id from ref_packs_v where jurisdiction = 'TN'
        and effective_from <= $1::date order by effective_from desc limit 1`,
      [JOUR],
    );
    packId = rows[0]!.id;
    contexte = await contexteAu(JOUR);
  });
  after(async () => {
    await pool.end();
  });

  const jouer = (plan: readonly PageToken[]) =>
    resoudreLaPiece(jetonsDuSudoku(plan, devise, contexte), contexte);

  const valeur = (o: SortieDuSudoku, champ: string) => Number(o.champs[champ]?.valeur ?? 0);
  const pourMille = (code: string) =>
    contexte.pack.baremes["tva"]!.find((t) => t.code === code)!.ppm / 1000;
  const tva = (o: SortieDuSudoku) =>
    JSON.stringify(
      (o.champs["montant_tva_par_taux"]?.instances ?? [])
        .map((i) => [pourMille(i.taux), Number(i.valeur ?? 0)])
        .sort((a, b) => a[0]! - b[0]!),
    );
  const tvaVraie = (v: Verite) =>
    JSON.stringify(
      Object.entries(v.tva ?? {})
        .map(([t, m]) => [Number(t), m])
        .sort((a, b) => a[0]! - b[0]!),
    );
  const juste = (v: Verite, o: SortieDuSudoku, droits: boolean) =>
    valeur(o, "total_ht") === v.ht &&
    valeur(o, "total_ttc") === v.ttc &&
    tva(o) === tvaVraie(v) &&
    (!droits ||
      (valeur(o, "droit_timbre") === (v.timbre ?? 0) &&
        valeur(o, "montant_fodec") === (v.fodec_mt ?? 0)));

  const planDe = (lignes: readonly Ligne[]): PageToken[] =>
    lignes.map((l, i) => ({ page: 1, ordinal: i, ...l }));
  const releves = lire("banc3_releves.json") as Record<string, { lignes: Ligne[] }>;
  const verites = new Map((lire("banc3_verite.json") as Verite[]).map((v) => [v.id, v]));

  it("la facture réelle du jeu d'or est prouvée, et son extrait ne change pas", () => {
    for (const cas of JEU_D_OR) {
      // Le plan que la chaîne donne au désignateur est recollé (`relever()`).
      const plan = recollerLesMilliers(cas.tokens);
      const o = jouer(plan);
      assert.equal(o.issue, "prouvee", `${cas.nom} : ${o.raison ?? ""}`);
      const sel = selectionParLeSudoku(
        cas.designation,
        o,
        contexte.grille,
        contexte.pack.charges.map((c) => c.code),
      );
      const extrait = (s: typeof sel) =>
        buildExtractFromTokenPlan({
          tokens: plan,
          selection: s,
          ...devisesDEssai(3),
          matriculeDossier: cas.matriculeDossier,
        }).extract;
      const montants = (x: ReturnType<typeof extrait>) =>
        JSON.stringify({ t: x["totals"], l: x["lines"], c: x["other_charges"] });
      assert.equal(montants(extrait(sel)), montants(extrait(cas.designation)));
      // L'anneau 2 : le sens ne se prouve que par un indice imprimé (« client »,
      // « émetteur »…) ; la géométrie seule ne tranche pas (mesuré : 4 sens faux sur
      // les mises en page à colonne latérale). Sur cette facture, aucun indice :
      // les parties sont signalées, et la sélection garde les matricules de la chaîne.
      // Prouvées, elles devraient être exactement celles du jeu d'or.
      const avecDossier = resoudreLaPiece(
        jetonsDuSudoku(plan, devise, contexte),
        contexte,
        undefined,
        {
          dossier: { matricule: cas.matriculeDossier!, raison_sociale: null },
          tiers: [],
          formes_juridiques: contexte.formesJuridiques,
        },
      );
      const selParties = selectionParLeSudoku(
        cas.designation,
        avecDossier,
        contexte.grille,
        contexte.pack.charges.map((c) => c.code),
      );
      const refs = extrait(selParties)["references"] as Record<string, unknown>;
      if (avecDossier.parties?.statut === "prouve") {
        assert.equal(avecDossier.parties.sens, "achat");
      }
      assert.equal(refs["matricule_fiscal"], cas.attendu["references.matricule_fiscal"]);
      assert.equal(
        refs["matricule_fiscal_client"],
        cas.attendu["references.matricule_fiscal_client"],
      );
      // L'anneau 1 : les articles prouvés valent ceux du jeu d'or, montant par montant.
      assert.equal(o.lignes?.statut, "prouve", `${cas.nom} : lignes ${o.lignes?.statut}`);
      for (const [chemin, attendu] of Object.entries(cas.attendu)) {
        const m = /^articles\[(\d+)\]\.(quantity|unit_price_ht|total_ht)$/.exec(chemin);
        if (!m) continue;
        const a = (extrait(sel)["articles"] as Array<Record<string, unknown>>)[Number(m[1])];
        assert.equal(a?.[m[2]!], attendu, `${cas.nom} : ${chemin}`);
      }
    }
  });

  it("observe par défaut : la lecture ressort à l'identique, et ce qu'il a lu s'inscrit", async () => {
    const cas = JEU_D_OR[0]!;
    const lecture = {
      tokens: recollerLesMilliers(cas.tokens),
      selection: cas.designation,
    } as unknown as VisionRead;
    const essayer = async (designe: boolean) => {
      const inscrits: unknown[] = [];
      const api = {
        async rpc<T>(_depot: string, methode: string, args: unknown[] = []): Promise<T> {
          if (methode === "contexteSudoku") {
            const branche: ContexteDuSudokuBranche = {
              ...contexte,
              mode: designe ? "designe" : "observe",
            };
            return branche as T;
          }
          inscrits.push(args[0]);
          return undefined as T;
        },
        async contenu(): Promise<never> {
          throw new Error("hors base");
        },
      };
      const sudoku = creerLeSudoku(api, {
        pieceId: "p",
        dossierId: "d",
        packId: "k",
        recueLe: JOUR,
        dates: REGLES_DE_LECTURE_D_ESSAI.dates,
        devise,
        dossier: DOSSIER_D_OR,
        tiers: [],
      });
      const rendue = await sudoku.lire(lecture);
      await sudoku.inscrire(rendue);
      return {
        rendue,
        prouvee: sudoku.prouvee(rendue),
        inscrits: inscrits as ChampsLusAInscrire[],
      };
    };

    const observe = await essayer(false);
    assert.equal(observe.rendue, lecture, "en observation, la lecture n'est pas touchée");
    assert.equal(observe.inscrits.length, 1);
    assert.equal(observe.inscrits[0]!.issue, "prouvee");
    // En observation, la pièce n'est pas « désignée » : le rattrapage garde son déclencheur.
    assert.equal(observe.prouvee, false);

    const designe = await essayer(true);
    assert.notEqual(designe.rendue, lecture, "branché, la désignation prouvée remplace");
    assert.deepEqual(designe.rendue.selection.totals.ttc, { page: 1, ordinal: 114 });
    // Branchée et prouvée : la chaîne ne lance pas de rattrapage (read-flow.ts).
    assert.equal(designe.prouvee, true);
  });

  it("le TTC imprimé AVANT le timbre : prouvé par sa variante, et la chaîne reçoit le net", () => {
    // La forme du jeu de 100 factures de l'utilisateur (A-01, montants fictifs) :
    // « Total TTC » sans le timbre, puis « NET À PAYER » avec lui.
    const ligne = (ordinal: number, y: number, x: number, text: string): PageToken => ({
      page: 1,
      ordinal,
      text,
      x0: x,
      y0: y,
      x1: x + 0.05,
      y1: y + 0.015,
    });
    const plan: PageToken[] = [
      ligne(0, 0.38, 0.54, "Total"),
      ligne(1, 0.38, 0.58, "HT"),
      ligne(2, 0.38, 0.84, "9 835,000"),
      ligne(3, 0.4, 0.54, "TVA"),
      ligne(4, 0.4, 0.57, "19 %"),
      ligne(5, 0.4, 0.84, "1 868,650"),
      ligne(6, 0.42, 0.54, "Total"),
      ligne(7, 0.42, 0.58, "TTC"),
      ligne(8, 0.42, 0.84, "11 703,650"),
      ligne(9, 0.44, 0.54, "Timbre"),
      ligne(10, 0.44, 0.87, "1,000"),
      ligne(11, 0.46, 0.54, "Net"),
      ligne(12, 0.46, 0.57, "à"),
      ligne(13, 0.46, 0.59, "payer"),
      ligne(14, 0.46, 0.83, "11 704,650"),
    ];
    const o = resoudreLaPiece(jetonsDuSudoku(plan, devise, contexte), contexte);
    assert.equal(o.issue, "prouvee", o.raison ?? "");
    assert.equal(o.variante, "ttc_hors_timbre");
    assert.equal(valeur(o, "total_ht"), 9_835_000);
    assert.equal(valeur(o, "droit_timbre"), 1_000);
    const sel = selectionParLeSudoku(
      JEU_D_OR[0]!.designation,
      o,
      contexte.grille,
      contexte.pack.charges.map((c) => c.code),
    );
    assert.deepEqual(sel.totals.ttc, { page: 1, ordinal: 14 }, "la chaîne reçoit le net à payer");
  });

  it("les rôles des champs se déduisent des preuves de la grille en base", () => {
    assert.deepEqual(champsDeLaGrille(contexte.grille), {
      ht: "total_ht",
      base: "base_tva_par_taux",
      tva: "montant_tva_par_taux",
      ttc: [
        { variante: "ttc_hors_timbre", champ: "net_a_payer" },
        { variante: "ttc_avec_timbre", champ: "total_ttc" },
      ],
      lignes: {
        designation: "designation",
        quantite: "quantite",
        prix: "prix_unitaire_ht",
        remise: "remise_ligne",
        montant: "montant_ligne_ht",
        taux: "taux_tva_ligne",
        total: "total_ht",
        total_brut: "total_brut_ht",
        remise_globale: "remise_globale",
      },
    });
  });

  it("le pack se lit au jour de la pièce : le timbre admet son barème, rien avant la grille", async () => {
    const timbre = (c: ContexteDuSudoku) =>
      c.pack.charges.find((ch) => (ch.montants_admis ?? []).length > 1);
    // Au jour dit, le droit standard ET les tranches du barème (toutes catégories).
    const { rows } = await pool.query<{ m: string }>(
      `select distinct (montant_du_droit * 1000)::bigint::text as m from ref.baremes_des_droits
        where pack_version_id = $1 and valid_from <= $2::date
          and (valid_to is null or valid_to >= $2::date)`,
      [packId, JOUR],
    );
    const t = timbre(contexte)!;
    assert.ok(t.montant_fixe !== null);
    assert.deepEqual(
      [...t.montants_admis!],
      [...new Set([t.montant_fixe!, ...rows.map((r) => Number(r.m))])].sort((a, b) => a - b),
    );
    assert.equal(contexte.jour, JOUR);
    // Avant la date d'effet de la grille, rien n'est en vigueur : le jour est bien lu.
    await assert.rejects(contexteAu("2020-06-01"), /0 en vigueur/);
  });

  it("une facture qui imprime un timbre du barème est prouvée ; un montant hors barème, non", () => {
    const ligne = (ordinal: number, y: number, x: number, text: string): PageToken => ({
      page: 1,
      ordinal,
      text,
      x0: x,
      y0: y,
      x1: x + 0.05,
      y1: y + 0.015,
    });
    const admis = [...contexte.pack.charges.flatMap((c) => c.montants_admis ?? [])];
    const facture = (timbre: string, net: string) => [
      ligne(0, 0.38, 0.54, "Total"),
      ligne(1, 0.38, 0.58, "HT"),
      ligne(2, 0.38, 0.84, "100 000,000"),
      ligne(3, 0.4, 0.54, "TVA"),
      ligne(4, 0.4, 0.57, "19 %"),
      ligne(5, 0.4, 0.84, "19 000,000"),
      ligne(6, 0.42, 0.54, "Total"),
      ligne(7, 0.42, 0.58, "TTC"),
      ligne(8, 0.42, 0.84, "119 000,000"),
      ligne(9, 0.44, 0.54, "Timbre"),
      ligne(10, 0.44, 0.87, timbre),
      ligne(11, 0.46, 0.54, "Net"),
      ligne(12, 0.46, 0.57, "à"),
      ligne(13, 0.46, 0.59, "payer"),
      ligne(14, 0.46, 0.83, net),
    ];
    // 2,000 : une tranche du barème (grandes surfaces, LF 2026).
    assert.ok(admis.includes(2_000), "2,000 est admis au jour dit");
    const o = resoudreLaPiece(
      jetonsDuSudoku(facture("2,000", "119 002,000"), devise, contexte),
      contexte,
    );
    assert.equal(o.issue, "prouvee", o.raison ?? "");
    assert.equal(valeur(o, "droit_timbre"), 2_000);
    // 3,000 : aucun barème ne l'admet — pas de fausse preuve.
    assert.ok(!admis.includes(3_000));
    const x = resoudreLaPiece(
      jetonsDuSudoku(facture("3,000", "119 003,000"), devise, contexte),
      contexte,
    );
    assert.notEqual(x.issue, "prouvee");
  });

  it("deux pages aux mêmes ordinaux gardent chacune leur montant en lettres (revue de #181)", () => {
    // Les ordinaux repartent de zéro à chaque page (pdf-text.ts) : indexer les
    // lettres par le seul ordinal donnait à la page 1 le montant de la page 2.
    const page = (p: number, lettres: string): PageToken[] =>
      [
        "Arrêtée",
        "la",
        "présente",
        "pièce",
        "à",
        "la",
        "somme",
        "de",
        ":",
        ...lettres.split(" "),
      ].map((text, ordinal) => ({
        page: p,
        ordinal,
        text,
        x0: 0.05 + 0.04 * ordinal,
        y0: 0.6,
        x1: 0.08 + 0.04 * ordinal,
        y1: 0.615,
      }));
    const j = jetonsDuSudoku(
      [...page(1, "Deux cents dinars."), ...page(2, "Cent dinars.")],
      devise,
      contexte,
    );
    const lus = j.filter((t) => t.lettres).map((t) => [t.page, t.ordinal, t.lettres!.v]);
    assert.deepEqual(lus, [
      [1, 9, 200_000],
      [2, 9, 100_000],
    ]);
  });

  it("les lettres qui contredisent les chiffres signalent la pièce (100/D-04)", () => {
    const mot = (ordinal: number, x: number, text: string): PageToken => ({
      page: 1,
      ordinal,
      text,
      x0: x,
      y0: 0.6,
      x1: x + 0.04,
      y1: 0.615,
    });
    const chiffres: PageToken[] = [
      ["Total", 0.38, 0.54],
      ["HT", 0.38, 0.58],
      ["8 131,000", 0.38, 0.84],
      ["TVA", 0.4, 0.54],
      ["19 %", 0.4, 0.57],
      ["1 544,890", 0.4, 0.84],
      ["Total", 0.42, 0.54],
      ["TTC", 0.42, 0.58],
      ["9 676,890", 0.42, 0.84],
      ["Timbre", 0.44, 0.54],
      ["1,000", 0.44, 0.87],
    ].map(([text, y, x], ordinal) => ({
      page: 1,
      ordinal,
      text: text as string,
      x0: x as number,
      y0: y as number,
      x1: (x as number) + 0.05,
      y1: (y as number) + 0.015,
    }));
    const avec = (lettres: string) => [
      ...chiffres,
      ...["Arrêtée", "la", "présente", "pièce", "à", "la", "somme", "de", ":"].map((t, i) =>
        mot(20 + i, 0.05 + 0.03 * i, t),
      ),
      ...lettres.split(" ").map((t, i) => mot(40 + i, 0.35 + 0.05 * i, t)),
    ];
    const signalee = resoudreLaPiece(
      jetonsDuSudoku(avec("Trois mille deux cents dinars."), devise, contexte),
      contexte,
    );
    assert.equal(signalee.issue, "signalee", signalee.raison ?? "");
    assert.equal(signalee.champs["montant_en_lettres"]?.valeur, "3200000");
    assert.equal(signalee.champs["total_ttc"]?.statut, "signale");
    // La même pièce, ses lettres justes : prouvée, et les lettres avec elle.
    const prouvee = resoudreLaPiece(
      jetonsDuSudoku(
        avec("Neuf mille six cent soixante-seize dinars et huit cent quatre-vingt-dix millimes"),
        devise,
        contexte,
      ),
      contexte,
    );
    assert.equal(prouvee.issue, "prouvee", prouvee.raison ?? "");
    assert.equal(prouvee.champs["montant_en_lettres"]?.statut, "prouve");
    // Signalée, elle ne remplace rien dans la chaîne.
    const sel = JEU_D_OR[0]!.designation;
    assert.equal(
      selectionParLeSudoku(
        sel,
        signalee,
        contexte.grille,
        contexte.pack.charges.map((c) => c.code),
      ),
      sel,
    );
  });

  it("banc 3 : 59/60 factures prouvées justes, zéro fausse preuve, aucun ticket prouvé", () => {
    let justes = 0;
    const fausses: string[] = [];
    let tickets = 0;
    for (const [id, r] of Object.entries(releves)) {
      const v = verites.get(id)!;
      const o = jouer(planDe(r.lignes));
      if (v.type !== "facture") {
        if (o.issue === "prouvee") tickets += 1;
        continue;
      }
      if (o.issue !== "prouvee") continue;
      if (juste(v, o, true)) justes += 1;
      else fausses.push(id);
    }
    assert.deepEqual(fausses, []);
    assert.equal(tickets, 0);
    assert.equal(justes, 59);
  });

  it("banc 3 : 3 000 lectures corrompues, zéro fausse preuve", () => {
    const mutations = lire("banc3_mutations.json") as Record<
      string,
      { lignes: [number, string][] }
    >;
    const fausses: string[] = [];
    for (const [mid, m] of Object.entries(mutations)) {
      const pid = mid.split("_")[0]!;
      const lignes = releves[pid]!.lignes.map((l) => ({ ...l }));
      for (const [i, t] of m.lignes) lignes[i]!.text = t;
      const o = jouer(planDe(lignes));
      if (o.issue === "prouvee" && !juste(verites.get(pid)!, o, false)) fausses.push(mid);
    }
    assert.equal(Object.keys(mutations).length, 3000);
    assert.deepEqual(fausses, []);
  });
});
