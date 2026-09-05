/**
 * Module de capacité « numérisation » — QUI cadre le document.
 *
 * ============================================================== POURQUOI
 *
 * Le cadrage fait dans le navigateur — détection de la silhouette, quatre
 * coins, redressement projectif — est écrit dans `scanner.ts` et il est
 * honnête. Il ne sera jamais aussi bon que celui du téléphone : Apple et
 * Google embarquent chacun un scanner de documents entraîné, avec correction
 * en direct, retouche des coins au doigt, nettoyage des ombres et des doigts
 * sur la feuille. C'est ce que fait n'importe quelle application de scan.
 *
 * Ces deux scanners sont déjà dans l'appareil de l'utilisateur. Les appeler ne
 * coûte AUCUN téléchargement. La bibliothèque équivalente en JavaScript —
 * OpenCV compilé pour le navigateur — pèse 15 Mo, et 30 Mo emballée : sur un
 * forfait mobile, c'est une taxe à chaque première photo.
 *
 *   iOS       VisionKit
 *   Android   ML Kit Document Scanner
 *   ailleurs  le cadrage de `scanner.ts`
 *
 * ============================================== POURQUOI CE MODULE EXISTE SEUL
 *
 * Rien ici ne sait ce qu'est une pièce comptable, et les écrans ne savent rien
 * de Capacitor. Le jour où la coque native n'existe pas — dans un navigateur de
 * bureau, dans l'aperçu, dans les épreuves — `numeriseur()` rend `null` et
 * l'écran cadre lui-même, sans rien changer d'autre.
 *
 * C'est aussi ce qui rend ce module éprouvable : le pont vers le monde natif
 * est une interface, pas un import caché.
 */

/** Ce que ce module a besoin de savoir du monde natif, et rien de plus. */
export interface PontNatif {
  /** Vrai dans la coque iOS ou Android ; faux dans un navigateur. */
  estNatif(): boolean;
  /** Ouvre le scanner de l'appareil. Rend les images en base64. */
  scanner(maxPages: number): Promise<{ images: string[]; annule: boolean }>;
}

/** Ce qui prend les pages, quelle qu'en soit l'origine. */
export interface Numeriseur {
  /** Sert au diagnostic et aux épreuves. Jamais affiché : ce n'est pas au client de savoir. */
  readonly origine: "natif";
  /**
   * Ouvre la capture et rend les pages DÉJÀ cadrées et redressées.
   * Une liste vide veut dire que l'utilisateur a renoncé — ce n'est pas une panne.
   */
  capturer(maxPages?: number): Promise<Blob[]>;
}

/** Le maximum que les deux plateformes acceptent : VisionKit s'arrête à 24. */
export const PAGES_MAX = 24;

/**
 * Une image base64 en octets.
 *
 * Le greffon peut préfixer la chaîne d'un en-tête `data:` ; les deux formes
 * arrivent selon la plateforme, et l'oublier donnerait un JPEG corrompu d'un
 * côté seulement — le genre de défaut qui ne se voit que sur un des deux
 * téléphones.
 */
export function blobDepuisBase64(base64: string, type = "image/jpeg"): Blob {
  const nu = base64.includes(",") ? base64.slice(base64.indexOf(",") + 1) : base64;
  const binaire = atob(nu);
  const octets = new Uint8Array(binaire.length);
  for (let i = 0; i < binaire.length; i += 1) octets[i] = binaire.charCodeAt(i);
  return new Blob([octets], { type });
}

/**
 * Le numériseur de l'appareil, s'il y en a un.
 *
 * `null` n'est pas un échec : c'est le cas normal dans un navigateur, et
 * l'appelant sait quoi en faire.
 */
export function numeriseur(pont: PontNatif): Numeriseur | null {
  if (!pont.estNatif()) return null;
  return {
    origine: "natif",
    async capturer(maxPages = PAGES_MAX) {
      const bornes = Math.max(1, Math.min(PAGES_MAX, Math.trunc(maxPages)));
      const { images, annule } = await pont.scanner(bornes);
      if (annule) return [];
      return images.map((image) => blobDepuisBase64(image));
    },
  };
}

/**
 * Le pont réel, vers Capacitor.
 *
 * Les imports sont différés : dans un navigateur, ce code n'est jamais chargé,
 * et le poids du greffon ne pèse pas sur la page.
 */
function pontCapacitor(): PontNatif {
  return {
    estNatif() {
      // `Capacitor` n'est posé sur la fenêtre que par la coque native.
      const global = globalThis as { Capacitor?: { isNativePlatform?: () => boolean } };
      return global.Capacitor?.isNativePlatform?.() === true;
    },
    async scanner(maxPages) {
      const { DocumentScanner } = await import("@capgo/capacitor-document-scanner");
      const reponse = await DocumentScanner.scanDocument({
        // Les octets directement : pas de chemin de fichier à relire, donc pas
        // de permission de lecture ni de nettoyage à faire après coup.
        responseType: "base64" as never,
        // L'utilisateur peut rattraper le cadrage au doigt. C'est précisément
        // la garantie qu'un détecteur automatique ne peut pas donner.
        letUserAdjustCrop: true,
        maxNumDocuments: maxPages,
        // Android : nettoyage par apprentissage — ombres, doigts, taches.
        scannerMode: "full" as never,
      });
      return {
        images: reponse.scannedImages ?? [],
        annule: reponse.status === "cancel",
      };
    },
  };
}

/** Le numériseur de l'appareil courant. */
export function numeriseurDeLAppareil(): Numeriseur | null {
  return numeriseur(pontCapacitor());
}
