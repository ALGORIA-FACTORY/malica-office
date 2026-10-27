// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ relancer: vi.fn(), retourner: vi.fn(), journal: vi.fn() }));
vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (cle: string, v?: Record<string, unknown>) => (v ? `${cle} ${JSON.stringify(v)}` : cle),
    locale: "fr",
  }),
}));
vi.mock("@/verticals/malica-office/composition", () => ({
  office: () => ({
    supervision: { demanderConfirmation: api.relancer, retourner: api.retourner },
    journal: { consigner: api.journal },
  }),
}));

import { ErreurApi } from "@/lib/transport/erreurs";

import { DecisionSansConfirmation } from "../decision-sans-confirmation";
import { EcranEnvoye } from "../envoye";

const MOTIF = {
  id: "m1",
  code: "justificatif_manquant",
  label: "Justificatif manquant",
  severity: "bloquant",
  requiresNote: false,
  geste: "joindre_document" as const,
};

function monter(onRetournee = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <DecisionSansConfirmation
        pieceId="p1"
        titre="COMPTOIR DU LAC · 1 969,610 TND"
        comptes={null}
        inscriptible={false}
        motifs={[MOTIF]}
        client="DELTA DISTRIBUTION SARL"
        onRetournee={onRetournee}
      />
    </QueryClientProvider>,
  );
  return onRetournee;
}

describe("ce qui part chez quelqu'un le dit", () => {
  beforeEach(() => vi.resetAllMocks());
  afterEach(cleanup);

  it("la relance se confirme sur place, au nom du client", async () => {
    api.relancer.mockResolvedValue(undefined);
    monter();
    fireEvent.click(screen.getByRole("button", { name: "cab.lue.relancer" }));
    const fait = await screen.findByRole("status");
    expect(fait.textContent).toContain("envoi.relance.fait");
    expect(fait.textContent).toContain("DELTA DISTRIBUTION SARL");
  });

  it("une relance en panne dit « pas encore parti », sans le texte de la panne", async () => {
    api.relancer.mockRejectedValue(new ErreurApi('relation "x" does not exist', 500));
    monter();
    fireEvent.click(screen.getByRole("button", { name: "cab.lue.relancer" }));
    const alerte = await screen.findByRole("alert");
    expect(alerte.textContent).toContain("envoi.pasParti");
    expect(document.body.textContent).not.toContain("does not exist");
    api.relancer.mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole("button", { name: "envoi.reessayer" }));
    await waitFor(() => expect(api.relancer).toHaveBeenCalledTimes(2));
  });

  it("le retour remonte motif et note à la page, qui tient le panneau", async () => {
    api.retourner.mockResolvedValue(undefined);
    const onRetournee = monter();
    fireEvent.click(screen.getByRole("button", { name: "cab.lue.retourner" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Joindre le BL-2210." } });
    fireEvent.click(screen.getByRole("button", { name: /cab\.retour\.envoyer/ }));
    await waitFor(() => expect(onRetournee).toHaveBeenCalledTimes(1));
    expect(onRetournee.mock.calls[0]![0]).toMatchObject({
      motif: "Justificatif manquant",
      note: "Joindre le BL-2210.",
    });
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
