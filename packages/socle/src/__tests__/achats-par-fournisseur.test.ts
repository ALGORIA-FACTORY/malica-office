import { describe, expect, it } from "vitest";

import {
  achatsParFournisseur,
  type PieceLuePourLesAchats,
} from "../engines/achats/par-fournisseur.ts";

const achat = (emetteur: string | null, total: string | null, devise: string | null = "TND") =>
  ({ emetteur, kind: "facture_achat", total, devise }) satisfies PieceLuePourLesAchats;

describe("les achats par fournisseur", () => {
  it("somme exactement, classe du plus gros au plus petit, et rend le total", () => {
    const r = achatsParFournisseur(
      [
        achat("Sismara Plasturgie SA", "7872.677"),
        achat("Electro Import", "4999.000"),
        achat("Sismara Plasturgie SA", "0.100"),
        achat("Sismara Plasturgie SA", "0.200"),
      ],
      "TND",
      3,
    );
    expect(r.lignes).toEqual([
      { fournisseur: "Sismara Plasturgie SA", total: "7872.977", pieces: 3 },
      { fournisseur: "Electro Import", total: "4999.000", pieces: 1 },
    ]);
    expect(r.total).toBe("12871.977");
    expect(r.pieces).toBe(4);
  });

  it("la casse, les accents et la ponctuation ne séparent pas un fournisseur ; une forme juridique, si", () => {
    const r = achatsParFournisseur(
      [
        achat("KORDANE DIGITAL", "100.000"),
        achat("Kordane Digital", "50.000"),
        achat("Kordane-Digital", "25.000"),
        achat("Kordane Digital SUARL", "10.000"),
        achat("Société Générale", "1.000"),
        achat("SOCIETE GENERALE", "1.000"),
      ],
      "TND",
      3,
    );
    expect(r.lignes.map((l) => [l.fournisseur, l.total, l.pieces])).toEqual([
      // L'écriture affichée : la plus fréquente, la première à égalité.
      ["KORDANE DIGITAL", "175.000", 3],
      ["Kordane Digital SUARL", "10.000", 1],
      ["Société Générale", "2.000", 2],
    ]);
  });

  it("ne compte que les achats : une vente n'entre nulle part", () => {
    const r = achatsParFournisseur(
      [
        achat("A", "10.000"),
        { emetteur: "Nous", kind: "facture_vente", total: "999.000", devise: "TND" },
      ],
      "TND",
      3,
    );
    expect(r.total).toBe("10.000");
    expect(r.ecartees).toEqual({ sansTotal: 0, autreDevise: 0, sansEmetteur: 0 });
  });

  it("dit ce qu'il écarte, au lieu de le taire : sans total, autre devise, sans émetteur", () => {
    const r = achatsParFournisseur(
      [
        achat("A", "10.000"),
        achat("B", null),
        achat("C", "illisible"),
        achat("D", "20.00", "EUR"),
        achat(null, "5.000"),
        achat("  ", "5.000"),
        // Sans devise relevée, la pièce est tenue pour celle du dossier.
        achat("E", "1.000", null),
      ],
      "TND",
      3,
    );
    expect(r.ecartees).toEqual({ sansTotal: 2, autreDevise: 1, sansEmetteur: 2 });
    expect(r.total).toBe("11.000");
    expect(r.pieces).toBe(2);
  });

  it("suit les décimales de la devise, et rend un classement vide sans achat", () => {
    expect(
      achatsParFournisseur([achat("A", "1500", "XOF"), achat("A", "250", "XOF")], "XOF", 0),
    ).toMatchObject({
      total: "1750",
      lignes: [{ fournisseur: "A", total: "1750", pieces: 2 }],
    });
    expect(achatsParFournisseur([], "TND", 3)).toMatchObject({
      total: "0.000",
      lignes: [],
      pieces: 0,
    });
  });

  it("à total égal, classe par nom", () => {
    const r = achatsParFournisseur([achat("Zed", "5.000"), achat("Alpha", "5.000")], "TND", 3);
    expect(r.lignes.map((l) => l.fournisseur)).toEqual(["Alpha", "Zed"]);
  });
});
