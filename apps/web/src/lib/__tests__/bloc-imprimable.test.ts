import { describe, expect, it } from "vitest";

import type { BlocDeReponse } from "@malica/socle/ports/assistant";

import { blocImprimable } from "../bloc-imprimable";

const tete = { titre: "T", periode: "Novembre 2026", perimetre: "SOTUMAG", source: "Source" };

describe("un bloc, mis à plat pour l'impression", () => {
  it("le chiffre clé : son détail en lignes, la réponse en total", () => {
    const b: BlocDeReponse = {
      ...tete,
      type: "reponse_cle",
      cle: { libelle: "Crédit de TVA", valeur: "342,000", unite: "TND", ton: "positif" },
      details: [{ libelle: "TVA collectée", valeur: "0,000", unite: "TND", ton: "neutre" }],
    };
    expect(blocImprimable(b)).toEqual({
      titre: "T",
      sousTitre: "Novembre 2026 · SOTUMAG",
      pied: "Source",
      entete: [],
      lignes: [["TVA collectée", "0,000 TND"]],
      totaux: [["Crédit de TVA", "342,000 TND"]],
      numerique: [false, true],
    });
  });

  it("le tableau : ses colonnes, ses lignes dans l'ordre du serveur, son total", () => {
    const b: BlocDeReponse = {
      ...tete,
      periode: null,
      type: "tableau",
      colonnes: [
        { id: "f", libelle: "Fournisseur", numerique: false },
        { id: "m", libelle: "Montant", numerique: true },
      ],
      lignes: [
        { f: "A", m: "1,000" },
        { f: "B", m: "2,000" },
      ],
      total: { f: "Total", m: "3,000" },
    };
    expect(blocImprimable(b)).toMatchObject({
      sousTitre: "SOTUMAG",
      entete: ["Fournisseur", "Montant"],
      lignes: [
        ["A", "1,000"],
        ["B", "2,000"],
      ],
      totaux: [["Total", "3,000"]],
      numerique: [false, true],
    });
  });

  it("le graphique : une ligne par période, un tiret pour une période sans valeur", () => {
    const b: BlocDeReponse = {
      ...tete,
      type: "graphique",
      forme: "barres",
      unite: "TND",
      series: [
        {
          nom: "Ventes",
          ton: "positif",
          points: [
            { etiquette: "oct. 26", valeur: "9,000", part: 1 },
            { etiquette: "nov. 26", valeur: null, part: 0 },
          ],
        },
      ],
    };
    expect(blocImprimable(b)).toMatchObject({
      entete: ["", "Ventes (TND)"],
      lignes: [
        ["oct. 26", "9,000"],
        ["nov. 26", "—"],
      ],
      totaux: [],
      numerique: [false, true],
    });
  });

  it("la cascade : ses étapes en lignes, la dernière en total", () => {
    const b: BlocDeReponse = {
      ...tete,
      type: "cascade",
      unite: "TND",
      etapes: [
        { libelle: "Produits", valeur: "10,000", ton: "neutre", debut: 0, fin: 1 },
        { libelle: "Charges", valeur: "4,000", ton: "negatif", debut: 0.6, fin: 1 },
        { libelle: "Résultat", valeur: "6,000", ton: "positif", debut: 0, fin: 0.6 },
      ],
    };
    expect(blocImprimable(b)).toMatchObject({
      lignes: [
        ["Produits", "10,000 TND"],
        ["Charges", "4,000 TND"],
      ],
      totaux: [["Résultat", "6,000 TND"]],
    });
  });

  it("la carte : une ligne par société, un tiret pour un mois sans valeur, le total en dernière colonne", () => {
    const b: BlocDeReponse = {
      ...tete,
      type: "carte",
      unite: "TND",
      colonnes: ["oct. 26", "nov. 26"],
      lignes: [
        {
          libelle: "SOTUMAG",
          cellules: [
            { valeur: "9,000", part: 1 },
            { valeur: null, part: 0 },
          ],
          total: "9,000",
        },
      ],
    };
    expect(blocImprimable(b)).toMatchObject({
      entete: ["", "oct. 26", "nov. 26", "Σ (TND)"],
      lignes: [["SOTUMAG", "9,000", "—", "9,000"]],
      numerique: [false, true, true, true],
    });
  });
});
