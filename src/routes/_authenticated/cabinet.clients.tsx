import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import { useCabinet, useRegalicaPanel } from "@/components/regalica/cabinet-context";
import {
  EmptyState,
  InkCell,
  InkTable,
  InkTableRow,
  KpiRow,
  RegalicaNote,
  SectionTitle,
} from "@/components/regalica/office-ui";
import { useI18n } from "@/i18n";
import { office } from "@/verticals/regalica-office/composition";

export const Route = createFileRoute("/_authenticated/cabinet/clients")({
  head: () => ({
    meta: [
      { title: "Clients du cabinet — Regalica Office" },
      { name: "description", content: "Les dossiers mandatés du cabinet, leur mode de validation et le volume de pièces à superviser." },
      { property: "og:title", content: "Clients du cabinet — Regalica Office" },
      { property: "og:description", content: "Les dossiers mandatés du cabinet, leur mode de validation et le volume de pièces à superviser." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CabinetClients,
});

function CabinetClients() {
  const { t, locale } = useI18n();
  const { org } = useCabinet();

  const clients = useQuery({
    queryKey: ["cab-clients", org.id],
    queryFn: () => office().supervision.listClients(org.id),
  });

  useRegalicaPanel(<RegalicaNote>{t("cab.regalica.queue")}</RegalicaNote>, [locale]);

  const rows = clients.data ?? [];

  const totalReview = rows.reduce((s, c) => s + c.counts.comptabilisee, 0);
  const totalReturned = rows.reduce((s, c) => s + c.counts.retournee, 0);
  const totalSupervised = rows.reduce((s, c) => s + c.counts.supervisee, 0);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">{t("cab.clients.title")}</h1>
        <p className="mt-1 text-[12px] text-muted-foreground">{t("cab.clients.lede")}</p>
      </div>

      <KpiRow
        items={[
          { key: "clients", label: t("cab.kpi.clients"), value: String(rows.length) },
          { key: "review", label: t("cab.kpi.review"), value: String(totalReview) },
          { key: "supervised", label: t("cab.kpi.supervised"), value: String(totalSupervised) },
          { key: "returned", label: t("cab.kpi.returned"), value: String(totalReturned) },
        ]}
      />

      <SectionTitle>{t("cab.queue.byclient")}</SectionTitle>


      {clients.isPending ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : rows.length === 0 ? (
        <EmptyState>{t("cab.clients.empty")}</EmptyState>
      ) : (
        <InkTable
          caption={t("cab.clients.title")}
          head={[
            t("cab.queue.client"),
            t("cab.clients.mandate"),
            t("cab.clients.mode"),
            t("cab.kpi.review"),
            t("cab.kpi.returned"),
            "",
          ]}
        >
          {rows.map((client) => (
            <InkTableRow key={client.tenantId}>
              <InkCell>
                <span className="font-medium">{client.name}</span>
                {client.legalId ? (
                  <span className="num ms-2 text-[11px] text-muted-foreground">
                    {client.legalId}
                  </span>
                ) : null}
              </InkCell>
              <InkCell>{client.engagementStatus}</InkCell>
              <InkCell>{client.validationMode}</InkCell>
              <InkCell numeric>{client.counts.comptabilisee}</InkCell>
              <InkCell numeric>{client.counts.retournee}</InkCell>
              <InkCell>
                <Link
                  to="/cabinet/dossier/$clientId"
                  params={{ clientId: client.tenantId }}
                  className="text-[11px] uppercase tracking-wide underline"
                >
                  {t("cab.queue.open")}
                </Link>
              </InkCell>
            </InkTableRow>
          ))}
        </InkTable>
      )}
    </div>
  );
}
