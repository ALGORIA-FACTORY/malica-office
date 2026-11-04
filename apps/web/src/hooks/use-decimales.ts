/**
 * Les décimales de la devise, lues au pack — jamais devinées.
 *
 * ================================================================= POURQUOI
 *
 * Une table de six codes vivait dans le Socle : TND 3, EUR 2, XOF 0, et un
 * repli implicite à 2 pour le reste. Quatre écrans l'appelaient.
 *
 * R4 nomme le « code devise » parmi les interdits, et son corollaire interdit
 * le repli implicite — pour une raison que ce cas illustre exactement : une
 * juridiction à 2 décimales aurait affiché un dinar là où il y a un millime,
 * sur l'accueil et dans la synthèse du cabinet, sans aucune erreur. Un
 * résultat plausible et faux, ce que R4 appelle la pire forme d'erreur.
 *
 * Le dépôt `referentiel.socleParams` rend l'exposant de la devise du pack,
 * lu dans `ref.devises` — la seule source des décimales d'une devise.
 *
 * ================================================== POURQUOI UN `null` ET PAS UN DÉFAUT
 *
 * Tant que le pack n'est pas chargé, ce hook rend `null` : l'écran n'a pas
 * encore de quoi écrire un montant, et il doit attendre plutôt que d'en
 * écrire un faux. Mettre « 2 » en attendant ferait clignoter un chiffre juste
 * vers un chiffre faux — ou l'inverse, ce qui est pire.
 */
import { useQuery } from "@tanstack/react-query";

import { D, toFixedStr } from "@malica/socle/domain/decimal";

import { usePme } from "@/components/malica/pme-context";
import { useI18n } from "@/i18n";
import { montant } from "@/lib/lisible";
import { office } from "@/verticals/malica-office/composition";

/** Les décimales du pack du dossier, ou `null` tant qu'on ne les a pas. */
function useParamsDuPack() {
  const pme = usePme();
  return useQuery({
    queryKey: ["socle-params", pme.packId],
    queryFn: () => office().referential.socleParams(pme.packId!),
    enabled: !!pme.packId,
    staleTime: 60 * 60 * 1000,
  });
}

export function useDecimales(): number | null {
  return useParamsDuPack().data?.moneyDecimals ?? null;
}

/** Vrai si les paramètres du pack n'ont pas pu être lus (revue de #222). */
export function useDecimalesEnEchec(): boolean {
  return useParamsDuPack().isError;
}

/**
 * Un prix lu en base (`numeric` à six décimales : « 23.610000 ») à l'échelle
 * de la devise, dans la langue du lecteur : « 23,610 ». Recette du 21 octobre
 * 2026 : les offres s'affichaient « 23.610000 TND », « 11.71 », « 108.1 ».
 * Tant que les décimales ne sont pas lues, rien ne s'écrit (voir plus haut).
 */
export function usePrix(): (valeur: string | number | null | undefined) => string {
  const decimales = useDecimales();
  const { locale } = useI18n();
  return (valeur) => {
    // `mon_annuel` rend ses montants en nombre JSON, les grilles en chaîne :
    // les deux se lisent, aucun ne fait tomber l'écran (CI du 21 octobre).
    const brut = valeur === null || valeur === undefined ? "" : String(valeur).trim();
    if (brut === "" || decimales === null) return "";
    try {
      return montant(toFixedStr(D(brut), decimales), locale);
    } catch {
      return montant(brut, locale);
    }
  };
}
