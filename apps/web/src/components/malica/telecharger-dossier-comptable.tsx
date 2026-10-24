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
}: {
  cabinetId: string;
  clientId: string;
  nomClient: string;
  pieces: string[];
  libelle?: string;
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
        className="cab-doclib-button"
        onClick={ouvrir}
        disabled={pieces.length === 0}
      >
        <Download className="h-4 w-4" aria-hidden />
        {libelle ?? t("cab.biblio.download")}
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
