import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { usePme } from "@/components/regalica/pme-context";
import {
  EmptyState,
  RegalicaVoice,
  SectionTitle,
  SignalDot,
} from "@/components/regalica/office-ui";
import { useI18n } from "@/i18n";
import { office } from "@/verticals/regalica-office/composition";

export const Route = createFileRoute("/_authenticated/pme/echeances")({
  head: () => ({
    meta: [
      { title: "Échéances — Regalica Office" },
      {
        name: "description",
        content:
          "Les échéances déclaratives de la PME, dérivées du pack de juridiction en vigueur, avec leur date limite et leur état.",
      },
      { property: "og:title", content: "Échéances — Regalica Office" },
      {
        property: "og:description",
        content: "Dates limites dérivées du pack, jamais écrites en dur.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PmeEcheances,
});

function PmeEcheances() {
  const { t, locale } = useI18n();
  const pme = usePme();

  const echeances = useQuery({
    queryKey: ["echeances", pme.tenantId],
    queryFn: () => office().collab.echeances([pme.tenantId]),
  });

  const rows = echeances.data ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const late = rows.filter((e) => e.dueDate < today && e.status !== "deposee");
  const next = rows.find((e) => e.dueDate >= today) ?? null;

  const fmt = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${iso}T00:00:00Z`));

  const days = (iso: string) =>
    Math.round(
      (new Date(`${iso}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) /
        86_400_000,
    );

  return (
    <div className="space-y-6">
      <RegalicaVoice
        greeting={t("pme.echeances.title")}
        sentence={
          rows.length === 0
            ? t("pme.echeances.voice.empty")
            : late.length > 0
              ? t("pme.echeances.voice.late", { count: late.length })
              : next
                ? t("pme.echeances.voice.next", { label: next.label, days: days(next.dueDate) })
                : t("pme.echeances.voice.empty")
        }
      />

      <SectionTitle>{t("pme.echeances.list")}</SectionTitle>

      {echeances.isPending ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : rows.length === 0 ? (
        <EmptyState>{t("pme.echeances.empty")}</EmptyState>
      ) : (
        <ul className="divide-y divide-border border border-border bg-card">
          {rows.map((e) => {
            const overdue = e.dueDate < today && e.status !== "deposee";
            return (
              <li key={e.id} className="flex items-center gap-3 px-3 py-3">
                <SignalDot tone={overdue ? "stop" : e.status === "deposee" ? "ok" : "neutral"} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">{e.label}</p>
                  <p className="font-mono text-[11px] text-muted-foreground">
                    {fmt(e.dueDate)}
                    {e.period ? ` · ${e.period}` : ""}
                  </p>
                </div>
                <span className="shrink-0 border border-border px-2 py-1 font-mono text-[10px] uppercase">
                  {overdue
                    ? t("pme.echeances.overdue", { days: Math.abs(days(e.dueDate)) })
                    : t("pme.echeances.inDays", { days: days(e.dueDate) })}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-[10px] italic text-muted-foreground">{t("pme.echeances.source")}</p>
    </div>
  );
}
