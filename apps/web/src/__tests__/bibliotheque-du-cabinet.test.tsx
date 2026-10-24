// @vitest-environment jsdom
/** La bibliothèque du cabinet : onglets tirés du référentiel, date de classement. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocumentComptable } from "@malica/socle/ports/repositories";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { component: ComponentType }) => ({
    options,
    useSearch: () => ({}),
    useNavigate: () => vi.fn(),
  }),
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));
vi.mock("@/i18n", () => ({
  useI18n: () => ({ t: (cle: string) => cle, locale: "fr", dir: "ltr" }),
}));
vi.mock("@/components/malica/cabinet-context", () => ({
  useCabinet: () => ({ org: { id: "cabinet", name: "Cabinet" } }),
}));
vi.mock("@/components/malica/telecharger-dossier-comptable", () => ({
  TelechargerDossierComptable: () => null,
}));

const document = (id: string, type: string | null, reference: string): DocumentComptable => ({
  id,
  tenantId: "client",
  type,
  status: "lue",
  reference,
  tiers: null,
  dateDocument: null,
  dateDeClassement: "2026-01-31",
  recuLe: "2026-01-31 23:30:00+00",
  empreinte: null,
  montant: null,
  devise: "TND",
  sourcePieceId: null,
});

vi.mock("@/verticals/malica-office/composition", () => ({
  office: () => ({
    supervision: {
      listClients: async () => [
        { tenantId: "client", name: "Client", engagementStatus: "actif", legalId: null },
      ],
      documents: async () => [
        document("f", "facture_achat", "F-1"),
        document("a", "avoir", "AV-1"),
        document("x", null, "X-1"),
      ],
    },
    referential: {
      typesDeDocument: async () => [
        { code: "facture_achat", libelle: "Facture d'achat" },
        { code: "avoir", libelle: "Avoir" },
        { code: "facture_vente", libelle: "Facture de vente" },
      ],
    },
  }),
}));

import { Route } from "../routes/_authenticated/cabinet.bibliotheque";

const Ecran = (Route as unknown as { options: { component: ComponentType } }).options.component;

afterEach(cleanup);

describe("bibliothèque du cabinet", () => {
  it("tire ses onglets du référentiel, pour les seuls types présents", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Ecran />
      </QueryClientProvider>,
    );
    const onglets = within(await screen.findByRole("tablist"));
    await onglets.findByRole("tab", { name: "Avoir" });
    expect(onglets.getAllByRole("tab").map((o) => o.textContent)).toEqual([
      "cab.biblio.all",
      "Facture d'achat",
      "Avoir",
      "cab.biblio.autres",
    ]);
    // Un avoir n'est plus rangé dans « autres » faute d'un code écrit à la main.
    fireEvent.click(onglets.getByRole("tab", { name: "Avoir" }));
    expect(screen.getByText("AV-1")).toBeTruthy();
    expect(screen.queryByText("F-1")).toBeNull();
    fireEvent.click(onglets.getByRole("tab", { name: "cab.biblio.autres" }));
    expect(screen.getByText("X-1")).toBeTruthy();
    expect(screen.queryByText("AV-1")).toBeNull();
  });

  it("date chaque document de sa date de classement, telle que l'API l'a établie", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Ecran />
      </QueryClientProvider>,
    );
    expect((await screen.findAllByText(/31\/01\/2026/)).length).toBe(3);
  });
});
