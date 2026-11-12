// @vitest-environment jsdom
/**
 * « Inviter ma comptabilité » (7.1, 7.2) : Externe et Interne dans le même
 * geste ; chaque choix n'est offert que s'il peut aboutir — pas d'externe
 * quand un mandat est actif, pas d'interne quand la place comprise est prise.
 * Externe passe par la porte de l'invitation de la comptabilité, Interne par
 * celle de la place « Comptable interne ».
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const etat = vi.hoisted(() => ({ engagees: 0 }));
const api = vi.hoisted(() => ({
  inviterMaComptabilite: vi.fn(),
  inviterComptableInterne: vi.fn(),
}));

vi.mock("@/i18n", () => ({ useI18n: () => ({ t: (cle: string) => cle, locale: "fr" }) }));
vi.mock("@/verticals/malica-office/composition", () => ({
  office: () => ({
    identity: {
      invitationDeMaComptabilite: async () => null,
      inviterMaComptabilite: api.inviterMaComptabilite,
    },
    facturation: {
      placeComptable: async () => ({
        incluses: 1,
        engagees: etat.engagees,
        comptables: [],
        invitations: [],
      }),
      inviterComptableInterne: api.inviterComptableInterne,
    },
  }),
}));

import { InviterMaComptabilite } from "@/components/malica/inviter-ma-comptabilite";

function afficher(aUnMandat: boolean) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    createElement(
      QueryClientProvider,
      { client: qc },
      createElement(InviterMaComptabilite, { tenantId: "societe", aUnMandat }),
    ),
  );
}

beforeEach(() => {
  etat.engagees = 0;
  api.inviterMaComptabilite.mockReset().mockResolvedValue({
    id: "i",
    email: "expert@essai.local",
    jeton: "a".repeat(64),
    expiresAt: "2026-12-12T00:00:00Z",
    relance: false,
    courriel: "non_configure",
    lien: null,
  });
  api.inviterComptableInterne.mockReset().mockResolvedValue({
    id: "j",
    email: "salarie@essai.local",
    role: "comptable",
    expiresAt: "2026-12-12T00:00:00Z",
    deja: false,
  });
});
afterEach(cleanup);

describe("inviter ma comptabilité", () => {
  it("offre Externe et Interne ; Externe invite l'expert par sa porte", async () => {
    afficher(false);
    await screen.findByText("pme.inviterCompta.interne");
    expect(screen.getByText("pme.inviterCompta.externe")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "expert@essai.local" } });
    fireEvent.click(screen.getByText("pme.inviterCompta.envoyer"));
    await waitFor(() =>
      expect(api.inviterMaComptabilite).toHaveBeenCalledWith("societe", "expert@essai.local"),
    );
    expect(api.inviterComptableInterne).not.toHaveBeenCalled();
  });

  it("un mandat actif : seul Interne reste, par la place comprise", async () => {
    afficher(true);
    await screen.findByText("pme.inviterCompta.interne");
    expect(screen.queryByText("pme.inviterCompta.externe")).toBeNull();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "salarie@essai.local" } });
    fireEvent.click(screen.getByText("pme.inviterCompta.envoyer"));
    await waitFor(() =>
      expect(api.inviterComptableInterne).toHaveBeenCalledWith("salarie@essai.local", "societe"),
    );
  });

  it("un mandat actif et la place prise : rien à inviter", async () => {
    etat.engagees = 1;
    const { container } = afficher(true);
    await waitFor(() => expect(container.querySelector("input")).toBeNull());
    expect(screen.queryByText("pme.inviterCompta.envoyer")).toBeNull();
  });
});
