import { z } from "zod";

const montant = z.string().regex(/^\d+(?:\.\d{1,6})?$/);
export const QualificationFiscaleSchema = z
  .object({
    pieceId: z.string().uuid(),
    extractionId: z.string().uuid(),
    profilVersionId: z.string().uuid().nullable(),
    precedentId: z.string().uuid().nullable(),
    documentKind: z.enum(["facture_achat", "facture_vente"]),
    dateOperation: z.string().date(),
    contexte: z.enum(["interieur", "importation", "exportation"]),
    qualiteOperateur: z.enum(["fabricant", "importateur", "revendeur", "prestataire", "autre"]),
    justification: z.string().trim().min(10).max(4000),
    lignes: z
      .array(
        z
          .object({
            index: z.number().int().min(0),
            baseHt: montant,
            compteCout: z.string().trim().min(1).max(32),
            deduction: z.enum(["deductible", "non_deductible", "prorata"]),
            droits: z
              .array(
                z
                  .object({
                    code: z.string().trim().min(1).max(120),
                    assiette: montant,
                    referenceLegale: z.string().trim().min(3).max(2000),
                  })
                  .strict(),
              )
              .max(30),
          })
          .strict(),
      )
      .min(1)
      .max(200),
  })
  .strict()
  .superRefine((q, ctx) => {
    if (q.lignes.some((l) => new Set(l.droits.map((d) => d.code)).size !== l.droits.length))
      ctx.addIssue({ code: "custom", message: "Droit en double sur une ligne fiscale." });
  });
export type QualificationFiscale = z.infer<typeof QualificationFiscaleSchema>;
export interface QualificationFiscaleInscrite extends QualificationFiscale {
  id: string;
  creePar: string;
  creeLe: string;
}
export interface LigneFiscaleCalculee {
  index: number;
  baseHt: string;
  compteCout: string;
  majorationTva: string;
  tauxDeduction: string;
  droits: Array<{
    code: string;
    assiette: string;
    montant: string;
    taxable: boolean;
    compte: string;
    incorporeAuCout: boolean;
  }>;
}

export interface ContexteQualificationFiscale {
  extractionId: string;
  profilVersionId: string | null;
  documentKind: "facture_achat" | "facture_vente";
  dateLue: string | null;
  decimales: number;
  prorata: string | null;
  regimeTva: string | null;
  qualification: QualificationFiscaleInscrite | null;
  comptes: Array<{ code: string; libelle: string }>;
  lignes: Array<{
    index: number;
    libelle: string;
    codeTva: string;
    htLu: string | null;
    baseProposee: string | null;
  }>;
  droits: Array<{
    code: string;
    libelle: string;
    taux: string;
    referenceLegale: string;
    taxable: boolean;
  }>;
}
