/**
 * Télécharger une facture de la plateforme en PDF — un geste, deux écrans.
 *
 * Le titulaire d'une PME depuis ses réglages (Abonnement › Vos factures), l'opérateur depuis
 * la tour (Factures). Les deux lisent la même facture par `factureDetail` (sous la RLS de
 * chacun), la préparent par `factureImprimable` et la dessinent par `rendreFactureEnPdf` : une
 * seule mise en page, jamais deux.
 *
 * La tour peut aussi demander un APERÇU : la dernière facture, avec l'en-tête qu'elle est en
 * train de saisir (pas encore enregistré) et un filigrane « spécimen ».
 */
import { useMutation } from "@tanstack/react-query";

import marqueRg from "@/assets/rg-mark.svg";
import { enregistrerUnFichier } from "@/capabilities/enregistrer-un-fichier";
import { useI18n, type MessageKey } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { office } from "@/verticals/malica-office/composition";
import type { EnteteDeFacture } from "@malica/socle/ports/repositories";

export interface DemandeDeFacture {
  factureId: string;
  /** L'aperçu de la tour : l'en-tête lu, revu par ce qu'elle est en train de saisir. */
  apercu?: (entete: EnteteDeFacture) => EnteteDeFacture;
}

/** Le monogramme rG, chargé pour le canevas ; `null` s'il ne se charge pas. */
async function chargerLaMarque(): Promise<HTMLImageElement | null> {
  if (typeof Image === "undefined") return null;
  const image = new Image();
  image.src = marqueRg;
  try {
    await Promise.race([
      image.decode(),
      new Promise((_, rejeter) => setTimeout(() => rejeter(new Error("marque")), 3000)),
    ]);
    return image;
  } catch {
    return null;
  }
}

export function useTelechargerLaFacture() {
  const { t, locale, dir } = useI18n();
  const telecharger = useMutation({
    mutationFn: async (demande: DemandeDeFacture) => {
      const detail = await office().facturation.factureDetail(demande.factureId);
      const lue = demande.apercu ? { ...detail, entete: demande.apercu(detail.entete) } : detail;
      const [{ factureImprimable }, { rendreFactureEnPdf }] = await Promise.all([
        import("@/lib/facture-imprimable"),
        import("@/capabilities/facture-pdf"),
      ]);
      const imprimable = factureImprimable(lue, t, locale, Boolean(demande.apercu));
      const rendu = await rendreFactureEnPdf(imprimable, dir, await chargerLaMarque());
      return (await enregistrerUnFichier(rendu.blob, rendu.name)).chemin;
    },
  });
  /** Ce qui n'a pas marché, dans la langue du lecteur. */
  const erreur = telecharger.error
    ? telecharger.error instanceof Error && telecharger.error.message.startsWith("facture.pdf.")
      ? t(telecharger.error.message as MessageKey)
      : texteDeLErreur(telecharger.error, "hooks/use-telecharger-la-facture", t("common.error"))
    : null;
  return { telecharger, erreur };
}
