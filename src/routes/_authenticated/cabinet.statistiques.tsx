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
} from "@/components/regalica/office-ui";
import { useI18n } from "@/i18n";
import { office } from "@/verticals/regalica-office/composition";

export const Route = createFileRoute("/_authenticated/cabinet/statistiques")({
  head: () => ({
    meta: [
      { title: "Statistiques du cabinet — Regalica Office" },
      {
        name: "description",
        content:
          "Volumes par état, retours et délai moyen de traitement par dossier client, agrégés côté base sur le périmètre mandaté.",
      },
      { property: "og:title", content: "Statistiques du cabinet — Regalica Office" },
      {
        property: "og:description",
        content: "Volumes, retours et délais par client, sur le seul périmètre mandaté.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CabinetStatistiques,
});

function CabinetStatistiques() {
  const { t, locale } = useI18n();
  const { org } = useCabinet();

  const clients = useQuery({
    queryKey: ["cab-clients", org.id],
    queryFn: () => office().supervision.listClients(org.id),
  });

  const ids = (clients.data ?? []).map((c) => c.tenantId);

  const stats = useQuery({
    queryKey: ["cab-stats", org.id, ids.join(",")],
    queryFn: () => office().collab.stats(ids),
    enabled: ids.length > 0,
  });

  const rows = stats.data ?? [];
  const nameOf = (id: string) =>
    (clients.data ?? []).find((c) => c.tenantId === id)?.name ?? id.slice(0, 8);

  const total = rows.reduce((s, r) => s + r.pieces, 0);
  const aRevoir = rows.reduce((s, r) => s + r.comptabilisees, 0);
  const retours = rows.reduce((s, r) => s + r.retournees, 0);
  const delai =
    rows.length === 0 ? 0 : rows.reduce((s, r) => s + r.heuresMoyennes, 0) / rows.length;

  const num = (v: number, d = 0) =>
    new Intl.NumberFormat(locale, { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);

  useRegalicaPanel(
    <RegalicaNote kicker={t("cab.stats.panel.kicker")}>
      {t("cab.stats.panel", { clients: rows.length, retours })}
    </RegalicaNote>,
    [rows.length, retours],
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">{t("cab.stats.title")}</h1>
        <p className="mt-1 text-[12px] text-muted-foreground">{t("cab.stats.lede")}</p>
      </div>

      <KpiRow
        items={[
          { key: "clients", label: t("cab.stats.kpi.clients"), value: num(rows.length) },
          { key: "pieces", label: t("cab.stats.kpi.pieces"), value: num(total) },
          { key: "review", label: t("cab.stats.kpi.review"), value: num(aRevoir) },
          {
            key: "delai",
            label: t("cab.stats.kpi.delay"),
            value: `${num(delai, 1)} h`,
            context: t("cab.stats.kpi.delay.ctx"),
          },
        ]}
      />

      <section className="space-y-3">
        <SectionTitle>{t("cab.stats.byClient")}</SectionTitle>
        {clients.isPending || stats.isPending ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : rows.length === 0 ? (
          <EmptyState>{t("cab.stats.empty")}</EmptyState>
        ) : (
          <InkTable
            head={[
              t("cab.stats.col.client"),
              t("cab.stats.col.pieces"),
              t("cab.stats.col.pending"),
              t("cab.stats.col.booked"),
              t("cab.stats.col.reviewed"),
              t("cab.stats.col.returned"),
              t("cab.stats.col.delay"),
            ]}
          >
            {rows.map((r) => (
              <InkTableRow key={r.tenantId}>
                <InkCell>{nameOf(r.tenantId)}</InkCell>
                <InkCell numeric>{num(r.pieces)}</InkCell>
                <InkCell numeric>{num(r.capturees + r.lues + r.proposees)}</InkCell>
                <InkCell numeric>{num(r.comptabilisees)}</InkCell>
                <InkCell numeric>{num(r.supervisees)}</InkCell>
                <InkCell numeric>{num(r.retournees)}</InkCell>
                <InkCell numeric>{num(r.heuresMoyennes, 1)}</InkCell>
              </InkTableRow>
            ))}
          </InkTable>
        )}
      </section>

      <p className="text-[10px] italic text-muted-foreground">{t("cab.stats.source")}</p>
    </div>
  );
}
