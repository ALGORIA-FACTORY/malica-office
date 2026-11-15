// @vitest-environment jsdom
/**
 * L'arrivée parle simplement (recette du 11 novembre 2026, lot 4).
 *
 *   4.1  « Choisissez votre espace » : pas de bandeau « Référentiel non
 *        ratifié » ni de fiche technique (rôle, validation, juridiction,
 *        devise) pour une personne qui n'est pas opératrice ; un compte neuf
 *        lit UNE phrase et un geste. Le pays et la monnaie se disent en mots.
 *   4.2  L'adresse tapée à la création devient l'adresse du siège, pas le nom
 *        de l'établissement.
 *   4.3  La bienvenue ne promet le forfait et l'invitation de la comptabilité
 *        qu'au propriétaire principal d'une société qui paie seule.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const monde = vi.hoisted(() => ({
  operateur: false,
  orgs: [] as unknown[],
  forfait: null as null | { titulaire: boolean; pris_en_charge_par: string | null },
}));
const appels = vi.hoisted(() => ({
  creer: vi.fn(async (..._a: unknown[]) => "org-1"),
  pack: vi.fn(async () => ({
    ratified: false,
    jurisdiction: "TN",
    version: "1",
    effectiveFrom: "",
  })),
}));

vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (cle: string, v?: Record<string, unknown>) => (v ? `${cle} ${JSON.stringify(v)}` : cle),
    locale: "fr",
  }),
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options, useSearch: () => ({}) }),
  Link: ({ children, to }: { children?: ReactNode; to?: string }) => <a href={to}>{children}</a>,
  useNavigate: () => vi.fn(),
}));
vi.mock("@/components/malica/InvitationsPourMoi", () => ({ InvitationsPourMoi: () => null }));
vi.mock("@/components/malica/LanguageSwitcher", () => ({ LanguageSwitcher: () => null }));
vi.mock("@/components/malica/mon-espace-parti", () => ({ LienMonEspaceParti: () => null }));
vi.mock("@/components/malica/se-deconnecter", () => ({ SeDeconnecter: () => null }));
vi.mock("@/components/malica/pme-context", () => ({
  usePme: () => ({
    matricule: "1234567A/A/M/000",
    orgName: "Atelier Samia",
    adresse: null,
    forfait: { ligne: monde.forfait },
  }),
}));

const vide = async () => [];
const depot = (m: Record<string, unknown>) => new Proxy(m, { get: (c, n: string) => c[n] ?? vide });
vi.mock("@/verticals/malica-office/composition", () => ({
  office: () =>
    new Proxy(
      {
        identity: depot({
          listMyOrganizations: async () => monde.orgs,
          createOrganization: appels.creer,
        }),
        tour: depot({ suisJePlateforme: async () => monde.operateur }),
        referential: depot({
          activePack: appels.pack,
          juridictions: async () => [{ jurisdiction: "TN", currency: "TND" }],
        }),
      } as Record<string, unknown>,
      { get: (c, n: string) => c[n] ?? depot({}) },
    ),
}));

import { Route as RouteBienvenue } from "@/routes/_authenticated/pme.bienvenue";
import { Route as RouteOffice } from "@/routes/_authenticated/office";
import { Route as RouteOnboarding } from "@/routes/_authenticated/onboarding";

const composant = (route: unknown) =>
  (route as { options: { component: () => ReactNode } }).options.component;

function rendre(Page: () => ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Page />
    </QueryClientProvider>,
  );
}

const SOCIETE = {
  id: "pme-1",
  name: "Atelier Samia",
  kind: "pme",
  legalId: null,
  jurisdiction: "TN",
  currency: "TND",
  validationMode: "mandate",
  role: "dirigeant",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  Object.assign(monde, { operateur: false, orgs: [], forfait: null });
});

describe("4.1 — choisissez votre espace", () => {
  it("un compte neuf lit une phrase et un geste, sans bandeau technique", async () => {
    rendre(composant(RouteOffice));
    await screen.findByText("app.orgs.empty");
    expect(screen.getAllByText("app.orgs.create").length).toBeGreaterThan(0);
    expect(screen.queryByText("pack.banner.title")).toBeNull();
    expect(appels.pack).not.toHaveBeenCalled();
  });

  it("une dirigeante ne voit ni rôle, ni mode de validation, ni juridiction", async () => {
    monde.orgs = [SOCIETE];
    rendre(composant(RouteOffice));
    await screen.findByText("landing.surfaces.pme.title");
    expect(screen.queryByText("app.mode")).toBeNull();
    expect(screen.queryByText("app.jurisdiction")).toBeNull();
    expect(screen.queryByText("mandate")).toBeNull();
  });

  it("un opérateur garde le bandeau du référentiel et le détail", async () => {
    monde.operateur = true;
    monde.orgs = [SOCIETE];
    rendre(composant(RouteOffice));
    await screen.findByText("pack.banner.title");
    expect(await screen.findByText("app.mode")).toBeTruthy();
  });

  it("à la création, le pays et la monnaie se disent en mots", async () => {
    rendre(composant(RouteOnboarding));
    const option = await screen.findByText(/onboarding\.jurisdiction\.option/);
    expect(option.textContent).toContain("Tunisie");
    expect(option.textContent).toContain("dinar tunisien");
    expect(screen.queryByText("TN — TND")).toBeNull();
  });
});

describe("4.2 — l'adresse du siège", () => {
  it("l'adresse tapée part comme adresse du siège, pas comme nom d'établissement", async () => {
    rendre(composant(RouteOnboarding));
    await screen.findByText(/onboarding\.jurisdiction\.option/);
    const champs = screen.getAllByRole("textbox") as HTMLInputElement[];
    fireEvent.change(champs[0]!, { target: { value: "Atelier Samia" } });
    const adresse = screen.getByText("onboarding.adresse").parentElement!.querySelector("input")!;
    fireEvent.change(adresse, { target: { value: "12 rue de Marseille, Tunis" } });
    fireEvent.click(screen.getByRole("button", { name: "onboarding.submit" }));
    await waitFor(() => expect(appels.creer).toHaveBeenCalled());
    const saisie = appels.creer.mock.calls[0]![0] as Record<string, unknown>;
    expect(saisie["adresse"]).toBe("12 rue de Marseille, Tunis");
    expect(saisie["defaultEntityName"]).toBeUndefined();
  });
});

describe("4.3 — la bienvenue ne promet que ce qu'on peut faire", () => {
  it("au propriétaire principal qui paie seul : la suite est promise", () => {
    monde.forfait = { titulaire: true, pris_en_charge_par: null };
    rendre(composant(RouteBienvenue));
    expect(screen.getByText("pme.bienvenue.pied")).toBeTruthy();
  });

  it("à un dirigeant dont la comptabilité a choisi l'abonnement : rien n'est promis", () => {
    monde.forfait = { titulaire: true, pris_en_charge_par: "Compta Trabelsi" };
    rendre(composant(RouteBienvenue));
    expect(screen.queryByText("pme.bienvenue.pied")).toBeNull();
  });

  it("à un co-propriétaire : rien n'est promis", () => {
    monde.forfait = { titulaire: false, pris_en_charge_par: null };
    rendre(composant(RouteBienvenue));
    expect(screen.queryByText("pme.bienvenue.pied")).toBeNull();
  });
});
