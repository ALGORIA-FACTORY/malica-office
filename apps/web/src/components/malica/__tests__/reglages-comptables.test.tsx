// @vitest-environment jsdom
/**
 * Réglages comptabilité (R10 ; décisions du CEO du 31 octobre 2026) : une
 * ligne par sujet, la valeur et d'où elle vient, la puce « à confirmer » tant
 * que le défaut n'est pas arrêté, ce que le Socle n'applique pas encore — sur
 * la ligne et sur l'option —, le ⓘ avec l'INCERTAIN en rouge, une date d'effet
 * au début de l'exercice, et un geste qui n'arrête que ce qui a changé.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ReglagesComptables as Reglages } from "@malica/socle/ports/repositories";

const api = vi.hoisted(() => ({ lire: vi.fn(), arreter: vi.fn(), clients: vi.fn() }));
vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (cle: string, v?: Record<string, string>) => (v?.["date"] ? `${cle} ${v["date"]}` : cle),
    locale: "fr",
    dir: "ltr",
  }),
}));
vi.mock("@/lib/lisible", () => ({ dateEnChiffres: (iso: string) => iso }));
vi.mock("@/verticals/malica-office/composition", () => ({
  office: () => ({
    parametrage: { reglagesComptables: api.lire, arreterReglagesComptables: api.arreter },
    supervision: { listClients: api.clients },
  }),
}));

import { ReglagesComptables } from "../reglages-comptables";

type Reglage = Reglages["sujets"][number]["reglages"][number];

const sujet = (code: string, reglages: Reglage[]) => ({
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

const seuil = (r: Partial<Reglage> = {}): Reglage => ({
  code: "immobilisation.seuil",
  libelle: "Seuil d'essai",
  nature: "nombre",
  valeur: "200",
  origine: "pack",
  decideLe: null,
  valeurDuCabinet: "200",
  origineDuCabinet: "pack",
  reference: "Référence d'essai",
  appliquee: true,
  options: null,
  ...r,
});
const traitement = (r: Partial<Reglage> = {}): Reglage => ({
  code: "immobilisation.traitement",
  libelle: "Traitement d'essai",
  nature: "option",
  valeur: "actif_amorti",
  origine: "pack",
  decideLe: null,
  valeurDuCabinet: "actif_amorti",
  origineDuCabinet: "pack",
  reference: null,
  appliquee: false,
  options: [
    { code: "actif_amorti", label: "À l'actif", appliquee: false },
    { code: "charge", label: "En charge", appliquee: true },
  ],
  ...r,
});
const prorata: Reglage = {
  code: "prorata.methode",
  libelle: "Méthode d'essai",
  nature: "option",
  valeur: "affectation_puis_prorata",
  origine: "cabinet",
  decideLe: "2026-10-31T10:00:00.000Z",
  valeurDuCabinet: "affectation_puis_prorata",
  origineDuCabinet: "cabinet",
  reference: null,
  appliquee: false,
  options: [
    { code: "affectation_puis_prorata", label: "Affectation", appliquee: false },
    { code: "prorata_global", label: "Global", appliquee: false },
  ],
};

const DU_CABINET: Reglages = {
  debutExercice: "2026-01-01",
  sujets: [sujet("immobilisation", [seuil(), traitement()]), sujet("prorata", [prorata])],
};
/** Vu du dossier : il a SON seuil (500) ; le cabinet est resté au défaut du pack. */
const DU_DOSSIER: Reglages = {
  debutExercice: "2026-04-01",
  sujets: [
    sujet("immobilisation", [
      seuil({ valeur: "500", origine: "dossier", decideLe: "2026-10-30T10:00:00.000Z" }),
      traitement(),
    ]),
    sujet("prorata", [prorata]),
  ],
};

const vue = () => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ReglagesComptables cabinetId="c1" packId="p1" jour="2026-10-31" />
  </QueryClientProvider>
);

const ligneDu = async (titre: string) =>
  (await screen.findByText(titre)).closest("li") as HTMLElement;
const auDossier = async () => {
  const portee = await screen.findByRole("combobox", { name: "reglages.compta.portee" });
  await screen.findByRole("option", { name: "Dossier d'essai" });
  fireEvent.change(portee, { target: { value: "d1" } });
  await waitFor(() => expect(api.lire).toHaveBeenCalledWith("c1", "d1", "p1", "2026-10-31", "fr"));
  await screen.findByDisplayValue("500");
};

describe("réglages comptabilité", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.lire.mockImplementation((_c: string, dossier: string | null) =>
      Promise.resolve(dossier ? DU_DOSSIER : DU_CABINET),
    );
    api.arreter.mockResolvedValue({ decisions: 1 });
    api.clients.mockResolvedValue([{ tenantId: "d1", name: "Dossier d'essai" }]);
  });
  afterEach(cleanup);

  it("lit les réglages du cabinet au jour dit, et dit d'où vient chaque valeur", async () => {
    render(vue());
    const immo = await ligneDu("Sujet immobilisation");
    expect(api.lire).toHaveBeenCalledWith("c1", null, "p1", "2026-10-31", "fr");
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

  it("ce que le Socle n'applique pas se dit sur la ligne ET sur l'option, avant de choisir", async () => {
    render(vue());
    const immo = await ligneDu("Sujet immobilisation");
    expect(within(immo).getByText("reglages.compta.nonApplique")).toBeTruthy();
    expect(
      within(immo).getByRole("option", {
        name: "À l'actif — reglages.compta.option.nonAppliquee",
      }),
    ).toBeTruthy();
    expect(within(immo).getByRole("option", { name: "En charge" })).toBeTruthy();
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

  it("la date d'effet : le début de l'exercice par défaut, dite, et modifiable", async () => {
    render(vue());
    const date = (await screen.findByLabelText("reglages.compta.depuis.champ")) as HTMLInputElement;
    expect(date.value).toBe("2026-01-01");
    expect(screen.getByText("reglages.compta.depuis 2026-01-01")).toBeTruthy();
    fireEvent.change(date, { target: { value: "2026-03-01" } });
    const immo = await ligneDu("Sujet immobilisation");
    fireEvent.click(within(immo).getByRole("button", { name: "tva.affectation.pourLeCabinet" }));
    await waitFor(() =>
      expect(api.arreter).toHaveBeenCalledWith(expect.objectContaining({ depuis: "2026-03-01" })),
    );
  });

  it("vu du cabinet, sans rien changer : confirmer les seuls défauts du pack", async () => {
    render(vue());
    const immo = await ligneDu("Sujet immobilisation");
    const bouton = within(immo).getByRole("button", { name: "tva.affectation.pourLeCabinet" });
    expect(
      within(immo).queryByRole("button", { name: "tva.affectation.pourLeDossier" }),
    ).toBeNull();
    expect(bouton.className).toContain("min-h-[48px]");
    fireEvent.click(bouton);
    await within(immo).findByText("reglages.compta.arrete");
    expect(api.arreter).toHaveBeenCalledWith({
      cabinetId: "c1",
      portee: "cabinet",
      porteeId: "c1",
      packId: "p1",
      depuis: "2026-01-01",
      valeurs: [
        { code: "immobilisation.seuil", valeur: "200" },
        { code: "immobilisation.traitement", valeur: "actif_amorti" },
      ],
    });
    // Un réglage déjà arrêté par le cabinet, inchangé : rien à arrêter.
    const pro = await ligneDu("Sujet prorata");
    expect(
      (
        within(pro).getByRole("button", {
          name: "tva.affectation.pourLeCabinet",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("vu d'un dossier : seul ce qui a changé s'arrête, pour le dossier", async () => {
    render(vue());
    await auDossier();
    const immo = await ligneDu("Sujet immobilisation");
    const dossier = within(immo).getByRole("button", { name: "tva.affectation.pourLeDossier" });
    // Rien changé : rien à épingler sur le dossier.
    expect((dossier as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(immo).getByRole("combobox", { name: /^Traitement d'essai/ }), {
      target: { value: "charge" },
    });
    fireEvent.click(dossier);
    await waitFor(() =>
      expect(api.arreter).toHaveBeenCalledWith({
        cabinetId: "c1",
        portee: "dossier",
        porteeId: "d1",
        packId: "p1",
        depuis: "2026-04-01",
        valeurs: [{ code: "immobilisation.traitement", valeur: "charge" }],
      }),
    );
  });

  it("vu d'un dossier, pour tout le cabinet : le seuil du dossier ne se recopie pas", async () => {
    render(vue());
    await auDossier();
    const immo = await ligneDu("Sujet immobilisation");
    fireEvent.change(within(immo).getByRole("combobox", { name: /^Traitement d'essai/ }), {
      target: { value: "charge" },
    });
    fireEvent.click(within(immo).getByRole("button", { name: "tva.affectation.pourLeCabinet" }));
    await waitFor(() =>
      expect(api.arreter).toHaveBeenCalledWith(
        expect.objectContaining({
          portee: "cabinet",
          porteeId: "c1",
          valeurs: [{ code: "immobilisation.traitement", valeur: "charge" }],
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
