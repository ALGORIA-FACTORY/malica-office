// @vitest-environment jsdom
/**
 * L'écran de revue d'une pièce, côté cabinet : le retour, les libellés de
 * ligne, et la qualification fiscale du règlement.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CompteDuPlan,
  Ecriture,
  PropositionDeReglement,
} from "@malica/socle/ports/repositories";

const nav = vi.hoisted(() => ({ peutRevenir: false, retour: vi.fn(), naviguer: vi.fn() }));
const api = vi.hoisted(() => ({
  ecritures: vi.fn(),
  reglement: vi.fn(),
  paiements: vi.fn(),
  book: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { component: ComponentType }) => ({
    options,
    useParams: () => ({ pieceId: "piece" }),
  }),
  Link: ({
    to,
    children,
    onClick,
    ...reste
  }: {
    to: string;
    children: ReactNode;
    onClick?: (e: unknown) => void;
    [cle: string]: unknown;
  }) => {
    const { params: _p, search: _s, ...attributs } = reste;
    return (
      <a
        href={to}
        onClick={(e) => {
          onClick?.(e);
          // jsdom ne navigue pas : seul compte ce que l'écran a demandé au routeur.
          e.preventDefault();
        }}
        {...attributs}
      >
        {children}
      </a>
    );
  },
  useNavigate: () => nav.naviguer,
  useRouter: () => ({ history: { back: nav.retour } }),
  useCanGoBack: () => nav.peutRevenir,
}));
vi.mock("@/i18n", () => ({
  useI18n: () => ({ t: (cle: string) => cle, locale: "fr", dir: "ltr" }),
}));
vi.mock("@/components/malica/cabinet-context", () => ({
  useCabinet: () => ({ org: { id: "cabinet", jurisdiction: "TN", name: "Cabinet" } }),
  useMalicaPanel: () => undefined,
}));
vi.mock("@/components/malica/document-view", () => ({ DocumentView: () => null }));
vi.mock("@/components/malica/controles-comptables", () => ({ ControlesComptables: () => null }));
vi.mock("@/components/malica/telecharger-dossier-comptable", () => ({
  TelechargerDossierComptable: () => null,
}));
vi.mock("@/verticals/malica-office/composition", () => ({
  office: () => ({
    capture: {
      dossier: async () => ({
        piece: { id: "piece", tenantId: "client", status: "lue", documentKind: "facture_achat" },
        contenu: { type: "pdf" },
        extraction: null,
      }),
      piecesIssuesDe: async () => [],
      paiementsDUnePiece: api.paiements,
    },
    office: {
      ecrituresForPiece: api.ecritures,
      propositionDeReglement: api.reglement,
      inscrireLeReglement: vi.fn(),
      book: api.book,
    },
    supervision: {
      listClients: async () => [],
      motifs: async () => [],
      auditForPiece: async () => [],
      queue: async () => [],
    },
    referential: {
      activePack: async () => ({ id: "pack" }),
      socleParams: async () => ({ moneyDecimals: 3 }),
      moyensDePaiement: async () => [],
      typesDeDocument: async () => [],
    },
    parametrage: {
      plan: async (): Promise<CompteDuPlan[]> => [
        { code: "4011", libelle: "Fournisseurs", origine: "officiel" } as CompteDuPlan,
      ],
    },
  }),
}));

import { Route } from "../routes/_authenticated/cabinet.piece.$pieceId";

const Ecran = (Route as unknown as { options: { component: ComponentType } }).options.component;

function monter() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Ecran />
    </QueryClientProvider>,
  );
}

const reglement = (retenue: unknown): PropositionDeReglement =>
  ({
    ok: true,
    inscrite: null,
    ecriture: {
      journal: "BQ",
      dateEcriture: "2026-10-20",
      devise: "TND",
      libelle: "Règlement",
      lignes: [
        { account_code: "4011", libelle: "Retenue 1,5 % / tiers", debit: "18.512", credit: "0" },
      ],
    },
    tauxDisponibles: [{ code: "RAS", taux: "0.015", libelle: "RAS 1,5 %", famille: "ir" }],
    ttc: "1234.500",
    paye: "1215.988",
    retenue,
  }) as PropositionDeReglement;

beforeEach(() => {
  nav.peutRevenir = false;
  nav.retour.mockReset();
  api.ecritures.mockResolvedValue([]);
  api.paiements.mockResolvedValue([]);
  api.reglement.mockReset();
});
afterEach(cleanup);

describe("revue d'une pièce", () => {
  it("revient à l'écran d'où l'on vient, et à la file de revue sans historique", async () => {
    nav.peutRevenir = true;
    monter();
    const retour = await screen.findByRole("link", { name: "cab.review.back" });
    expect(retour.getAttribute("href")).toBe("/cabinet");
    fireEvent.click(retour);
    expect(nav.retour).toHaveBeenCalledTimes(1);
    cleanup();

    nav.peutRevenir = false;
    monter();
    fireEvent.click(await screen.findByRole("link", { name: "cab.review.back" }));
    expect(nav.retour).toHaveBeenCalledTimes(1);
  });

  it("montre l'intitulé du compte ET le libellé de la ligne", async () => {
    api.ecritures.mockResolvedValue([
      {
        id: "e",
        vivante: true,
        libelle: "Facture F1",
        journal: "AC",
        dateEcriture: "2026-10-20",
        devise: "TND",
        lines: [
          {
            ordinal: 1,
            accountCode: "4011",
            libelle: "Retenue 1,5 % / tiers",
            debit: "0",
            credit: "18.512",
            taxCode: null,
          },
        ],
      } as unknown as Ecriture,
    ]);
    monter();
    expect(await screen.findByText("Fournisseurs")).toBeTruthy();
    expect(screen.getByText("Retenue 1,5 % / tiers")).toBeTruthy();
  });

  describe("le traitement fiscal du règlement", () => {
    beforeEach(() => {
      api.paiements.mockResolvedValue([
        {
          id: "paiement",
          moyenCode: "virement",
          montantMineur: 1215988,
          devise: "TND",
          payeLe: "2026-10-20",
          reference: null,
          justificatifPieceId: "talon",
          eteint: false,
        },
      ]);
    });

    it("au-dessus du seuil, « sans retenue » se motive avant d'être envoyé", async () => {
      // Décision du 24 octobre 2026 : sous le seuil rien n'est demandé ;
      // au-dessus, ne rien retenir est une décision qui se motive.
      api.reglement.mockImplementation(async (_id: string, q?: unknown) =>
        reglement(q ? { cas: "sans_objet" } : { cas: "a_confirmer" }),
      );
      monter();
      const verifier = await screen.findByRole("button", { name: "cab.retenue.preview" });
      expect((verifier as HTMLButtonElement).disabled).toBe(true);
      fireEvent.change(screen.getByLabelText("cab.retenue.taxEvidence"), {
        target: { value: "Attestation d'exonération 118" },
      });
      expect((verifier as HTMLButtonElement).disabled).toBe(false);
      fireEvent.click(verifier);
      await waitFor(() =>
        expect(api.reglement).toHaveBeenLastCalledWith("paiement", {
          codes: [],
          baseReglee: "1215.988",
          tvaReglee: null,
          assietteIR: null,
          justification: "Attestation d'exonération 118",
        }),
      );
    });

    it("sous le seuil, le comptable peut quand même déclarer une retenue", async () => {
      api.reglement.mockResolvedValue(reglement({ cas: "sans_objet" }));
      monter();
      expect(screen.queryByRole("combobox", { name: "cab.retenue.withholding" })).toBeNull();
      fireEvent.click(await screen.findByRole("button", { name: "cab.retenue.declarer" }));
      expect(await screen.findByRole("combobox", { name: "cab.retenue.withholding" })).toBeTruthy();
    });

    it("relit « 1 234,500 » comme l'écran l'affiche, et exige le certificat d'une retenue", async () => {
      api.reglement.mockResolvedValue(reglement({ cas: "a_confirmer" }));
      monter();
      const retenue = await screen.findByRole("combobox", { name: "cab.retenue.withholding" });
      fireEvent.change(retenue, { target: { value: "RAS" } });
      const verifier = screen.getByRole("button", { name: "cab.retenue.preview" });
      expect((verifier as HTMLButtonElement).disabled).toBe(true);
      fireEvent.change(screen.getByLabelText("cab.retenue.grossSettled"), {
        target: { value: "1 234,500" },
      });
      fireEvent.change(screen.getByLabelText("cab.retenue.taxEvidence"), {
        target: { value: "Certificat 12" },
      });
      expect((verifier as HTMLButtonElement).disabled).toBe(false);
      fireEvent.click(verifier);
      await waitFor(() =>
        expect(api.reglement).toHaveBeenLastCalledWith(
          "paiement",
          expect.objectContaining({ codes: ["RAS"], baseReglee: "1234.500" }),
        ),
      );
    });

    it("refuse d'envoyer un montant illisible", async () => {
      api.reglement.mockResolvedValue(reglement({ cas: "a_confirmer" }));
      monter();
      fireEvent.change(await screen.findByRole("combobox", { name: "cab.retenue.withholding" }), {
        target: { value: "RAS" },
      });
      fireEvent.change(screen.getByLabelText("cab.retenue.grossSettled"), {
        target: { value: "1,234.500" },
      });
      fireEvent.change(screen.getByLabelText("cab.retenue.taxEvidence"), {
        target: { value: "Certificat 12" },
      });
      expect(screen.getByRole("alert").textContent).toBe("cab.retenue.montantIllisible");
      expect(
        (screen.getByRole("button", { name: "cab.retenue.preview" }) as HTMLButtonElement).disabled,
      ).toBe(true);
    });

    it("sous le seuil, le moteur rend « sans objet » : l'écran le dit, sans rien demander", async () => {
      api.reglement.mockResolvedValue(reglement({ cas: "sans_objet" }));
      monter();
      expect(await screen.findByText("cab.retenue.sansObjet")).toBeTruthy();
      expect(screen.queryByRole("group")).toBeNull();
      expect(
        (screen.getByRole("button", { name: "cab.review.reglement.inscrire" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false);
      // Le libellé de la ligne du règlement reste lisible à côté de l'intitulé.
      expect(screen.getAllByText("Retenue 1,5 % / tiers").length).toBeGreaterThan(0);
    });
  });

  it("une annulation demandée par le client attend l'inscription de l'expert", async () => {
    api.paiements.mockResolvedValue([
      {
        id: "paiement",
        moyenCode: "virement",
        montantMineur: 100000,
        devise: "TND",
        payeLe: "2026-10-20",
        reference: null,
        justificatifPieceId: null,
        eteint: true,
        annulationAInscrire: "contre-passation",
      },
    ]);
    api.book.mockResolvedValue(undefined);
    monter();
    expect(await screen.findByText("cab.review.paiement.annulationAInscrire")).toBeTruthy();
    expect(screen.queryByText("cab.review.paiement.eteint")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "cab.review.paiement.inscrireAnnulation" }));
    await waitFor(() => expect(api.book).toHaveBeenCalledWith("contre-passation"));
  });
});
