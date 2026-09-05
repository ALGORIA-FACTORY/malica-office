import { describe, expect, it } from "vitest";

import { composerLibelle } from "../../engines/libelle.ts";
import { factureAchatSimple, factureVenteSimple } from "../../__tests__/fixtures.ts";
import { faitsDuLibelle, referenceDuDocument } from "../libelle-de-piece.ts";

describe("la référence du document", () => {
  it("prend le numéro de facture quand il est là", () => {
    expect(referenceDuDocument({ invoice_no: "F-2026-042" })).toBe("F-2026-042");
  });

  it("suit l'ordre de préférence des clés", () => {
    expect(referenceDuDocument({ reference: "R-9", invoice_no: "F-1" })).toBe("F-1");
    expect(referenceDuDocument({ reference: "R-9", document_no: "D-2" })).toBe("D-2");
  });

  it("prend la première référence connue plutôt que rien", () => {
    // Une clé que nos lectures ne nomment pas encore vaut mieux qu'un libellé
    // sans référence : elle permet quand même de retrouver la pièce.
    expect(referenceDuDocument({ bon_de_commande: "BC-77" })).toBe("BC-77");
  });

  it("rend null quand il n'y a rien à rendre", () => {
    expect(referenceDuDocument({})).toBeNull();
    expect(referenceDuDocument(undefined)).toBeNull();
    expect(referenceDuDocument({ invoice_no: "   " })).toBeNull();
  });
});

describe("les faits d'une pièce lue", () => {
  it("compose un libellé qui identifie l'opération sans ouvrir la pièce", () => {
    expect(composerLibelle(faitsDuLibelle(factureAchatSimple()))).toBe(
      "Achat — Fournisseur SARL — Réf. F-2026-042 du 15/07/2026",
    );
  });

  it("nomme la nature du document, pas son code technique", () => {
    expect(faitsDuLibelle(factureVenteSimple()).nature).toBe("Vente");
  });

  it("laisse tomber la référence absente au lieu d'inventer", () => {
    const sans = faitsDuLibelle({ ...factureVenteSimple(), references: {} });
    expect(sans.reference).toBeNull();
    expect(composerLibelle(sans)).not.toContain("Réf.");
  });

  it("porte la date du DOCUMENT, jamais celle de la saisie", () => {
    const extract = factureAchatSimple();
    expect(faitsDuLibelle(extract).date).toBe(extract.document_date);
  });
});
