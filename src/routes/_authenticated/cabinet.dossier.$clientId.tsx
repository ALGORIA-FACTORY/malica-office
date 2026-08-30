import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { useCabinet, useRegalicaPanel } from "@/components/regalica/cabinet-context";
import { EmptyState, KpiRow, RegalicaNote, SectionTitle } from "@/components/regalica/office-ui";
import { useI18n } from "@/i18n";
import { office } from "@/verticals/regalica-office/composition";

import { QueueTable } from "./cabinet.index";

export const Route = createFileRoute("/_authenticated/cabinet/dossier/$clientId")({
  head: () => ({
    meta: [
      { title: "Dossier client — Regalica Office" },
      {
        name: "description",
        content:
          "Plan de travail d'un dossier client : volumes par état et file de pièces à superviser.",
      },
      { property: "og:title", content: "Dossier client — Regalica Office" },
      {
        property: "og:description",
        content:
          "Plan de travail d'un dossier client : volumes par état et file de pièces à superviser.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CabinetClient,
});

function CabinetClient() {
  const { clientId } = Route.useParams();
  const { t, locale } = useI18n();
  const { org } = useCabinet();

  const clients = useQuery({
    queryKey: ["cab-clients", org.id],
    queryFn: () => office().supervision.listClients(org.id),
  });

  const queue = useQuery({
    queryKey: ["cab-queue", org.id, clientId],
    queryFn: () => office().supervision.queue(org.id, clientId),
  });

  const client = (clients.data ?? []).find((c) => c.tenantId === clientId) ?? null;

  useRegalicaPanel(<RegalicaNote>{t("cab.regalica.queue")}</RegalicaNote>, [locale]);

  if (clients.isPending)
    return <p className="text-sm text-muted-foreground">{t("common.loading")}</p>;
  if (!client) return <EmptyState>{t("cab.clients.empty")}</EmptyState>;

  const rows = queue.data ?? [];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">{client.name}</h1>
        <p className="num mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">
          {client.jurisdiction} · {client.currency} · {client.validationMode} ·{" "}
          {client.engagementStatus}
        </p>
      </header>

      <KpiRow
        items={[
          { key: "review", label: t("cab.kpi.review"), value: String(client.counts.comptabilisee) },
          { key: "returned", label: t("cab.kpi.returned"), value: String(client.counts.retournee) },
          {
            key: "supervised",
            label: t("cab.kpi.supervised"),
            value: String(client.counts.supervisee),
          },
          { key: "read", label: t("pme.status.lue"), value: String(client.counts.lue) },
        ]}
      />

      <section className="space-y-3">
        <SectionTitle>{t("cab.client.queue")}</SectionTitle>
        {queue.isPending ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : rows.length === 0 ? (
          <EmptyState>{t("cab.queue.empty")}</EmptyState>
        ) : (
          <QueueTable rows={rows} />
        )}
      </section>
    </div>
  );
}
