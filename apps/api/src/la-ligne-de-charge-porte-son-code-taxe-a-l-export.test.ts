/**
 * La ligne de charge porte son code taxe à l'export (recette du 11 novembre
 * 2026, point 2.7) : dans le fichier des écritures, le code taxe était rempli
 * sur la ligne de TVA et vide sur la ligne de charge, sa base.
 *
 * La correction vit à la LECTURE de l'export, pas dans les propositions du
 * Socle : une écriture juste reste telle qu'elle a été inscrite (R7), et les
 * jeux de référence qui la mesurent ne bougent pas. Un seul code taxe sur
 * l'écriture : sa base le porte. Plusieurs : rien n'est deviné.
 *
 *   node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/la-ligne-de-charge-porte-son-code-taxe-a-l-export.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import {
  BASE_CONFIGUREE,
  monterUneSociete,
  type LigneDEssai,
  type SocieteDEssai,
} from "./circuit-d-essai.ts";
import { fermerLePool } from "./db.ts";

const ligne = (
  account_code: string,
  debit: string,
  credit: string,
  tax_code: string | null = null,
): LigneDEssai => ({ account_code, libelle: account_code, debit, credit, tax_code });

describe("la ligne de charge porte son code taxe à l'export", { skip: !BASE_CONFIGUREE }, () => {
  let s: SocieteDEssai;
  /** Les comptes de TVA, de droit et de tiers du pack, lus et non écrits (R4). */
  let ach: {
    tva: string;
    tiers: string;
    charge: string;
    droit: string;
    codes: string[];
    /** La TVA de chaque code sur une base de 100, au taux du pack. */
    tvaSur100: string[];
  };
  /** Pour chaque écriture, ses lignes : compte → code taxe exporté. */
  let exporte: Map<string, Array<{ compte: string; code: string }>>;
  const numeros: Record<"un_code" | "deux_codes", string> = { un_code: "", deux_codes: "" };

  before(async () => {
    s = await monterUneSociete(`code-taxe-${Date.now()}`);
    const { rows } = await s.admin.query<{
      main_account: string;
      vat_account: string;
      counterparty_account: string;
      tax_code: string;
      rate: string;
    }>(
      `select main_account, vat_account, counterparty_account, tax_code, t.rate::text as rate
         from ref.account_mappings m
         join ref.tva_rates t on t.pack_version_id = m.pack_version_id and t.code = m.tax_code
        where m.pack_version_id = $1 and m.document_kind = 'facture_achat'
          and t.rate > 0 and t.valid_to is null
        order by m.tax_code`,
      [s.pack],
    );
    const droit = await s.admin.query<{ account_code: string }>(
      `select account_code from ref.fiscal_charges
        where pack_version_id = $1 and document_kind = 'facture_achat'
        order by code limit 1`,
      [s.pack],
    );
    assert.ok(rows.length >= 2 && droit.rows[0], "deux taux non nuls et un droit au pack");
    ach = {
      charge: rows[0]!.main_account,
      tva: rows[0]!.vat_account,
      tiers: rows[0]!.counterparty_account,
      droit: droit.rows[0]!.account_code,
      codes: rows.map((r) => r.tax_code),
      tvaSur100: rows.map((r) => (100 * Number(r.rate)).toFixed(3)),
    };
    const [ta, tb] = ach.tvaSur100 as [string, string];
    const total = (...m: string[]) => m.reduce((x, y) => x + Number(y), 0).toFixed(3);
    const [a, b] = ach.codes as [string, string];

    const inscrire = async (lignes: LigneDEssai[]) => {
      const piece = await s.deposer("amel", "entite");
      await s.lire("amel", piece);
      await s.fait("amel", "collab.envoyer", piece);
      await s.priseEnCharge(piece, lignes);
    };
    // Charge, TVA d'un seul code, un droit hors TVA, le fournisseur.
    await inscrire([
      ligne(ach.charge, "100.000", "0"),
      ligne(ach.tva, ta, "0", a),
      ligne(ach.droit, "1.000", "0"),
      ligne(ach.tiers, "0", total("100", ta, "1")),
    ]);
    // Une base, deux TVA de codes différents : la base ne se devine pas.
    await inscrire([
      ligne(ach.charge, "200.000", "0"),
      ligne(ach.tva, ta, "0", a),
      ligne(ach.tva, tb, "0", b),
      ligne(ach.tiers, "0", total("200", ta, tb)),
    ]);

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
    const [iNum, iCompte, iCode] = ["numero", "compte", "code_taxe"].map((c) =>
      colonnes.indexOf(c),
    );
    exporte = new Map();
    for (const l of corps) {
      const champs = l.split(";");
      const n = champs[iNum!]!;
      exporte.set(n, [
        ...(exporte.get(n) ?? []),
        { compte: champs[iCompte!]!, code: champs[iCode!]! },
      ]);
    }
    // Les numéros suivent l'ordre d'inscription dans le journal.
    const tries = [...exporte.keys()].sort((x, y) => Number(x) - Number(y));
    assert.equal(tries.length, 2, "deux écritures exportées");
    numeros.un_code = tries[0]!;
    numeros.deux_codes = tries[1]!;
  });
  after(async () => {
    await s.fermer();
    await fermerLePool();
  });

  it("un seul code taxe : la ligne de charge le porte, le droit et le fournisseur non", () => {
    const [a] = ach.codes;
    const lignes = exporte.get(numeros.un_code)!;
    assert.deepEqual(
      lignes.map((l) => [l.compte, l.code]),
      [
        [ach.charge, a],
        [ach.tva, a],
        [ach.droit, ""],
        [ach.tiers, ""],
      ],
    );
  });

  it("deux codes taxe : la ligne de charge reste sans code, chaque TVA garde le sien", () => {
    const [a, b] = ach.codes;
    const lignes = exporte.get(numeros.deux_codes)!;
    assert.deepEqual(
      lignes.map((l) => [l.compte, l.code]),
      [
        [ach.charge, ""],
        [ach.tva, a],
        [ach.tva, b],
        [ach.tiers, ""],
      ],
    );
  });

  it("l'écriture inscrite n'est pas réécrite : la ligne de charge reste sans code en base", async () => {
    const { rows } = await s.admin.query<{ n: number }>(
      `select count(*)::int as n from socle.ecriture_lignes l
         join socle.ecritures e on e.id = l.ecriture_id
        where e.tenant_id = $1 and l.account_code = $2 and l.tax_code is not null`,
      [s.pme, ach.charge],
    );
    assert.equal(rows[0]!.n, 0);
  });
});
