/**
 * Les traces de l'appareil — quelle opération chaque pièce continue.
 *
 * Une trace naît à la capture (`vidage.deposer`) et suit la pièce : chaque
 * appel qui la nomme porte son identifiant dans `x-malica-trace`, et l'API
 * rattache ses étapes à la capture. La carte retient, pour la clé
 * d'idempotence de la file et pour l'identifiant de la pièce, la trace née à
 * la capture.
 *
 * Elle survit à un redémarrage dans le stockage de la page — une commodité
 * de l'appareil, bornée, jamais une donnée qui doit tenir : perdue, la pièce
 * se rattache encore par son identifiant (`observabilite.diagnostic_piece`).
 *
 * Ce module ne parle à personne : les adaptateurs HTTP le lisent, la file
 * l'écrit. Il n'importe pas la composition, pour qu'un adaptateur puisse
 * l'importer sans cycle.
 */
import type { SuiviDeTrace } from "@malica/socle/ports/repositories";

const CLE_DU_STOCKAGE = "malica.parcours.traces";
/** Trois cents pièces suffisent à couvrir une file pleine et ce qu'on vient d'ouvrir. */
const BORNE = 300;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let carte: Map<string, string> | null = null;

function lireLeStockage(): Map<string, string> {
  try {
    const brut = globalThis.localStorage?.getItem(CLE_DU_STOCKAGE);
    const paires = brut ? (JSON.parse(brut) as unknown) : [];
    return new Map(
      Array.isArray(paires)
        ? paires.filter(
            (p): p is [string, string] =>
              Array.isArray(p) && typeof p[0] === "string" && UUID.test(String(p[1])),
          )
        : [],
    );
  } catch {
    return new Map();
  }
}

function lesTraces(): Map<string, string> {
  carte ??= lireLeStockage();
  return carte;
}

function ecrireLeStockage(traces: Map<string, string>): void {
  try {
    globalThis.localStorage?.setItem(CLE_DU_STOCKAGE, JSON.stringify([...traces]));
  } catch {
    // Stockage plein ou interdit : la carte vit en mémoire, la pièce garde son identifiant.
  }
}

/** Retient la trace d'une opération pour ces identifiants (clé de la file, pièce). */
export function retenirLaTrace(identifiants: readonly (string | null)[], trace: string): void {
  if (!UUID.test(trace)) return;
  const traces = lesTraces();
  for (const id of identifiants) {
    if (!id) continue;
    traces.delete(id);
    traces.set(id, trace);
  }
  while (traces.size > BORNE) traces.delete(traces.keys().next().value!);
  ecrireLeStockage(traces);
}

/** La trace née à la capture de cette pièce (ou de cette clé de file), si l'appareil la connaît. */
export function traceDe(identifiant: string | null | undefined): string | null {
  return identifiant ? (lesTraces().get(identifiant) ?? null) : null;
}

/**
 * Le suivi d'un appel qui nomme une pièce connue : ses arguments, et les
 * valeurs de premier niveau d'un argument objet (`{ pieceId }`). Sans clé : un
 * geste de l'écran n'est pas un renvoi, il n'a pas à se compter comme tel.
 */
export function suiviDesArguments(args: readonly unknown[]): SuiviDeTrace | null {
  for (const arg of args) {
    const valeurs =
      typeof arg === "string"
        ? [arg]
        : arg && typeof arg === "object" && !Array.isArray(arg)
          ? Object.values(arg)
          : [];
    for (const v of valeurs) {
      const trace = typeof v === "string" ? traceDe(v) : null;
      if (trace) return { trace };
    }
  }
  return null;
}

/** Les en-têtes d'un appel suivi : la trace, et la clé du pas s'il en a une. */
export function entetesDuSuivi(suivi: SuiviDeTrace | null | undefined): Record<string, string> {
  if (!suivi || !UUID.test(suivi.trace)) return {};
  return suivi.cle
    ? { "x-malica-trace": suivi.trace, "x-malica-cle": suivi.cle }
    : { "x-malica-trace": suivi.trace };
}

/** Pour les épreuves : la carte repart de zéro, comme un appareil neuf. */
export function oublierLesTraces(): void {
  carte = new Map();
  ecrireLeStockage(carte);
}
