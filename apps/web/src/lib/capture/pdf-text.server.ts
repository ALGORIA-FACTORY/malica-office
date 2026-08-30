/**
 * Le relevé sans modèle — un PDF natif porte déjà son texte et sa géométrie.
 *
 * R2 poussé à son terme : quand la pièce est un PDF émis par un logiciel, le
 * plan de tokens ne se devine pas, il se lit. Chaque mot vient de la couche de
 * texte du document, avec sa position exacte. Aucun modèle n'intervient, donc
 * aucune hallucination n'est possible et la lecture ne coûte rien.
 *
 * Un PDF scanné n'est qu'une image dans une enveloppe : il ne porte aucune
 * couche de texte, `readPdfTextLayer` rend alors un plan vide et l'appelant
 * bascule sur l'œil.
 *
 * Module serveur, sans canvas : seul le texte est extrait, jamais un pixel.
 * C'est ce qui le rend exécutable sur Cloudflare Workers.
 */

import type { PageToken } from "./token-plan";

/** En deçà, la « couche de texte » n'est qu'un tampon ou un filigrane. */
const MIN_TOKENS_POUR_UNE_COUCHE = 12;

export interface PdfTextLayer {
  tokens: PageToken[];
  pages: number;
  /** Faux pour un PDF scanné : la lecture doit passer par l'œil. */
  exploitable: boolean;
}

interface TextItemLike {
  str?: string;
  width?: number;
  height?: number;
  transform?: number[];
}

/**
 * Un item de pdf.js couvre un fragment mis en page d'un coup — souvent une
 * ligne entière. Le plan de tokens raisonne en mots : on redécoupe, et la
 * largeur de l'item est répartie au prorata des caractères.
 *
 * C'est une approximation de la largeur de chaque mot, assumée : elle sert à
 * situer le mot dans sa colonne, jamais à produire une valeur. Le texte, lui,
 * est exact — il sort du document, pas d'une estimation.
 */
function decouperEnMots(
  item: TextItemLike,
  x: number,
  yHaut: number,
  yBas: number,
  largeur: number,
  pageLargeur: number,
  pageHauteur: number,
  page: number,
  premierOrdinal: number,
): PageToken[] {
  const texte = item.str ?? "";
  if (texte.trim().length === 0) return [];
  const total = texte.length;
  const sortie: PageToken[] = [];
  let ordinal = premierOrdinal;

  for (const m of texte.matchAll(/\S+/g)) {
    const debut = m.index ?? 0;
    const motX = x + (total > 0 ? (largeur * debut) / total : 0);
    const motLargeur = total > 0 ? (largeur * m[0].length) / total : largeur;
    sortie.push({
      page,
      ordinal,
      text: m[0],
      x0: Math.max(0, Math.min(1, motX / pageLargeur)),
      y0: Math.max(0, Math.min(1, yHaut / pageHauteur)),
      x1: Math.max(0, Math.min(1, (motX + motLargeur) / pageLargeur)),
      y1: Math.max(0, Math.min(1, yBas / pageHauteur)),
    });
    ordinal += 1;
  }
  return sortie;
}

export async function readPdfTextLayer(bytes: Uint8Array): Promise<PdfTextLayer> {
  // Le build `legacy` est le seul qui n'exige ni DOM ni `DOMMatrix` : c'est
  // celui qui tourne hors navigateur, en test comme sur Cloudflare Workers.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const tache = pdfjs.getDocument({
    data: bytes,
    // Une pièce comptable est une donnée, jamais un programme : aucune police
    // téléchargée, aucune ressource distante. (pdf.js v6 a supprimé l'évaluation
    // dynamique, il n'y a donc plus d'option à désactiver de ce côté.)
    disableFontFace: true,
    useSystemFonts: false,
    // On ne dessine rien : pas de canvas hors écran, absent de Workers.
    isOffscreenCanvasSupported: false,
    // Sans police embarquée, pdf.js réclame `standardFontDataUrl` — inutile
    // ici : on ne dessine rien, on ne lit que des positions et du texte.
    verbosity: 0,
  });
  const doc = await tache.promise;

  const tokens: PageToken[] = [];
  const pages = doc.numPages;
  try {
    for (let p = 1; p <= doc.numPages; p += 1) {
      const page = await doc.getPage(p);
      const viewport = page.getViewport({ scale: 1 });
      const contenu = await page.getTextContent();
      let ordinal = 0;

      for (const brut of contenu.items) {
        const item = brut as TextItemLike;
        if (typeof item.str !== "string" || item.transform === undefined) continue;

        // `viewport.transform` remet l'origine en haut à gauche : le plan de
        // tokens partage alors la convention des lectures par image.
        const t = pdfjs.Util.transform(viewport.transform, item.transform);
        const hauteur = Math.hypot(t[2] ?? 0, t[3] ?? 0) || (item.height ?? 0);
        const yBas = t[5] ?? 0;

        const mots = decouperEnMots(
          item,
          t[4] ?? 0,
          yBas - hauteur,
          yBas,
          item.width ?? 0,
          viewport.width,
          viewport.height,
          p,
          ordinal,
        );
        tokens.push(...mots);
        ordinal += mots.length;
      }
    }
  } finally {
    // C'est la tâche de chargement qui détient le document et son worker.
    await tache.destroy();
  }

  return {
    tokens,
    pages,
    exploitable: tokens.length >= MIN_TOKENS_POUR_UNE_COUCHE,
  };
}
