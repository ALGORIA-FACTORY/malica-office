/**
 * Les lignes d'articles lues SANS preuve, dites telles sur l'écran de la pièce.
 *
 * Décision du dirigeant (5 novembre 2026) : les lignes qu'aucune somme ne prouve se montrent
 * « lu, non vérifié », et la lecture de nuit les reprend. Le lecteur prouvé les inscrit au
 * statut `signale` (`capture.champs_lus`, une cellule par rang) ; cet avis le dit au-dessus
 * des articles. Il ne dit rien quand les lignes sont prouvées, ni quand rien n'est inscrit :
 * pas d'alarme sans fait.
 */
import { useQuery } from "@tanstack/react-query";

import type { LectureObservee } from "@malica/socle/ports/repositories";

import { SignalLight } from "@/components/malica/office-ui";
import { useI18n } from "@/i18n";
import { office } from "@/verticals/malica-office/composition";

/** Des cellules de lignes signalées : lues, non vérifiées. */
function lignesAVerifier(l: LectureObservee | null | undefined): boolean {
  return Boolean(l?.champs.some((c) => c.rang !== null && c.statut === "signale"));
}

export function LignesAVerifier({ pieceId }: { pieceId: string }) {
  const { t, locale } = useI18n();
  const lecture = useQuery({
    queryKey: ["lecture-observee", pieceId, locale],
    queryFn: () => office().capture.lectureObservee(pieceId, locale),
  });
  if (!lignesAVerifier(lecture.data)) return null;
  return (
    <div className="mt-4 border border-border bg-card p-4" role="status">
      <SignalLight tone="warn" label={t("pme.detail.lignesAVerifier")} />
      <p className="mt-2 text-[13px] leading-[1.55] text-text-2">
        {t("pme.detail.lignesAVerifierAide")}
      </p>
    </div>
  );
}
