// @vitest-environment jsdom
/**
 * La fiche d'un client (recette du 11 novembre 2026, point 5.1).
 *
 *   - le matricule figé à la première pièce est gris, et dit pourquoi ;
 *   - figé, il ne bloque plus le reste de la fiche : le régime s'enregistre ;
 *   - « Enregistrer » dit, dans la fiche, que c'est fait ;
 *   - « Enregistrer le mandat » le dit aussi, même si le mandat renaît.
 */
import type { ClientSummary, MandatHonoraires } from "@malica/socle/ports/repositories";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const monde = vi.hoisted(() => ({
  fige: true,
  mandats: [] as unknown[],
}));
const appels = vi.hoisted(() => ({
  modifierDossier: vi.fn(async () => ({})),
  etablirFiche: vi.fn(async () => ({})),
  definirMandat: vi.fn(async (..._a: unknown[]) => ({ id: "m2" })),
}));

vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (cle: string, v?: Record<string, unknown>) => (v ? `${cle} ${JSON.stringify(v)}` : cle),
    locale: "fr",
  }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: ReactNode }) => <a>{children}</a>,
  useNavigate: () => vi.fn(),
}));
vi.mock("@/components/malica/cabinet-context", () => ({
  useCabinet: () => ({ org: { id: "cabinet", jurisdiction: "TN", currency: "TND" } }),
  useMalicaPanel: vi.fn(),
}));

const vide = async () => [];
const depot = (m: Record<string, unknown>) => new Proxy(m, { get: (c, n: string) => c[n] ?? vide });
vi.mock("@/verticals/malica-office/composition", () => ({
  office: () =>
    new Proxy(
      {
        identity: depot({
          matriculeFige: async () => monde.fige,
          ficheCourante: async () => ({
            regimeImposition: "reel",
            regimeTva: null,
            clotureExercice: "12-31",
            formeJuridique: null,
            modeDepot: null,
            secteur: null,
            prorataTva: null,
            debutActivite: null,
          }),
          regimesDisponibles: async () => [
            { axe: "imposition", code: "reel", libelle: "Réel" },
            { axe: "tva", code: "assujetti", libelle: "Assujetti" },
          ],
          modifierDossier: appels.modifierDossier,
          etablirFiche: appels.etablirFiche,
        }),
        honoraires: depot({
          mandats: async () => monde.mandats,
          definirMandat: async (...a: unknown[]) => {
            // Enregistrer ouvre un mandat NOUVEAU : la liste revient avec un autre id.
            monde.mandats = [{ ...MANDAT, id: "m2" }];
            return appels.definirMandat(...a);
          },
        }),
      } as Record<string, unknown>,
      { get: (c, n: string) => c[n] ?? depot({}) },
    ),
}));

const CLIENT = {
  tenantId: "pme-1",
  name: "Atelier Samia",
  legalId: "1234567A/A/M/000",
  engagementStatus: "actif",
} as unknown as ClientSummary;

const MANDAT = {
  id: "m1",
  clientTenantId: "pme-1",
  mode: "forfait",
  frequence: "mensuelle",
  jourFacturation: 1,
  forfait: "250.000",
  tauxHoraire: null,
  delaiPaiementJours: 30,
  couverture: [],
  validFrom: "2026-11-01",
  prochaine: null,
} as unknown as MandatHonoraires;

import { FicheClient } from "@/components/malica/clients/fiche-client";
import { MandatDuClient } from "@/components/malica/honoraires-de-la-comptabilite";

function rendre(noeud: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{noeud}</QueryClientProvider>);
}

const fiche = (
  <FicheClient
    client={CLIENT}
    etat={undefined}
    mandat={undefined}
    offres={[]}
    expert
    ongletInitial="societe"
    fermer={() => undefined}
    annoncer={() => undefined}
    societesDeLaLicence={[]}
  />
);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  Object.assign(monde, { fige: true, mandats: [] });
});

describe("la fiche fiscale d'un client", () => {
  it("figé, le matricule est gris et dit pourquoi", async () => {
    rendre(fiche);
    await screen.findByText("cab.cli.champ.mf.figeDepuis");
    const mf = screen.getByDisplayValue("1234567A/A/M/000") as HTMLInputElement;
    expect(mf.disabled).toBe(true);
  });

  it("non figé, le matricule reste modifiable", async () => {
    monde.fige = false;
    rendre(fiche);
    await screen.findByText("cab.cli.champ.mf.fige");
    await waitFor(() =>
      expect((screen.getByDisplayValue("1234567A/A/M/000") as HTMLInputElement).disabled).toBe(
        false,
      ),
    );
  });

  it("figé, le régime s'enregistre, et la fiche dit « enregistré »", async () => {
    rendre(fiche);
    await screen.findByText("cab.cli.champ.mf.figeDepuis");
    const tva = await screen
      .findByDisplayValue("cab.cli.a.completer", undefined, {
        timeout: 2000,
      })
      .catch(() => null);
    const selects = screen.getAllByRole("combobox") as HTMLSelectElement[];
    const regimeTva = tva ?? selects[1]!;
    await waitFor(() => expect(regimeTva.querySelectorAll("option").length).toBeGreaterThan(1));
    fireEvent.change(regimeTva, { target: { value: "assujetti" } });
    fireEvent.click(screen.getByRole("button", { name: "cab.cli.enregistrer" }));
    await waitFor(() => expect(appels.etablirFiche).toHaveBeenCalled());
    expect(appels.modifierDossier).not.toHaveBeenCalled();
    expect(await screen.findByRole("status")).toBeTruthy();
    expect(screen.getByText("cab.cli.enregistre")).toBeTruthy();
  });
});

describe("le mandat d'un client", () => {
  it("« Enregistrer le mandat » dit que c'est fait, même quand le mandat renaît", async () => {
    monde.mandats = [MANDAT];
    rendre(<MandatDuClient clientTenantId="pme-1" clientName="Atelier Samia" />);
    const bouton = await screen.findByRole("button", { name: "cab.hono.mandat.enregistrer" });
    fireEvent.click(bouton);
    await waitFor(() => expect(appels.definirMandat).toHaveBeenCalled());
    expect(await screen.findByText("cab.hono.mandat.enregistre")).toBeTruthy();
  });
});
