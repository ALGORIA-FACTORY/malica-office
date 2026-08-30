import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { useCabinet, useRegalicaPanel } from "@/components/regalica/cabinet-context";
import {
  EmptyState,
  InkCell,
  InkTable,
  InkTableRow,
  KpiRow,
  RegalicaNote,
  SectionTitle,
  SignalLight,
} from "@/components/regalica/office-ui";
import { useI18n } from "@/i18n";
import { office } from "@/verticals/regalica-office/composition";

export const Route = createFileRoute("/_authenticated/cabinet/echeances")({
  head: () => ({
    meta: [
      { title: "Échéances du cabinet — Regalica Office" },
      {
        name: "description",
        content:
          "Les échéances déclaratives de tous les dossiers mandatés, dérivées du pack de juridiction en vigueur.",
      },
      { property: "og:title", content: "Échéances du cabinet — Regalica Office" },
      {
        property: "og:description",
        content:
          "Les échéances déclaratives de tous les dossiers mandatés, dérivées du pack de juridiction en vigueur.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CabinetEcheances,
});

function CabinetEcheances() {
  const { t, locale } = useI18n();
  const { org } = useCabinet();

  const clients = useQuery({
    queryKey: ["cab-clients", org.id],
    queryFn: () => office().supervision.listClients(org.id),
  });

  const ids = (clients.data ?? []).map((c) => c.tenantId);

  const echeances = useQuery({
    queryKey: ["cab-echeances", org.id, ids.join(",")],
    queryFn: () => office().collab.echeances(ids),
    enabled: ids.length > 0,
  });

  const today = new Date().toISOString().slice(0, 10);
  const rows = [...(echeances.data ?? [])].sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  const nameOf = (id: string) =>
    (clients.data ?? []).find((c) => c.tenantId === id)?.name ?? id.slice(0, 8);

  const days = (iso: string) =>
    Math.round(
      (new Date(`${iso}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) /
        86_400_000,
    );

  const isLate = (dueDate: string, status: string) => dueDate < today && status !== "deposee";
  const late = rows.filter((e) => isLate(e.dueDate, e.status));
  const week = rows.filter((e) => !isLate(e.dueDate, e.status) && days(e.dueDate) <= 7);
  const deposees = rows.filter((e) => e.status === "deposee");

  const fmt = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${iso}T00:00:00Z`));

  useRegalicaPanel(
    <RegalicaNote kicker={t("cab.echeances.panel.kicker")}>
      {t("cab.echeances.panel", { late: late.length, week: week.length })}
    </RegalicaNote>,
    [late.length, week.length, locale],
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">{t("cab.echeances.title")}</h1>
        <p className="mt-1 text-[12px] text-muted-foreground">{t("cab.echeances.lede")}</p>
      </div>

      <KpiRow
        items={[
          { key: "total", label: t("cab.echeances.kpi.total"), value: String(rows.length) },
          { key: "late", label: t("cab.echeances.kpi.late"), value: String(late.length) },
          { key: "week", label: t("cab.echeances.kpi.week"), value: String(week.length) },
          { key: "done", label: t("cab.echeances.kpi.done"), value: String(deposees.length) },
        ]}
      />

      <section className="space-y-3">
        <SectionTitle>{t("cab.echeances.calendar")}</SectionTitle>

        {clients.isPending || (ids.length > 0 && echeances.isPending) ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : rows.length === 0 ? (
          <EmptyState>{t("cab.echeances.empty")}</EmptyState>
        ) : (
          <InkTable
            caption={t("cab.echeances.title")}
            head={[
              t("cab.echeances.col.due"),
              t("cab.queue.client"),
              t("cab.echeances.col.label"),
              t("cab.echeances.col.period"),
              t("cab.echeances.col.state"),
            ]}
          >
            {rows.map((e) => {
              const overdue = isLate(e.dueDate, e.status);
              const d = days(e.dueDate);
              return (
                <InkTableRow key={e.id}>
                  <InkCell numeric>{fmt(e.dueDate)}</InkCell>
                  <InkCell>{nameOf(e.tenantId)}</InkCell>
                  <InkCell>{e.label}</InkCell>
                  <InkCell numeric>{e.period ?? "—"}</InkCell>
                  <InkCell>
                    <SignalLight
                      tone={overdue ? "stop" : e.status === "deposee" ? "ok" : d <= 7 ? "warn" : "neutral"}
                      label={
                        e.status === "deposee"
                          ? t("cab.echeances.state.done")
                          : overdue
                            ? t("cab.echeances.overdue", { days: Math.abs(d) })
                            : t("cab.echeances.inDays", { days: d })
                      }
                    />
                  </InkCell>
                </InkTableRow>
              );
            })}
          </InkTable>
        )}
      </section>

      <p className="text-[10px] italic text-muted-foreground">{t("cab.echeances.source")}</p>
    </div>
  );
}
