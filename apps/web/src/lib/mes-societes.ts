/**
 * Le tri de l'écran « Mes sociétés » (planche 13, approuvée le 8 novembre 2026) :
 * ce qui attend d'abord — le retard, puis le geste, puis la lecture —, ou de
 * A à Z, ou les épinglées seules.
 */
export type Tri = "attend" | "az" | "epinglees";

export interface Ligne {
  id: string;
  name: string;
  matricule: string | null;
  aTraiter: number;
  aLire: number;
  enRetard: number;
}

const CLE_EPINGLEES = "malica.societes.epinglees";

export function epinglees(): string[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(CLE_EPINGLEES) ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function plier(s: string) {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();
}

/** Le poids de « ce qui attend » : le retard d'abord, puis le geste, puis la lecture. */
function poids(l: Ligne) {
  return l.enRetard * 1_000_000 + l.aTraiter * 1_000 + l.aLire;
}

export function trierLesLignes(
  lignes: readonly Ligne[],
  tri: Tri,
  locale: string,
  epingle: string[],
) {
  const az = (a: Ligne, b: Ligne) => a.name.localeCompare(b.name, locale);
  if (tri === "az") return [...lignes].sort(az);
  if (tri === "epinglees") return lignes.filter((l) => epingle.includes(l.id)).sort(az);
  return [...lignes].sort((a, b) => poids(b) - poids(a) || az(a, b));
}
