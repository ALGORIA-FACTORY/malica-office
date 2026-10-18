/**
 * Les pièces qu'on vient de photographier, passées dans l'URL.
 *
 * ================================================================== POURQUOI
 *
 * L'écran de capture tient son lot de `capture.listAvecLecture`, filtré sur
 * `status === "capturee"` : toutes les pièces non lues du dossier. Pour un
 * dossier neuf, c'est exactement le lot qu'on vient de prendre. Pour le
 * dossier d'atelier — trente pièces jamais lues — c'est trente lignes, et
 * l'écran demanderait la destination de trente papiers pour une seule photo.
 *
 * L'obturateur passe donc les identifiants qu'il vient d'obtenir. Sans eux
 * (on ouvre l'écran pour reprendre ce qui traîne), le lot reste celui du
 * dossier : les deux usages existent, et aucun des deux n'est deviné.
 *
 * ============================================ CE QUI EST VÉRIFIÉ, ET POURQUOI
 *
 * Un paramètre d'URL vient de l'extérieur. On n'y lit donc que des
 * identifiants de la forme attendue, et au plus le plafond de la file : une
 * liste de dix mille jetons bricolée à la main ne doit pas devenir dix mille
 * comparaisons à chaque rendu. Ce qui ne ressemble pas à un identifiant est
 * JETÉ, pas corrigé — et un lot vide se comporte comme un lot absent, c'est-
 * à-dire comme « montre-moi ce qui traîne ».
 */
import { PLAFOND_ELEMENTS } from "@/lib/hors-ligne/file";

const UN_IDENTIFIANT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface LotDeCapture {
  /** Les pièces de ce passage, ou `undefined` : tout ce qui n'est pas lu. */
  pieces?: string;
}

export function lireLotDeCapture(search: Record<string, unknown>): LotDeCapture {
  const brut = search["pieces"];
  if (typeof brut !== "string") return {};
  const retenus = identifiantsDuLot(brut);
  return retenus.length === 0 ? {} : { pieces: retenus.join(",") };
}

/** Les identifiants d'un lot, dans l'ordre reçu, sans doublon ni intrus. */
export function identifiantsDuLot(brut: string | undefined): string[] {
  if (!brut) return [];
  const vus = new Set<string>();
  for (const morceau of brut.split(",")) {
    const jeton = morceau.trim().toLowerCase();
    if (UN_IDENTIFIANT.test(jeton)) vus.add(jeton);
    if (vus.size >= PLAFOND_ELEMENTS) break;
  }
  return [...vus];
}
