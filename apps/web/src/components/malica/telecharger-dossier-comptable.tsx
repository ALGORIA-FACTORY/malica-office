/**
 * Le bouton « Télécharger le dossier » — l'archive comptable d'un client, côté cabinet.
 *
 * Il ouvre une boîte de dialogue qui prépare, pièce par pièce, une archive ZIP des
 * documents sélectionnés avec leurs documents liés (lus sous le mandat du cabinet), montre
 * la progression, puis l'enregistre sur l'appareil. La préparation s'interrompt à la
 * fermeture ; une panne se dit dans la boîte. Le bouton est grisé sans pièce, et, sur une
 * carte qui s'ouvre, télécharger n'ouvre pas la carte.
 */
import { useMutation } from "@tanstack/react-query";
import { Download, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { enregistrerUnFichier } from "@/capabilities/enregistrer-un-fichier";
import { useI18n, type MessageKey } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { transport } from "@/lib/transport";
import { office } from "@/verticals/malica-office/composition";

export function TelechargerDossierComptable({
  cabinetId,
  clientId,
  nomClient,
  pieces,
  libelle,
  compact = false,
  principal = false,
}: {
  cabinetId: string;
  clientId: string;
  nomClient: string;
  pieces: string[];
  libelle?: string;
  /** Une icône seule, pour une carte ou une ligne : le libellé reste dit au lecteur d'écran. */
  compact?: boolean;
  /** Le geste principal de l'écran. */
  principal?: boolean;
}) {
  const { t } = useI18n();
  const dialogue = useRef<HTMLDialogElement>(null);
  const arret = useRef<AbortController | null>(null);
  const [progression, setProgression] = useState<{ n: number; total: number } | null>(null);
  const [sauve, setSauve] = useState<string | null>(null);
  const telecharger = useMutation({
    mutationFn: async () => {
      const controle = new AbortController();
      arret.current = controle;
      const dossier = await office().supervision.documentsLies(cabinetId, clientId, pieces);
      controle.signal.throwIfAborted();
      setProgression({ n: 0, total: dossier.documents.length });
      const { construireArchiveComptable } = await import("@/lib/archive-comptable");
      const archive = await construireArchiveComptable(
        dossier,
        (id, signal) => transport().appeler(`/pieces/${id}/contenu`, { signal }),
        (n, total) => setProgression({ n, total }),
        controle.signal,
      );
      controle.signal.throwIfAborted();
      const nom = nomClient.replace(/[^\p{L}\p{N}_-]/gu, "-").slice(0, 80) || clientId;
      // L'archive est déjà un Blob construit en flux : on la remet telle quelle.
      const { chemin } = await enregistrerUnFichier(
        archive,
        `${nom}_${new Date().toISOString().slice(0, 10)}.zip`,
      );
      return chemin;
    },
    onSuccess: (chemin) => {
      setSauve(chemin ?? t("cab.biblio.saved"));
    },
  });
  useEffect(() => () => arret.current?.abort(), []);
  const fermer = () => {
    arret.current?.abort();
    dialogue.current?.close();
  };
  const ouvrir = () => {
    telecharger.reset();
    setSauve(null);
    setProgression(null);
    dialogue.current?.showModal();
  };
  const message =
    telecharger.error instanceof Error && telecharger.error.message.startsWith("cab.biblio.")
      ? t(telecharger.error.message as MessageKey)
      : texteDeLErreur(telecharger.error, "bibliothèque", t("cab.biblio.error"));
  return (
    <>
      <button
        type="button"
        className={
          compact
            ? "cab-doclib-button cab-doclib-icone"
            : principal
              ? "cab-doclib-button cab-doclib-primary"
              : "cab-doclib-button"
        }
        onClick={(e) => {
          // Sur une carte qui s'ouvre, télécharger n'ouvre pas la carte.
          e.preventDefault();
          e.stopPropagation();
          ouvrir();
        }}
        disabled={pieces.length === 0}
        aria-label={compact ? (libelle ?? t("cab.biblio.download")) : undefined}
        title={compact ? (libelle ?? t("cab.biblio.download")) : undefined}
      >
        <Download className="h-4 w-4" aria-hidden />
        {compact ? null : (libelle ?? t("cab.biblio.download"))}
      </button>
      <dialog ref={dialogue} className="cab-doclib-dialog" onCancel={fermer}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2>{t("cab.biblio.prepare")}</h2>
            <p>{nomClient}</p>
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
        <p className="my-5 text-[13px] text-muted-foreground">{t("cab.biblio.archiveHint")}</p>
        <p className="my-4 text-[12px] text-muted-foreground">{t("cab.biblio.linked")}</p>
        {progression && telecharger.isPending ? (
          <p role="status" className="my-4">
            {t("cab.biblio.progress", progression)}
          </p>
        ) : null}
        {telecharger.isError && !arret.current?.signal.aborted ? (
          <p role="alert" className="my-4 text-signal-stop">
            {message}
          </p>
        ) : null}
        {sauve ? (
          <p role="status" className="my-4 break-all text-signal-ok">
            {sauve}
          </p>
        ) : null}
        <div className="flex flex-wrap justify-end gap-3">
          <button type="button" className="cab-doclib-button" onClick={fermer}>
            {t("cab.biblio.cancel")}
          </button>
          <button
            type="button"
            className="cab-doclib-button cab-doclib-primary"
            onClick={() => telecharger.mutate()}
            disabled={telecharger.isPending || sauve !== null}
          >
            {telecharger.isPending ? t("common.loading") : t("cab.biblio.download")}
          </button>
        </div>
      </dialog>
    </>
  );
}
