/**
 * « Imprimer » — un document, un dossier ou une sélection de la bibliothèque.
 *
 * Deux habits pour un même geste (`useImpression`) :
 *
 *   — `ImprimerLesPieces`, côté comptabilité : le jumeau du bouton
 *     « Télécharger le dossier », posé à côté de lui, avec ses classes et sa
 *     boîte de dialogue (`cab-doclib-*`). Aucun style neuf ;
 *   — `ImprimerDepuisLaPme`, côté société : un bouton aux classes de l'écran
 *     qui le reçoit, et ce qu'il a à dire écrit dessous — la bibliothèque de
 *     la PME n'a pas de boîte de dialogue.
 *
 * Le bouton n'est jamais grisé : sans pièce, il dit qu'il n'y a rien à
 * imprimer. Un lot volumineux annonce ses pages et sa taille avant de composer.
 */
import { Printer, X } from "lucide-react";
import { useRef, useState } from "react";

import {
  megaoctets,
  useImpression,
  type DemandeDImpression,
  type IssueDImpression,
} from "@/hooks/use-impression";
import { useI18n } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";

/** Ce que l'impression a à dire, dans l'ordre où elle avance ; `null` : rien encore. */
function useCompteRendu(
  impression: ReturnType<typeof useImpression>,
  vide: boolean,
): { ton: "status" | "alert"; texte: string } | null {
  const { t, locale } = useI18n();
  if (vide) return { ton: "status", texte: t("cab.biblio.imprimer.vide") };
  if (impression.enCours) return { ton: "status", texte: t("cab.biblio.imprimer.enCours") };
  if (impression.erreur)
    return {
      ton: "alert",
      texte: texteDeLErreur(impression.erreur, "impression", t("cab.biblio.imprimer.erreur")),
    };
  const issue: IssueDImpression | null = impression.issue;
  if (!issue) return null;
  if (issue.genre === "a_confirmer")
    return {
      ton: "alert",
      texte: t("cab.biblio.imprimer.volume", {
        pages: issue.pages,
        taille: megaoctets(issue.octets, locale),
      }),
    };
  if (issue.genre === "trop_volumineuse")
    return {
      ton: "alert",
      texte: t("cab.biblio.imprimer.trop", { pages: issue.pages, max: issue.pagesMax }),
    };
  return {
    ton: "status",
    texte: issue.chemin
      ? `${t("cab.biblio.imprimer.enregistre")} ${issue.chemin}`
      : t("cab.biblio.imprimer.pret"),
  };
}

export function ImprimerLesPieces({
  libelle,
  titre,
  compact = false,
  ...demande
}: DemandeDImpression & {
  libelle: string;
  /** Ce qui s'imprime, dit dans la boîte (le client, le mois, la pièce). */
  titre: string;
  /** Une icône seule, pour une carte ou une ligne : le libellé reste dit au lecteur d'écran. */
  compact?: boolean;
}) {
  const { t } = useI18n();
  const dialogue = useRef<HTMLDialogElement>(null);
  const impression = useImpression(demande);
  const vide = demande.pieces.length === 0;
  const dit = useCompteRendu(impression, vide);
  const fermer = () => dialogue.current?.close();
  const ouvrir = () => {
    impression.oublier();
    dialogue.current?.showModal();
    // Le geste est déjà fait : la composition part à l'ouverture.
    if (!vide) impression.lancer();
  };
  const issue = impression.issue;
  return (
    <>
      <button
        type="button"
        className={compact ? "cab-doclib-button cab-doclib-icone" : "cab-doclib-button"}
        onClick={(e) => {
          // Sur une carte qui s'ouvre, imprimer n'ouvre pas la carte.
          e.preventDefault();
          e.stopPropagation();
          ouvrir();
        }}
        aria-label={compact ? libelle : undefined}
        title={compact ? libelle : undefined}
      >
        <Printer className="h-4 w-4" aria-hidden />
        {compact ? null : libelle}
      </button>
      <dialog ref={dialogue} className="cab-doclib-dialog" onCancel={fermer}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2>{t("cab.biblio.imprimer.titre")}</h2>
            <p>{titre}</p>
          </div>
          <button
            type="button"
            onClick={fermer}
            aria-label={t("cab.biblio.cancel")}
            className="p-2"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="my-5 text-[13px] text-muted-foreground">{t("cab.biblio.imprimer.aide")}</p>
        {demande.cabinetId ? (
          <p className="my-4 text-[12px] text-muted-foreground">{t("cab.biblio.linked")}</p>
        ) : null}
        {dit ? (
          <p
            role={dit.ton}
            className={
              dit.ton === "alert" ? "my-4 break-words text-signal-stop" : "my-4 break-words"
            }
          >
            {dit.texte}
          </p>
        ) : null}
        <div className="flex flex-wrap justify-end gap-3">
          <button type="button" className="cab-doclib-button" onClick={fermer}>
            {t("cab.biblio.cancel")}
          </button>
          {issue?.genre === "a_confirmer" ? (
            <button
              type="button"
              className="cab-doclib-button cab-doclib-primary"
              onClick={() => impression.lancer(true)}
            >
              {t("cab.biblio.imprimer.quandMeme")}
            </button>
          ) : null}
          {issue?.genre === "pret" && issue.chemin === null ? (
            <button
              type="button"
              className="cab-doclib-button cab-doclib-primary"
              onClick={impression.rouvrir}
            >
              {t("cab.biblio.imprimer.rouvrir")}
            </button>
          ) : null}
          {impression.erreur && !impression.enCours ? (
            <button
              type="button"
              className="cab-doclib-button cab-doclib-primary"
              onClick={() => impression.lancer()}
            >
              {t("cab.biblio.imprimer")}
            </button>
          ) : null}
        </div>
      </dialog>
    </>
  );
}

export function ImprimerDepuisLaPme({
  libelle,
  classe,
  classeDuTexte,
  enLigne = false,
  ...demande
}: DemandeDImpression & {
  libelle: string;
  /** La classe du bouton, celle de l'écran qui le reçoit (`ret`, `f-ligne`…). */
  classe: string;
  /** La classe du texte qui dit où en est l'impression (`sub`, `lb`…). */
  classeDuTexte: string;
  /**
   * Une ligne d'action (`f-ligne`) : le libellé et ce qu'il y a à dire
   * s'écrivent DANS le bouton, comme ses voisines ; sinon, le texte suit.
   */
  enLigne?: boolean;
}) {
  const { t } = useI18n();
  const impression = useImpression(demande);
  const vide = demande.pieces.length === 0;
  const dit = useCompteRendu(impression, vide);
  const issue = impression.issue;
  const aConfirmer = issue?.genre === "a_confirmer";
  // Sans pièce, le bouton reste actif : toucher dit pourquoi rien ne s'imprime.
  const [touche, setTouche] = useState(false);
  const libelleDuBouton = impression.enCours
    ? t("common.loading")
    : aConfirmer
      ? t("cab.biblio.imprimer.quandMeme")
      : libelle;
  const texte =
    dit && (!vide || touche) && !impression.enCours ? (
      enLigne ? (
        <span role={dit.ton} className={classeDuTexte} style={{ overflowWrap: "anywhere" }}>
          {dit.texte}
        </span>
      ) : (
        <p role={dit.ton} className={classeDuTexte} style={{ overflowWrap: "anywhere" }}>
          {dit.texte}
        </p>
      )
    ) : null;
  const toucher = () => {
    setTouche(true);
    if (!vide && !impression.enCours) impression.lancer(aConfirmer);
  };
  if (enLigne)
    return (
      <button type="button" className={classe} aria-busy={impression.enCours} onClick={toucher}>
        <span className="bd">
          <span className="lb-a">{libelleDuBouton}</span>
          {texte}
        </span>
      </button>
    );
  return (
    <>
      <button type="button" className={classe} aria-busy={impression.enCours} onClick={toucher}>
        {libelleDuBouton}
      </button>
      {texte}
    </>
  );
}
