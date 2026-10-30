/**
 * La TVA des extraits du mois — le SEUL calcul que font le mois de la PME,
 * son accueil, la synthèse du cabinet et le PV de réunion.
 *
 * Revue de #140 : une facture à deux taux forcée sans codes rendait un extrait
 * invalide (`tax_code: null`, `label: ""`), et la TVA du mois l'écartait sans
 * un mot. Elle est désormais « refusée », avec ce qui manque.
 *
 * 3 novembre 2026 : la déclaration mensuelle sépare la TVA déductible sur
 * IMMOBILISATIONS de celle sur les autres biens et services. Chaque ligne
 * d'extrait porte sa nature ; le moteur range chaque seau sur la ligne du
 * référentiel, et une ligne sans nature attribuée se range par défaut, comptée.
 */
import { describe, expect, it } from "vitest";

import { tvaDesExtraits } from "../engines/tva/des-extraits.ts";
import type { DeclarationTva } from "../ports/repositories.ts";

const extrait = (lignes: unknown[], sens = "facture_achat") => ({
  contract: "extract.v1",
  issuer: "FOURNISSEUR D'ESSAI",
  document_date: "2026-10-30",
  currency: "TND",
  document_kind: sens,
  lines: lignes,
  totals: { base_ht: "1000.000", vat: "130.000", ttc: "1130.000" },
});

const ligne = (
  code: string | null,
  ht: string,
  tva: string,
  nature?: { nature: string; nature_attribuee?: boolean },
) => ({
  label: code ?? "",
  tax_code: code,
  base_ht: ht,
  vat_amount: tva,
  ttc: (Number(ht) + Number(tva)).toFixed(3),
  ...nature,
});

const taux = [
  { code: "TVA07", rate: "0.070" },
  { code: "TVA19", rate: "0.190" },
].map((t) => ({
  ...t,
  label: t.code,
  validFrom: "2020-01-01",
  validTo: null,
  jurisdiction: "TN",
}));

/** Un référentiel d'essai : ses codes et ses libellés ne sont écrits nulle part ailleurs. */
const declaration: DeclarationTva = {
  natureParDefaut: "AUTRE",
  lignes: [
    {
      code: "L_COL",
      label: "Collectée",
      sens: "collectee",
      nature: null,
      ordinal: 1,
      incertain: false,
    },
    {
      code: "L_IMMO",
      label: "Sur immo",
      sens: "deductible",
      nature: "IMMO",
      ordinal: 2,
      incertain: true,
    },
    {
      code: "L_AUTRE",
      label: "Sur le reste",
      sens: "deductible",
      nature: "AUTRE",
      ordinal: 3,
      incertain: true,
    },
  ],
};
const IMMO = { nature: "IMMO", nature_attribuee: true };
const AUTRE = { nature: "AUTRE", nature_attribuee: true };

const calcul = (rows: Array<{ pieceId: string; extract: unknown }>) =>
  tvaDesExtraits({
    period: "2026-10",
    currency: { code: "TND", decimals: 3 },
    taux,
    declaration,
    rows,
  });

const ligneDe = (r: ReturnType<typeof calcul>, code: string) =>
  r.declaration.find((l) => l.code === code);

describe("la TVA des extraits du mois", () => {
  it("un extrait invalide est refusé, nommé, jamais écarté en silence", () => {
    const r = calcul([{ pieceId: "p1", extract: extrait([ligne(null, "1000.000", "130.000")]) }]);
    expect(r.totals.deductible).toBe("0.000");
    expect(r.refused).toHaveLength(1);
    expect(r.refused[0]!.item_id).toBe("p1");
    expect(r.refused[0]!.reason).toMatch(/^EXTRAIT_ILLISIBLE:.*lines\.0\.tax_code/);
  });

  it("deux taux, deux lignes codées : comptés, et rien de refusé", () => {
    const r = calcul([
      {
        pieceId: "p2",
        extract: extrait([
          ligne("TVA07", "500.000", "35.000"),
          ligne("TVA19", "500.000", "95.000"),
        ]),
      },
      {
        pieceId: "p3",
        extract: extrait([ligne("TVA19", "1.000", "0.190")], "facture_vente"),
      },
    ]);
    expect(r.refused).toEqual([]);
    expect(r.totals.deductible).toBe("130.000");
    expect(r.totals.collectee).toBe("0.190");
  });

  it("un extrait invalide parmi d'autres : les autres comptent, lui est refusé", () => {
    const r = calcul([
      { pieceId: "p4", extract: extrait([ligne("TVA19", "1000.000", "190.000")]) },
      { pieceId: "p5", extract: { contract: "extract.v1" } },
    ]);
    expect(r.totals.deductible).toBe("190.000");
    expect(r.refused.map((x) => x.item_id)).toEqual(["p5"]);
  });
});

describe("la déclaration sépare la TVA des immobilisations", () => {
  it("une immobilisation se range sur sa ligne, le reste sur la sienne", () => {
    const r = calcul([
      { pieceId: "a", extract: extrait([ligne("TVA19", "1000.000", "190.000", IMMO)]) },
      { pieceId: "b", extract: extrait([ligne("TVA19", "200.000", "38.000", AUTRE)]) },
    ]);
    expect(ligneDe(r, "L_IMMO")).toMatchObject({ base: "1000.000", vat: "190.000" });
    expect(ligneDe(r, "L_AUTRE")).toMatchObject({ base: "200.000", vat: "38.000" });
    expect(r.par_defaut).toEqual([]);
    // Un seau par taux ET par nature : le détail par taux ne fond plus les deux.
    expect(r.deductible.map((s) => [s.tax_code, s.nature, s.vat])).toEqual([
      ["TVA19", "IMMO", "190.000"],
      ["TVA19", "AUTRE", "38.000"],
    ]);
  });

  it("une facture mêlée, déjà partagée en deux lignes de nature, se déclare en deux", () => {
    const r = calcul([
      {
        pieceId: "m",
        extract: extrait([
          ligne("TVA19", "1000.000", "190.000", IMMO),
          ligne("TVA19", "200.000", "38.000", AUTRE),
        ]),
      },
    ]);
    expect(ligneDe(r, "L_IMMO")?.vat).toBe("190.000");
    expect(ligneDe(r, "L_AUTRE")?.vat).toBe("38.000");
    expect(r.totals.deductible).toBe("228.000");
  });

  it("une nature non attribuée se range par défaut, et se compte", () => {
    const r = calcul([
      {
        pieceId: "n",
        extract: extrait([
          ligne("TVA19", "1200.000", "228.000", { nature: "AUTRE", nature_attribuee: false }),
        ]),
      },
    ]);
    expect(ligneDe(r, "L_AUTRE")?.vat).toBe("228.000");
    expect(r.par_defaut).toEqual([
      { reason: "NATURE_NON_ATTRIBUEE", item_id: "n", tax_code: "TVA19" },
    ]);
  });

  it("un extrait conservé SANS nature compte toujours, sur la ligne par défaut, sans alerte", () => {
    const r = calcul([{ pieceId: "v", extract: extrait([ligne("TVA19", "1000.000", "190.000")]) }]);
    expect(r.totals.deductible).toBe("190.000");
    expect(ligneDe(r, "L_AUTRE")?.vat).toBe("190.000");
    expect(ligneDe(r, "L_IMMO")?.vat).toBe("0.000");
    expect(r.par_defaut).toEqual([]);
    expect(r.refused).toEqual([]);
  });

  it("une nature sans ligne au référentiel : rangée par défaut, comptée, jamais perdue", () => {
    const r = calcul([
      {
        pieceId: "x",
        extract: extrait([ligne("TVA19", "100.000", "19.000", { nature: "INCONNUE" })]),
      },
    ]);
    expect(r.totals.deductible).toBe("19.000");
    expect(ligneDe(r, "L_AUTRE")?.vat).toBe("19.000");
    expect(r.par_defaut).toEqual([
      { reason: "NATURE_SANS_LIGNE:INCONNUE", item_id: "x", tax_code: "TVA19" },
    ]);
  });

  it("une vente va sur la ligne collectée, quelle que soit sa nature", () => {
    const r = calcul([
      {
        pieceId: "s",
        extract: extrait([ligne("TVA19", "100.000", "19.000", AUTRE)], "facture_vente"),
      },
    ]);
    expect(ligneDe(r, "L_COL")?.vat).toBe("19.000");
  });

  it("la somme des lignes de chaque sens est le total du sens", () => {
    const r = calcul([
      { pieceId: "a", extract: extrait([ligne("TVA19", "1000.000", "190.000", IMMO)]) },
      { pieceId: "b", extract: extrait([ligne("TVA07", "100.000", "7.000")]) },
      { pieceId: "c", extract: extrait([ligne("TVA19", "10.000", "1.900")], "facture_vente") },
    ]);
    const somme = (sens: string) =>
      r.declaration
        .filter((l) => l.sens === sens)
        .reduce((s, l) => s + Math.round(Number(l.vat) * 1000), 0);
    expect(somme("deductible")).toBe(Math.round(Number(r.totals.deductible) * 1000));
    expect(somme("collectee")).toBe(Math.round(Number(r.totals.collectee) * 1000));
    // Les lignes viennent dans l'ordre du référentiel, toutes, même à zéro.
    expect(r.declaration.map((l) => l.code)).toEqual(["L_COL", "L_IMMO", "L_AUTRE"]);
  });
});
