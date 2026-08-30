import { describe, expect, it } from "vitest";

import { convexHull, detectQuad, minAreaQuad, orderQuad } from "../scanner";

/** Image de synthèse : page claire posée de biais sur un fond sombre. */
function syntheticPage(w: number, h: number, inset: number): Uint8ClampedArray {
  const gray = new Uint8ClampedArray(w * h).fill(30);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const insideX = x > inset && x < w - inset;
      const insideY = y > inset && y < h - inset;
      if (insideX && insideY) gray[y * w + x] = 235;
    }
  }
  return gray;
}

describe("scanner — géométrie du cadrage", () => {
  it("l'enveloppe convexe d'un carré bruité reste un carré", () => {
    const hull = convexHull([
      { x: 0, y: 0 },
      { x: 5, y: 5 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]);
    expect(hull).toHaveLength(4);
  });

  it("le quadrilatère d'aire minimale épouse un rectangle", () => {
    const quad = minAreaQuad([
      { x: 2, y: 3 },
      { x: 12, y: 3 },
      { x: 12, y: 9 },
      { x: 2, y: 9 },
    ]);
    expect(quad).toHaveLength(4);
    const xs = quad.map((p) => p.x);
    const ys = quad.map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(2, 3);
    expect(Math.max(...xs)).toBeCloseTo(12, 3);
    expect(Math.min(...ys)).toBeCloseTo(3, 3);
    expect(Math.max(...ys)).toBeCloseTo(9, 3);
  });

  it("les sommets sont ordonnés haut-gauche → bas-gauche", () => {
    const ordered = orderQuad([
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
    expect(ordered[0]).toEqual({ x: 0, y: 0 });
    expect(ordered[2]).toEqual({ x: 10, y: 10 });
  });

  it("détecte le document clair et exclut la marge sombre", () => {
    const quad = detectQuad(syntheticPage(120, 160, 12), 120, 160);
    expect(quad).not.toBeNull();
    const xs = quad!.map((p) => p.x);
    const ys = quad!.map((p) => p.y);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(10);
    expect(Math.max(...xs)).toBeLessThanOrEqual(110);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(10);
    expect(Math.max(...ys)).toBeLessThanOrEqual(150);
  });

  it("ne cadre rien sur une image uniforme", () => {
    const flat = new Uint8ClampedArray(100 * 100).fill(240);
    expect(detectQuad(flat, 100, 100)).toBeNull();
  });
});
