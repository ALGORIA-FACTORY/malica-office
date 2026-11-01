/**
 * LES EXPERTS DE LECTURE DE L'ADAPTATEUR — ce que le moteur ne lit pas lui-même.
 *
 * Le moteur du sudoku ne relit jamais le texte d'un jeton (règle ①). Trois
 * lectures se font donc ici, chacune par le lecteur qui existait déjà, et avec
 * les règles du pack (`lireLesReglesDeLecture`) — rien n'est écrit dans ce
 * fichier (R4) :
 *
 *   - LA DATE sur plusieurs jetons d'une rangée (« 13 | mai | 2026 ») :
 *     `normalizeDate`, avec la convention du pack. Elle est portée par le
 *     premier jeton (`date`) et citée jusqu'au dernier (`date_fin`) ;
 *   - LE MATRICULE tel que l'œil l'a vu (étiquette collée, chiffres arabes,
 *     « l » pour « 1 ») : `normaliserMatricule`, avec la forme du pack
 *     (`identifiants`) ;
 *   - LE MONTANT EN LETTRES qui suit le repère de son champ :
 *     `lireLeMontantEnLettres`, avec le lexique du pack (`lettres`). Le moteur
 *     le compare au total prouvé (preuve `lettres`).
 *
 * Le moteur fait le reste : il ancre, départage, cite, et juge.
 */
import { normaliserMatricule } from "@malica/socle/matricule";
import { lireLeMontantEnLettres } from "@malica/socle/montant-en-lettres";
import type { DeviseLue } from "@malica/socle/montant-imprime";
import { comparable } from "@malica/socle/mot-comparable";
import type { Grille } from "@malica/sudoku";

import type { ReglesDeLecture } from "./regles-de-lecture.ts";
import { normalizeDate, type PageToken } from "./token-plan.ts";

/** Une date s'écrit sur trois jetons au plus (« 13 », « mai », « 2026 »). */
const JETONS_D_UNE_DATE = 3;
/** Un matricule se coupe en quatre jetons au plus (« 1589037 », « /M/P/M/000 »…). */
const JETONS_D_UN_MATRICULE = 4;
/** Un repère tient en douze jetons au plus (« Arrêtée la présente facture à la somme de »). */
const JETONS_D_UN_REPERE = 12;
/** Un montant en lettres tient en quarante mots au plus. */
const MOTS_D_UN_MONTANT = 40;

/** Deux jetons de la même rangée, le second juste après le premier. */
function memeRangee(a: PageToken, b: PageToken): boolean {
  const h = Math.min(a.y1 - a.y0, b.y1 - b.y0);
  return a.page === b.page && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 0.5 * h && b.x0 >= a.x0;
}

/** Les fenêtres de 2 à `n` jetons d'une même rangée qui commencent au jeton `i`. */
function fenetres(plan: readonly PageToken[], i: number, n: number): PageToken[][] {
  const out: PageToken[][] = [];
  for (let k = i + 1; k < plan.length && k < i + n; k++) {
    if (!memeRangee(plan[k - 1]!, plan[k]!)) break;
    out.push(plan.slice(i, k + 1));
  }
  return out;
}

/** La date d'un jeton, ou d'une suite de jetons de sa rangée qu'il commence. */
export function datesDuPlan(
  plan: readonly PageToken[],
  regles: Pick<ReglesDeLecture, "dates">,
): { date: string | null; date_fin?: number }[] {
  const seules = plan.map((t) => normalizeDate(t.text, regles.dates));
  return plan.map((t, i) => {
    if (seules[i] !== null) return { date: seules[i]! };
    // Une date en morceaux commence par le jour et finit par l'année, et aucun de ses
    // morceaux n'est une date à lui seul.
    if (!/^\d/u.test(t.text.trim())) return { date: null };
    for (const f of fenetres(plan, i, JETONS_D_UNE_DATE)) {
      const dernier = f[f.length - 1]!;
      if (!/\d$/u.test(dernier.text.trim()) || f.some((_, k) => seules[i + k] !== null)) continue;
      const d = normalizeDate(f.map((x) => x.text).join(" "), regles.dates);
      if (d !== null) return { date: d, date_fin: dernier.ordinal };
    }
    return { date: null };
  });
}

/** Les matricules complets qu'un jeton porte, seul ou avec les morceaux de sa rangée. */
export function identifiantsDuPlan(
  plan: readonly PageToken[],
  regles: Pick<ReglesDeLecture, "matricule" | "codeDuMatricule">,
): { format: string; valeur: string; fin: number }[][] {
  const complet = (texte: string) => {
    const lu = normaliserMatricule(texte, regles.matricule);
    return lu.forme === "complete" ? lu.complet : null;
  };
  return plan.map((t, i) => {
    const seul = complet(t.text);
    if (seul) return [{ format: regles.codeDuMatricule, valeur: seul, fin: t.ordinal }];
    if (!/\d/u.test(t.text)) return [];
    for (const f of fenetres(plan, i, JETONS_D_UN_MATRICULE)) {
      const v = complet(f.map((x) => x.text).join(" "));
      if (v) return [{ format: regles.codeDuMatricule, valeur: v, fin: f[f.length - 1]!.ordinal }];
    }
    return [];
  });
}

/** Un texte de repère comparable : sans casse, sans accents, sans espaces ni ponctuation. */
const cleDeRepere = (s: string) => comparable(s).replace(/[^\p{L}\p{N}]/gu, "");

/**
 * Les montants écrits en lettres, chacun porté par son premier mot : la phrase qui
 * suit un repère du champ de la preuve `lettres` de la grille, sur la même rangée
 * ou juste dessous, lue avec le lexique du pack, dans la devise de la pièce.
 */
export function lettresDuPlan(
  plan: readonly PageToken[],
  regles: Pick<ReglesDeLecture, "lettres">,
  grille: Grille,
  devise: DeviseLue,
): Map<number, { v: number; fin: number }> {
  const out = new Map<number, { v: number; fin: number }>();
  const champs = new Set(
    grille.preuves.flatMap((p) => {
      const e = p.expression as Record<string, unknown> | null;
      return e?.["op"] === "lettres" && typeof e["champ"] === "string" ? [e["champ"]] : [];
    }),
  );
  const reperes = new Set(
    grille.champs
      .filter((c) => champs.has(c.code))
      .flatMap((c) => [...c.reperes_fr, ...c.reperes_ar])
      .map(cleDeRepere)
      .filter((r) => r.length > 0),
  );
  if (reperes.size === 0) return out;

  for (let i = 0; i < plan.length; i++) {
    // Le repère : une suite de jetons consécutifs de la même page dont le texte l'égale.
    let texte = "";
    let fin = -1;
    for (let k = i; k < plan.length && k < i + JETONS_D_UN_REPERE; k++) {
      if (plan[k]!.page !== plan[i]!.page) break;
      texte += cleDeRepere(plan[k]!.text);
      if (reperes.has(texte)) fin = k;
    }
    if (fin < 0) continue;
    // La phrase : les jetons qui suivent, sur la rangée du repère ou juste dessous.
    let debut = fin + 1;
    while (debut < plan.length && cleDeRepere(plan[debut]!.text) === "") debut++;
    const phrase: PageToken[] = [];
    for (let k = debut; k < plan.length && phrase.length < MOTS_D_UN_MONTANT; k++) {
      const avant = plan[k - 1]!;
      const t = plan[k]!;
      const h = avant.y1 - avant.y0;
      if (t.page !== avant.page || t.y0 > avant.y1 + 1.5 * h) break;
      phrase.push(t);
    }
    const lu = lireLeMontantEnLettres(
      phrase.map((t) => t.text),
      regles.lettres,
    );
    if (!lu || lu.devise !== devise.code || lu.mots === 0) continue;
    const unite = 10 ** devise.decimales;
    if (lu.mineures !== null && lu.mineures >= unite) continue;
    out.set(phrase[0]!.ordinal, {
      v: lu.majeures * unite + (lu.mineures ?? 0),
      fin: phrase[lu.mots - 1]!.ordinal,
    });
    i = fin;
  }
  return out;
}
