// @vitest-environment jsdom
/**
 * La carte « Chaîne de désignation » de la tour (décision du 8 novembre 2026) :
 * Claude au rang 1, DeepSeek au rang 2. L'écran montre ce que la base rend —
 * modèle, dépense de la période, plafond, épuisé ou non, dernières bascules —
 * et transmet le réglage tel quel. Il ne décide rien : la base refuse un modèle
 * sans tarif, deux fois le même fournisseur, un motif vide.
 */
import type { EtatDeLaDesignation } from "@malica/socle/ports/repositories";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (cle: string, v?: Record<string, unknown>) => (v ? `${cle} ${JSON.stringify(v)}` : cle),
    locale: "fr",
  }),
}));

const ETAT: EtatDeLaDesignation = {
  maillons: [
    {
      rang: 1,
      fournisseur: "anthropic",
      modele: "claude-sonnet-5-5",
      role: "chat",
      periode: "mois",
      plafond: 50,
      depense: 50.5,
      epuise: true,
      motif: "Décision du dirigeant",
      decide_le: "2026-11-08T00:00:00.000Z",
    },
    {
      rang: 2,
      fournisseur: "deepseek",
      modele: "deepseek-chat",
      role: "chat",
      periode: "mois",
      plafond: 20,
      depense: 3.2,
      epuise: false,
      motif: "Décision du dirigeant",
      decide_le: "2026-11-08T00:00:00.000Z",
    },
  ],
  modeles: [
    {
      fournisseur: "anthropic",
      modele: "claude-haiku-5-5",
      role: "chat",
      prix_entree: 0.1,
      prix_sortie: 0.5,
    },
    {
      fournisseur: "anthropic",
      modele: "claude-sonnet-5-5",
      role: "chat",
      prix_entree: 2,
      prix_sortie: 10,
    },
    {
      fournisseur: "deepseek",
      modele: "deepseek-chat",
      role: "chat",
      prix_entree: 0.27,
      prix_sortie: 1.1,
    },
  ],
  bascules: [
    {
      le: "2026-11-08T09:00:00.000Z",
      modele: "claude-sonnet-5-5",
      statut: "error",
      motif: "bascule.budget",
    },
  ],
};

const regler = vi.fn(async () => ({}));
const enAttente = () => new Promise(() => undefined);

vi.mock("@/verticals/malica-office/composition", () => ({
  office: () => ({
    tour: new Proxy(
      { designation: async () => ETAT, reglerDesignation: regler } as Record<string, unknown>,
      { get: (cible, nom: string) => cible[nom] ?? enAttente },
    ),
  }),
}));

import { LaChaineDeDesignation } from "../tour/chaine-de-designation";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function carte() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <LaChaineDeDesignation />
    </QueryClientProvider>,
  );
  return waitFor(() => {
    const el = document.querySelector<HTMLElement>("[data-chaine-de-designation]");
    if (!el?.querySelector("[data-maillon='2']")) throw new Error("carte incomplète");
    return el;
  });
}

describe("la carte de la chaîne de désignation", () => {
  it("dit chaque maillon : Claude épuisé, DeepSeek disponible, et la bascule", async () => {
    const c = await carte();
    const principal = c.querySelector<HTMLElement>("[data-maillon='1']")!;
    const repli = c.querySelector<HTMLElement>("[data-maillon='2']")!;
    expect(principal.textContent).toContain("claude-sonnet-5-5");
    expect(principal.textContent).toContain("tour.designation.epuise");
    expect(repli.textContent).toContain("deepseek-chat");
    expect(repli.textContent).toContain("tour.designation.disponible");
    expect(c.textContent).toContain("tour.designation.motif.bascule.budget");
  });

  it("transmet le réglage d'un rang tel quel, motif à l'appui", async () => {
    const c = await carte();
    const principal = within(c.querySelector<HTMLElement>("[data-maillon='1']")!);
    fireEvent.change(principal.getByLabelText("tour.designation.modele"), {
      target: { value: "claude-haiku-5-5|chat" },
    });
    fireEvent.change(principal.getByLabelText("tour.designation.periode"), {
      target: { value: "jour" },
    });
    fireEvent.change(principal.getByLabelText("tour.designation.plafond"), {
      target: { value: "5" },
    });
    const bouton = principal.getByText("tour.enregistrer") as HTMLButtonElement;
    expect(bouton.disabled).toBe(true);
    fireEvent.change(principal.getByLabelText("common.motif"), {
      target: { value: "Haiku pour la journée" },
    });
    fireEvent.click(bouton);
    await waitFor(() => expect(regler).toHaveBeenCalled());
    expect(regler).toHaveBeenCalledWith(
      1,
      "claude-haiku-5-5",
      "chat",
      "jour",
      "5",
      "Haiku pour la journée",
    );
  });
});
