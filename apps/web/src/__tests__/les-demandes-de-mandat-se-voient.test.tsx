// @vitest-environment jsdom
/**
 * Les demandes de mandat se voient chez la comptabilité (recette du 13
 * novembre 2026, A2) : une société qui invite sa comptabilité laisse une
 * invitation, pas un engagement — la carte « Demandes de mandat » la montre
 * dans les Clients et au tableau de bord, avec Accepter / Refuser. Accepter
 * active le mandat AVEC la comptabilité ouverte ; seul l'expert accepte.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const monde = vi.hoisted(() => ({
  role: "expert",
  invitations: [] as unknown[],
}));
const appels = vi.hoisted(() => ({
  accepter: vi.fn(async (..._a: unknown[]) => ({})),
  repondre: vi.fn(async (..._a: unknown[]) => ({})),
}));

vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (cle: string, v?: Record<string, unknown>) => (v ? `${cle} ${JSON.stringify(v)}` : cle),
    locale: "fr",
  }),
}));
vi.mock("@/verticals/malica-office/composition", () => ({
  office: () => ({
    collab: {
      invitationsPourMoi: async () => monde.invitations,
      repondreAInvitation: appels.repondre,
    },
    identity: { accepterInvitationDeLaSociete: appels.accepter },
    acces: { monAcces: async () => ({ role: monde.role, droits: [] }) },
  }),
}));

import { DemandesDeMandat } from "@/components/malica/DemandesDeMandat";

const demande = {
  id: "inv-1",
  cabinetTenantId: "pme-1",
  cabinet: "SARL Atelier",
  role: "expert",
  kind: "pme",
  expiresAt: "2026-12-12T00:00:00Z",
};
const rendre = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <DemandesDeMandat cabinetId="cab-1" />
    </QueryClientProvider>,
  );

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  monde.role = "expert";
  monde.invitations = [];
});

describe("la carte « Demandes de mandat »", () => {
  it("ne dit rien quand aucune société n'a invité cette comptabilité", async () => {
    monde.invitations = [{ ...demande, kind: "cabinet", role: "dirigeant" }];
    const { container } = rendre();
    await new Promise((r) => setTimeout(r, 30));
    expect(container.textContent).toBe("");
  });

  it("montre la demande, et Accepter active le mandat avec la comptabilité ouverte", async () => {
    monde.invitations = [demande];
    rendre();
    expect(await screen.findByText("cab.demandes.titre")).toBeTruthy();
    expect(screen.getByText(/invitation\.comptabilite/)).toBeTruthy();
    const accepter = await screen.findByText("cab.demandes.accepter");
    await waitFor(() => expect((accepter as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(accepter);
    await waitFor(() =>
      expect(appels.accepter).toHaveBeenCalledWith({
        jeton: null,
        invitationId: "inv-1",
        cabinetTenantId: "cab-1",
      }),
    );
  });

  it("Refuser expire l'invitation sans rien accepter", async () => {
    monde.invitations = [demande];
    rendre();
    fireEvent.click(await screen.findByText("cab.demandes.refuser"));
    await waitFor(() => expect(appels.repondre).toHaveBeenCalledWith("inv-1", false));
    expect(appels.accepter).not.toHaveBeenCalled();
  });

  it("un collaborateur lit pourquoi il ne peut pas accepter", async () => {
    monde.role = "collaborateur";
    monde.invitations = [demande];
    rendre();
    expect(await screen.findByText("cab.demandes.reserve")).toBeTruthy();
    expect((screen.getByText("cab.demandes.accepter") as HTMLButtonElement).disabled).toBe(true);
  });
});
