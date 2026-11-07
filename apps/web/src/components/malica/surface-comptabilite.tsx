/**
 * La surface de la comptabilité (le cabinet), et sa feuille de style.
 *
 * Même raison que `surface-pme.tsx` : importée en tête de `cabinet.tsx`, la
 * feuille restait dans la partie du fichier de route que le routeur charge
 * d'emblée, et partait avec le premier écran de TOUTES les pages. Portée par
 * l'élément qui pose `data-surface="comptabilite"`, elle suit le code découpé
 * des écrans qui le rendent.
 */
import type { ComponentPropsWithoutRef } from "react";

import "@/styles-comptabilite.css";

type Props = ComponentPropsWithoutRef<"div"> & { as?: "div" | "section" };

export function SurfaceComptabilite({ as: Balise = "div", ...props }: Props) {
  return <Balise data-surface="comptabilite" {...props} />;
}
