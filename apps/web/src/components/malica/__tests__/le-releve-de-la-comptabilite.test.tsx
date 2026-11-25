// @vitest-environment jsdom
/**
 * Le relevé de la comptabilité, chez elle (D8, D11 ; 25 novembre 2026) : ce qu'elle doit se
 * dit avant ses factures, avec son lien de paiement Malica, le compte où virer le montant
 * exact, et le jour où ses attributions ferment puis où ses clients sont suspendus.
 */
import type { RelevesDuCabinet } from "@malica/socle/ports/repositories";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ releves: null as unknown, role: "expert" }));

vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (cle: string, v?: Record<string, unknown>) => (v ? `${cle} ${JSON.stringify(v)}` : cle),
    locale: "fr",
  }),
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children, to, params }: { children: ReactNode; to: string; params?: object }) => (
    <a href={to} data-params={JSON.stringify(params ?? {})}>
      {children}
    </a>
  ),
}));
vi.mock("@/hooks/use-mon-acces", () => ({
  useMonAcces: () => ({ data: { role: api.role } }),
}));
vi.mock("@/verticals/malica-office/composition", () => ({
  office: () => ({
    supervision: { listClients: async () => [] },
    facturation: {
      offresDuCabinet: async () => [],
      abonnementsDuCabinet: async () => [],
      facturesDuCabinet: async () => [],
      relevesDuCabinet: async () => api.releves,
    },
  }),
}));

import { AbonnementsDuCabinet } from "../abonnements-du-cabinet";

const RELEVES: RelevesDuCabinet = {
  banque: {
    titulaire: "TITULAIRE D'ESSAI",
    banque: "BANQUE D'ESSAI",
    rib: "00 000 0000000000000 00",
    iban: null,
    bic: null,
  },
  releves: [
    {
      releve_id: "r-1",
      periode: "2026-10-01",
      etabli_le: "2026-11-01",
      abonnements: 1,
      montant_ht: "58.000",
      montant_tva: "11.020",
      timbre: "1.000",
      montant_ttc: "70.020",
      devise: "TND",
      facture_id: null,
      numero: null,
      paiement_id: "p-1",
      bloque_le: "2099-01-01",
      suspendu_le: "2099-01-17",
      lignes: [{ libelle: "Abonnement Team — Atelier d'essai", montant_ht: "58.000" }],
    },
  ],
};

function monter() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AbonnementsDuCabinet
        cabinet={{ id: "c-1", name: "Comptabilité d'essai", currency: "TND" }}
        facturesSeules
      />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  api.role = "expert";
});

describe("le relevé de la comptabilité", () => {
  it("à régler : son montant, son lien de paiement Malica, le compte où virer, son échéance", async () => {
    api.releves = RELEVES;
    monter();
    const ligne = await screen.findByText(/^cab\.releve\.ligne /);
    expect(ligne.textContent).toContain("2026-10");
    const payer = screen.getByText("cab.releve.payer").closest("a")!;
    expect(payer.getAttribute("href")).toBe("/cabinet/payer/$paiementId");
    expect(payer.dataset["params"]).toContain("p-1");
    expect(document.querySelector("[data-virement]")!.textContent).toContain(
      "00 000 0000000000000 00",
    );
    expect(screen.getByText(/^cab\.releve\.avant /)).toBeTruthy();
    expect(screen.getByText("Abonnement Team — Atelier d'essai")).toBeTruthy();
  });

  it("impayé passé les délais : attributions fermées, puis clients suspendus, dits en alerte", async () => {
    api.releves = {
      ...RELEVES,
      releves: [{ ...RELEVES.releves[0]!, bloque_le: "2000-01-15", suspendu_le: "2099-01-01" }],
    };
    monter();
    expect((await screen.findByRole("alert")).textContent).toContain("cab.releve.bloque");
    cleanup();
    api.releves = {
      ...RELEVES,
      releves: [{ ...RELEVES.releves[0]!, bloque_le: "2000-01-15", suspendu_le: "2000-02-01" }],
    };
    monter();
    expect((await screen.findByRole("alert")).textContent).toContain("cab.releve.suspendu");
  });

  it("un collaborateur lit le relevé sans pouvoir le payer ; réglé, il ne s'affiche plus", async () => {
    api.role = "collaborateur";
    api.releves = RELEVES;
    monter();
    await screen.findByText(/^cab\.releve\.ligne /);
    expect(screen.queryByText("cab.releve.payer")).toBeNull();
    cleanup();
    api.releves = {
      ...RELEVES,
      releves: [{ ...RELEVES.releves[0]!, facture_id: "f-1", numero: "MO-1", paiement_id: null }],
    };
    monter();
    await screen.findByText("cab.abo.factures.vide");
    expect(screen.queryByText(/^cab\.releve\.ligne /)).toBeNull();
  });
});
