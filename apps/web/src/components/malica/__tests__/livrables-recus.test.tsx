// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ lire: vi.fn(), recevoir: vi.fn() }));
vi.mock("@/i18n", () => ({ useI18n: () => ({ t: (k: string) => k, locale: "fr" }) }));
vi.mock("@/verticals/malica-office/composition", () => ({
  office: () => ({ collab: { pvDuClient: api.lire, pvAccuserReception: api.recevoir } }),
}));
import { LivrablesRecus } from "../livrables-recus";
const document = {
  id: "pv",
  titre: "Compte rendu publié",
  at: "2026-10-22",
  envoyeLe: "2026-10-22T10:00:00Z",
  sections: [{ kicker: "Suivi", corps: "Une décision documentée." }],
  decisions: null,
  chiffres: [],
};
function monter() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <LivrablesRecus tenantId="client" />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  api.lire.mockResolvedValue([{ document, recuLe: null, comptabilite: "Comptabilité d'essai" }]);
  api.recevoir.mockResolvedValue("2026-10-22T12:00:00Z");
});
afterEach(cleanup);
describe("la réception d'un livrable", () => {
  it("consulter ne vaut pas réception ; le bouton confirme une seule fois puis reflète le serveur", async () => {
    monter();
    await screen.findByText("Compte rendu publié");
    fireEvent.click(screen.getByText("relation.documents.ouvrir"));
    expect(api.recevoir).not.toHaveBeenCalled();
    api.lire.mockResolvedValue([
      { document, recuLe: "2026-10-22T12:00:00Z", comptabilite: "Comptabilité d'essai" },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "relation.documents.recevoir" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "relation.documents.recevoir" })).toBeNull(),
    );
    expect(api.recevoir).toHaveBeenCalledExactlyOnceWith("pv");
    await screen.findByRole("status");
  });
  it("une panne ne fait pas passer le document pour reçu", async () => {
    api.recevoir.mockRejectedValue(new Error("Réseau indisponible"));
    monter();
    fireEvent.click(await screen.findByRole("button", { name: "relation.documents.recevoir" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "relation.documents.recevoir" })).toBeTruthy();
  });
});
