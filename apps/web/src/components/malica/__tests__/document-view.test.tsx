// @vitest-environment jsdom
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
