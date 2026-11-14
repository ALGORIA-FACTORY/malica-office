/**
 * Exporter des pièces de la bibliothèque — le geste, pour la société.
 *
 * Le serveur prépare et GARDE un ZIP et/ou un Excel (`POST /exports/bibliotheque`) ;
 * ce crochet le demande, puis remet chaque fichier gardé à la personne
 * (`/exports/:id/contenu`, par `enregistrerUnFichier` : le navigateur ou la coque).
 * Deux issues qui ne sont pas des pannes se disent à l'écran : les fichiers prêts,
 * et un lot au-delà de la taille maximale de la base.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { enregistrerUnFichier } from "@/capabilities/enregistrer-un-fichier";
import { useI18n } from "@/i18n";
import { transport } from "@/lib/transport";
import { ErreurApi } from "@/lib/transport/erreurs";

export interface FichierExporte {
  id: string;
  format: "bibliotheque_zip" | "bibliotheque_xlsx";
  nomDeFichier: string;
  taille: number;
}

export type IssueDExport =
  | { genre: "pret"; fichiers: FichierExporte[]; absents: number }
  | { genre: "trop_volumineuse"; octets: number; octetsMax: number };

export interface DemandeDExport {
  pieces: readonly string[];
  zip: boolean;
  excel: boolean;
}

export function useExportBibliotheque() {
  const { locale } = useI18n();
  const qc = useQueryClient();
  const preparer = useMutation({
    mutationFn: async (demande: DemandeDExport): Promise<IssueDExport> => {
      const reponse = await transport().appeler("/exports/bibliotheque", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...demande, langue: locale }),
      });
      const corps = (await reponse.json().catch(() => null)) as {
        etat?: "pret" | "trop_volumineuse";
        fichiers?: FichierExporte[];
        absents?: string[];
        octets?: number;
        octetsMax?: number;
        erreur?: string;
      } | null;
      if (!reponse.ok || !corps?.etat)
        throw new ErreurApi(
          corps?.erreur ?? `/exports/bibliotheque : ${reponse.status}`,
          reponse.status,
        );
      if (corps.etat === "trop_volumineuse")
        return {
          genre: "trop_volumineuse",
          octets: corps.octets ?? 0,
          octetsMax: corps.octetsMax ?? 0,
        };
      return { genre: "pret", fichiers: corps.fichiers ?? [], absents: corps.absents?.length ?? 0 };
    },
    // Les pièces remises changent d'état : « À exporter » se relit.
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pieces-lues"] }),
  });
  const remettre = useMutation({
    mutationFn: async (fichier: FichierExporte) => {
      const reponse = await transport().appeler(`/exports/${fichier.id}/contenu`);
      if (!reponse.ok)
        throw new ErreurApi(`/exports/:id/contenu : ${reponse.status}`, reponse.status);
      return enregistrerUnFichier(await reponse.blob(), fichier.nomDeFichier);
    },
  });
  return {
    lancer: (demande: DemandeDExport) => preparer.mutate(demande),
    oublier: () => {
      preparer.reset();
      remettre.reset();
    },
    remettre: (fichier: FichierExporte) => remettre.mutate(fichier),
    issue: preparer.data ?? null,
    enCours: preparer.isPending,
    erreur: preparer.error ?? remettre.error,
    /** Où le dernier fichier a été écrit, dans la coque ; `null` dans un navigateur. */
    chemin: remettre.data?.chemin ?? null,
  };
}
