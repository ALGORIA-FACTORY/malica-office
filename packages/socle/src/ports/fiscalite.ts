import { z } from "zod";

const texte = z.string().trim().max(2000);
const date = z.string().date();
const decimal = z.string().regex(/^\d+(?:\.\d{1,6})?$/);

/** Paramétrage déclaré par l'expert, distinct d'une certification du droit. */
export const RegleFiscaleSchema = z
  .object({
    famille: z.enum(["tva", "timbre", "fodec", "retenue", "autre"]),
    operation: z.enum(["achat", "vente", "paiement_emis", "paiement_recu"]),
    typeOperation: texte.min(1),
    code: texte.min(1),
    applicabilite: z.enum(["applicable", "non_applicable", "exonere", "suspendu", "a_qualifier"]),
    mode: z.enum(["taux", "montant", "aucun"]),
    valeur: decimal.nullable(),
    assiette: texte,
    seuil: decimal.nullable().optional(),
    dansBaseTva: z.boolean().nullable(),
    deductibilite: z.enum(["oui", "non", "partielle", "a_qualifier"]),
    referenceLegale: texte,
    conditions: texte,
    justificatif: texte,
  })
  .strict()
  .superRefine((r, ctx) => {
    const erreur = (path: string, message: string) =>
      ctx.addIssue({ code: "custom", path: [path], message });
    if (r.applicabilite !== "a_qualifier" && !r.referenceLegale)
      erreur("referenceLegale", "Référence légale requise.");
    if (r.applicabilite === "applicable") {
      if (r.mode === "aucun" || r.valeur === null) erreur("valeur", "Taux ou montant requis.");
      if (r.mode === "taux" && !r.assiette) erreur("assiette", "Assiette requise.");
      if (r.mode === "taux" && Number(r.valeur) > 100)
        erreur("valeur", "Le taux s'exprime en pourcentage.");
    } else if (r.mode !== "aucun" || r.valeur !== null) {
      erreur("mode", "Une règle sans prélèvement ne porte pas de montant.");
    }
    if ((r.applicabilite === "exonere" || r.applicabilite === "suspendu") && !r.justificatif) {
      erreur("justificatif", "Justificatif ou référence d'attestation requis.");
    }
  });

export const ConfigurationFiscaleSchema = z
  .object({
    activite: texte.min(1),
    regimeImposition: texte.nullable(),
    regimeTva: texte.nullable(),
    prorataTva: z.number().min(0).max(100).nullable(),
    regles: z.array(RegleFiscaleSchema).min(1).max(100),
  })
  .strict()
  .superRefine((c, ctx) => {
    const cles = c.regles.map((r) => `${r.famille}/${r.operation}/${r.typeOperation}/${r.code}`);
    if (new Set(cles).size !== cles.length)
      ctx.addIssue({ code: "custom", path: ["regles"], message: "Règle en double." });
  });

export const NouveauProfilFiscalSchema = z
  .object({
    cabinetId: z.string().uuid(),
    profilId: z.string().uuid().nullable(),
    precedentId: z.string().uuid().nullable(),
    nom: texte.min(1).max(160),
    categorie: texte.min(1).max(160),
    jurisdiction: texte.min(1).max(16),
    dateEffet: date,
    configuration: ConfigurationFiscaleSchema,
  })
  .strict();

export type RegleFiscale = z.infer<typeof RegleFiscaleSchema>;
export type ConfigurationFiscale = z.infer<typeof ConfigurationFiscaleSchema>;
export type NouveauProfilFiscal = z.infer<typeof NouveauProfilFiscalSchema>;
export interface ProfilFiscal extends NouveauProfilFiscal {
  id: string;
  profilId: string;
  creeLe: string;
  creePar: string;
}
export interface FiscaliteDossier {
  id: string;
  clientId: string;
  cabinetId: string;
  versionProfilId: string;
  categorie: string;
  personnalise: boolean;
  dateEffet: string;
  configuration: ConfigurationFiscale;
  creeLe: string;
  creePar: string;
}
export interface CibleFiscale {
  clientId: string;
  precedentId: string | null;
}
export interface LotFiscal {
  cabinetId: string;
  versionProfilId: string;
  dateEffet: string;
  cibles: CibleFiscale[];
  /** Reprise explicite d’un seul dossier ; jamais une option de lot. */
  remplacerPersonnalisation?: boolean;
}
export interface ApercuFiscal {
  clientId: string;
  nom: string;
  precedentId: string | null;
  statut: "eligible" | "personnalise" | "juridiction" | "date" | "identique";
  avant: ConfigurationFiscale | null;
  apres: ConfigurationFiscale;
}
export interface CatalogueFiscal {
  code: string;
  libelle: string;
  famille: RegleFiscale["famille"];
  operation: RegleFiscale["operation"];
  mode: RegleFiscale["mode"];
  valeur: string | null;
  assiette: string;
  dansBaseTva: boolean | null;
  referenceLegale: string;
  seuil?: string | null | undefined;
}
