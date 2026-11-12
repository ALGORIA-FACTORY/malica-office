/**
 * Ce que la recette du 11 novembre 2026 a lu (lot 6), rejoué sans aucun modèle.
 *
 *   6.1  Une facture à deux taux (7 % et 19 %) sortait « TVA — », le HT, le timbre et le
 *        TTC justes à côté : elle imprime une TVA par taux et aucun total de TVA, et rien
 *        ne désignait `totals.vat`.
 *   6.2  Un PDF propre (HT 300,000, TVA 19 % 57,000, timbre 1,000, TTC 358,000) sortait
 *        « à vérifier » partout : prouvé par le Sudoku seul, il portait le score d'une
 *        sélection vide (0,5), sous la réserve du pack (0,7).
 *
 * La chaîne est celle de la production, du plan de jetons au jugement : le Sudoku
 * d'abord (`creerLeSudoku`, le vrai moteur, le vrai référentiel en base), la
 * désignation, la relecture au plan (`buildExtractFromTokenPlan`), la confiance de
 * chaque champ (`confianceDeLaDesignation`, comme `read-flow.ts` la persiste), et
 * `jugerLaLecture`. Le seul modèle est un faux qui rend une désignation écrite ici :
 * `fetch` est interdit pour tout le fichier.
 *
 * Les gardes restent ce qu'elles étaient : une somme partielle ne se rend pas, un
 * total de TVA désigné n'est pas remplacé, un modèle peu sûr laisse ses champs « à
 * vérifier », et un jeton d'OCR peu sûr aussi — même sous la preuve.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { moteurDisponible } from "@malica/sudoku";

import { deviseDEssai, devisesDEssai } from "../../scan/devise-d-essai.ts";
import { juger, lectureCitee } from "../../scan/mesure-des-propositions.ts";
import { REGLES_DE_LECTURE_D_ESSAI } from "../../scan/referentiel-d-essai.ts";
import type { MaillonDeDesignation } from "./designation.ts";
import { JEU_D_OR } from "./jeu-d-or.ts";
import { confianceDeLaDesignation } from "./read-flow.ts";
import { buildExtractFromTokenPlan } from "./read-piece.ts";
import {
  GRILLE_DE_LA_LECTURE_CITEE,
  creerLeSudoku,
  lireLeContexteDuSudoku,
  type ContexteDuSudoku,
  type ContexteDuSudokuBranche,
} from "./sudoku.ts";
import type { PageToken, TokenRef } from "./token-plan.ts";
import { runVisionRead, type Lecteur, type VisionSelection } from "./vision.ts";

const FETCH_D_ORIGINE = globalThis.fetch;
before(() => {
  globalThis.fetch = (() => {
    throw new Error("appel réseau interdit dans cette épreuve");
  }) as typeof fetch;
});
after(() => {
  globalThis.fetch = FETCH_D_ORIGINE;
});

const MOTEUR = moteurDisponible();
const BASE = process.env["DATABASE_URL_ADMIN"];
const JOUR = "2026-11-10";
const devise = deviseDEssai(3);
const MF_DOSSIER = JEU_D_OR[0]!.matriculeDossier!;
const MF_FOURNISSEUR = String(JEU_D_OR[0]!.attendu["references.matricule_fiscal"]);
const FOURNISSEUR = {
  code: "F001",
  identifiantFiscal: MF_FOURNISSEUR,
  raisonSociale: "SOCIETE ALPHA SARL",
};

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
const ref = (ordinal: number): TokenRef => ({ page: 1, ordinal });

/** L'en-tête d'une facture d'achat fictive : émetteur, matricules, numéro, date. */
const ENTETE: PageToken[] = [
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
  mot(12, 0.14, 0.13, "10/11/2026"),
  mot(13, 0.18, 0.55, "Client"),
  mot(14, 0.18, 0.62, ":"),
  mot(15, 0.18, 0.65, "ALGORIA"),
  mot(16, 0.18, 0.72, "FACTORY"),
  mot(17, 0.2, 0.55, "MF"),
  mot(18, 0.2, 0.6, "client"),
  mot(19, 0.2, 0.67, ":"),
  mot(20, 0.2, 0.7, MF_DOSSIER),
];

/** 6.2 — la pièce d'essai de la recette : HT 300,000, TVA 19 % 57,000, timbre, TTC 358,000. */
const PDF_PROPRE: PageToken[] = [
  ...ENTETE,
  mot(21, 0.38, 0.54, "Total"),
  mot(22, 0.38, 0.58, "HT"),
  mot(23, 0.38, 0.84, "300,000"),
  mot(24, 0.4, 0.54, "TVA"),
  mot(25, 0.4, 0.57, "19 %"),
  mot(26, 0.4, 0.84, "57,000"),
  mot(27, 0.42, 0.54, "Timbre"),
  mot(28, 0.42, 0.87, "1,000"),
  mot(29, 0.44, 0.54, "Total"),
  mot(30, 0.44, 0.58, "TTC"),
  mot(31, 0.44, 0.84, "358,000"),
];

/**
 * 6.1 — deux taux, une TVA par taux et AUCUN total de TVA : 298,000 à 7 % (20,860) et
 * 660,000 à 19 % (125,400), soit 146,260 de TVA ; 1,000 de timbre ; 1 105,260 TTC.
 */
const DEUX_TAUX: PageToken[] = [
  ...ENTETE,
  mot(21, 0.36, 0.54, "TVA"),
  mot(22, 0.36, 0.57, "7 %"),
  mot(23, 0.36, 0.7, "298,000"),
  mot(24, 0.36, 0.84, "20,860"),
  mot(25, 0.38, 0.54, "TVA"),
  mot(26, 0.38, 0.57, "19 %"),
  mot(27, 0.38, 0.7, "660,000"),
  mot(28, 0.38, 0.84, "125,400"),
  mot(29, 0.4, 0.54, "Total"),
  mot(30, 0.4, 0.58, "HT"),
  mot(31, 0.4, 0.84, "958,000"),
  mot(32, 0.42, 0.54, "Timbre"),
  mot(33, 0.42, 0.87, "1,000"),
  mot(34, 0.44, 0.54, "Total"),
  mot(35, 0.44, 0.58, "TTC"),
  mot(36, 0.44, 0.84, "1 105,260"),
];

/** Ce qu'un modèle désignerait sur la facture à deux taux : aucun jeton pour le total de TVA. */
const DESIGNATION_DEUX_TAUX: VisionSelection = {
  document_kind: "facture_achat",
  currency: null,
  issuer: { page: 1, ordinal: 0, ordinal_end: 2 },
  document_date: ref(12),
  lines: [
    { label: "Plats", tax_code: "TVA07", base_ht: ref(23), vat_amount: ref(24), ttc: null },
    { label: "Boissons", tax_code: "TVA19", base_ht: ref(27), vat_amount: ref(28), ttc: null },
  ],
  articles: [],
  other_charges: [{ code: "DROIT_TIMBRE", amount: ref(33) }],
  totals: { base_ht: ref(31), vat: null, ttc: ref(36) },
  references: { numero: ref(9), matricule_fiscal: ref(6), matricule_fiscal_client: ref(20) },
  overall_confidence: 0.9,
};

/** Une photo : chaque jeton porte la confiance de l'OCR. */
const enPhoto = (plan: readonly PageToken[], confiance: number): PageToken[] =>
  plan.map((t) => ({ ...t, confidence: confiance }));

/* ================================================== LA RELECTURE, SANS BASE = */

describe("6.1 — la TVA d'une facture à plusieurs taux est la somme de ses lignes", () => {
  const relire = (selection: VisionSelection, tokens: readonly PageToken[] = DEUX_TAUX) =>
    buildExtractFromTokenPlan({
      tokens,
      selection,
      ...devisesDEssai(3),
      matriculeDossier: MF_DOSSIER,
      lecteur: "pdf-text",
    });
  const totaux = (b: ReturnType<typeof relire>) =>
    b.extract["totals"] as { base_ht: string | null; vat: string | null; ttc: string | null };

  it("aucun total de TVA imprimé : 20,860 + 125,400 = 146,260, dit par le Socle", () => {
    const b = relire(DESIGNATION_DEUX_TAUX);
    assert.deepEqual(totaux(b), { base_ht: "958.000", vat: "146.260", ttc: "1105.260" });
    assert.ok(
      b.flags.some((f) => f.field === "totals.vat" && f.code === "DERIVED_BY_SOCLE"),
      "une somme se dit calculée, jamais lue",
    );
    assert.ok(
      !b.citations.some((c) => c.field === "totals.vat"),
      "la somme n'est imprimée nulle part : elle ne se cite pas",
    );
  });

  it("une ligne dont la TVA ne se lit pas : pas de somme partielle", () => {
    const tokens = DEUX_TAUX.map((t) => (t.ordinal === 24 ? { ...t, text: "TVA" } : t));
    assert.equal(totaux(relire(DESIGNATION_DEUX_TAUX, tokens)).vat, null);
  });

  it("un total de TVA désigné reste le sien, même illisible : rien ne le remplace", () => {
    const illisible = { ...DESIGNATION_DEUX_TAUX.totals, vat: ref(29) };
    const b = relire({ ...DESIGNATION_DEUX_TAUX, totals: illisible });
    assert.equal(totaux(b).vat, null);
    assert.ok(!b.flags.some((f) => f.field === "totals.vat" && f.code === "DERIVED_BY_SOCLE"));
  });
});

/* ========================================= LA CHAÎNE ENTIÈRE, VRAI MOTEUR === */

const CHAINE: MaillonDeDesignation[] = [
  {
    rang: 1,
    fournisseur: "anthropic",
    modele: "faux-modele",
    role: "chat",
    periode: "mois",
    plafond: 500,
    depense: 0,
    epuise: false,
  },
];

describe(
  "la recette du 11 novembre, rejouée sur le vrai moteur",
  { skip: !(MOTEUR && BASE) },
  () => {
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

    /** Le plan, lu comme `readPieceFlow` le lit, jusqu'au jugement. */
    async function lire(
      tokens: PageToken[],
      o: {
        lecteur: Lecteur;
        fournisseurConnu: boolean;
        designation?: VisionSelection;
        mode?: "observe" | "designe";
      },
    ) {
      const sudoku = creerLeSudoku(
        {
          async rpc<T>(_d: string, methode: string): Promise<T> {
            if (methode === "contexteSudoku")
              return {
                ...contexte,
                mode: o.mode ?? "observe",
              } satisfies ContexteDuSudokuBranche as T;
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
          tiers: o.fournisseurConnu ? [FOURNISSEUR] : [],
        },
      );
      let appels = 0;
      const releve = await runVisionRead({
        dataUrl: "data:,",
        tokens,
        releveur: o.lecteur,
        taxCodes: [],
        sudokuDAbord: (plan) => sudoku.sansIa(plan),
        designation: {
          chaine: async () => CHAINE,
          appeler: async () => {
            appels += 1;
            if (!o.designation) throw new Error("aucun modèle ne doit être appelé");
            return {
              answer: JSON.stringify(o.designation),
              tokensIn: 1,
              tokensOut: 1,
              latencyMs: 1,
            };
          },
        },
      });
      const lu = await sudoku.lire({ ...releve, lecteur: o.lecteur });
      const construite = buildExtractFromTokenPlan({
        tokens,
        selection: lu.selection,
        ...devisesDEssai(3),
        matriculeDossier: MF_DOSSIER,
        lecteur: o.lecteur,
      });
      const lecture = lectureCitee(tokens, construite, confianceDeLaDesignation(lu), JOUR);
      const jugement = juger({
        nom: "recette du 11 novembre",
        provenance: "lot 6",
        lecture,
        attendu: null,
        dossier: { nom: "ALGORIA FACTORY", identifiantFiscal: MF_DOSSIER },
      });
      const confiance = jugement.controles.find((c) => c.code === "confiance_lecture");
      const preuves = (confiance?.preuves ?? {}) as { aRelire?: string[]; champs?: string[] };
      return {
        appels,
        sansIa: lu.prouveeSansIa === true,
        totaux: construite.extract["totals"],
        // Ce que l'écran dit « à vérifier » (`champsAVerifier`, `proposition.ts`).
        aVerifier:
          confiance?.statut === "conforme" ? [] : (preuves.aRelire ?? preuves.champs ?? []),
        verdict: jugement.verdict,
        mentions: jugement.controles.find((c) => c.code === "mentions_obligatoires"),
      };
    }

    it("6.2 — un PDF propre prouvé sans IA : aucune valeur « à vérifier »", async () => {
      const r = await lire(PDF_PROPRE, { lecteur: "pdf-text", fournisseurConnu: true });
      assert.equal(r.appels, 0, "aucun modèle appelé");
      assert.equal(r.sansIa, true, "le Sudoku a prouvé tout ce que l'écriture exige");
      assert.deepEqual(r.totaux, { base_ht: "300.000", vat: "57.000", ttc: "358.000" });
      assert.deepEqual(r.aVerifier, []);
      assert.equal(r.verdict, "à comptabiliser");
    });

    /** Ce qu'un modèle désignerait sur le PDF propre. */
    const designationPropre = (confiance: number): VisionSelection => ({
      ...DESIGNATION_DEUX_TAUX,
      lines: [{ label: "x", tax_code: "TVA19", base_ht: ref(23), vat_amount: ref(26), ttc: null }],
      other_charges: [{ code: "DROIT_TIMBRE", amount: ref(28) }],
      totals: { base_ht: ref(23), vat: ref(26), ttc: ref(31) },
      overall_confidence: confiance,
    });

    it("6.2 — une photo peu sûre ne passe pas la porte, et ses champs restent « à vérifier »", async () => {
      const r = await lire(enPhoto(PDF_PROPRE, 0.6), {
        lecteur: "paddle",
        fournisseurConnu: true,
        designation: designationPropre(0.9),
      });
      assert.equal(r.sansIa, false, "un relevé incertain ne se prouve pas sans IA");
      assert.equal(r.appels, 1);
      assert.ok(r.aVerifier.includes("issuer"), "la confiance du relevé fait toujours foi");
      assert.ok(r.aVerifier.includes("totals.ttc"));
    });

    it("6.2 — une désignation de modèle garde sa confiance : sous la réserve, « à vérifier »", async () => {
      const r = await lire(PDF_PROPRE, {
        lecteur: "pdf-text",
        fournisseurConnu: false,
        designation: designationPropre(0.5),
      });
      assert.equal(r.appels, 1, "fournisseur inconnu : la chaîne de désignation part");
      assert.ok(r.aVerifier.includes("issuer"));
    });

    it("6.1 — deux taux prouvés sans IA : la TVA est 146,260", async () => {
      const r = await lire(DEUX_TAUX, { lecteur: "pdf-text", fournisseurConnu: true });
      assert.equal(r.sansIa, true);
      assert.deepEqual(r.totaux, { base_ht: "958.000", vat: "146.260", ttc: "1105.260" });
    });

    it("6.1 — deux taux, une TVA imprimée par taux et aucun total : la mention « Montant de la TVA » est là", async () => {
      const r = await lire(DEUX_TAUX, { lecteur: "pdf-text", fournisseurConnu: true });
      assert.equal(r.mentions?.statut, "conforme", r.mentions?.motif);
    });

    it("6.1 — deux taux sur une photo, désignés par un modèle puis prouvés : 146,260", async () => {
      const r = await lire(enPhoto(DEUX_TAUX, 0.97), {
        lecteur: "paddle",
        fournisseurConnu: false,
        designation: DESIGNATION_DEUX_TAUX,
        mode: "designe",
      });
      assert.equal(r.appels, 1);
      assert.deepEqual(r.totaux, { base_ht: "958.000", vat: "146.260", ttc: "1105.260" });
    });
  },
);
