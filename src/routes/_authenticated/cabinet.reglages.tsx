import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { useCabinet, useRegalicaPanel } from "@/components/regalica/cabinet-context";
import {
  EmptyState,
  InkCell,
  InkTable,
  InkTableRow,
  RegalicaNote,
  SectionTitle,
} from "@/components/regalica/office-ui";
import { useI18n } from "@/i18n";
import { office } from "@/verticals/regalica-office/composition";

export const Route = createFileRoute("/_authenticated/cabinet/reglages")({
  head: () => ({
    meta: [
      { title: "Réglages du cabinet — Regalica Office" },
      { name: "description", content: "Juridiction, devise et mode de validation de chaque dossier client mandaté." },
      { property: "og:title", content: "Réglages du cabinet — Regalica Office" },
      { property: "og:description", content: "Juridiction, devise et mode de validation de chaque dossier client mandaté." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CabinetSettings,
});

function CabinetSettings() {
  const { t, locale } = useI18n();
  const { org } = useCabinet();

  const clients = useQuery({
    queryKey: ["cab-clients", org.id],
    queryFn: () => office().supervision.listClients(org.id),
  });

  useRegalicaPanel(<RegalicaNote>{t("cab.regalica.queue")}</RegalicaNote>, [locale]);

  const rows = clients.data ?? [];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">{t("cab.settings.title")}</h1>
        <p className="mt-1 text-[12px] text-muted-foreground">{t("cab.settings.lede")}</p>
      </div>

      <dl className="grid gap-px border border-border bg-border text-[13px]">
        <div className="flex items-baseline justify-between gap-3 bg-card px-3 py-2">
          <dt className="text-muted-foreground">{t("app.jurisdiction")}</dt>
          <dd className="num">{org.jurisdiction}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3 bg-card px-3 py-2">
          <dt className="text-muted-foreground">{t("app.currency")}</dt>
          <dd className="num">{org.currency}</dd>
        </div>
      </dl>

      <SectionTitle>{t("cab.settings.mode")}</SectionTitle>
      {rows.length === 0 ? (
        <EmptyState>{t("cab.clients.empty")}</EmptyState>
      ) : (
        <InkTable
          caption={t("cab.settings.mode")}
          head={[t("cab.queue.client"), t("cab.clients.mode"), t("cab.clients.mandate")]}
        >
          {rows.map((client) => (
            <InkTableRow key={client.tenantId}>
              <InkCell>{client.name}</InkCell>
              <InkCell>{client.validationMode}</InkCell>
              <InkCell>{client.engagementStatus}</InkCell>
            </InkTableRow>
          ))}
        </InkTable>
      )}
    </div>
  );
}
