/**
 * La surface PME, et sa feuille de style — l'une ne va pas sans l'autre.
 *
 * ================================================================ POURQUOI
 *
 * `styles-pme.css` (230 Ko bruts) était importée par `styles.css` : chaque
 * page la bloquait au premier rendu, la vitrine et le cabinet compris (audit
 * web du 6 novembre 2026). Elle vient désormais avec l'élément qui pose
 * `data-surface="pme"` : seul un écran qui rend cette surface importe ce
 * module, et il n'est atteint que par le code découpé de ces écrans. Vite
 * attache la feuille au morceau de JavaScript de l'écran, et l'attend avant
 * de le résoudre — jamais un écran PME sans son dessin.
 *
 * Un composant et non une constante : une constante se replie à la
 * compilation, son module disparaît, et la feuille avec lui (mesuré).
 */
import type { ComponentPropsWithoutRef } from "react";

import "@/styles-espace-pme.css";

export function SurfacePme(props: ComponentPropsWithoutRef<"div">) {
  return <div data-surface="pme" {...props} />;
}
