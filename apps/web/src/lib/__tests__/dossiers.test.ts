import { describe, expect, it } from "vitest";

import {
  dansLaPeriodeMontree,
  dossierDeLaPiece,
  periodeMontree,
  typePourLeDossier,
  type Dossier,
} from "../dossiers";

const types = [
  { code: "facture_achat", dossier: "achats", dossierSiVente: null },
  { code: "avoir", dossier: "achats", dossierSiVente: "ventes" },
  { code: "ticket_caisse", dossier: "tickets_recus", dossierSiVente: null },
  { code: "recu_de_paiement", dossier: "tickets_recus", dossierSiVente: null },
];
const tickets: Dossier = {
  code: "tickets_recus",
  libelle: "Tickets et reçus",
  teinte: "tickets",
  periode: "mois",
  typeParDefaut: "ticket_caisse",
};

describe("le dossier d'une pièce", () => {
  it("vient de son type", () => {
    expect(dossierDeLaPiece({ typeDeDocument: "recu_de_paiement", kind: null }, types)).toBe(
      "tickets_recus",
    );
  });

  it("un avoir suit le sens lu", () => {
    expect(dossierDeLaPiece({ typeDeDocument: "avoir", kind: "facture_achat" }, types)).toBe(
      "achats",
    );
    expect(dossierDeLaPiece({ typeDeDocument: "avoir", kind: "facture_vente" }, types)).toBe(
      "ventes",
    );
  });

  it("sans type, aucun dossier n'est deviné", () => {
    expect(dossierDeLaPiece({ typeDeDocument: null, kind: "facture_achat" }, types)).toBeNull();
  });
});

describe("le type qu'écrit le choix d'un dossier", () => {
  it("à la capture : le type par défaut du dossier", () => {
    expect(typePourLeDossier(tickets, null, types)).toBe("ticket_caisse");
  });

  it("en correction, le même dossier garde le type précis lu", () => {
    expect(
      typePourLeDossier(tickets, { typeDeDocument: "recu_de_paiement", kind: null }, types),
    ).toBe("recu_de_paiement");
  });

  it("en correction vers un autre dossier : son type par défaut", () => {
    expect(typePourLeDossier(tickets, { typeDeDocument: "facture_achat", kind: null }, types)).toBe(
      "ticket_caisse",
    );
  });
});

describe("un avoir garde son type entre achats et ventes", () => {
  const ventes: Dossier = { ...tickets, code: "ventes", typeParDefaut: "facture_vente" };
  it("le choix de Ventes ne le réécrit pas en facture de vente", () => {
    expect(
      typePourLeDossier(ventes, { typeDeDocument: "avoir", kind: "facture_achat" }, types),
    ).toBe("avoir");
  });
});

describe("la période d'une carte dit vrai", () => {
  const piece = (dateDocument: string | null, createdAt = "2026-10-20T10:00:00Z") => ({
    dateDocument,
    createdAt,
  });

  it("le mois en cours, par la date de la pièce", () => {
    expect(dansLaPeriodeMontree(piece("2026-10-03"), "2026-10")).toBe(true);
    expect(dansLaPeriodeMontree(piece("2026-06-02"), "2026-10")).toBe(false);
  });

  it("l'année, pour un PV ou une déclaration", () => {
    expect(dansLaPeriodeMontree(piece("2026-02-15"), "2026")).toBe(true);
    expect(dansLaPeriodeMontree(piece("2025-12-31"), "2026")).toBe(false);
  });

  it("une date illisible ne fait pas disparaître la pièce : la date de la photo", () => {
    expect(dansLaPeriodeMontree(piece("20/10/2026"), "2026-10")).toBe(true);
  });

  it("sans date lue, la date de la photo", () => {
    expect(dansLaPeriodeMontree(piece(null), "2026-10")).toBe(true);
  });

  // 1er novembre 2026 : Achats et Ventes « vides » le 1er du mois, sur un dossier plein.
  it("le 1er du mois, la carte montre le mois le plus récent qui a des pièces", () => {
    const octobre = [piece("2026-10-27"), piece("2026-09-25"), piece("2026-10-03")];
    expect(periodeMontree(octobre, "mois", "2026-11")).toBe("2026-10");
  });

  it("le mois en cours dès qu'il a une pièce ; jamais un mois à venir", () => {
    expect(periodeMontree([piece("2026-10-27"), piece("2026-11-01")], "mois", "2026-11")).toBe(
      "2026-11",
    );
    expect(periodeMontree([piece("2026-12-15"), piece("2026-10-02")], "mois", "2026-11")).toBe(
      "2026-10",
    );
  });

  it("un dossier vide montre la période en cours", () => {
    expect(periodeMontree([], "mois", "2026-11")).toBe("2026-11");
    expect(periodeMontree([], "annee", "2026-11")).toBe("2026");
  });

  it("l'année la plus récente pour un dossier annuel", () => {
    expect(periodeMontree([piece("2025-06-30")], "annee", "2026-11")).toBe("2025");
  });
});
