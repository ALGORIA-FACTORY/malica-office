// @vitest-environment jsdom
/**
 * « Ce que le lecteur a lu » : le cabinet voit l'observation du lecteur
 * prouvé — son issue en tête, les champs par rang, l'avertissement sous le
 * champ qu'il concerne — et rien n'apparaît pour une pièce qu'il n'a pas lue.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LectureObservee } from "@malica/socle/ports/repositories";

const api = vi.hoisted(() => ({ lire: vi.fn() }));
vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (cle: string, vars?: Record<string, unknown>) =>
      vars ? `${cle}(${Object.values(vars).join(",")})` : cle,
    locale: "ar",
  }),
}));
vi.mock("@/verticals/malica-office/composition", () => ({
  office: () => ({ capture: { lectureObservee: api.lire } }),
}));

import { CeQueLeLecteurALu } from "../ce-que-le-lecteur-a-lu";

const LECTURE: LectureObservee = {
  lectureId: "l1",
  issue: "signalee",
  grille: { code: "facture", libelle: "Facture" },
  le: "2026-11-01T10:00:00.000Z",
  champs: [
    {
      code: "matricule_fiscal_emetteur",
      libelle: "Matricule fiscal de l'émetteur",
      role: { code: "fournisseur", libelle: "المزوّد" },
      expert: { code: "identifiant", libelle: "معرّف" },
      statut: "prouve",
      valeur: "1876543W/A/M/000",
      rang: null,
      instance: null,
      citations: [{ page: 1, ordinal: 12 }],
      avertissement: { code: "lettre_de_controle_discordante", libelle: "حرف المراقبة لا يطابق" },
    },
    {
      code: "total_ht",
      libelle: "Total hors taxe",
      role: null,
      expert: { code: "montant", libelle: "مبلغ" },
      statut: "signale",
      valeur: null,
      rang: null,
      instance: null,
      citations: [],
      avertissement: null,
    },
    {
      code: "quantite",
      libelle: "Quantité",
      role: null,
      expert: null,
      statut: "deduit",
      valeur: "3",
      rang: 1,
      instance: null,
      citations: [],
      avertissement: null,
    },
  ],
};

const vue = () => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <CeQueLeLecteurALu pieceId="p1" />
  </QueryClientProvider>
);

describe("ce que le lecteur a lu", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.lire.mockResolvedValue(LECTURE);
  });
  afterEach(cleanup);

  it("se lit dans la langue de l'écran, repliée, avec l'issue visible", async () => {
    const { container } = render(vue());
    const titre = await screen.findByRole("button", { name: /cab\.lecteur\.titre/ });
    expect(api.lire).toHaveBeenCalledWith("p1", "ar");
    expect(titre.getAttribute("aria-expanded")).toBe("false");
    expect(
      screen.getByText(/cab\.lecteur\.issue\.signalee · cab\.lecteur\.champs\(3\)/),
    ).toBeTruthy();
    expect(container.querySelector("table")).toBeNull();
  });

  it("ouverte : la mention d'observation, l'issue, les champs par rang, l'avertissement sous son champ", async () => {
    render(vue());
    fireEvent.click(await screen.findByRole("button", { name: /cab\.lecteur\.titre/ }));
    expect(screen.getByText("cab.lecteur.observation")).toBeTruthy();
    const lignes = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    // Le champ, puis SON avertissement, puis les suivants dans l'ordre rendu par l'API.
    expect(lignes.map((l) => l.textContent)).toEqual([
      expect.stringContaining("Matricule fiscal de l'émetteur"),
      expect.stringContaining("حرف المراقبة لا يطابق"),
      expect.stringContaining("Total hors taxe"),
      expect.stringContaining("cab.lecteur.ligne(1)"),
    ]);
    expect(lignes[0]!.textContent).toContain("المزوّد");
    expect(lignes[0]!.textContent).toContain("cab.lecteur.statut.prouve");
    expect(lignes[2]!.textContent).toContain("cab.lecteur.nonCitee");
    // La couleur suit le statut, et seulement lui.
    const tons = lignes
      .filter((l) => !l.classList.contains("cab-lecteur-avertissement"))
      .map((l) => l.querySelector("[data-tone]")?.getAttribute("data-tone"));
    expect(tons).toEqual(["ok", "warn", "info"]);
  });

  it("rien pour une pièce que le lecteur n'a pas lue", async () => {
    api.lire.mockResolvedValue(null);
    const { container } = render(vue());
    await vi.waitFor(() => expect(api.lire).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(container.textContent).toBe("");
  });
});
