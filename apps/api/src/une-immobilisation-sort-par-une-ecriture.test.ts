/**
 * Une immobilisation sort du bilan par une écriture (staging, 5 novembre
 * 2026) : la cession s'enregistrait sans écriture, la mise au rebut se
 * choisissait dans la fiche, et l'état « cédé » se posait sans cession.
 *
 *   node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/une-immobilisation-sort-par-une-ecriture.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { computeAmortissement, sortieDuPlan } from "@malica/socle";

import { BASE_CONFIGUREE, monterUneSociete, type SocieteDEssai } from "./circuit-d-essai.ts";
import { fermerLePool, sousIdentite } from "./db.ts";

describe("une immobilisation sort par une écriture", { skip: !BASE_CONFIGUREE }, () => {
  let s: SocieteDEssai;
  let categorie: { id: string; immo: string; amort: string; dotation: string };

  // 12 000 sur 4 ans, en service le 1er janvier 2025 : 3 000 par an.
  const plan = computeAmortissement({
    currency: "TND",
    decimals: 3,
    method: "lineaire",
    dureeAnnees: 4,
    coefficient: "1",
    valeurBrute: "12000.000",
    valeurResiduelle: "0.000",
    miseEnService: "2025-01-01",
  });

  const creer = (label: string) =>
    sousIdentite(s.gens.amel.id, async (db) => {
      const r = await db.query<{ id: string }>(
        `select public.immo_bien_creer($1, null, 'partage', null, $2, $3, '2025-01-01',
                                       12000, 0, 'lineaire', 4::smallint, 1, 'TND', $4) as id`,
        [s.pme, categorie.id, label, s.pack],
      );
      return r.rows[0]!.id;
    });

  const doter2025 = (bien: string) =>
    sousIdentite(s.gens.amel.id, (db) =>
      db.query(
        `select public.immo_dotation_constater($1, 2025::smallint, 12::smallint, 3000, 3000,
                                               9000, $2)`,
        [bien, s.pack],
      ),
    );

  const sortir = (bien: string, motif: "cede" | "rebute", at: string, prix = "0", tva = "0") => {
    const p = sortieDuPlan(plan, at, 3);
    return sousIdentite(s.gens.amel.id, async (db) => {
      const r = await db.query<{ r: Record<string, string | null> }>(
        `select public.immo_sortir($1, $2, $3::date, $4::smallint, $5::smallint, $6, $7, $8, $9,
                                   $10) as r`,
        [bien, motif, at, p.exercice, p.mois, p.dotation, p.cumul, prix, tva, s.pack],
      );
      return r.rows[0]!.r;
    });
  };

  const lignes = (ecriture: string) =>
    s.admin
      .query<{ account_code: string; debit: string; credit: string }>(
        `select account_code, debit::text, credit::text from socle.ecriture_lignes
          where ecriture_id = $1 order by ordinal`,
        [ecriture],
      )
      .then((r) => r.rows);

  before(async () => {
    s = await monterUneSociete(`immo-${Date.now()}`);
    const { rows } = await s.admin.query<{
      id: string;
      immo: string;
      amort: string;
      dotation: string;
    }>(
      `select id, account_immo as immo, account_amort as amort, account_dotation as dotation
         from ref.immo_categories
        where pack_version_id = $1 and valid_to is null
        order by code limit 1`,
      [s.pack],
    );
    categorie = rows[0]!;
  });

  after(async () => {
    try {
      await s?.fermer();
    } finally {
      await fermerLePool();
    }
  });

  it("met au rebut : dotation de l'exercice, sortie de l'actif, perte en 636", async () => {
    const bien = await creer("Rebut");
    await doter2025(bien);
    // 15 mars 2026 : 3 mois de 2026, 750 ; cumul 3 750, VNC 8 250.
    const r = await sortir(bien, "rebute", "2026-03-15");
    assert.equal(Number(r["vnc"]), 8250);
    assert.equal(Number(r["resultat"]), -8250);
    assert.equal(r["ecriture_prix_id"], null);

    const l = await lignes(r["ecriture_id"]!);
    const debit = l.reduce((t, x) => t + Number(x.debit), 0);
    const credit = l.reduce((t, x) => t + Number(x.credit), 0);
    assert.equal(debit, credit);
    assert.deepEqual(
      l.map((x) => [x.account_code, Number(x.debit), Number(x.credit)]),
      [
        [categorie.dotation, 750, 0],
        [categorie.amort, 0, 750],
        [categorie.amort, 3750, 0],
        ["636", 8250, 0],
        [categorie.immo, 0, 12000],
      ],
    );

    const { rows } = await s.admin.query<{ status: string }>(
      `select status from immo.assets where id = $1`,
      [bien],
    );
    assert.equal(rows[0]!.status, "rebute");
    await assert.rejects(sortir(bien, "rebute", "2026-03-15"), /refus\.immo\.sortie\.deja_sortie/);
  });

  it("cède à prix : l'écriture du prix porte le débiteur, le produit et la TVA saisie", async () => {
    const bien = await creer("Cession");
    await doter2025(bien);
    const r = await sortir(bien, "cede", "2026-03-15", "9000", "1710");
    assert.equal(Number(r["resultat"]), 750);
    assert.deepEqual(
      (await lignes(r["ecriture_prix_id"]!)).map((x) => [
        x.account_code,
        Number(x.debit),
        Number(x.credit),
      ]),
      [
        ["457", 10710, 0],
        ["736", 0, 9000],
        ["4367", 0, 1710],
      ],
    );
  });

  it("refuse une sortie quand un exercice antérieur n'est pas doté", async () => {
    const bien = await creer("Sans dotation");
    await assert.rejects(
      sortir(bien, "rebute", "2026-03-15"),
      /refus\.immo\.sortie\.dotations_manquantes/,
    );
  });

  it("refuse un prix sur une mise au rebut", async () => {
    const bien = await creer("Rebut à prix");
    await doter2025(bien);
    await assert.rejects(
      sortir(bien, "rebute", "2026-03-15", "100"),
      /refus\.immo\.sortie\.prix_au_rebut/,
    );
  });

  it("ne change plus l'état par la fiche", async () => {
    const bien = await creer("Fiche");
    await assert.rejects(
      sousIdentite(s.gens.amel.id, (db) =>
        db.query(
          `select public.immo_bien_modifier($1, 'Fiche', '2025-01-01', 12000, 0, 'lineaire',
                                            4::smallint, 1, 'cede')`,
          [bien],
        ),
      ),
      /refus\.immo\.statut_par_la_sortie/,
    );
  });
});
