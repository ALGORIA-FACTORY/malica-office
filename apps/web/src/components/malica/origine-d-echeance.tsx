/**
 * Pourquoi une échéance ne tombe pas à sa date légale.
 *
 * La date légale vient du pack et ne change jamais ; la date retenue peut
 * glisser au premier jour ouvrable, ou suivre un report saisi par le cabinet
 * ou publié par ALGORIA. Quand elles diffèrent, l'écran le DIT, avec la date
 * légale et le motif : un dépôt fait le 30 alors que la loi dit le 28 doit
 * pouvoir se justifier d'un coup d'œil.
 */
import type { Echeance } from "@malica/socle/ports/repositories";

import { useI18n } from "@/i18n";
import { dateEnChiffres } from "@/lib/lisible";
import { cn } from "@/lib/utils";

export function OrigineDEcheance({
  echeance,
  className,
}: {
  echeance: Pick<Echeance, "dateLegale" | "dateOrigine" | "reportMotif" | "reportSource">;
  className?: string;
}) {
  const { t, locale } = useI18n();
  if (echeance.dateOrigine === "loi") return null;
  const date = dateEnChiffres(echeance.dateLegale, locale);
  const motif = echeance.reportMotif ?? "";
  return (
    <span
      className={cn("block text-[10px] leading-[1.35] text-muted-foreground", className)}
      title={echeance.reportSource ?? undefined}
    >
      {t(`echeance.origine.${echeance.dateOrigine}`, { date, motif })}
    </span>
  );
}
