import { createCanvas, loadImage } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";

import { decouperEnBandes, fusionnerBandes, type Bande } from "../bandes.server";
import type { PageToken } from "../token-plan";

function mot(text: string, y0: number, y1: number, ordinal = 0): PageToken {
  return { page: 1, ordinal, text, x0: 0.1, y0, x1: 0.3, y1 };
}

describe("fusionnerBandes", () => {
  const haut: Bande = { dataUrl: "", y0: 0, y1: 0.53 };
  const bas: Bande = { dataUrl: "", y0: 0.47, y1: 1 };

  it("replace les positions dans le repère de la page", () => {
    const fusion = fusionnerBandes(
      [
        { bande: haut, tokens: [mot("Facture", 0.1, 0.2)] },
        { bande: bas, tokens: [mot("Total", 0.8, 0.9)] },
      ],
      1,
    );
    expect(fusion).toHaveLength(2);
    // 0.1 dans une bande de hauteur 0.53 → 0.053 dans la page.
    expect(fusion[0]!.y0).toBeCloseTo(0.053, 3);
    expect(fusion[0]!.y1).toBeCloseTo(0.106, 3);
    // 0.8 dans la bande basse (0.47 → 1) → 0.47 + 0.8 × 0.53 = 0.894.
    expect(fusion[1]!.y0).toBeCloseTo(0.894, 3);
    expect(fusion[1]!.y1).toBeCloseTo(0.947, 3);
  });

  it("garde la ligne du chevauchement une seule fois, du côté du haut", () => {
    // La même ligne « TVA 19 % » lue par les deux bandes : à 0.5 de page,
    // c'est le bas de la bande haute et le haut de la bande basse.
    const enHaut = mot("TVA", (0.49 - 0) / 0.53, (0.51 - 0) / 0.53);
    const enBas = mot("TVA", (0.49 - 0.47) / 0.53, (0.51 - 0.47) / 0.53);
    const fusion = fusionnerBandes(
      [
        { bande: haut, tokens: [enHaut] },
        { bande: bas, tokens: [enBas, mot("Total", 0.9, 0.95)] },
      ],
      1,
    );
    expect(fusion.map((t) => t.text)).toEqual(["TVA", "Total"]);
  });

  it("renumérote les ordinaux dans l'ordre des bandes puis de la lecture", () => {
    const fusion = fusionnerBandes(
      [
        { bande: haut, tokens: [mot("a", 0.1, 0.2, 7), mot("b", 0.3, 0.4, 9)] },
        { bande: bas, tokens: [mot("c", 0.8, 0.9, 0)] },
      ],
      3,
    );
    expect(fusion.map((t) => [t.text, t.ordinal, t.page])).toEqual([
      ["a", 0, 3],
      ["b", 1, 3],
      ["c", 2, 3],
    ]);
  });
});

describe("decouperEnBandes", () => {
  it("découpe une page en bandes qui se chevauchent et couvrent tout", async () => {
    const toile = createCanvas(120, 400);
    const g = toile.getContext("2d");
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, 120, 400);
    const dataUrl = toile.toDataURL("image/jpeg", 0.9);

    const bandes = await decouperEnBandes(dataUrl, 2, 0.1);
    expect(bandes).toHaveLength(2);
    expect(bandes[0]!.y0).toBe(0);
    expect(bandes[1]!.y1).toBe(1);
    // Chevauchement : la première descend sous la moitié, la seconde remonte au-dessus.
    expect(bandes[0]!.y1).toBeGreaterThan(0.5);
    expect(bandes[1]!.y0).toBeLessThan(0.5);

    const image = await loadImage(bandes[0]!.dataUrl);
    expect(image.width).toBe(120);
    expect(image.height).toBe(Math.round(bandes[0]!.y1 * 400));
  });
});
