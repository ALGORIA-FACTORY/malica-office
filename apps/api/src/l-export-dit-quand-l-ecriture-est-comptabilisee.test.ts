/**
 * L'export dit quand l'écriture est comptabilisée (recette du 11 novembre
 * 2026, point 2.7) : « comptabilisee_le » sortait vide pour une écriture
 * inscrite mais pas encore revue.
 *
 *   node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/l-export-dit-quand-l-ecriture-est-comptabilisee.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { BASE_CONFIGUREE, monterUneSociete, type SocieteDEssai } from "./circuit-d-essai.ts";
import { fermerLePool } from "./db.ts";

describe("l'export dit quand l'écriture est comptabilisée", { skip: !BASE_CONFIGUREE }, () => {
  let s: SocieteDEssai;
  let ecriture: string;

  before(async () => {
    s = await monterUneSociete(`export-${Date.now()}`);
    const piece = await s.deposer("amel", "entite");
    await s.lire("amel", piece);
    await s.fait("amel", "collab.envoyer", piece);
    ecriture = await s.priseEnCharge(piece);
  });
  after(async () => {
    await s.fermer();
    await fermerLePool();
  });

  it("chaque ligne du CSV porte le jour de l'inscription, revue ou non", async () => {
    const { rows } = await s.admin.query<{ jour: string }>(
      `select booked_at::date::text as jour from socle.ecritures where id = $1`,
      [ecriture],
    );
    const r = (await s.fait(
      "expert",
      "exports.generer",
      s.cabinet,
      s.pme,
      "2026-01-01",
      "2026-12-31",
      "csv_ecritures",
    )) as { contenu: string };
    const [entete, ...corps] = r.contenu.replace("﻿", "").trimEnd().split("\r\n");
    const colonnes = entete!.split(";");
    const i = colonnes.indexOf("comptabilisee_le");
    const j = colonnes.indexOf("validee_le");
    assert.ok(corps.length >= 2, "les deux lignes de l'écriture");
    for (const ligne of corps) {
      const champs = ligne.split(";");
      assert.equal(champs[i], rows[0]!.jour);
      assert.equal(champs[j], "", "pas encore revue");
    }
  });
});
