// @vitest-environment jsdom
/**
 * La révocation du mandat en deux touches, pas trois (recette du 11 novembre
 * 2026, 3.2) : « Révoquer » ouvre ; le bouton qui nomme la comptabilité agit,
 * une fois le motif écrit.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { component: ComponentType }) => ({ options }),
  Link: () => null,
  useNavigate: () => vi.fn(),
}));
vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (cle: string, valeurs?: Record<string, string>) =>
      valeurs ? `${cle} ${Object.values(valeurs).join(" ")}` : cle,
    locale: "fr",
    dir: "ltr",
  }),
  LOCALES: ["fr"],
  LOCALE_NAMES: { fr: "Français" },
}));
const revoquer = vi.fn(async () => ({ id: "m", statut: "termine", le: "2026-11-12" }));
vi.mock("@/verticals/malica-office/composition", () => ({
  office: () => ({
    identity: {
      monMandat: async () => ({
        id: "m",
        comptabilite: "Compta Ancienne",
        statut: "actif",
        depuis: "2026-01-01",
        revocable: true,
      }),
      revoquerMandat: revoquer,
    },
  }),
}));

import { LeMandat } from "../routes/_authenticated/pme.reglages";

afterEach(cleanup);

describe("révoquer le mandat", () => {
  it("se fait en deux touches : ouvrir, puis confirmer en nommant la comptabilité", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <LeMandat tenantId="pme" onRevoque={() => undefined} />
      </QueryClientProvider>,
    );
    // Touche 1.
    fireEvent.click(await screen.findByRole("button", { name: "pme.reglages.org.revoquer" }));
    const confirmer = screen.getByRole("button", {
      name: "pme.reglages.org.mandat.confirmer Compta Ancienne",
    });
    expect((confirmer as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Je change" } });
    // Touche 2 : elle agit.
    fireEvent.click(confirmer);
    await waitFor(() => expect(revoquer).toHaveBeenCalledWith("pme", "Je change"));
  });
});
