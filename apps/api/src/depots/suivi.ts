/**
 * Les faits du suivi d'une pièce envoyée, lus par `app.suivi_de_la_piece`.
 *
 * La PME (sa liste, sa fiche) et le cabinet (sa file, la pièce) lisent les
 * MÊMES colonnes, et le Socle en dérive le mot (`statut-d-envoi.ts`) : une
 * seule source pour « Envoyée · Vue · Retour · Prise en charge » d'un côté,
 * « Reçue · Vue · Retournée · Corrigée · Validée · Forcée » de l'autre.
 *
 * Le passage siège → propriétaire (lot 4) se lit de la même façon, par
 * `app.circuit_de_la_piece` : la société seule le lit.
 */
import {
  statutCabinet,
  type CircuitInterne,
  type StatutCabinet,
  type SuiviDEnvoi,
} from "@malica/socle/statut-d-envoi";

/** Les colonnes à sélectionner d'un `app.suivi_de_la_piece(...) s`. */
export const COLONNES_DU_SUIVI = `s.envoyee_le as suivi_envoyee_le, s.vue_le as suivi_vue_le,
       s.vue_par as suivi_vue_par, s.corrigee_le as suivi_corrigee_le,
       s.prise_le as suivi_prise_le, s.prise as suivi_prise, s.prise_par as suivi_prise_par`;

const instant = (v: unknown): string | null =>
  v == null ? null : new Date(v as string | Date).toISOString();

/** Les colonnes à sélectionner d'un `app.circuit_de_la_piece(...) c`. */
export const COLONNES_DU_CIRCUIT = `c.recoit as circuit_recoit, c.dernier as circuit_dernier,
       c.envoyee_le as circuit_envoyee_le, c.vue_le as circuit_vue_le,
       c.vue_par as circuit_vue_par, c.retournee_le as circuit_retournee_le,
       c.retour_par as circuit_retour_par, c.corrigee_le as circuit_corrigee_le,
       c.auteur as circuit_auteur, c.mienne as circuit_mienne`;

/** `null` pour qui n'est pas de la société : le comptable n'en est pas. */
export function versCircuit(r: Record<string, unknown>): CircuitInterne | null {
  if (r["circuit_recoit"] == null) return null;
  return {
    recoit: Boolean(r["circuit_recoit"]),
    dernier: (r["circuit_dernier"] as CircuitInterne["dernier"]) ?? null,
    envoyeeLe: instant(r["circuit_envoyee_le"]),
    vueLe: instant(r["circuit_vue_le"]),
    vuePar: (r["circuit_vue_par"] as string | null) ?? null,
    retourneeLe: instant(r["circuit_retournee_le"]),
    retourPar: (r["circuit_retour_par"] as string | null) ?? null,
    corrigeeLe: instant(r["circuit_corrigee_le"]),
    auteur: (r["circuit_auteur"] as string | null) ?? null,
    mienne: Boolean(r["circuit_mienne"]),
  };
}

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
