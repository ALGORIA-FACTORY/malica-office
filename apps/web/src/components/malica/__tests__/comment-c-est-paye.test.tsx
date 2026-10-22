// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaiementDUnePiece } from "@malica/socle/ports/repositories";

const api = vi.hoisted(() => ({ paiements: vi.fn(), inscrire: vi.fn() }));
vi.mock("@/components/malica/pme-context", () => ({
  usePme: () => ({ tenantId: "dossier", entityId: "societe", packId: "pack" }),
}));
vi.mock("@/i18n", () => ({
  useI18n: () => ({ t: (cle: string) => cle, locale: "fr", dir: "ltr" }),
}));
vi.mock("@/capabilities/files", () => ({ files: {} }));
vi.mock("@/lib/hors-ligne", () => ({ vidage: vi.fn() }));
vi.mock("@/verticals/malica-office/composition", () => ({
  office: () => ({
    referential: {
      moyensDePaiement: async () => [
        { code: "especes", libelle: "Espèces", exigeJustificatif: false, exigeReference: false },
        { code: "non_paye", libelle: "Non payé", exigeJustificatif: false, exigeReference: false },
      ],
      typesDeDocument: async () => [],
    },
    capture: {
      paiementsDUnePiece: api.paiements,
      enregistrerPaiement: api.inscrire,
      piecesIssuesDe: async () => [],
      motifsDAnnulation: async () => [],
    },
  }),
}));

import { CommentCEstPaye } from "../comment-c-est-paye";

function monter(ttcMineur: number | null = 119000) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CommentCEstPaye
        pieceId="piece"
        visDeLaPiece="personnel"
        dateDeLaPiece="2026-10-21"
        ttcMineur={ttcMineur}
        devise="TND"
        sens="depense"
        tiers="Fournisseur"
        reference="F1"
        decimales={3}
      />
    </QueryClientProvider>,
  );
  return client;
}

describe("la déclaration d'un règlement", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.paiements.mockResolvedValue([]);
    api.inscrire.mockResolvedValue({});
  });
  afterEach(cleanup);

  it("exige un choix du montant puis remet ce choix à zéro après inscription", async () => {
    monter();
    const especes = await screen.findByRole("button", { name: "Espèces" });
    const tout = screen.getByRole("button", { name: "pme.paiement.tout" });
    expect(tout.getAttribute("aria-pressed")).toBe("false");
    expect((especes as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(tout);
    await waitFor(() => expect((especes as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(especes);
    await waitFor(() =>
      expect(api.inscrire).toHaveBeenCalledWith(expect.objectContaining({ montantMineur: 119000 })),
    );
    await waitFor(() => expect(tout.getAttribute("aria-pressed")).toBe("false"));
    expect((especes as HTMLButtonElement).disabled).toBe(true);
  });

  it("n'inscrit rien tant que l'historique n'a pas répondu", async () => {
    api.paiements.mockReturnValue(new Promise(() => {}));
    monter();
    const especes = await screen.findByRole("button", { name: "Espèces" });
    fireEvent.click(screen.getByRole("button", { name: "pme.paiement.tout" }));
    fireEvent.click(especes);
    expect((especes as HTMLButtonElement).disabled).toBe(true);
    expect(api.inscrire).not.toHaveBeenCalled();
  });

  it("rend une panne visible et permet de relire l'historique", async () => {
    api.paiements.mockRejectedValueOnce(new Error("Historique indisponible"));
    monter();
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Espèces" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole("button", { name: "doc.retry" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(api.paiements).toHaveBeenCalledTimes(2);
  });

  it("ne remplace pas un règlement de montant inconnu par zéro", async () => {
    api.paiements.mockResolvedValue([
      {
        id: "ancien",
        moyenCode: "especes",
        montantMineur: null,
        eteint: false,
        justificatifPieceId: null,
        annulePaiementId: null,
        reference: null,
      } as PaiementDUnePiece,
    ]);
    monter();
    const especes = await screen.findByRole("button", { name: "Espèces" });
    fireEvent.click(screen.getByRole("button", { name: "pme.paiement.tout" }));
    await screen.findByText("pme.paiement.incomplet");
    expect((especes as HTMLButtonElement).disabled).toBe(true);
  });

  it("conserve le constat non payé sans exiger un montant fictif", async () => {
    monter(null);
    const nonPaye = await screen.findByRole("button", { name: "Non payé" });
    await waitFor(() => expect((nonPaye as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(nonPaye);
    await waitFor(() =>
      expect(api.inscrire).toHaveBeenCalledWith(
        expect.objectContaining({ moyenCode: "non_paye", montantMineur: null, payeLe: null }),
      ),
    );
  });

  it("refuse un montant partiel qui s'arrondit à zéro", async () => {
    monter();
    const especes = await screen.findByRole("button", { name: "Espèces" });
    fireEvent.click(screen.getByRole("button", { name: "pme.paiement.partie" }));
    fireEvent.change(screen.getByLabelText("pme.paiement.combien"), {
      target: { value: "0,0001" },
    });
    expect((especes as HTMLButtonElement).disabled).toBe(true);
  });

  it("inscrit seulement le reste après un acompte connu", async () => {
    api.paiements.mockResolvedValue([
      {
        id: "acompte",
        moyenCode: "especes",
        montantMineur: 50000,
        eteint: false,
        justificatifPieceId: null,
        annulePaiementId: null,
        reference: null,
      } as PaiementDUnePiece,
    ]);
    monter();
    const especes = await screen.findByRole("button", { name: "Espèces" });
    fireEvent.click(screen.getByRole("button", { name: "pme.paiement.tout" }));
    await waitFor(() => expect((especes as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(especes);
    await waitFor(() =>
      expect(api.inscrire).toHaveBeenCalledWith(expect.objectContaining({ montantMineur: 69000 })),
    );
  });

  it("respecte un montant partiel saisi avec une virgule", async () => {
    monter();
    const especes = await screen.findByRole("button", { name: "Espèces" });
    fireEvent.click(screen.getByRole("button", { name: "pme.paiement.partie" }));
    fireEvent.change(screen.getByLabelText("pme.paiement.combien"), {
      target: { value: "12,500" },
    });
    await waitFor(() => expect((especes as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(especes);
    await waitFor(() =>
      expect(api.inscrire).toHaveBeenCalledWith(expect.objectContaining({ montantMineur: 12500 })),
    );
  });
});
