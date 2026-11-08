// @vitest-environment jsdom
/**
 * La file du cabinet montre la vraie page de chaque pièce, à gauche du client
 * (« Malica sans blocage », 28 octobre 2026) : le comptable reconnaît la pièce
 * avant de l'ouvrir. Une miniature par ligne, et la miniature seulement.
 *
 * Au téléphone, chaque ligne devient une carte (staging, 4 novembre 2026) :
 * la feuille la pose en grille à partir des cellules nommées ci-dessous. Une
 * cellule qui perd son nom retombe dans la colonne écrasée d'avant.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { QueueItem } from "@malica/socle/ports/repositories";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  Link: ({ children, className }: { children: unknown; className?: string }) =>
    createElement("a", { className }, children as never),
}));
vi.mock("@/components/malica/cabinet-context", () => ({
  useCabinet: () => ({ org: { id: "cab" } }),
  useMalicaPanel: () => ({}),
}));
vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (cle: string, vars?: Record<string, unknown>) =>
      vars ? `${cle} ${JSON.stringify(vars)}` : cle,
    locale: "fr",
  }),
}));

const fileDuCabinet: { lignes: QueueItem[] } = { lignes: [] };
vi.mock("@/verticals/malica-office/composition", () => ({
  office: () => ({
    capture: { miniature: async () => null },
    supervision: {
      listClients: async () => [{ tenantId: "t1", name: "CLIENT", engagementStatus: "actif" }],
      queue: async () => fileDuCabinet.lignes,
    },
    collab: {
      members: async () => [],
      assignments: async () => [],
      echeances: async () => [],
    },
  }),
}));

import { QueueTable } from "@/components/malica/file-du-cabinet";
import { Route } from "@/routes/_authenticated/cabinet.index";

const ligne = (pieceId: string, extra: Partial<QueueItem> = {}): QueueItem =>
  ({
    pieceId,
    tenantId: "t1",
    clientName: `CLIENT ${pieceId}`,
    status: "lue",
    statut: "recue",
    suivi: null,
    createdAt: "2026-10-27T08:00:00Z",
    envoyeeLe: "2026-10-27T08:00:00Z",
    libelle: null,
    dateEcriture: null,
    montant: null,
    collaborateur: null,
    demandeEnAttente: null,
    doublonDe: null,
    tiers: null,
    ...extra,
  }) as unknown as QueueItem;

function rendre(element: ReturnType<typeof createElement>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(createElement(QueryClientProvider, { client }, element));
}

describe("la file du cabinet", () => {
  afterEach(() => cleanup());

  it("porte une vignette par pièce, décorative à côté du nom du client", () => {
    const { container } = rendre(createElement(QueueTable, { rows: [ligne("p1"), ligne("p2")] }));
    const vignettes = container.querySelectorAll(".apercu.vignette");
    expect(vignettes).toHaveLength(2);
    for (const v of vignettes) expect(v.getAttribute("aria-hidden")).toBe("true");
  });

  it("nomme chaque cellule pour la carte du téléphone, sans dédoubler la ligne", () => {
    const { container } = rendre(
      createElement(QueueTable, {
        rows: [ligne("p1", { doublonDe: "p0", demandeEnAttente: "suppression" })],
      }),
    );
    expect(container.querySelector(".cab-table.cab-file")).not.toBeNull();
    const lignes = container.querySelectorAll("tbody tr");
    expect(lignes).toHaveLength(1);
    const cellules = [...lignes[0]!.querySelectorAll("td")].map((td) => td.className);
    for (const [i, nom] of [
      "cab-file-rang",
      "cab-file-client",
      "cab-file-libelle",
      "cab-file-montant",
      "cab-file-statut",
      "cab-file-attente",
      "cab-file-ouvrir",
    ].entries()) {
      expect(cellules[i]).toContain(nom);
    }
    // Le montant et l'attente disent leur nom sur la carte, où l'en-tête n'est plus.
    expect(container.querySelector(".cab-file-montant")?.getAttribute("data-label")).toBe(
      "cab.queue.amount",
    );
    expect(container.querySelector(".cab-file-attente")?.getAttribute("data-label")).toBe(
      "cab.queue.age",
    );
    // Les pastilles restent dans la carte, avec le client.
    const client = container.querySelector(".cab-file-client") as HTMLElement;
    expect(within(client).getByText("cab.file.doublon")).toBeTruthy();
    expect(within(client).getByText("cab.file.demande.suppression")).toBeTruthy();
  });

  it("nomme le fournisseur d'une pièce lue sans écriture", () => {
    const { container } = rendre(
      createElement(QueueTable, {
        rows: [ligne("p1", { tiers: "STE MYTEK INFORMATIQUE" }), ligne("p2")],
      }),
    );
    const libelles = [...container.querySelectorAll(".cab-file-libelle")].map(
      (td) => td.textContent,
    );
    expect(libelles[0]).toBe(
      `cab.queue.sansEcriture.tiers ${JSON.stringify({ tiers: "STE MYTEK INFORMATIQUE" })}`,
    );
    expect(libelles[1]).toBe("cab.queue.sansEcriture");
  });
});

describe("la puce « Doublons probables »", () => {
  afterEach(() => cleanup());
  const Accueil = (Route as unknown as { options: { component: () => null } }).options.component;

  it("n'apparaît pas quand aucune pièce n'est un doublon", async () => {
    fileDuCabinet.lignes = [ligne("p1"), ligne("p2")];
    rendre(createElement(Accueil));
    await screen.findByText(/cab\.today\.filter\.all/);
    expect(screen.queryByText(/cab\.today\.filter\.doublons/)).toBeNull();
  });

  it("compte les doublons et ne garde qu'eux dans la file", async () => {
    fileDuCabinet.lignes = [ligne("p1", { doublonDe: "p0" }), ligne("p2"), ligne("p3")];
    const { container } = rendre(createElement(Accueil));
    const puce = (await screen.findByText(/cab\.today\.filter\.doublons/)).closest("button")!;
    expect(puce.textContent).toContain("1");
    expect(container.querySelector("[data-pile]")?.textContent).toBe("3");
    fireEvent.click(puce);
    expect(puce.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector("[data-pile]")?.textContent).toBe("1");
    expect(container.textContent).toContain("CLIENT p1");
  });
});
