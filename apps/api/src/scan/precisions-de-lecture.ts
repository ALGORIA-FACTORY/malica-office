/**
 * Ce que la personne a corrigé sur sa facture, mis à la place de ce que la
 * lecture avait lu — pour JUGER, jamais pour écrire dans la lecture.
 *
 * ================================================================= POURQUOI
 *
 * 10 novembre 2026 : un crayon à côté de chaque composante de la facture. La
 * correction est une précision (R7) : `capture.precisions`, une entrée
 * nouvelle, datée et signée, dont le champ est le CHEMIN DE CITATION du champ
 * corrigé (`totals.vat`, `other_charges[0].amount`). La lecture reste ce
 * qu'elle a été.
 *
 * La saisie est une HYPOTHÈSE (R3). Elle entre dans le jugement exactement là
 * où entrait le texte imprimé de la citation : le moteur déterministe lit la
 * valeur saisie comme il aurait lu un montant imprimé, et la facture ferme ou
 * ne ferme pas. Rien ici ne calcule : on remplace une entrée, le moteur juge.
 *
 * Fonction pure : elle ne connaît ni la base ni la devise du référentiel —
 * l'appelant lui donne le séparateur et l'exposant de `ref.devises` (R4).
 */

/** Une précision de la personne : le chemin du champ, et la valeur retenue. */
export interface PrecisionDeLecture {
  champ: string;
  valeur: string;
}

/** La devise du référentiel, telle que la saisie doit s'y conformer. */
export interface FormeDeLaDevise {
  decimales: number;
  separateur: string;
}

interface Totaux {
  base_ht?: string | null;
  vat?: string | null;
  ttc?: string | null;
}

/** La part du payload que les précisions de montant touchent. */
interface PayloadPrecisable {
  lines?: Array<{ base_ht?: string | null }>;
  other_charges?: Array<{ amount?: string | null }>;
  totals?: Totaux;
}

const TOTAL = /^totals\.(base_ht|vat|ttc)$/;
const DROIT = /^other_charges\[(\d{1,3})\]\.amount$/;

/**
 * La valeur saisie, telle qu'un montant imprimé s'écrit pour la devise : le
 * séparateur de la devise, et les décimales de la devise — « 2850.000 » devient
 * « 2850,000 ». Sans décimales, « 2850 » se lirait en dinars ou en millimes ;
 * avec, il n'a qu'une lecture.
 */
function imprimeLaSaisie(canonique: string, forme: FormeDeLaDevise): string {
  const [entier = "0", fraction = ""] = canonique.split(".");
  const complete = fraction.padEnd(forme.decimales, "0").slice(0, forme.decimales);
  return forme.decimales > 0 ? `${entier}${forme.separateur}${complete}` : entier;
}

/**
 * Le payload et le texte imprimé, avec les précisions de montant. Ce qui n'est
 * pas précisé reste ce que la lecture a rendu.
 */
export function appliquerLesPrecisionsDeMontant<P extends PayloadPrecisable>(
  payload: P,
  imprime: (champ: string) => string | null,
  precisions: readonly PrecisionDeLecture[],
  forme: FormeDeLaDevise,
): { payload: P; imprime: (champ: string) => string | null } {
  const dites = new Map<string, string>();
  for (const p of precisions) {
    const droit = DROIT.exec(p.champ);
    if (TOTAL.test(p.champ)) dites.set(p.champ, p.valeur);
    // Un droit que la lecture n'a pas relevé ne se précise pas ici : l'index
    // d'une autre lecture ne désigne pas le même droit.
    else if (droit && Number(droit[1]) < (payload.other_charges?.length ?? 0))
      dites.set(p.champ, p.valeur);
  }
  if (dites.size === 0) return { payload, imprime };

  const totals: Totaux = { ...payload.totals };
  for (const cle of ["base_ht", "vat", "ttc"] as const) {
    const v = dites.get(`totals.${cle}`);
    if (v !== undefined) totals[cle] = v;
  }
  const seulHt = (payload.lines?.length ?? 0) <= 1;
  const rendu: P = {
    ...payload,
    totals,
    other_charges: payload.other_charges?.map((d, i) => {
      const v = dites.get(`other_charges[${i}].amount`);
      return v === undefined ? d : { ...d, amount: v };
    }),
    // Une facture à un seul taux : la base de la ligne est celle du pied.
    lines:
      seulHt && dites.has("totals.base_ht")
        ? payload.lines?.map((l, i) =>
            i === 0 ? { ...l, base_ht: dites.get("totals.base_ht") } : l,
          )
        : payload.lines,
  };
  return {
    payload: rendu,
    imprime: (champ) => {
      const v =
        dites.get(champ) ??
        (seulHt && champ === "lines[0].base_ht" ? dites.get("totals.base_ht") : undefined);
      return v === undefined ? imprime(champ) : imprimeLaSaisie(v, forme);
    },
  };
}

/** « other_charges[0].amount » devient ["other_charges", 0, "amount"]. */
function segmentsDuChemin(champ: string): Array<string | number> {
  return champ
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .map((s) => (/^\d+$/.test(s) ? Number(s) : s));
}

/** La valeur que la lecture porte à ce chemin, ou null. */
export function valeurDuChemin(payload: unknown, champ: string): string | null {
  let courant: unknown = payload;
  for (const segment of segmentsDuChemin(champ)) {
    if (courant === null || typeof courant !== "object") return null;
    courant = (courant as Record<string | number, unknown>)[segment];
  }
  return typeof courant === "string" ? courant : null;
}

/**
 * Pose la valeur retenue à ce chemin, dans le payload RENDU à l'écran (une
 * copie : la lecture, elle, n'est jamais touchée). Un chemin qui n'existe pas
 * dans la lecture n'est pas créé.
 */
export function mettreLaValeur(
  payload: Record<string, unknown>,
  champ: string,
  valeur: string,
): void {
  const segments = segmentsDuChemin(champ);
  const dernier = segments.pop();
  if (dernier === undefined) return;
  let courant: Record<string | number, unknown> = payload;
  for (const segment of segments) {
    const suivant = courant[segment];
    if (suivant === null || typeof suivant !== "object") return;
    const copie = Array.isArray(suivant) ? [...suivant] : { ...(suivant as object) };
    courant[segment] = copie;
    courant = copie as Record<string | number, unknown>;
  }
  if (!(dernier in courant)) return;
  courant[dernier] = valeur;
}
