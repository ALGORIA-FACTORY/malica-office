/**
 * La barre d'application — UNE, sur les quinze écrans PME.
 *
 * =========================================================== CE QU'ELLE PORTE
 *
 *   [ logo ALGORIA ]                              [ cloche ] [ W ]
 *
 * La cloche est revenue le 7 novembre 2026 (planche 12, approuvée) : les
 * alertes de toutes les sociétés, sur tous les écrans. Et rien d'autre. Le logo à gauche, l'initiale de la personne à droite (le
 * nom du dossier ouvert est parti le 3 novembre 2026, voir plus bas). Le retour et le titre d'un écran vivent SOUS elle,
 * dans `.top` — jamais dedans.
 *
 * ===================================================== CE QUI EST PARTI D'ICI
 *
 * Le sigle RG de 19 px, la pastille marigold qui battait, « je veille », le
 * sélecteur de langue « FR · ⚙ » et le lien « Changer d'espace ».
 *
 * « Changer d'espace » est une décision du dirigeant, prise le 19 octobre
 * 2026 : il part, et avec lui la prop `aUnCabinet` de cet objet. Conséquence
 * assumée : depuis le téléphone, on n'atteint plus l'espace cabinet. La prop
 * de MÊME NOM du contexte PME reste — l'écran de capture en dépend pour
 * savoir si la pièce peut être transmise — et la clé `portal.switch` reste
 * elle aussi : `cabinet.tsx` la lit encore, dans l'autre sens.
 *
 * Le point qui bat et « je veille » n'ont PAS été tranchés. Ils occupaient le
 * centre sans rien dire ; le centre dit maintenant le nom du dossier, qui est
 * une information. Les remettre est une ligne — voir le rapport.
 *
 * « FR · ⚙ » menait aux réglages. C'est l'initiale qui y mène désormais : une
 * porte, pas deux, et la langue se change là où le thème se change.
 *
 * ==================================================== POURQUOI DES PROPRIÉTÉS
 *
 * La mise en page dessine la barre AVANT d'entrer dans `PmeProvider` — le
 * contexte n'est pas encore posé à cet endroit de l'arbre. La barre reçoit
 * donc ce qu'elle affiche, elle ne va pas le chercher.
 *
 * ========================================================= ET AUCUNE CLASSE
 *
 * Pas une utilitaire sur ces éléments : `.appbar`, `.mk`, `.org`, `.me` sont
 * dans `styles-pme.css`. Le dessin a une seule source.
 */
import { Link } from "@tanstack/react-router";

import { useI18n } from "@/i18n";

import { ClocheDeLEntete, type ClocheProps } from "./cloche-de-l-entete";
import { MarqueAlgoria } from "./office-ui";
import { SelecteurDeSociete } from "./selecteur-de-societe";

export interface EntetePmeProps {
  /** L'initiale du compte ouvert — la PERSONNE, jamais Malica. */
  initiale: string;
  /** Les alertes non lues de toutes les sociétés, et la plus récente. */
  cloche: ClocheProps;
  /**
   * La société ouverte et de quoi en changer (planche 2, approuvée le
   * 7 novembre 2026) — seulement quand il y en a plusieurs.
   */
  societe?: React.ComponentProps<typeof SelecteurDeSociete> | undefined;
}

export function EntetePme({ initiale, cloche, societe }: EntetePmeProps) {
  const { t } = useI18n();

  return (
    <header className="appbar">
      <MarqueAlgoria aria-hidden className="mk" />
      {/*
       * LE SÉLECTEUR REVIENT, MAIS IL PARLE (planche 2, approuvée le 7 novembre
       * 2026, qui reprend la décision du 3 novembre).
       *
       * Le 3 novembre, le nom au centre décidait EN SILENCE de ce que
       * montraient l'accueil, la bibliothèque et les réglages. Le dessin
       * approuvé le remet, mais visible : la société ouverte et sa place
       * (« 1/113 »), ou « Toutes les sociétés » quand la vue est consolidée.
       * La touche ouvre la recherche, les épinglées et les récentes. Avec une
       * seule société, la case reste vide.
       */}
      {societe ? <SelecteurDeSociete {...societe} /> : <span className="org" aria-hidden />}
      {/*
       * L'initiale mène aux réglages. Le lecteur d'écran annonçait « W » seul :
       * le lien dit où il mène, et la lettre reste `aria-hidden` de fait
       * puisque l'étiquette la remplace.
       */}
      <ClocheDeLEntete {...cloche} />
      <Link to="/pme/reglages" aria-label={t("pme.reglages.titre")} className="me">
        {initiale}
      </Link>
    </header>
  );
}
