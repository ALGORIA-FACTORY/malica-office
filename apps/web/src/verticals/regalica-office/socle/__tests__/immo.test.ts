import { describe, expect, it } from "vitest";

import {
  computeAmortissement,
  computeCession,
  computeDepreciation,
  vncNette,
} from "../engines/immo/amortissement";

const base = {
  currency: "TND",
  decimals: 3,
  valeurBrute: "12000.000",
  valeurResiduelle: "0.000",
  coefficient: "1",
  dureeAnnees: 4,
} as const;

describe("amortissement linéaire", () => {
  it("répartit la base sur la durée, au prorata du mois d'entrée", () => {
    const plan = computeAmortissement({
      ...base,
      method: "lineaire",
      miseEnService: "2026-01-01",
    });
    expect(plan.lignes).toHaveLength(4);
    expect(plan.lignes[0]?.dotation).toBe("3000.000");
    expect(plan.totals.dotations).toBe("12000.000");
    expect(plan.totals.vnc_finale).toBe("0.000");
  });

  it("prorata temporis : mise en service en octobre", () => {
    const plan = computeAmortissement({
      ...base,
      method: "lineaire",
      miseEnService: "2026-10-01",
    });
    expect(plan.lignes[0]?.months).toBe(3);
    expect(plan.lignes[0]?.dotation).toBe("750.000");
    expect(plan.totals.dotations).toBe("12000.000");
  });

  it("respecte la valeur résiduelle", () => {
    const plan = computeAmortissement({
      ...base,
      valeurResiduelle: "2000.000",
      method: "lineaire",
      miseEnService: "2026-01-01",
    });
    expect(plan.totals.dotations).toBe("10000.000");
    expect(plan.totals.vnc_finale).toBe("2000.000");
  });
});

describe("amortissement dégressif", () => {
  it("bascule en linéaire quand celui-ci devient plus favorable et solde la base", () => {
    const plan = computeAmortissement({
      ...base,
      method: "degressif",
      coefficient: "1.5",
      miseEnService: "2026-01-01",
    });
    expect(plan.lignes[0]?.dotation).toBe("4500.000");
    expect(plan.totals.dotations).toBe("12000.000");
    expect(plan.totals.vnc_finale).toBe("0.000");
  });
});

describe("dépréciation et cession", () => {
  it("constate une perte de valeur", () => {
    const dep = computeDepreciation({
      currency: "TND",
      decimals: 3,
      at: "2026-12-31",
      vnc: "9000.000",
      valeurRecouvrable: "7500.000",
      cumulAvant: "0.000",
    });
    expect(dep.mouvement).toBe("1500.000");
    expect(dep.cumul_apres).toBe("1500.000");
  });

  it("plafonne la reprise au cumul déjà constaté", () => {
    const dep = computeDepreciation({
      currency: "TND",
      decimals: 3,
      at: "2027-12-31",
      vnc: "7000.000",
      valeurRecouvrable: "9000.000",
      cumulAvant: "1500.000",
    });
    expect(dep.mouvement).toBe("-1500.000");
    expect(dep.cumul_apres).toBe("0.000");
  });

  it("calcule le résultat de cession", () => {
    const cession = computeCession({
      currency: "TND",
      decimals: 3,
      at: "2028-06-30",
      prix: "4000.000",
      vnc: "3000.000",
    });
    expect(cession.resultat).toBe("1000.000");
  });
});

describe("vncNette", () => {
  it("retranche le cumul de dépréciation et ne descend pas sous zéro", () => {
    expect(vncNette({ decimals: 3, vncAmortie: "1000.000", cumulDepreciation: "250.000" })).toBe(
      "750.000",
    );
    expect(vncNette({ decimals: 3, vncAmortie: "100.000", cumulDepreciation: "250.000" })).toBe(
      "0.000",
    );
  });
});
