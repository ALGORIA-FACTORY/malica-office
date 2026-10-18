/**
 * Les ancres d'une page, et leur place — module pur.
 *
 * ============================== POURQUOI LA BOÎTE DE CONTENU, ET NON LA PAGE
 *
 * Les coordonnées d'un `PageToken` sont déjà normalisées 0..1 dans la page :
 * la résolution et le dpi ne les touchent pas. Le CADRAGE, lui, les touche —
 * et c'est le cas ordinaire de ce produit, pas son cas limite. Deux photos de
 * la même facture, l'une serrée, l'autre prise de plus loin avec la table
 * autour, n'ont pas les mêmes marges : tout ce qui est écrit y glisse et s'y
 * rétrécit, en bloc.
 *
 * On ne situe donc rien dans la page. On situe dans la BOÎTE DE CONTENU — le
 * rectangle de ce qui est écrit —, et une translation ou un changement
 * d'échelle disparaît par construction. C'est ce qui permet de tenir la
 * promesse du plan : des zones de page, jamais des coordonnées fixes.
 *
 * Les bandes sont indicées, pas nommées. Avec trois bandes, 0 est l'entête et
 * 2 le pied ; avec cinq, ce n'est plus vrai. Nommer serait figer le découpage
 * dans le code alors qu'il arrive par argument.
 */
import type { PageToken } from "@malica/socle/ports/malica";

import { cleDAncre } from "./signature-ecriture.ts";

/** Une ancre du document : sa clé, combien de fois on la voit, et où. */
export interface AncreSignature {
  cle: string;
  occurrences: number;
  /** Indices des bandes où l'ancre apparaît, croissants et sans doublon. */
  bandes: number[];
}

/** Une occurrence d'ancre, située dans la boîte de contenu de sa page. */
export interface AncrePlacee {
  cle: string;
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

interface Boite {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function boiteDeContenu(tokens: readonly PageToken[]): Boite | null {
  if (tokens.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const t of tokens) {
    x0 = Math.min(x0, t.x0);
    y0 = Math.min(y0, t.y0);
    x1 = Math.max(x1, t.x1);
    y1 = Math.max(y1, t.y1);
  }
  return { x0, y0, x1, y1 };
}

const part = (v: number, debut: number, etendue: number) =>
  etendue > 0 ? (v - debut) / etendue : 0;

/**
 * Les ancres d'une page : leur comptage, et chaque occurrence située.
 *
 * Une clé plus courte que la longueur exigée est écartée : « N° », « à »,
 * « le » ne décrivent aucune forme et ne feraient que du bruit dans la mesure.
 */
export function ancresDeLaPage(
  tokens: readonly PageToken[],
  longueurMinimale: number,
  bandes: number,
): { ancres: AncreSignature[]; placees: AncrePlacee[] } {
  const boite = boiteDeContenu(tokens);
  if (!boite) return { ancres: [], placees: [] };
  const largeur = boite.x1 - boite.x0;
  const hauteur = boite.y1 - boite.y0;

  const placees: AncrePlacee[] = [];
  const comptes = new Map<string, { occurrences: number; bandes: Set<number> }>();

  for (const t of tokens) {
    const cle = cleDAncre(t.text);
    if (cle === null || cle.length < longueurMinimale) continue;
    const v0 = part(t.y0, boite.y0, hauteur);
    const v1 = part(t.y1, boite.y0, hauteur);
    placees.push({
      cle,
      u0: part(t.x0, boite.x0, largeur),
      u1: part(t.x1, boite.x0, largeur),
      v0,
      v1,
    });
    const milieu = (v0 + v1) / 2;
    const bande = Math.max(0, Math.min(bandes - 1, Math.floor(milieu * bandes)));
    const vu = comptes.get(cle);
    if (vu) {
      vu.occurrences += 1;
      vu.bandes.add(bande);
    } else {
      comptes.set(cle, { occurrences: 1, bandes: new Set([bande]) });
    }
  }

  const ancres = [...comptes.entries()]
    .map(([cle, v]) => ({
      cle,
      occurrences: v.occurrences,
      bandes: [...v.bandes].sort((a, b) => a - b),
    }))
    .sort((a, b) => (a.cle < b.cle ? -1 : a.cle > b.cle ? 1 : 0));

  return { ancres, placees };
}
