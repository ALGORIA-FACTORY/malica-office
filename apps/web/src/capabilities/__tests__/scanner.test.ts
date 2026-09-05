import { describe, expect, it } from "vitest";

import {
  affinerLesCoins,
  analyzeFrame,
  candidatsDocument,
  convexHull,
  detectQuad,
  maxAreaQuad,
  orderQuad,
  PETIT_COTE_MIN_PX,
  rayonDAffinage,
  SHARPNESS_MIN,
  simplifierContour,
  type Point,
} from "../scanner";

// ------------------------------------------------------------- fabrication

function fond(w: number, h: number, valeur = 30): Uint8ClampedArray {
  return new Uint8ClampedArray(w * h).fill(valeur);
}

/** Un quadrilatère convexe rempli : n'importe quelle forme, pas seulement un rectangle. */
function poser(
  gray: Uint8ClampedArray,
  w: number,
  h: number,
  coins: readonly Point[],
  valeur = 235,
): Uint8ClampedArray {
  const cote = (a: Point, b: Point, p: Point) =>
    (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const p = { x, y };
      let positifs = 0;
      let negatifs = 0;
      for (let i = 0; i < coins.length; i += 1) {
        const s = cote(coins[i]!, coins[(i + 1) % coins.length]!, p);
        if (s > 0) positifs += 1;
        else if (s < 0) negatifs += 1;
      }
      if (positifs === 0 || negatifs === 0) gray[y * w + x] = valeur;
    }
  }
  return gray;
}

function rectangle(x0: number, y0: number, x1: number, y1: number): Point[] {
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

/**
 * Du texte dans une bande verticale. C'est lui qui porte la netteté : une page
 * blanche n'en a aucune. Les marges latérales gardent la zone d'un seul tenant.
 */
function ecrire(
  gray: Uint8ClampedArray,
  w: number,
  h: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Uint8ClampedArray {
  for (let y = y0 + 6; y < y1 - 5; y += 6) {
    for (let x = x0 + 5; x < x1 - 4; x += 1) {
      if (x % 9 < 6) gray[y * w + x] = 20;
    }
  }
  return gray;
}

function flouter(gray: Uint8ClampedArray, w: number, h: number, rayon: number): Uint8ClampedArray {
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

const cote = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

// ------------------------------------------------------------------ géométrie

describe("scanner — géométrie", () => {
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

  it("un contour de centaines de points se réduit à ses vrais coins", () => {
    // Le bord d'un rectangle, échantillonné densément : quatre coins, pas cent.
    const contour: Point[] = [];
    for (let x = 0; x <= 100; x += 1) contour.push({ x, y: 0 });
    for (let y = 1; y <= 60; y += 1) contour.push({ x: 100, y });
    for (let x = 99; x >= 0; x -= 1) contour.push({ x, y: 60 });
    for (let y = 59; y >= 1; y -= 1) contour.push({ x: 0, y });
    expect(simplifierContour(contour, 4).length).toBeLessThanOrEqual(5);
  });

  it("le quadrilatère épouse un rectangle sans le déborder", () => {
    const quad = maxAreaQuad(rectangle(2, 3, 12, 9));
    expect(quad).not.toBeNull();
    expect(Math.min(...quad!.map((p) => p.x))).toBeCloseTo(2, 3);
    expect(Math.max(...quad!.map((p) => p.x))).toBeCloseTo(12, 3);
    expect(Math.min(...quad!.map((p) => p.y))).toBeCloseTo(3, 3);
    expect(Math.max(...quad!.map((p) => p.y))).toBeCloseTo(9, 3);
  });
});

// ---------------------------------------------------------- la perspective

describe("scanner — un document photographié de biais", () => {
  /*
   * LE DÉFAUT QUE CECI VERROUILLE
   *
   * L'ancien détecteur rendait le RECTANGLE d'aire minimale contenant la
   * silhouette. Sur ce trapèze, il aurait donné deux côtés horizontaux ÉGAUX
   * (180 et 180) : la perspective disparaissait, et le redressement projectif
   * recevait des coins qui n'étaient pas ceux du document.
   *
   * Un vrai quadrilatère garde le haut court et le bas large.
   */
  const L = 300;
  const H = 360;
  const trapeze = [
    { x: 120, y: 40 },
    { x: 180, y: 40 },
    { x: 240, y: 300 },
    { x: 60, y: 300 },
  ];

  it("garde le haut court et le bas large", () => {
    const quad = detectQuad(poser(fond(L, H), L, H, trapeze), L, H);
    expect(quad).not.toBeNull();
    const haut = cote(quad![0]!, quad![1]!);
    const bas = cote(quad![3]!, quad![2]!);
    expect(haut).toBeGreaterThan(40);
    expect(haut).toBeLessThan(85);
    expect(bas).toBeGreaterThan(155);
    // Le rapport est celui du document réel : 60 contre 180.
    expect(bas / haut).toBeGreaterThan(2);
  });

  it("place ses quatre coins sur ceux du document", () => {
    const quad = detectQuad(poser(fond(L, H), L, H, trapeze), L, H);
    const attendus = orderQuad(trapeze);
    for (let i = 0; i < 4; i += 1) {
      expect(cote(quad![i]!, attendus[i]!)).toBeLessThan(14);
    }
  });
});

// ------------------------------------------------------------- les formats

describe("scanner — n'importe quel format", () => {
  const L = 300;
  const H = 400;

  /*
   * LE DÉFAUT QUE CECI VERROUILLE
   *
   * L'ancien détecteur exigeait qu'une tache occupe 12 % de l'image pour être
   * seulement CONSIDÉRÉE, et 22 % pour être acceptée. Un ticket de caisse tenu
   * à bout de bras en occupe moins de 10 % : il n'était jamais détecté, quelle
   * que soit la qualité de la photo.
   */
  it("trouve un ticket de caisse qui n'occupe que 8 % du cadre", () => {
    const gray = poser(fond(L, H), L, H, rectangle(120, 60, 180, 340));
    const part = (60 * 280) / (L * H);
    expect(part).toBeLessThan(0.15);
    const quad = detectQuad(gray, L, H);
    expect(quad).not.toBeNull();
    expect(cote(quad![0]!, quad![1]!)).toBeGreaterThan(50); // largeur du ticket
    expect(cote(quad![0]!, quad![3]!)).toBeGreaterThan(260); // sa longueur
  });

  it("trouve aussi une carte, large et basse", () => {
    const quad = detectQuad(poser(fond(L, H), L, H, rectangle(30, 160, 270, 300)), L, H);
    expect(quad).not.toBeNull();
    expect(cote(quad![0]!, quad![1]!)).toBeGreaterThan(220);
  });

  it("trouve une facture qui remplit presque le cadre", () => {
    const quad = detectQuad(poser(fond(L, H), L, H, rectangle(12, 12, 288, 388)), L, H);
    expect(quad).not.toBeNull();
    expect(cote(quad![0]!, quad![1]!)).toBeGreaterThan(250);
  });

  /*
   * LE DÉFAUT QUE CECI VERROUILLE
   *
   * L'ancien détecteur prenait la PLUS GRANDE tache claire, sans jamais
   * demander si elle ressemblait à un document. Ici le triangle est presque
   * trois fois plus grand que le ticket, et c'est le ticket qu'il faut.
   */
  it("préfère la forme qui ressemble à une feuille, pas la plus grande", () => {
    // Une grande zone claire en L — un plan de travail, un mur, un reflet.
    // Quatre fois l'aire du ticket, et pourtant : ce n'est pas une feuille.
    let gray = fond(L, H);
    gray = poser(gray, L, H, rectangle(10, 10, 290, 80));
    gray = poser(gray, L, H, rectangle(10, 80, 90, 340));
    gray = poser(gray, L, H, rectangle(150, 250, 230, 380));

    const classement = candidatsDocument(gray, L, H);
    expect(classement.length).toBeGreaterThanOrEqual(2);
    const gagnant = classement[0]!;
    const perdant = classement[1]!;

    expect(gagnant.aire).toBeLessThan(perdant.aire);
    expect(gagnant.ressemblance).toBeGreaterThan(perdant.ressemblance);
    // Le L est creux : son quadrilatère englobe du vide, celui du ticket non.
    expect(perdant.remplissage).toBeLessThan(gagnant.remplissage);
    // Le gagnant est bien le ticket, large de 80 px.
    expect(cote(gagnant.quad[0]!, gagnant.quad[1]!)).toBeCloseTo(80, -1);
    expect(detectQuad(gray, L, H)).not.toBeNull();
  });

  it("écarte une silhouette qui n'a pas quatre côtés", () => {
    // Un triangle n'est pas un document : aucun candidat n'en sort.
    const gray = poser(fond(L, H), L, H, [
      { x: 20, y: 20 },
      { x: 280, y: 20 },
      { x: 150, y: 320 },
    ]);
    expect(candidatsDocument(gray, L, H)).toHaveLength(0);
    expect(detectQuad(gray, L, H)).toBeNull();
  });

  it("ne cadre rien sur une image uniforme", () => {
    expect(detectQuad(new Uint8ClampedArray(100 * 100).fill(240), 100, 100)).toBeNull();
  });
});

// --------------------------------------------------------------- le verdict

/**
 * Le verdict de cadrage — le seul voyant du produit qui promette quelque chose.
 *
 * Vert veut dire « votre photo sera acceptée ». S'il se trompe, la prise est
 * refusée APRÈS le déclenchement, et l'utilisateur ne comprend pas pourquoi.
 */
describe("scanner — le verdict que voit l'utilisateur", () => {
  const L = 300;
  const H = 400;
  /** Le ticket : 60 px de large sur une trame de 400 px de haut. */
  const ticket = () =>
    ecrire(poser(fond(L, H), L, H, rectangle(120, 60, 180, 340)), L, H, 120, 60, 180, 340);

  it("dit « rien à cadrer » sur une image uniforme", () => {
    const a = analyzeFrame(trame(fond(L, H, 240), L, H), 4000);
    expect(a.reason).toBe("no_document");
    expect(a.ok).toBe(false);
  });

  /*
   * LE CHANGEMENT DE CRITÈRE
   *
   * « Occupe-t-il 22 % du cadre ? » écartait tous les petits formats. La
   * question juste est « sera-t-il lisible ? », et elle se répond en pixels de
   * la photo d'origine. Le MÊME ticket, au même endroit du cadre, est accepté
   * sur un capteur de téléphone et refusé sur une image basse définition.
   */
  it("accepte le ticket quand la caméra a la définition pour le lire", () => {
    const a = analyzeFrame(trame(ticket(), L, H), 4000);
    expect(a.coverage).toBeLessThan(0.15);
    expect(a.petitCotePx).toBeGreaterThanOrEqual(PETIT_COTE_MIN_PX);
    expect(a.reason).toBe("ok");
    expect(a.ok).toBe(true);
  });

  it("dit « approchez » quand la définition ne suffit pas, à cadrage égal", () => {
    const a = analyzeFrame(trame(ticket(), L, H), 900);
    expect(a.petitCotePx).toBeLessThan(PETIT_COTE_MIN_PX);
    expect(a.reason).toBe("too_small");
    expect(a.ok).toBe(false);
  });

  it("dit « stabilisez » quand le même ticket est flou", () => {
    const flou = analyzeFrame(trame(flouter(ticket(), L, H, 6), L, H), 4000);
    expect(flou.sharpness).toBeLessThan(SHARPNESS_MIN);
    expect(flou.reason).toBe("blurry");
    expect(flou.ok).toBe(false);
  });

  /*
   * LE DÉFAUT QUE CECI VERROUILLE
   *
   * La netteté se mesurait sur TOUTE l'image. Un document flou posé sur une
   * surface à motifs — un plan de travail, une nappe, un tapis de bureau —
   * passait pour net : c'est le motif du fond qu'on mesurait, pas le document.
   * L'utilisateur déclenchait au vert et obtenait une photo illisible.
   */
  it("juge la netteté du document, pas celle du fond", () => {
    const L2 = 300;
    const H2 = 400;
    // Un fond très texturé : sa netteté propre est élevée.
    const texture = fond(L2, H2);
    for (let i = 0; i < texture.length; i += 1) texture[i] = i % 7 < 3 ? 15 : 70;

    const net = ecrire(
      poser(texture.slice(), L2, H2, rectangle(120, 60, 180, 340)),
      L2,
      H2,
      120,
      60,
      180,
      340,
    );
    // On ne floute QUE le document, en laissant le fond intact.
    const flouPartout = flouter(net, L2, H2, 6);
    const documentFlou = net.slice();
    for (let y = 55; y < 345; y += 1) {
      for (let x = 115; x < 185; x += 1) {
        documentFlou[y * L2 + x] = flouPartout[y * L2 + x]!;
      }
    }

    const a = analyzeFrame(trame(documentFlou, L2, H2), 4000);
    expect(a.reason).toBe("blurry");
    expect(a.ok).toBe(false);
  });

  it("signale la page vierge, qui ferme le document", () => {
    const a = analyzeFrame(trame(poser(fond(L, H), L, H, rectangle(20, 20, 280, 380)), L, H), 4000);
    expect(a.blank).toBe(true);
  });
});

describe("affinerLesCoins", () => {
  const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

  it("accroche des coins approximatifs aux bords réels de la feuille", () => {
    // Une feuille légèrement inclinée sur une table sombre, à pleine résolution.
    const w = 1200;
    const h = 1600;
    const vrais: Point[] = [
      { x: 180, y: 210 },
      { x: 1010, y: 240 },
      { x: 990, y: 1390 },
      { x: 160, y: 1360 },
    ];
    let g = fond(w, h, 60);
    g = poser(g, w, h, vrais, 235);
    g = flouter(g, w, h, 1);

    // Ce qu'un détecteur rend après remontée d'échelle : proche, mais lâche —
    // une quinzaine de pixels, tantôt dehors, tantôt dedans.
    const approx: Point[] = [
      { x: 165, y: 198 },
      { x: 1026, y: 252 },
      { x: 978, y: 1402 },
      { x: 172, y: 1349 },
    ];
    const affine = affinerLesCoins(g, w, h, approx);
    for (let i = 0; i < 4; i += 1) {
      expect(distance(affine[i]!, vrais[i]!)).toBeLessThan(2.5);
    }
  });

  it("rend le quadrilatère intact quand aucun bord n'est trouvable", () => {
    const w = 600;
    const h = 800;
    const g = fond(w, h, 128);
    const approx = rectangle(80, 100, 520, 700);
    expect(affinerLesCoins(g, w, h, approx)).toEqual(approx);
  });

  it("ne se laisse pas attirer par le bord d'une feuille voisine", () => {
    // Deux feuilles côte à côte : le bord voisin pourrait attirer un côté.
    const w = 1000;
    const h = 800;
    let g = fond(w, h, 50);
    g = poser(g, w, h, rectangle(100, 100, 480, 700), 235);
    g = poser(g, w, h, rectangle(520, 100, 900, 700), 235);
    // Un quadrilatère qui couvre les deux : les bords intérieurs sont à vingt
    // pixels, hors du rayon — seuls les bords extérieurs, déjà justes, comptent.
    const approx = rectangle(100, 100, 900, 700);
    const affine = affinerLesCoins(g, w, h, approx, 8);
    for (let i = 0; i < 4; i += 1) {
      expect(distance(affine[i]!, approx[i]!)).toBeLessThan(1.5);
    }
  });

  it("dimensionne le rayon sur le grand côté, jamais sous six pixels", () => {
    expect(rayonDAffinage(1800, 1350)).toBe(45);
    expect(rayonDAffinage(100, 80)).toBe(6);
  });
});
