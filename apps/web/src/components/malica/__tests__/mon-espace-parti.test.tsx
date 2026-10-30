// @vitest-environment jsdom
/**
 * Son Mon espace part avec son compte (lot 4) : hors de la société quittée, il
 * voit ses pièces privées, les télécharge, les supprime — jamais il ne les
 * envoie. Deux gestes de même poids, le principal d'abord.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const appels = vi.hoisted(() => ({
  liste: vi.fn(),
  apercu: vi.fn(),
  supprimer: vi.fn(),
  enregistrer: vi.fn(),
}));

vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (cle: string, v?: Record<string, unknown>) => (v ? `${cle} ${JSON.stringify(v)}` : cle),
    locale: "fr",
  }),
}));
vi.mock("@/verticals/malica-office/composition", () => ({
  office: () => ({
    capture: {
      monEspaceHorsSociete: appels.liste,
      apercu: appels.apercu,
      supprimer: appels.supprimer,
    },
  }),
}));
vi.mock("@/capabilities/enregistrer-un-fichier", () => ({
  enregistrerUnFichier: appels.enregistrer,
}));
vi.mock("@/components/malica/apercu-de-piece", () => ({ ApercuDePiece: () => null }));
vi.mock("@/components/malica/aide", () => ({ Aide: () => null }));

import { MonEspaceParti } from "../mon-espace-parti";

const PIECE = {
  id: "p1",
  tenantId: "t1",
  societe: "SOCIETE ESSAI",
  createdAt: "2026-10-20T09:00:00.000Z",
  contentType: "image/jpeg",
  documentKind: null,
};

const monter = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MonEspaceParti />
    </QueryClientProvider>,
  );

describe("son Mon espace, hors de la société quittée", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("chaque pièce dit sa société et porte deux gestes : télécharger, supprimer — jamais envoyer", async () => {
    appels.liste.mockResolvedValue([PIECE]);
    monter();
    const ligne = (await screen.findByText("SOCIETE ESSAI")).closest("li")!;
    const boutons = within(ligne).getAllByRole("button");
    expect(boutons.map((b) => b.textContent)).toEqual([
      "cab.review.telecharger",
      "monespace.supprimer",
    ]);
    // Le principal plein d'abord, le secondaire en contour : même hauteur.
    expect(boutons[0]!.className).toMatch(/bg-foreground/);
    expect(boutons[1]!.className).toMatch(/border/);
    for (const b of boutons) expect(b.className).toMatch(/min-h-\[48px\]/);
    expect(within(ligne).queryByText(/envoyer|transmettre/i)).toBeNull();
  });

  it("télécharger remet les octets de la pièce", async () => {
    appels.liste.mockResolvedValue([PIECE]);
    appels.apercu.mockResolvedValue(new Blob(["x"], { type: "image/jpeg" }));
    appels.enregistrer.mockResolvedValue({ chemin: null });
    monter();
    fireEvent.click(await screen.findByRole("button", { name: "cab.review.telecharger" }));
    await waitFor(() => expect(appels.enregistrer).toHaveBeenCalledOnce());
    expect(appels.apercu).toHaveBeenCalledWith("p1");
  });

  it("supprimer se confirme en deux temps, puis la liste se relit", async () => {
    appels.liste.mockResolvedValueOnce([PIECE]).mockResolvedValueOnce([]);
    appels.supprimer.mockResolvedValue(true);
    monter();
    fireEvent.click(await screen.findByRole("button", { name: "monespace.supprimer" }));
    expect(appels.supprimer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "pme.supprimer.oui" }));
    await waitFor(() => expect(appels.supprimer).toHaveBeenCalledWith("p1"));
    expect(await screen.findByText("monespace.vide")).toBeTruthy();
  });
});
