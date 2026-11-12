// @vitest-environment jsdom
/**
 * Les notes d'honoraires s'éteignent à la tour (décision du dirigeant,
 * 12 novembre 2026 — recette du 11, point 7.4).
 *
 * Éteintes, l'écran de la comptabilité ne montre rien d'elles : ni le bloc
 * « Honoraires et mandats » de la vue Facturation, ni l'onglet « Factures » de
 * la fiche client, ni l'adresse d'une facture. Ce qui ne s'éteint pas reste :
 * l'onglet « Mandat et honoraires » et « Ce que vous réglez à Malica ».
 * Allumées, tout revient. La tour, elle, montre l'interrupteur et ne le
 * bascule jamais sans motif.
 */
import type { ClientSummary, EtatDesFonctions } from "@malica/socle/ports/repositories";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const monde = vi.hoisted(() => ({
  ouvertes: false,
  recherche: {} as Record<string, string>,
  fonctions: {} as Record<string, unknown>,
}));
const appels = vi.hoisted(() => ({
  facture: vi.fn(async () => null),
  synthese: vi.fn(() => new Promise(() => undefined)),
  reglerFonction: vi.fn(async () => ({})),
}));

vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (cle: string, v?: Record<string, unknown>) => (v ? `${cle} ${JSON.stringify(v)}` : cle),
    locale: "fr",
  }),
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({
    options,
    useSearch: () => monde.recherche,
    useParams: () => ({ factureId: "f1" }),
  }),
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children?: ReactNode }) => <a>{children}</a>,
  Navigate: ({ to }: { to: string }) => <p data-redirige={to} />,
}));
vi.mock("@/components/malica/cabinet-context", () => ({
  useCabinet: () => ({ org: { id: "cabinet", jurisdiction: "pack", currency: "TND" } }),
  useMalicaPanel: vi.fn(),
}));
vi.mock("@/hooks/use-mon-acces", () => ({ useMonAcces: () => ({ data: { role: "expert" } }) }));

const CLIENT = {
  tenantId: "pme-1",
  name: "Atelier Samia",
  legalId: "1234567A/A/M/000",
  engagementStatus: "actif",
} as unknown as ClientSummary;

/** Tout dépôt répond « rien » ; seules les lectures utiles ici disent quelque chose. */
const vide = async () => [];
const depot = (methodes: Record<string, unknown>) =>
  new Proxy(methodes, { get: (cible, nom: string) => cible[nom] ?? vide });
vi.mock("@/verticals/malica-office/composition", () => ({
  office: () =>
    new Proxy(
      {
        honoraires: depot({
          notesOuvertes: async () => monde.ouvertes,
          facture: appels.facture,
          synthese: appels.synthese,
        }),
        supervision: depot({ listClients: async () => [CLIENT] }),
        identity: depot({ ficheCourante: async () => null }),
        referential: depot({ activePack: async () => null }),
        tour: depot({
          fonctions: async () => monde.fonctions,
          reglerFonction: appels.reglerFonction,
        }),
      } as Record<string, unknown>,
      { get: (cible, nom: string) => cible[nom] ?? depot({}) },
    ),
}));

import { FicheClient } from "@/components/malica/clients/fiche-client";
import { LesFonctionsDuProduit } from "@/components/malica/tour/fonctions";
import { Route as RouteClients } from "@/routes/_authenticated/cabinet.clients";
import { Route as RouteFacture } from "@/routes/_authenticated/cabinet.facture.$factureId";

const composant = (route: unknown) =>
  (route as { options: { component: () => ReactNode } }).options.component;

function rendre(noeud: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{noeud}</QueryClientProvider>);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  Object.assign(monde, { ouvertes: false, recherche: {}, fonctions: {} });
});

describe("la vue Facturation de la page Clients", () => {
  const Page = composant(RouteClients);

  it("éteintes : ni « Honoraires et mandats », ni facture, ni trésorerie ; la facture de Malica reste", async () => {
    monde.recherche = { vue: "facturation" };
    rendre(<Page />);
    await screen.findByText("cab.cli.malica.titre");
    expect(screen.queryByText("cab.hono.title")).toBeNull();
    expect(screen.queryByText("cab.hono.tab.tresorerie")).toBeNull();
    expect(screen.queryByText("cab.hono.nouvelle")).toBeNull();
    expect(appels.synthese).not.toHaveBeenCalled();
  });

  it("allumées : le bloc « Honoraires et mandats » revient, avec sa trésorerie", async () => {
    monde.ouvertes = true;
    monde.recherche = { vue: "facturation" };
    rendre(<Page />);
    await screen.findByText("cab.hono.title");
    expect(screen.getByText("cab.hono.tab.tresorerie")).toBeTruthy();
    expect(screen.getByText("cab.cli.malica.titre")).toBeTruthy();
  });
});

describe("la fiche d'un client", () => {
  const fiche = (ongletInitial: "societe" | "factures") => (
    <FicheClient
      client={CLIENT}
      etat={undefined}
      mandat={undefined}
      offres={[]}
      expert
      ongletInitial={ongletInitial}
      fermer={() => undefined}
      annoncer={() => undefined}
      societesDeLaLicence={[]}
    />
  );

  it("éteintes : pas d'onglet « Factures », même demandé par l'adresse ; « Mandat et honoraires » reste", async () => {
    rendre(fiche("factures"));
    const mandat = await screen.findByRole("tab", { name: "cab.cli.onglet.mandat" });
    expect(mandat).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "cab.cli.onglet.factures" })).toBeNull();
    expect(
      screen.getByRole("tab", { name: "cab.cli.onglet.societe" }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(screen.queryByText("cab.cli.factures.note")).toBeNull();
  });

  it("allumées : l'onglet « Factures » revient", async () => {
    monde.ouvertes = true;
    rendre(fiche("societe"));
    expect(await screen.findByRole("tab", { name: "cab.cli.onglet.factures" })).toBeTruthy();
  });
});

describe("l'adresse d'une facture d'honoraires", () => {
  const Page = composant(RouteFacture);

  it("éteintes : ramène à la page Clients, sans lire la facture", async () => {
    rendre(<Page />);
    await waitFor(() =>
      expect(document.querySelector("[data-redirige]")?.getAttribute("data-redirige")).toBe(
        "/cabinet/clients",
      ),
    );
    expect(appels.facture).not.toHaveBeenCalled();
  });

  it("allumées : lit la facture", async () => {
    monde.ouvertes = true;
    rendre(<Page />);
    await waitFor(() => expect(appels.facture).toHaveBeenCalledWith("f1"));
    expect(document.querySelector("[data-redirige]")).toBeNull();
  });
});

describe("la carte « Fonctions du produit » de la tour", () => {
  const LIVREE: EtatDesFonctions = {
    notes_honoraires: {
      actif: false,
      motif: "Éteinte jusqu'après la production",
      decide_le: "2026-11-12T00:00:00.000Z",
      decide_par_email: null,
      decide_par_nom: null,
    },
  };

  async function carte(etat: EtatDesFonctions) {
    monde.fonctions = etat;
    rendre(<LesFonctionsDuProduit />);
    return waitFor(() => {
      const el = document.querySelector<HTMLElement>('[data-fonction="notes_honoraires"]');
      if (!el?.querySelector("[data-etat]")) throw new Error("carte absente");
      return el;
    });
  }

  it("dit l'état livré : éteinte, décidée à la livraison, avec son motif", async () => {
    const c = await carte(LIVREE);
    expect(within(c).getByText("tour.fonctions.notes_honoraires")).toBeTruthy();
    expect(c.querySelector("[data-etat]")!.textContent).toContain("tour.fonctions.etat.eteinte");
    expect(c.querySelector("[data-par]")!.textContent).toBe("tour.facturation.parLaLivraison");
    expect(c.querySelector("[data-motif]")!.textContent).toContain("jusqu'après la production");
  });

  it("n'allume jamais sans motif ; avec un motif, transmet la fonction, l'état et le motif", async () => {
    const c = await carte(LIVREE);
    const allumer = within(c).getByRole<HTMLButtonElement>("button", {
      name: "tour.fonctions.allumer",
    });
    expect(allumer.disabled).toBe(true);
    fireEvent.change(within(c).getByLabelText("common.motif"), { target: { value: "  " } });
    expect(allumer.disabled).toBe(true);
    fireEvent.change(within(c).getByLabelText("common.motif"), {
      target: { value: "Rallumage après la production" },
    });
    fireEvent.click(allumer);
    await waitFor(() =>
      expect(appels.reglerFonction).toHaveBeenCalledWith(
        "notes_honoraires",
        true,
        "Rallumage après la production",
      ),
    );
  });

  it("allumée : propose d'éteindre, et nomme qui a décidé", async () => {
    const c = await carte({
      notes_honoraires: {
        ...LIVREE.notes_honoraires!,
        actif: true,
        decide_par_nom: "Wissem",
      },
    });
    expect(c.querySelector("[data-etat]")!.className).toContain("text-signal-ok");
    expect(c.querySelector("[data-par]")!.textContent).toContain("Wissem");
    expect(within(c).getByRole("button", { name: "tour.fonctions.eteindre" })).toBeTruthy();
  });
});
