/**
 * Un écran plein, par-dessus l'application — et rien de ce qu'il recouvre
 * n'est plus atteignable.
 *
 * ============================================================== POURQUOI
 *
 * Le fil de Malica, la visionneuse, le scanner, le tiroir du cabinet : des
 * écrans qui recouvrent tout, posés en position fixe sur tout l'écran. La
 * page, elle, restait là — invisible à l'œil, mais entière dans l'arbre
 * d'accessibilité. Un utilisateur de TalkBack parcourait et activait des
 * boutons qu'il ne voyait pas ; l'épreuve Maestro, qui lit le même arbre, tapait
 * le visage de Malica sous le fil ouvert (17 septembre 2026).
 *
 * Tant qu'il est monté, ce composant rend INERTE tout ce qui l'entoure : chaque
 * frère de chacun de ses ancêtres, jusqu'au <body>. `inert` retire du toucher,
 * du focus et de l'arbre d'accessibilité ; `aria-hidden` double pour les
 * WebView plus anciennes. Au démontage, chaque élément retrouve exactement
 * l'état qu'il avait — y compris un `aria-hidden` qu'il portait déjà.
 *
 * Il se déclare en boîte de dialogue modale : le lecteur d'écran l'annonce comme
 * ce qu'il est.
 */
import { useLayoutEffect, useRef, type HTMLAttributes, type ReactNode } from "react";

type Etat = { element: Element; inert: string | null; ariaHidden: string | null };

/** Rend inerte tout ce qui entoure `element`. Rend ce qui restaure l'état d'avant. */
function rendreLeResteInerte(element: HTMLElement): () => void {
  const touches: Etat[] = [];
  for (let noeud: HTMLElement | null = element; noeud?.parentElement; noeud = noeud.parentElement) {
    if (noeud === document.body) break;
    for (const frere of Array.from(noeud.parentElement.children)) {
      if (frere === noeud) continue;
      touches.push({
        element: frere,
        inert: frere.getAttribute("inert"),
        ariaHidden: frere.getAttribute("aria-hidden"),
      });
      frere.setAttribute("inert", "");
      frere.setAttribute("aria-hidden", "true");
    }
  }
  return () => {
    for (const { element: e, inert, ariaHidden } of touches.reverse()) {
      if (inert === null) e.removeAttribute("inert");
      else e.setAttribute("inert", inert);
      if (ariaHidden === null) e.removeAttribute("aria-hidden");
      else e.setAttribute("aria-hidden", ariaHidden);
    }
  };
}

export function EcranPlein({
  children,
  ...attributs
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  // Avant la peinture : aucune image où l'écran est ouvert et le fond encore actif.
  useLayoutEffect(() => (ref.current ? rendreLeResteInerte(ref.current) : undefined), []);
  return (
    <div ref={ref} role="dialog" aria-modal="true" {...attributs}>
      {children}
    </div>
  );
}
