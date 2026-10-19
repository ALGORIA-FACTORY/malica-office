/**
 * Un compteur qui ROULE au lieu de se remplacer.
 *
 * ================================================================= POURQUOI
 *
 * L'accueil dit « 13 factures attendent votre réponse ». Le dirigeant en
 * confirme une : la pastille affiche 12. Remplacé sec, à 13 px de haut, dans
 * un disque de 27 px, ce passage ne se voit PAS — l'œil ne distingue pas un
 * 2 d'un 3 s'il n'a rien vu bouger, et le geste qu'on vient de faire n'a
 * aucun accusé de réception.
 *
 * Le chiffre qui part monte et s'efface (il ACCÉLÈRE, `--e-sort`), celui qui
 * arrive vient d'en dessous et se pose (il DÉCÉLÈRE, `--e-entre`). C'est le
 * sens d'un compteur mécanique qui décompte. Une hausse roule dans l'autre
 * sens : ce n'est pas la même nouvelle.
 *
 * Le sens VERTICAL ne se retourne pas en arabe. Un compteur n'est pas une
 * ligne de lecture.
 *
 * ================================================== CE QUI N'EST PAS ICI
 *
 * Aucune animation : `.rl`, ses deux keyframes et les deux courbes sont dans
 * `styles-pme.css`. Ce composant ne fait que nommer ce qui change et dans
 * quel sens — et le CSS est ce que `prefers-reduced-motion` sait éteindre.
 *
 * ============================================ MOINS DE MOUVEMENT, VRAIMENT
 *
 * Quand le système demande moins de mouvement, le chiffre sortant n'est même
 * pas RENDU, et `data-sens` reste absent. Ce n'est pas une animation mise à
 * zéro : il n'y a qu'un nombre qui change. C'était nécessaire — le sortant
 * est posé en absolu par-dessus l'entrant, et une animation éteinte l'aurait
 * laissé afficher l'ANCIEN nombre jusqu'à la fin du minuteur.
 */

import { useEffect, useState } from "react";

import { moinsDeMouvement } from "./mouvement";

/**
 * Le temps que le chiffre sortant reste dans l'arbre : la durée du mouvement
 * (`--t-dedans`, 220 ms) et de quoi couvrir une image lente. Un minuteur, et
 * non `onAnimationEnd` : l'événement ne part jamais si l'animation est
 * éteinte, et le sortant resterait pour toujours.
 */
const TENUE = 300;

interface Etat {
  /** Le nombre affiché. */
  valeur: number;
  /** Celui qu'il remplace, le temps qu'il s'en aille. `null` : personne. */
  avant: number | null;
  /** `bas` quand le nombre baisse, `haut` quand il monte, `null` au repos. */
  sens: "bas" | "haut" | null;
}

export function CompteurQuiRoule({ valeur }: { valeur: number }) {
  const [etat, setEtat] = useState<Etat>({ valeur, avant: null, sens: null });

  if (etat.valeur !== valeur) {
    /*
     * Une mise à jour d'état PENDANT le rendu, et c'est voulu : React relance
     * le rendu avant de peindre, donc le nouveau chiffre n'apparaît jamais
     * une image AVANT son mouvement. Passer par un effet l'aurait fait
     * paraître d'abord, puis rouler — c'est-à-dire l'inverse.
     */
    setEtat(
      moinsDeMouvement()
        ? { valeur, avant: null, sens: null }
        : { valeur, avant: etat.valeur, sens: valeur < etat.valeur ? "bas" : "haut" },
    );
  }

  useEffect(() => {
    if (etat.sens === null) return;
    const minuteur = setTimeout(
      () => setEtat((e) => ({ valeur: e.valeur, avant: null, sens: null })),
      TENUE,
    );
    return () => clearTimeout(minuteur);
  }, [etat.sens, etat.valeur]);

  return (
    <span className="rl" data-sens={etat.sens ?? undefined}>
      {/*
       * `aria-hidden` : un lecteur d'écran ne doit pas entendre deux nombres
       * pour une seule pastille. Celui qui part est une image, pas une
       * information.
       */}
      {etat.avant === null ? null : (
        <span className="so" aria-hidden>
          {etat.avant}
        </span>
      )}
      <span className="en">{etat.valeur}</span>
    </span>
  );
}
