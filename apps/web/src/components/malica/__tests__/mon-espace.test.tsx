// @vitest-environment jsdom
/**
 * Mon espace : une grille de miniatures par mois, un compte, et deux gestes sur
 * les papiers choisis (maquette « Malica sans blocage », 28 octobre 2026).
 *
 * Ce que ces épreuves tiennent :
 *   — seules les pièces PERSONNELLES paraissent, rangées par mois ;
 *   — les deux gestes restent éteints tant que rien n'est choisi ;
 *   — « Mettre dans la société » passe les papiers choisis en `entite`, et le
 *     DIT ; « Transmettre » reste à un geste, et finit sur l'écran « Envoyé » ;
 *   — « Supprimer » demande confirmation avant d'effacer.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PieceLue } from "@malica/socle/ports/repositories";
import { ErreurApi } from "@/lib/transport/erreurs";

const PROPRIETAIRE = ["societe.tout_voir", "envoi.cabinet", "piece.garder", "circuit.recevoir"];
const SIEGE = ["envoi.proprietaire"];
const base = vi.hoisted(() => ({ pieces: [] as Partial<PieceLue>[], droits: [] as string[] }));
const api = vi.hoisted(() => ({
  setPieceVis: vi.fn(),
  transmettreLesPieces: vi.fn(),
  supprimer: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  useNavigate: () => api.navigate,
  // Le retour suit l'historique (`useRevenir`) : ici, rien derrière.
  useRouter: () => ({ history: { canGoBack: () => false, back: vi.fn() }, navigate: vi.fn() }),
}));
vi.mock("@/components/malica/pme-context", () => ({
  usePme: () => ({ tenantId: "dossier", file: { elements: [] } }),
}));
vi.mock("@/components/malica/file-locale", () => ({ FileLocale: () => null }));
vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (cle: string, vars?: Record<string, unknown>) =>
      vars && "count" in vars ? `${cle}:${String(vars["count"])}` : cle,
    locale: "fr",
  }),
  // `texteDeLErreur` traduit un refus rédigé dans la langue rangée.
  localeRangee: () => "fr",
}));
vi.mock("@/verticals/malica-office/composition", () => ({
  office: () => ({
    capture: {
      listAvecLecture: async () => base.pieces.map((p) => ({ ...p })),
      miniature: async () => null,
      supprimer: api.supprimer,
    },
    collab: { setPieceVis: api.setPieceVis, transmettreLesPieces: api.transmettreLesPieces },
    identity: {
      monCabinet: async () => ({ id: "cab", name: "CABINET ESSAI", tientLesLivres: true }),
    },
    acces: { monAcces: async () => ({ role: "x", plateforme: false, droits: base.droits }) },
  }),
}));

import { Route } from "@/routes/_authenticated/pme.coffre";

function piece(id: string, jour: string, vis: PieceLue["vis"] = "personnel"): Partial<PieceLue> {
  return {
    id,
    vis,
    status: "lue",
    emetteur: `EMETTEUR ${id}`,
    dateDocument: jour,
    createdAt: `${jour}T08:00:00Z`,
    transmiseLe: null,
    total: null,
    devise: null,
  };
}

function monter() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    createElement(
      QueryClientProvider,
      { client },
      createElement(Route.options.component as () => React.ReactElement),
    ),
  );
}

describe("Mon espace", () => {
  beforeEach(() => {
    base.pieces = [
      piece("a", "2026-10-20"),
      piece("b", "2026-10-02"),
      piece("c", "2026-09-14"),
      piece("d", "2026-10-21", "entite"),
    ];
    base.droits = PROPRIETAIRE;
    api.setPieceVis.mockReset().mockImplementation(async (id: string, vis: PieceLue["vis"]) => {
      const p = base.pieces.find((x) => x.id === id)!;
      p.vis = vis;
      return true;
    });
    api.transmettreLesPieces.mockReset().mockImplementation(async (ids: string[]) => {
      for (const id of ids) {
        const p = base.pieces.find((x) => x.id === id)!;
        p.vis = "partage";
        p.transmiseLe = "2026-10-28T09:00:00Z";
      }
      return { transmises: ids.length };
    });
    api.supprimer.mockReset().mockImplementation(async (id: string) => {
      base.pieces = base.pieces.filter((x) => x.id !== id);
      return true;
    });
  });
  afterEach(() => cleanup());

  it("range les seules pièces personnelles par mois, avec leur compte", async () => {
    const { container } = monter();
    await screen.findByText("pme.coffre.compte:3");
    const mois = [...container.querySelectorAll(".mois h2")].map((h) => h.textContent);
    expect(mois).toEqual(["octobre", "septembre"]);
    expect(container.querySelectorAll(".tuile")).toHaveLength(3);
    expect(screen.queryByText("EMETTEUR d")).toBeNull();
    // Chaque papier montre sa miniature.
    expect(container.querySelectorAll(".tuile .apercu")).toHaveLength(3);
  });

  it("garde les deux gestes éteints tant que rien n'est choisi", async () => {
    monter();
    await screen.findByText("pme.coffre.compte:3");
    const mettre = screen.getByRole("button", { name: "pme.coffre.mettre" });
    const supprimer = screen.getByRole("button", { name: "pme.coffre.supprimer" });
    expect(mettre).toHaveProperty("disabled", true);
    expect(supprimer).toHaveProperty("disabled", true);
    fireEvent.click(screen.getAllByRole("button", { name: "pme.coffre.choisir" })[0]!);
    expect(mettre).toHaveProperty("disabled", false);
    expect(supprimer).toHaveProperty("disabled", false);
  });

  it("met les papiers choisis dans la société, le dit, puis peut les transmettre", async () => {
    monter();
    await screen.findByText("pme.coffre.compte:3");
    const ronds = screen.getAllByRole("button", { name: "pme.coffre.choisir" });
    fireEvent.click(ronds[0]!);
    fireEvent.click(ronds[1]!);
    expect(ronds[0]!.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "pme.coffre.mettre" }));

    await screen.findByText("pme.coffre.mis.titre");
    expect(api.setPieceVis).toHaveBeenCalledWith("a", "entite");
    expect(api.setPieceVis).toHaveBeenCalledWith("b", "entite");
    expect(api.setPieceVis).not.toHaveBeenCalledWith(expect.anything(), "partage");
    screen.getByText("pme.coffre.mis.quoi:2");

    // La transmission reste un geste séparé, et finit sur « Envoyé ».
    fireEvent.click(screen.getByRole("button", { name: "pme.prive.transmettre" }));
    await screen.findByText("envoi.lot.tout:2");
    expect(api.transmettreLesPieces).toHaveBeenCalledWith(["a", "b"]);
    screen.getByText("envoi.lot.chez:2");
  });

  /*
   * Revue Codex de #146 : le lot d'un siège part chez le propriétaire et reste
   * `entite`. Le bouton nommait le comptable, et « Envoyé » n'apparaissait
   * jamais — un succès qui semblait n'avoir rien fait.
   */
  it("le siège envoie de Mon espace au propriétaire, et le voit sur « Envoyé »", async () => {
    base.droits = SIEGE;
    api.transmettreLesPieces.mockImplementation(async (ids: string[]) => {
      for (const id of ids) {
        const p = base.pieces.find((x) => x.id === id)!;
        p.circuit = {
          recoit: false,
          dernier: "envoyee",
          envoyeeLe: "2026-10-28T09:00:00Z",
          vueLe: null,
          vuePar: null,
          retourneeLe: null,
          retourPar: null,
          corrigeeLe: null,
          auteur: "Sami",
          mienne: true,
        };
      }
      return { transmises: ids.length };
    });
    monter();
    await screen.findByText("pme.coffre.compte:3");
    const ronds = screen.getAllByRole("button", { name: "pme.coffre.choisir" });
    fireEvent.click(ronds[0]!);
    fireEvent.click(ronds[1]!);
    fireEvent.click(screen.getByRole("button", { name: "pme.coffre.mettre" }));
    await screen.findByText("pme.coffre.mis.titre");
    expect(screen.queryByRole("button", { name: "pme.prive.transmettre" })).toBeNull();

    fireEvent.click(await screen.findByRole("button", { name: "circuit.envoyer" }));
    await screen.findByText("envoi.lot.tout:2");
    expect(api.transmettreLesPieces).toHaveBeenCalledWith(["a", "b"]);
    screen.getByText("circuit.lot.chez:2");
  });

  it("le propriétaire envoie de Mon espace au comptable, nommé sur le bouton et sur « Envoyé »", async () => {
    monter();
    await screen.findByText("pme.coffre.compte:3");
    fireEvent.click(screen.getAllByRole("button", { name: "pme.coffre.choisir" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "pme.coffre.mettre" }));
    await screen.findByText("pme.coffre.mis.titre");
    expect(screen.queryByRole("button", { name: "circuit.envoyer" })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "pme.prive.transmettre" }));
    await screen.findByText("envoi.lot.tout:1");
    screen.getByText("envoi.piece.chez");
  });

  it("un lot arrêté en route dit ce qui est passé, et garde le reste choisi", async () => {
    api.setPieceVis.mockImplementation(async (id: string, vis: PieceLue["vis"]) => {
      if (id === "b") throw new ErreurApi("REFUS_DE_LA_BASE", 409);
      base.pieces.find((x) => x.id === id)!.vis = vis;
      return true;
    });
    monter();
    await screen.findByText("pme.coffre.compte:3");
    const ronds = screen.getAllByRole("button", { name: "pme.coffre.choisir" });
    fireEvent.click(ronds[0]!);
    fireEvent.click(ronds[1]!);
    fireEvent.click(screen.getByRole("button", { name: "pme.coffre.mettre" }));

    const alerte = await screen.findByRole("alert");
    // « 1 sur 2 sont dans la société ; 1 reste choisi », puis la raison.
    expect(alerte.textContent).toContain("pme.coffre.partiel.mis:1");
    expect(alerte.textContent).toContain("REFUS_DE_LA_BASE");
    await screen.findByText("pme.coffre.compte:2");
    const restant = screen.getAllByRole("button", { name: "pme.coffre.choisir" });
    expect(restant.filter((b) => b.getAttribute("aria-pressed") === "true")).toHaveLength(1);
    expect(screen.queryByText("pme.coffre.mis.titre")).toBeNull();
  });

  it("montre le montant lu à côté de la date", async () => {
    base.pieces[0] = { ...base.pieces[0]!, total: "412.300", devise: "TND" };
    monter();
    await screen.findByText("pme.coffre.compte:3");
    expect(document.querySelector(".tuile .dt")!.textContent).toMatch(/412,300 TND/);
  });

  it("supprime après confirmation, et pas avant", async () => {
    monter();
    await screen.findByText("pme.coffre.compte:3");
    fireEvent.click(screen.getAllByRole("button", { name: "pme.coffre.choisir" })[2]!);
    fireEvent.click(screen.getByRole("button", { name: "pme.coffre.supprimer" }));
    expect(api.supprimer).not.toHaveBeenCalled();
    screen.getByRole("dialog", { name: "pme.coffre.supprimer.titre:1" });
    fireEvent.click(screen.getByRole("button", { name: "pme.supprimer.oui" }));
    await waitFor(() => expect(api.supprimer).toHaveBeenCalledWith("c"));
    await screen.findByText("pme.coffre.compte:2");
  });

  it("toucher un papier l'ouvre ; seul le rond le choisit", async () => {
    monter();
    await screen.findByText("pme.coffre.compte:3");
    fireEvent.click(screen.getByText("EMETTEUR a"));
    expect(api.navigate).toHaveBeenCalledWith({
      to: "/pme/piece/$pieceId",
      params: { pieceId: "a" },
    });
    expect(screen.getByRole("button", { name: "pme.coffre.mettre" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("en arabe, le rond reste au coin de fin de lecture (propriété logique)", () => {
    const feuille = readFileSync(path.resolve(__dirname, "../../../styles-pme.css"), "utf8");
    const regle = /\[data-ecran="coffre"\] \.choix\{([^}]*)\}/.exec(feuille)?.[1] ?? "";
    expect(regle).toContain("inset-inline-end:0");
    expect(regle).not.toMatch(/(^|;)(left|right):/);
  });
});
