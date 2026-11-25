// @vitest-environment jsdom
/**
 * La garde d'abonnement de la PME (D7, D12) : ce qui est dû se dit avec son bouton de
 * paiement, et le solde créditeur déjà déduit se dit aussi (comme le « solde appliqué »
 * d'Anthropic, 25 novembre 2026).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MonEcheance } from "@malica/socle/ports/repositories";

const api = vi.hoisted(() => ({ echeance: null as unknown }));

vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (cle: string, v?: Record<string, unknown>) => (v ? `${cle} ${JSON.stringify(v)}` : cle),
    locale: "fr",
  }),
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useRouterState: () => "/pme",
}));
vi.mock("@/components/malica/pme-context", () => ({
  usePme: () => ({ tenantId: "t-1", forfait: { ligne: { offre: "solo" } } }),
}));
vi.mock("@/verticals/malica-office/composition", () => ({
  office: () => ({
    facturation: {
      monEssai: async () => null,
      monEcheance: async () => api.echeance,
      changerForfait: vi.fn(),
    },
  }),
}));

import GardeDAbonnement from "../garde-d-abonnement";

const DU: MonEcheance = {
  etat: "a_payer",
  due_depuis: "2026-11-25",
  dernier_jour: "2026-12-08",
  jours_restants: 13,
  paiement_id: "p-1",
  montant_ttc: "22.610",
  credit_deduit: "0",
  devise: "TND",
  titulaire: true,
};

function monter() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <GardeDAbonnement>
        <p>contenu</p>
      </GardeDAbonnement>
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

describe("la garde d'abonnement", () => {
  it("ce qui est dû se dit, avec son bouton de paiement, et la page reste lisible", async () => {
    api.echeance = DU;
    monter();
    expect(await screen.findByText(/^pme\.abonnement\.aPayer /)).toBeTruthy();
    expect(screen.getByText("pme.abonnement.payer")).toBeTruthy();
    expect(screen.getByText("contenu")).toBeTruthy();
  });

  it("un solde déjà déduit se dit, avec ce qui reste à payer", async () => {
    api.echeance = { ...DU, credit_deduit: "6.950" };
    monter();
    const ligne = await screen.findByText(/^pme\.abonnement\.aPayer\.credit /);
    expect(ligne.textContent).toContain("6.950 TND");
    expect(ligne.textContent).toContain("22.610 TND");
  });
});
