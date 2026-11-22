// @vitest-environment jsdom
/**
 * Corriger le type d'une pièce, côté PME.
 *
 * Décision du dirigeant, 29 octobre 2026 : dans un dossier dont le cabinet
 * tient les livres, le sens d'une pièce (achat ou vente) se tranche au
 * cabinet. La feuille ne propose donc plus les dossiers dont le type porte une
 * écriture ; un dossier autonome, ou sans cabinet, les garde.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/i18n", () => ({ useI18n: () => ({ t: (cle: string) => cle, locale: "fr" }) }));
vi.mock("@/hooks/use-superposition", () => ({ usePiegeDeFocus: () => undefined }));
vi.mock("@/hooks/use-dossiers", () => ({
  useDossiers: () => ({
    dossiers: [
      { code: "achats", libelle: "Achats", teinte: "a", periode: "mois", typeParDefaut: "fa" },
      { code: "ventes", libelle: "Ventes", teinte: "v", periode: "mois", typeParDefaut: "fv" },
      { code: "tickets", libelle: "Tickets", teinte: "t", periode: "mois", typeParDefaut: "tk" },
      { code: "banque", libelle: "Banque", teinte: "b", periode: "mois", typeParDefaut: "rb" },
    ],
    // Les codes sont ceux du référentiel de l'essai : seul `porteEcriture` décide.
    types: [
      {
        code: "fa",
        libelle: "Facture reçue",
        dossier: "achats",
        dossierSiVente: null,
        porteEcriture: true,
      },
      {
        code: "fv",
        libelle: "Facture émise",
        dossier: "ventes",
        dossierSiVente: null,
        porteEcriture: true,
      },
      {
        code: "tk",
        libelle: "Ticket",
        dossier: "tickets",
        dossierSiVente: null,
        porteEcriture: false,
      },
      {
        code: "rb",
        libelle: "Relevé",
        dossier: "banque",
        dossierSiVente: null,
        porteEcriture: false,
      },
      // Les sous-types des deux portes (planche 3) : leurs codes sont ceux du référentiel.
      {
        code: "facture_achat",
        libelle: "Facture d'achat",
        dossier: "achats",
        dossierSiVente: null,
        porteEcriture: true,
      },
      {
        code: "facture_vente",
        libelle: "Facture de vente",
        dossier: "ventes",
        dossierSiVente: null,
        porteEcriture: true,
      },
      {
        code: "avoir",
        libelle: "Avoir",
        dossier: "achats",
        dossierSiVente: "ventes",
        porteEcriture: false,
      },
    ],
  }),
}));

import { QuestionDuType } from "../question-du-type";

const proposes = () => screen.getAllByRole("button").map((b) => b.textContent ?? "");

describe("corriger le type d'une pièce", () => {
  afterEach(cleanup);

  it("le cabinet tient les livres : ni achat ni vente ne se choisit à la PME", () => {
    render(
      <QuestionDuType
        documents={["Ticket"]}
        actuel={{ typeDeDocument: "tk", kind: null }}
        sensAuCabinet
        mode="correction"
        onRepondre={vi.fn()}
        onAnnuler={vi.fn()}
      />,
    );
    const tuiles = proposes();
    expect(tuiles.some((x) => x.includes("Achats"))).toBe(false);
    expect(tuiles.some((x) => x.includes("Ventes"))).toBe(false);
    expect(tuiles.some((x) => x.includes("Banque"))).toBe(true);
  });

  it("le dossier où la pièce est déjà reste proposé : le choisir ne change rien", () => {
    render(
      <QuestionDuType
        documents={["Facture"]}
        actuel={{ typeDeDocument: "fa", kind: null }}
        sensAuCabinet
        mode="correction"
        onRepondre={vi.fn()}
        onAnnuler={vi.fn()}
      />,
    );
    const tuiles = proposes();
    expect(tuiles.some((x) => x.includes("Achats"))).toBe(true);
    expect(tuiles.some((x) => x.includes("Ventes"))).toBe(false);
  });

  it("un dossier autonome, ou sans cabinet, garde tous ses dossiers", () => {
    render(
      <QuestionDuType
        documents={["Ticket"]}
        actuel={{ typeDeDocument: "tk", kind: null }}
        mode="correction"
        onRepondre={vi.fn()}
        onAnnuler={vi.fn()}
      />,
    );
    const tuiles = proposes();
    expect(tuiles.some((x) => x.includes("Achats"))).toBe(true);
    expect(tuiles.some((x) => x.includes("Ventes"))).toBe(true);
  });

  /*
   * Le dirigeant, 21 novembre 2026 : « je n'ai pas pu cliquer Ventes en haut, et lorsque je
   * clique Avoir en bas le bouton en haut revient à l'achat ».
   */
  it("la porte touchée s'encadre aussitôt", () => {
    render(
      <QuestionDuType
        documents={["Avoir"]}
        actuel={{ typeDeDocument: "avoir", kind: null }}
        mode="correction"
        onRepondre={vi.fn()}
        onAnnuler={vi.fn()}
      />,
    );
    const ventes = screen.getByRole("button", { name: /Ventes/ });
    expect(ventes.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(ventes);
    expect(ventes.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /Achats/ }).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("Ventes → Avoir dit un avoir SUR VENTE ; Achats → Avoir, sur achat", () => {
    const onRepondre = vi.fn();
    render(
      <QuestionDuType
        documents={["Avoir"]}
        actuel={{ typeDeDocument: "avoir", kind: null }}
        mode="correction"
        onRepondre={onRepondre}
        onAnnuler={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Ventes/ }));
    fireEvent.click(screen.getByRole("button", { name: "Avoir" }));
    expect(onRepondre).toHaveBeenLastCalledWith("avoir", "facture_vente");
    fireEvent.click(screen.getByRole("button", { name: /Achats/ }));
    fireEvent.click(screen.getByRole("button", { name: "Avoir" }));
    expect(onRepondre).toHaveBeenLastCalledWith("avoir", "facture_achat");
  });

  it("le cabinet tient les livres : la PME propose le côté d'un avoir, pas une facture", () => {
    render(
      <QuestionDuType
        documents={["Avoir"]}
        actuel={{ typeDeDocument: "avoir", kind: null }}
        sensAuCabinet
        mode="correction"
        onRepondre={vi.fn()}
        onAnnuler={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Ventes/ }));
    expect(screen.queryByRole("button", { name: "Avoir" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Facture de vente" })).toBeNull();
  });
});
