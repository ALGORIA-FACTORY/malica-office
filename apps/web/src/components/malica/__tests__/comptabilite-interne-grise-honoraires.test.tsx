// @vitest-environment jsdom
/**
 * Le comptable interne ouvre l'espace de sa société (recette du 12 novembre
 * 2026, point 7, décision 2) : honoraires et abonnement restent VISIBLES mais
 * grisés, avec la raison affichée. Les autres onglets ne changent pas.
 */
import type { ClientSummary, MandatHonoraires } from "@malica/socle/ports/repositories";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const monde = vi.hoisted(() => ({ kind: "pme" as "pme" | "cabinet" }));

vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (cle: string) => cle,
    locale: "fr",
  }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: ReactNode }) => <a>{children}</a>,
  useNavigate: () => vi.fn(),
}));
vi.mock("@/components/malica/cabinet-context", async (importe) => {
  const reel = await importe<typeof import("@/components/malica/cabinet-context")>();
  return {
    ...reel,
    useCabinet: () => ({
      org: { id: "org-1", kind: monde.kind, jurisdiction: "TN", currency: "TND" },
    }),
    useMalicaPanel: vi.fn(),
  };
});

const vide = async () => [];
vi.mock("@/verticals/malica-office/composition", () => ({
  office: () =>
    new Proxy(
      {},
      {
        get: () =>
          new Proxy(
            {},
            {
              get: () => vide,
            },
          ),
      },
    ),
}));

import { FicheClient } from "@/components/malica/clients/fiche-client";
import { estComptabiliteInterne } from "@/lib/comptabilite-interne";

const CLIENT = {
  tenantId: "pme-1",
  name: "Atelier Samia",
  legalId: "1234567A/A/M/000",
  engagementStatus: "actif",
} as unknown as ClientSummary;

function rendre(ongletInitial: "societe" | "mandat" | "abo") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <FicheClient
        client={CLIENT}
        etat={undefined}
        mandat={undefined as MandatHonoraires | undefined}
        offres={[]}
        expert={false}
        ongletInitial={ongletInitial}
        fermer={() => undefined}
        annoncer={() => undefined}
        societesDeLaLicence={[]}
      />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  monde.kind = "pme";
});

describe("comptabilité interne : honoraires et abonnement grisés", () => {
  it("la société tenue en interne est reconnue, un cabinet ne l'est pas", () => {
    expect(estComptabiliteInterne({ kind: "pme" } as never)).toBe(true);
    expect(estComptabiliteInterne({ kind: "cabinet" } as never)).toBe(false);
  });

  it("chez le comptable interne, l'onglet Abonnement est grisé, avec sa raison", () => {
    rendre("societe");
    const abo = screen.getByRole("tab", { name: "cab.cli.onglet.abo" });
    expect((abo as HTMLButtonElement).disabled).toBe(true);
    expect(abo.getAttribute("title")).toBe("cab.cli.grise.externe");
    expect(
      (screen.getByRole("tab", { name: "cab.cli.onglet.mandat" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("le contenu d'un onglet grisé dit pourquoi, sans rien charger", () => {
    rendre("abo");
    expect(screen.getAllByText("cab.cli.grise.externe").length).toBeGreaterThan(0);
  });

  it("l'onglet Société reste ouvert au comptable interne", () => {
    rendre("societe");
    expect(
      (screen.getByRole("tab", { name: "cab.cli.onglet.societe" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("chez un cabinet, rien n'est grisé", () => {
    monde.kind = "cabinet";
    rendre("societe");
    expect(
      (screen.getByRole("tab", { name: "cab.cli.onglet.abo" }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(screen.queryByText("cab.cli.grise.externe")).toBeNull();
  });
});
