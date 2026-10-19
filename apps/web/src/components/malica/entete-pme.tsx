/**
 * La barre d'application — UNE, sur les quinze écrans PME.
 *
 * =========================================================== CE QU'ELLE PORTE
 *
 *   [ logo ALGORIA ]   nom de l'organisation            [ W ]
 *
 * Et rien d'autre. Le logo à gauche, le dossier ouvert au centre, l'initiale
 * de la personne à droite. Le retour et le titre d'un écran vivent SOUS elle,
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

import { MarqueAlgoria } from "./office-ui";

export interface EntetePmeProps {
  /** Le nom du dossier ouvert. `null` tant qu'aucun dossier n'est lu. */
  orgNom: string | null;
  /** Les dossiers PME de la personne. Un seul : le nom se lit, il ne se choisit pas. */
  dossiers: ReadonlyArray<{ id: string; name: string }>;
  dossierActif: string | null;
  choisirDossier: (id: string) => void;
  /** L'initiale du compte ouvert — la PERSONNE, jamais Malica. */
  initiale: string;
}

export function EntetePme({
  orgNom,
  dossiers,
  dossierActif,
  choisirDossier,
  initiale,
}: EntetePmeProps) {
  const { t } = useI18n();

  return (
    <header className="appbar">
      <MarqueAlgoria aria-hidden className="mk" />
      {dossiers.length > 1 ? (
        <select
          aria-label={t("pme.org.switch")}
          value={dossierActif ?? ""}
          onChange={(e) => choisirDossier(e.target.value)}
          className="org"
        >
          {dossiers.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      ) : (
        <span className="org">{orgNom ?? ""}</span>
      )}
      {/*
       * L'initiale mène aux réglages. Le lecteur d'écran annonçait « W » seul :
       * le lien dit où il mène, et la lettre reste `aria-hidden` de fait
       * puisque l'étiquette la remplace.
       */}
      <Link to="/pme/reglages" aria-label={t("pme.reglages.titre")} className="me">
        {initiale}
      </Link>
    </header>
  );
}
