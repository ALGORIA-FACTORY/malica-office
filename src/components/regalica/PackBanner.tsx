import { useQuery } from "@tanstack/react-query";

import { useI18n } from "@/i18n";
import { office } from "@/verticals/regalica-office/composition";

/**
 * Bandeau « référentiel non ratifié » — piloté par la colonne de ratification
 * du pack en base (validated_by), jamais par une constante d'écran.
 */
export function PackBanner({ jurisdiction }: { jurisdiction: string }) {
  const { t } = useI18n();
  const { data, isPending } = useQuery({
    queryKey: ["ref-pack", jurisdiction],
    queryFn: () => office().referential.activePack(jurisdiction),
  });

  if (isPending) return null;

  if (!data) {
    return (
      <p className="rule-b border-border bg-secondary px-4 py-2 text-xs text-muted-foreground">
        {t("pack.none")}
      </p>
    );
  }

  if (data.ratified) {
    return (
      <p className="rule-b bg-secondary px-4 py-2 text-xs text-muted-foreground">
        {t("pack.ratified")} · <span className="num">{data.jurisdiction} {data.version}</span>
      </p>
    );
  }

  return (
    <div
      role="status"
      className="rule-b border-s-2 border-s-signal-warn bg-secondary px-4 py-3 text-xs"
    >
      <p className="font-medium uppercase tracking-wide text-signal-warn">
        {t("pack.banner.title")}
      </p>
      <p className="mt-1 text-muted-foreground">
        {t("pack.banner.body", {
          jurisdiction: data.jurisdiction,
          version: data.version,
          date: data.effectiveFrom,
        })}
      </p>
    </div>
  );
}
