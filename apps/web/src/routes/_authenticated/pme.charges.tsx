import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { RegalicaAvatar } from "@/components/regalica/office-ui";
import { usePme } from "@/components/regalica/pme-context";
import { useI18n } from "@/i18n";
import { office } from "@/verticals/regalica-office/composition";
import { computeChargesByFamille } from "@/verticals/regalica-office/socle/engines/charges/familles";

export const Route = createFileRoute("/_authenticated/pme/charges")({
  head: () => ({
    meta: [
      { title: "Mes charges par famille — Regalica Office" },
      {
        name: "description",
        content:
          "Les charges de la période regroupées par famille, à partir d'articles cités, avec les écarts inhabituels signalés.",
      },
      { property: "og:title", content: "Mes charges par famille — Regalica Office" },
      {
        property: "og:description",
        content:
          "Les charges de la période regroupées par famille, à partir d'articles cités, avec les écarts inhabituels signalés.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ChargesScreen,
});

const HISTORY_MONTHS = 6;
const THRESHOLD_CODE = "FAMILLE_CONSO";

function monthsBack(n: number): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 7);
}

/**
 * « Vos charges » — lecture par famille. Aucun chiffre calculé ici : le total
 * et l'écart viennent du moteur du Socle, à partir d'articles cités et de
 * seuils du pack. Regalica pose la question, elle ne modifie rien.
 */
function ChargesScreen() {
  const { t, locale } = useI18n();
  const pme = usePme();
  const qc = useQueryClient();
  const [period, setPeriod] = useState(monthsBack(0));
  const [openFamille, setOpenFamille] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const periods = useMemo(
    () => Array.from({ length: HISTORY_MONTHS }, (_, i) => monthsBack(i)),
    [],
  );

  const refs = useQuery({
    queryKey: ["charges-refs", pme.packId],
    enabled: !!pme.packId,
    queryFn: async () => {
      const packId = pme.packId!;
      const [familles, threshold, params] = await Promise.all([
        office().charges.familles(packId),
        office().charges.anomalyThreshold(packId, THRESHOLD_CODE),
        office().referential.socleParams(packId),
      ]);
      return { familles, threshold, params };
    },
  });

  const articles = useQuery({
    queryKey: ["charges-articles", pme.tenantId, periods[periods.length - 1], period],
    queryFn: () =>
      office().charges.articles(pme.tenantId, periods[periods.length - 1]!, monthsBack(0)),
  });

  const questions = useQuery({
    queryKey: ["charge-questions", pme.tenantId],
    queryFn: () => office().charges.questions(pme.tenantId),
  });

  const result = useMemo(() => {
    if (!refs.data || !articles.data) return null;
    const baseline = periods.filter((p) => p < period);
    return computeChargesByFamille({
      articles: articles.data,
      familles: refs.data.familles,
      period,
      baselinePeriods: baseline,
      threshold: refs.data.threshold,
      decimals: refs.data.params.moneyDecimals,
    });
  }, [refs.data, articles.data, period, periods]);

  const answer = useMutation({
    mutationFn: async (input: { familleCode: string; reply: "exceptionnel" | "a_verifier" }) => {
      const anomaly = result?.anomalies.find((a) => a.familleCode === input.familleCode);
      if (!anomaly || !pme.packId) throw new Error(t("common.error"));
      return office().charges.answer({
        tenantId: pme.tenantId,
        period: anomaly.period,
        familleCode: anomaly.familleCode,
        observed: anomaly.observed,
        baseline: anomaly.baseline,
        deviationRatio: anomaly.deviationRatio,
        thresholdCode: anomaly.thresholdCode,
        packVersionId: pme.packId,
        answer: input.reply,
      });
    },
    onSuccess: async () => {
      setError(null);
      await qc.invalidateQueries({ queryKey: ["charge-questions", pme.tenantId] });
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : t("common.error")),
  });

  const answered = new Set(
    (questions.data ?? [])
      .filter((q) => q.answer !== null)
      .map((q) => `${q.period}|${q.familleCode}`),
  );

  const monthLabel = (p: string) =>
    new Intl.DateTimeFormat(locale, { month: "short", year: "2-digit", timeZone: "UTC" }).format(
      new Date(`${p}-01T00:00:00Z`),
    );

  const pct = (v: string) => `${Number(v) >= 0 ? "+" : ""}${(Number(v) * 100).toFixed(0)} %`;

  if (refs.isPending || articles.isPending) {
    return <p className="text-sm text-muted-foreground">{t("common.loading")}</p>;
  }

  const maxTotal = Math.max(...(result?.familles ?? []).map((f) => Number(f.total)), 0);
  const evolutionValue = result?.evolution ?? null;
  const evolution = evolutionValue === null ? null : Number(evolutionValue);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-[28px] font-semibold leading-tight tracking-tight">
          {t("pme.charges.title")}
        </h1>
        <p className="text-[15px] text-muted-foreground">{t("pme.charges.subtitle")}</p>
      </header>

      <div className="flex flex-wrap gap-2" role="group" aria-label={t("pme.charges.period")}>
        {periods.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPeriod(p)}
            aria-pressed={p === period}
            className={`min-h-[44px] border px-3 py-2 text-[11px] uppercase tracking-wide ${
              p === period
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-card"
            }`}
          >
            {monthLabel(p)}
          </button>
        ))}
      </div>

      {evolution !== null ? (
        <p className="flex items-center gap-2 bg-signal-soft px-3 py-3 text-[15px] text-signal-warn">
          <span aria-hidden className="inline-block h-2 w-2 bg-signal-warn" />
          {evolution < 0
            ? t("pme.charges.trend.down", { value: pct(evolutionValue!) })
            : t("pme.charges.trend.up", { value: pct(evolutionValue!) })}
        </p>
      ) : null}

      {result && result.familles.length > 0 ? (
        <section aria-label={t("pme.charges.byFamille")}>
          <ul>
            {result.familles.map((f) => {
              const open = openFamille === f.code;
              const detail = (articles.data ?? []).filter(
                (a) => a.period === period && a.familleCode === f.code,
              );
              const width = maxTotal > 0 ? Math.round((Number(f.total) / maxTotal) * 100) : 0;
              return (
                <li key={f.code} className="border-b border-border/60 py-2">
                  <button
                    type="button"
                    onClick={() => setOpenFamille(open ? null : f.code)}
                    aria-expanded={open}
                    className="flex min-h-[44px] w-full items-center gap-3 text-start"
                  >
                    <span className="w-[34%] shrink-0 truncate text-[16px]">{f.label}</span>
                    <span className="h-[10px] flex-1 bg-muted">
                      <span className="block h-full bg-foreground" style={{ width: `${width}%` }} />
                    </span>
                    <span className="num shrink-0 text-[16px] tabular-nums">{f.total}</span>
                  </button>

                  {open ? (
                    <ul className="mt-2 divide-y divide-border border border-border">
                      {detail.map((a) => (
                        <li key={`${a.pieceId}-${a.ordinal}`} className="px-3 py-2 text-[12px]">
                          <div className="flex items-baseline justify-between gap-2">
                            <Link
                              to="/pme/piece/$pieceId"
                              params={{ pieceId: a.pieceId }}
                              className="underline underline-offset-4"
                            >
                              {a.designation}
                            </Link>
                            <span className="num">{a.citationTotalHt ? a.totalHt : "—"}</span>
                          </div>
                          <p className="num mt-1 text-[11px] text-muted-foreground">
                            {t("pme.extract.qty")} {a.citationQuantity ? a.quantity : "—"} ·{" "}
                            {t("pme.extract.pu_ht")} {a.citationUnitPriceHt ? a.unitPriceHt : "—"} ·{" "}
                            {t("pme.extract.pu_ttc")}{" "}
                            {a.citationUnitPriceTtc ? a.unitPriceTtc : "—"}
                          </p>
                        </li>
                      ))}
                      {detail.length === 0 ? (
                        <li className="px-3 py-2 text-[12px] text-muted-foreground">
                          {t("pme.charges.empty")}
                        </li>
                      ) : null}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <p className="mt-3 flex items-baseline justify-between gap-3 text-[13px] text-muted-foreground">
            <span className="uppercase tracking-[0.18em]">{t("pme.charges.total")}</span>
            <span className="num text-[16px] text-foreground">
              {result.total} {pme.currency}
            </span>
          </p>
        </section>
      ) : (
        <p className="border border-border bg-card px-4 py-4 text-sm text-muted-foreground">
          {t("pme.charges.empty")}
        </p>
      )}

      {(result?.anomalies ?? []).map((a) => {
        const done = answered.has(`${a.period}|${a.familleCode}`);
        return (
          <section
            key={a.familleCode}
            className="border border-border border-s-[3px] border-s-foreground bg-card px-4 py-4"
          >
            <div className="flex items-start gap-3">
              <RegalicaAvatar size={44} alt="Regalica" />
              <p className="min-w-0 flex-1 text-[16px] leading-relaxed">
                {t("pme.charges.question", {
                  famille: a.label,
                  value: pct(a.deviationRatio),
                  baseline: `${a.baseline} ${pme.currency}`,
                  observed: `${a.observed} ${pme.currency}`,
                })}
              </p>
            </div>
            {done ? (
              <p className="mt-3 text-xs text-muted-foreground">{t("pme.charges.answered")}</p>
            ) : (
              <div className="mt-4 grid grid-cols-2 gap-3">
                <button
                  type="button"
                  disabled={answer.isPending}
                  onClick={() =>
                    answer.mutate({ familleCode: a.familleCode, reply: "exceptionnel" })
                  }
                  className="min-h-[52px] border border-border bg-card px-3 text-[15px] disabled:opacity-60"
                >
                  {t("pme.charges.answer.exceptionnel")}
                </button>
                <button
                  type="button"
                  disabled={answer.isPending}
                  onClick={() => answer.mutate({ familleCode: a.familleCode, reply: "a_verifier" })}
                  className="min-h-[52px] border border-border bg-card px-3 text-[15px] disabled:opacity-60"
                >
                  {t("pme.charges.answer.verifier")}
                </button>
              </div>
            )}
          </section>
        );
      })}

      {error ? <p className="text-xs text-signal-warn">{error}</p> : null}

      <p className="text-[10px] italic text-muted-foreground">{t("pme.charges.disclaimer")}</p>
    </div>
  );
}
