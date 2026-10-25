/**
 * Ce qu'une notification de demande sur une pièce dit, selon son OBJET et sa
 * réponse — une seule lecture du payload pour les deux surfaces.
 *
 * Audit du 25 octobre 2026 : le cabinet lisait « Votre client demande le
 * retour d'une pièce » pour une demande de SUPPRESSION, et la PME lisait
 * « Votre comptabilité a répondu… » sans savoir si c'était oui ou non. Le
 * payload portait déjà l'objet et le verdict ; aucune phrase ne les lisait.
 */
import type { MessageKey } from "@/i18n";

type Payload = Readonly<Record<string, unknown>>;

function objetDe(payload: Payload): "rappel" | "suppression" | null {
  const objet = payload["objet"];
  return objet === "rappel" || objet === "suppression" ? objet : null;
}

/** Côté cabinet : ce que le client demande — le retour, ou l'effacement. */
export function phraseDeLaDemande(payload: Payload): MessageKey {
  return objetDe(payload) === "suppression"
    ? "cab.notif.kind.piece.demande.suppression"
    : "cab.notif.kind.piece.demande";
}

/**
 * Côté PME : ce que le cabinet a répondu, objet ET verdict. Une notification
 * ancienne, sans l'un des deux, garde la phrase générique : on ne devine pas
 * un verdict.
 */
export function phraseDeLaReponse(payload: Payload): MessageKey {
  const objet = objetDe(payload);
  const accorde = payload["accorde"];
  if (objet === null || typeof accorde !== "boolean") return "notif.kind.piece.demande_tranchee";
  return `notif.kind.piece.demande_tranchee.${objet}.${accorde ? "accorde" : "refuse"}`;
}

/** La réponse a effacé la pièce : il n'y a plus rien à ouvrir. */
export function laReponseAEffaceLaPiece(kind: string, payload: Payload): boolean {
  return (
    kind === "piece.demande_tranchee" &&
    objetDe(payload) === "suppression" &&
    payload["accorde"] === true
  );
}

/**
 * Où va le cabinet après avoir tranché : une suppression accordée efface la
 * pièce, et l'écran passe à la suivante de la file, ou à la file elle-même.
 * Toute autre réponse laisse la pièce à l'écran (`null`).
 */
export function apresLaReponse(
  objet: string,
  accorde: boolean,
  suivante: string | null,
): { piece: string } | "file" | null {
  if (objet !== "suppression" || !accorde) return null;
  return suivante ? { piece: suivante } : "file";
}
