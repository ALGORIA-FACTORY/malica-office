// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MESSAGES } from "@malica/socle/messages";
import type { ConfigurationFiscale, ProfilFiscal } from "@malica/socle/ports/fiscalite";

const { service } = vi.hoisted(() => ({
  service: {
    profilsFiscaux: vi.fn(),
    fiscaliteDossiers: vi.fn(),
    apercuFiscal: vi.fn(),
    appliquerProfilFiscal: vi.fn(),
    historiqueFiscal: vi.fn(),
    enregistrerProfilFiscal: vi.fn(),
    personnaliserFiscalite: vi.fn(),
    catalogueFiscal: vi.fn(),
  },
}));
vi.mock("@/i18n", () => ({
  useI18n: () => ({
    locale: "fr",
    t: (k: keyof typeof MESSAGES.fr, p?: Record<string, string | number>) =>
      Object.entries(p ?? {}).reduce(
        (s, [k, v]) => s.replaceAll(`{${k}}`, String(v)),
        MESSAGES.fr[k],
      ),
  }),
}));
vi.mock("@/lib/erreur-lisible", () => ({
  texteDeLErreur: (_e: unknown, _o: string, d: string) => d,
}));
vi.mock("@/verticals/malica-office/composition", () => ({
  office: () => ({
    parametrage: service,
    collab: { members: async () => [] },
    acces: { monAcces: async () => ({ role: "expert" }) },
    supervision: {
      listClients: async () => [
        { tenantId: "client-a", name: "Client A", engagementStatus: "actif" },
        { tenantId: "client-b", name: "Client B", engagementStatus: "actif" },
      ],
    },
    referential: { juridictions: async () => [{ jurisdiction: "TEST", currency: "X" }] },
    identity: { regimesDisponibles: async () => [] },
  }),
}));
import { ProfilsFiscaux } from "../profils-fiscaux";
const config: ConfigurationFiscale = {
  activite: "Activité d'essai",
  regimeImposition: null,
  regimeTva: null,
  prorataTva: null,
  regles: [
    {
      famille: "tva",
      operation: "vente",
      typeOperation: "Prestation",
      code: "Essai",
      applicabilite: "a_qualifier",
      mode: "aucun",
      valeur: null,
      assiette: "",
      dansBaseTva: null,
      deductibilite: "a_qualifier",
      referenceLegale: "",
      justificatif: "",
      conditions: "",
    },
  ],
};
const profil: ProfilFiscal = {
  cabinetId: "cabinet",
  id: "version",
  profilId: "profil",
  precedentId: null,
  nom: "Services",
  categorie: "Prestataires",
  jurisdiction: "TEST",
  dateEffet: "2026-01-01",
  configuration: config,
  creeLe: "2026-01-01",
  creePar: "expert",
};
function monter() {
  service.profilsFiscaux.mockResolvedValue([profil]);
  service.fiscaliteDossiers.mockResolvedValue([]);
  service.catalogueFiscal.mockResolvedValue([]);
  service.apercuFiscal.mockResolvedValue([
    {
      clientId: "client-a",
      nom: "Client A",
      precedentId: null,
      statut: "eligible",
      avant: null,
      apres: config,
    },
    {
      clientId: "client-b",
      nom: "Client B",
      precedentId: null,
      statut: "personnalise",
      avant: config,
      apres: config,
    },
  ]);
  service.appliquerProfilFiscal.mockResolvedValue({ appliques: 1, ignores: 1 });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ProfilsFiscaux cabinetId="cabinet" />
    </QueryClientProvider>,
  );
}
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
describe("application groupée des profils fiscaux", () => {
  it("montre les exceptions et attend une validation de l'aperçu avant toute écriture", async () => {
    monter();
    await screen.findByText("Client A");
    fireEvent.change(screen.getByLabelText("Choisir un profil"), { target: { value: "version" } });
    fireEvent.click(screen.getByLabelText("Sélectionner les clients affichés"));
    fireEvent.click(screen.getByRole("button", { name: "Prévisualiser les changements" }));
    await screen.findByText(/Particularités préservées/);
    expect(service.appliquerProfilFiscal).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Appliquer aux 1 clients éligibles" }));
    await waitFor(() => expect(service.appliquerProfilFiscal).toHaveBeenCalledTimes(1));
    expect(service.appliquerProfilFiscal.mock.calls[0]![0].cibles).toHaveLength(2);
    await screen.findByText("1 dossiers mis à jour · 1 écartés");
  });
  it("invalide l'aperçu quand la date ou la sélection change", async () => {
    monter();
    await screen.findByText("Client A");
    fireEvent.change(screen.getByLabelText("Choisir un profil"), { target: { value: "version" } });
    fireEvent.click(screen.getByLabelText("Sélectionner les clients affichés"));
    fireEvent.click(screen.getByRole("button", { name: "Prévisualiser les changements" }));
    await screen.findByRole("button", { name: "Appliquer aux 1 clients éligibles" });
    fireEvent.change(screen.getByLabelText("Date d’effet"), { target: { value: "2027-02-01" } });
    expect(screen.queryByRole("button", { name: /Appliquer aux/ })).toBeNull();
    expect(service.appliquerProfilFiscal).not.toHaveBeenCalled();
  });
  it("ouvre les cinq familles à qualifier, sans inventer de taux", async () => {
    monter();
    await screen.findByText("Client A");
    fireEvent.click(screen.getByRole("button", { name: "Créer un profil" }));
    for (const label of [
      "TVA",
      "Timbre fiscal",
      "FODEC",
      "Retenue à la source",
      "Autre obligation",
    ])
      expect(screen.getByText(`${label} · ${label} · À qualifier`)).toBeTruthy();
    expect(screen.queryByLabelText("Taux (%)")).toBeNull();
    expect(service.enregistrerProfilFiscal).not.toHaveBeenCalled();
  });
});
