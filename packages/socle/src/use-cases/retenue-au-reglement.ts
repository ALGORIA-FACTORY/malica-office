/** Une retenue exige une qualification explicite ; le net seul ne prouve aucun impôt. */
import { z } from "zod";

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

/**
 * La qualification telle qu'elle entre : un objet venu du navigateur n'est
 * conservé qu'après lecture de ce schéma. Un champ inconnu est refusé, pour
 * que l'audit ne garde que ce que le comptable a qualifié.
 */
const schemaDeQualification = z
  .object({
    codes: z.array(z.string().min(1)).max(4),
    /** Part brute de dette réglée, avant retenues ; peut être partielle. */
    baseReglee: z.string(),
    /** TVA comprise dans cette part, nécessaire seulement pour une retenue de TVA. */
    tvaReglee: z.string().nullable().optional(),
    /** Assiette IR qualifiée si elle diffère du brut éteint (hors sommes exclues). */
    assietteIR: z.string().nullable().optional(),
    /** Référence du certificat ou justification ; exigée dès qu'une retenue est déclarée. */
    justification: z.string().max(500),
  })
  .strict();

export type QualificationDeRetenue = z.infer<typeof schemaDeQualification>;

/** Lit une qualification reçue ; rien d'autre que ses champs n'est gardé. */
export function lireLaQualification(entree: unknown): QualificationDeRetenue {
  const r = schemaDeQualification.safeParse(entree);
  if (!r.success) throw new RetenueNonQualifiee("Qualification fiscale illisible.");
  return r.data;
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
  /** Sous les seuils, sans référentiel, ou paiement partiel : rien à constater. */
  | { cas: "sans_objet" };

/**
 * Un seuil du référentiel est-il atteint par le TTC de la pièce ?
 *
 * Décision du 24 octobre 2026 (Wissem Barouni) : sous le seuil légal, aucune
 * qualification n'est demandée. Seuls les taux qui PORTENT un seuil peuvent
 * déclencher la question ; un taux sans seuil (honoraires, loyers) dépend de
 * la nature de l'opération, que le règlement ne connaît pas : le comptable le
 * déclare s'il s'applique, rien ne le devine.
 */
function unSeuilEstAtteint(e: EntreeRetenue, ttc: string): boolean {
  return e.taux.some((t) => {
    const seuil = t.seuil !== undefined ? t.seuil : e.seuil;
    return seuil !== null && !D(ttc).lt(D(seuil));
  });
}

export function constaterLaRetenue(e: EntreeRetenue): ConstatDeRetenue {
  const q = e.qualification;
  if (!q) return unSeuilEstAtteint(e, e.ttc) ? { cas: "a_confirmer" } : { cas: "sans_objet" };
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
  if (!Array.isArray(q.codes) || typeof q.justification !== "string")
    return refuse("Qualification fiscale illisible.");
  if (q.codes.length > 0 && !q.justification.trim())
    return refuse("Une retenue déclarée exige la référence du certificat ou une justification.");
  // Au-dessus d'un seuil, ne rien retenir est une décision : elle se motive
  // (exonération, attestation, nature de l'opération). Sous le seuil, rien.
  if (q.codes.length === 0 && !q.justification.trim() && unSeuilEstAtteint(e, e.ttc))
    return refuse("Au-dessus du seuil, dites pourquoi aucune retenue n'est opérée.");
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
