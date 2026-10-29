/**
 * La feuille « Retourner au client », sur le côté (maquette « Retours du
 * cabinet », validée le 25 octobre 2026).
 *
 * Le comptable retourne à toute étape (« Malica sans blocage », §4) : une
 * pièce prise en charge l'est avec la contre-passation de son écriture, au
 * journal du jour — la base la fait (`piece_retourner`).
 *
 * L'aperçu montre ce que le client lira, mot pour mot : le motif, la note
 * entre guillemets, et le geste qu'on lui demandera. Rien n'y est inventé :
 * le geste vient du référentiel, comme sur la fiche du client.
 */
import type { RejetMotif } from "@malica/socle/ports/repositories";
import { useMutation } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useSuperposition } from "@/hooks/use-superposition";
import { useI18n } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { LIBELLE_DU_GESTE } from "@/lib/retour-du-cabinet";
import { office } from "@/verticals/malica-office/composition";

const OU = "components/malica/retourner-au-client";

export function RetournerAuClient({
  pieceId,
  motifs,
  onFermer,
  onRetournee,
}: {
  pieceId: string;
  motifs: readonly RejetMotif[];
  onFermer: () => void;
  /** Le retour est parti : le motif et la note, pour le panneau « Retournée ». */
  onRetournee: (r: { motif: string; note: string | null }) => Promise<void>;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement | null>(null);
  const [motifId, setMotifId] = useState<string>(motifs[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const fermer = useCallback(() => onFermer(), [onFermer]);
  useSuperposition(true, fermer, ref);

  const motif = motifs.find((m) => m.id === motifId) ?? null;
  const noteManquante = Boolean(motif?.requiresNote) && note.trim().length === 0;

  const retourner = useMutation({
    mutationFn: () =>
      office().supervision.retourner({
        pieceId,
        motifId,
        note: note.trim() ? note.trim() : null,
      }),
    onMutate: () => setErreur(null),
    onSuccess: () =>
      onRetournee({ motif: motif?.label ?? "", note: note.trim() ? note.trim() : null }),
    onError: (e: unknown) => setErreur(texteDeLErreur(e, OU, t("common.error"))),
  });

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex justify-end bg-foreground/35"
      onClick={(e) => {
        if (e.target === e.currentTarget) fermer();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={t("cab.retour.titre")}
        className="flex h-full w-full max-w-[560px] flex-col gap-4 overflow-y-auto bg-background px-6 py-7 text-start sm:px-8"
      >
        <div className="flex items-center justify-between gap-3">
          <p className="text-[22px] font-semibold tracking-[-0.02em]">{t("cab.retour.titre")}</p>
          <button
            type="button"
            onClick={fermer}
            aria-label={t("common.fermer")}
            className="flex h-9 w-9 items-center justify-center border border-border bg-card hover:bg-accent"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <p className="text-[13.5px] leading-relaxed text-muted-foreground">
          {t("cab.retour.lede")}
        </p>

        <fieldset className="space-y-2">
          <legend className="text-[12.5px] font-semibold">{t("cab.retour.motif")}</legend>
          <div className="flex flex-wrap gap-2">
            {motifs.map((m) => (
              <button
                key={m.id}
                type="button"
                aria-pressed={m.id === motifId}
                onClick={() => setMotifId(m.id)}
                className={
                  m.id === motifId
                    ? "min-h-[38px] rounded-full border border-foreground bg-foreground px-3.5 text-[13px] font-semibold text-background"
                    : "min-h-[38px] rounded-full border border-border bg-card px-3.5 text-[13px] font-semibold hover:bg-accent"
                }
              >
                {m.label}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="flex flex-col gap-1.5 text-[12.5px] font-semibold">
          <span>
            {t("cab.retour.note")}{" "}
            <span
              className={
                motif?.requiresNote
                  ? "font-medium text-signal-stop"
                  : "font-medium text-muted-foreground"
              }
            >
              {motif?.requiresNote
                ? t("cab.retour.note.obligatoire")
                : t("cab.retour.note.facultative")}
            </span>
          </span>
          <textarea
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-invalid={noteManquante || undefined}
            className="resize-none border border-border bg-background px-3 py-2.5 text-[14px] font-normal"
          />
        </label>

        {motif ? (
          <>
            <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {t("cab.retour.apercu")}
            </p>
            <div className="flex flex-col gap-2 rounded-2xl bg-foreground p-4 text-background">
              <span className="flex items-center gap-2 text-[12.5px] font-semibold">
                <span aria-hidden className="h-[7px] w-[7px] rounded-full bg-signal-info" />
                {t("pme.retour.etat.court")}
              </span>
              <b className="text-[16px]">{motif.label}</b>
              {note.trim() ? (
                <span className="text-[13px] leading-snug opacity-80">« {note.trim()} »</span>
              ) : null}
              <span className="mt-1 inline-flex h-9 items-center self-start rounded-full bg-background px-3.5 text-[13px] font-semibold text-foreground">
                {t(LIBELLE_DU_GESTE[motif.geste])}
              </span>
            </div>
          </>
        ) : null}

        {erreur ? (
          <p role="alert" className="text-[12.5px] text-signal-stop">
            {erreur}
          </p>
        ) : null}

        <button
          type="button"
          disabled={!motif || noteManquante || retourner.isPending}
          onClick={() => retourner.mutate()}
          className="mt-auto min-h-[52px] border border-foreground bg-foreground text-[14px] font-semibold text-background hover:bg-background hover:text-foreground disabled:opacity-50"
        >
          {retourner.isPending ? t("common.loading") : t("cab.retour.envoyer")}
        </button>
      </div>
    </div>,
    document.body,
  );
}
