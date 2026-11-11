/**
 * La preuve PARTIELLE d'une facture, sur le vrai moteur et la vraie grille de la base.
 *
 * 10 novembre 2026, une facture manuscrite sur le staging (pièce ca4ab8f3) : le net à payer
 * « 17851,000 » relevé « 17851,200 ». Le HT, la TVA à 19 % et le TTC tenaient ensemble.
 * Décision du dirigeant : ces montants sont retenus, prouvés et cités ; la pièce reste à
 * vérifier, sans court-circuit ni écriture proposée sur cette seule base.
 *
 * Il faut une base migrée (`DATABASE_URL_ADMIN`) et le moteur WASM construit.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { moteurDisponible } from "@malica/sudoku";

import { deviseDEssai } from "../../scan/devise-d-essai.ts";
import {
  champsLusAInscrire,
  GRILLE_DE_LA_LECTURE_CITEE,
  jetonsDuSudoku,
  lireLeContexteDuSudoku,
  prouveePourLEcriture,
  resoudreLaPiece,
  type ContexteDuSudoku,
} from "./sudoku.ts";
import type { PageToken } from "./token-plan.ts";

const MOTEUR = moteurDisponible();
const BASE = process.env["DATABASE_URL_ADMIN"];
const JOUR = "2026-11-10";
const devise = deviseDEssai(3);

const mot = (ordinal: number, y: number, x: number, text: string): PageToken => ({
  page: 1,
  ordinal,
  text,
  x0: x,
  y0: y,
  x1: x + text.length * 0.008,
  y1: y + 0.015,
});

/** Le pied de la pièce du 10 novembre ; seul le net à payer change d'un cas à l'autre. */
const pied = (net: string): PageToken[] => [
  mot(0, 0.38, 0.54, "Total"),
  mot(1, 0.38, 0.58, "HT"),
  mot(2, 0.38, 0.84, "15 000,000"),
  mot(3, 0.4, 0.54, "TVA"),
  mot(4, 0.4, 0.57, "19 %"),
  mot(5, 0.4, 0.84, "2 850,000"),
  mot(6, 0.42, 0.54, "Total"),
  mot(7, 0.42, 0.58, "TTC"),
  mot(8, 0.42, 0.84, "17 850,000"),
  mot(9, 0.44, 0.54, "Timbre"),
  mot(10, 0.44, 0.87, "1,000"),
  mot(11, 0.46, 0.54, "Net"),
  mot(12, 0.46, 0.57, "à"),
  mot(13, 0.46, 0.59, "payer"),
  mot(14, 0.46, 0.83, net),
];

describe("la preuve partielle d'une facture, sur la base", { skip: !(MOTEUR && BASE) }, () => {
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

  const jouer = (net: string) =>
    resoudreLaPiece(jetonsDuSudoku(pied(net), devise, contexte), contexte);

  it("la base dit qu'une variante est partielle, l'adaptateur ne la nomme pas", () => {
    const partielles = contexte.grille.preuves.filter((p) => p.partielle);
    assert.ok(partielles.length > 0, "la grille facture porte une preuve partielle");
    assert.ok(
      partielles.every((p) => p.variante),
      "une preuve partielle est d'une variante",
    );
    assert.ok(
      contexte.grille.preuves.some((p) => p.variante && !p.partielle),
      "les variantes entières ne le sont pas",
    );
  });

  it("le net à payer faux : le noyau sort prouvé et cité, la pièce n'est pas prouvée", () => {
    const o = jouer("17 851,200");
    assert.equal(o.issue, "aucune", "jamais « prouvee » sur un noyau");
    assert.equal(o.variante, "noyau");
    const c = o.champs;
    assert.deepEqual(
      [
        c["total_ht"]?.statut,
        c["total_ht"]?.valeur,
        c["total_ttc"]?.statut,
        c["total_ttc"]?.valeur,
      ],
      ["prouve", "15000000", "prouve", "17850000"],
    );
    assert.deepEqual(c["total_ht"]?.refs, [{ page: 1, ordinal: 2 }]);
    assert.deepEqual(c["total_ttc"]?.refs, [{ page: 1, ordinal: 8 }]);
    const tva = c["montant_tva_par_taux"]?.instances?.[0];
    assert.deepEqual([tva?.taux, tva?.valeur], ["TVA19", "2850000"]);
    assert.deepEqual(tva?.refs, [{ page: 1, ordinal: 5 }]);
    assert.equal(c["droit_timbre"]?.valeur, "1000");
    assert.notEqual(c["net_a_payer"]?.statut, "prouve", "le net à payer faux n'est pas affirmé");
  });

  it("aucun court-circuit : la porte de l'écriture reste fermée", () => {
    const o = jouer("17 851,200");
    assert.equal(prouveePourLEcriture(o, contexte.exigencesSansIa ?? []), false);
  });

  it("les champs du noyau s'inscrivent prouvés, avec leurs citations", () => {
    const o = jouer("17 851,200");
    const { champs } = champsLusAInscrire({ pieceId: "p", packId: "k" }, contexte, o);
    const ht = champs.find((x) => x.champ === "total_ht");
    assert.equal(ht?.statut, "prouve");
    assert.deepEqual(
      ht?.citations.map((x) => x.ordinal),
      [2],
    );
  });

  it("une variante entière prouvée l'emporte toujours : la pièce est prouvée", () => {
    const o = jouer("17 851,000");
    assert.equal(o.issue, "prouvee");
    assert.notEqual(o.variante, "noyau");
    assert.equal(o.champs["net_a_payer"]?.valeur, "17851000");
  });

  it("une TVA qui ne tient à aucun taux ne prouve rien", () => {
    const faux = pied("17 851,200").map((t) =>
      t.text === "2 850,000" ? { ...t, text: "2 860,000" } : t,
    );
    const o = resoudreLaPiece(jetonsDuSudoku(faux, devise, contexte), contexte);
    assert.notEqual(o.issue, "prouvee");
    assert.notEqual(o.variante, "noyau");
  });
});
