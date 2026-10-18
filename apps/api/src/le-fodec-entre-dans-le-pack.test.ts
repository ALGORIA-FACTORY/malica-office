/**
 * Le FODEC est un droit du pack tunisien, et l'arithmétique le retrouve.
 *
 * ==================================================================== LE DÉFAUT
 *
 * 18 octobre 2026, mesuré sur une facture réelle (MEUBLES EL AMEN) : le FODEC
 * à 1 % figurait sur quatre des cinq lignes, pour 71,200 dinars, et
 * `ref.fiscal_charges` du pack TN ne connaissait que le droit de timbre.
 *
 * La lecture était JUSTE — HT, TVA, timbre et TTC au millime près. C'est
 * l'arithmétique qui sortait incohérente : le moteur d'équilibre retrouvait un
 * résidu de 71,200 entre le TTC imprimé et HT + TVA + droits déclarés, ne
 * trouvait au pack aucun droit à montant fixe de cette valeur, et bloquait
 * l'écriture sur `RESIDUAL_UNEXPLAINED`. Une facture industrielle tunisienne
 * sur deux porte ce droit.
 *
 * ===================================================================== LA SOURCE
 *
 * Le taux et l'assiette ne viennent pas d'une mémoire : ils sont dans le
 * corpus du dépôt, verbatim, en français et en arabe — `LF-2011` art. 15 :
 *
 *   « Sont modifiées les dispositions du paragraphe premier de l'article 37 de
 *     la loi n° 99-101 du 31 décembre 1999 portant loi de finances pour
 *     l'année 2000 comme suit : La taxe est due au taux de 1% sur : — le
 *     chiffre d'affaires hors taxe sur la valeur ajoutée réalisé par les
 *     fabricants des produits soumis à la taxe et sur la valeur en douane pour
 *     [l'importation], — le chiffre d'affaires hors taxe sur la valeur ajoutée
 *     réalisé par les prestataires de services. »
 *
 * Taux 1 %, assiette « chiffre d'affaires hors TVA ». Rien n'est deviné.
 *
 * ================================================================ CE QU'ON TIENT
 *
 * 1. Le pack porte le FODEC, dans les deux sens de facture, avec son taux, son
 *    assiette, son compte et sa référence légale.
 * 2. Il est traduit dans les trois langues, comme les motifs de rejet.
 * 3. Une facture d'achat qui porte un FODEC lu produit une écriture ÉQUILIBRÉE,
 *    sans résidu inexpliqué, et la ligne tombe sur le compte du pack.
 *
 * Le point 3 est celui qui compte : les deux premiers sont du référentiel, le
 * troisième est la raison d'être du référentiel.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { computePivot } from "@malica/socle/engines/p4/balance";
import type { FiscalChargeRule } from "@malica/socle/engines/p4/balance";
import type { AccountMappingRule, TaxRateRow } from "@malica/socle/domain/types";
import type { ExtractV1 } from "@malica/socle/contracts/extract.v1";

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL_ADMIN"]);

/** Le dinar, à trois décimales — l'échelle vient du pack, pas d'ici. */
const TND = { code: "TND", decimals: 3 } as const;

const TOLERANCES = {
  rounding_tolerance: "0.001",
  confidence_orange: 0.85,
  confidence_red: 0.6,
} as const;

/*
 * La facture mesurée, reconstituée au millime.
 *
 * Quatre lignes portent le FODEC (7 120,000 de base → 71,200), la cinquième
 * non (500,000). La TVA est celle que la pièce imprime : 19 % de la base HT de
 * chaque ligne — c'est ce que le fournisseur a calculé, et le contrôle
 * taux ↔ montants du moteur travaille ligne par ligne.
 *
 *   HT      7 620,000
 *   TVA     1 447,800
 *   FODEC      71,200
 *   Timbre      1,000
 *   TTC     9 140,000
 */
function factureAvecFodec(): ExtractV1 {
  const ligne = (label: string, base: string) => ({
    label,
    tax_code: "TVA19",
    base_ht: base,
    vat_amount: (Number(base) * 0.19).toFixed(3),
    ttc: (Number(base) * 1.19).toFixed(3),
  });

  return {
    contract: "extract.v1",
    issuer: "MEUBLES EL AMEN",
    document_date: "2026-09-30",
    currency: "TND",
    document_kind: "facture_achat",
    lines: [
      ligne("Chaise rembourrée", "2000.000"),
      ligne("Table de réunion", "2500.000"),
      ligne("Armoire métallique", "1800.000"),
      ligne("Caisson mobile", "820.000"),
      ligne("Transport", "500.000"),
    ],
    articles: [],
    other_charges: [
      { code: "FODEC", amount: "71.200" },
      { code: "DROIT_TIMBRE", amount: "1.000" },
    ],
    totals: { base_ht: "7620.000", vat: "1447.800", ttc: "9140.000" },
    references: { invoice_no: "F-2026-1187" },
    field_confidence: { issuer: 0.99, document_date: 0.98, total: 0.99 },
  };
}

describe("le FODEC dans le pack tunisien", { skip: !BASE_CONFIGUREE }, () => {
  let pool: pg.Pool;
  let pack = "";

  before(async () => {
    pool = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
    const { rows } = await pool.query<{ id: string }>(
      `select id from ref.jurisdiction_packs where jurisdiction = 'TN'
        order by effective_from desc limit 1`,
    );
    pack = rows[0]!.id;
  });

  after(async () => {
    await pool.end();
  });

  it("porte le FODEC dans les deux sens, avec son taux, son assiette et sa source", async () => {
    const { rows } = await pool.query<{
      document_kind: string;
      account_code: string;
      rate: string | null;
      basis: string;
      fixed_amount: string | null;
      taxable: boolean;
      legal_reference: string | null;
      valid_from: Date;
    }>(
      `select document_kind, account_code, rate::text as rate, basis,
              fixed_amount::text as fixed_amount, taxable, legal_reference, valid_from
         from ref.fiscal_charges
        where pack_version_id = $1 and code = 'FODEC'
        order by document_kind`,
      [pack],
    );

    assert.deepEqual(
      rows.map((r) => r.document_kind),
      ["facture_achat", "facture_vente"],
      "le FODEC se lit sur une facture d'achat comme sur une facture de vente",
    );

    for (const r of rows) {
      assert.equal(Number(r.rate), 0.01, "le taux du FODEC est 1 % (LF-2011 art. 15)");
      assert.equal(r.basis, "base_ht", "l'assiette est le chiffre d'affaires hors TVA");
      assert.equal(r.fixed_amount, null, "un droit proportionnel ne porte pas de montant fixe");
      assert.ok(
        r.legal_reference && /99-101/.test(r.legal_reference),
        "la référence légale nomme la loi qui institue la taxe",
      );
      assert.equal(
        r.valid_from.toISOString().slice(0, 10),
        "2011-01-01",
        "le taux de 1 % court depuis la loi de finances pour 2011",
      );
      assert.equal(
        r.taxable,
        true,
        "le FODEC entre dans l'assiette de la TVA (Code de la TVA, art. 6-I : " +
          "« tous frais, droits et taxes inclus, à l'exclusion de la TVA »)",
      );
    }

    // Le compte d'imputation : class 6 à l'achat (charge), 437x à la vente
    // (dette envers l'État). Ce sont des DÉFAUTS livrés (R10) — le cabinet les
    // change au paramétrage. Ce que l'épreuve tient, c'est qu'ils existent au
    // plan comptable du pack, et qu'ils ne sont pas des comptes de TVA.
    const comptes = rows.map((r) => r.account_code);
    const { rows: connus } = await pool.query<{ account_code: string }>(
      `select account_code from ref.accounts
        where pack_version_id = $1 and account_code = any($2::text[])`,
      [pack, comptes],
    );
    assert.deepEqual(
      connus.map((c) => c.account_code).sort(),
      [...comptes].sort(),
      "un compte d'imputation absent du plan du pack bloque l'écriture",
    );
  });

  it("dit le FODEC en français, en anglais et en arabe", async () => {
    const { rows } = await pool.query<{ locale: string; value: string }>(
      `select locale, value from ref.labels
        where ns = 'fiscal_charge' and key = 'FODEC' order by locale`,
    );
    assert.deepEqual(
      rows.map((r) => r.locale),
      ["ar", "en", "fr"],
      "un libellé sans traduction affiche du français au milieu de l'arabe",
    );
    for (const r of rows) assert.ok(r.value.trim().length > 0);
  });

  it("équilibre une facture qui porte le FODEC, sans résidu inexpliqué", async () => {
    const { rows: taux } = await pool.query<{ code: string; rate: string }>(
      `select code, rate::text as rate from ref.tva_rates where pack_version_id = $1`,
      [pack],
    );
    const tax_rates: TaxRateRow[] = taux.map((t) => ({
      code: t.code,
      label: t.code,
      rate: t.rate,
      valid_from: "2018-01-01",
      valid_to: null,
      jurisdiction: "TN",
    }));

    const { rows: charges } = await pool.query<{
      code: string;
      label: string;
      account_code: string;
      document_kind: string;
      fixed_amount: string | null;
    }>(
      `select code, label, account_code, document_kind, fixed_amount::text as fixed_amount
         from ref.fiscal_charges where pack_version_id = $1`,
      [pack],
    );
    const fiscal_charges: FiscalChargeRule[] = charges.map((c) => ({
      code: c.code,
      label: c.label,
      account_code: c.account_code,
      document_kind: c.document_kind as FiscalChargeRule["document_kind"],
      fixed_amount: c.fixed_amount,
    }));

    const { rows: mapping } = await pool.query<{
      main_account: string;
      vat_account: string;
      counterparty_account: string;
    }>(
      `select main_account, vat_account, counterparty_account
         from ref.account_mappings
        where pack_version_id = $1 and document_kind = 'facture_achat' and tax_code = 'TVA19'`,
      [pack],
    );
    const m = mapping[0]!;
    const imputation: AccountMappingRule = {
      document_kind: "facture_achat",
      charge_or_product_account: m.main_account,
      vat_account: m.vat_account,
      counterparty_account: m.counterparty_account,
    };

    const pivot = computePivot({
      extract: factureAvecFodec(),
      source_item_id: null,
      tenant_currency: TND,
      tax_rates,
      mapping: imputation,
      fiscal_charges,
      tolerances: TOLERANCES,
    });

    const bloquants = pivot.motifs.filter((x) => x.severity === "block");
    assert.deepEqual(
      bloquants.map((x) => `${x.code} — ${x.message}`),
      [],
      "une facture dont la lecture est juste au millime ne doit rien bloquer",
    );
    assert.equal(pivot.totals.debit, pivot.totals.credit, "débit et crédit au millime");

    const fodec = pivot.lines.find((l) => l.label.toUpperCase().includes("FODEC"));
    assert.ok(fodec, "le FODEC a sa propre ligne d'écriture, il ne se noie pas dans le HT");
    assert.equal(fodec.debit, "71.200", "le montant est celui qui est LU sur la pièce (R2)");

    const compteDuPack = charges.find(
      (c) => c.code === "FODEC" && c.document_kind === "facture_achat",
    )!.account_code;
    assert.equal(fodec.account_code, compteDuPack, "le compte vient du pack, jamais du code");
  });
});
