import { describe, expect, it } from "vitest";

import { dansLaPeriode, dossierDeLaPiece, typePourLeDossier, type Dossier } from "../dossiers";

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

describe("la période d'une carte dit vrai", () => {
  const piece = (dateDocument: string | null, createdAt = "2026-10-20T10:00:00Z") => ({
    dateDocument,
    createdAt,
  });

  it("le mois en cours, par la date de la pièce", () => {
    expect(dansLaPeriode(piece("2026-10-03"), "mois", "2026-10")).toBe(true);
    expect(dansLaPeriode(piece("2026-06-02"), "mois", "2026-10")).toBe(false);
  });

  it("l'année, pour un PV ou une déclaration", () => {
    expect(dansLaPeriode(piece("2026-02-15"), "annee", "2026-10")).toBe(true);
    expect(dansLaPeriode(piece("2025-12-31"), "annee", "2026-10")).toBe(false);
  });

  it("sans date lue, la date de la photo", () => {
    expect(dansLaPeriode(piece(null), "mois", "2026-10")).toBe(true);
  });
});
