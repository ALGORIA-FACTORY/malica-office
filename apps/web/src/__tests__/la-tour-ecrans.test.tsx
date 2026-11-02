// @vitest-environment jsdom
/**
 * Les écrans de la tour (2 novembre 2026) : la garde, la liste des cabinets,
 * la liste des PME et sa fiche « Gérer », et l'entrée « La tour » de Mon
 * espace — montrée aux seuls opérateurs.
 *
 * Données d'essai fictives. Le routeur est remplacé par un double minimal :
 * l'adresse (`search`, `params`) se règle par épreuve, et `navigate` est espionné.
 */
import type { CabinetDeLaTour, PmeDeLaTour } from "@malica/socle/ports/repositories";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const adresse = vi.hoisted(() => ({
  search: {} as Record<string, unknown>,
  params: {} as Record<string, string>,
  path: "/tour/cabinets",
  navigate: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { component: ComponentType }) => ({
    options,
    useSearch: () => adresse.search,
    useParams: () => adresse.params,
    useNavigate: () => adresse.navigate,
  }),
  Link: ({
    children,
    to,
    className,
    ...reste
  }: {
    children: ReactNode;
    to: string;
    className?: string;
    params?: Record<string, string>;
  }) => (
    <a
      href={to}
      className={className}
      data-lien={to}
      {...{ "aria-current": reste["aria-current" as never] }}
    >
      {children}
    </a>
  ),
  Outlet: () => <div data-outlet />,
  redirect: (o: unknown) => o,
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: adresse.path } }),
}));

vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (cle: string, v?: Record<string, unknown>) => (v ? `${cle} ${JSON.stringify(v)}` : cle),
    locale: "fr",
    dir: "ltr",
  }),
}));
vi.mock("@/components/malica/LanguageSwitcher", () => ({ LanguageSwitcher: () => null }));
vi.mock("@/components/malica/mon-espace-parti", () => ({ MonEspaceParti: () => null }));

const cabinet = (
  id: string,
  nom: string,
  etat: CabinetDeLaTour["etat"] = null,
): CabinetDeLaTour => ({
  id,
  nom,
  matricule: null,
  juridiction: "TN",
  devise: "TND",
  etat,
  reste_du: etat === "en_retard" ? "240.000" : "0",
  devise_du: etat === "en_retard" ? "TND" : null,
  echeance_le: null,
});

const pme = (id: string, nom: string, reste: Partial<PmeDeLaTour> = {}): PmeDeLaTour => ({
  id,
  nom,
  matricule: `MF-${id}`,
  devise: "TND",
  cabinet_id: null,
  cabinet_nom: null,
  paye_par_cabinet: false,
  licence_id: `lic-${id}`,
  offre_code: "solo",
  offre_libelle: "Solo",
  statut: "active",
  lectures_consommees: 10,
  lectures_droit: 100,
  documents: 12,
  transmis_mois: 3,
  dernier_depot_le: "2026-11-01 09:00:00+00",
  etat: "payee",
  reste_du: "0",
  devise_du: null,
  echeance_le: null,
  ...reste,
});

const donnees = vi.hoisted(() => ({
  plateforme: true,
  clients: { cabinets: [] as CabinetDeLaTour[], pme: [] as PmeDeLaTour[] },
}));
const gestes = vi.hoisted(() => ({
  suspendre: vi.fn(async () => ({})),
  reprendre: vi.fn(async () => ({})),
  accorderLectures: vi.fn(async () => ({})),
}));

vi.mock("@/verticals/malica-office/composition", () => ({
  office: () => ({
    tour: {
      suisJePlateforme: async () => {
        if (!donnees.plateforme) throw Object.assign(new Error("refus"), { code: "42501" });
        return true;
      },
      clients: async () => donnees.clients,
      interventions: async () => [],
      ...gestes,
    },
    identity: { listMyOrganizations: async () => [{ id: "org-1", kind: "pme", name: "PME" }] },
    acces: {
      monAcces: async () => ({ role: "dirigeant", plateforme: donnees.plateforme, droits: [] }),
    },
  }),
}));

import { Route as Coquille } from "../routes/_authenticated/tour";
import { Route as Cabinets } from "../routes/_authenticated/tour.cabinets.index";
import { Route as Pme } from "../routes/_authenticated/tour.pme";
import { Route as MonEspace } from "../routes/_authenticated/mon-espace";

const ecran = (r: unknown) => (r as { options: { component: ComponentType } }).options.component;

function monter(Ecran: ComponentType) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Ecran />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  donnees.plateforme = true;
  donnees.clients = { cabinets: [], pme: [] };
  adresse.search = {};
  adresse.params = {};
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("la garde de la tour", () => {
  it("un opérateur voit le menu de la tour", async () => {
    monter(ecran(Coquille));
    const menu = (await screen.findAllByRole("navigation"))[0]!;
    expect(within(menu).getByText("tour.menu.cabinets")).toBeTruthy();
    expect(within(menu).getByText("tour.menu.compte")).toBeTruthy();
  });

  it("un autre compte lit que la tour est réservée, et rien d'autre", async () => {
    donnees.plateforme = false;
    monter(ecran(Coquille));
    expect(await screen.findByText("tour.reserve")).toBeTruthy();
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(document.querySelector("[data-outlet]")).toBeNull();
  });
});

describe("Mon espace ne montre la tour qu'aux opérateurs", () => {
  it("opérateur : l'entrée est là", async () => {
    monter(ecran(MonEspace));
    expect(await screen.findByText("tour.titre")).toBeTruthy();
  });

  it("autre compte : aucune entrée", async () => {
    donnees.plateforme = false;
    monter(ecran(MonEspace));
    await waitFor(() => expect(document.querySelector("[data-lien-tour]")).toBeNull());
    await new Promise((r) => setTimeout(r, 30));
    expect(document.querySelector("[data-lien-tour]")).toBeNull();
  });
});

describe("Tour › Cabinets", () => {
  it("dit ce qui apparaîtra quand il n'y a aucun cabinet", async () => {
    monter(ecran(Cabinets));
    expect(await screen.findByText("tour.cabinets.vide.titre")).toBeTruthy();
  });

  it("liste chaque cabinet avec les offres de ses PME, ses comptes et son état", async () => {
    donnees.clients = {
      cabinets: [cabinet("c1", "Cabinet Atlas", "en_retard"), cabinet("c2", "Cabinet Béja")],
      pme: [
        pme("p1", "Alpha", {
          cabinet_id: "c1",
          cabinet_nom: "Cabinet Atlas",
          offre_libelle: "Team",
          offre_code: "team",
        }),
        pme("p2", "Bravo", {
          cabinet_id: "c1",
          cabinet_nom: "Cabinet Atlas",
          offre_libelle: "Team",
          offre_code: "team",
        }),
        pme("p3", "Charlie", {
          cabinet_id: "c1",
          cabinet_nom: "Cabinet Atlas",
          statut: "suspendue",
        }),
        pme("p4", "Delta"),
      ],
    };
    monter(ecran(Cabinets));
    const ligne = (await screen.findByText("Cabinet Atlas")).closest(
      "[data-cabinet]",
    ) as HTMLElement;
    expect(ligne.textContent).toContain("Team ×2 · Solo ×1");
    expect(ligne.querySelector('[data-etat="impaye"]')).toBeTruthy();
    const pmeKpi = document.querySelector('[data-chiffre="pme"]')!;
    expect(pmeKpi.textContent).toContain("3");
    const impayes = document.querySelector('[data-chiffre="impayes"]')!;
    expect(impayes.textContent).toContain("1");
    // La recherche ignore la casse et les accents.
    fireEvent.change(screen.getByLabelText("tour.chercher.cabinet"), { target: { value: "beja" } });
    expect(screen.queryByText("Cabinet Atlas")).toBeNull();
    expect(screen.getByText("Cabinet Béja")).toBeTruthy();
  });
});

describe("Tour › PME et leurs abonnements", () => {
  beforeEach(() => {
    donnees.clients = {
      cabinets: [cabinet("c1", "Cabinet Atlas")],
      pme: [
        pme("p1", "Alpha", { cabinet_id: "c1", cabinet_nom: "Cabinet Atlas" }),
        pme("p2", "Bravo", { etat: "en_retard", reste_du: "120.000", echeance_le: "2026-10-28" }),
        pme("p3", "Charlie", { lectures_consommees: 100 }),
        pme("p4", "Delta", { statut: "suspendue" }),
      ],
    };
  });

  it("dit ce qui apparaîtra quand aucune PME n'est inscrite", async () => {
    donnees.clients = { cabinets: [], pme: [] };
    monter(ecran(Pme));
    expect(await screen.findByText("tour.pme.vide.titre")).toBeTruthy();
  });

  it("compte chaque filtre, avec ou sans cabinet", async () => {
    monter(ecran(Pme));
    await screen.findByText("Alpha");
    const compte = (cle: string) =>
      document.querySelector(`[data-chiffre="${cle}"] dd`)!.textContent;
    expect(compte("tous")).toBe("4");
    expect(compte("sans_cabinet")).toBe("3");
    expect(compte("impayes")).toBe("1");
    expect(compte("au_quota")).toBe("1");
    expect(compte("suspendus")).toBe("1");
  });

  it("le filtre de l'adresse s'applique, et un filtre sans résultat le dit", async () => {
    adresse.search = { filtre: "impayes" };
    monter(ecran(Pme));
    expect(await screen.findByText("Bravo")).toBeTruthy();
    expect(screen.queryByText("Alpha")).toBeNull();
    fireEvent.change(screen.getByLabelText("tour.chercher.pme"), { target: { value: "zzz" } });
    expect(screen.getByText("tour.filtre.rien.titre")).toBeTruthy();
  });

  it("une ligne ouvre « Gérer » par l'adresse", async () => {
    monter(ecran(Pme));
    fireEvent.click(await screen.findByText("Bravo"));
    expect(adresse.navigate).toHaveBeenCalledTimes(1);
    const { search } = adresse.navigate.mock.calls[0]![0] as {
      search: (s: Record<string, unknown>) => Record<string, unknown>;
    };
    expect(search({})).toEqual({ pme: "p2" });
  });

  it("« Gérer » ne propose que les gestes que la base porte, et exige un motif", async () => {
    adresse.search = { pme: "p2" };
    monter(ecran(Pme));
    const fiche = within(await screen.findByRole("dialog"));
    const radios = fiche.getAllByRole("radio").map((r) => r.textContent);
    expect(radios).toEqual(["tour.geste.suspendre", "tour.geste.lectures"]);
    // Aucun faux bouton : ces gestes viennent avec le moteur commercial.
    for (const absent of [/offre/i, /remise/i, /essai/i, /rattacher/i, /mois offert/i])
      expect(fiche.queryByRole("button", { name: absent })).toBeNull();

    const confirmer = fiche.getByRole("button", { name: "tour.geste.suspendre.confirmer" });
    expect((confirmer as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(fiche.getByLabelText("common.motif"), {
      target: { value: "Impayé de deux mois" },
    });
    fireEvent.click(confirmer);
    await waitFor(() =>
      expect(gestes.suspendre).toHaveBeenCalledWith("lic-p2", "Impayé de deux mois"),
    );
  });

  it("une licence suspendue se reprend ; des lectures s'accordent pour un mois", async () => {
    adresse.search = { pme: "p4" };
    monter(ecran(Pme));
    const fiche = within(await screen.findByRole("dialog"));
    expect(fiche.getAllByRole("radio").map((r) => r.textContent)).toEqual([
      "tour.geste.reprendre",
      "tour.geste.lectures",
    ]);
    fireEvent.click(fiche.getByRole("radio", { name: "tour.geste.lectures" }));
    fireEvent.change(fiche.getByLabelText("tour.geste.nombre"), { target: { value: "50" } });
    fireEvent.change(fiche.getByLabelText("tour.geste.mois"), { target: { value: "2026-11" } });
    fireEvent.change(fiche.getByLabelText("common.motif"), { target: { value: "Rattrapage" } });
    fireEvent.click(fiche.getByRole("button", { name: "tour.geste.lectures.confirmer" }));
    await waitFor(() =>
      expect(gestes.accorderLectures).toHaveBeenCalledWith("lic-p4", 50, "2026-11", "Rattrapage"),
    );
  });
});
