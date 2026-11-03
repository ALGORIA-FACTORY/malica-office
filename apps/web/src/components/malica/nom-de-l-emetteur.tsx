/**
 * Le nom de l'émetteur, corrigé à la main.
 *
 * ================================================================= POURQUOI
 *
 * Recette du 2 novembre 2026, facture MyTek : la lecture a pris le logo
 * stylisé, lu « MITEK », pour le nom de l'émetteur. Le dirigeant voyait
 * « MITEK » en titre de sa pièce et n'avait aucun crayon pour le corriger.
 * Décision du 3 novembre : « on doit accepter la correction et on met le
 * petit crayon devant le nom ».
 *
 * La saisie remplace le titre, sur place : on corrige le nom là où on le lit.
 * Ce qui s'enregistre est une précision (R7) ; la lecture d'origine reste
 * telle qu'elle a été faite, et la base borne la saisie.
 */
import { useState } from "react";

import { useI18n } from "@/i18n";

/** La borne de la base (`capture_precision_persist`) : la saisie s'y arrête. */
const LONGUEUR_MAX = 200;

/** Les blancs resserrés, comme la base les range. */
function nomSaisi(v: string): string {
  return v.replace(/\s+/g, " ").trim();
}

export function NomDeLEmetteur({
  actuel,
  enCours,
  onEnregistrer,
  onAnnuler,
}: {
  actuel: string;
  enCours: boolean;
  onEnregistrer: (nom: string) => void;
  onAnnuler: () => void;
}) {
  const { t } = useI18n();
  const [valeur, setValeur] = useState(actuel);
  const nom = nomSaisi(valeur);
  return (
    <form
      className="f-nom-saisie"
      onSubmit={(e) => {
        e.preventDefault();
        if (nom) onEnregistrer(nom);
      }}
    >
      <label htmlFor="nom-de-l-emetteur">{t("pme.piece.nom.label")}</label>
      <input
        id="nom-de-l-emetteur"
        type="text"
        // Le nom s'écrit tel qu'imprimé : pas de correcteur ni de majuscule imposée.
        autoComplete="organization"
        autoCapitalize="off"
        spellCheck={false}
        maxLength={LONGUEUR_MAX}
        value={valeur}
        disabled={enCours}
        autoFocus
        onChange={(e) => setValeur(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onAnnuler();
        }}
        aria-describedby="nom-de-l-emetteur-aide"
      />
      <p id="nom-de-l-emetteur-aide" className="f-note">
        {t("pme.piece.nom.aide")}
      </p>
      <div className="f-nom-gestes">
        <button type="button" className="f-bouton" onClick={onAnnuler} disabled={enCours}>
          {t("common.cancel")}
        </button>
        <button type="submit" className="f-bouton pr" disabled={enCours || !nom}>
          {enCours ? t("common.loading") : t("pme.piece.nom.enregistrer")}
        </button>
      </div>
    </form>
  );
}
