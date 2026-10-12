/**
 * Les désignations relevées le 12 octobre, après le déploiement.
 *
 * Deuxième tournée en deux jours, sur les factures que le commanditaire a
 * photographiées lui-même. C'est la démonstration de ce qui était écrit la
 * veille : avec des règles d'expression, il y aura toujours une désignation
 * non prévue — et la vraie réponse est la couche par organisation (R10), où
 * une ligne se range à la main et où ce choix sert la fois suivante.
 *
 * Fichier à part : le `after` du fichier voisin ferme le pool, et une seconde
 * suite y mourait annulée sans raison lisible.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { fermerLePool } from "../db.ts";

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

describe("la famille des factures du 12 octobre", { skip: !BASE_CONFIGUREE }, () => {
  let pool: pg.Pool;
  let packId = "";

  before(async () => {
    pool = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
    const { rows } = await pool.query<{ id: string }>(
      `select id from ref.jurisdiction_packs where jurisdiction = 'TN'
        order by effective_from desc limit 1`,
    );
    packId = rows[0]!.id;
  });

  after(async () => {
    await pool.end();
    await fermerLePool();
  });

  const famille = async (designation: string) => {
    const { rows } = await pool.query<{ famille_code: string; famille_source: string }>(
      `select famille_code, famille_source
         from public.charge_famille_resolve($1, null, $2, date '2026-10-01')`,
      [packId, designation],
    );
    return rows[0]!;
  };

  const ATTENDUES: Array<[string, string]> = [
    ["Forfait Business 60 Go - ligne 50 xxx 103", "TELECOM"],
    ["Forfait Business 30 Go - ligne 50 xxx 104", "TELECOM"],
    ["Hors forfait international", "TELECOM"],
    ["Options roaming Afrique de l'Ouest", "TELECOM"],
    ["Eau minérale 1,5 L — pack de 6", "FOURNITURES"],
    ["Café en grains torréfié 1 kg", "FOURNITURES"],
    ["Sucre en morceaux 1 kg", "FOURNITURES"],
  ];

  for (const [designation, attendue] of ATTENDUES) {
    it(`« ${designation} » se range en ${attendue}`, async () => {
      const f = await famille(designation);
      assert.equal(f.famille_code, attendue, `relevé « ${f.famille_code} » (${f.famille_source})`);
      assert.notEqual(f.famille_source, "fallback");
    });
  }
});
