import { describe, it, expect } from "vitest";
import { computeEcheances } from "../engines/echeance/next";
import {
  loadJurisdictionPack,
  isInForce,
  PackUnavailable,
  PackRuleInvalid,
  type PackRuleRow,
} from "../juridictions/tn";

/**
 * Les valeurs réglementaires ci-dessous sont des FIXTURES de test, pas un
 * référentiel : en production elles viennent de `ref.pack_rules`.
 */
function row(over: Partial<PackRuleRow> = {}): PackRuleRow {
  return {
    jurisdiction: "TN",
    kind: "DECL_MENSUELLE",
    label: "Déclaration mensuelle",
    cadence: "monthly",
    day_of_month: 28,
    month_offset: 1,
    legal_reference: "fixture-test",
    valid_from: "2020-01-01",
    valid_to: null,
    ...over,
  };
}

describe("juridictions / chargeur", () => {
  it("ne retient que les règles de la juridiction en vigueur", () => {
    const rows = [
      row(),
      row({ jurisdiction: "MA" }),
      row({ kind: "ABROGEE", valid_to: "2021-12-31" }),
      row({ kind: "FUTURE", valid_from: "2030-01-01" }),
    ];
    const pack = loadJurisdictionPack(rows, "TN", "2026-07-15");
    expect(pack.jurisdiction).toBe("TN");
    expect(pack.rules.map((r) => r.kind)).toEqual(["DECL_MENSUELLE"]);
  });

  it("refuse de calculer plutôt que de rendre un pack vide", () => {
    expect(() => loadJurisdictionPack([], "TN", "2026-07-15")).toThrow(PackUnavailable);
    expect(() => loadJurisdictionPack([row({ jurisdiction: "FR" })], "TN", "2026-07-15")).toThrow(
      PackUnavailable,
    );
  });

  it("rejette une règle malformée", () => {
    expect(() => loadJurisdictionPack([row({ cadence: "hebdo" })], "TN", "2026-07-15")).toThrow(
      PackRuleInvalid,
    );
    expect(() => loadJurisdictionPack([row({ day_of_month: 0 })], "TN", "2026-07-15")).toThrow(
      PackRuleInvalid,
    );
    expect(() => loadJurisdictionPack([row({ day_of_month: 32 })], "TN", "2026-07-15")).toThrow(
      PackRuleInvalid,
    );
    expect(() => loadJurisdictionPack([row({ month_offset: -1 })], "TN", "2026-07-15")).toThrow(
      PackRuleInvalid,
    );
  });

  it("omet la référence légale absente au lieu de l'inventer", () => {
    const pack = loadJurisdictionPack([row({ legal_reference: null })], "TN", "2026-07-15");
    expect(pack.rules[0]!.legal_reference).toBeUndefined();
  });

  it("bornes de validité incluses", () => {
    const r = row({ valid_from: "2026-01-01", valid_to: "2026-12-31" });
    expect(isInForce(r, "2026-01-01")).toBe(true);
    expect(isInForce(r, "2026-12-31")).toBe(true);
    expect(isInForce(r, "2025-12-31")).toBe(false);
    expect(isInForce(r, "2027-01-01")).toBe(false);
  });
});

describe("echeance / next", () => {
  it("mensuel : échéance au mois suivant", () => {
    const pack = loadJurisdictionPack([row()], "TN", "2026-07-15");
    const r = computeEcheances(pack, "2026-07");
    expect(r).toHaveLength(1);
    expect(r[0]!.kind).toBe("DECL_MENSUELLE");
    expect(r[0]!.due_date).toBe("2026-08-28");
    expect(r[0]!.jurisdiction).toBe("TN");
  });

  it("pack sans règle : liste vide", () => {
    expect(computeEcheances({ jurisdiction: "FR", rules: [] }, "2026-07")).toEqual([]);
  });

  it("wrap année : décembre + 1 mois = janvier N+1", () => {
    const pack = loadJurisdictionPack([row()], "TN", "2026-12-15");
    expect(computeEcheances(pack, "2026-12")[0]!.due_date).toBe("2027-01-28");
  });

  it("quarterly : ne se déclenche qu'à fin de trimestre", () => {
    const pack = loadJurisdictionPack(
      [row({ kind: "ACOMPTE", cadence: "quarterly", day_of_month: 15 })],
      "TN",
      "2026-07-15",
    );
    expect(computeEcheances(pack, "2026-07")).toEqual([]);
    expect(computeEcheances(pack, "2026-09")).toHaveLength(1);
  });

  it("yearly : bascule sur année N+1", () => {
    const pack = loadJurisdictionPack(
      [row({ kind: "BILAN", cadence: "yearly", day_of_month: 30, month_offset: 3 })],
      "TN",
      "2026-07-15",
    );
    const r = computeEcheances(pack, "2026-07");
    expect(r[0]!.due_date).toBe("2027-04-30");
    expect(r[0]!.period).toBe("2026");
  });
});
