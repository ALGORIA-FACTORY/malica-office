// @vitest-environment jsdom
/**
 * La page Abonnement se relit après chaque geste qui change qui paie
 * (recette du 11 novembre 2026, point 1.3).
 *
 * Juste après « Accepter » la prise en charge, l'écran proposait encore
 * « Passer à Solo » (l'offre en cours) et l'année en Basic, avec des écarts
 * faux : seules `mon-forfait` et la liste des propositions étaient relues.
 * Accepter, refuser, trancher une descente relisent désormais tout ce que la
 * page lit — offres, année, paiements, factures — et le cache de l'appareil
 * se réécrit de lui-même à la relecture (`lib/cache-de-l-appareil`).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  abonnementsPourMoi: vi.fn(),
  descentePourMoi: vi.fn(),
  repondreAbonnement: vi.fn(),
  repondreDescente: vi.fn(),
}));
vi.mock("@/i18n", () => ({
  useI18n: () => ({ t: (cle: string) => cle, locale: "fr" }),
}));
vi.mock("@/components/malica/pme-context", () => ({
  usePme: () => ({
    tenantId: "org-essai",
    currency: "TND",
    forfait: { ligne: { offre: "basic", prix_mensuel_ht: "9.000", titulaire: true } },
  }),
}));
vi.mock("@/hooks/use-decimales", () => ({ usePrix: () => (v: unknown) => String(v ?? "") }));
vi.mock("@/hooks/use-offres", () => ({
  useCatalogueDesOffres: () => ({ data: undefined }),
  libelleDOffre: (_c: unknown, code: string) => code,
  offreQuiPermetDeRecharger: () => undefined,
}));
vi.mock("@/verticals/malica-office/composition", () => ({
  office: () => ({ facturation: api }),
}));

import { AbonnementDeLaComptabilite } from "../abonnement-pilote";

/** Ce que la page Abonnement lit, et qui doit être relu. */
const LUES = [
  "mon-forfait",
  "mes-offres",
  "mon-annuel",
  "mes-paiements",
  "abonnements-pour-moi",
  "descente-pour-moi",
];

function monter() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalider = vi.spyOn(client, "invalidateQueries");
  render(
    <QueryClientProvider client={client}>
      <AbonnementDeLaComptabilite tenantId="org-essai" />
    </QueryClientProvider>,
  );
  const relues = () => new Set(invalider.mock.calls.map((c) => String(c[0]?.queryKey?.[0])));
  return { relues };
}

describe("la page Abonnement se relit après la comptabilité", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.descentePourMoi.mockResolvedValue(null);
  });
  afterEach(cleanup);

  it("accepter la prise en charge relit les offres, l'année et les paiements", async () => {
    api.abonnementsPourMoi.mockResolvedValue([
      {
        acces_id: "a-1",
        cabinet_nom: "La comptabilité",
        offre_code: "solo",
        statut: "propose",
        effet_du: null,
      },
    ]);
    api.repondreAbonnement.mockResolvedValue({ acces_id: "a-1", statut: "actif" });
    const { relues } = monter();
    fireEvent.click(await screen.findByText("pme.abo.cabinet.accepter"));
    await screen.findByText("pme.abo.cabinet.accepte");
    await waitFor(() => {
      for (const cle of LUES) expect(relues(), cle).toContain(cle);
    });
    expect(api.repondreAbonnement).toHaveBeenCalledWith("a-1", true);
  });

  it("trancher une descente relit tout autant", async () => {
    api.abonnementsPourMoi.mockResolvedValue([]);
    api.descentePourMoi.mockResolvedValue({
      descente_id: "d-1",
      offre_code: "solo",
      comptabilite: "La comptabilité",
      propose_le: "2026-11-12",
    });
    api.repondreDescente.mockResolvedValue({ descente_id: "d-1", statut: "acceptee" });
    const { relues } = monter();
    fireEvent.click(await screen.findByText("pme.descente.accepter"));
    await screen.findByText("pme.descente.ok");
    await waitFor(() => {
      for (const cle of LUES) expect(relues(), cle).toContain(cle);
    });
  });
});

describe("la page Abonnement suit ce que la comptabilité fait ailleurs", () => {
  afterEach(cleanup);

  it("une alerte d'abonnement nouvelle relit la page ; la première lecture, non", async () => {
    const { useAbonnementSuitLesAlertes } = await import("@/hooks/use-relire-l-abonnement");
    const client = new QueryClient();
    const invalider = vi.spyOn(client, "invalidateQueries");
    function Cloche({ alertes }: { alertes: { kind: string; createdAt: string }[] | undefined }) {
      useAbonnementSuitLesAlertes(alertes);
      return null;
    }
    const avec = (alertes: { kind: string; createdAt: string }[] | undefined) => (
      <QueryClientProvider client={client}>
        <Cloche alertes={alertes} />
      </QueryClientProvider>
    );
    const vue = render(avec(undefined));
    vue.rerender(avec([{ kind: "acces.accepte", createdAt: "2026-11-12T08:00:00Z" }]));
    await new Promise((r) => setTimeout(r, 0));
    expect(invalider).not.toHaveBeenCalled();
    // La comptabilité arrête (`acces_arreter`) : l'alerte arrive à la relecture de la cloche.
    vue.rerender(
      avec([
        { kind: "acces.accepte", createdAt: "2026-11-12T08:00:00Z" },
        { kind: "acces.arrete", createdAt: "2026-11-12T09:00:00Z" },
      ]),
    );
    await waitFor(() =>
      expect(new Set(invalider.mock.calls.map((c) => String(c[0]?.queryKey?.[0])))).toContain(
        "mes-offres",
      ),
    );
  });
});
