import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { noterAuJournal } from "./lib/journal-atelier";
import { estIntrouvable } from "./lib/erreur-lisible";
import { ErreurReseau } from "./lib/transport/erreurs";
import { routeTree } from "./routeTree.gen";

/*
 * ============================================ AUCUN ÉCHEC NE SE PERD (27 octobre 2026)
 *
 * « Pas d'erreur à l'écran, tout dans le journal, pour que tu corriges. »
 * L'audit a trouvé des gestes dont l'échec n'allait nulle part : une
 * mutation sans `onError` (supprimer une conversation, ouvrir un fil, la
 * relance d'un client…), une lecture en échec rendue comme une liste vide.
 * Le client de requêtes inscrit donc au journal, en base, tout échec qu'un
 * écran ne traite pas lui-même. Pas de réseau n'est pas une panne : on ne
 * l'inscrit pas.
 */
function journaliser(ou: string, raison: unknown): void {
  if (raison instanceof ErreurReseau) return;
  /*
   * Introuvable (404) n'est pas une panne non plus : une pièce supprimée dont
   * un écran gardait l'aperçu, un lien vers ce qui n'est plus là. L'écran le
   * dit (`estIntrouvable`) ; au journal, il cachait les vraies pannes
   * (« Ce qui n'a pas marché », 1er novembre 2026).
   */
  if (estIntrouvable(raison)) return;
  // L'écran d'où vient l'échec : c'est lui qu'on ouvre pour corriger.
  const ecran = typeof window === "undefined" ? "" : `${window.location.pathname} · `;
  noterAuJournal(`${ecran}${ou}`, raison);
}

export const getRouter = () => {
  const queryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (raison, requete) =>
        journaliser(`lecture ${JSON.stringify(requete.queryKey)}`, raison),
    }),
    mutationCache: new MutationCache({
      // Un écran qui traite son échec passe par `texteDeLErreur`, qui
      // journalise déjà : on ne l'inscrit pas deux fois.
      onError: (raison, _variables, _contexte, mutation) => {
        if (!mutation.options.onError)
          journaliser(
            `geste ${JSON.stringify(mutation.options.mutationKey ?? "sans clé")}`,
            raison,
          );
      },
    }),
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
         * Trente minutes en mémoire (cinq par défaut) : une société quittée
         * puis rouverte s'affiche aussitôt, et ce que le cache de l'appareil
         * a remis à l'ouverture (`lib/cache-de-l-appareil`) ne s'efface pas
         * avant que l'écran qui le montre soit ouvert.
         */
        gcTime: 30 * 60 * 1000,
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
    /*
     * Une adresse inconnue SOUS un espace (/pme/…, /cabinet/…) tombait sur
     * le « Not Found » anglais du routeur, faute de page à ce niveau
     * (ANO-037). La page introuvable de la racine, en trois langues, sert
     * toutes les adresses.
     */
    notFoundMode: "root",
  });

  return router;
};
