// @vitest-environment jsdom
/**
 * La visionneuse de document — afficher la pièce, photo ou PDF, sans « Document illisible ».
 *
 * Garantit qu'une photo garde une URL locale vivante même en mode strict de React, que
 * « Réessayer » repart d'une URL neuve, que l'URL est révoquée au départ, et que pendant
 * l'ouverture d'un PDF l'aperçu de la pièce reste visible et le canevas encore vide caché
 * (il s'affichait en grand bloc noir sur téléphone).
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/i18n", () => ({
  useI18n: () => ({ t: (cle: string) => cle, locale: "fr", dir: "ltr" }),
}));
vi.mock("@/lib/journal-atelier", () => ({ noterAuJournal: vi.fn() }));

import { DocumentView } from "../document-view";

/** Les premiers octets d'un JPEG : ce n'est pas un PDF, c'est une image. */
const jpeg = () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]).buffer;

/**
 * Audit du 25 octobre 2026 : une photo JPEG s'ouvrait sur « Document
 * illisible ». L'URL locale était créée par un mémo et révoquée par un effet ;
 * le mode strict (démonter, remonter) révoquait celle que l'image affichait.
 */
describe("la visionneuse d'une photo", () => {
  let vivantes: Set<string>;
  let n: number;

  beforeEach(() => {
    vivantes = new Set();
    n = 0;
    URL.createObjectURL = vi.fn(() => {
      const url = `blob:essai/${++n}`;
      vivantes.add(url);
      return url;
    });
    URL.revokeObjectURL = vi.fn((url: string) => {
      vivantes.delete(url);
    });
  });
  afterEach(cleanup);

  it("affiche une URL vivante, même en mode strict", async () => {
    render(
      <StrictMode>
        <DocumentView contenu={jpeg()} highlight={null} label="pièce" />
      </StrictMode>,
    );
    const img = await screen.findByAltText("pièce");
    const src = img.getAttribute("src")!;
    expect(vivantes.has(src)).toBe(true);
  });

  it("« Réessayer » repart d'une URL neuve, pas de celle qui a échoué", async () => {
    render(<DocumentView contenu={jpeg()} highlight={null} label="pièce" />);
    const premiere = (await screen.findByAltText("pièce")).getAttribute("src")!;
    act(() => {
      fireEvent.error(screen.getByAltText("pièce"));
    });
    fireEvent.click(await screen.findByText("doc.retry"));
    await waitFor(() => {
      const src = screen.getByAltText("pièce").getAttribute("src")!;
      expect(src).not.toBe(premiere);
      expect(vivantes.has(src)).toBe(true);
    });
    expect(vivantes.has(premiere)).toBe(false);
  });

  it("révoque son URL en partant", async () => {
    const { unmount } = render(<DocumentView contenu={jpeg()} highlight={null} label="pièce" />);
    await screen.findByAltText("pièce");
    unmount();
    expect(vivantes.size).toBe(0);
  });
});

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  GlobalWorkerOptions: {},
  // Un document qui ne finit jamais de s'ouvrir : l'état d'attente, figé.
  getDocument: () => ({ promise: new Promise(() => {}), destroy: async () => {} }),
}));
vi.mock("pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker", () => ({
  default: class {},
}));

/** Les premiers octets d'un PDF. */
const pdf = () => new TextEncoder().encode("%PDF-1.7\n").buffer;

/**
 * Relevé sur staging le 29 octobre 2026, au téléphone : pendant « Ouverture du
 * document… », le canevas encore vide s'affichait en grand bloc noir.
 */
describe("la visionneuse pendant l'ouverture", () => {
  afterEach(cleanup);

  it("montre l'aperçu de la pièce, et cache le canevas encore vide", async () => {
    const { container } = render(
      <DocumentView
        contenu={pdf()}
        highlight={null}
        label="pièce"
        attente={<span data-testid="apercu" />}
      />,
    );
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("pme.doc.loading"));
    expect(screen.getByTestId("apercu")).toBeTruthy();
    expect(container.querySelector("canvas")?.classList.contains("hidden")).toBe(true);
  });
});
