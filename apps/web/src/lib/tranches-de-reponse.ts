/**
 * Une réponse de Malica, découpée en tranches : du texte, puis les blocs
 * qu'elle a montrés à cet endroit, puis la suite du texte.
 *
 * Chaque bloc sait où il a été montré (`apres` : le nombre de caractères de la
 * réponse déjà écrits). On ne coupe jamais un paragraphe en deux : un bloc dont
 * la place tombe au milieu d'un paragraphe passe à la fin de ce paragraphe. Un
 * bloc sans place (réponse ancienne), ou dont la place dépasse le texte reçu
 * (le flux n'y est pas encore), vient après le texte.
 *
 * Pur : il ne fait que ranger.
 */
import type { BlocDeReponse } from "@malica/socle/ports/assistant";

export type TrancheDeReponse =
  { genre: "texte"; texte: string } | { genre: "blocs"; blocs: BlocDeReponse[] };

/** La fin du paragraphe où tombe `position` : la position elle-même si elle est déjà entre deux. */
function finDuParagraphe(texte: string, position: number): number {
  if (position <= 0) return 0;
  if (position >= texte.length) return texte.length;
  // Déjà sur une frontière : ce qui précède finit un paragraphe, ou ce qui suit en ouvre un.
  if (/\n\s*\n$/.test(texte.slice(0, position)) || /^\s*\n\s*\n/.test(texte.slice(position))) {
    return position;
  }
  const suite = texte.indexOf("\n\n", position);
  return suite === -1 ? texte.length : suite;
}

export function tranchesDeReponse(
  texte: string,
  blocs: readonly BlocDeReponse[],
): TrancheDeReponse[] {
  const places = blocs
    .map((bloc, ordre) => ({
      bloc,
      ordre,
      place:
        typeof bloc.apres === "number" && bloc.apres <= texte.length
          ? finDuParagraphe(texte, bloc.apres)
          : texte.length,
    }))
    .sort((a, b) => a.place - b.place || a.ordre - b.ordre);

  const tranches: TrancheDeReponse[] = [];
  let curseur = 0;
  for (const { bloc, place } of places) {
    const avant = texte.slice(curseur, place);
    if (avant.trim()) tranches.push({ genre: "texte", texte: avant.trim() });
    curseur = place;
    const derniere = tranches.at(-1);
    if (derniere?.genre === "blocs") derniere.blocs.push(bloc);
    else tranches.push({ genre: "blocs", blocs: [bloc] });
  }
  const reste = texte.slice(curseur);
  if (reste.trim()) tranches.push({ genre: "texte", texte: reste.trim() });
  return tranches;
}
