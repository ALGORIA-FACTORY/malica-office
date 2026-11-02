/**
 * Le document d'une facture — ce que son PDF affiche, tel que la base le rend.
 *
 * `facturation.document_de_facture` le lit SOUS L'IDENTITÉ DE L'APPELANT :
 * si la RLS ne rend pas la facture, le document vaut `null`, et la route
 * répond 404 (jamais 403 : l'inexistant et l'interdit ne se distinguent pas).
 * Rien n'est recalculé ici : montants, libellés, rubriques, état et devise
 * viennent de la base, dans la langue demandée (R3, R4).
 */
import type { Requete } from "../../db.ts";

export type Langue = "fr" | "en" | "ar";

export const LANGUES: readonly Langue[] = ["fr", "en", "ar"];

export interface LigneDuDocument {
  ordinal: number;
  nature: string;
  libelle: string;
  quantite: number;
  prix_unitaire: number;
  montant_ht: number;
}

export interface DocumentDeFacture {
  facture: {
    id: string;
    numero: string;
    nature: "facture" | "avoir";
    periode: string;
    emise_le: string;
    echeance_le: string;
    montant_ht: number;
    taux_tva: number;
    montant_tva: number;
    timbre: number;
    montant_ttc: number;
    devise: string;
    payeur_type: string;
    destinataire_nom: string;
    destinataire_legal_id: string | null;
    destinataire_adresse: string | null;
    reference_abonne: string | null;
    emetteur_nom: string | null;
    emetteur_matricule: string | null;
    emetteur_adresse: string | null;
    motif: string | null;
  };
  langue: Langue;
  periode: { mois: string | null; annee: number };
  lignes: LigneDuDocument[];
  encours: { encaisse: number; reste_du: number; etat: string; avoirs: number } | null;
  avoir_de: { numero: string; emise_le: string } | null;
  rubriques: Record<string, string>;
  devise: { code: string; exposant: number; separateur: string } | null;
  nature_libelle: string;
  /** La page de l'espace client où payer (le gabarit du courriel de facture la nomme). */
  route_paiement: string | null;
  original: string | null;
}

/** La langue demandée, si elle en est une ; sinon celle de la facture. */
export function langueDemandee(valeur: unknown): Langue | null {
  return typeof valeur === "string" && (LANGUES as readonly string[]).includes(valeur)
    ? (valeur as Langue)
    : null;
}

export async function lireDocument(
  db: Requete,
  factureId: string,
  langue: Langue | null,
): Promise<DocumentDeFacture | null> {
  const { rows } = await db.query<{ d: DocumentDeFacture | null }>(
    "select facturation.document_de_facture($1, $2) as d",
    [factureId, langue],
  );
  return rows[0]?.d ?? null;
}
