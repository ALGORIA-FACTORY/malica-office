// @vitest-environment jsdom
/**
 * Réglages comptabilité (R10 ; décisions du CEO du 31 octobre 2026) : une
 * ligne par sujet, la valeur et d'où elle vient, la puce « à confirmer » tant
 * que le défaut n'est pas arrêté, ce que le Socle n'applique pas encore, le ⓘ
 * avec l'INCERTAIN en rouge — et l'arrêt pour le cabinet ou pour un dossier.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ReglagesComptables as Reglages } from "@malica/socle/ports/repositories";

const api = vi.hoisted(() => ({ lire: vi.fn(), arreter: vi.fn(), clients: vi.fn() }));
vi.mock("@/i18n", () => ({
  useI18n: () => ({ t: (cle: string) => cle, locale: "fr", dir: "ltr" }),
}));
vi.mock("@/verticals/malica-office/composition", () => ({
  office: () => ({
    parametrage: { reglagesComptables: api.lire, arreterReglagesComptables: api.arreter },
    supervision: { listClients: api.clients },
  }),
}));

import { ReglagesComptables } from "../reglages-comptables";

const sujet = (code: string, reglages: Reglages["sujets"][number]["reglages"]) => ({
  code,
  titre: `Sujet ${code}`,
  texte: `Texte ${code}`,
  pratique: `Pratique ${code}`,
  risque: `Risque ${code}`,
  incertain: `Incertain ${code}`,
  sources: [
    {
      titre: "Source d'essai",
      url: "https://essai.local/s",
      dateeDu: null,
      consulteeLe: "2026-10-31",
    },
  ],
  reglages,
  droits: [],
  bareme: [],
  categories: [],
});

const REGLAGES: Reglages = {
  sujets: [
    sujet("immobilisation", [
      {
        code: "immobilisation.seuil",
        libelle: "Seuil d'essai",
        nature: "nombre",
        valeur: "200",
        origine: "pack",
        decideLe: null,
        reference: "Référence d'essai",
        appliquee: true,
        options: null,
      },
      {
        code: "immobilisation.traitement",
        libelle: "Traitement d'essai",
        nature: "option",
        valeur: "actif_amorti",
        origine: "pack",
        decideLe: null,
        reference: null,
        appliquee: true,
        options: [
          { code: "actif_amorti", label: "À l'actif" },
          { code: "charge", label: "En charge" },
        ],
      },
    ]),
    sujet("prorata", [
      {
        code: "prorata.methode",
        libelle: "Méthode d'essai",
        nature: "option",
        valeur: "affectation_puis_prorata",
        origine: "cabinet",
        decideLe: "2026-10-31T10:00:00.000Z",
        reference: null,
        appliquee: false,
        options: [
          { code: "affectation_puis_prorata", label: "Affectation" },
          { code: "prorata_global", label: "Global" },
        ],
      },
    ]),
  ],
};

const vue = () => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ReglagesComptables cabinetId="c1" packId="p1" jour="2026-10-31" />
  </QueryClientProvider>
);

const ligneDu = async (titre: string) =>
  (await screen.findByText(titre)).closest("li") as HTMLElement;

describe("réglages comptabilité", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.lire.mockResolvedValue(REGLAGES);
    api.arreter.mockResolvedValue({ decisions: 2 });
    api.clients.mockResolvedValue([{ tenantId: "d1", name: "Dossier d'essai" }]);
  });
  afterEach(cleanup);

  it("lit les réglages du cabinet au jour dit, et dit d'où vient chaque valeur", async () => {
    render(vue());
    const immo = await ligneDu("Sujet immobilisation");
    expect(api.lire).toHaveBeenCalledWith("c1", "p1", "2026-10-31", "fr");
    expect(within(immo).getAllByText("tva.affectation.origine.pack")).toHaveLength(2);
    expect(
      within(await ligneDu("Sujet prorata")).getByText("tva.affectation.origine.cabinet"),
    ).toBeTruthy();
  });

  it("un défaut non arrêté porte la puce « à confirmer » ; un réglage arrêté ne la porte plus", async () => {
    render(vue());
    expect(
      within(await ligneDu("Sujet immobilisation")).getByText("reglages.compta.aConfirmer"),
    ).toBeTruthy();
    expect(
      within(await ligneDu("Sujet prorata")).queryByText("reglages.compta.aConfirmer"),
    ).toBeNull();
  });

  it("ce que le Socle n'applique pas encore se dit sur sa ligne, jamais en silence", async () => {
    render(vue());
    expect(
      within(await ligneDu("Sujet prorata")).getByText("reglages.compta.nonApplique"),
    ).toBeTruthy();
    expect(
      within(await ligneDu("Sujet immobilisation")).queryByText("reglages.compta.nonApplique"),
    ).toBeNull();
  });

  it("le ⓘ porte le texte, la pratique, le risque, l'INCERTAIN en rouge et les sources", async () => {
    render(vue());
    const immo = await ligneDu("Sujet immobilisation");
    fireEvent.click(within(immo).getByRole("button", { name: /common\.aide/ }));
    const feuille = await screen.findByRole("dialog");
    expect(within(feuille).getByText("Texte immobilisation")).toBeTruthy();
    expect(within(feuille).getByText("Pratique immobilisation")).toBeTruthy();
    expect(within(feuille).getByText("Risque immobilisation")).toBeTruthy();
    expect(within(feuille).getByText("Incertain immobilisation").className).toContain(
      "text-signal-stop",
    );
    expect(within(feuille).getByText(/Référence d'essai/)).toBeTruthy();
    expect(within(feuille).getByRole("link").getAttribute("href")).toBe("https://essai.local/s");
  });

  it("sans dossier choisi : un seul geste, pour tout le cabinet ; confirmer sans changer est une décision", async () => {
    render(vue());
    const immo = await ligneDu("Sujet immobilisation");
    expect(
      within(immo).queryByRole("button", { name: "tva.affectation.pourLeDossier" }),
    ).toBeNull();
    const bouton = within(immo).getByRole("button", { name: "tva.affectation.pourLeCabinet" });
    expect(bouton.className).toContain("min-h-[48px]");
    fireEvent.click(bouton);
    await within(immo).findByText("reglages.compta.arrete");
    expect(api.arreter).toHaveBeenCalledWith({
      cabinetId: "c1",
      portee: "cabinet",
      porteeId: "c1",
      packId: "p1",
      depuis: "2026-10-31",
      valeurs: [
        { code: "immobilisation.seuil", valeur: "200" },
        { code: "immobilisation.traitement", valeur: "actif_amorti" },
      ],
    });
  });

  it("un dossier choisi : ses valeurs, et l'arrêt pour ce dossier d'abord", async () => {
    render(vue());
    const portee = await screen.findByRole("combobox", { name: "reglages.compta.portee" });
    await screen.findByRole("option", { name: "Dossier d'essai" });
    fireEvent.change(portee, { target: { value: "d1" } });
    await waitFor(() => expect(api.lire).toHaveBeenCalledWith("d1", "p1", "2026-10-31", "fr"));
    const immo = await ligneDu("Sujet immobilisation");
    fireEvent.change(within(immo).getByRole("combobox", { name: /^Traitement d'essai/ }), {
      target: { value: "charge" },
    });
    fireEvent.change(within(immo).getByRole("textbox", { name: /^Seuil d'essai/ }), {
      target: { value: "500" },
    });
    const [principal, secondaire] = within(immo).getAllByRole("button", {
      name: /tva\.affectation\.pour/,
    });
    expect(principal!.textContent).toBe("tva.affectation.pourLeDossier");
    expect(secondaire!.textContent).toBe("tva.affectation.pourLeCabinet");
    fireEvent.click(principal!);
    await waitFor(() =>
      expect(api.arreter).toHaveBeenCalledWith(
        expect.objectContaining({
          portee: "dossier",
          porteeId: "d1",
          valeurs: [
            { code: "immobilisation.seuil", valeur: "500" },
            { code: "immobilisation.traitement", valeur: "charge" },
          ],
        }),
      ),
    );
  });

  it("une lecture refusée se dit ; elle ne laisse pas un écran muet", async () => {
    api.lire.mockRejectedValue(new Error("refus.reglage_comptable.droits"));
    render(vue());
    expect(await screen.findByRole("alert")).toBeTruthy();
  });
});
