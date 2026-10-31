import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import pg from "pg";

import { moteurDisponible, resoudre, type SortieDuSudoku } from "@malica/sudoku";

import { deviseDEssai } from "../../scan/devise-d-essai.ts";
import { JEU_D_OR } from "./jeu-d-or.ts";
import { buildExtractFromTokenPlan } from "./read-piece.ts";
import { recollerLesMilliers } from "./recoller-les-milliers.ts";
import {
  champsDesCharges,
  champsLusAInscrire,
  creerLeSudoku,
  GRILLE_DE_LA_LECTURE_CITEE,
  jetonsDuSudoku,
  lireLeContexteDuSudoku,
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

describe("sudoku — les jetons du plan", () => {
  const plan: PageToken[] = [
    { page: 1, ordinal: 0, text: "3 020,000", x0: 0, y0: 0, x1: 1, y1: 1 },
    { page: 1, ordinal: 1, text: "16000", x0: 0, y0: 0, x1: 1, y1: 1 },
    { page: 1, ordinal: 2, text: "01/09/2026", x0: 0, y0: 0, x1: 1, y1: 1 },
    { page: 1, ordinal: 3, text: "Total HT", x0: 0, y0: 0, x1: 1, y1: 1 },
  ];
  const j = jetonsDuSudoku(plan, devise);

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
});

describe("sudoku — la sélection rendue", () => {
  const cas = JEU_D_OR[0]!;
  const ref = (ordinal: number) => [{ page: 1, ordinal }];
  const prouvee: SortieDuSudoku = {
    issue: "prouvee",
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
  const charges = { DROIT_TIMBRE: "droit_timbre", FODEC: "montant_fodec" };

  it("une pièce non prouvée garde la sélection de la chaîne, à l'identique", () => {
    const s = selectionParLeSudoku(cas.designation, { ...prouvee, issue: "ambigue" }, [], {});
    assert.equal(s, cas.designation);
  });

  it("prouvée : totaux, ligne de TVA et droits sont ceux de la preuve", () => {
    const s = selectionParLeSudoku(
      { ...cas.designation, other_charges: [{ code: "AUTRE", amount: { page: 1, ordinal: 1 } }] },
      prouvee,
      ["DROIT_TIMBRE", "FODEC"],
      charges,
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
    const a = champsLusAInscrire("p", "facture", {
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
      { champ: "total_ht", valeur: null, statut: "signale", citations: [] },
    ]);
  });

  it("une sortie sans aucun champ laisse une ligne de tentative", () => {
    const a = champsLusAInscrire("p", "facture", {
      issue: "aucune",
      solutions: 0,
      combinaisons: 0,
      preuves: {},
      champs: {},
      raison: "entrée invalide",
    });
    assert.deepEqual(a.champs, [{ champ: null, valeur: null, statut: null, citations: [] }]);
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
    const sudoku = creerLeSudoku(api, { pieceId: "p", packId: "k", devise });
    const lecture = { tokens: [], selection: cas.designation } as unknown as VisionRead;
    // Le contexte est illisible : la lecture ressort à l'identique, rien ne s'inscrit.
    assert.equal(await sudoku.lire(lecture), lecture);
    await sudoku.inscrire(lecture);
    assert.deepEqual(
      appels.map((a) => a.methode),
      ["contexteSudoku"],
    );
  });

  it("les champs inscrits portent tous leur citation, un par taux", () => {
    const a = champsLusAInscrire("p", "facture", prouvee);
    assert.deepEqual(
      a.champs.map((c) => c.champ),
      [
        "total_ht",
        "total_ttc",
        "base_tva_par_taux:TVA19",
        "montant_tva_par_taux:TVA19",
        "droit_timbre",
      ],
    );
    assert.ok(a.champs.every((c) => c.citations.length > 0));
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

  before(async () => {
    pool = new pg.Pool({ connectionString: BASE });
    const c = await pool.connect();
    try {
      const { rows } = await c.query<{ id: string }>(
        `select id from ref_packs_v where jurisdiction = 'TN'
          and effective_from <= current_date order by effective_from desc limit 1`,
      );
      contexte = await lireLeContexteDuSudoku(c, rows[0]!.id, GRILLE_DE_LA_LECTURE_CITEE);
    } finally {
      c.release();
    }
  });
  after(async () => {
    await pool.end();
  });

  const jouer = (plan: readonly PageToken[]) =>
    resoudre({
      jetons: jetonsDuSudoku(plan, devise),
      grille: contexte.grille,
      pack: contexte.pack,
    });

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
        contexte.pack.charges.map((c) => c.code),
        champsDesCharges(contexte.grille),
      );
      const extrait = (s: typeof sel) =>
        buildExtractFromTokenPlan({
          tokens: plan,
          selection: s,
          devise,
          matriculeDossier: cas.matriculeDossier,
        }).extract;
      const montants = (x: ReturnType<typeof extrait>) =>
        JSON.stringify({ t: x["totals"], l: x["lines"], c: x["other_charges"] });
      assert.equal(montants(extrait(sel)), montants(extrait(cas.designation)));
    }
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
