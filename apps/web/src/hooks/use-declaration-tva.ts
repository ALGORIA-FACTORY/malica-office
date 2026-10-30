import { useQuery } from "@tanstack/react-query";

import { useI18n } from "@/i18n";
import { office } from "@/verticals/malica-office/composition";

/**
 * Les lignes de la déclaration de TVA du pack, en vigueur au jour dit, dans la
 * langue de l'écran (`ref.tva_declaration_lignes`). Le calcul de la TVA
 * (`tvaDesExtraits`) les exige : aucune ligne n'est écrite dans l'application.
 */
export function useDeclarationTva(packId: string | null | undefined, jour: string) {
  const { locale } = useI18n();
  return useQuery({
    // La langue entre dans la clé : les libellés sont traduits.
    queryKey: ["declaration-tva", packId, jour, locale],
    queryFn: () => office().referential.declarationTva(packId!, jour, locale),
    enabled: Boolean(packId),
    staleTime: 60 * 60 * 1000,
  });
}
