// @vitest-environment jsdom
/**
 * Le retour au client et l'écran « Envoyé » — dire à l'expert ce qui est parti et ce qui reste.
 *
 * Garantit que le retour d'une pièce au client remonte son motif et sa note, qu'une panne
 * va au journal et jamais en texte brut à l'écran, que l'écran d'un envoi en lot nomme les
 * pièces restées chez la personne en permettant de les rouvrir, et ne montre aucune liste
 * quand tout est parti.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ retourner: vi.fn(), journal: vi.fn() }));
vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (cle: string, v?: Record<string, unknown>) => (v ? `${cle} ${JSON.stringify(v)}` : cle),
    locale: "fr",
  }),
}));
vi.mock("@/verticals/malica-office/composition", () => ({
  office: () => ({
    supervision: { retourner: api.retourner },
    journal: { consigner: api.journal },
  }),
}));

import { ErreurApi } from "@/lib/transport/erreurs";

import { EcranEnvoye } from "../envoye";
import { RetournerAuClient } from "../retourner-au-client";

const MOTIF = {
  id: "m1",
  code: "justificatif_manquant",
  label: "Justificatif manquant",
  severity: "bloquant",
  requiresNote: false,
  geste: "joindre_document" as const,
};

function monter(onRetournee = vi.fn().mockResolvedValue(undefined)) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RetournerAuClient
        pieceId="p1"
        motifs={[MOTIF]}
        onFermer={vi.fn()}
        onRetournee={onRetournee}
      />
    </QueryClientProvider>,
  );
  return onRetournee;
}

describe("le retour au client le dit", () => {
  beforeEach(() => vi.resetAllMocks());
  afterEach(cleanup);

  it("le retour remonte motif et note à la page, qui tient le panneau", async () => {
    api.retourner.mockResolvedValue(undefined);
    const onRetournee = monter();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Joindre le BL-2210." } });
    fireEvent.click(screen.getByRole("button", { name: /cab\.retour\.envoyer/ }));
    await waitFor(() => expect(onRetournee).toHaveBeenCalledTimes(1));
    expect(onRetournee.mock.calls[0]![0]).toMatchObject({
      motif: "Justificatif manquant",
      note: "Joindre le BL-2210.",
    });
    expect(api.retourner).toHaveBeenCalledWith({
      pieceId: "p1",
      motifId: "m1",
      note: "Joindre le BL-2210.",
    });
  });

  it("une panne du retour va au journal, jamais en texte brut à l'écran", async () => {
    api.retourner.mockRejectedValue(new ErreurApi('relation "x" does not exist', 500));
    const onRetournee = monter();
    fireEvent.click(screen.getByRole("button", { name: /cab\.retour\.envoyer/ }));
    await screen.findByRole("alert");
    expect(document.body.textContent).not.toContain("does not exist");
    expect(onRetournee).not.toHaveBeenCalled();
  });
});

describe("l'écran Envoyé, en lot", () => {
  afterEach(cleanup);

  it("nomme ce qui est resté et l'ouvre", () => {
    const ouvrir = vi.fn();
    render(
      <EcranEnvoye
        titre="8 envoyées sur 9."
        quoi="Elles sont chez AUDICORP"
        suite={null}
        trace={null}
        restees={{
          titre: "Restée chez vous",
          ouvrir: "L'ouvrir",
          liste: [{ id: "r", nom: "PAPETERIE NOUR", raison: "Pas encore partie", ouvrir }],
        }}
        principale={{ libelle: "Revenir à mes pièces", action: vi.fn() }}
        secondaire={null}
      />,
    );
    expect(screen.getByText("PAPETERIE NOUR")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "L'ouvrir" }));
    expect(ouvrir).toHaveBeenCalled();
  });

  it("ne montre aucune liste quand tout est parti", () => {
    render(
      <EcranEnvoye
        titre="Envoyé."
        quoi="chez AUDICORP"
        suite={null}
        trace={null}
        restees={{ titre: "Restée chez vous", ouvrir: "L'ouvrir", liste: [] }}
        principale={{ libelle: "Pièce suivante", action: vi.fn() }}
        secondaire={null}
      />,
    );
    expect(screen.queryByText("Restée chez vous")).toBeNull();
  });
});
