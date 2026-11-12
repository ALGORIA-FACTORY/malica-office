/**
 * Imprimer des pièces de la bibliothèque — le geste, pour les deux espaces.
 *
 * Le serveur compose un PDF éphémère (`POST /impressions`) à partir de ce que
 * la personne voit ; ce crochet le demande, puis le remet à l'impression
 * (`imprimerUnPdf`). Trois issues qui ne sont pas des pannes se disent à
 * l'écran : un lot volumineux à confirmer (pages et taille), un lot au-delà du
 * plafond, et le PDF prêt.
 */
import { useMutation } from "@tanstack/react-query";
import { useRef } from "react";

import { imprimerUnPdf } from "@/capabilities/imprimer-un-pdf";
import { useI18n } from "@/i18n";
import { transport } from "@/lib/transport";
import { ErreurApi } from "@/lib/transport/erreurs";

type PorteeDImpression = "piece" | "dossier" | "selection";

export interface DemandeDImpression {
  pieces: readonly string[];
  /** La comptabilité imprime sous son mandat ; absent : la personne imprime ce qu'elle voit. */
  cabinetId?: string;
  portee: PorteeDImpression;
  /** Ce qui s'imprime, pour nommer le PDF remis dans la coque. */
  nom: string;
}

/** Ce que le serveur a répondu, hors panne. */
export type IssueDImpression =
  | { genre: "a_confirmer"; pages: number; octets: number }
  | { genre: "trop_volumineuse"; pages: number; pagesMax: number }
  | { genre: "pret"; chemin: string | null };

export function useImpression(demande: DemandeDImpression) {
  const { locale } = useI18n();
  const dernier = useRef<Blob | null>(null);
  // `enregistrerUnFichier` en fait un nom que le système de fichiers accepte.
  const fichier = () => `${demande.nom}.pdf`;
  const composer = useMutation({
    mutationFn: async (confirme: boolean): Promise<IssueDImpression> => {
      const reponse = await transport().appeler("/impressions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pieces: demande.pieces,
          cabinetId: demande.cabinetId ?? null,
          portee: demande.portee,
          langue: locale,
          confirme,
        }),
      });
      if (!reponse.ok) {
        const corps = (await reponse.json().catch(() => null)) as { erreur?: string } | null;
        throw new ErreurApi(corps?.erreur ?? `/impressions : ${reponse.status}`, reponse.status);
      }
      if (!(reponse.headers.get("content-type") ?? "").includes("application/pdf")) {
        const constat = (await reponse.json()) as {
          etat: "a_confirmer" | "trop_volumineuse";
          pages: number;
          octets: number;
          pagesMax: number;
        };
        return constat.etat === "a_confirmer"
          ? { genre: "a_confirmer", pages: constat.pages, octets: constat.octets }
          : { genre: "trop_volumineuse", pages: constat.pages, pagesMax: constat.pagesMax };
      }
      const pdf = await reponse.blob();
      dernier.current = pdf;
      const { chemin } = await imprimerUnPdf(pdf, fichier());
      return { genre: "pret", chemin };
    },
  });
  return {
    /** Demande le PDF ; `true` : la personne a lu l'avertissement de volume. */
    lancer: (confirme = false) => composer.mutate(confirme),
    /** Rouvre la boîte d'impression sur le PDF déjà composé. */
    rouvrir: () => {
      if (dernier.current) void imprimerUnPdf(dernier.current, fichier());
    },
    oublier: () => {
      dernier.current = null;
      composer.reset();
    },
    issue: composer.data ?? null,
    enCours: composer.isPending,
    erreur: composer.error,
  };
}

/** « 12,4 » : des mégaoctets, à une décimale, dans la langue de la personne. */
export function megaoctets(octets: number, locale: string): string {
  return (octets / (1024 * 1024)).toLocaleString(locale, { maximumFractionDigits: 1 });
}
