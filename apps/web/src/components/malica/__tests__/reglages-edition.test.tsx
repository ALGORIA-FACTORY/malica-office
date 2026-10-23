// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ lire: vi.fn(), ecrire: vi.fn(), preference: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  Link: () => null,
}));
vi.mock("@/i18n", () => ({ useI18n: () => ({ t: (k: string) => k, locale: "fr" }) }));
vi.mock("@/components/malica/cabinet-context", () => ({
  useCabinet: () => ({ org: { id: "cabinet", jurisdiction: "pack", currency: "devise" } }),
  useMalicaPanel: vi.fn(),
}));
vi.mock("@/components/malica/panneau-malica", () => ({
  panneauOuvertParDefaut: () => false,
  definirPanneauParDefaut: api.preference,
}));
vi.mock("@/components/malica/integrations-panel", () => ({ IntegrationsEtApi: () => null }));
vi.mock("@/verticals/malica-office/composition", () => ({
  office: () => ({
    parametrage: {
      reglagesCabinet: api.lire,
      definirReglagesCabinet: api.ecrire,
      plan: async () => [],
    },
    referential: { activePack: async () => ({ version: "test" }) },
    collab: { members: async () => [], invitations: async () => [] },
  }),
}));

import { Route } from "@/routes/_authenticated/cabinet.reglages";

const reglage = {
  seuilConfianceLot: 0.9,
  seuilConfianceRevue: 0.7,
  doubleValidationAuDela: null,
  propositionsProactives: true,
  capaciteDossiers: 8,
  ton: "sobre",
  seuilCertitudeConseil: 0.8,
  regle: true,
};
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
async function seuil() {
  return (await screen.findByRole("spinbutton", {
    name: "cab.settings.seuilLot",
  })) as HTMLInputElement;
}
beforeEach(() => {
  vi.resetAllMocks();
  api.lire.mockResolvedValue(reglage);
  api.ecrire.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("modifier volontairement les réglages", () => {
  it("consulte en lecture seule, puis annule sans persister les valeurs", async () => {
    monter();
    const input = await seuil();
    await waitFor(() => expect(input.value).toBe("90"));
    expect(input.matches(":disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "relation.modifier" }));
    fireEvent.change(input, { target: { value: "95" } });
    fireEvent.click(screen.getByRole("button", { name: "common.cancel" }));
    await waitFor(() => expect(input.value).toBe("90"));
    expect(input.matches(":disabled")).toBe(true);
    expect(api.ecrire).not.toHaveBeenCalled();
    expect(api.preference).not.toHaveBeenCalled();
  });
  it("ferme l'édition seulement après un succès et conserve la saisie sur échec", async () => {
    api.ecrire.mockRejectedValueOnce(new Error("connexion interrompue"));
    monter();
    const input = await seuil();
    await waitFor(() => expect(input.value).toBe("90"));
    fireEvent.click(screen.getByRole("button", { name: "relation.modifier" }));
    fireEvent.change(input, { target: { value: "95" } });
    fireEvent.click(screen.getByRole("button", { name: "cab.settings.enregistrer" }));
    await screen.findByRole("alert");
    expect(input.value).toBe("95");
    expect(input.matches(":disabled")).toBe(false);
    expect(api.preference).not.toHaveBeenCalled();
    api.lire.mockResolvedValue({ ...reglage, seuilConfianceLot: 0.95 });
    fireEvent.click(screen.getByRole("button", { name: "cab.settings.enregistrer" }));
    await waitFor(() => expect(input.matches(":disabled")).toBe(true));
    expect(input.value).toBe("95");
    expect(api.ecrire).toHaveBeenLastCalledWith(
      expect.objectContaining({ seuilConfianceLot: 0.95, seuilCertitudeConseil: 0.8 }),
    );
  });
  it("refuse une borne de revue au-dessus de la borne de lot", async () => {
    monter();
    await seuil();
    fireEvent.click(screen.getByRole("button", { name: "relation.modifier" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "cab.settings.seuilRevue" }), {
      target: { value: "99" },
    });
    expect(
      screen.getByRole("button", { name: "cab.settings.enregistrer" }).matches(":disabled"),
    ).toBe(true);
    expect(api.ecrire).not.toHaveBeenCalled();
  });
});
