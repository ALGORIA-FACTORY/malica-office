// @vitest-environment jsdom
/**
 * Son Mon espace part avec son compte (lot 4) : hors de la société quittée, il
 * voit ses pièces privées, les télécharge, les supprime — jamais il ne les
 * envoie. Le même Mon espace que dans la société (spec §5, revue de #146) :
 * une grille de miniatures par mois, deux gestes de même poids sur les
 * papiers choisis, le principal d'abord.
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

const piece = (id: string, createdAt: string) => ({
  id,
  tenantId: "t1",
  societe: "SOCIETE ESSAI",
  createdAt,
  contentType: "image/jpeg",
  documentKind: null,
});
const OCTOBRE = piece("p1", "2026-10-20T09:00:00.000Z");
const SEPTEMBRE = piece("p2", "2026-09-03T09:00:00.000Z");

const monter = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MonEspaceParti />
    </QueryClientProvider>,
  );

const choisir = (nom: RegExp) => {
  const [choix] = screen.getAllByRole("button", { name: nom });
  fireEvent.click(choix!);
};

describe("son Mon espace, hors de la société quittée", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("une grille de miniatures par mois, le dessin de Mon espace", async () => {
    appels.liste.mockResolvedValue([OCTOBRE, SEPTEMBRE]);
    const { container } = monter();
    await screen.findAllByText("SOCIETE ESSAI");
    expect(container.querySelector('[data-ecran="coffre"]')).not.toBeNull();
    const mois = container.querySelectorAll("section.mois");
    expect(mois).toHaveLength(2);
    expect(mois[0]!.querySelectorAll(".grille .tuile")).toHaveLength(1);
    expect(screen.getByRole("status").textContent).toContain("pme.coffre.compte");
  });

  it("deux gestes : télécharger, supprimer — jamais envoyer ; rien sans papier choisi", async () => {
    appels.liste.mockResolvedValue([OCTOBRE]);
    const { container } = monter();
    await screen.findByText("SOCIETE ESSAI");
    const gestes = within(container.querySelector(".gestes") as HTMLElement).getAllByRole("button");
    expect(gestes.map((b) => b.textContent)).toEqual([
      "cab.review.telecharger",
      "pme.coffre.supprimer",
    ]);
    expect(gestes[0]!.className).toBe("pr");
    for (const b of gestes) expect((b as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText(/envoyer|transmettre/i)).toBeNull();
  });

  it("toucher un papier le choisit ; télécharger remet ses octets", async () => {
    appels.liste.mockResolvedValue([OCTOBRE]);
    appels.apercu.mockResolvedValue(new Blob(["x"], { type: "image/jpeg" }));
    appels.enregistrer.mockResolvedValue({ chemin: null });
    monter();
    await screen.findByText("SOCIETE ESSAI");
    choisir(/pme\.coffre\.choisir/);
    fireEvent.click(screen.getByRole("button", { name: "cab.review.telecharger" }));
    await waitFor(() => expect(appels.enregistrer).toHaveBeenCalledOnce());
    expect(appels.apercu).toHaveBeenCalledWith("p1");
  });

  it("supprimer se confirme en deux temps, puis la grille se relit", async () => {
    appels.liste.mockResolvedValueOnce([OCTOBRE]).mockResolvedValueOnce([]);
    appels.supprimer.mockResolvedValue(true);
    monter();
    await screen.findByText("SOCIETE ESSAI");
    choisir(/pme\.coffre\.choisir/);
    fireEvent.click(screen.getByRole("button", { name: "pme.coffre.supprimer" }));
    expect(appels.supprimer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "pme.supprimer.oui" }));
    await waitFor(() => expect(appels.supprimer).toHaveBeenCalledWith("p1"));
    expect(await screen.findByText("monespace.vide")).toBeTruthy();
  });
});
