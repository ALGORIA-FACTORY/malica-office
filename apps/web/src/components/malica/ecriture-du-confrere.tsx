/**
 * L'écriture qu'une comptabilité précédente a inscrite, chez la nouvelle
 * (décision du 12 novembre 2026, 7.3).
 *
 * Les livres se tiennent sans altération : l'écriture se lit « Inscrite par
 * [ancienne comptabilité] · lecture seule », sans « Modifier » ni
 * « Retourner ». Le seul geste est la contre-passation, au jour et au nom de
 * la nouvelle ; la pièce n'a alors plus d'écriture vivante, et l'écran repasse
 * à l'écriture du Socle pour la régularisation. La base refuse tout le reste.
 */
import type { Ecriture } from "@malica/socle/ports/repositories";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { EcritureEnLectureSeule } from "@/components/malica/piece-en-archive";
import { useI18n } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { office } from "@/verticals/malica-office/composition";

export function EcritureDuConfrere({
  ecriture,
  pieceId,
  inscritePar,
}: {
  ecriture: Ecriture;
  pieceId: string;
  inscritePar: string;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [erreur, setErreur] = useState<string | null>(null);
  const contrePasser = useMutation({
    mutationFn: () => office().office.contrePasserLEcritureDuConfrere(ecriture.id),
    onSuccess: async () => {
      setErreur(null);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["ecritures", pieceId] }),
        qc.invalidateQueries({ queryKey: ["piece", pieceId] }),
      ]);
    },
    onError: (e: unknown) =>
      setErreur(texteDeLErreur(e, "components/malica/ecriture-du-confrere", t("common.error"))),
  });
  return (
    <section
      className="space-y-3"
      aria-label={t("cab.confrere.inscrite", { comptabilite: inscritePar })}
    >
      <h2 className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
        {t("cab.confrere.inscrite", { comptabilite: inscritePar })}
      </h2>
      <EcritureEnLectureSeule ecriture={ecriture} />
      <p className="text-[13px] leading-snug text-muted-foreground">{t("cab.confrere.aide")}</p>
      <button
        type="button"
        onClick={() => contrePasser.mutate()}
        disabled={contrePasser.isPending}
        className="h-9 border border-border px-3 text-[13px] font-medium hover:bg-accent disabled:opacity-40"
      >
        {contrePasser.isPending ? t("common.loading") : t("cab.confrere.contrePasser")}
      </button>
      {erreur ? (
        <p role="alert" className="text-[12px] text-signal-stop">
          {erreur}
        </p>
      ) : null}
    </section>
  );
}
