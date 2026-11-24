// @vitest-environment jsdom
/**
 * La Bibliothèque au bureau : un tableau par mois, ses totaux, ses filtres, sa sélection.
 *
 * Garantit que le montant d'une pièce est son net à payer, avec le TTC et la retenue à
 * côté quand une retenue est tranchée — la règle de la fiche ; qu'aucune colonne HT ni
 * TVA n'est inventée, la liste ne les portant pas ; que chaque mois porte son total et
 * le tableau le total général ; que « Avec retenue » et les puces de dossier filtrent ;
 * et qu'imprimer ou exporter porte la sélection quand il y en a une, sinon tout ce que
 * les filtres montrent. Sous 1024 px, le tableau n'est pas rendu.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PieceLue } from "@malica/socle/ports/repositories";

vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (cle: string, valeurs?: Record<string, unknown>) =>
      valeurs ? `${cle} ${JSON.stringify(valeurs)}` : cle,
    locale: "fr",
    dir: "ltr",
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { component: ComponentType }) => ({ options }),
  Link: ({ children, className }: { children: ReactNode; className?: string }) => (
    <a className={className}>{children}</a>
  ),
  useNavigate: () => vi.fn(),
}));

let bureau = true;
vi.mock("@/hooks/use-bureau", () => ({ useBureau: () => bureau }));

const PIECES: PieceLue[] = [
  {
    id: "honoraires",
    status: "lue",
    createdAt: "2026-07-03T09:00:00Z",
    auteurId: null,
    vis: "entite",
    emetteur: "MANAGEMENT & AUDIT PARTNERS",
    dateDocument: "2026-07-02",
    kind: "facture_achat",
    typeDeDocument: "facture_achat",
    total: "462.720",
    retenue: { montant: "14.280", totalTtc: "477.000" },
    devise: "TND",
    decimales: 3,
  } as PieceLue,
  {
    id: "loyer",
    status: "lue",
    createdAt: "2026-06-03T09:00:00Z",
    auteurId: null,
    vis: "entite",
    emetteur: "PHOENIX NETWORK INVEST SARL",
    dateDocument: "2026-06-01",
    kind: "facture_achat",
    typeDeDocument: "facture_achat",
    total: "179.500",
    retenue: null,
    devise: "TND",
    decimales: 3,
  } as PieceLue,
  {
    id: "vente",
    status: "lue",
    createdAt: "2026-06-10T09:00:00Z",
    auteurId: null,
    vis: "entite",
    emetteur: "CLIENT SA",
    dateDocument: "2026-06-09",
    kind: "facture_vente",
    typeDeDocument: "facture_vente",
    total: "300.000",
    retenue: null,
    devise: "TND",
    decimales: 3,
  } as PieceLue,
];

vi.mock("@/components/malica/pme-context", () => ({
  usePme: () => ({
    tenantId: "societe",
    societeAffichee: null,
    dossiers: [{ id: "societe", name: "Société" }],
    orgName: "Société",
    forfait: { ligne: null, ouvertures: { sieges: false } },
    choisirDossier: vi.fn(),
  }),
}));
vi.mock("@/hooks/use-pieces-lues", () => ({
  usePiecesLues: () => ({ data: PIECES }),
  clePiecesLues: () => ["pieces-lues"],
}));
vi.mock("@/hooks/use-pieces-des-societes", () => ({
  usePiecesDesSocietes: () => ({
    toutes: PIECES.map((piece) => ({ piece, societe: "societe" })),
    parSociete: false,
    parSiege: false,
    chargement: false,
    nomDeSociete: () => "Société",
    parSieges: () => new Map(),
    ouvrirSaSociete: vi.fn(),
  }),
}));
const DOSSIERS = [
  { code: "achats", libelle: "Achats", teinte: "achats", periode: "mois" },
  { code: "ventes", libelle: "Ventes", teinte: "ventes", periode: "mois" },
];
vi.mock("@/hooks/use-dossiers", () => ({
  useDossiers: () => ({
    dossiers: DOSSIERS,
    types: [
      { code: "facture_achat", dossier: "achats", dossierSiVente: null },
      { code: "facture_vente", dossier: "ventes", dossierSiVente: null },
    ],
    pret: true,
    parCode: (code: string | null) => DOSSIERS.find((d) => d.code === code) ?? null,
  }),
}));
vi.mock("@/hooks/use-mon-cabinet", () => ({ useMonCabinet: () => ({ data: null }) }));
vi.mock("@/hooks/use-destination-de-l-envoi", () => ({
  useDestinationDeLEnvoi: () => ({ destination: null, quiPour: () => "" }),
}));
vi.mock("@/hooks/use-gestes-du-circuit", () => ({
  useEnvoyerEnLot: () => ({ reste: () => false, mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/use-photos-de-profil", () => ({ usePhotosDeProfil: () => ({}) }));
vi.mock("@/hooks/use-revenir", () => ({ useRevenir: () => vi.fn() }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({}) }));
vi.mock("@/components/malica/apercu-de-piece", () => ({ ApercuDePiece: () => null }));
vi.mock("@/components/malica/file-locale", () => ({ FileLocale: () => null }));
vi.mock("@/components/malica/lecture-la-plus-basse", () => ({ LectureLaPlusBasse: () => null }));
vi.mock("@/components/malica/rail-des-dossiers", () => ({
  RailDesDossiers: () => <p>rail</p>,
}));
/* Imprimer et exporter : on lit seulement ce qu'ils recevraient. */
vi.mock("@/components/malica/imprimer-les-pieces", () => ({
  ImprimerDepuisLaPme: ({ pieces, libelle }: { pieces: string[]; libelle: string }) => (
    <button type="button" data-lot={pieces.join(",")}>
      {libelle}
    </button>
  ),
}));
vi.mock("@/components/malica/exporter-depuis-la-pme", () => ({
  ExporterDepuisLaPme: ({ pieces, libelle }: { pieces: string[]; libelle: string }) => (
    <button type="button" data-lot={pieces.join(",")}>
      {libelle}
    </button>
  ),
}));

const { Route } = await import("@/routes/_authenticated/pme.list");
const Bibliotheque = (Route as unknown as { options: { component: ComponentType } }).options
  .component;

/** Les lignes de pièces du tableau, par nom d'émetteur. */
const lignes = () =>
  screen
    .getAllByRole("row")
    .filter((r) => r.querySelector(".b-piece"))
    .map((r) => r.querySelector(".nm")?.textContent);

beforeEach(() => {
  bureau = true;
});
afterEach(cleanup);

describe("la Bibliothèque au bureau", () => {
  it("dit le net à payer, et le TTC et la retenue à côté — sans HT ni TVA inventés", () => {
    render(<Bibliotheque />);
    const entetes = within(document.querySelector("thead") as HTMLElement)
      .getAllByRole("columnheader")
      .map((th) => th.textContent);
    expect(entetes).toEqual([
      "",
      "pme.piece.title",
      "pme.extract.date",
      "pme.extract.ttc",
      "pme.extract.retenue",
      "pme.extract.netAPayer",
    ]);
    const ligne = screen.getByText("MANAGEMENT & AUDIT PARTNERS").closest("tr")!;
    const cellules = [...ligne.querySelectorAll("td.nb")].map((td) => td.textContent);
    expect(cellules).toEqual(["477,000", "−14,280", "462,720"]);
    // Sans retenue, le TTC est le montant de la pièce, et la retenue ne s'écrit pas « 0 ».
    const loyer = screen.getByText("PHOENIX NETWORK INVEST SARL").closest("tr")!;
    expect([...loyer.querySelectorAll("td.nb")].map((td) => td.textContent)).toEqual([
      "179,500",
      "—",
      "179,500",
    ]);
  });

  it("groupe par mois, le plus récent devant, avec un total par mois et un total général", () => {
    render(<Bibliotheque />);
    const titres = [...document.querySelectorAll("tr.mo th")].map((th) => th.textContent);
    expect(titres).toHaveLength(2);
    expect(titres[0]).toMatch(/juillet 2026/);
    expect(titres[1]).toMatch(/juin 2026/);
    const juin = document.querySelectorAll("tr.mo td")[1]!.textContent;
    // Achats et ventes ne s'additionnent pas : chacun son total.
    expect(juin).toContain("pme.doc.type.achats 179,500");
    expect(juin).toContain("pme.doc.type.ventes 300,000");
    const total = document.querySelector("tfoot td")!.textContent;
    expect(total).toContain("pme.doc.type.achats 642,220");
    expect(lignes()).toEqual([
      "MANAGEMENT & AUDIT PARTNERS",
      "PHOENIX NETWORK INVEST SARL",
      "CLIENT SA",
    ]);
  });

  it("filtre par dossier et par retenue", () => {
    render(<Bibliotheque />);
    fireEvent.click(screen.getByRole("button", { name: /^Ventes/ }));
    expect(lignes()).toEqual(["CLIENT SA"]);
    fireEvent.click(screen.getByRole("button", { name: /^pme\.list\.bureau\.tous/ }));
    fireEvent.click(screen.getByRole("button", { name: "pme.list.bureau.avecRetenue" }));
    expect(lignes()).toEqual(["MANAGEMENT & AUDIT PARTNERS"]);
  });

  it("imprime et exporte la sélection, ou tout ce que les filtres montrent", () => {
    render(<Bibliotheque />);
    const actions = () =>
      within(document.querySelector(".b-actions") as HTMLElement)
        .getAllByRole("button")
        .map((b) => b.getAttribute("data-lot"));
    expect(actions()).toEqual(["honoraires,loyer,vente", "honoraires,loyer,vente"]);
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: 'cab.biblio.imprimer.cocher {"nom":"PHOENIX NETWORK INVEST SARL"}',
      }),
    );
    expect(actions()).toEqual(["loyer", "loyer"]);
    fireEvent.click(screen.getByRole("checkbox", { name: "pme.list.bureau.toutCocher" }));
    expect(actions()).toEqual(["honoraires,loyer,vente", "honoraires,loyer,vente"]);
  });

  it("sous 1024 px, garde les cartes du téléphone", () => {
    bureau = false;
    render(<Bibliotheque />);
    expect(document.querySelector(".b-biblio")).toBeNull();
    expect(screen.getByText("rail")).toBeTruthy();
  });
});
