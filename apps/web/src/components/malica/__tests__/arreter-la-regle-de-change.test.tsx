// @vitest-environment jsdom
/**
 * Arrêter la règle de change d'un dossier (R10 ; revue de #148) : la source,
 * le jour retenu, le recul et l'écart se choisissent comme les lignes de la
 * déclaration de TVA, par le même geste, et chaque valeur dit d'où elle vient.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RegleDeChangeDuDossier } from "@malica/socle/ports/repositories";

const api = vi.hoisted(() => ({ lire: vi.fn(), arreter: vi.fn() }));
vi.mock("@/i18n", () => ({ useI18n: () => ({ t: (cle: string) => cle, locale: "fr" }) }));
vi.mock("@/verticals/malica-office/composition", () => ({
  office: () => ({
    referential: { regleDeChange: api.lire },
    parametrage: { arreterRegleDeChange: api.arreter },
  }),
}));

import { ArreterLaRegleDeChange } from "../arreter-la-regle-de-change";

const REGLE: RegleDeChangeDuDossier = {
  valeurs: [
    {
      code: "change.date_retenue",
      valeur: "date_facture",
      origine: "pack",
      decideLe: null,
      options: [
        { code: "date_facture", label: "Date de la facture" },
        { code: "date_reception", label: "Date de réception" },
      ],
    },
    {
      code: "change.ecart",
      valeur: "base_la_plus_grande",
      origine: "pack",
      decideLe: null,
      options: [{ code: "base_la_plus_grande", label: "Sur la plus grande base" }],
    },
    { code: "change.recul_jours", valeur: "5", origine: "cabinet", decideLe: null, options: null },
    {
      code: "change.source",
      valeur: "SRC",
      origine: "dossier",
      decideLe: null,
      options: [{ code: "SRC", label: "Source d'essai" }],
    },
  ],
};

const vue = () => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ArreterLaRegleDeChange cabinetId="c1" dossierId="d1" packId="p1" periode="2026-10" />
  </QueryClientProvider>
);

describe("arrêter la règle de change", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.lire.mockResolvedValue(REGLE);
    api.arreter.mockResolvedValue({ decisions: 4 });
  });
  afterEach(cleanup);

  it("lit la règle résolue du dossier au premier jour du mois, et dit d'où vient chaque valeur", async () => {
    render(vue());
    expect(await screen.findByText("change.regle.titre")).toBeTruthy();
    expect(api.lire).toHaveBeenCalledWith("p1", "d1", "2026-10-01", "fr");
    expect(screen.getAllByText("tva.affectation.origine.pack")).toHaveLength(2);
    expect(screen.getByText("tva.affectation.origine.cabinet")).toBeTruthy();
    expect(screen.getByText("tva.affectation.origine.dossier")).toBeTruthy();
  });

  it("une date retenue choisie, un recul saisi : arrêtés pour ce dossier, à partir du mois", async () => {
    render(vue());
    fireEvent.change(
      await screen.findByRole("combobox", { name: /^change\.regle\.date_retenue/ }),
      {
        target: { value: "date_reception" },
      },
    );
    fireEvent.change(screen.getByRole("textbox", { name: /^change\.regle\.recul_jours/ }), {
      target: { value: "3" },
    });
    fireEvent.click(screen.getByRole("button", { name: "tva.affectation.pourLeDossier" }));
    await screen.findByText("change.regle.arretee");
    await waitFor(() =>
      expect(api.arreter).toHaveBeenCalledWith({
        cabinetId: "c1",
        portee: "dossier",
        porteeId: "d1",
        packId: "p1",
        depuis: "2026-10-01",
        valeurs: [
          { code: "change.date_retenue", valeur: "date_reception" },
          { code: "change.ecart", valeur: "base_la_plus_grande" },
          { code: "change.recul_jours", valeur: "3" },
          { code: "change.source", valeur: "SRC" },
        ],
      }),
    );
  });

  it("pour tout le cabinet : la portée est le cabinet", async () => {
    render(vue());
    fireEvent.click(await screen.findByRole("button", { name: "tva.affectation.pourLeCabinet" }));
    await waitFor(() =>
      expect(api.arreter.mock.calls[0]![0]).toMatchObject({ portee: "cabinet", porteeId: "c1" }),
    );
  });
});
