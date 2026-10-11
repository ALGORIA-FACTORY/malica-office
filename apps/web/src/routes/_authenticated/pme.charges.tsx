import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { MalicaAvatar } from "@/components/malica/office-ui";
import { usePme } from "@/components/malica/pme-context";
import { useMoisDeLExercice } from "@/hooks/use-mois-de-l-exercice";
import { currentPeriod } from "@/hooks/use-tva";
import { useI18n } from "@/i18n";
import { montant, quantite } from "@/lib/lisible";
import { cn } from "@/lib/utils";
import { office } from "@/verticals/malica-office/composition";
import { computeChargesByFamille } from "@malica/socle/engines/charges/familles";
import { texteDeLErreur } from "@/lib/erreur-lisible";

export const Route = createFileRoute("/_authenticated/pme/charges")({
  head: () => ({
    meta: [
      { title: "Mes charges par famille — Malica Office" },
      {
        name: "description",
        content:
          "Les charges de la période regroupées par famille, à partir d'articles cités, avec les écarts inhabituels signalés.",
      },
      { property: "og:title", content: "Mes charges par famille — Malica Office" },
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

const THRESHOLD_CODE = "FAMILLE_CONSO";

/**
 * « Vos charges » — lecture par famille. Aucun chiffre calculé ici : le total
 * et l'écart viennent du moteur du Socle, à partir d'articles cités et de
 * seuils du pack. Malica pose la question, elle ne modifie rien.
 */
function ChargesScreen() {
  const { t, locale } = useI18n();
  const pme = usePme();
  const qc = useQueryClient();
  const [period, setPeriod] = useState(currentPeriod());
  const [openFamille, setOpenFamille] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Les douze mois de l'exercice, de janvier à décembre. Une fenêtre de six
  // mois écrite ici ne correspondait à rien : un dossier se boucle par
  // exercice, et deux autres écrans en montraient douze et quatre.
  const periods = useMoisDeLExercice(period);

  const refs = useQuery({
    queryKey: ["charges-refs", pme.packId],
    enabled: !!pme.packId,
    queryFn: async () => {
      const packId = pme.packId!;
      const [familles, threshold, params] = await Promise.all([
        office().charges.familles(packId, locale),
        office().charges.anomalyThreshold(packId, THRESHOLD_CODE),
        office().referential.socleParams(packId),
      ]);
      return { familles, threshold, params };
    },
  });

  // L'exercice entier, du premier mois au dernier.
  //
  // L'ancienne fenêtre était rangée du plus RÉCENT au plus ancien, et la
  // requête prenait donc `periods[dernier]` comme borne basse. Les mois de
  // l'exercice vont dans l'autre sens : prendre la même case rendrait une
  // plage inversée, donc vide. Les bornes sont désormais nommées.
  const premierMois = periods[0]?.periode ?? period;
  const dernierMois = periods[periods.length - 1]?.periode ?? period;

  const articles = useQuery({
    queryKey: ["charges-articles", pme.tenantId, premierMois, dernierMois],
    queryFn: () => office().charges.articles(pme.tenantId, premierMois, dernierMois),
  });

  const questions = useQuery({
    queryKey: ["charge-questions", pme.tenantId],
    queryFn: () => office().charges.questions(pme.tenantId),
  });

  /*
   * Ce qui attend sa date n'entre dans aucun mois, depuis le 5 octobre 2026 :
   * une pièce dont la date n'a pas été lue n'est plus rangée au mois du scan.
   *
   * Il faut donc le dire ici. Retirer un montant d'un total sans le nommer
   * remplacerait un chiffre faux par un silence, et la personne chercherait
   * en vain pourquoi son total a baissé.
   */
  const sansDate = useQuery({
    queryKey: ["charges-sans-date", pme.tenantId],
    queryFn: () => office().charges.enAttenteDeDate(pme.tenantId),
  });

  const result = useMemo(() => {
    if (!refs.data || !articles.data) return null;
    // La base de comparaison : les mois de l'exercice ANTÉRIEURS au mois
    // regardé. Un mois à venir en est exclu de fait, et il doit l'être — une
    // moyenne calculée sur des mois qui n'ont pas eu lieu signalerait une
    // anomalie à chaque début d'exercice.
    const baseline = periods.filter((p) => p.periode < period).map((p) => p.periode);
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
    onError: (e: unknown) =>
      setError(texteDeLErreur(e, "routes/_authenticated/pme.charges", t("common.error"))),
  });

  /**
   * La derniere reponse par question, et PAR QUI.
   *
   * 11 octobre 2026 : « aussi la reponse du comptable aux questions envoyees
   * par Malica ». L'ecran disait « Repondu » sans dire qui — or
   * « exceptionnel » dit par l'expert est un avis professionnel, et dit par
   * le dirigeant une declaration. Ce n'est pas la meme phrase.
   *
   * La lecture rend les reponses de la plus recente a la plus ancienne : la
   * premiere rencontree est donc celle qui vaut.
   */
  const repondue = new Map<string, { par: "pme" | "cabinet" | null }>();
  for (const q of questions.data ?? []) {
    const cle = `${q.period}|${q.familleCode}`;
    if (q.answer !== null && !repondue.has(cle)) repondue.set(cle, { par: q.answeredSide });
  }

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
    <div className="rg-rise px-1 pt-2">
      <p className="text-[24px] font-semibold leading-[1.15] tracking-[-0.025em]">
        {t("pme.charges.title")}
      </p>
      <p className="mt-[5px] text-[13.5px] text-text-2">
        {period === currentPeriod() ? t("pme.charges.subtitle") : monthLabel(period)}
      </p>

      {/*
       * La tendance en un mot, et sa couleur suit le fait : une baisse est une
       * bonne nouvelle, une hausse une question. Le prototype n'écrit pas
       * « écart de −6 % » — il écrit « en baisse de 6 %, beau travail ».
       */}
      {evolution !== null ? (
        <span
          className={cn(
            "mt-3 inline-flex items-center gap-2 border px-3 py-2 text-[13px] font-medium",
            evolution < 0
              ? "border-signal-ok text-signal-ok"
              : "border-signal-warn text-signal-warn",
          )}
        >
          <span aria-hidden className="h-[5px] w-[5px] bg-current" />
          {evolution < 0
            ? t("pme.charges.trend.down", { value: pct(evolutionValue!) })
            : t("pme.charges.trend.up", { value: pct(evolutionValue!) })}
        </span>
      ) : null}

      {/*
       * Les six mois d'historique. Le prototype n'en montre qu'un ; les cacher
       * retirerait la seule façon de voir qu'une hausse dure depuis trois mois.
       */}
      <div
        className="mt-3 flex flex-wrap gap-1.5"
        role="group"
        aria-label={t("pme.charges.period")}
      >
        {periods.map((p) => (
          <button
            key={p.periode}
            type="button"
            onClick={() => setPeriod(p.periode)}
            disabled={p.aVenir}
            aria-pressed={p.periode === period}
            className={cn(
              "border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.06em]",
              p.periode === period
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-transparent text-text-2",
              // Un mois à venir fait partie de l'exercice, mais il n'a pas eu
              // lieu : visible, en pointillé, et il ne s'ouvre pas.
              p.aVenir ? "border-dashed opacity-45" : "",
            )}
          >
            {monthLabel(p.periode)}
          </button>
        ))}
      </div>

      {result && result.familles.length > 0 ? (
        <>
          <div className="mt-[18px] flex flex-col gap-3">
            {result.familles.map((f) => {
              const open = openFamille === f.code;
              const detail = (articles.data ?? []).filter(
                (a) => a.period === period && a.familleCode === f.code,
              );
              const width = maxTotal > 0 ? Math.round((Number(f.total) / maxTotal) * 100) : 0;
              const suspecte = (result.anomalies ?? []).some((a) => a.familleCode === f.code);
              return (
                <div key={f.code}>
                  <button
                    type="button"
                    onClick={() => setOpenFamille(open ? null : f.code)}
                    aria-expanded={open}
                    className="grid w-full grid-cols-[minmax(64px,auto)_1fr_auto] items-center gap-2.5 text-start text-[14px] font-medium"
                  >
                    <span className="whitespace-nowrap">{f.label}</span>
                    <span className="relative h-[7px] bg-line-strong">
                      {/*
                       * Le poste qui a déclenché une question porte la couleur
                       * de l'alerte : on voit LEQUEL sans avoir à lire.
                       */}
                      <i
                        className={cn(
                          "absolute inset-y-0 start-0",
                          suspecte ? "bg-signal-warn" : "bg-foreground",
                        )}
                        style={{ width: `${width}%` }}
                      />
                    </span>
                    <span className="num text-[13px] font-medium">{montant(f.total, locale)}</span>
                  </button>

                  {open ? (
                    <div className="mt-2 border border-border">
                      {detail.map((a) => (
                        <div
                          key={`${a.pieceId}-${a.ordinal}`}
                          className="border-b border-border px-3 py-2 last:border-b-0"
                        >
                          <div className="flex items-baseline justify-between gap-2">
                            <Link
                              to="/pme/piece/$pieceId"
                              params={{ pieceId: a.pieceId }}
                              className="text-[13px] underline underline-offset-4"
                            >
                              {a.designation}
                            </Link>
                            <span className="num text-[12.5px]">
                              {a.citationTotalHt && a.totalHt ? montant(a.totalHt, locale) : "—"}
                            </span>
                          </div>
                          <p className="num mt-1 text-[11px] text-muted-foreground">
                            {t("pme.detail.qte", {
                              q:
                                a.citationQuantity && a.quantity
                                  ? quantite(a.quantity, locale)
                                  : "—",
                            })}
                            {a.citationUnitPriceHt && a.unitPriceHt
                              ? " · " + t("pme.detail.pu", { pu: montant(a.unitPriceHt, locale) })
                              : ""}
                          </p>
                        </div>
                      ))}
                      {detail.length === 0 ? (
                        <p className="px-3 py-2 text-[12px] text-muted-foreground">
                          {t("pme.charges.empty")}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div className="mt-4 flex items-baseline justify-between gap-3 border-t border-foreground pt-3">
            <span className="text-[13.5px] font-semibold">{t("pme.charges.total")}</span>
            <span className="num text-[15px] font-semibold">
              {montant(result.total, locale)} {pme.currency}
            </span>
          </div>
        </>
      ) : (
        <p className="mt-4 border border-border bg-card p-4 text-[13.5px] text-text-2">
          {t("pme.charges.empty")}
        </p>
      )}

      {/*
       * Ce qui attend sa date, sous le total et hors de lui.
       *
       * Posé le 5 octobre 2026, avec la fin du repli sur le mois du scan. Le
       * bloc dit trois choses, et les trois sont nécessaires : COMBIEN de
       * pièces, POURQUOI elles ne comptent pas, et le MONTANT qu'elles
       * représentent — sans quoi l'écart avec ce que la personne attend reste
       * inexpliqué. Il ne s'affiche pas quand il n'y a rien : une information
       * qui apparaît toujours cesse d'être lue.
       */}
      {sansDate.data && sansDate.data.pieces > 0 ? (
        <div className="mt-4 border border-signal-warn bg-card p-4">
          <p className="text-[13.5px] font-semibold">
            {t("pme.charges.sansDate.titre", { count: sansDate.data.pieces })}
          </p>
          <p className="mt-1 text-[12.5px] text-text-2">
            {t("pme.charges.sansDate.detail", {
              amount: `${montant(sansDate.data.totalHt ?? "0", locale)} ${pme.currency}`,
            })}
          </p>
          <Link
            to="/pme/list"
            className="mt-2 inline-block text-[12.5px] underline underline-offset-2"
          >
            {t("pme.charges.sansDate.action")}
          </Link>
        </div>
      ) : null}

      {/*
       * Elle interroge, elle ne tranche pas. Les deux réponses ont le même
       * poids visuel : aucune n'est présentée comme la bonne, parce qu'aucune
       * ne l'est — seul le dirigeant sait s'il a fait un achat exceptionnel.
       */}
      {(result?.anomalies ?? []).map((a) => {
        const faite = repondue.get(`${a.period}|${a.familleCode}`) ?? null;
        return (
          <div
            key={a.familleCode}
            className="mt-[22px] border border-border border-s-[3px] border-s-foreground bg-card p-4"
          >
            <div className="flex gap-3">
              <MalicaAvatar size={32} alt="Malica" rond />
              <p className="min-w-0 flex-1 text-[15px] leading-[1.5]">
                {t("pme.charges.question", {
                  famille: a.label,
                  value: pct(a.deviationRatio),
                  baseline: montant(a.baseline, locale) + " " + pme.currency,
                  observed: montant(a.observed, locale) + " " + pme.currency,
                })}
              </p>
            </div>
            {faite ? (
              <p className="mt-3.5 border-t border-border pt-3 text-[13px] font-medium text-signal-ok">
                {faite.par === "cabinet"
                  ? t("pme.charges.answered.cabinet")
                  : t("pme.charges.answered")}
              </p>
            ) : (
              <div className="mt-3.5 flex gap-2.5">
                <button
                  type="button"
                  disabled={answer.isPending}
                  onClick={() =>
                    answer.mutate({ familleCode: a.familleCode, reply: "exceptionnel" })
                  }
                  className="h-11 flex-1 border border-line-strong text-[14px] font-medium disabled:opacity-60"
                >
                  {t("pme.charges.answer.exceptionnel")}
                </button>
                <button
                  type="button"
                  disabled={answer.isPending}
                  onClick={() => answer.mutate({ familleCode: a.familleCode, reply: "a_verifier" })}
                  className="h-11 flex-1 border border-line-strong text-[14px] font-medium disabled:opacity-60"
                >
                  {t("pme.charges.answer.verifier")}
                </button>
              </div>
            )}
          </div>
        );
      })}

      {error ? <p className="mt-3 text-xs text-signal-warn">{error}</p> : null}

      <p className="mt-3.5 pb-6 text-[11.5px] leading-[1.5] text-muted-foreground">
        {t("pme.charges.disclaimer")}
      </p>
    </div>
  );
}
