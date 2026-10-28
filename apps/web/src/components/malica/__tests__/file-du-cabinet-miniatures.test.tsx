// @vitest-environment jsdom
/**
 * La file du cabinet montre la vraie page de chaque pièce, à gauche du client
 * (« Malica sans blocage », 28 octobre 2026) : le comptable reconnaît la pièce
 * avant de l'ouvrir. Une miniature par ligne, et la miniature seulement.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { QueueItem } from "@malica/socle/ports/repositories";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  Link: ({ children }: { children: unknown }) => createElement("a", null, children as never),
}));
vi.mock("@/components/malica/cabinet-context", () => ({
  useCabinet: () => ({ org: { id: "cab" } }),
  useMalicaPanel: () => ({}),
}));
vi.mock("@/i18n", () => ({
  useI18n: () => ({ t: (cle: string) => cle, locale: "fr" }),
}));
vi.mock("@/verticals/malica-office/composition", () => ({
  office: () => ({ capture: { miniature: async () => null } }),
}));

import { QueueTable } from "@/routes/_authenticated/cabinet.index";

const ligne = (pieceId: string): QueueItem =>
  ({
    pieceId,
    clientName: `CLIENT ${pieceId}`,
    status: "lue",
    createdAt: "2026-10-27T08:00:00Z",
    libelle: null,
    dateEcriture: null,
    montant: null,
    collaborateur: null,
    demandeEnAttente: null,
  }) as unknown as QueueItem;

describe("la file du cabinet", () => {
  afterEach(() => cleanup());

  it("porte une vignette par pièce, décorative à côté du nom du client", () => {
    const client = new QueryClient();
    const { container } = render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(QueueTable, { rows: [ligne("p1"), ligne("p2")] }),
      ),
    );
    const vignettes = container.querySelectorAll(".apercu.vignette");
    expect(vignettes).toHaveLength(2);
    for (const v of vignettes) expect(v.getAttribute("aria-hidden")).toBe("true");
  });
});
