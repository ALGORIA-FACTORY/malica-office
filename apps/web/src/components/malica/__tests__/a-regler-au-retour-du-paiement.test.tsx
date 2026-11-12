// @vitest-environment jsdom
/**
 * « À régler » au retour de la page de paiement (recette du 11 novembre 2026,
 * point 3.5) : « Paiement refusé » se dit une fois, et une fois tout payé,
 * « À régler · 0 opération en attente » ne reste pas affiché.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ mesPaiements: vi.fn(), simulerPaiement: vi.fn() }));
vi.mock("@/i18n", () => ({
  useI18n: () => ({ t: (cle: string) => cle, locale: "fr" }),
}));
vi.mock("@/components/malica/pme-context", () => ({
  usePme: () => ({
    tenantId: "org-essai",
    currency: "TND",
    forfait: { ligne: { offre: "solo", prix_mensuel_ht: "19.000", titulaire: true } },
  }),
}));
vi.mock("@/hooks/use-decimales", () => ({ usePrix: () => (v: unknown) => String(v ?? "") }));
vi.mock("@/hooks/use-offres", () => ({
  useCatalogueDesOffres: () => ({ data: undefined }),
  libelleDOffre: (_c: unknown, code: string) => code,
  offreQuiPermetDeRecharger: () => undefined,
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: unknown }) => children,
  useNavigate: () => vi.fn(),
}));
vi.mock("@/verticals/malica-office/composition", () => ({
  office: () => ({ facturation: api }),
}));

import { ARegler } from "../abonnement-pilote";

function paiement(etat: string) {
  return {
    paiement_id: "p-1",
    objet: "montee",
    libelle: "Passage Solo -> Premium",
    montant_ht: "26.667",
    montant_tva: "5.067",
    montant_ttc: "31.734",
    devise: "TND",
    cree_le: "2026-11-12T08:00:00Z",
    etat,
    prestataire: "simulateur",
    reference: null,
    lien: null,
    impute: false,
    payeur_tenant_id: null,
  };
}

function monter() {
  window.history.pushState({}, "", "/pme/reglages?page=abonnement&paiement=p-1&simulateur=1");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ARegler />
    </QueryClientProvider>,
  );
}

describe("« À régler » au retour du paiement", () => {
  beforeEach(() => vi.resetAllMocks());
  afterEach(cleanup);

  it("un refus se dit une seule fois", async () => {
    api.mesPaiements.mockResolvedValueOnce([paiement("lien_cree")]);
    api.mesPaiements.mockResolvedValue([paiement("refuse")]);
    api.simulerPaiement.mockResolvedValue(paiement("refuse"));
    monter();
    fireEvent.click(await screen.findByText("pme.reglages.paiement.simuler.refuser"));
    await waitFor(() => expect(api.mesPaiements.mock.calls.length).toBeGreaterThanOrEqual(2));
    await screen.findByText("pme.reglages.paiement.refuse");
    expect(screen.getAllByText("pme.reglages.paiement.refuse")).toHaveLength(1);
  });

  it("tout payé : le verdict, sans « 0 opération en attente »", async () => {
    api.mesPaiements.mockResolvedValueOnce([paiement("lien_cree")]);
    api.mesPaiements.mockResolvedValue([paiement("paye")]);
    api.simulerPaiement.mockResolvedValue(paiement("paye"));
    monter();
    fireEvent.click(await screen.findByText("pme.reglages.paiement.simuler.payer"));
    await screen.findByText("pme.reglages.paiement.paye");
    await waitFor(() => expect(screen.queryByText("pme.reglages.paiement.combien")).toBeNull());
    expect(screen.queryByText("pme.reglages.paiement.titre")).toBeNull();
  });
});
