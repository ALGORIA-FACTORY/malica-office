// @vitest-environment jsdom
/** Le journal du jour : rangé par journal, l'origine dite, l'export numéroté. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JournalDuJour, JournalExporte } from "@malica/socle/ports/repositories";

const naviguer = vi.fn();
let recherche: { client?: string; jour?: string } = {};

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { component: ComponentType }) => ({
    options,
    useSearch: () => recherche,
    useNavigate: () => naviguer,
  }),
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));
vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (cle: string, v?: Record<string, unknown>) => (v ? `${cle} ${JSON.stringify(v)}` : cle),
    locale: "fr",
    dir: "ltr",
  }),
}));
vi.mock("@/components/malica/cabinet-context", () => ({
  useCabinet: () => ({ org: { id: "cabinet", name: "Cabinet" } }),
}));
vi.mock("@/components/malica/dossier-courant", () => ({
  useDossierCourant: () => null,
  ecrireDossierCourant: vi.fn(),
}));
const enregistrer = vi.fn(async () => ({ chemin: null }));
vi.mock("@/capabilities/enregistrer-un-fichier", () => ({
  enregistrerUnFichier: (...a: unknown[]) => enregistrer(...(a as [])),
}));

const solde = {
  devise: "XXX",
  debit: "9007199254740.993",
  credit: "9007199254740.993",
  equilibre: true,
};
const ligne = (compte: string, debit: string, credit: string, ordinal: number) => ({
  ordinal,
  compte,
  compteLibelle: `Compte ${compte}`,
  debit,
  credit,
});
const ecriture = (
  id: string,
  origine: "validee" | "forcee" | "contre_passation",
  par: string | null,
) => ({
  id,
  clientTenantId: "client",
  clientNom: "Client d'essai",
  pieceId: `piece-${id}`,
  libelle: `Facture ${id}`,
  devise: "XXX",
  origine,
  inscriteLe: "2026-10-28T09:15:00.000Z",
  heure: "09:15",
  par,
  contrePasse: null,
  contrePasseeLe: null,
  debit: "1.000",
  credit: "1.000",
  lignes: [ligne("A", "1.000", "0.000", 1), ligne("B", "0.000", "1.000", 2)],
});

const JOURNAL: JournalDuJour = {
  jour: "2026-10-28",
  journaux: [
    {
      code: "J1",
      libelle: "Journal un",
      ecritures: [
        ecriture("v1", "validee", "Expert d'essai"),
        ecriture("f1", "forcee", "Expert d'essai"),
      ],
      soldes: [solde],
    },
    {
      code: "J2",
      libelle: "Journal deux",
      ecritures: [ecriture("c1", "contre_passation", null)],
      soldes: [solde],
    },
  ],
  totaux: { ecritures: 3, validees: 1, forcees: 1, contrePassations: 1, soldes: [solde] },
  dernierExport: {
    numero: 2,
    format: "csv",
    createdAt: "2026-10-28T10:40:00.000Z",
    auteur: null,
    ecart: { ajoutees: 1, contrePassees: 1, retirees: 0 },
  },
};
const VIDE: JournalDuJour = {
  jour: "2026-10-28",
  journaux: [],
  totaux: { ecritures: 0, validees: 0, forcees: 0, contrePassations: 0, soldes: [] },
  dernierExport: null,
};
const EXPORTE: JournalExporte = {
  id: "x",
  numero: 3,
  nomDeFichier: "journal-essai-20261028-n3.xlsx",
  typeMime: "application/octet-stream",
  contenu: btoa("PK"),
  encodage: "base64",
  taille: 2,
  lignes: 6,
  empreinte: "0".repeat(64),
  precedent: 2,
  ecart: { ajoutees: 1, contrePassees: 1, retirees: 0 },
};

const lire = vi.fn(async () => JOURNAL);
const exporter = vi.fn(async () => EXPORTE);
vi.mock("@/verticals/malica-office/composition", () => ({
  office: () => ({
    supervision: {
      listClients: async () => [
        { tenantId: "client", name: "Client d'essai", engagementStatus: "actif" },
      ],
    },
    journalDuJour: { lire, exporter },
  }),
}));

import { Route } from "../routes/_authenticated/cabinet.journal";

const Ecran = (Route as unknown as { options: { component: ComponentType } }).options.component;
const monter = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Ecran />
    </QueryClientProvider>,
  );

beforeEach(() => {
  recherche = { client: "client", jour: "2026-10-28" };
  lire.mockResolvedValue(JOURNAL);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("le journal du jour", () => {
  it("range par journal, dit l'origine et qui a forcé, et tient débit = crédit", async () => {
    monter();
    const un = await screen.findByRole("region", { name: "Journal un" });
    expect(within(un).getByText("cab.jdj.origine.validee")).toBeTruthy();
    expect(within(un).getByText("cab.jdj.origine.forcee")).toBeTruthy();
    expect(within(un).getByText("Expert d'essai")).toBeTruthy();
    const deux = screen.getByRole("region", { name: "Journal deux" });
    expect(within(deux).getByText("cab.jdj.origine.contre_passation")).toBeTruthy();
    // Le montant passe tel quel : aucun flottant entre l'API et l'écran.
    expect(screen.getAllByText("9 007 199 254 740,993 XXX").length).toBeGreaterThan(0);
    expect(screen.getByText("1 · 1")).toBeTruthy();
    expect(lire).toHaveBeenCalledWith("cabinet", "client", "2026-10-28", expect.any(String), "fr");
  });

  it("dit le dernier export et ce qui a changé depuis", async () => {
    monter();
    expect(await screen.findByText(/^cab\.jdj\.changements .*"n":2/)).toBeTruthy();
    expect(screen.getByText(/^cab\.jdj\.export .*"numero":2/)).toBeTruthy();
  });

  it("exporte en Excel d'abord : deux boutons côte à côte, le fichier remis, le numéro dit", async () => {
    monter();
    await screen.findByRole("region", { name: "Journal un" });
    const excel = screen.getByRole("button", { name: "cab.jdj.exporter.xlsx" });
    const csv = screen.getByRole("button", { name: "cab.jdj.exporter.csv" });
    expect(excel.parentElement).toBe(csv.parentElement);
    expect(excel.compareDocumentPosition(csv) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(excel.className).toContain("min-h-[48px]");
    expect(csv.className).toContain("min-h-[48px]");
    fireEvent.click(excel);
    await waitFor(() => expect(enregistrer).toHaveBeenCalled());
    expect(exporter).toHaveBeenCalledWith(
      "cabinet",
      "client",
      "2026-10-28",
      expect.any(String),
      "fr",
      "xlsx",
    );
    expect(enregistrer.mock.calls[0]).toEqual([expect.any(Blob), EXPORTE.nomDeFichier]);
    expect(await screen.findByRole("status")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain('"numero":3');
  });

  it("n'exporte pas un jour vide, et le dit", async () => {
    lire.mockResolvedValue(VIDE);
    monter();
    expect(await screen.findByText("cab.jdj.vide")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "cab.jdj.exporter.xlsx" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("recule d'un jour, et lit tous les mandats sans dossier choisi", async () => {
    monter();
    await screen.findByRole("region", { name: "Journal un" });
    fireEvent.click(screen.getByRole("button", { name: "cab.jdj.precedent" }));
    expect(naviguer).toHaveBeenCalledWith({ search: { client: "client", jour: "2026-10-27" } });

    cleanup();
    recherche = { client: "tous", jour: "2026-10-28" };
    monter();
    await screen.findByRole("region", { name: "Journal un" });
    expect(lire).toHaveBeenLastCalledWith("cabinet", null, "2026-10-28", expect.any(String), "fr");
  });
});
