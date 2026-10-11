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
 * `ref.socle_params` porte `money.decimals` depuis le 25 août, et le dépôt
 * `referentiel.socleParams` LÈVE une erreur explicite quand il manque.
 *
 * ================================================== POURQUOI UN `null` ET PAS UN DÉFAUT
 *
 * Tant que le pack n'est pas chargé, ce hook rend `null` : l'écran n'a pas
 * encore de quoi écrire un montant, et il doit attendre plutôt que d'en
 * écrire un faux. Mettre « 2 » en attendant ferait clignoter un chiffre juste
 * vers un chiffre faux — ou l'inverse, ce qui est pire.
 */
import { useQuery } from "@tanstack/react-query";

import { usePme } from "@/components/malica/pme-context";
import { office } from "@/verticals/malica-office/composition";

/** Les décimales du pack du dossier, ou `null` tant qu'on ne les a pas. */
export function useDecimales(): number | null {
  const pme = usePme();
  const params = useQuery({
    queryKey: ["socle-params", pme.packId],
    queryFn: () => office().referential.socleParams(pme.packId!),
    enabled: !!pme.packId,
    staleTime: 60 * 60 * 1000,
  });
  return params.data?.moneyDecimals ?? null;
}
