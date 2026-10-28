/**
 * Le journal du jour, côté poste : quel jour, dans quel fuseau, et le fichier.
 *
 * Le jour du comptable est celui de SON poste, pas celui du serveur : une
 * écriture validée à 00 h 30 à Tunis appartient au journal de ce jour-là,
 * même si l'horloge du serveur dit encore la veille. L'écran envoie donc le
 * fuseau du navigateur ; la base lit le jour dans ce fuseau.
 *
 * Rien ici ne calcule un montant : les totaux viennent de l'API.
 */
import type { JournalExporte } from "@malica/socle/ports/repositories";

const JOUR_MS = 86_400_000;

/** Le fuseau du poste, tel que le navigateur le connaît (« Africa/Tunis »). */
export function fuseauDuPoste(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Le jour du poste, AAAA-MM-JJ — pas `toISOString()`, qui donnerait le jour UTC. */
export function jourDuPoste(maintenant: Date = new Date()): string {
  const deux = (n: number) => String(n).padStart(2, "0");
  return `${maintenant.getFullYear()}-${deux(maintenant.getMonth() + 1)}-${deux(maintenant.getDate())}`;
}

/** Le jour d'avant ou d'après, en jours calendaires. */
export function jourVoisin(jour: string, decalage: number): string {
  return new Date(Date.parse(`${jour}T00:00:00Z`) + decalage * JOUR_MS).toISOString().slice(0, 10);
}

/** Un jour lu dans l'adresse : AAAA-MM-JJ, et une vraie date ; sinon rien. */
export function jourLisible(v: unknown): string | undefined {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  return new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v ? v : undefined;
}

/** Le fichier rendu par l'API : du texte (CSV), ou des octets en base64 (Excel). */
export function fichierDuJournal(
  e: Pick<JournalExporte, "contenu" | "encodage" | "typeMime">,
): Blob {
  if (e.encodage === "utf8") return new Blob([e.contenu], { type: e.typeMime });
  const brut = atob(e.contenu);
  const octets = new Uint8Array(brut.length);
  for (let i = 0; i < brut.length; i += 1) octets[i] = brut.charCodeAt(i);
  return new Blob([octets], { type: e.typeMime });
}
