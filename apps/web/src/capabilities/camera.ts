/**
 * Pourquoi la caméra ne s'ouvre pas.
 *
 * ============================================================== LE PROBLÈME
 *
 * L'écran disait « Caméra indisponible sur cet appareil » quelle que soit la
 * cause. Sur un téléphone ouvert en HTTP, c'est un mensonge : l'appareil a une
 * caméra, c'est le NAVIGATEUR qui la réserve aux pages sécurisées. On envoyait
 * donc quelqu'un chercher une panne matérielle qui n'existe pas.
 *
 * C'est la même faute que « Vérifiez vos identifiants » quand le service est
 * arrêté : accuser l'innocent parce qu'on n'a pas su distinguer les cas.
 *
 * ============================================================= LES CAUSES
 *
 * Elles n'appellent pas le même geste, et c'est bien pour cela qu'il faut les
 * séparer :
 *
 *   contexte_non_securise — la page est en HTTP. Rien à régler sur l'appareil :
 *                           l'appareil photo natif prend le relais, et il donne
 *                           la même photo.
 *   refus                 — la permission a été refusée. Elle se redonne dans
 *                           les réglages du navigateur.
 *   absente               — il n'y a réellement pas de caméra. Le seul cas où
 *                           l'ancien message disait vrai.
 *   occupee               — une autre application la tient.
 *   inconnu               — on ne sait pas, et on le dit.
 */

export type MotifCamera = "contexte_non_securise" | "refus" | "absente" | "occupee" | "inconnu";

/**
 * @param erreur            Ce que `getUserMedia` a rejeté, s'il a été appelé.
 * @param contexteSecurise  `window.isSecureContext` — HTTPS, ou localhost.
 * @param apiPresente       `navigator.mediaDevices` existe-t-il.
 */
export function motifCamera(
  erreur: unknown,
  contexteSecurise: boolean,
  apiPresente: boolean,
): MotifCamera {
  // Le contexte prime sur tout le reste : hors HTTPS, le navigateur retire
  // l'interface elle-même, et l'erreur qui en sort ne dit rien d'utile.
  if (!contexteSecurise || !apiPresente) return "contexte_non_securise";

  const nom =
    erreur && typeof erreur === "object" && "name" in erreur
      ? String((erreur as { name: unknown }).name)
      : "";

  switch (nom) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "refus";
    case "SecurityError":
      // Levée quand la page n'est pas de confiance — même famille que le
      // contexte non sécurisé, du point de vue de la personne.
      return "contexte_non_securise";
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
      return "absente";
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return "occupee";
    default:
      return "inconnu";
  }
}

/** La clé de message qui dit la vérité pour ce motif. */
export function cleDuMotif(motif: MotifCamera): string {
  return `scan.cam.${motif}`;
}
