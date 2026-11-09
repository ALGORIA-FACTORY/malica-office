// @vitest-environment jsdom
/**
 * « Mes recharges » ne fait jamais tomber l'écran des réglages.
 *
 * Staging, 29 octobre 2026 : une recharge sans échéance est arrivée avec
 * `expire_le: "infinity"`, le formateur de date a levé « Invalid time value »
 * et tout l'écran /pme/reglages a disparu. L'API rend désormais `null` ; une
 * date illisible, d'où qu'elle vienne, part au journal et s'affiche neutre.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ mesRecharges: vi.fn(), noter: vi.fn() }));
vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (cle: string, p?: Record<string, unknown>) => (p ? `${cle} ${JSON.stringify(p)}` : cle),
    locale: "fr",
  }),
}));
vi.mock("@/components/malica/pme-context", () => ({
  usePme: () => ({
    tenantId: "org-essai",
    currency: "TND",
    forfait: { ligne: { offre: "solo", prix_mensuel_ht: "30.000", titulaire: true } },
  }),
}));
vi.mock("@/hooks/use-decimales", () => ({ usePrix: () => (v: unknown) => String(v ?? "") }));
vi.mock("@/hooks/use-offres", () => ({
  useCatalogueDesOffres: () => ({ data: undefined }),
  libelleDOffre: (_c: unknown, code: string) => code,
  offreQuiPermetDeRecharger: () => undefined,
}));
vi.mock("@/lib/journal-atelier", () => ({ noterAuJournal: api.noter }));
vi.mock("@/verticals/malica-office/composition", () => ({
  office: () => ({
    facturation: {
      paliersDeRecharge: async () => [],
      mesRecharges: api.mesRecharges,
      maRechargeAutomatique: async () => null,
    },
  }),
}));

import { MesRecharges } from "../abonnement-pilote";

function recharge(expire_le: string | null) {
  return {
    recharge_id: `r-${expire_le ?? "sans"}`,
    recharge_code: "recharge_20",
    lectures: 20,
    prix_ht: "5.000",
    achetee_le: "2026-10-23",
    expire_le,
    origine: "achat",
    restantes: 20,
    utilisable: true,
    gelee: false,
    expiree: false,
  };
}

function monter() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MesRecharges />
    </QueryClientProvider>,
  );
}

describe("mes recharges", () => {
  beforeEach(() => vi.resetAllMocks());
  afterEach(cleanup);

  it("une recharge sans échéance se dit « sans date limite »", async () => {
    api.mesRecharges.mockResolvedValue([recharge(null)]);
    monter();
    const ligne = await screen.findByText(/pme\.reglages\.recharges\.reste\.sansDateLimite/);
    expect(ligne.textContent).toContain('"restantes":20');
    expect(api.noter).not.toHaveBeenCalled();
  });

  it("une recharge datée dit jusqu'à quand, en lettres", async () => {
    api.mesRecharges.mockResolvedValue([recharge("2027-10-23")]);
    monter();
    const ligne = await screen.findByText(/pme\.reglages\.recharges\.reste /);
    expect(ligne.textContent).toContain("23 octobre 2027");
  });

  it("une date illisible ne fait pas tomber l'écran : elle part au journal", async () => {
    api.mesRecharges.mockResolvedValue([recharge("infinity")]);
    monter();
    const ligne = await screen.findByText(/pme\.reglages\.recharges\.reste /);
    expect(ligne.textContent).not.toContain("infinity");
    expect(api.noter).toHaveBeenCalledOnce();
  });
});
