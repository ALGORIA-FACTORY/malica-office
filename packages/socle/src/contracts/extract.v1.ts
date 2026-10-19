/**
 * extract.v1 — sortie du lecteur de pièces (OCR).
 * L'OCR n'existe pas encore ; ce contrat est la surface consommée par le socle.
 * Toute évolution incompatible crée `extract.v2`, jamais une mutation silencieuse.
 */
import { z } from "zod";

const CONTRACT_VERSION = "extract.v1" as const;

// Un montant est TOUJOURS une chaîne décimale — jamais un float.
// Le socle interprète cette chaîne via Decimal.js.
const decimalString = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, "Montant invalide (attendu chaîne décimale)");

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date ISO YYYY-MM-DD requise");

const confidence = z.number().min(0).max(1);

export const ExtractLineV1 = z.object({
  label: z.string().min(1),
  tax_code: z.string().min(1), // ex. "TVA_19" ; référence ref_office.tax_rates.code
  base_ht: decimalString,
  vat_amount: decimalString,
  ttc: decimalString,
  confidence: confidence.optional(),
});

/**
 * Article facturé — désignation, quantité, prix unitaires. Ajout compatible :
 * ces champs servent l'analyse (achats, marges, rotations) et n'entrent dans
 * aucun calcul d'équilibre, qui reste porté par les lignes de taux.
 */
export const ExtractArticleV1 = z.object({
  designation: z.string().min(1),
  quantity: decimalString.nullable().default(null),
  unit_price_ht: decimalString.nullable().default(null),
  unit_price_ttc: decimalString.nullable().default(null),
  total_ht: decimalString.nullable().default(null),
  tax_code: z.string().min(1).nullable().default(null),
});

/**
 * Droit ou taxe hors TVA imprimé sur la pièce (droit de timbre…).
 * Le code renvoie à `ref.fiscal_charges` : aucun montant ni compte en dur.
 */
export const ExtractChargeV1 = z.object({
  code: z.string().min(1),
  label: z.string().default(""),
  amount: decimalString,
});

export const ExtractV1 = z.object({
  contract: z.literal(CONTRACT_VERSION),
  issuer: z.string().min(1),
  document_date: isoDate,
  currency: z.string().length(3),
  lines: z.array(ExtractLineV1).min(1),
  articles: z.array(ExtractArticleV1).default([]),
  other_charges: z.array(ExtractChargeV1).default([]),
  totals: z.object({
    base_ht: decimalString,
    vat: decimalString,
    ttc: decimalString,
  }),
  references: z.record(z.string(), z.string()).default({}),
  field_confidence: z.record(z.string(), confidence).default({}),
  // Type métier : facture d'achat, de vente, note de frais, etc.
  document_kind: z.enum(["facture_achat", "facture_vente"]),
});

/**
 * La clé qui porte la confiance GLOBALE dans `field_confidence`.
 *
 * ============================================ LA HUITIÈME OCCURRENCE, ET POURQUOI
 *
 * `field_confidence` est un `Record<string, number>` : **aucun type ne tient sa
 * clé**, d'aucun côté. Elle était écrite à la main en trois endroits — deux qui
 * l'écrivent en TypeScript, un qui la relit en SQL (`payload ->
 * 'field_confidence' ->> 'overall'`, dans la file du cabinet).
 *
 * Un renommage faisait donc passer la colonne « confiance » de la supervision à
 * `null`, **sans erreur ni drapeau** — la file se triait encore, simplement sans
 * sa confiance.
 *
 * C'est la huitième fois dans ce dépôt qu'un nom composé à la main casse un
 * appariement muet, après le rôle écrit en dur dans le journal (dix jours de
 * mesures perdues), le suffixe `+pdf-scan`, un couple de tarif introuvable, un
 * tarif daté du lendemain, un champ de relations renommé, un nom de référence
 * libre qui cassait le sens de la pièce, et l'invite qui demandait des noms
 * qu'elle écrivait séparément.
 *
 * Les sept premières ont été trouvées par accident. **Celle-ci a été trouvée en
 * la cherchant**, et c'est la seule raison pour laquelle elle est ici.
 *
 * Elle vit dans le contrat parce que c'est le contrat qui déclare le champ : la
 * clé n'appartient ni à qui l'écrit ni à qui la relit.
 */
export const CLE_CONFIANCE_GLOBALE = "overall";

export type ExtractV1 = z.infer<typeof ExtractV1>;
export type ExtractLineV1 = z.infer<typeof ExtractLineV1>;
export type ExtractArticleV1 = z.infer<typeof ExtractArticleV1>;
export type ExtractChargeV1 = z.infer<typeof ExtractChargeV1>;
