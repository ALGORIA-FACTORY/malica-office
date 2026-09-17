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
 * du focus et de l'arbre d'accessibilité. Au démontage, chaque élément retrouve
 * exactement l'état qu'il avait.
 *
 * INERT SEUL — ni `aria-hidden` sur le fond, ni `aria-modal`, ni rôle. Sur
 * l'émulateur, le fil de Malica ouvert, la WebView ne présentait plus RIEN à
 * l'arbre d'accessibilité, pas même le fil : avec les trois attributs
 * (exécution 35221075339), puis avec `role="dialog"` et `inert` (35225328747).
 * Il ne reste que `inert` : si l'arbre ne revient pas, c'est lui, et cette
 * correction est retirée (D25).
 */
import { useLayoutEffect, useRef, type HTMLAttributes, type ReactNode } from "react";

type Etat = { element: Element; inert: string | null };

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
      });
      frere.setAttribute("inert", "");
    }
  }
  return () => {
    for (const { element: e, inert } of touches.reverse()) {
      if (inert === null) e.removeAttribute("inert");
      else e.setAttribute("inert", inert);
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
    <div ref={ref} {...attributs}>
      {children}
    </div>
  );
}
