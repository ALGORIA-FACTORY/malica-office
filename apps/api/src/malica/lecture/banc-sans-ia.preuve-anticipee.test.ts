/**
 * La preuve anticipée du tableau ne lit pas un relevé qui n'existe pas encore.
 *
 * Le banc donne au lecteur une preuve à jouer dès l'arrivée des jetons du
 * tableau (`surLeTableau`), AVANT que le relevé soit rendu. Cette preuve lisait
 * `releve.lecteur` : le relevé n'existait pas, l'appel levait, et chaque pièce
 * lue par PaddleOCR sortait en panne « relevé : … ». Le banc du moteur
 * (`banc-moteur.yml`, 10 novembre 2026) ne pouvait rien prouver.
 */
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import pg from "pg";

import { mesurerLaPiece, type PieceDuBanc } from "./banc-sans-ia.ts";
import type { PageToken } from "./token-plan.ts";

const ADMIN = process.env["DATABASE_URL_ADMIN"];

describe("banc sans IA — la preuve anticipée du tableau", { skip: !ADMIN }, () => {
  const pool = new pg.Pool({ connectionString: ADMIN });
  after(() => pool.end());

  it("la preuve jouée avant le relevé atteint le moteur", async () => {
    const { rows } = await pool.query<{ id: string }>(
      `select id from ref_packs_v where jurisdiction = 'TN' and effective_from <= $1::date
        order by effective_from desc limit 1`,
      ["2026-10-01"],
    );
    assert.equal(rows.length, 1, "un pack TN en vigueur");

    // Le moteur est une doublure : seul compte ici qu'on l'ATTEIGNE. Avant le
    // correctif, la preuve tombait avant lui, sur la lecture du relevé absent.
    const MOTEUR_ATTEINT = new Error("moteur atteint");
    const moteur = () => {
      throw MOTEUR_ATTEINT;
    };
    let chuteDeLaPreuve: unknown = "preuve non jouée";
    const piece = {
      corpus: "essai",
      id: "preuve-anticipee",
      type: "facture_achat",
      grille: "facture",
      rendu: "image",
      langue: "fr",
      gabarit: null,
      devise: "TND",
      deviseDuDossier: "TND",
      jour: "2026-10-01",
      sens: "achat",
      dossier: null,
      concepts: {},
      confondus: {},
      verite: "partielle",
      // Le lecteur de PaddleOCR : la preuve du tableau part AVANT le relevé.
      releve: async (prouve?: (tokens: PageToken[]) => boolean) => {
        try {
          prouve?.([]);
          chuteDeLaPreuve = null;
        } catch (e) {
          chuteDeLaPreuve = e;
        }
        return { tokens: [], lecteur: "paddle", millisecondes: 1 };
      },
    } as unknown as PieceDuBanc;

    // La suite de la mesure appelle aussi la doublure : elle tombe, c'est attendu.
    await mesurerLaPiece(pool, rows[0]!.id, piece, undefined, moteur).catch((e: unknown) => {
      if (e !== MOTEUR_ATTEINT) throw e;
    });

    assert.equal(
      chuteDeLaPreuve,
      MOTEUR_ATTEINT,
      `la preuve anticipée atteint le moteur ; elle est tombée avant : ${String(chuteDeLaPreuve)}`,
    );
  });
});
