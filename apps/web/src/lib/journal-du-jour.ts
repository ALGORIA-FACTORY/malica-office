/**
 * Le journal du jour, côté écran : le jour lu dans l'adresse, ses voisins,
 * et le fichier rendu par l'API.
 *
 * Le jour « d'aujourd'hui » n'est PAS calculé ici : il est celui du cabinet,
 * dans son fuseau (un réglage du cabinet, au défaut de sa juridiction), et
 * l'API le rend. L'horloge du poste n'en décide pas (décision du dirigeant,
 * 29 octobre 2026).
 *
 * Rien ici ne calcule un montant : les totaux viennent de l'API.
 */
import type { JournalExporte } from "@malica/socle/ports/repositories";

const JOUR_MS = 86_400_000;

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
