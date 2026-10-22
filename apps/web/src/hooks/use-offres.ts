/**
 * Le catalogue des offres — leur nom et ce qu'elles ouvrent, sans aucun prix.
 *
 * « Team », « Premium », « Solo » étaient écrits en dur dans trois écrans, et
 * deux fonctions `nomDeLOffre` (l'une capitalisait le code, l'autre le
 * traduisait à la main) se partageaient le même travail. Le nom vit dans
 * `ref.offres.libelle`, l'ouverture des places et des sociétés dans ses
 * colonnes, et la permission de recharger dans `recharges_permises` : on les
 * lit, on ne les recopie pas.
 */
import { useQuery } from "@tanstack/react-query";

import type { OffreAuCatalogue } from "@malica/socle/ports/repositories";

import { ouvreLesSocietes } from "@/lib/forfait";
import { office } from "@/verticals/malica-office/composition";

export function useCatalogueDesOffres() {
  return useQuery({
    queryKey: ["catalogue-des-offres"],
    queryFn: () => office().facturation.catalogueDesOffres(),
    staleTime: 60 * 60 * 1000,
    retry: false,
  });
}

/** Le nom d'une offre, tel que la base le porte ; le code tant que le catalogue n'est pas lu. */
export function libelleDOffre(
  catalogue: readonly OffreAuCatalogue[] | undefined,
  code: string,
): string {
  return catalogue?.find((o) => o.code === code)?.libelle ?? code;
}

/**
 * Les offres qui ouvrent, les premières dans l'ordre du catalogue, les places
 * (des sièges inclus) et les sociétés (plus d'une). `null` tant que rien ne
 * l'ouvre ou que le catalogue n'est pas lu.
 */
export function offresQuiOuvrent(catalogue: readonly OffreAuCatalogue[] | undefined): {
  sieges: OffreAuCatalogue | null;
  societes: OffreAuCatalogue | null;
} {
  const tri = [...(catalogue ?? [])].sort((a, b) => a.rang - b.rang);
  return {
    sieges: tri.find((o) => Number(o.sieges_inclus) > 0) ?? null,
    societes: tri.find(ouvreLesSocietes) ?? null,
  };
}

/** La première offre, au-dessus de celle-ci, qui permet de recharger des lectures. */
export function offreQuiPermetDeRecharger(
  catalogue: readonly OffreAuCatalogue[] | undefined,
  code: string | null | undefined,
): OffreAuCatalogue | null {
  const tri = [...(catalogue ?? [])].sort((a, b) => a.rang - b.rang);
  const rang = tri.find((o) => o.code === code)?.rang ?? -Infinity;
  return tri.find((o) => o.rang > rang && o.recharges_permises) ?? null;
}
