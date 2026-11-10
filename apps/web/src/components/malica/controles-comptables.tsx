/**
 * Les contrôles d'une pièce — ce que l'analyse a vérifié, vu par le cabinet.
 *
 * Écran cabinet, dans la bibliothèque : la liste des contrôles de la pièce, lue côté
 * supervision, chacun conforme, non applicable ou à regarder, avec son motif. Rien n'est
 * calculé ici : le moteur déterministe a rendu les statuts, l'écran les montre. Quatre
 * états se disent à part : attente, panne, aucune analyse (on ne présente alors aucun
 * contrôle fiscal), et analyse devenue ancienne, signalée pour ne pas passer pour à jour.
 */
import { useQuery } from "@tanstack/react-query";
import { CircleCheck, CircleHelp, TriangleAlert } from "lucide-react";
import { useI18n } from "@/i18n";
import { libelleDuControle } from "@/lib/champ-lisible";
import { office } from "@/verticals/malica-office/composition";

export function ControlesComptables({
  cabinetId,
  pieceId,
}: {
  cabinetId: string;
  pieceId: string;
}) {
  const { t } = useI18n();
  const analyse = useQuery({
    queryKey: ["cab-controles", cabinetId, pieceId],
    queryFn: () => office().supervision.controlesPiece(cabinetId, pieceId),
  });
  return (
    <section className="cab-doclib-controls">
      <p className="rounded-lg bg-signal-soft p-4 text-[12px] text-signal-warn">
        {t("cab.biblio.checksHint")}
      </p>
      {analyse.isPending ? (
        <p role="status">{t("common.loading")}</p>
      ) : analyse.isError ? (
        <p role="alert" className="text-signal-stop">
          {t("cab.biblio.checksError")}
        </p>
      ) : !analyse.data || analyse.data.controles.length === 0 ? (
        <p className="text-muted-foreground">{t("cab.biblio.noChecks")}</p>
      ) : (
        <>
          {!analyse.data.aJour ? (
            <p role="alert" className="text-signal-warn">
              {t("cab.biblio.staleChecks")}
            </p>
          ) : null}
          <ul>
            {analyse.data.controles.map((c) => (
              <li key={c.code}>
                {c.statut === "conforme" ? (
                  <CircleCheck className="h-4 w-4 text-signal-ok" aria-hidden />
                ) : c.statut === "non_applicable" ? (
                  <CircleHelp className="h-4 w-4 text-muted-foreground" aria-hidden />
                ) : (
                  <TriangleAlert className="h-4 w-4 text-signal-warn" aria-hidden />
                )}
                <div>
                  <strong>{libelleDuControle(c.code, t)}</strong>
                  <p>{c.motif}</p>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
