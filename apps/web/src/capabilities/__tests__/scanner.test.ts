import { describe, expect, it } from "vitest";

import {
  analyzeFrame,
  convexHull,
  COVERAGE_MIN,
  detectQuad,
  minAreaQuad,
  orderQuad,
  SHARPNESS_MIN,
} from "../scanner";

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

/**
 * Une trame RVBA à partir d'une carte de gris, telle que `analyzeFrame` la reçoit.
 */
function trame(gray: Uint8ClampedArray, w: number, h: number): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < gray.length; i += 1) {
    const v = gray[i]!;
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  return { data, width: w, height: h, colorSpace: "srgb" } as ImageData;
}

/** Du texte : c'est lui qui porte la netteté, une page blanche n'en a aucune. */
function avecTexte(gray: Uint8ClampedArray, w: number, h: number, inset: number) {
  for (let y = inset + 6; y < h - inset - 6; y += 6) {
    for (let x = inset + 5; x < w - inset - 5; x += 1) {
      if (x % 9 < 6) gray[y * w + x] = 20;
    }
  }
  return gray;
}

/** Un flou de boîte : le même document, mais pris en bougeant. */
function flouter(gray: Uint8ClampedArray, w: number, h: number, rayon: number) {
  const sortie = new Uint8ClampedArray(gray.length);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let somme = 0;
      let n = 0;
      for (let dy = -rayon; dy <= rayon; dy += 1) {
        for (let dx = -rayon; dx <= rayon; dx += 1) {
          const yy = y + dy;
          const xx = x + dx;
          if (yy < 0 || yy >= h || xx < 0 || xx >= w) continue;
          somme += gray[yy * w + xx]!;
          n += 1;
        }
      }
      sortie[y * w + x] = Math.round(somme / n);
    }
  }
  return sortie;
}

/**
 * Le verdict de cadrage — le seul voyant du produit qui promette quelque chose.
 *
 * Vert veut dire « votre photo sera acceptée ». S'il se trompe, la prise est
 * refusée APRÈS le déclenchement, et l'utilisateur ne comprend pas pourquoi.
 * Ces quatre cas sont exactement ceux que l'écran de capture affiche.
 */
describe("scanner — le verdict que voit l'utilisateur", () => {
  const L = 200;
  const H = 260;

  it("dit « rien à cadrer » sur une image uniforme", () => {
    const a = analyzeFrame(trame(new Uint8ClampedArray(L * H).fill(240), L, H));
    expect(a.reason).toBe("no_document");
    expect(a.ok).toBe(false);
  });

  it("dit « approchez » quand le document occupe trop peu de place", () => {
    const a = analyzeFrame(trame(avecTexte(syntheticPage(L, H, 62), L, H, 62), L, H));
    expect(a.coverage).toBeLessThan(COVERAGE_MIN);
    expect(a.reason).toBe("too_small");
    expect(a.ok).toBe(false);
  });

  it("dit « stabilisez » quand la même page est floue", () => {
    const net = avecTexte(syntheticPage(L, H, 16), L, H, 16);
    const flou = analyzeFrame(trame(flouter(net, L, H, 6), L, H));
    expect(flou.sharpness).toBeLessThan(SHARPNESS_MIN);
    expect(flou.reason).toBe("blurry");
    expect(flou.ok).toBe(false);
  });

  it("ne passe au vert que sur une page nette, grande et écrite", () => {
    const a = analyzeFrame(trame(avecTexte(syntheticPage(L, H, 16), L, H, 16), L, H));
    expect(a.coverage).toBeGreaterThanOrEqual(COVERAGE_MIN);
    expect(a.sharpness).toBeGreaterThanOrEqual(SHARPNESS_MIN);
    expect(a.reason).toBe("ok");
    expect(a.ok).toBe(true);
  });

  it("signale la page vierge, qui ferme le document", () => {
    const a = analyzeFrame(trame(syntheticPage(L, H, 16), L, H));
    expect(a.blank).toBe(true);
  });
});
