// @vitest-environment jsdom
/**
 * Le fuseau du cabinet, dans ses réglages (revue de #129) : on le tape, la
 * liste propose ; deux boutons de 48 px ; l'expert seul le change.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ fuseau: vi.fn(), definir: vi.fn(), acces: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  Link: () => null,
}));
vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (k: string, v?: Record<string, unknown>) => (v ? `${k} ${JSON.stringify(v)}` : k),
    locale: "fr",
  }),
}));
vi.mock("@/components/malica/cabinet-context", () => ({
  useCabinet: () => ({ org: { id: "cabinet", jurisdiction: "pack", currency: "devise" } }),
  useMalicaPanel: vi.fn(),
}));
vi.mock("@/components/malica/panneau-malica", () => ({
  panneauOuvertParDefaut: () => false,
  definirPanneauParDefaut: vi.fn(),
}));
vi.mock("@/components/malica/integrations-panel", () => ({ IntegrationsEtApi: () => null }));
vi.mock("@/verticals/malica-office/composition", () => ({
  office: () => ({
    parametrage: {
      reglagesCabinet: async () => ({
        seuilConfianceLot: 0.9,
        seuilConfianceRevue: 0.7,
        doubleValidationAuDela: null,
        propositionsProactives: true,
        capaciteDossiers: 8,
        ton: "sobre",
        seuilCertitudeConseil: 0.8,
        regle: true,
      }),
      plan: async () => [],
      fuseauDuCabinet: api.fuseau,
      definirFuseauDuCabinet: api.definir,
    },
    acces: { monAcces: api.acces },
    referential: { activePack: async () => ({ version: "test" }) },
    collab: { members: async () => [], invitations: async () => [] },
  }),
}));

import { Route } from "@/routes/_authenticated/cabinet.reglages";

const DEFAUT = { fuseau: "Zone/Defaut", defaut: "Zone/Defaut", regle: false, aujourdhui: null };

function monter() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const Component = Route.options.component!;
  render(
    <QueryClientProvider client={client}>
      <Component />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  api.fuseau.mockResolvedValue(DEFAUT);
  api.definir.mockResolvedValue({ ...DEFAUT, fuseau: "Africa/Dakar", regle: true });
});
afterEach(cleanup);

describe("le fuseau du cabinet, dans ses réglages", () => {
  it("l'expert le tape dans une liste qui propose, et l'enregistre", async () => {
    api.acces.mockResolvedValue({ role: "expert", plateforme: false });
    monter();
    const champ = (await screen.findByRole("combobox", {
      name: "cab.settings.fuseau.titre",
    })) as HTMLInputElement;
    expect(champ.className).toContain("min-h-[48px]");
    // Une liste qui propose (quatre cents fuseaux ne se déroulent pas).
    const liste = document.getElementById(champ.getAttribute("list")!);
    expect(liste?.querySelectorAll("option").length).toBeGreaterThan(100);
    const retablir = screen.getByRole("button", { name: "cab.settings.fuseau.retablir" });
    const enregistrer = retablir.parentElement!.querySelector("button")!;
    expect(enregistrer.className).toContain("min-h-[48px]");
    expect(retablir.className).toContain("min-h-[48px]");
    fireEvent.change(champ, { target: { value: "Africa/Dakar" } });
    fireEvent.click(enregistrer);
    await waitFor(() => expect(api.definir).toHaveBeenCalledWith("cabinet", "Africa/Dakar"));
  });

  it("les autres rôles le lisent, sans le changer", async () => {
    api.acces.mockResolvedValue({ role: "collaborateur", plateforme: false });
    monter();
    expect(
      await screen.findByText('cab.settings.fuseau.defaut {"fuseau":"Zone/Defaut"}'),
    ).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "cab.settings.fuseau.titre" })).toBeNull();
    expect(screen.queryByRole("button", { name: "cab.settings.fuseau.retablir" })).toBeNull();
  });
});
