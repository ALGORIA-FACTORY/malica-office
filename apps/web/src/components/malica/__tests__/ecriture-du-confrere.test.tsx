// @vitest-environment jsdom
/**
 * Chez la nouvelle comptabilité (7.3) : l'écriture de la précédente se lit
 * « Inscrite par … · lecture seule », son seul geste est la contre-passation ;
 * et le modèle de lettre au confrère se lit, se copie, et ne s'envoie pas.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Ecriture, LettreAuConfrere } from "@malica/socle/ports/repositories";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (cle: string, valeurs?: Record<string, string>) =>
      valeurs ? `${cle} ${Object.values(valeurs).join(" | ")}` : cle,
    locale: "fr",
    dir: "ltr",
  }),
}));

const contrePasser = vi.fn(async (_id: string) => "rev");
let lettre: LettreAuConfrere | null = null;
vi.mock("@/verticals/malica-office/composition", () => ({
  office: () => ({
    office: { contrePasserLEcritureDuConfrere: (id: string) => contrePasser(id) },
    identity: { lettreAuConfrere: async () => lettre },
  }),
}));

import { EcritureDuConfrere } from "../ecriture-du-confrere";
import { LettreAuConfrere as Lettre } from "../lettre-au-confrere";

const ecriture: Ecriture = {
  id: "e1",
  pieceId: "p1",
  journal: "ACH",
  dateEcriture: "2026-10-02",
  devise: "TND",
  libelle: "Facture essai",
  status: "booked",
  vivante: true,
  packVersionId: "pack",
  bookedAt: null,
  inscritePar: "Compta Ancienne",
  lines: [
    {
      ordinal: 1,
      accountCode: "601",
      libelle: "Achat",
      debit: "100.000",
      credit: "0",
      taxCode: null,
    },
  ],
};

const avec = (n: ReactNode) =>
  render(<QueryClientProvider client={new QueryClient()}>{n}</QueryClientProvider>);

afterEach(cleanup);

describe("l'écriture de la comptabilité précédente", () => {
  it("se lit « inscrite par », et n'offre que « Contre-passer à la date du jour »", async () => {
    avec(<EcritureDuConfrere ecriture={ecriture} pieceId="p1" inscritePar="Compta Ancienne" />);
    expect(screen.getByRole("heading").textContent).toBe("cab.confrere.inscrite Compta Ancienne");
    const boutons = screen.getAllByRole("button");
    expect(boutons.map((b) => b.textContent)).toEqual(["cab.confrere.contrePasser"]);
    expect(screen.queryByText(/modifier|retourner/i)).toBeNull();
    fireEvent.click(boutons[0]!);
    await waitFor(() => expect(contrePasser).toHaveBeenCalledWith("e1"));
  });
});

describe("le modèle de lettre au confrère", () => {
  it("ne paraît pas sans comptabilité précédente", async () => {
    lettre = null;
    const { container } = avec(<Lettre cabinetId="c" clientTenantId="p" />);
    await new Promise((r) => setTimeout(r, 0));
    expect(container.textContent).toBe("");
  });

  it("se lit rempli, se copie, et n'a aucun bouton d'envoi", async () => {
    lettre = {
      confrere: "Compta Ancienne",
      comptabilite: "Compta Nouvelle",
      client: "Société Essai",
      matricule: "1234567A/A/M/000",
      depuis: "2026-11-12",
    };
    const ecrire = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText: ecrire } });
    avec(<Lettre cabinetId="c" clientTenantId="p" />);
    const modele = await screen.findByText(/^cab\.confrere\.lettre\.modele/);
    expect(modele.textContent).toContain("Compta Ancienne");
    expect(modele.textContent).toContain("1234567A/A/M/000");
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "cab.confrere.lettre.copier",
    ]);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(ecrire).toHaveBeenCalledWith(modele.textContent));
    expect(await screen.findByText("cab.confrere.lettre.copie")).toBeTruthy();
  });
});
