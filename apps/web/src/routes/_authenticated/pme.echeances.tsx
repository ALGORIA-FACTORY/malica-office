import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import { usePme } from "@/components/regalica/pme-context";
import { RegalicaAvatar } from "@/components/regalica/office-ui";
import { useI18n } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { cn } from "@/lib/utils";
import { office } from "@/verticals/regalica-office/composition";

export const Route = createFileRoute("/_authenticated/pme/echeances")({
  head: () => ({
    meta: [
      { title: "Vos échéances — Regalica Office" },
      {
        name: "description",
        content: "Les dates qui viennent, annoncées à l'avance, jamais à la dernière minute.",
      },
      { property: "og:title", content: "Vos échéances — Regalica Office" },
      {
        property: "og:description",
        content: "Les dates qui viennent, annoncées à l'avance.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PmeEcheances,
});

const JOUR_MS = 86_400_000;
const OU = "routes/_authenticated/pme.echeances";

/**
 * Vos échéances — anticipé, non anxiogène.
 *
 * C'est la note du prototype, et elle commande toute la page : une échéance
 * n'est pas une alarme. Elle s'annonce, elle se prépare, et Regalica dit
 * combien de temps il reste plutôt que de crier qu'il n'en reste plus.
 *
 * D'où l'ordre : sa phrase rassurante D'ABORD, la liste ensuite. Un écran qui
 * ouvre sur une date en rouge fait fermer l'application.
 *
 * Les dates viennent de `collab.echeances`, qui les tient du pack fiscal en
 * vigueur. Aucune n'est écrite ici — c'est la dernière ligne de l'écran, et
 * elle n'est pas décorative : elle dit au dirigeant pourquoi il peut s'y fier.
 */
function PmeEcheances() {
  const { t, locale } = useI18n();
  const pme = usePme();

  // Le calendrier se dérive du pack à l'ouverture — idempotent — puis se lit.
  const derivation = useQuery({
    queryKey: ["echeances-derivation", pme.tenantId],
    queryFn: () => office().collab.deriverEcheances([pme.tenantId]),
    staleTime: 60_000,
  });
  const echeances = useQuery({
    queryKey: ["echeances", pme.tenantId],
    queryFn: () => office().collab.echeances([pme.tenantId]),
    enabled: derivation.isFetched,
  });
  const raison = derivation.data?.[0]?.raison ?? null;

  const rows = echeances.data ?? [];
  const today = new Date().toISOString().slice(0, 10);
  // Le retard se constate en base, à la dérivation : l'écran le lit, il ne le recalcule pas.
  const enRetard = rows.filter((e) => e.status === "en_retard");
  const prochaine = rows.find((e) => e.status === "a_venir") ?? null;
  const echec = derivation.error ?? echeances.error ?? null;

  const jour = (iso: string) =>
    new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", timeZone: "UTC" }).format(
      new Date(`${iso}T00:00:00Z`),
    );

  const jours = (iso: string) =>
    Math.round(
      (new Date(`${iso}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / JOUR_MS,
    );

  const phrase =
    rows.length === 0
      ? t("pme.echeances.voice.empty")
      : enRetard.length > 0
        ? t("pme.echeances.voice.late", { count: enRetard.length })
        : prochaine
          ? t("pme.echeances.voice.next", {
              label: prochaine.label,
              days: jours(prochaine.dueDate),
            })
          : t("pme.echeances.voice.empty");

  return (
    <div className="rg-rise px-1 pt-2">
      <p className="text-[24px] font-semibold leading-[1.15] tracking-[-0.025em]">
        {t("pme.echeances.title")}
      </p>

      {/* Sa parole avant la liste : le ton se donne en premier. */}
      <div className="mt-3 flex gap-3">
        <RegalicaAvatar size={32} alt="Regalica" rond />
        <p className="text-[14.5px] leading-[1.5]">{phrase}</p>
      </div>

      {raison === "fiche.absente" || raison === "fiche.incomplete" ? (
        <Link
          to="/pme/fiche"
          className="mt-4 block border border-s-2 border-border border-s-marigold bg-card px-3 py-2.5 text-[13px] leading-[1.45]"
        >
          {t(
            raison === "fiche.absente"
              ? "pme.echeances.fiche.absente"
              : "pme.echeances.fiche.incomplete",
          )}
          <span className="mt-1 block text-[11px] font-semibold uppercase tracking-[0.14em]">
            {t("pme.echeances.fiche.lien")}
          </span>
        </Link>
      ) : raison === "pack.absent" ? (
        <p
          role="alert"
          className="mt-4 block border border-s-2 border-border border-s-marigold bg-card px-3 py-2.5 text-[13px] leading-[1.45]"
        >
          {t("pme.echeances.pack.absent")}
        </p>
      ) : null}

      {echec ? (
        <p
          role="alert"
          className="mt-4 border border-s-2 border-border border-s-signal-stop px-3 py-2 text-[12.5px]"
        >
          {texteDeLErreur(echec, OU, t("common.error"))}
        </p>
      ) : null}

      {echeances.isPending && !echec ? (
        <p className="mt-6 text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : rows.length === 0 ? (
        <p className="mt-6 border border-border bg-card p-4 text-[13.5px] text-text-2">
          {t("pme.echeances.empty")}
        </p>
      ) : (
        <div className="mt-4">
          {rows.map((e, i) => {
            const retard = e.status === "en_retard";
            const deposee = e.status === "fait";
            const reste = jours(e.dueDate);
            return (
              <div
                key={e.id}
                className={cn(
                  "flex items-center justify-between gap-3 py-3.5",
                  // Le premier filet est plein : il ouvre la liste. Les autres
                  // sont légers, ils ne font que séparer.
                  i === 0 ? "border-t border-foreground" : "border-t border-border",
                )}
              >
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-[14.5px] font-medium">
                    <span
                      aria-hidden
                      className={cn(
                        "h-[5px] w-[5px] flex-none",
                        deposee
                          ? "bg-signal-ok"
                          : retard
                            ? "bg-signal-stop"
                            : reste <= 7
                              ? "bg-signal-info"
                              : "bg-line-strong",
                      )}
                    />
                    <span className="truncate">{e.label}</span>
                  </span>
                  <span className="ms-[13px] mt-[3px] block text-[12.5px] text-text-2">
                    {deposee
                      ? t("pme.echeances.sous.deposee")
                      : retard
                        ? t("pme.echeances.sous.retard", { count: Math.abs(reste) })
                        : t("pme.echeances.sous.avenir", { count: reste })}
                  </span>
                </span>
                {deposee ? (
                  <span className="flex-none text-[11.5px] font-semibold text-signal-ok">
                    {t("pme.echeances.reglee")}
                  </span>
                ) : (
                  <span className="num flex-none text-[12px] font-medium text-text-2">
                    {jour(e.dueDate)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/*
       * Pas une mention légale : la raison pour laquelle il peut s'y fier.
       * Une date écrite à la main serait une date qu'il faudrait vérifier.
       */}
      <p className="mt-[18px] border-t border-border pt-3.5 text-[11.5px] leading-[1.5] text-muted-foreground">
        {t("pme.echeances.source")}
      </p>
    </div>
  );
}
