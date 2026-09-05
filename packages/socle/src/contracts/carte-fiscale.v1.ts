/**
 * carte_fiscale.v1 — sortie de la lecture d'une carte d'identification fiscale.
 *
 * =============================================== POURQUOI UN CONTRAT À PART
 *
 * `extract.v1` décrit une FACTURE : un émetteur, des lignes de taux, des
 * totaux, des articles. Une carte d'identification fiscale n'a rien de tout
 * cela. Y faire entrer un matricule et un régime aurait rempli le contrat des
 * factures de champs facultatifs qui ne concernent aucune facture — et le jour
 * où un champ change, on ne saurait plus lequel des deux documents il sert.
 *
 * La doctrine du contrat le dit : une évolution incompatible crée un contrat
 * nouveau, jamais une mutation silencieuse.
 *
 * ============================================== POURQUOI CETTE CARTE, ET PAS
 * ============================================== UN FORMULAIRE
 *
 * Le référentiel fiscal porte ceci :
 *
 *   RAS_HONORAIRES_REEL_CONDITION — « Condition d'application du taux 3 % aux
 *   personnes physiques : présentation de la CARTE D'IDENTIFICATION FISCALE
 *   régime réel » — Article 52-I-a
 *
 * Le droit tunisien désigne lui-même cette carte comme la preuve du régime.
 * La lire est donc plus sûr que de le demander : un dirigeant se trompe sur
 * son régime, la carte non.
 *
 * ===================================================== TOUT EST FACULTATIF
 *
 * Chaque champ peut être nul, et c'est délibéré. Une carte mal cadrée, une
 * mention absente, une case vide : la lecture rend ce qu'elle voit, et rien
 * de plus. Un champ deviné serait un régime fiscal inventé — exactement ce que
 * la fiche existe pour empêcher.
 *
 * Le régime lu est un CODE du référentiel, jamais un texte libre : la base
 * refuse un régime qu'elle ne connaît pas, et cette validation est le dernier
 * rempart si l'œil lit de travers.
 */
import { z } from "zod";

const CONTRACT_VERSION = "carte_fiscale.v1" as const;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date ISO YYYY-MM-DD requise");

/** Un jour et un mois — « 12-31 ». L'année n'a pas de sens : la règle se répète. */
const jourEtMois = z
  .string()
  .regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/, "Clôture attendue au format MM-JJ");

const confidence = z.number().min(0).max(1);

export const CarteFiscaleV1 = z.object({
  contract: z.literal(CONTRACT_VERSION),

  /** La raison sociale telle qu'imprimée. */
  raison_sociale: z.string().min(1).nullable().default(null),
  /** Le matricule fiscal, tel qu'imprimé, sans reformatage. */
  matricule_fiscal: z.string().min(1).nullable().default(null),
  adresse: z.string().min(1).nullable().default(null),

  /**
   * Le régime, en CODE du référentiel : `reel`, `forfaitaire`…
   *
   * Non contraint ici par une énumération : les régimes vivent en base, datés
   * par juridiction (R4). Écrire la liste ici la figerait dans le code et
   * ferait mentir le produit le jour où elle change.
   */
  regime_imposition: z.string().min(1).nullable().default(null),
  regime_tva: z.string().min(1).nullable().default(null),

  /** L'activité déclarée, telle qu'imprimée. */
  activite: z.string().min(1).nullable().default(null),
  debut_activite: isoDate.nullable().default(null),
  cloture_exercice: jourEtMois.nullable().default(null),

  /** Le siège ou l'établissement que la carte désigne. */
  etablissement: z.string().min(1).nullable().default(null),

  field_confidence: z.record(z.string(), confidence).default({}),
});

export type CarteFiscaleV1 = z.infer<typeof CarteFiscaleV1>;

/**
 * Ce que la carte n'a pas donné.
 *
 * Sert à l'écran : il montre les champs manquants pour que l'expert les
 * complète, au lieu de laisser croire que la fiche est complète. R10 —
 * Regalica propose ce qu'elle a lu, l'expert arrête le paramétrage.
 */
export function champsManquants(carte: CarteFiscaleV1): string[] {
  const attendus: Array<[string, unknown]> = [
    ["raison_sociale", carte.raison_sociale],
    ["matricule_fiscal", carte.matricule_fiscal],
    ["regime_imposition", carte.regime_imposition],
    ["regime_tva", carte.regime_tva],
    ["activite", carte.activite],
  ];
  return attendus.filter(([, v]) => v === null || v === undefined).map(([k]) => k);
}
