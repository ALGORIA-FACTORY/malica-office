/**
 * Le nom d'un paiement en ligne, tel que l'écran le dit.
 *
 * La base nomme un paiement de facture par le NUMÉRO de la facture
 * (`public.paiement_facture_preparer`) : un numéro ne se traduit pas, la
 * phrase qui l'entoure si. Les autres paiements gardent le libellé que la
 * base leur donne.
 */
import type { MessageKey } from "@/i18n";
import type { EtatDeFacture, PaiementEnLigne } from "@malica/socle/ports/repositories";

export function libelleDuPaiement(
  p: Pick<PaiementEnLigne, "objet" | "libelle">,
  t: (k: MessageKey, v?: Record<string, string | number>) => string,
): string {
  return p.objet === "facture"
    ? t("pme.reglages.paiement.facture", { numero: p.libelle })
    : p.libelle;
}

/** L'état d'une facture (`facturation.encours_v`), dit dans la langue de la personne. */
export const ETAT_DE_FACTURE: Record<EtatDeFacture, MessageKey> = {
  a_echoir: "pme.reglages.factures.etat.a_echoir",
  en_retard: "pme.reglages.factures.etat.en_retard",
  partielle: "cab.abo.fac.statut.partielle",
  payee: "cab.abo.fac.statut.payee",
  annulee: "cab.abo.fac.statut.annulee",
  irrecouvrable: "cab.abo.fac.statut.irrecouvrable",
};
