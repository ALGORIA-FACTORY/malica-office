// @vitest-environment jsdom
/** La bibliothèque du cabinet : mois › types tirés du référentiel › pièces, date de classement. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocumentComptable } from "@malica/socle/ports/repositories";

/** L'adresse du niveau ouvert : chaque épreuve la pose. */
let niveau: Record<string, string> = {};

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { component: ComponentType }) => ({
    options,
    useSearch: () => niveau,
    useNavigate: () => vi.fn(),
  }),
  Link: ({
    children,
    to,
    search,
    className,
  }: {
    children: ReactNode;
    to: string;
    search?: object;
    className?: string;
  }) => (
    <a
      className={className}
      href={search ? `${to}?${new URLSearchParams(search as Record<string, string>)}` : to}
    >
      {children}
    </a>
  ),
}));
vi.mock("@/i18n", () => ({
  useI18n: () => ({ t: (cle: string) => cle, locale: "fr", dir: "ltr" }),
}));
vi.mock("@/components/malica/cabinet-context", () => ({
  useCabinet: () => ({ org: { id: "cabinet", name: "Cabinet" } }),
}));
vi.mock("@/components/malica/telecharger-dossier-comptable", () => ({
  TelechargerDossierComptable: () => null,
}));

const unDocument = (
  id: string,
  type: string | null,
  reference: string,
  date = "2026-01-31",
): DocumentComptable => ({
  id,
  tenantId: "client",
  type,
  status: "lue",
  reference,
  tiers: null,
  dateDocument: null,
  dateDeClassement: date,
  recuLe: "2026-01-31 23:30:00+00",
  empreinte: null,
  montant: null,
  devise: "TND",
  sourcePieceId: null,
});

const dossier = [
  unDocument("f", "facture_achat", "F-1"),
  unDocument("a", "avoir", "AV-1"),
  unDocument("x", null, "X-1"),
  unDocument("m", "facture_vente", "M-1", "2025-10-02"),
];
/** La borne de l'API : au-delà, la bibliothèque ne charge que le mois ouvert. */
let plafond = 2000;
const appels: Array<string | null> = [];

vi.mock("@/verticals/malica-office/composition", () => ({
  office: () => ({
    supervision: {
      listClients: async () => [
        { tenantId: "client", name: "Client", engagementStatus: "actif", legalId: null },
      ],
      documents: async (_c: string, _t: string, periode: string | null) => {
        appels.push(periode);
        return dossier.filter((d) => !periode || d.dateDeClassement.startsWith(periode));
      },
      moisDuDossier: async () => ({
        plafond,
        mois: dossier.map((d) => ({ mois: d.dateDeClassement.slice(0, 7), type: d.type, n: 1 })),
      }),
    },
    referential: {
      typesDeDocument: async () => [
        { code: "facture_achat", libelle: "Facture d'achat", transmissible: true },
        { code: "avoir", libelle: "Avoir", transmissible: true },
        { code: "facture_vente", libelle: "Facture de vente", transmissible: true },
        { code: "releve", libelle: "Relevé bancaire", transmissible: true },
      ],
    },
  }),
}));

import { Route } from "../routes/_authenticated/cabinet.bibliotheque";

const Ecran = (Route as unknown as { options: { component: ComponentType } }).options.component;

afterEach(cleanup);

const ouvrir = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Ecran />
    </QueryClientProvider>,
  );
const titres = () =>
  [...document.querySelectorAll(".cab-doclib-carte-lien")].map((a) => a.textContent);

describe("bibliothèque du cabinet", () => {
  it("range le dossier par mois, du plus récent, les mois vides regroupés", async () => {
    niveau = {};
    ouvrir();
    await screen.findByText("Janvier 2026");
    expect(titres()).toEqual(["Janvier 2026", "Octobre 2025"]);
    expect(screen.getByText("cab.biblio.trou")).toBeTruthy();
  });

  it("dans un mois, tire ses cartes du référentiel, pour les seuls types présents", async () => {
    niveau = { client: "client", mois: "2026-01" };
    ouvrir();
    await screen.findByText("Avoir");
    // Un avoir n'est plus rangé dans « autres » faute d'un code écrit à la main.
    expect(titres()).toEqual(["Facture d'achat", "Avoir", "cab.biblio.autres"]);
    // Absent : un type que ce client transmet d'habitude, pas tout le référentiel.
    expect(
      [...document.querySelectorAll(".cab-doclib-etiquette")].map((e) => e.textContent),
    ).toEqual(["Facture de vente"]);
  });

  it("dans un type, liste ses pièces et rien d'autre", async () => {
    niveau = { client: "client", mois: "2026-01", type: "avoir" };
    ouvrir();
    expect(await screen.findByText("AV-1")).toBeTruthy();
    expect(screen.queryByText("F-1")).toBeNull();
    cleanup();
    niveau = { client: "client", mois: "2026-01", type: "_autres" };
    ouvrir();
    expect(await screen.findByText("X-1")).toBeTruthy();
    expect(screen.queryByText("AV-1")).toBeNull();
  });

  it("date chaque document de sa date de classement, telle que l'API l'a établie", async () => {
    niveau = {};
    ouvrir();
    // Une recherche ouvre la liste à plat, sur tout le dossier.
    fireEvent.change(await screen.findByRole("textbox", { name: "cab.biblio.search" }), {
      target: { value: "-1" },
    });
    expect((await screen.findAllByText(/31\/01\/2026/)).length).toBe(3);
  });

  it("un dossier trop grand s'ouvre sur ses mois, et ne charge que le mois ouvert", async () => {
    plafond = 3;
    appels.length = 0;
    niveau = {};
    ouvrir();
    await screen.findByText("Janvier 2026");
    expect(screen.getByText("cab.biblio.volumineux")).toBeTruthy();
    expect(appels).toEqual([]);
    cleanup();
    niveau = { client: "client", mois: "2026-01" };
    ouvrir();
    await screen.findByText("Avoir");
    expect(appels).toEqual(["2026-01"]);
    plafond = 2000;
  });
});
