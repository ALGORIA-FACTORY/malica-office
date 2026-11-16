/**
 * Les textes des courriels vivent en base (`notif.libelles_courriel`), en fr,
 * en et ar : le code n'en porte aucun. Une clé absente est une erreur de
 * référentiel, jamais un texte deviné.
 */
import type { Requete } from "../db.ts";

export type Libelles = Readonly<Record<string, string>>;

export function libelle(l: Libelles, cle: string): string {
  const t = l[cle];
  if (t === undefined) throw new Error(`libellé de courriel absent : ${cle}`);
  return t;
}

/** Le texte propre à la clé s'il existe (une étiquette propre à un genre, par exemple). */
export function libelleSiPresent(l: Libelles, cle: string): string | null {
  return l[cle] ?? null;
}

/** Remplit les jetons `{{nom}}` ; `transformer` habille chaque valeur (échappement, gras). */
export function remplir(
  texte: string,
  jetons: Readonly<Record<string, string>>,
  transformer: (v: string) => string = (v) => v,
): string {
  return texte.replace(/\{\{(\w+)\}\}/g, (_, cle: string) => {
    const v = jetons[cle];
    if (v === undefined) throw new Error(`jeton de courriel sans valeur : ${cle}`);
    return transformer(v);
  });
}

/** Les textes d'une langue, version en vigueur, repli sur le français par clé. */
export async function libellesDuCourriel(db: Requete, locale: string): Promise<Libelles> {
  const { rows } = await db.query<{ l: Record<string, string> }>(
    "select notif.libelles_du_courriel($1) as l",
    [locale],
  );
  return rows[0]?.l ?? {};
}
