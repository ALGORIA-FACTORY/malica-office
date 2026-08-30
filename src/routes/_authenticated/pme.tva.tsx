import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { BigNumber } from "@/components/regalica/office-ui";
import { currentPeriod, useTvaPeriod } from "@/hooks/use-tva";
import { useI18n } from "@/i18n";

export const Route = createFileRoute("/_authenticated/pme/tva")({
  head: () => ({
    meta: [
      { title: "TVA de la période — Regalica Office" },
      { name: "description", content: "La TVA collectée, déductible et à payer de la période, calculée par le Socle." },
      { property: "og:title", content: "TVA de la période — Regalica Office" },
      { property: "og:description", content: "La TVA collectée, déductible et à payer de la période, calculée par le Socle." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: TvaScreen,
});

function TvaScreen() {
  const { t, locale } = useI18n();
  const [period, setPeriod] = useState(currentPeriod);
  const { tva, count, isPending } = useTvaPeriod(period);

  const monthLabel = new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${period}-01T00:00:00Z`));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-lg font-semibold tracking-tight">{t("pme.tva.title")}</h1>
        <label className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
          {t("pme.tva.period")}
          <input
            type="month"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="num border border-border bg-card px-2 py-1 text-sm text-foreground"
          />
        </label>
      </div>

      <BigNumber
        kicker={t("pme.home.tva.kicker", { month: monthLabel.toUpperCase() })}
        value={tva ? `${tva.totals.solde} ${tva.currency}` : "—"}
        context={
          count === 0
            ? t("pme.home.tva.context.zero")
            : t("pme.home.tva.context.other", { count })
        }
      />

      {isPending ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : !tva || (tva.collectee.length === 0 && tva.deductible.length === 0) ? (
        <p className="border border-border bg-card p-5 text-sm text-muted-foreground">
          {t("pme.tva.empty")}
        </p>
      ) : (
        <div className="grid gap-px border border-border bg-border">
          <Bucket title={t("pme.tva.collectee")} rows={tva.collectee} />
          <Bucket title={t("pme.tva.deductible")} rows={tva.deductible} />
          <div className="flex items-baseline justify-between bg-card px-4 py-4">
            <span className="text-xs font-medium uppercase tracking-wide">
              {t("pme.tva.solde")}
            </span>
            <span className="num text-lg">
              {tva.totals.solde} {tva.currency}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function Bucket({
  title,
  rows,
}: {
  title: string;
  rows: ReadonlyArray<{ tax_code: string; rate: string; base: string; vat: string }>;
}) {
  return (
    <section className="bg-card px-4 py-4">
      <h2 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {title}
      </h2>
      {rows.length === 0 ? (
        <p className="num mt-2 text-sm">—</p>
      ) : (
        <table className="mt-2 w-full border-collapse text-sm">
          <tbody>
            {rows.map((r) => (
              <tr key={r.tax_code} className="border-t border-border first:border-t-0">
                <td className="num py-2 text-xs text-muted-foreground">{r.tax_code}</td>
                <td className="num py-2 text-end text-xs text-muted-foreground">{r.base}</td>
                <td className="num py-2 text-end">{r.vat}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
