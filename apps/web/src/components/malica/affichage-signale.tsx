/**
 * « Affiché », et pas seulement « servi ».
 *
 * L'API sait ce qu'elle a rendu ; seul l'écran sait ce qu'il a MONTRÉ. Ce
 * composant se pose à côté des montants rendus, ne dessine rien, et dit au
 * journal d'observabilité, une fois par rendu, les valeurs qui viennent
 * d'être montrées pour cette pièce et sur quelle plateforme
 * (`lib/parcours/signaleur.ts`). Les mêmes valeurs rendues de nouveau ne
 * repartent pas ; l'API dédoublonne aussi.
 */
import { useEffect } from "react";

import { signaleur } from "@/lib/parcours";

export function AffichageSignale({
  pieceId,
  ecran,
  source,
  valeurs,
}: {
  pieceId: string;
  ecran: "pme" | "comptabilite";
  /** D'où viennent les valeurs montrées : la lecture, l'écriture du cabinet, la proposition. */
  source: string;
  valeurs: Readonly<Record<string, string | null | undefined>>;
}) {
  // Une empreinte stable : un nouvel objet aux mêmes valeurs n'est pas un nouveau rendu.
  const rendu = JSON.stringify(Object.entries(valeurs).map(([k, v]) => [k, v ?? null]));
  useEffect(() => {
    const montrees = Object.fromEntries(JSON.parse(rendu) as [string, string | null][]);
    if (Object.values(montrees).every((v) => v === null)) return;
    signaleur().signalerLAffichage({ piece: pieceId, ecran, source, valeurs: montrees });
  }, [pieceId, ecran, source, rendu]);
  return null;
}
