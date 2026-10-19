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
 *
 * ====================================== CE QUI NE MARCHAIT PAS, ET LA MESURE
 *
 * 19 octobre 2026. Sur une facture de quatre lignes photographiée par le
 * dirigeant, l'écran « ce que j'ai lu, ligne par ligne » rendait les quatre
 * désignations et AUCUNE quantité, AUCUN prix unitaire, AUCUN montant de
 * ligne, alors que le pied de facture était juste. Les drapeaux des pièces
 * réelles de la base disent le reste : `MISSING_CITATION` sur
 * `articles[i].quantity`, `.unit_price_ht`, `.unit_price_ttc`, `.total_ht`.
 * Le désignateur n'avait cité que les désignations — et ce module, dont c'est
 * exactement l'objet, n'a rien rattrapé.
 *
 * Trois raisons, mesurées sur le plan réel du jeu d'or (177 jetons) :
 *
 *   1. un entête n'était reconnu que porté par UN jeton. Le plan est découpé
 *      sur les espaces : « Prix unitaire HT (DT) » est quatre jetons, dont
 *      aucun ne porte le libellé. La colonne du prix unitaire n'a donc JAMAIS
 *      pu être détectée sur une vraie facture ;
 *   2. la bande valait la boîte du jeton d'entête ± 60 % de sa largeur, alors
 *      que les chiffres sont alignés à droite sous l'entête entier ;
 *   3. la ligne du tableau était celle du PREMIER mot de la désignation. Une
 *      désignation qui court sur trois lignes imprimées — le cas normal — ne
 *      partage donc sa bande avec aucune de ses cellules.
 *
 * L'épreuve du module ne le voyait pas : son plan posait « P.U. HT » et
 * « Total HT » en un seul jeton chacun, et une désignation d'un seul mot.
 * C'est-à-dire un plan qu'aucun œil ne produit.
 */

import type { PageToken, TokenRef } from "./token-plan.ts";
import type { VisionArticle } from "./vision.ts";

type ArticleColumn = "quantity" | "unit_price_ht" | "unit_price_ttc" | "total_ht";

interface ColumnBand {
  column: ArticleColumn;
  x0: number;
  x1: number;
  page: number;
  y: number;
}

/**
 * Les entêtes reconnus.
 *
 * `designation` ne porte AUCUNE valeur : il ne sert qu'à attester qu'une ligne
 * imprimée est bien la ligne d'entêtes d'un tableau. Voir `detectColumnBands`.
 *
 * ================================= POURQUOI LES MOTIFS ACCEPTENT UN SUFFIXE
 *
 * « Prix unitaire HT », « Montant HT » : le suffixe d'assiette fait partie de
 * l'entête imprimé. L'exiger absent obligeait à ne retenir que « Prix
 * unitaire », donc une bande qui s'arrête avant les chiffres alignés à droite
 * sous « HT (DT) ». Mesuré sur le plan réel du jeu d'or : « 220,000 » tombait
 * à 0,0003 de largeur normalisée du bord de la bande.
 */
const HEADER_PATTERNS: Array<{ column: ArticleColumn | "designation"; re: RegExp }> = [
  {
    column: "designation",
    re: /^(d[eé]signation|libell[eé]|articles?|description|prestations?|البيان|الوصف|التعيين)$/i,
  },
  { column: "quantity", re: /^(qte|qté|qty|quantit[eé]|nbre|كمية|الكمية)$/i },
  { column: "unit_price_ttc", re: /^((p\.?u\.?|prixunitaire|prixu)ttc|سعرالوحدةمعالضريبة)$/i },
  { column: "unit_price_ht", re: /^((p\.?u\.?|prixunitaire|prixu)(ht)?|سعرالوحدة)$/i },
  { column: "total_ht", re: /^((total|montant)(ht|htva)?|المجموع|المبلغ)$/i },
];

/** Le nombre de mots qu'un entête peut occuper. « Prix unitaire HT » en fait trois. */
const MOTS_PAR_ENTETE = 4;

function key(text: string): string {
  return text
    .replace(/\u00a0|\s/g, "")
    .replace(/[.:()]/g, "")
    .toLowerCase();
}

function isNumericToken(text: string): boolean {
  return /\d/.test(text) && /^[\d\s.,()%\-+]+$/.test(text.replace(/\u00a0/g, " "));
}

const centreY = (t: PageToken): number => (t.y0 + t.y1) / 2;

/**
 * Une annotation d'unité : « (DT) », « (TND) », « (%) ».
 *
 * Elle appartient à la COLONNE — donc à la bande — mais pas au libellé dont on
 * reconnaît le motif. La distinguer évite d'avoir à écrire un code de devise
 * dans un motif, ce que R4 interdit.
 */
const estUnite = (t: PageToken): boolean => /^\(.+\)$/.test(t.text.trim());

/**
 * Les lignes imprimées du plan.
 *
 * Le plan est découpé sur les espaces : une ligne imprimée est l'ensemble des
 * jetons dont le centre vertical coïncide. Sans ce regroupement, un entête de
 * plusieurs mots — le cas normal — n'est jamais reconnu, parce qu'aucun de ses
 * jetons ne porte le libellé entier.
 */
function lignesImprimees(tokens: readonly PageToken[]): PageToken[][] {
  const ordre = [...tokens].sort(
    (a, b) => a.page - b.page || centreY(a) - centreY(b) || a.x0 - b.x0,
  );
  const lignes: PageToken[][] = [];
  let courante: PageToken[] = [];
  for (const t of ordre) {
    const premier = courante[0];
    const tolerance = Math.max(0.004, t.y1 - t.y0) * 0.75;
    if (
      !premier ||
      premier.page !== t.page ||
      Math.abs(centreY(t) - centreY(premier)) > tolerance
    ) {
      if (courante.length > 0) lignes.push([...courante].sort((a, b) => a.x0 - b.x0));
      courante = [t];
    } else {
      courante.push(t);
    }
  }
  if (courante.length > 0) lignes.push([...courante].sort((a, b) => a.x0 - b.x0));
  return lignes;
}

interface EnteteLu {
  column: ArticleColumn | "designation";
  x0: number;
  x1: number;
}

/**
 * Les entêtes portés par UNE ligne imprimée, de gauche à droite.
 *
 * On essaie, à chaque départ, le plus LONG groupe de mots contigus dont le
 * libellé correspond — « Montant HT » plutôt que « Montant » — et la bande
 * couvre tout le groupe, annotation d'unité comprise.
 */
function entetesDeLaLigne(ligne: readonly PageToken[]): EnteteLu[] {
  const lus: EnteteLu[] = [];
  let i = 0;
  while (i < ligne.length) {
    let trouve: { fin: number; column: ArticleColumn | "designation" } | null = null;
    for (let fin = i; fin < ligne.length && fin - i < MOTS_PAR_ENTETE; fin += 1) {
      const groupe = ligne.slice(i, fin + 1);
      const mots = groupe.filter((t) => !estUnite(t));
      if (mots.length === 0) continue;
      const k = key(mots.map((t) => t.text).join(""));
      if (!k) continue;
      const match = HEADER_PATTERNS.find((p) => p.re.test(k));
      if (match) trouve = { fin, column: match.column };
    }
    if (!trouve) {
      i += 1;
      continue;
    }
    // L'annotation d'unité qui suit le libellé appartient à la colonne.
    let fin = trouve.fin;
    while (fin + 1 < ligne.length && estUnite(ligne[fin + 1]!)) fin += 1;
    const groupe = ligne.slice(i, fin + 1);
    lus.push({
      column: trouve.column,
      x0: Math.min(...groupe.map((t) => t.x0)),
      x1: Math.max(...groupe.map((t) => t.x1)),
    });
    i = fin + 1;
  }
  return lus;
}

/**
 * Bandes de colonnes déduites des entêtes imprimés du tableau.
 *
 * Une colonne sans entête reconnaissable n'existe pas : on ne devine pas. Et
 * une ligne qui ne porte qu'UN entête n'est pas une ligne d'entêtes : « Total
 * HT » au pied de facture en est un, et prendre sa position pour celle de la
 * colonne des montants plaçait la bande dans la colonne des libellés. Deux
 * entêtes au moins sur la même ligne imprimée — le libellé des désignations
 * compte — et c'est un tableau.
 */
export function detectColumnBands(tokens: readonly PageToken[]): ColumnBand[] {
  const bands: ColumnBand[] = [];
  const seen = new Set<string>();
  for (const ligne of lignesImprimees(tokens)) {
    const entetes = entetesDeLaLigne(ligne);
    if (entetes.length < 2) continue;
    const y = centreY(ligne[0]!);
    for (const e of entetes) {
      if (e.column === "designation") continue;
      const id = `${ligne[0]!.page}:${e.column}`;
      // Un entête répété d'une page à l'autre garde le premier.
      if (seen.has(id)) continue;
      seen.add(id);
      bands.push({ column: e.column, x0: e.x0, x1: e.x1, page: ligne[0]!.page, y });
    }
  }
  return bands;
}

/** Les jetons de la plage citée pour la désignation — un seul, ou toute la plage. */
function jetonsDeLaDesignation(tokens: readonly PageToken[], ref: TokenRef | null): PageToken[] {
  if (!ref) return [];
  const fin =
    typeof ref.ordinalEnd === "number" && ref.ordinalEnd > ref.ordinal
      ? ref.ordinalEnd
      : ref.ordinal;
  return tokens
    .filter((t) => t.page === ref.page && t.ordinal >= ref.ordinal && t.ordinal <= fin)
    .sort((a, b) => a.ordinal - b.ordinal);
}

/**
 * Les cellules chiffrées de la ligne du tableau que la désignation occupe.
 *
 * L'ancrage portait sur le PREMIER jeton de la désignation seulement. Sur une
 * désignation qui court sur plusieurs lignes imprimées — le cas normal d'une
 * facture — les chiffres sont centrés verticalement sur le bloc entier, donc
 * aucun ne tombait dans la bande du premier mot : la réparation ne récupérait
 * rien. Mesuré sur le plan réel du jeu d'or le 19 octobre 2026.
 */
function cellulesDeLaLigne(
  tokens: readonly PageToken[],
  designation: readonly PageToken[],
): PageToken[] {
  const premier = designation[0]!;
  const marge = Math.max(0.004, premier.y1 - premier.y0) * 0.25;
  const haut = Math.min(...designation.map((t) => t.y0)) - marge;
  const bas = Math.max(...designation.map((t) => t.y1)) + marge;
  const sienne = new Set(designation.map((t) => `${t.page}.${t.ordinal}`));
  return tokens.filter((t) => {
    if (t.page !== premier.page) return false;
    if (sienne.has(`${t.page}.${t.ordinal}`)) return false;
    if (!isNumericToken(t.text)) return false;
    const cy = centreY(t);
    return cy >= haut && cy <= bas;
  });
}

const chevauche = (t: PageToken, bande: ColumnBand): boolean => t.x0 < bande.x1 && t.x1 > bande.x0;

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
    const designation = jetonsDeLaDesignation(tokens, article.designation);
    if (designation.length === 0) return article;
    const page = designation[0]!.page;
    const row = cellulesDeLaLigne(tokens, designation);
    if (row.length === 0) return article;

    const pick = (column: ArticleColumn): TokenRef | null => {
      const band = bands.find((b) => b.column === column && b.page === page);
      if (!band) return null;
      const candidates = row.filter((t) => chevauche(t, band));
      if (candidates.length !== 1) return null; // ambigu = on n'attribue rien
      const chosen = candidates[0]!;
      // Une cellule à cheval sur deux colonnes n'appartient à aucune.
      if (bands.filter((b) => b.page === page && chevauche(chosen, b)).length !== 1) return null;
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
