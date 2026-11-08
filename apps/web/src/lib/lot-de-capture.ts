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
import { estUnIdentifiant } from "@/lib/identifiant";

export interface LotDeCapture {
  /** Les pièces de ce passage, ou `undefined` : tout ce qui n'est pas lu. */
  pieces?: string;
  /**
   * Partir de « Pour qui ? » plutôt que de l'appareil.
   *
   * 24 octobre 2026 : « À lire » (accueil, bibliothèque) rouvre des pièces DÉJÀ
   * prises. Leur reproposer l'appareil, c'était un écran de trop. Le seul
   * départ admis est celui-là, et seulement avec un lot : sans lot, il n'y a
   * rien à destiner, et le paramètre est jeté.
   */
  depart?: "destination";
  /*
   * ====================================== D'OÙ L'ON VIENT (planche 9, 7 novembre 2026)
   *
   * « Ajouter des pièces », tel qu'il existe, derrière chaque bouton — avec une
   * ligne qui dit d'où l'on vient. Trois contextes, et rien d'autre :
   *   - `dossier` : le code d'un des sept dossiers (tuile vide de l'accueil,
   *     « + » d'un dossier). La pièce y entre sans qu'on repose la question
   *     du type ; le code n'est retenu que s'il a la forme d'un code, et
   *     l'écran ne s'en sert que s'il est au référentiel ;
   *   - `pour=moi` : on vient de Privé, « Pour moi » est pré-choisi ;
   *   - `depuis=echeance` : on vient d'une échéance en retard (l'avis).
   */
  dossier?: string;
  pour?: "moi";
  depuis?: "echeance";
}

/** Un code de dossier du référentiel : des minuscules et des soulignés. */
const CODE_DE_DOSSIER = /^[a-z][a-z_]{0,39}$/;

export function lireLotDeCapture(search: Record<string, unknown>): LotDeCapture {
  const lot: LotDeCapture = {};
  const brut = search["pieces"];
  if (typeof brut === "string") {
    const retenus = identifiantsDuLot(brut);
    if (retenus.length > 0) {
      lot.pieces = retenus.join(",");
      if (search["depart"] === "destination") lot.depart = "destination";
    }
  }
  const dossier = search["dossier"];
  if (typeof dossier === "string" && CODE_DE_DOSSIER.test(dossier)) lot.dossier = dossier;
  if (search["pour"] === "moi") lot.pour = "moi";
  if (search["depuis"] === "echeance") lot.depuis = "echeance";
  return lot;
}

/**
 * L'URL après un dépôt : les pièces qu'on vient de prendre, et le contexte
 * d'où l'on vient (dossier, « pour moi »), gardé pour la photo suivante.
 * L'échéance n'est qu'une ligne d'en-tête : elle ne suit pas.
 */
export function suiteDuPassage(
  identifiants: readonly string[],
  contexte: LotDeCapture | null,
): LotDeCapture {
  return {
    ...(identifiants.length > 0 ? { pieces: identifiants.join(",") } : {}),
    ...(contexte?.dossier ? { dossier: contexte.dossier } : {}),
    ...(contexte?.pour ? { pour: contexte.pour } : {}),
  };
}

/** Les identifiants d'un lot, dans l'ordre reçu, sans doublon ni intrus. */
export function identifiantsDuLot(brut: string | undefined): string[] {
  if (!brut) return [];
  const vus = new Set<string>();
  for (const morceau of brut.split(",")) {
    const jeton = morceau.trim().toLowerCase();
    if (estUnIdentifiant(jeton)) vus.add(jeton);
    if (vus.size >= PLAFOND_ELEMENTS) break;
  }
  return [...vus];
}
