import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        /*
         * Un seul nouvel essai, pas trois : sur un téléphone, trois essais
         * espacés font attendre sept secondes avant de dire qu'il n'y a pas
         * de réseau — et la personne a déjà rangé l'appareil.
         */
        retry: 1,
        /*
         * Trente secondes de fraîcheur : revenir sur un écran qu'on vient de
         * quitter ne relance pas tout. Ce qui change vraiment est invalidé par
         * le geste qui le change.
         */
        staleTime: 30_000,
        /*
         * Hors ligne, on sert ce qu'on a et on n'annonce pas une panne :
         * la requête part si le réseau est là, et attend sinon.
         */
        networkMode: "offlineFirst",
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
