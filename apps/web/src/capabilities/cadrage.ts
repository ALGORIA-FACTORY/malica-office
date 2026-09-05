/**
 * Module de capacité « cadrage » — trouver les quatre coins de la feuille.
 *
 * ============================================== LE DÉFAUT QUI L'A FAIT NAÎTRE
 *
 * « La tasse de café est dans la photo. »
 *
 * C'est tout le problème, dit en une phrase. Le détecteur écrit à la main dans
 * `scanner.ts` cherche la plus grande zone claire qui ressemble à une feuille.
 * Sur un bureau réel — bois clair, sous-main, tasse, stylo, lumière de côté —
 * il ne trouve rien. Et quand il ne trouve rien, `preparePage` gardait la
 * photo ENTIÈRE sans rien dire : le bureau, la tasse, et la facture au milieu.
 *
 * L'utilisateur ne voyait aucune erreur. Il voyait une mauvaise photo, et
 * concluait que le produit ne savait pas scanner. Il avait raison.
 *
 * ===================================================== POURQUOI UNE CASCADE
 *
 * La détection par algorithme — seuils, contours, quadrilatère — échoue
 * précisément là où l'on scanne vraiment : fond encombré, contraste faible,
 * feuille tenue à la main. Ce n'est pas un défaut de réglage, c'est la limite
 * de la famille. Apple, Google et tous les scanners sérieux ont quitté
 * l'algorithme pour un modèle entraîné.
 *
 * On essaie donc, dans l'ordre :
 *
 *   1. le MODÈLE (DocCornerNet, via scanic) — robuste au désordre, et il rend
 *      une probabilité de présence de document ;
 *   2. l'ALGORITHME de scanic (Canny en WebAssembly) — meilleur que le mien ;
 *   3. mon détecteur — le dernier recours, hors ligne et sans téléchargement.
 *
 * ============================================ ET SI LES TROIS ÉCHOUENT ?
 *
 * On ne rend PAS la photo entière en silence. C'est exactement le défaut
 * d'origine. On le DIT, et l'écran propose d'ajuster les coins au doigt. Une
 * photo mal cadrée qu'on peut corriger vaut mieux qu'une photo mal cadrée
 * qu'on croit bonne.
 */
/*
 * Import de TYPE seulement, et l'implémentation en différé plus bas.
 *
 * `scanner.ts` appelle `cadrer`, et le détecteur de secours appelle
 * `detectQuad` : un import statique dans les deux sens formerait un cycle. Un
 * import de type est effacé à la compilation, et l'import différé n'a lieu
 * qu'à l'appel — il ne reste aucun cycle à l'exécution.
 */
import type { Point } from "./scanner";

/** Le résultat d'un cadrage, avec sa provenance — qui a trouvé, et à quel point. */
export interface Cadrage {
  /** Les quatre coins, ordonnés haut-gauche → bas-gauche. `null` : rien trouvé. */
  coins: Point[] | null;
  /**
   * Probabilité qu'il y ait bien un document dans l'image (0..1).
   *
   * Seul le modèle sait la dire. C'est elle qui distingue « une facture sur un
   * bureau » de « un bureau ». `null` quand la détection vient d'un algorithme,
   * qui ne sait pas répondre à cette question-là.
   */
  certitude: number | null;
  origine: "modele" | "algorithme" | "maison" | "aucune";
}

/** Ce que la cascade attend d'un détecteur, quel qu'il soit. */
export interface Detecteur {
  nom: Cadrage["origine"];
  trouver(image: ImageData): Promise<{ coins: Point[]; certitude: number | null } | null>;
}

/**
 * Au-dessous, on considère qu'il n'y a pas de document — c'est le seuil de
 * scanic lui-même. Il vaudra d'être mesuré sur de vraies photos plutôt que
 * gardé par défaut, comme l'a été le seuil du corpus juridique.
 */
export const CERTITUDE_MIN = 0.5;

const RIEN: Cadrage = { coins: null, certitude: null, origine: "aucune" };

/**
 * Le premier détecteur qui trouve gagne.
 *
 * Un détecteur qui échoue ne doit jamais faire échouer la cascade : le modèle
 * peut ne pas se charger — réseau coupé, appareil ancien —, et l'on doit
 * quand même pouvoir cadrer.
 */
export async function cadrerAvec(
  image: ImageData,
  detecteurs: readonly Detecteur[],
): Promise<Cadrage> {
  for (const d of detecteurs) {
    try {
      const trouve = await d.trouver(image);
      if (!trouve) continue;
      if (trouve.certitude !== null && trouve.certitude < CERTITUDE_MIN) continue;
      return { coins: trouve.coins, certitude: trouve.certitude, origine: d.nom };
    } catch {
      // Un détecteur indisponible passe la main au suivant, en silence :
      // l'utilisateur n'a pas à savoir lequel des trois a répondu.
    }
  }
  return RIEN;
}

/** Les coins de scanic, dans l'ordre de la maison. */
function ordonner(c: {
  topLeft: Point;
  topRight: Point;
  bottomRight: Point;
  bottomLeft: Point;
}): Point[] {
  return [c.topLeft, c.topRight, c.bottomRight, c.bottomLeft];
}

/**
 * Le modèle entraîné, chargé à la demande.
 *
 * Il ne pèse sur la page que lorsqu'on photographie : l'import est différé, et
 * scanic va chercher son modèle et son moteur au premier usage seulement.
 */
function detecteurModele(): Detecteur {
  return {
    nom: "modele",
    async trouver(image) {
      const { scanDocument } = await import("scanic");
      const r = await scanDocument(image, { mode: "detect", detector: "ml" });
      if (!r.success || !r.corners) return null;
      return { coins: ordonner(r.corners), certitude: r.score ?? null };
    },
  };
}

/** L'algorithme de scanic : Canny en WebAssembly, sans modèle à télécharger. */
function detecteurAlgorithme(): Detecteur {
  return {
    nom: "algorithme",
    async trouver(image) {
      const { scanDocument } = await import("scanic");
      const r = await scanDocument(image, { mode: "detect", detector: "classical" });
      if (!r.success || !r.corners) return null;
      // `confidence` n'est pas une probabilité de présence : on ne la fait pas
      // passer pour telle. Voir le commentaire de `certitude`.
      return { coins: ordonner(r.corners), certitude: null };
    },
  };
}

/** Le détecteur de la maison — hors ligne, sans rien à charger. */
function detecteurMaison(): Detecteur {
  return {
    nom: "maison",
    async trouver(image) {
      const { detectQuad, grayOf } = await import("./scanner");
      const coins = detectQuad(grayOf(image), image.width, image.height);
      return coins ? { coins, certitude: null } : null;
    },
  };
}

/** La cascade complète, dans l'ordre du plus robuste au plus disponible. */
export function cadrer(image: ImageData): Promise<Cadrage> {
  return cadrerAvec(image, [detecteurModele(), detecteurAlgorithme(), detecteurMaison()]);
}
