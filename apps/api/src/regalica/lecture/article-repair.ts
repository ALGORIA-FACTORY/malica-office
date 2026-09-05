/**
 * Réparation géométrique des lignes d'articles — module pur.
 *
 * Le modèle désigne parfois la désignation d'une ligne sans désigner toutes ses
 * colonnes (quantité, PU HT, PU TTC, total HT), selon la mise en page de la
 * facture. Ici, rien n'est inventé : on lit les entêtes du tableau imprimé pour
 * connaître la bande horizontale de chaque colonne, puis on complète la
 * désignation manquante par le token déjà lu qui se trouve sur la même ligne,
 * dans cette colonne. La valeur reste relue au plan de tokens.
 *
 * Aucun réseau, aucune base, aucun calcul monétaire.
 */

import type { PageToken, TokenRef } from "./token-plan.ts";
import type { VisionArticle } from "./vision.ts";

export type ArticleColumn = "quantity" | "unit_price_ht" | "unit_price_ttc" | "total_ht";

interface ColumnBand {
  column: ArticleColumn;
  x0: number;
  x1: number;
  page: number;
  y: number;
}

const HEADER_PATTERNS: Array<{ column: ArticleColumn; re: RegExp }> = [
  { column: "quantity", re: /^(qte|qté|qty|quantit[eé]|كمية|الكمية)$/i },
  { column: "unit_price_ttc", re: /^(p\.?u\.?ttc|puttc|prixunitairettc|سعرالوحدةمعالضريبة)$/i },
  { column: "unit_price_ht", re: /^(p\.?u\.?(ht)?|pu|prixunitaire|prixu|سعرالوحدة)$/i },
  { column: "total_ht", re: /^(totalht|montantht|total|montant|المجموع|المبلغ)$/i },
];

function key(text: string): string {
  return text
    .replace(/\u00a0|\s/g, "")
    .replace(/[.:()]/g, "")
    .toLowerCase();
}

function isNumericToken(text: string): boolean {
  return /\d/.test(text) && /^[\d\s.,()%\-+]+$/.test(text.replace(/\u00a0/g, " "));
}

/**
 * Bandes de colonnes déduites des entêtes imprimés du tableau.
 * Une colonne sans entête reconnaissable n'existe pas : on ne devine pas.
 */
export function detectColumnBands(tokens: readonly PageToken[]): ColumnBand[] {
  const bands: ColumnBand[] = [];
  for (const token of tokens) {
    const k = key(token.text);
    if (!k) continue;
    const match = HEADER_PATTERNS.find((p) => p.re.test(k));
    if (!match) continue;
    const width = Math.max(0.05, token.x1 - token.x0);
    bands.push({
      column: match.column,
      x0: token.x0 - width * 0.6,
      x1: token.x1 + width * 0.6,
      page: token.page,
      y: (token.y0 + token.y1) / 2,
    });
  }
  // Une colonne détectée plusieurs fois (entête répété par page) garde la première.
  const seen = new Set<string>();
  return bands.filter((b) => {
    const id = `${b.page}:${b.column}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function tokenOf(tokens: readonly PageToken[], ref: TokenRef | null): PageToken | null {
  if (!ref) return null;
  return tokens.find((t) => t.page === ref.page && t.ordinal === ref.ordinal) ?? null;
}

/** Tokens de la même bande horizontale qu'un token d'ancrage. */
function rowTokens(
  tokens: readonly PageToken[],
  anchor: PageToken,
  tolerance: number,
): PageToken[] {
  const cy = (anchor.y0 + anchor.y1) / 2;
  return tokens.filter((t) => {
    if (t.page !== anchor.page) return false;
    const ty = (t.y0 + t.y1) / 2;
    return Math.abs(ty - cy) <= tolerance;
  });
}

/**
 * Complète les colonnes manquantes des articles à partir du plan de tokens.
 * Un article dont la désignation n'est pas citée reste inchangé.
 */
export function repairArticles(
  tokens: readonly PageToken[],
  articles: readonly VisionArticle[],
): VisionArticle[] {
  const bands = detectColumnBands(tokens);
  if (bands.length === 0) return [...articles];

  return articles.map((article) => {
    const anchor = tokenOf(tokens, article.designation);
    if (!anchor) return article;
    const height = Math.max(0.004, anchor.y1 - anchor.y0);
    const row = rowTokens(tokens, anchor, height * 0.75).filter((t) => isNumericToken(t.text));
    if (row.length === 0) return article;

    const pick = (column: ArticleColumn): TokenRef | null => {
      const band = bands.find((b) => b.column === column && b.page === anchor.page);
      if (!band) return null;
      const candidates = row.filter((t) => {
        const cx = (t.x0 + t.x1) / 2;
        return cx >= band.x0 && cx <= band.x1;
      });
      if (candidates.length !== 1) return null; // ambigu = on n'attribue rien
      const chosen = candidates[0]!;
      return { page: chosen.page, ordinal: chosen.ordinal };
    };

    const used = new Set<string>();
    const keep = (ref: TokenRef | null): TokenRef | null => {
      if (!ref) return null;
      const id = `${ref.page}.${ref.ordinal}`;
      if (used.has(id)) return null;
      used.add(id);
      return ref;
    };

    // Les désignations déjà faites par le modèle sont réservées en premier.
    const quantity = keep(article.quantity);
    const unitHt = keep(article.unit_price_ht);
    const unitTtc = keep(article.unit_price_ttc);
    const totalHt = keep(article.total_ht);

    return {
      ...article,
      quantity: quantity ?? keep(pick("quantity")),
      unit_price_ht: unitHt ?? keep(pick("unit_price_ht")),
      unit_price_ttc: unitTtc ?? keep(pick("unit_price_ttc")),
      total_ht: totalHt ?? keep(pick("total_ht")),
    };
  });
}
