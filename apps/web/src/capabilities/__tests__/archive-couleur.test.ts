/**
 * L'archive garde la couleur. L'OCR peut bien travailler en gris.
 *
 * ================================================= LE DÉFAUT QUI L'A FAIT NAÎTRE
 *
 * 4 octobre 2026, première facture photographiée pour de vrai. L'archive
 * déposée sur le serveur : 1287 × 1800 px, moyenne RVB 244/244/244, et
 * surtout SATURATION MOYENNE ZÉRO — du gris pur, rangé dans un conteneur RVB.
 *
 * Ce n'était pas un accident : le code le faisait exprès, et le disait —
 * « les plans de chrominance du JPEG deviennent plats, la page pèse deux à
 * trois fois moins ». Le gain de poids est réel. Mais la pièce archivée est la
 * PREUVE : un tampon bleu, un surlignage, une mention manuscrite à l'encre
 * rouge, un logo — tout cela disparaît, et dix ans plus tard on ne peut plus
 * le rétablir.
 *
 * Décision du commanditaire : l'archive conserve la couleur. Le gris reste
 * utile à la lecture automatique, et il se refabrique à tout moment depuis la
 * couleur — l'inverse est faux.
 *
 * ===================================================================== LA RÈGLE
 *
 * L'étirement de dynamique est GARDÉ : c'est lui qui rend le texte net sur une
 * photo prise de biais, sous une lampe de bureau. Il s'applique désormais au
 * GAIN de chaque pixel — la luminance est étirée, les rapports entre rouge,
 * vert et bleu sont préservés. Le texte gagne le même contraste ; le tampon
 * reste bleu.
 */
import { describe, expect, it } from "vitest";

import { etirerEnGardantLaCouleur, PAGE_BYTES_BUDGET } from "../scanner";

/** Une image fabriquée : `n` pixels, chacun donné en RVB. */
function image(pixels: ReadonlyArray<readonly [number, number, number]>): ImageData {
  const data = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach(([r, v, b], i) => {
    data[i * 4] = r;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  });
  return { data, width: pixels.length, height: 1, colorSpace: "srgb" } as ImageData;
}

/** L'écart entre le canal le plus fort et le plus faible : 0 = gris. */
function saturation(d: Uint8ClampedArray, i: number): number {
  const r = d[i * 4]!;
  const v = d[i * 4 + 1]!;
  const b = d[i * 4 + 2]!;
  return Math.max(r, v, b) - Math.min(r, v, b);
}

describe("la préparation de la page archivée", () => {
  it("garde la couleur : un tampon bleu reste bleu", () => {
    // Une page claire, un tampon bleu franc, un trait d'encre noire.
    const img = image([
      [235, 236, 238],
      [40, 70, 180],
      [30, 30, 32],
      [240, 241, 243],
    ]);
    etirerEnGardantLaCouleur(img);

    expect(saturation(img.data, 1)).toBeGreaterThan(60);
    // Et c'est toujours le bleu qui domine, pas un autre canal.
    expect(img.data[1 * 4 + 2]).toBeGreaterThan(img.data[1 * 4]!);
  });

  it("étire quand même la dynamique : le texte gagne en contraste", () => {
    // Une page terne : tout entre 90 et 160. Après étirement, l'écart entre le
    // fond et l'encre doit s'être creusé.
    const img = image([
      [160, 160, 160],
      [90, 90, 90],
      [155, 158, 160],
      [95, 92, 90],
    ]);
    const avant = img.data[0]! - img.data[1 * 4]!;
    etirerEnGardantLaCouleur(img);
    const apres = img.data[0]! - img.data[1 * 4]!;

    expect(apres).toBeGreaterThan(avant);
  });

  it("ne rend jamais une image grise : la saturation moyenne reste non nulle", () => {
    // C'est la mesure exacte qui a révélé le défaut sur la vraie facture.
    const img = image([
      [220, 200, 150],
      [60, 90, 140],
      [200, 60, 60],
      [245, 245, 246],
    ]);
    etirerEnGardantLaCouleur(img);

    const moyenne = [0, 1, 2, 3].reduce((somme, i) => somme + saturation(img.data, i), 0) / 4;
    expect(moyenne).toBeGreaterThan(10);
  });

  it("laisse le noir noir et le blanc blanc", () => {
    const img = image([
      [0, 0, 0],
      [255, 255, 255],
    ]);
    etirerEnGardantLaCouleur(img);

    expect(img.data[0]).toBeLessThan(20);
    expect(img.data[1 * 4]).toBeGreaterThan(235);
  });

  it("ne noircit pas une page déjà propre : fond blanc, quelques lignes d'encre", () => {
    // ANO-024 (21 octobre 2026) : 98 % de blanc, les deux percentiles sur 255,
    // et la page entière sortait noire.
    const pixels: Array<[number, number, number]> = Array.from(
      { length: 200 },
      () => [255, 255, 255] as [number, number, number],
    );
    pixels[10] = [20, 20, 22];
    pixels[11] = [40, 70, 180];
    const img = image(pixels);
    etirerEnGardantLaCouleur(img);

    expect(img.data[0]).toBe(255);
    expect(img.data[50 * 4]).toBe(255);
    expect(img.data[10 * 4]).toBeLessThan(40);
    expect(saturation(img.data, 11)).toBeGreaterThan(60);
  });

  it("garde l'opacité pleine : un PDF n'a pas de transparence à inventer", () => {
    const img = image([
      [120, 130, 140],
      [200, 190, 180],
    ]);
    etirerEnGardantLaCouleur(img);

    expect(img.data[3]).toBe(255);
    expect(img.data[7]).toBe(255);
  });
});

describe("le poids de la page archivée", () => {
  it("reste sous le plafond de 350 Ko demandé", () => {
    // La garantie est structurelle : `compresserPage` descend la qualité
    // jusqu'à ce que la page entre dans ce budget. Ce test protège le budget
    // lui-même — qu'une correction de confort ne le relève pas sans le dire.
    expect(PAGE_BYTES_BUDGET).toBeLessThanOrEqual(350_000);
  });

  it("laisse assez de place pour une page couleur lisible", () => {
    // 190 000 octets convenaient au gris. En couleur, c'est trop serré : la
    // qualité tomberait au plancher sur toute facture un peu dense.
    expect(PAGE_BYTES_BUDGET).toBeGreaterThan(250_000);
  });
});
