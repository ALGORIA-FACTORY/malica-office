// @vitest-environment jsdom
/**
 * La page A4 que le reçu et le bloc de réponse partagent : une taille, un seul
 * chemin du canevas au PDF — et un refus clair quand le navigateur ne dessine pas.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const scanner = vi.hoisted(() => ({ buildImagesPdf: vi.fn() }));
vi.mock("../scanner", () => ({ buildImagesPdf: scanner.buildImagesPdf }));

import { HAUTEUR_A4, LARGEUR_A4, nouvelleToileA4, pdfDesToiles } from "../page-a4";

function canevasQui(toBlob: (cb: BlobCallback) => void, ctx: unknown = {}): HTMLCanvasElement {
  return {
    width: 0,
    height: 0,
    getContext: () => ctx,
    toBlob: (cb: BlobCallback) => toBlob(cb),
  } as unknown as HTMLCanvasElement;
}

beforeEach(() => scanner.buildImagesPdf.mockReset());

describe("la page A4", () => {
  it("une toile A4 est blanche et de la taille de la page", () => {
    const rempli: unknown[] = [];
    const ctx = { fillRect: (...a: number[]) => rempli.push(a), fillStyle: "" };
    const brut = canevasQui(() => undefined, ctx);
    vi.spyOn(document, "createElement").mockReturnValueOnce(brut);
    const toile = nouvelleToileA4();
    expect(toile?.canevas.width).toBe(LARGEUR_A4);
    expect(toile?.canevas.height).toBe(HAUTEUR_A4);
    expect(rempli).toEqual([[0, 0, LARGEUR_A4, HAUTEUR_A4]]);
    expect(ctx.fillStyle).toBe("#FFFFFF");
  });

  it("sans contexte 2D, pas de toile : l'appelant lève sa propre erreur", () => {
    vi.spyOn(document, "createElement").mockReturnValueOnce(canevasQui(() => undefined, null));
    expect(nouvelleToileA4()).toBeNull();
  });

  it("les pages deviennent un PDF à la taille de la page, sous le titre donné", async () => {
    scanner.buildImagesPdf.mockReturnValue(new Blob(["pdf"]));
    const page = canevasQui((cb) => cb(new Blob([new Uint8Array([1, 2, 3])])));
    const pdf = await pdfDesToiles([page, page], "Mon titre", "x.encodage");
    expect(pdf).toBeInstanceOf(Blob);
    const [pages, titre] = scanner.buildImagesPdf.mock.calls[0] as [
      { jpeg: Uint8Array; widthPx: number; heightPx: number }[],
      string,
    ];
    expect(titre).toBe("Mon titre");
    expect(pages).toHaveLength(2);
    expect(pages[0]).toMatchObject({ widthPx: LARGEUR_A4, heightPx: HAUTEUR_A4 });
    expect([...pages[0]!.jpeg]).toEqual([1, 2, 3]);
  });

  it("un encodage qui échoue lève l'erreur de l'appelant", async () => {
    const page = canevasQui((cb) => cb(null));
    await expect(pdfDesToiles([page], "t", "bloc.encodage_impossible")).rejects.toThrow(
      "bloc.encodage_impossible",
    );
  });
});
