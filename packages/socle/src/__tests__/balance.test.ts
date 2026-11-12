/**
 * Les épreuves du moteur d'écriture — la pièce lue devient une écriture, ou elle est refusée.
 *
 * `computePivot` transforme une pièce lue en écriture équilibrée et lui donne un feu
 * (VERT, ORANGE, ROUGE). Ces épreuves figent ce que le comptable doit pouvoir croire :
 * une pièce équilibrée passe, une pièce déséquilibrée est ROUGE et non approuvable
 * quel que soit le rôle de l'approbateur, une date sans taux applicable est refusée
 * avec son motif, et aucun montant n'est jamais un nombre flottant (R3 : le chiffre
 * sort d'un moteur déterministe).
 *
 * Elles couvrent aussi les cas fiscaux où une erreur serait plausible et invisible :
 * la base sans TVA (régime d'export) qui garde son code, et les droits hors TVA
 * (timbre, FODEC) qui équilibrent la contrepartie, entrent ou non dans la base de la
 * TVA selon le référentiel, et bloquent l'inscription quand le pack n'a pas de compte
 * pour eux, plutôt que d'inventer un montant.
 */
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

describe("balance / base sans TVA", () => {
  // Recette sur le staging (1er novembre 2026) : une vente à l'export se
  // proposait sans code de régime ; sa base manquait à la déclaration, et le
  // forçage, lui, la refusait pour cette raison (revue de #140, cas J).
  const EXPORT = {
    code: "EXPORT",
    label: "Export",
    rate: "0",
    valid_from: "2018-01-01",
    valid_to: null,
    jurisdiction: "TN",
  };
  const venteExport = () => {
    const f = factureVenteSimple();
    return {
      ...f,
      lines: [
        {
          label: "Vente",
          tax_code: "EXPORT",
          base_ht: "2000.000",
          vat_amount: "0",
          ttc: "2000.000",
        },
      ],
      totals: { base_ht: "2000.000", vat: "0", ttc: "2000.000" },
    };
  };

  it("une base sans TVA porte son code de régime", () => {
    const p = computePivot({
      extract: venteExport(),
      source_item_id: null,
      tenant_currency: TND,
      tax_rates: [...TAX_RATES_TN, EXPORT],
      mapping: MAP_VENTE,
      tolerances: TOLERANCES,
    });
    const base = p.lines.find((l) => l.account_code === MAP_VENTE.charge_or_product_account);
    expect(base?.tax_code).toBe("EXPORT");
  });

  // Recette du 11 novembre 2026 : la ligne de charge exportait un code de taxe vide.
  it("une base avec TVA porte aussi son code, quand la pièce n'en a qu'un", () => {
    const p = computePivot({
      extract: factureVenteSimple(),
      source_item_id: null,
      tenant_currency: TND,
      tax_rates: TAX_RATES_TN,
      mapping: MAP_VENTE,
      tolerances: TOLERANCES,
    });
    const base = p.lines.find((l) => l.account_code === MAP_VENTE.charge_or_product_account);
    const tva = p.lines.find((l) => l.account_code !== base?.account_code && l.tax_code);
    expect(base?.tax_code).toBe(tva?.tax_code);
    expect(base?.tax_code).toBeTruthy();
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

  it("un droit imprimé hors barème conserve sa valeur mais bloque l'inscription", () => {
    const base = factureAchatSimple();
    const p = computePivot({
      extract: {
        ...base,
        other_charges: [{ code: "DROIT_TIMBRE", label: "Timbre", amount: "2.000" }],
        totals: { ...base.totals, ttc: "1192.000" },
      },
      source_item_id: null,
      tenant_currency: TND,
      tax_rates: TAX_RATES_TN,
      mapping: MAP_ACHAT,
      fiscal_charges: timbre,
      tolerances: TOLERANCES,
    });
    expect(p.approvable).toBe(false);
    expect(p.motifs.some((m) => m.code === "FISCAL_CHARGE_MISMATCH")).toBe(true);
    expect(p.lines.find((l) => l.account_code === "6654")?.debit).toBe("2.000");
  });
  it("un résidu égal au timbre ne prouve pas un droit : il reste bloquant", () => {
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
    expect(p.motifs.some((m) => m.code === "RESIDUAL_UNEXPLAINED")).toBe(true);
    expect(p.lines.find((l) => l.account_code === "6654")).toBeUndefined();
    expect(p.approvable).toBe(false);
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

  /*
   * Jeu synthétique, 31 octobre 2026 (cas 005, 017, 042, 081) : un achat avec
   * FODEC, la TVA assise sur HT + FODEC comme le référentiel le dit
   * (`ref.fiscal_charges.taxable`), se refusait « TVA incohérente » : le
   * moteur ne confrontait au taux que la base de la ligne.
   */
  const fodec = (taxable: boolean) => ({
    code: "FODEC",
    label: "FODEC",
    account_code: "6652",
    document_kind: "facture_achat" as const,
    fixed_amount: null,
    taxable,
  });
  const avecFodec = (tva: string, ttc: string) => {
    const base = factureAchatSimple();
    return {
      ...base,
      lines: [{ ...base.lines[0]!, vat_amount: tva, ttc }],
      other_charges: [
        { code: "FODEC", label: "FODEC", amount: "10.000" },
        { code: "DROIT_TIMBRE", label: "Droit de timbre", amount: "1.000" },
      ],
      totals: { base_ht: "1000.000", vat: tva, ttc },
    };
  };

  it("un droit taxable entre dans la base de la TVA : la ligne se vérifie sur HT + droit", () => {
    const p = computePivot({
      extract: avecFodec("191.900", "1202.900"),
      source_item_id: null,
      tenant_currency: TND,
      tax_rates: TAX_RATES_TN,
      mapping: MAP_ACHAT,
      fiscal_charges: [...timbre, fodec(true)],
      tolerances: TOLERANCES,
    });
    expect(p.motifs.map((m) => m.code)).toEqual(["OK"]);
    expect(p.approvable).toBe(true);
    expect(p.lines.find((l) => l.account_code === "6652")?.debit).toBe("10.000");
    expect(p.totals.debit).toBe("1202.900");
  });

  it("la règle vient du référentiel : un droit non taxable n'entre pas dans la base", () => {
    const p = computePivot({
      extract: avecFodec("191.900", "1202.900"),
      source_item_id: null,
      tenant_currency: TND,
      tax_rates: TAX_RATES_TN,
      mapping: MAP_ACHAT,
      fiscal_charges: [...timbre, fodec(false)],
      tolerances: TOLERANCES,
    });
    expect(p.motifs.some((m) => m.code === "TAX_RATE_MISMATCH")).toBe(true);
    expect(p.approvable).toBe(false);
  });

  it("une TVA imprimée sans le droit taxable se lit telle quelle (la lecture l'a mise en réserve)", () => {
    const p = computePivot({
      extract: avecFodec("190.000", "1201.000"),
      source_item_id: null,
      tenant_currency: TND,
      tax_rates: TAX_RATES_TN,
      mapping: MAP_ACHAT,
      fiscal_charges: [...timbre, fodec(true)],
      tolerances: TOLERANCES,
    });
    expect(p.approvable).toBe(true);
  });
});
