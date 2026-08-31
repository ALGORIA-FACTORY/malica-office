import { describe, expect, it } from "vitest";

import { composerLibelle, critiquerLibelle, nomDeLaNature } from "../engines/libelle";

describe("composer un libellé d'écriture", () => {
  it("porte les quatre faits, dans l'ordre où on les cherche", () => {
    expect(
      composerLibelle({
        nature: "Achat de marchandises",
        contrepartie: "VERRES DE TUNISIE",
        reference: "2026-114",
        date: "2026-08-31",
      }),
    ).toBe("Achat de marchandises — VERRES DE TUNISIE — Réf. 2026-114 du 31/08/2026");
  });

  it("omet ce qui manque plutôt que de l'inventer", () => {
    expect(composerLibelle({ nature: "Achat", contrepartie: "VERRES DE TUNISIE" })).toBe(
      "Achat — VERRES DE TUNISIE",
    );
    expect(composerLibelle({ nature: "Vente", reference: "V-58" })).toBe("Vente — Réf. V-58");
    expect(composerLibelle({ nature: "Opération diverse" })).toBe("Opération diverse");
  });

  it("écrit la date en clair, pas en ISO", () => {
    // « 2026-08-31 » se lit mal dans une balance ; « 31/08/2026 » se lit.
    expect(composerLibelle({ nature: "Achat", date: "2026-08-31" })).toBe("Achat — du 31/08/2026");
  });

  it("laisse passer une date qu'il ne sait pas lire, au lieu de la déformer", () => {
    expect(composerLibelle({ nature: "Achat", date: "exercice 2026" })).toBe(
      "Achat — du exercice 2026",
    );
  });

  it("raccourcit la contrepartie, jamais la référence", () => {
    // La référence permet de retrouver la pièce : elle survit. Un nom
    // raccourci, lui, reste reconnaissable.
    const long = composerLibelle({
      nature: "Achat de marchandises et de fournitures consommables",
      contrepartie: "SOCIETE TUNISIENNE DE DISTRIBUTION DE MATERIEL OPTIQUE ET PARAMEDICAL",
      reference: "2026-114",
      date: "2026-08-31",
    });
    expect(long.length).toBeLessThanOrEqual(120);
    expect(long).toContain("Réf. 2026-114 du 31/08/2026");
    expect(long).toContain("…");
  });
});

describe("critiquer un libellé", () => {
  it("ne reproche rien à un libellé bien formé", () => {
    expect(
      critiquerLibelle("Achat de marchandises — VERRES DE TUNISIE — Réf. 2026-114 du 31/08/2026"),
    ).toEqual([]);
  });

  it("signale un mot seul, qui ne distingue rien", () => {
    for (const mot of ["Facture", "facture", "Achat", "OD", "Divers."]) {
      expect(critiquerLibelle(mot).length).toBeGreaterThan(0);
    }
  });

  it("signale un montant recopié dans le libellé", () => {
    // C'est la source d'incohérence la plus fréquente : le montant change à la
    // première correction, le libellé non.
    expect(critiquerLibelle("Achat fournisseur 1 429,000 TND")).toContain(
      "répète un montant que les lignes portent déjà",
    );
    expect(critiquerLibelle("Reglement de 250 DT au fournisseur")).toHaveLength(1);
  });

  it("signale une longueur qui se coupera en balance", () => {
    const remarques = critiquerLibelle("A".repeat(130));
    expect(remarques.some((r) => r.includes("120"))).toBe(true);
  });

  it("ne confond pas une référence numérique avec un montant", () => {
    expect(critiquerLibelle("Achat — VERRES DE TUNISIE — Réf. 2026-114 du 31/08/2026")).toEqual([]);
  });
});

describe("nommer la nature d'une opération", () => {
  it("traduit les natures connues", () => {
    expect(nomDeLaNature("facture_achat")).toBe("Achat");
    expect(nomDeLaNature("facture_vente")).toBe("Vente");
    expect(nomDeLaNature("avoir_vente")).toBe("Avoir client");
  });

  it("rend une nature inconnue lisible au lieu de la cacher", () => {
    expect(nomDeLaNature("note_de_debit")).toBe("note de debit");
  });

  it("retombe sur l'opération diverse quand rien n'est su", () => {
    expect(nomDeLaNature(null)).toBe("Opération diverse");
    expect(nomDeLaNature(undefined)).toBe("Opération diverse");
  });
});
