/**
 * Une page trop dense se lit en bandes.
 *
 * ============================================================== POURQUOI
 *
 * L'œil (Qwen) rend chaque mot avec sa position : une facture dense — vingt
 * lignes d'articles, deux blocs d'adresse, un pied de page fiscal — dépasse
 * son plafond de sortie, et le relevé arrive tronqué. Jusqu'ici c'était une
 * panne sèche : « plafond de jetons atteint », et la personne devant un écran
 * qui ne lui proposait rien. Le même scan était passé la veille ; la sortie
 * d'un modèle n'est pas déterministe.
 *
 * Un plafond plus haut ne serait qu'un sursis. La bonne réponse est celle
 * de tout scanner sérieux : quand la page est trop dense, on la coupe en
 * bandes horizontales qui se chevauchent, on lit chaque bande, et l'on
 * recolle les relevés dans le repère de la page. Deux bandes lisent ce
 * qu'une seule ne pouvait pas ; quatre au besoin.
 *
 * ================================================================ COMMENT
 *
 *   découpage     `decouperEnBandes` — image de page → N images de bande,
 *                 avec un chevauchement pour qu'aucune ligne de texte ne
 *                 tombe sur une coupe ;
 *   recollage     `fusionnerBandes` — pur, éprouvé : replace les positions
 *                 dans le repère de la page, écarte les doublons de la zone
 *                 de chevauchement, renumérote dans l'ordre de lecture.
 */
import { createCanvas, loadImage } from "@napi-rs/canvas";

import type { PageToken } from "./token-plan.ts";

/** Une bande : son image, et sa place dans la page (0..1, de haut en bas). */
export interface Bande {
  dataUrl: string;
  y0: number;
  y1: number;
}

/** Part de la hauteur de page partagée par deux bandes voisines. */
export const CHEVAUCHEMENT = 0.06;

/** Le nombre de bandes maximal : au-delà, la page n'est pas dense, elle est illisible. */
export const BANDES_MAX = 4;

/**
 * Découpe une image de page en `nombre` bandes horizontales qui se
 * chevauchent de `chevauchement` (part de la hauteur de page).
 */
export async function decouperEnBandes(
  dataUrl: string,
  nombre: number,
  chevauchement = CHEVAUCHEMENT,
): Promise<Bande[]> {
  const image = await loadImage(dataUrl);
  const largeur = image.width;
  const hauteur = image.height;
  const bandes: Bande[] = [];
  for (let i = 0; i < nombre; i += 1) {
    const y0 = Math.max(0, i / nombre - (i === 0 ? 0 : chevauchement / 2));
    const y1 = Math.min(1, (i + 1) / nombre + (i === nombre - 1 ? 0 : chevauchement / 2));
    const haut = Math.round(y0 * hauteur);
    const bas = Math.round(y1 * hauteur);
    const toile = createCanvas(largeur, Math.max(1, bas - haut));
    const g = toile.getContext("2d");
    g.drawImage(image, 0, haut, largeur, bas - haut, 0, 0, largeur, bas - haut);
    bandes.push({
      dataUrl: toile.toDataURL("image/jpeg", 0.92),
      y0: haut / hauteur,
      y1: bas / hauteur,
    });
  }
  return bandes;
}

/**
 * Recolle les relevés de bandes dans le repère de la page.
 *
 * Chaque bande a lu ses positions entre 0 et 1 DANS la bande ; on les
 * ramène dans la page. Dans la zone de chevauchement, une même ligne a été
 * lue deux fois : on la garde de la bande du HAUT, et l'on écarte ce que la
 * bande du bas a lu au-dessus du milieu du chevauchement. Les ordinaux sont
 * renumérotés dans l'ordre des bandes puis de la lecture — c'est l'ordre
 * dans lequel le désignateur reçoit le plan.
 */
export function fusionnerBandes(
  lues: ReadonlyArray<{ bande: Bande; tokens: readonly PageToken[] }>,
  page: number,
): PageToken[] {
  const sortie: PageToken[] = [];
  let ordinal = 0;
  for (let i = 0; i < lues.length; i += 1) {
    const { bande, tokens } = lues[i]!;
    const precedente = i > 0 ? lues[i - 1]!.bande : null;
    // Milieu de la zone partagée avec la bande du dessus : au-dessus, c'est à elle.
    const frontiere = precedente ? (precedente.y1 + bande.y0) / 2 : -Infinity;
    const hauteur = bande.y1 - bande.y0;
    for (const t of tokens) {
      const y0 = bande.y0 + t.y0 * hauteur;
      const y1 = bande.y0 + t.y1 * hauteur;
      // Sur la frontière même, la ligne est à la bande du haut.
      if ((y0 + y1) / 2 <= frontiere) continue;
      sortie.push({
        ...t,
        page,
        ordinal,
        y0: Math.max(0, Math.min(1, y0)),
        y1: Math.max(0, Math.min(1, y1)),
      });
      ordinal += 1;
    }
  }
  return sortie;
}
