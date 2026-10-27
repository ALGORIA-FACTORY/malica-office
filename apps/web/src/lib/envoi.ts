/**
 * Ce qui reste à envoyer, et la pièce d'après — partagé par l'écran
 * « Envoyé » de la fiche et le lot de la bibliothèque (maquette validée le
 * 27 octobre 2026).
 *
 * Une seule définition de « reste à transmettre » : la pièce est dans la
 * société (`entite`), le dirigeant n'a pas DÉCIDÉ de la garder, et le cabinet
 * ne l'a pas retournée (un retour se renvoie par sa propre carte, avec la
 * preuve du geste).
 */
export interface PieceAEnvoyer {
  id: string;
  vis: string;
  gardeeLe?: string | null;
  status: string;
}

export function resteATransmettre(p: PieceAEnvoyer): boolean {
  return p.vis === "entite" && !p.gardeeLe && p.status !== "retournee";
}

/**
 * La pièce suivante à décider, après `courante` dans l'ordre de la liste —
 * puis depuis le début. `null` : il n'y en a plus, et « Pièce suivante » ne
 * s'affiche pas.
 */
export function pieceSuivanteATransmettre<P extends PieceAEnvoyer>(
  pieces: readonly P[],
  courante: string,
): P | null {
  const rang = pieces.findIndex((p) => p.id === courante);
  const ordre = rang < 0 ? pieces : [...pieces.slice(rang + 1), ...pieces.slice(0, rang)];
  return ordre.find((p) => p.id !== courante && resteATransmettre(p)) ?? null;
}
