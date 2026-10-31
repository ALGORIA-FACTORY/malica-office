import { z } from "zod";

const CONTRACT_VERSION = "tva.v1" as const;
const decimalString = z.string().regex(/^-?\d+(\.\d+)?$/);

/** Les deux sens d'une TVA : celle qu'on collecte, celle qu'on déduit. */
export const SensDeTva = z.enum(["collectee", "deductible"]);
export type SensDeTva = z.infer<typeof SensDeTva>;

export const TvaBucket = z.object({
  tax_code: z.string(),
  /**
   * La nature de ce que le seau taxe (`ref.tva_natures`) : un seau par taux ET
   * par nature, pour que la déclaration isole la TVA des immobilisations.
   * `null` sur un seau d'avant la nature (ajout compatible, 3 novembre 2026).
   */
  nature: z.string().nullable().default(null),
  /** La ligne de la déclaration qui a reçu ce seau (`null` : aucune, voir `sans_ligne`). */
  ligne: z.string().nullable().default(null),
  rate: decimalString,
  base: decimalString,
  vat: decimalString,
});

/**
 * Une ligne de la déclaration, telle que le référentiel la définit
 * (`ref.tva_declaration_lignes`) et que le moteur la remplit. `nature` nulle :
 * la ligne reçoit toutes les natures de son sens.
 */
export const LigneDeDeclarationTva = z.object({
  code: z.string(),
  label: z.string(),
  sens: SensDeTva,
  nature: z.string().nullable(),
  base: decimalString,
  vat: decimalString,
  /** R10 : un défaut livré que l'expert-comptable doit confirmer (`ref`). */
  incertain: z.boolean(),
});
export type LigneDeDeclarationTva = z.infer<typeof LigneDeDeclarationTva>;

export const TvaV1 = z.object({
  contract: z.literal(CONTRACT_VERSION),
  period: z.string().regex(/^\d{4}-\d{2}$/),
  currency: z.string().length(3),
  collectee: z.array(TvaBucket),
  deductible: z.array(TvaBucket),
  totals: z.object({
    collectee: decimalString,
    deductible: decimalString,
    solde: decimalString, // collectée - déductible ; >0 = à payer
  }),
  /** Les lignes de la déclaration, dans l'ordre du référentiel ; leur somme par sens = `totals`. */
  declaration: z.array(LigneDeDeclarationTva).default([]),
  /**
   * Les lignes rangées sur la nature PAR DÉFAUT faute d'avoir pu l'attribuer
   * (`NATURE_NON_ATTRIBUEE`), ou parce que leur nature n'a pas de ligne au
   * référentiel (`NATURE_SANS_LIGNE:<nature>`). Elles COMPTENT dans les totaux ;
   * l'écran les nomme.
   */
  par_defaut: z
    .array(z.object({ reason: z.string(), item_id: z.string().nullable(), tax_code: z.string() }))
    .default([]),
  /**
   * Les seaux qu'aucune ligne du référentiel ne porte (pas de ligne pour leur
   * sens) : ils COMPTENT dans les totaux, la déclaration ne les montre pas, et
   * l'écran les nomme — un référentiel incomplet, pas une pièce à reprendre.
   */
  sans_ligne: z
    .array(
      z.object({ sens: SensDeTva, tax_code: z.string(), nature: z.string(), vat: decimalString }),
    )
    .default([]),
  refused: z.array(z.object({ reason: z.string(), item_id: z.string().nullable() })).default([]),
});
export type TvaV1 = z.infer<typeof TvaV1>;
