/** Une retenue exige une qualification explicite ; le net seul ne prouve aucun impôt. */
import { D, toFixedStr } from "../domain/decimal.ts";

/** Un taux de retenue possible, tel que le référentiel le rend. */
export interface TauxDeRetenue {
  /** Le code du paramètre fiscal : `RAS_MARCHES_ACQUISITIONS`… */
  code: string;
  /** Une fraction : 0.015, jamais 1,5. */
  taux: string;
  libelle: string;
  /** Ce sur quoi le taux s'applique. Absent : le TTC. */
  base?: "ttc" | "tva";
  /** `ir` : impôt sur le revenu ; `tva` : TVA retenue. Absent : `ir`. */
  famille?: "ir" | "tva";
  /** Le seuil TTC propre à ce taux (égal ou supérieur), ou `null` sans seuil. */
  seuil?: string | null;
}

export interface EntreeRetenue {
  /** Le TTC de la pièce réglée, lu sur la pièce. */
  ttc: string;
  /** La TVA de la pièce, lue sur la pièce ; nécessaire aux retenues de TVA. */
  tva?: string | null;
  /** Le montant effectivement réglé, déclaré. */
  paye: string;
  /**
   * Le seuil commun, pour les taux qui n'en portent pas : la forme du
   * 19 octobre, qui ne connaissait que l'article 52-I-g.
   */
  seuil: string | null;
  taux: readonly TauxDeRetenue[];
  decimales: number;
  /** Qualification du comptable, conservée avec la proposition. Aucun code implicite. */
  qualification?: QualificationDeRetenue;
}

export interface QualificationDeRetenue {
  codes: string[];
  /** Part brute de dette réglée, avant retenues ; peut être partielle. */
  baseReglee: string;
  /** TVA comprise dans cette part, nécessaire seulement pour une retenue de TVA. */
  tvaReglee?: string | null;
  /** Assiette IR qualifiée si elle diffère du brut éteint (hors sommes exclues). */
  assietteIR?: string | null;
  /** Référence du certificat ou justification du traitement fiscal. */
  justification: string;
}

export class RetenueNonQualifiee extends Error {}

/** Une retenue constatée, une ligne de l'écriture. */
export interface RetenueConstatee {
  code: string;
  taux: string;
  libelle: string;
  famille: "ir" | "tva";
  montant: string;
}

export type ConstatDeRetenue =
  | { cas: "a_confirmer" }
  /** Le payé est le net : la ou les retenues ont été opérées. */
  | {
      cas: "operee";
      /** La première retenue — la forme du 19 octobre, gardée pour les lecteurs. */
      code: string;
      taux: string;
      libelle: string;
      montant: string;
      ttc: string;
      /** Toutes les retenues constatées, une ou deux. */
      retenues: RetenueConstatee[];
    }
  /** Au-dessus d'un seuil, payé pour le TTC entier : rien n'a été retenu. */
  | { cas: "non_operee"; ttc: string }
  /** Sous les seuils, sans référentiel, ou paiement partiel : rien à constater. */
  | { cas: "sans_objet" };

export function constaterLaRetenue(e: EntreeRetenue): ConstatDeRetenue {
  const q = e.qualification;
  if (!q) return e.taux.length ? { cas: "a_confirmer" } : { cas: "sans_objet" };
  const refuse = (message: string): never => {
    throw new RetenueNonQualifiee(message);
  };
  const decimal = (v: string) => {
    if (typeof v !== "string" || !/^\d+(\.\d+)?$/.test(v))
      return refuse("Montant fiscal invalide.");
    const d = D(v);
    if (!d.isFinite() || !d.eq(D(toFixedStr(d, e.decimales))))
      return refuse("La précision du montant dépasse celle de la devise.");
    return d;
  };
  if (!Array.isArray(q.codes) || typeof q.justification !== "string" || !q.justification.trim())
    return refuse("La qualification fiscale exige une justification.");
  const ttc = decimal(e.ttc);
  const paye = decimal(e.paye);
  const brut = decimal(q.baseReglee);
  if (brut.lte(0) || brut.gt(ttc) || paye.lte(0))
    return refuse("La part brute réglée doit être positive et ne pas dépasser la facture.");
  if (new Set(q.codes).size !== q.codes.length)
    return refuse("Une retenue ne peut pas être comptée deux fois.");
  const familles = new Set<string>();
  const retenues: RetenueConstatee[] = q.codes.map((code) => {
    const t = e.taux.find((t) => t.code === code);
    if (!t) return refuse("Retenue absente du référentiel applicable à la date du paiement.");
    const famille = t.famille ?? "ir";
    if (familles.has(famille))
      return refuse("Deux retenues de même famille ne se cumulent pas ici.");
    familles.add(famille);
    const seuil = t.seuil !== undefined ? t.seuil : e.seuil;
    if (seuil !== null && ttc.lt(D(seuil)))
      return refuse("Le seuil de cette retenue n'est pas atteint.");
    let base = q.assietteIR ? decimal(q.assietteIR) : brut;
    if (base.lte(0) || base.gt(brut)) return refuse("L'assiette IR dépasse la part brute réglée.");
    if (t.base === "tva") {
      if (!q.tvaReglee || !e.tva) return refuse("La TVA de la part réglée est nécessaire.");
      base = decimal(q.tvaReglee);
      if (base.lte(0) || base.gt(decimal(e.tva)) || base.gt(brut))
        return refuse("La TVA réglée dépasse la TVA de la facture ou la part brute.");
    }
    const montant = toFixedStr(base.times(D(t.taux)), e.decimales);
    if (D(montant).lte(0)) return refuse("Le montant de retenue doit être positif.");
    return { code, taux: t.taux, libelle: t.libelle, famille, montant };
  });
  const total = retenues.reduce((a, r) => a.plus(r.montant), D(0));
  // Aucun ajustement de taxe pour absorber un écart : cash + taxes = brut strictement.
  if (!paye.plus(total).eq(brut))
    return refuse("Le net payé et les retenues ne correspondent pas à la part brute réglée.");
  const premiere = retenues[0];
  if (!premiere) return { cas: "sans_objet" };
  return {
    cas: "operee",
    code: premiere.code,
    taux: premiere.taux,
    libelle: premiere.libelle,
    montant: toFixedStr(total, e.decimales),
    ttc: toFixedStr(brut, e.decimales),
    retenues,
  };
}
