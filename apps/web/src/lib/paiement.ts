/**
 * Le nom d'un paiement en ligne, tel que l'écran le dit.
 *
 * La base nomme un paiement de facture par le NUMÉRO de la facture
 * (`public.paiement_facture_preparer`) : un numéro ne se traduit pas, la
 * phrase qui l'entoure si. Les autres paiements gardent le libellé que la
 * base leur donne.
 */
import type { MessageKey } from "@/i18n";
import type { PaiementEnLigne } from "@malica/socle/ports/repositories";

export function libelleDuPaiement(
  p: Pick<PaiementEnLigne, "objet" | "libelle">,
  t: (k: MessageKey, v?: Record<string, string | number>) => string,
): string {
  return p.objet === "facture"
    ? t("pme.reglages.paiement.facture", { numero: p.libelle })
    : p.libelle;
}
