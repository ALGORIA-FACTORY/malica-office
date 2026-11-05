import { describe, expect, it } from "vitest";

import type { Ecriture } from "@malica/socle/ports/repositories";

import {
  aValiderDUnGeste,
  compteDeCharge,
  ecritureEnMasse,
  estChargeOuProduit,
  lotDe,
  parPiece,
} from "../propositions";

function ecriture(id: string, lignes: Array<[string, string, string, string]>): Ecriture {
  return {
    id,
    pieceId: `p-${id}`,
    journal: "ACH",
    dateEcriture: "2026-09-30",
    devise: "TND",
    libelle: `Écriture ${id}`,
    status: "booked",
    vivante: true,
    packVersionId: "pack",
    bookedAt: null,
    lines: lignes.map(([accountCode, libelle, debit, credit], ordinal) => ({
      ordinal,
      accountCode,
      libelle,
      debit,
      credit,
      taxCode: null,
    })),
  };
}

describe("lotDe", () => {
  it("classe selon les seuils du cabinet, et met à part ce qui n'est pas mesuré", () => {
    expect(lotDe(0.95, 0.9, 0.7)).toBe("haut");
    expect(lotDe(0.9, 0.9, 0.7)).toBe("haut");
    expect(lotDe(0.8, 0.9, 0.7)).toBe("moyen");
    expect(lotDe(0.69, 0.9, 0.7)).toBe("bas");
    expect(lotDe(null, 0.9, 0.7)).toBe("sans");
  });

  it("suit des seuils différents sans rien supposer", () => {
    expect(lotDe(0.8, 0.75, 0.5)).toBe("haut");
    expect(lotDe(0.55, 0.75, 0.5)).toBe("moyen");
  });

  /**
   * ============================================ LE DÉFAUT QUE CECI VERROUILLE
   *
   * Une pièce lue par une recette porte `overall_confidence = 1` : le neutre
   * du minimum, passé explicitement parce qu'une recette ne produit AUCUN
   * score. Comparé à un seuil, ce neutre les franchit tous — la pièce
   * s'affichait « 100 % » et tombait dans les validables d'un geste.
   *
   * Le neutre est donc éprouvé ici tel qu'il arrive, `1`, et non une valeur
   * inventée pour la circonstance : c'est la valeur réelle du chemin.
   */
  it("une pièce lue par une recette n'entre dans aucun lot de confiance", () => {
    expect(lotDe(1, 0.9, 0.7, true)).toBe("recette");
    expect(lotDe(1, 0.9, 0.7, false)).toBe("haut");
    // Et le lot ne dépend pas du score : une recette n'en produit pas.
    expect(lotDe(0.1, 0.9, 0.7, true)).toBe("recette");
    expect(lotDe(null, 0.9, 0.7, true)).toBe("recette");
  });
});

describe("ecritureEnMasse", () => {
  it("agrège compte par compte, sans perdre un millime, dans l'ordre des comptes", () => {
    const masse = ecritureEnMasse([
      ecriture("a", [
        ["601", "Achats", "340.000", "0.000"],
        ["4366", "TVA déductible", "64.600", "0.000"],
        ["401", "Fournisseurs", "0.000", "404.600"],
      ]),
      ecriture("b", [
        ["601", "Achats", "860.000", "0.000"],
        ["4366", "TVA déductible", "163.400", "0.000"],
        ["401", "Fournisseurs", "0.000", "1023.400"],
      ]),
    ]);
    expect(masse.map((m) => m.compte)).toEqual(["401", "4366", "601"]);
    expect(masse.find((m) => m.compte === "601")).toEqual({
      compte: "601",
      libelle: "Achats",
      pieces: 2,
      debit: "1200.000",
      credit: "0.000",
    });
    expect(masse.find((m) => m.compte === "401")?.credit).toBe("1428.000");
  });

  it("rend une liste vide pour aucune écriture", () => {
    expect(ecritureEnMasse([])).toEqual([]);
  });
});

describe("compteDeCharge", () => {
  it("prend la classe 6, sinon le premier débit non nul", () => {
    const avec6 = ecriture("c", [
      ["401", "Fournisseurs", "0.000", "100.000"],
      ["6064", "Fournitures", "100.000", "0.000"],
    ]);
    expect(compteDeCharge(avec6)?.accountCode).toBe("6064");
    const sans6 = ecriture("d", [
      ["401", "Fournisseurs", "0.000", "100.000"],
      ["2183", "Matériel", "100.000", "0.000"],
    ]);
    expect(compteDeCharge(sans6)?.accountCode).toBe("2183");
    expect(compteDeCharge(ecriture("e", []))).toBeNull();
  });

  it("prend aussi la classe 7 : une vente se réimpute comme un achat (ANO-CAB-005)", () => {
    const vente = ecriture("v", [
      ["411", "Clients", "119.000", "0.000"],
      ["706", "Prestations", "0.000", "100.000"],
      ["4366", "TVA collectée", "0.000", "19.000"],
    ]);
    expect(compteDeCharge(vente)?.accountCode).toBe("706");
    expect(estChargeOuProduit("706")).toBe(true);
    expect(estChargeOuProduit("411")).toBe(false);
    expect(estChargeOuProduit("4366")).toBe(false);
  });
});

describe("un lot, pièce par pièce", () => {
  it("une pièce qui échoue n'arrête pas les suivantes ; le bilan dit combien et pourquoi", async () => {
    const vues: string[] = [];
    const bilan = await parPiece(
      ["a", "b", "c", "d"],
      (e) => (e as Error).message,
      async (p) => {
        vues.push(p);
        if (p === "b" || p === "d") throw new Error(`refus ${p}`);
      },
    );
    expect(vues).toEqual(["a", "b", "c", "d"]);
    expect(bilan).toEqual({ passees: 2, echecs: 2, raison: "refus b" });
  });
});

describe("« Valider » d'un client", () => {
  const p = (pieceId: string, confiance: number | null) => ({ pieceId, confiance });
  const pieces = [
    p("sure", 0.95),
    p("moyenne", 0.8),
    p("basse", 0.2),
    p("sans", null),
    p("recette", 1),
  ];
  const parRecette = (id: string) => id === "recette";

  it("ne valide d'un geste que le lot au-dessus du seuil du cabinet", () => {
    expect(aValiderDUnGeste(pieces, [], 0.9, 0.7, parRecette).map((x) => x.pieceId)).toEqual([
      "sure",
    ]);
  });

  it("valide telle quelle la sélection que l'expert a faite", () => {
    const retenues = [pieces[2]!, pieces[3]!];
    expect(aValiderDUnGeste(pieces, retenues, 0.9, 0.7, parRecette)).toEqual(retenues);
  });

  it("ne valide rien tant que les seuils ne sont pas lus", () => {
    expect(aValiderDUnGeste(pieces, [], null, 0.7, parRecette)).toEqual([]);
  });
});
