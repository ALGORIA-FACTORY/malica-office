/**
 * Les faits du suivi d'une pièce envoyée, lus par `app.suivi_de_la_piece`.
 *
 * La PME (sa liste, sa fiche) et le cabinet (sa file, la pièce) lisent les
 * MÊMES colonnes, et le Socle en dérive le mot (`statut-d-envoi.ts`) : une
 * seule source pour « Envoyée · Vue · Retour · Prise en charge » d'un côté,
 * « Reçue · Vue · Retournée · Corrigée · Validée · Forcée » de l'autre.
 */
import { statutCabinet, type StatutCabinet, type SuiviDEnvoi } from "@malica/socle/statut-d-envoi";

/** Les colonnes à sélectionner d'un `app.suivi_de_la_piece(...) s`. */
export const COLONNES_DU_SUIVI = `s.envoyee_le as suivi_envoyee_le, s.vue_le as suivi_vue_le,
       s.vue_par as suivi_vue_par, s.corrigee_le as suivi_corrigee_le,
       s.prise_le as suivi_prise_le, s.prise as suivi_prise, s.prise_par as suivi_prise_par`;

const instant = (v: unknown): string | null =>
  v == null ? null : new Date(v as string | Date).toISOString();

/** `null` quand la base ne sait rien du chemin de la pièce : rien à suivre. */
export function versSuivi(r: Record<string, unknown>): SuiviDEnvoi | null {
  const faits = ["suivi_envoyee_le", "suivi_vue_le", "suivi_corrigee_le", "suivi_prise"] as const;
  if (faits.every((f) => r[f] == null)) return null;
  return {
    envoyeeLe: instant(r["suivi_envoyee_le"]),
    vueLe: instant(r["suivi_vue_le"]),
    vuePar: (r["suivi_vue_par"] as string | null) ?? null,
    corrigeeLe: instant(r["suivi_corrigee_le"]),
    priseLe: instant(r["suivi_prise_le"]),
    prise: (r["suivi_prise"] as SuiviDEnvoi["prise"]) ?? null,
    prisePar: (r["suivi_prise_par"] as string | null) ?? null,
  };
}

/**
 * Le statut d'une pièce au cabinet, depuis ses FAITS (envoi, vue, correction,
 * prise en charge) — jamais depuis le seul statut brut : une pièce inscrite
 * avant « Malica sans blocage » porte encore `comptabilisee` alors que sa
 * prise en charge est faite. La file, chaque compteur et la bibliothèque
 * classent par cette seule fonction.
 */
export function statutAuCabinet(
  status: string,
  faits: Record<string, unknown> | undefined,
): StatutCabinet {
  return statutCabinet({ status, suivi: faits ? versSuivi(faits) : null });
}
