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
  matricule: "1234567A/A/M/000" as string | null,
}));
const appels = vi.hoisted(() => ({
  creer: vi.fn(async (..._a: unknown[]) => "org-1"),
  inviter: vi.fn(async (..._a: unknown[]): Promise<unknown> => ({
    email: "",
    jeton: "j",
    lien: null,
  })),
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
  useNavigate: () => nav.aller,
  useSearch: () => ({ etape: etapeDeLaSuite.valeur }),
}));
vi.mock("@/components/malica/InvitationsPourMoi", () => ({ InvitationsPourMoi: () => null }));
vi.mock("@/components/malica/LanguageSwitcher", () => ({ LanguageSwitcher: () => null }));
vi.mock("@/components/malica/mon-espace-parti", () => ({ LienMonEspaceParti: () => null }));
vi.mock("@/components/malica/se-deconnecter", () => ({ SeDeconnecter: () => null }));
vi.mock("@/components/malica/pme-context", () => ({
  usePme: () => ({
    matricule: monde.matricule,
    orgName: "Atelier Samia",
    adresse: null,
    tenantId: "org-1",
    jurisdiction: "TN",
    forfait: { ligne: monde.forfait },
  }),
}));

const nav = vi.hoisted(() => ({ aller: vi.fn() }));
const saisie = vi.hoisted(() => ({ definir: vi.fn(async (..._a: unknown[]) => ({})) }));
const etapeDeLaSuite = vi.hoisted(() => ({ valeur: "forfait" as "forfait" | "comptabilite" }));

const vide = async () => [];
const depot = (m: Record<string, unknown>) => new Proxy(m, { get: (c, n: string) => c[n] ?? vide });
vi.mock("@/verticals/malica-office/composition", () => ({
  office: () =>
    new Proxy(
      {
        identity: depot({
          listMyOrganizations: async () => monde.orgs,
          createOrganization: appels.creer,
          inviterMaComptabilite: appels.inviter,
          definirOrganisation: saisie.definir,
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
import { Route as RouteSuite } from "@/routes/_authenticated/pme.suite";
import { cibleDeRetourDesReglages } from "@/lib/suite-de-l-arrivee";

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
  Object.assign(monde, {
    operateur: false,
    orgs: [],
    forfait: null,
    matricule: "1234567A/A/M/000",
  });
});

describe("4.1 — choisissez votre espace", () => {
  it("un compte neuf lit une phrase et un geste, sans bandeau technique", async () => {
    rendre(composant(RouteOffice));
    await screen.findByText("app.orgs.empty");
    expect(screen.getAllByText("app.orgs.create").length).toBeGreaterThan(0);
    expect(screen.queryByText("pack.banner.title")).toBeNull();
    expect(appels.pack).not.toHaveBeenCalled();
  });

  // 22 novembre 2026 : l'invitation de la comptabilité dès le premier écran — un compte
  // neuf, sans invitation reçue, entre directement dans la création de sa société.
  it("un compte neuf sans invitation entre directement dans la création de sa société", async () => {
    rendre(composant(RouteOffice));
    await waitFor(() =>
      expect(nav.aller).toHaveBeenCalledWith({ to: "/onboarding", replace: true }),
    );
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
    const nom = screen.getByText("onboarding.name").parentElement!.querySelector("input")!;
    fireEvent.change(nom, { target: { value: "Atelier Samia" } });
    const adresse = screen.getByText("onboarding.adresse").parentElement!.querySelector("input")!;
    fireEvent.change(adresse, { target: { value: "12 rue de Marseille, Tunis" } });
    fireEvent.click(screen.getByRole("button", { name: "onboarding.submit" }));
    await waitFor(() => expect(appels.creer).toHaveBeenCalled());
    const saisie = appels.creer.mock.calls[0]![0] as Record<string, unknown>;
    expect(saisie["adresse"]).toBe("12 rue de Marseille, Tunis");
    expect(saisie["defaultEntityName"]).toBeUndefined();
  });
});

describe("l'invitation de la comptabilité dès la création (22 novembre 2026)", () => {
  const champ = (cle: string) => screen.getByText(cle).parentElement!.querySelector("input")!;
  const remplir = async (email: string) => {
    rendre(composant(RouteOnboarding));
    await screen.findByText(/onboarding\.jurisdiction\.option/);
    fireEvent.change(champ("onboarding.name"), { target: { value: "Atelier Samia" } });
    fireEvent.change(champ("onboarding.comptabilite"), { target: { value: email } });
  };

  it("l'e-mail donné invite la comptabilité de la société créée", async () => {
    await remplir("cabinet@exemple.tn");
    fireEvent.click(screen.getByRole("button", { name: "onboarding.submit" }));
    await waitFor(() => expect(nav.aller).toHaveBeenCalled());
    expect(appels.inviter).toHaveBeenCalledWith("org-1", "cabinet@exemple.tn");
  });

  it("sans e-mail, rien ne part", async () => {
    await remplir("");
    fireEvent.click(screen.getByRole("button", { name: "onboarding.submit" }));
    await waitFor(() => expect(nav.aller).toHaveBeenCalled());
    expect(appels.inviter).not.toHaveBeenCalled();
  });

  it("une invitation refusée ne crée pas une seconde société au renvoi", async () => {
    appels.inviter.mockRejectedValueOnce(new Error("refus"));
    await remplir("cabinet@exemple.tn");
    fireEvent.click(screen.getByRole("button", { name: "onboarding.submit" }));
    const renvoyer = await screen.findByRole("button", {
      name: "onboarding.comptabilite.reessayer",
    });
    expect(nav.aller).not.toHaveBeenCalled();
    fireEvent.click(renvoyer);
    await waitFor(() => expect(nav.aller).toHaveBeenCalled());
    expect(appels.creer).toHaveBeenCalledTimes(1);
    expect(appels.inviter).toHaveBeenCalledTimes(2);
  });

  it("une comptabilité qui s'inscrit ne voit pas le champ", async () => {
    rendre(composant(RouteOnboarding));
    await screen.findByText(/onboarding\.jurisdiction\.option/);
    fireEvent.click(screen.getByRole("button", { name: "onboarding.kind.cabinet" }));
    expect(screen.queryByText("onboarding.comptabilite")).toBeNull();
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

describe("le matricule fiscal : l'écran ne dit « voici » que ce qu'il montre", () => {
  // Recette du 14 novembre 2026, point 3 : « Voici votre matricule fiscal » au-dessus d'un « — ».
  it("un matricule lu s'annonce comme tel", () => {
    rendre(composant(RouteBienvenue));
    expect(screen.getByText("pme.bienvenue.ditTitre")).toBeTruthy();
    expect(screen.queryByText("pme.bienvenue.ditSansMatricule")).toBeNull();
  });

  it("sans matricule, l'écran ne prétend pas en montrer un", () => {
    monde.matricule = null;
    rendre(composant(RouteBienvenue));
    expect(screen.queryByText("pme.bienvenue.ditTitre")).toBeNull();
    expect(screen.getByText("pme.bienvenue.ditSansMatricule")).toBeTruthy();
  });
});

describe("C1 — « C'est exact » mène au forfait, puis à la comptabilité", () => {
  // Recette du 14 novembre 2026 : « C'est exact — commencer » ouvrait « Ajouter des pièces ».
  it("qui promet la suite va d'abord au forfait et à la comptabilité", () => {
    monde.forfait = { titulaire: true, pris_en_charge_par: null };
    rendre(composant(RouteBienvenue));
    fireEvent.click(screen.getByRole("button", { name: "pme.bienvenue.exact" }));
    expect(nav.aller).toHaveBeenCalledWith({ to: "/pme/suite" });
  });

  it("les autres entrent directement par « Ajouter des pièces »", () => {
    monde.forfait = { titulaire: false, pris_en_charge_par: null };
    rendre(composant(RouteBienvenue));
    fireEvent.click(screen.getByRole("button", { name: "pme.bienvenue.exact" }));
    expect(nav.aller).toHaveBeenCalledWith({ to: "/pme/capturer" });
  });

  it("la suite montre le forfait, puis la comptabilité ou « sans comptabilité »", () => {
    etapeDeLaSuite.valeur = "forfait";
    rendre(composant(RouteSuite));
    expect(screen.getByText("pme.suite.forfait.voir")).toBeTruthy();
    expect(screen.queryByText("pme.suite.compta.sans")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "pme.suite.continuer" }));
    expect(nav.aller).toHaveBeenCalledWith({ to: "/pme/suite", search: { etape: "comptabilite" } });
  });

  it("à l'étape comptabilité : inviter, ou continuer sans comptabilité", () => {
    etapeDeLaSuite.valeur = "comptabilite";
    rendre(composant(RouteSuite));
    expect(screen.getByText("pme.suite.compta.inviter")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^pme\.suite\.compta\.sans/ }));
    expect(nav.aller).toHaveBeenCalledWith({ to: "/pme/capturer" });
    etapeDeLaSuite.valeur = "forfait";
  });
});

describe("le matricule se saisit une fois, et se confirme avec « C'est exact »", () => {
  it("sans matricule, « C'est exact » l'enregistre dans la société, puis entre", async () => {
    monde.matricule = null;
    monde.forfait = { titulaire: false, pris_en_charge_par: null };
    rendre(composant(RouteBienvenue));
    fireEvent.change(screen.getByLabelText(/pme\.bienvenue\.matricule\.saisir/), {
      target: { value: "1234567A/A/M/000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "pme.bienvenue.exact" }));
    await waitFor(() => expect(nav.aller).toHaveBeenCalledWith({ to: "/pme/capturer" }));
    expect(saisie.definir.mock.calls[0]![0]).toMatchObject({
      tenantId: "org-1",
      name: "Atelier Samia",
      legalId: "1234567A/A/M/000",
      jurisdiction: "TN",
    });
  });

  it("si l'enregistrement échoue, l'écran reste et le dit : rien n'est marqué vu", async () => {
    monde.matricule = null;
    saisie.definir.mockRejectedValueOnce(new Error("refus.identifiant.invalide"));
    rendre(composant(RouteBienvenue));
    fireEvent.change(screen.getByLabelText(/pme\.bienvenue\.matricule\.saisir/), {
      target: { value: "PAS-VALIDE" },
    });
    fireEvent.click(screen.getByRole("button", { name: "pme.bienvenue.exact" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(nav.aller).not.toHaveBeenCalled();
  });
});
