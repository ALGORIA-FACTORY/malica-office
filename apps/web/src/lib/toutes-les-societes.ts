/**
 * « Toutes les sociétés » dans l'en-tête de la PME : ce que chaque écran en fait.
 *
 * Maquette approuvée le 13 novembre 2026 : choisir « Toutes » ne change jamais d'écran sans le
 * dire. Un écran montre le consolidé, ou une société par ligne quand il est par nature celui
 * d'une seule société, ou reste tel quel. Aucun total monétaire : un solde de TVA est celui d'une
 * société, et ce que le moteur ne rend pas ne s'additionne pas (R3).
 */

export type VueSousToutes =
  /** L'écran sait montrer toutes les sociétés ensemble. */
  | "consolidee"
  /** Écran d'une seule société : une société par ligne, toucher en ouvre une. */
  | "uneParSociete"
  /** La pièce va à UNE société : la personne la choisit avant la prise. */
  | "choisirLaSociete"
  /** Une pièce est d'une société : un bandeau la nomme. */
  | "laSocieteDeLaPiece"
  /** Aucune société ne le concerne (le coffre est à la personne) ou il s'en occupe lui-même. */
  | "inchangee";

const SOUS_TOUTES: readonly (readonly [string, VueSousToutes])[] = [
  ["/pme/list", "consolidee"],
  ["/pme/dossier", "consolidee"],
  ["/pme/echeances", "consolidee"],
  ["/pme/comptabilite", "consolidee"],
  ["/pme/malica", "consolidee"],
  ["/pme/notifications", "consolidee"],
  ["/pme/societes", "consolidee"],
  ["/pme/tva", "uneParSociete"],
  ["/pme/charges", "uneParSociete"],
  ["/pme/capturer", "choisirLaSociete"],
  ["/pme/piece", "laSocieteDeLaPiece"],
];

export function vueSousToutes(chemin: string): VueSousToutes {
  if (chemin === "/pme" || chemin === "/pme/") return "consolidee";
  return SOUS_TOUTES.find(([debut]) => chemin.startsWith(debut))?.[1] ?? "inchangee";
}

export interface LecturesDUneSociete {
  id: string;
  name: string;
  restantes: number | string | null;
  droit: number | string | null;
}

/**
 * La société qui a le moins de lectures. Pas un total : chaque société a sa licence, et
 * « 90 restantes » cacherait celle qui est à 0. À égalité, l'ordre alphabétique ; sans forfait
 * connu, rien.
 */
export function laPlusBasse(
  societes: readonly LecturesDUneSociete[],
): { id: string; name: string; restantes: number; droit: number | null } | null {
  const nombre = (v: number | string | null) => {
    if (v === null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const connues = societes
    .map((s) => ({
      id: s.id,
      name: s.name,
      restantes: nombre(s.restantes),
      droit: nombre(s.droit),
    }))
    .filter(
      (s): s is { id: string; name: string; restantes: number; droit: number | null } =>
        s.restantes !== null,
    );
  connues.sort((a, b) => a.restantes - b.restantes || a.name.localeCompare(b.name));
  return connues[0] ?? null;
}
