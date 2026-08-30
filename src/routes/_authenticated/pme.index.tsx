import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { usePme } from "@/components/regalica/pme-context";
import { RegalicaChat } from "@/components/regalica/RegalicaChat";
import { BigNumber, InkCard, RegalicaVoice, StoneCard } from "@/components/regalica/office-ui";
import { currentPeriod, useTvaPeriod } from "@/hooks/use-tva";
import { useI18n } from "@/i18n";
import { office } from "@/verticals/regalica-office/composition";

export const Route = createFileRoute("/_authenticated/pme/")({
  head: () => ({
    meta: [
      { title: "Mon espace — Regalica Office — Regalica Office" },
      { name: "description", content: "Le chiffre du moment, la capture en un tap et l'état de mes pièces." },
      { property: "og:title", content: "Mon espace — Regalica Office — Regalica Office" },
      { property: "og:description", content: "Le chiffre du moment, la capture en un tap et l'état de mes pièces." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PmeHome,
});

function PmeHome() {
  const { t, locale } = useI18n();
  const pme = usePme();
  const period = currentPeriod();

  const pieces = useQuery({
    queryKey: ["pieces", pme.tenantId],
    queryFn: () => office().capture.list(pme.tenantId),
  });

  const { tva, count } = useTvaPeriod(period);

  const list = pieces.data ?? [];
  const total = list.length;
  const booked = list.filter(
    (p) => p.status === "comptabilisee" || p.status === "supervisee",
  ).length;
  const remaining = Math.max(0, total - booked);
  const returned = list.filter((p) => p.status === "retournee").length;

  const monthLabel = new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${period}-01T00:00:00Z`));

  const hour = new Date().getHours();
  const greeting = t(
    hour < 12
      ? "pme.home.greet.morning"
      : hour < 18
        ? "pme.home.greet.afternoon"
        : "pme.home.greet.evening",
  );

  const sentence =
    total === 0
      ? t("pme.home.state.empty")
      : remaining === 0
        ? t("pme.home.state.complete", { month: monthLabel, count: booked })
        : t("pme.home.state.progress", { remaining, month: monthLabel });

  const espaceState =
    total === 0
      ? t("pme.home.espace.empty")
      : remaining === 0
        ? t("pme.home.espace.uptodate")
        : t("pme.home.espace.remaining", { remaining });

  return (
    <div className="space-y-6">
      <RegalicaVoice greeting={greeting} sentence={sentence} />

      <BigNumber
        kicker={t("pme.home.tva.kicker", { month: monthLabel.toUpperCase() })}
        value={tva ? `${tva.totals.solde} ${tva.currency}` : "—"}
        context={
          count === 0
            ? t("pme.home.tva.context.zero")
            : t("pme.home.tva.context.other", { count })
        }
      />

      {returned > 0 ? (
        <p className="border border-s-2 border-border border-s-signal-stop bg-card px-3 py-2 text-[12px]">
          {t("pme.home.returned", { count: returned })}
        </p>
      ) : null}

      <InkCard to="/pme/list" label={t("pme.home.espace.label")} state={espaceState} />

      <div className="grid grid-cols-2 gap-3">
        <StoneCard
          to="/pme/tva"
          label={t("pme.tva.title")}
          state={tva ? `${tva.totals.solde} ${tva.currency}` : "—"}
        />
        <StoneCard to="/pme/coffre" label={t("pme.home.card.coffre")} state={t("pme.coffre.tab.partage")} />
        <StoneCard
          to="/pme/charges"
          label={t("pme.home.card.charges")}
          state={t("pme.charges.byFamille")}
        />
        <StoneCard to="/pme/echeances" label={t("pme.home.card.echeances")} state={t("pme.echeances.list")} />
      </div>

      {pme.captureError ? (
        <p className="border border-signal-stop px-3 py-2 text-xs text-signal-stop">
          {pme.captureError}
        </p>
      ) : null}

      <button
        type="button"
        onClick={() => pme.capture("pdf")}
        disabled={pme.capturing}
        className="mx-auto block text-xs text-muted-foreground underline underline-offset-4 disabled:opacity-50"
      >
        {pme.capturing ? t("pme.capture.sending") : t("pme.home.import")}
      </button>

      <section className="border border-border bg-card px-3 py-3">
        <p className="pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {t("regalica.chat.her")}
        </p>
        <RegalicaChat tenantId={pme.tenantId} />
      </section>

      <p className="pt-1 text-center text-[10px] italic text-muted-foreground">
        {t("pme.home.disclaimer")}
      </p>
    </div>
  );
}
