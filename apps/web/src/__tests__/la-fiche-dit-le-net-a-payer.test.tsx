/**
 * L'en-tête de la fiche d'une pièce (PME) quand une retenue à la source est tranchée — la règle
 * de la v0.2.124, la même que la Bibliothèque : le grand montant est le NET À PAYER (le TTC
 * imprimé, que le jugement prouve égal à HT + TVA + droits − retenue), et les puces disent le
 * TTC avant retenue et la retenue, en négatif.
 *
 * La note d'honoraires de MAP (pilote, juillet 2026) : TTC 477,000, RAS 14,280, net 462,720.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const dossier = vi.hoisted(() => ({
  piece: {
    id: "00000000-0000-4000-8000-0000000000a1",
    tenantId: "pme",
    status: "lue",
    vis: "entite",
    documentKind: "facture_achat",
    createdAt: "2026-07-02T10:00:00Z",
    auteurId: "u1",
    remplace: null,
    remplaceePar: null,
    versionCourante: "00000000-0000-4000-8000-0000000000a1",
  },
  contenu: null,
  extraction: {
    id: "x1",
    contract: "extract.v1",
    createdAt: "2026-07-02T10:00:00Z",
    flags: [],
    payload: {
      issuer: "MANAGEMENT & AUDIT PARTNERS",
      document_date: "2026-07-02",
      document_kind: "facture_achat",
      currency: "TND",
      lines: [],
      articles: [],
      other_charges: [{ code: "TIMBRE", label: "Timbre", amount: "1.000" }],
      // Le TTC imprimé : le net à payer, que le jugement a prouvé.
      totals: { base_ht: "400.000", vat: "76.000", ttc: "462.720", withholding: "-14.280" },
    },
  },
  precisions: {},
  corrections: [],
  prouves: [],
  decimalesDeLaPiece: 3,
  baseProposee: null,
  retenue: { montant: "14.280", totalTtc: "477.000" },
  archive: null,
  lectureRefusee: null,
  suivi: null,
  circuit: null,
  montantsDuCabinet: null,
  ecritureIllisible: false,
  citations: [],
  tokens: [],
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({
    options,
    useParams: () => ({ pieceId: "00000000-0000-4000-8000-0000000000a1" }),
    useSearch: () => ({}),
  }),
  Link: ({ children }: { children: unknown }) => createElement("a", null, children as never),
  useCanGoBack: () => false,
  useNavigate: () => vi.fn(),
  useRouter: () => ({ history: { back: vi.fn() } }),
  useRouterState: () => undefined,
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (o: { queryKey: unknown[] }) =>
    o.queryKey[0] === "piece" && o.queryKey.length === 2
      ? { isPending: false, isSuccess: true, data: dossier }
      : { isPending: false, isSuccess: false, data: undefined },
  useQueries: () => [],
  useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
    getQueryData: () => undefined,
    setQueryData: vi.fn(),
  }),
}));
vi.mock("@/components/malica/pme-context", () => ({
  usePme: () => ({
    tenantId: "pme",
    entityId: null,
    jurisdiction: "TN",
    currency: "TND",
    packId: null,
    orgName: "Société",
    matricule: null,
    adresse: null,
    dossiers: [{ id: "pme", name: "Société" }],
    choisirDossier: vi.fn(),
    societeAffichee: "pme",
    afficherSociete: vi.fn(),
    aUnCabinet: false,
    reprendreLaPhoto: vi.fn(),
    forfait: { ligne: null, enCours: false, illisible: false },
  }),
}));
vi.mock("@/components/malica/document-view", () => ({ DocumentView: () => null }));
vi.mock("@/components/malica/apercu-de-piece", () => ({ ApercuDePiece: () => null }));
vi.mock("@/verticals/malica-office/composition", () => ({ office: vi.fn() }));
vi.mock("@/i18n", () => ({
  useI18n: () => ({ t: (cle: string) => cle, locale: "fr", dir: "ltr" }),
}));

import { Route } from "@/routes/_authenticated/pme.piece.$pieceId";

describe("la fiche d'une pièce avec une retenue tranchée", () => {
  it("titre le net à payer, et dit à côté le TTC et la retenue", () => {
    const html = renderToStaticMarkup(createElement(Route.options.component!));
    const entete = /<div class="f-mt">([\s\S]*?)<div class="f-puces">([\s\S]*?)<\/div><\/div>/.exec(
      html,
    );
    expect(entete, html.slice(0, 2000)).not.toBeNull();
    const [, montant, puces] = entete!;
    const texte = (h: string) =>
      h
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .trim();
    // Le grand montant : le net, titré comme tel — jamais le TTC avant retenue.
    expect(texte(montant!)).toContain("462,720");
    expect(texte(montant!)).toContain("pme.extract.netAPayer");
    expect(texte(montant!)).not.toContain("477,000");
    // Les puces : le TTC avant retenue, puis la retenue en négatif.
    expect(puces).toMatch(/data-entete="ttc">pme\.extract\.ttc <b>477,000<\/b>/);
    expect(puces).toMatch(/data-entete="retenue">pme\.extract\.retenue <b>−14,280<\/b>/);
  });
});
