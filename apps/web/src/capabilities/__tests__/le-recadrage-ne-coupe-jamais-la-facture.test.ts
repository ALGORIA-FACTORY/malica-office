import { describe, expect, it } from "vitest";

import { bordsDejaPapier, quadPlausible, type Point } from "../scanner";

/**
 * Le recadrage ne coupe jamais la facture (recette du 20 octobre 2026).
 *
 * Une facture A4 envoyée en image avait été recadrée sur sa moitié haute : le
 * détecteur avait pris un cadre du tableau pour les bords de la feuille, et
 * les totaux étaient perdus.
 */

function image(w: number, h: number, remplir: (x: number, y: number) => number): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = remplir(x, y);
      const i = (y * w + x) * 4;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { width: w, height: h, data, colorSpace: "srgb" } as ImageData;
}

const rectangle = (x0: number, y0: number, x1: number, y1: number): Point[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

describe("le recadrage ne coupe jamais la facture", () => {
  it("un cadre de tableau dans la moitié haute n'est pas une feuille", () => {
    // 1240×1754 réduit à 452×640 : un cadre de 400×180 couvre 25 % de l'image.
    expect(quadPlausible(rectangle(26, 40, 426, 220), 452, 640)).toBe(false);
  });

  it("une feuille photographiée qui occupe l'essentiel du cadre l'est", () => {
    expect(quadPlausible(rectangle(30, 25, 420, 610), 452, 640)).toBe(true);
  });

  it("un scan dont les bords sont blancs est déjà la page", () => {
    const scan = image(200, 280, (x, y) => (x > 20 && x < 180 && y > 20 && y < 260 ? 60 : 250));
    expect(bordsDejaPapier(scan)).toBe(true);
  });

  it("une photo sur un bureau sombre n'est pas déjà la page", () => {
    const photo = image(200, 280, (x, y) => (x > 30 && x < 170 && y > 30 && y < 250 ? 240 : 70));
    expect(bordsDejaPapier(photo)).toBe(false);
  });
});
