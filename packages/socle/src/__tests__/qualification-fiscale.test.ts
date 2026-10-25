import { describe, expect, it } from "vitest";
import { calculerLignesFiscales } from "../engines/fiscalite/lignes.ts";
import { computePivot } from "../engines/p4/balance.ts";
import { D, sum } from "../domain/decimal.ts";
import type { QualificationFiscale } from "../ports/qualification-fiscale.ts";
import type { FiscalCharge } from "../ports/repositories.ts";
import {
  factureAchatSimple,
  TND,
  TAX_RATES_TN,
  MAP_ACHAT,
  MAP_VENTE,
  TOLERANCES,
} from "./fixtures.ts";

const droit: FiscalCharge = {
  code: "FODEC",
  label: "Droit du scénario",
  legalReference: "Source du scénario",
  documentKind: "facture_achat",
  accountCode: "taxe",
  fixedAmount: null,
  rate: "0.01",
  basis: "base_ht",
  taxable: true,
  incorporeAuCoutAchat: true,
};
const ligne = (
  baseHt = "1000",
  deduction: QualificationFiscale["lignes"][number]["deduction"] = "deductible",
  index = 0,
) => ({
  index,
  baseHt,
  compteCout: "cout",
  deduction,
  droits: [{ code: "FODEC", assiette: baseHt, referenceLegale: "Justificatif du scénario" }],
});
function qualification(lignes = [ligne()]): QualificationFiscale {
  return {
    pieceId: "00000000-0000-4000-8000-000000000001",
    extractionId: "00000000-0000-4000-8000-000000000002",
    profilVersionId: null,
    precedentId: null,
    documentKind: "facture_achat",
    dateOperation: "2026-07-15",
    contexte: "interieur",
    qualiteOperateur: "fabricant",
    justification: "Qualification justifiée par les produits du scénario",
    lignes,
  };
}
function calcul(
  q = qualification(),
  regimeTva = "assujetti",
  prorata: string | null = null,
  codesTva = ["TVA_19"],
) {
  return calculerLignesFiscales({
    qualification: q,
    codesTva,
    droits: [{ ...droit, documentKind: q.documentKind }],
    profil: null,
    regimeTva,
    prorata,
    decimales: 3,
  });
}
function piece() {
  const f = factureAchatSimple();
  f.lines[0]!.vat_amount = "191.900";
  f.lines[0]!.ttc = "1191.900";
  f.other_charges = [{ code: "FODEC", label: "Droit", amount: "10.000" }];
  f.totals = { base_ht: "1000.000", vat: "191.900", ttc: "1201.900" };
  return f;
}
function pivot(f = piece(), lignes = calcul()) {
  return computePivot({
    extract: f,
    source_item_id: null,
    tenant_currency: TND,
    tax_rates: TAX_RATES_TN,
    mapping: f.document_kind === "facture_achat" ? MAP_ACHAT : MAP_VENTE,
    fiscal_charges: [
      { code: "FODEC", label: "Droit", account_code: "taxe", rate: "0.01", taxable: true },
    ],
    lignes_fiscales: lignes,
    tolerances: TOLERANCES,
  });
}
function debit(p: ReturnType<typeof pivot>, compte: string) {
  return sum(p.lines.filter((l) => l.account_code === compte).map((l) => l.debit)).toFixed(3);
}

describe("qualification fiscale : calculs indépendants et équilibre strict", () => {
  it("inclut le droit taxable dans la base TVA et dans le coût d'achat", () => {
    const ls = calcul();
    expect(ls[0]!.majorationTva).toBe("10.000");
    const p = pivot();
    expect(p.approvable).toBe(true);
    expect(debit(p, "cout")).toBe("1010.000");
    expect(debit(p, MAP_ACHAT.vat_account)).toBe("191.900");
    expect(p.totals).toEqual({ debit: "1201.900", credit: "1201.900" });
  });
  it("incorpore la TVA non récupérable au coût, au prorata daté", () => {
    const p = pivot(piece(), calcul(qualification([ligne("1000", "prorata")]), "partiel", "60"));
    expect(p.approvable).toBe(true);
    expect(debit(p, "cout")).toBe("1086.760");
    expect(debit(p, MAP_ACHAT.vat_account)).toBe("115.140");
  });
  it("ventile un même taux entre usages et imputations distincts", () => {
    const ls = calcul(
      qualification([ligne("200", "non_deductible"), { ...ligne("800"), compteCout: "stock" }]),
    );
    const p = pivot(piece(), ls);
    expect(p.approvable).toBe(true);
    expect(debit(p, "cout")).toBe("240.380");
    expect(debit(p, "stock")).toBe("808.000");
    expect(debit(p, MAP_ACHAT.vat_account)).toBe("153.520");
  });
  it("qualifie des taux multiples avec droit applicable à une seule base", () => {
    const f = piece();
    f.lines = [
      {
        label: "Produits",
        tax_code: "TVA_19",
        base_ht: "5000",
        vat_amount: "959.500",
        ttc: "5959.500",
      },
      { label: "Autres", tax_code: "TVA_07", base_ht: "800", vat_amount: "56", ttc: "856" },
    ];
    f.other_charges[0]!.amount = "50";
    f.totals = { base_ht: "5800", vat: "1015.500", ttc: "6865.500" };
    const p = pivot(
      f,
      calcul(
        qualification([
          ligne("5000"),
          { ...ligne("800", "non_deductible", 1), droits: [], compteCout: "autre" },
        ]),
        "partiel",
        "60",
        ["TVA_19", "TVA_07"],
      ),
    );
    expect(p.approvable).toBe(true);
    expect(debit(p, "cout")).toBe("5050.000");
    expect(debit(p, "autre")).toBe("856.000");
    expect(debit(p, MAP_ACHAT.vat_account)).toBe("959.500");
    expect(p.totals.credit).toBe("6865.500");
  });
  it("conserve le millime avec trois allocations d'une même TVA", () => {
    const f = factureAchatSimple();
    f.lines[0]!.base_ht = "0.003";
    f.lines[0]!.vat_amount = "0.001";
    f.other_charges = [];
    f.totals = { base_ht: "0.003", vat: "0.001", ttc: "0.004" };
    const ls = calcul(
      qualification(
        [0, 1, 2].map((n) => ({
          ...ligne("0.001", n === 0 ? "non_deductible" : "deductible"),
          droits: [],
        })),
      ),
    );
    const p = pivot(f, ls);
    expect(p.approvable).toBe(true);
    expect(p.totals).toEqual({ debit: "0.004", credit: "0.004" });
    expect(debit(p, "cout")).toBe("0.004");
  });
  it("refuse une TVA calculée hors droit et un écart TTC d'un millime", () => {
    const f = piece();
    f.lines[0]!.vat_amount = "190";
    f.totals.vat = "190";
    f.totals.ttc = "1200";
    expect(pivot(f).approvable).toBe(false);
    const g = piece();
    g.totals.ttc = "1201.901";
    expect(pivot(g).motifs.some((m) => m.code === "RESIDUAL_UNEXPLAINED")).toBe(true);
  });
  it("refuse la divergence de la base ou du droit imprimé", () => {
    expect(pivot(piece(), calcul(qualification([ligne("900")]))).approvable).toBe(false);
    const f = piece();
    f.other_charges[0]!.amount = "9";
    expect(pivot(f).approvable).toBe(false);
    expect(() =>
      calcul(
        qualification([
          { ...ligne(), droits: [{ code: "FODEC", assiette: "1001", referenceLegale: "Test" }] },
        ]),
      ),
    ).toThrow(/dépasse/);
  });
  it("ne laisse pas passer un droit proportionnel sans qualification", () => {
    const p = computePivot({
      extract: piece(),
      source_item_id: null,
      tenant_currency: TND,
      tax_rates: TAX_RATES_TN,
      mapping: MAP_ACHAT,
      fiscal_charges: [
        { code: "FODEC", label: "Droit", account_code: "taxe", rate: "0.01", taxable: true },
      ],
      tolerances: TOLERANCES,
    });
    expect(p.approvable).toBe(false);
  });
  it("refuse une déduction sans régime ou un prorata absent", () => {
    expect(() => calcul(qualification(), "non_assujetti")).toThrow(/régime/);
    expect(() => calcul(qualification([ligne("1000", "prorata")]), "partiel")).toThrow(/prorata/);
    const p = pivot(
      piece(),
      calcul(qualification([ligne("1000", "non_deductible")]), "non_assujetti"),
    );
    expect(p.approvable).toBe(true);
    expect(debit(p, "cout")).toBe("1201.900");
    expect(debit(p, MAP_ACHAT.vat_account)).toBe("0.000");
  });
  it("une vente collecte toute la TVA et crédite le droit, sans déduction", () => {
    const q = qualification();
    q.documentKind = "facture_vente";
    const ls = calcul(q);
    const f = piece();
    f.document_kind = "facture_vente";
    const p = pivot(f, ls);
    expect(p.approvable).toBe(true);
    expect(
      sum(p.lines.filter((l) => l.account_code === "taxe").map((l) => l.credit)).toFixed(3),
    ).toBe("10.000");
    expect(p.lines.find((l) => l.account_code === MAP_VENTE.vat_account)?.credit).toBe("191.900");
    q.lignes[0]!.deduction = "prorata";
    expect(() => calcul(q)).toThrow(/collectée/);
  });
  it("chaque écriture est exactement équilibrée, sans ligne de résidu", () => {
    for (const d of ["0", "1", "33.3333", "60", "100"]) {
      const p = pivot(piece(), calcul(qualification([ligne("1000", "prorata")]), "partiel", d));
      expect(D(p.totals.debit).eq(p.totals.credit)).toBe(true);
      expect(p.approvable).toBe(true);
    }
  });
});
