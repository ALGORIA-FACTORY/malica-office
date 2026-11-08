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

const CLE_RECENTES = "malica.societes.recentes";
const RECENTES_MAX = 5;

/** Les dernières sociétés ouvertes sur CET appareil, la plus récente d'abord. */
export function recentes(): string[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(CLE_RECENTES) ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Note une société comme ouverte à l'instant : le sélecteur de l'en-tête et
 * l'étape « Pour qui ? » lisent la même liste.
 */
export function noterRecente(id: string) {
  const r = [id, ...recentes().filter((x) => x !== id)].slice(0, RECENTES_MAX);
  try {
    window.localStorage.setItem(CLE_RECENTES, JSON.stringify(r));
  } catch {
    /* stockage plein ou refusé : la commodité se perd, rien d'autre */
  }
}

/** Deux initiales pour la pastille d'une société. */
export function initialesDe(nom: string) {
  const mots = nom
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return ((mots[0]?.[0] ?? "") + (mots[1]?.[0] ?? "")).toLocaleUpperCase() || "·";
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
