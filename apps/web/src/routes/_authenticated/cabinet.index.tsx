import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import { useCabinet, useRegalicaPanel } from "@/components/regalica/cabinet-context";
import {
  EmptyState,
  InkCell,
  InkTable,
  InkTableRow,
  RegalicaNote,
  SectionTitle,
  SignalLight,
  StatCards,
} from "@/components/regalica/office-ui";

import { useI18n, type MessageKey } from "@/i18n";
import { office } from "@/verticals/regalica-office/composition";
import type { PieceStatus, QueueItem } from "@/verticals/regalica-office/ports/repositories";

export const Route = createFileRoute("/_authenticated/cabinet/")({
  head: () => ({
    meta: [
      { title: "Aujourd'hui — cabinet — Regalica Office" },
      {
        name: "description",
        content: "La file priorisée du jour, les agents au travail et les chiffres du cabinet.",
      },
      { property: "og:title", content: "Aujourd'hui — cabinet — Regalica Office" },
      {
        property: "og:description",
        content: "La file priorisée du jour, les agents au travail et les chiffres du cabinet.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CabinetToday,
});

export function toneForStatus(status: PieceStatus): "ok" | "warn" | "stop" | "neutral" {
  if (status === "supervisee") return "ok";
  if (status === "retournee") return "stop";
  if (status === "comptabilisee") return "warn";
  return "neutral";
}

function CabinetToday() {
  const { t, locale } = useI18n();
  const { org } = useCabinet();

  const clients = useQuery({
    queryKey: ["cab-clients", org.id],
    queryFn: () => office().supervision.listClients(org.id),
  });

  const queue = useQuery({
    queryKey: ["cab-queue", org.id],
    queryFn: () => office().supervision.queue(org.id),
  });

  useRegalicaPanel(<RegalicaNote>{t("cab.regalica.queue")}</RegalicaNote>, [locale]);

  const rows = queue.data ?? [];
  const toReview = rows.filter((r) => r.status === "comptabilisee").length;
  const returned = rows.filter((r) => r.status === "retournee").length;
  const supervised = rows.filter((r) => r.status === "supervisee").length;

  const clientCount = (clients.data ?? []).length;
  const today = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());

  return (
    <div className="space-y-8">
      <p className="text-[13px] text-muted-foreground">
        <span className="font-semibold text-foreground">{t("cab.today.title")}</span> · {today}
      </p>

      <header>
        <h1 className="text-[30px] font-semibold leading-tight tracking-tight">
          {t("cab.today.greeting")}
        </h1>
        <p className="mt-1 text-[15px] text-muted-foreground">
          {t("cab.today.summary", { pieces: rows.length, clients: clientCount })}
        </p>
      </header>

      <StatCards
        items={[
          {
            key: "review",
            label: t("cab.kpi.review"),
            value: String(toReview),
            tone: toReview ? "warn" : "neutral",
          },
          {
            key: "supervised",
            label: t("cab.kpi.supervised"),
            value: String(supervised),
            tone: supervised ? "ok" : "neutral",
          },
          {
            key: "returned",
            label: t("cab.kpi.returned"),
            value: String(returned),
            tone: returned ? "stop" : "neutral",
          },
          { key: "clients", label: t("cab.kpi.clients"), value: String(clientCount) },
        ]}
      />

      <section className="space-y-3">
        <SectionTitle
          action={
            <Link
              to="/cabinet/clients"
              className="text-[11px] uppercase tracking-wide text-muted-foreground underline"
            >
              {t("cab.nav.clients")}
            </Link>
          }
        >
          {t("cab.queue.byclient")}
        </SectionTitle>

        {queue.isPending ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : rows.length === 0 ? (
          <EmptyState>{t("cab.queue.empty")}</EmptyState>
        ) : (
          <QueueTable rows={rows} />
        )}

        <div className="flex flex-wrap gap-2 pt-2">
          <Link
            to="/cabinet/propositions"
            className="border border-foreground bg-foreground px-4 py-2 text-[12px] font-semibold uppercase tracking-wide text-background"
          >
            {t("cab.today.bulk")}
          </Link>
          <Link
            to="/cabinet/clients"
            className="border border-border bg-card px-4 py-2 text-[12px] font-semibold uppercase tracking-wide hover:bg-accent"
          >
            {t("cab.today.start")}
          </Link>
        </div>
      </section>
    </div>
  );
}

export function QueueTable({ rows }: { rows: QueueItem[] }) {
  const { t } = useI18n();
  return (
    <InkTable
      caption={t("cab.queue.title")}
      head={[
        t("cab.queue.client"),
        t("cab.queue.libelle"),
        t("cab.queue.status"),
        t("cab.queue.date"),
        "",
      ]}
    >
      {rows.map((row) => (
        <InkTableRow key={row.pieceId}>
          <InkCell>{row.clientName}</InkCell>
          <InkCell>{row.libelle ?? "—"}</InkCell>
          <InkCell>
            <SignalLight
              tone={toneForStatus(row.status)}
              label={t(`pme.status.${row.status}` as MessageKey)}
            />
          </InkCell>
          <InkCell numeric>{row.createdAt.slice(0, 10)}</InkCell>
          <InkCell>
            <Link
              to="/cabinet/piece/$pieceId"
              params={{ pieceId: row.pieceId }}
              className="text-[11px] uppercase tracking-wide underline"
            >
              {t("cab.queue.open")}
            </Link>
          </InkCell>
        </InkTableRow>
      ))}
    </InkTable>
  );
}
