import { describe, it, expect } from "vitest";
import { computePivot } from "../engines/p4/balance.ts";
import { canApprove } from "../engines/p4/traffic-light.ts";
import {
  TND,
  TAX_RATES_TN,
  MAP_ACHAT,
  MAP_VENTE,
  TOLERANCES,
  factureAchatSimple,
  factureAchatMultiTaux,
  factureDesequilibree,
  factureTauxManquant,
  factureVenteSimple,
} from "./fixtures.ts";
import { PivotV1 } from "../contracts/pivot.v1.ts";
import { D } from "../domain/decimal.ts";

describe("balance / pivot", () => {
  it("golden — facture achat simple : VERT, équilibrée", () => {
    const p = computePivot({
      extract: factureAchatSimple(),
      source_item_id: null,
      tenant_currency: TND,
      tax_rates: TAX_RATES_TN,
      mapping: MAP_ACHAT,
      tolerances: TOLERANCES,
    });
    expect(p.traffic_light).toBe("VERT");
    expect(p.approvable).toBe(true);
    expect(p.totals.debit).toBe("1190.000");
    expect(p.totals.credit).toBe("1190.000");
    expect(p.lines.map((l) => l.account_code).sort()).toEqual(["401", "4366", "607"]);
    // Contrat parsé strict
    expect(PivotV1.parse(p)).toBeTruthy();
  });

  it("golden — facture vente simple : VERT, contreparties 411/4367/707", () => {
    const p = computePivot({
      extract: factureVenteSimple(),
      source_item_id: null,
      tenant_currency: TND,
      tax_rates: TAX_RATES_TN,
      mapping: MAP_VENTE,
      tolerances: TOLERANCES,
    });
    expect(p.traffic_light).toBe("VERT");
    expect(p.lines.map((l) => l.account_code).sort()).toEqual(["411", "4367", "707"]);
  });

  it("golden — multi-taux : équilibre exact 928.000", () => {
    const p = computePivot({
      extract: factureAchatMultiTaux(),
      source_item_id: null,
      tenant_currency: TND,
      tax_rates: TAX_RATES_TN,
      mapping: MAP_ACHAT,
      tolerances: TOLERANCES,
    });
    expect(p.traffic_light).toBe("VERT");
    expect(p.totals.debit).toBe("928.000");
    expect(p.totals.credit).toBe("928.000");
  });

  it("golden — pièce déséquilibrée : ROUGE + non approvable", () => {
    const p = computePivot({
      extract: factureDesequilibree(),
      source_item_id: null,
      tenant_currency: TND,
      tax_rates: TAX_RATES_TN,
      mapping: MAP_ACHAT,
      tolerances: TOLERANCES,
    });
    expect(p.traffic_light).toBe("ROUGE");
    expect(p.approvable).toBe(false);
    expect(p.motifs.some((m) => m.code === "UNBALANCED" || m.code === "RESIDUAL_UNEXPLAINED")).toBe(
      true,
    );

    const decision = canApprove(p.traffic_light, {
      bulk_approve_enabled: true,
      is_bulk: false,
      approver_role_is_admin: true,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("traffic_light_red_blocked_by_engine");
  });

  it("golden — date sans taux applicable : refus explicite MISSING_TAX_RATE", () => {
    const p = computePivot({
      extract: factureTauxManquant(),
      source_item_id: null,
      tenant_currency: TND,
      tax_rates: TAX_RATES_TN,
      mapping: MAP_ACHAT,
      tolerances: TOLERANCES,
    });
    expect(p.motifs.some((m) => m.code === "MISSING_TAX_RATE")).toBe(true);
    expect(p.approvable).toBe(false);
  });

  it("confiance basse : ORANGE (warn) puis ROUGE (block)", () => {
    const base = factureAchatSimple();
    const orange = computePivot({
      extract: { ...base, field_confidence: { total: 0.7 } },
      source_item_id: null,
      tenant_currency: TND,
      tax_rates: TAX_RATES_TN,
      mapping: MAP_ACHAT,
      tolerances: TOLERANCES,
    });
    expect(orange.traffic_light).toBe("ORANGE");
    const rouge = computePivot({
      extract: { ...base, field_confidence: { total: 0.3 } },
      source_item_id: null,
      tenant_currency: TND,
      tax_rates: TAX_RATES_TN,
      mapping: MAP_ACHAT,
      tolerances: TOLERANCES,
    });
    expect(rouge.traffic_light).toBe("ROUGE");
    expect(rouge.approvable).toBe(false);
  });

  it("TVA incohérente avec le taux : ROUGE TAX_RATE_MISMATCH", () => {
    const bad = factureAchatSimple();
    bad.lines[0]!.vat_amount = "50.000";
    bad.lines[0]!.ttc = "1050.000";
    const p = computePivot({
      extract: bad,
      source_item_id: null,
      tenant_currency: TND,
      tax_rates: TAX_RATES_TN,
      mapping: MAP_ACHAT,
      tolerances: TOLERANCES,
    });
    expect(p.motifs.some((m) => m.code === "TAX_RATE_MISMATCH")).toBe(true);
    expect(p.traffic_light).toBe("ROUGE");
  });

  it("bulk approve désactivé : refus quel que soit le rôle", () => {
    const decision = canApprove("VERT", {
      bulk_approve_enabled: false,
      is_bulk: true,
      approver_role_is_admin: true,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("bulk_approve_disabled");
  });

  it("bulk approve activé : accepté", () => {
    const decision = canApprove("VERT", {
      bulk_approve_enabled: true,
      is_bulk: true,
      approver_role_is_admin: true,
    });
    expect(decision.allowed).toBe(true);
  });

  it("propriété — idempotence : deux exécutions identiques ⇒ résultats identiques", () => {
    const input = {
      extract: factureAchatMultiTaux(),
      source_item_id: "00000000-0000-0000-0000-000000000001",
      tenant_currency: TND,
      tax_rates: TAX_RATES_TN,
      mapping: MAP_ACHAT,
      tolerances: TOLERANCES,
    };
    const a = computePivot(input);
    const b = computePivot(input);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("propriété — Σdébit = Σcrédit sur toute pièce valide", () => {
    for (const extract of [factureAchatSimple(), factureAchatMultiTaux(), factureVenteSimple()]) {
      const mapping = extract.document_kind === "facture_achat" ? MAP_ACHAT : MAP_VENTE;
      const p = computePivot({
        extract,
        source_item_id: null,
        tenant_currency: TND,
        tax_rates: TAX_RATES_TN,
        mapping,
        tolerances: TOLERANCES,
      });
      expect(D(p.totals.debit).equals(p.totals.credit)).toBe(true);
    }
  });

  it("propriété — aucun montant n'est un float (toutes chaînes)", () => {
    const p = computePivot({
      extract: factureAchatMultiTaux(),
      source_item_id: null,
      tenant_currency: TND,
      tax_rates: TAX_RATES_TN,
      mapping: MAP_ACHAT,
      tolerances: TOLERANCES,
    });
    for (const line of p.lines) {
      expect(typeof line.debit).toBe("string");
      expect(typeof line.credit).toBe("string");
    }
    expect(typeof p.totals.debit).toBe("string");
    expect(typeof p.totals.credit).toBe("string");
  });
});

describe("balance / droits hors TVA", () => {
  const timbre = [
    {
      code: "DROIT_TIMBRE",
      label: "Droit de timbre",
      account_code: "6654",
      document_kind: "facture_achat" as const,
      fixed_amount: "1.000",
    },
  ];

  it("le droit de timbre déclaré équilibre la contrepartie fournisseur", () => {
    const base = factureAchatSimple();
    const extract = {
      ...base,
      other_charges: [{ code: "DROIT_TIMBRE", label: "Droit de timbre", amount: "1.000" }],
      totals: { ...base.totals, ttc: "1191.000" },
    };
    const p = computePivot({
      extract,
      source_item_id: null,
      tenant_currency: TND,
      tax_rates: TAX_RATES_TN,
      mapping: MAP_ACHAT,
      fiscal_charges: timbre,
      tolerances: TOLERANCES,
    });
    expect(p.totals.debit).toBe("1191.000");
    expect(p.totals.credit).toBe("1191.000");
    expect(p.lines.find((l) => l.account_code === "6654")?.debit).toBe("1.000");
    expect(p.traffic_light).toBe("VERT");
    expect(p.approvable).toBe(true);
  });

  it("un résidu de pied égal au droit du pack est attribué et l'écriture s'équilibre", () => {
    const base = factureAchatSimple();
    // TTC imprimé = HT + TVA + 1.000 sans ligne de droit lue.
    const extract = { ...base, other_charges: [], totals: { ...base.totals, ttc: "1191.000" } };
    const p = computePivot({
      extract,
      source_item_id: null,
      tenant_currency: TND,
      tax_rates: TAX_RATES_TN,
      mapping: MAP_ACHAT,
      fiscal_charges: timbre,
      tolerances: TOLERANCES,
    });
    expect(p.motifs.some((m) => m.code === "RESIDUAL_MATCHED_PACK_CHARGE")).toBe(true);
    expect(p.lines.find((l) => l.account_code === "6654")?.debit).toBe("1.000");
    expect(p.totals.debit).toBe(p.totals.credit);
    expect(p.approvable).toBe(true);
  });

  it("un résidu sans droit correspondant au pack bloque l'écriture", () => {
    const base = factureAchatSimple();
    const extract = { ...base, other_charges: [], totals: { ...base.totals, ttc: "1197.000" } };
    const p = computePivot({
      extract,
      source_item_id: null,
      tenant_currency: TND,
      tax_rates: TAX_RATES_TN,
      mapping: MAP_ACHAT,
      fiscal_charges: timbre,
      tolerances: TOLERANCES,
    });
    expect(p.motifs.some((m) => m.code === "RESIDUAL_UNEXPLAINED")).toBe(true);
    expect(p.approvable).toBe(false);
    expect(p.totals.debit).toBe(p.totals.credit);
  });

  it("un droit sans compte au pack bloque l'écriture, aucun montant inventé", () => {
    const base = factureAchatSimple();
    const extract = {
      ...base,
      other_charges: [{ code: "INCONNU", label: "?", amount: "1.000" }],
      totals: { ...base.totals, ttc: "1191.000" },
    };
    const p = computePivot({
      extract,
      source_item_id: null,
      tenant_currency: TND,
      tax_rates: TAX_RATES_TN,
      mapping: MAP_ACHAT,
      fiscal_charges: timbre,
      tolerances: TOLERANCES,
    });
    expect(p.motifs.some((m) => m.code === "MISSING_ACCOUNT_MAPPING")).toBe(true);
    expect(p.approvable).toBe(false);
  });
});
