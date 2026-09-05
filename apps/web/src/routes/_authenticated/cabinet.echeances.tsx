/**
 * Les échéances du cabinet — le calendrier de tous les mandats.
 *
 * ============================================================== POURQUOI
 *
 * Les dates viennent du pack de juridiction, jamais d'une saisie : à
 * l'ouverture, l'écran demande à la base de DÉRIVER le calendrier de chaque
 * dossier (idempotent), puis le lit. Un dossier dont la fiche ne dit pas la
 * forme juridique et le mode de dépôt n'a pas de calendrier — et l'écran le
 * dit, plutôt que de supposer un délai.
 *
 * L'expert marque une échéance faite ou la rouvre ; le retard, lui, se
 * constate en base et ne se saisit pas.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { useCabinet, useRegalicaPanel } from "@/components/regalica/cabinet-context";
import { ecrireDossierCourant, useDossierCourant } from "@/components/regalica/dossier-courant";
import { EmptyState, RegalicaNote, SectionTitle } from "@/components/regalica/office-ui";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { finDuMois } from "@regalica/socle/exercice";
import { cn } from "@/lib/utils";
import { office } from "@/verticals/regalica-office/composition";
import type { Echeance } from "@regalica/socle/ports/repositories";

export const Route = createFileRoute("/_authenticated/cabinet/echeances")({
  head: () => ({
    meta: [
      { title: "Échéances du cabinet — Regalica Office" },
      {
        name: "description",
        content:
          "Les échéances déclaratives de tous les dossiers mandatés, dérivées du pack de juridiction en vigueur.",
      },
      { property: "og:title", content: "Échéances du cabinet — Regalica Office" },
      {
        property: "og:description",
        content:
          "Les échéances déclaratives de tous les dossiers mandatés, dérivées du pack de juridiction en vigueur.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CabinetEcheances,
});

const JOUR_MS = 86_400_000;
const RAISONS: Record<string, MessageKey> = {
  "fiche.absente": "cab.echeances.raison.fiche.absente",
  "fiche.incomplete": "cab.echeances.raison.fiche.incomplete",
  "pack.absent": "cab.echeances.raison.pack.absent",
};
const OU = "routes/_authenticated/cabinet.echeances";

/** Le nombre de jours entre deux dates civiles « YYYY-MM-DD », sans fuseau. */
function joursEntre(depuis: string, jusqua: string): number {
  return Math.round(
    (new Date(`${jusqua}T00:00:00Z`).getTime() - new Date(`${depuis}T00:00:00Z`).getTime()) /
      JOUR_MS,
  );
}

function CabinetEcheances() {
  const { t, locale } = useI18n();
  const { org } = useCabinet();
  const qc = useQueryClient();
  const dossierCourant = useDossierCourant();
  const [dossier, setDossier] = useState<string>(() => dossierCourant?.id ?? "");

  const clients = useQuery({
    queryKey: ["cab-clients", org.id],
    queryFn: () => office().supervision.listClients(org.id),
  });
  const ids = useMemo(() => (clients.data ?? []).map((c) => c.tenantId), [clients.data]);
  const noms = useMemo(
    () => new Map((clients.data ?? []).map((c) => [c.tenantId, c.name] as const)),
    [clients.data],
  );
  const pack = useQuery({
    queryKey: ["ref-pack", org.jurisdiction],
    queryFn: () => office().referential.activePack(org.jurisdiction),
  });

  // Dériver d'abord — idempotent —, lire ensuite.
  const derivation = useQuery({
    queryKey: ["cab-echeances-derivation", org.id, ids],
    queryFn: () => office().collab.deriverEcheances(ids),
    enabled: ids.length > 0,
    staleTime: 60_000,
  });
  const echeances = useQuery({
    queryKey: ["cab-echeances", org.id, ids],
    queryFn: () => office().collab.echeances(ids),
    enabled: ids.length > 0 && derivation.isFetched,
  });

  const marquer = useMutation({
    mutationFn: (input: { id: string; fait: boolean }) =>
      office().collab.marquerEcheance(input.id, input.fait),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cab-echeances"] }),
  });

  const nomDe = (id: string) => noms.get(id) ?? "";
  const today = new Date().toISOString().slice(0, 10);
  const jours = (iso: string) => joursEntre(today, iso);
  const dateCourte = (iso: string) =>
    new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", timeZone: "UTC" }).format(
      new Date(`${iso}T00:00:00Z`),
    );
  const dateLongue = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${iso}T00:00:00Z`));
  const moisLong = (iso: string) =>
    new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(
      new Date(`${iso}T00:00:00Z`),
    );

  const rows = useMemo(() => {
    const toutes = echeances.data ?? [];
    const nom = (id: string) => noms.get(id) ?? "";
    return (dossier ? toutes.filter((e) => e.tenantId === dossier) : toutes)
      .slice()
      .sort((a, b) =>
        a.dueDate === b.dueDate
          ? nom(a.tenantId).localeCompare(nom(b.tenantId))
          : a.dueDate.localeCompare(b.dueDate),
      );
  }, [echeances.data, dossier, noms]);

  const enRetard = rows.filter((e) => e.status === "en_retard");
  // Sept jours : un seuil de lecture de l'écran, pas une règle du pack — le
  // rappel réglementaire, lui, se règle par obligation dans les réglages.
  const sousSept = rows.filter((e) => e.status === "a_venir" && jours(e.dueDate) <= 7);
  const faites = rows.filter((e) => e.status === "fait");
  const manques = (derivation.data ?? []).filter((d) => d.raison !== null);

  /*
   * La frise : du début du mois à l'horizon dérivé.
   *
   * L'horizon n'est pas écrit ici : c'est la base qui décide jusqu'où elle
   * dérive, et la dernière date rendue est cet horizon. Sans échéance, la
   * frise s'arrête à la fin du mois courant.
   */
  const frise = useMemo(() => {
    const debut = `${today.slice(0, 7)}-01`;
    const fin = rows.reduce(
      (h, e) => (e.dueDate > h ? e.dueDate : h),
      finDuMois(today.slice(0, 7)),
    );
    const total = joursEntre(debut, fin) || 1;
    const position = (iso: string) =>
      Math.min(100, Math.max(0, (joursEntre(debut, iso) / total) * 100));
    const parJour = new Map<string, Echeance[]>();
    for (const e of rows) {
      if (e.dueDate < debut || e.dueDate > fin) continue;
      parJour.set(e.dueDate, [...(parJour.get(e.dueDate) ?? []), e]);
    }
    const max = Math.max(1, ...[...parJour.values()].map((l) => l.length));
    const reperes = [...parJour.entries()].sort(([a], [b]) => a.localeCompare(b));
    return { debut, fin, position, reperes, max };
  }, [rows, today]);

  // Ce qui a échoué se dit ; une requête muette laisserait croire à un calendrier vide.
  const echec = [clients, derivation, echeances].find((q) => q.isError)?.error ?? null;

  useRegalicaPanel(
    <RegalicaNote kicker={t("cab.echeances.panel.kicker")}>
      {t("cab.echeances.panel", { late: enRetard.length, week: sousSept.length })}
    </RegalicaNote>,
    [enRetard.length, sousSept.length, locale],
  );

  const tonDe = (e: Echeance) =>
    e.status === "fait"
      ? "bg-signal-ok"
      : e.status === "en_retard"
        ? "bg-signal-stop"
        : jours(e.dueDate) <= 7
          ? "bg-marigold"
          : "bg-foreground";
  const etatDe = (e: Echeance) =>
    e.status === "fait"
      ? t("cab.echeances.state.fait")
      : e.status === "en_retard"
        ? t("cab.echeances.state.retard")
        : t("cab.echeances.state.avenir");
  const compteDe = (e: Echeance) => {
    const d = jours(e.dueDate);
    if (e.status === "fait") return e.faitLe ? dateCourte(e.faitLe) : "";
    if (d === 0) return t("cab.echeances.jour");
    return d < 0 ? t("cab.echeances.jplus", { days: -d }) : t("cab.echeances.jmoins", { days: d });
  };

  const chargement =
    clients.isPending || (ids.length > 0 && (derivation.isPending || echeances.isPending));

  return (
    <div className="space-y-8">
      {/* ---- masthead */}
      <header className="border-b border-foreground pb-6">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          {pack.data
            ? t("cab.echeances.kicker", { pack: `${org.jurisdiction} ${pack.data.version}` })
            : t("cab.echeances.kicker.sansPack")}
        </p>
        <h1 className="mt-2.5 text-[30px] font-semibold leading-[1.05] tracking-[-0.025em] sm:text-[38px]">
          {t("cab.echeances.title")}
        </h1>
        <p className="mt-3 max-w-[62ch] text-[13.5px] leading-[1.55] text-text-2">
          {t("cab.echeances.principe")}
        </p>
        <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
          {[
            { key: "total", label: t("cab.echeances.kpi.total"), value: rows.length },
            {
              key: "late",
              label: t("cab.echeances.kpi.late"),
              value: enRetard.length,
              alerte: enRetard.length > 0,
            },
            { key: "week", label: t("cab.echeances.kpi.week"), value: sousSept.length },
            { key: "done", label: t("cab.echeances.kpi.done"), value: faites.length },
          ].map((k) => (
            <div key={k.key}>
              <p className="text-[9.5px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {k.label}
              </p>
              <p
                className={cn(
                  "num mt-1 text-[28px] leading-none",
                  k.alerte ? "text-signal-stop" : "",
                )}
              >
                {k.value}
              </p>
            </div>
          ))}
        </div>
      </header>

      {/* ---- la frise */}
      <section className="border border-border bg-card p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <span className="text-[9.5px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {t("cab.echeances.horizon", { debut: moisLong(frise.debut), fin: moisLong(frise.fin) })}
          </span>
          <span className="num text-[10.5px] text-muted-foreground">
            {t("cab.echeances.aujourdhui", { date: dateCourte(today) })}
          </span>
        </div>
        <div className="relative mt-4 h-16 border-b border-foreground">
          {frise.reperes.map(([jour, liste], index) => (
            <span
              key={jour}
              title={liste.map((e) => `${nomDe(e.tenantId)} — ${e.label}`).join("\n")}
              className="absolute bottom-0 flex -translate-x-1/2 flex-col items-center gap-1"
              style={{ insetInlineStart: `${frise.position(jour)}%` }}
            >
              <span
                className={cn(
                  "num whitespace-nowrap text-[10px]",
                  // Deux repères voisins ne se lisent que si leurs étiquettes s'alternent.
                  index % 2 === 1 ? "-translate-y-3.5" : "",
                  liste.some((e) => e.status === "en_retard")
                    ? "text-signal-stop"
                    : "text-muted-foreground",
                )}
              >
                {dateCourte(jour)}
              </span>
              <span
                aria-hidden
                className={cn(
                  "block w-[2px]",
                  liste.some((e) => e.status === "en_retard")
                    ? "bg-signal-stop"
                    : liste.every((e) => e.status === "fait")
                      ? "bg-signal-ok"
                      : "bg-foreground",
                )}
                style={{ height: `${Math.round(8 + (liste.length / frise.max) * 40)}px` }}
              />
            </span>
          ))}
          <span
            aria-hidden
            className="absolute bottom-0 h-16 w-px bg-marigold"
            style={{ insetInlineStart: `${frise.position(today)}%` }}
          />
        </div>
        <div className="num mt-1.5 flex justify-between text-[10px] text-muted-foreground">
          <span>{dateCourte(frise.debut)}</span>
          <span>{dateCourte(frise.fin)}</span>
        </div>
      </section>

      {/* ---- le calendrier */}
      <section className="space-y-3">
        <SectionTitle
          action={
            <label className="flex items-center gap-2">
              <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {t("cab.echeances.dossier")}
              </span>
              <select
                value={dossier}
                onChange={(e) => {
                  setDossier(e.target.value);
                  const choisi = (clients.data ?? []).find((c) => c.tenantId === e.target.value);
                  if (choisi) ecrireDossierCourant({ id: choisi.tenantId, name: choisi.name });
                }}
                aria-label={t("cab.echeances.dossier")}
                className="max-w-[240px] border border-border bg-card px-2.5 py-1.5 text-[12px]"
              >
                <option value="">{t("cab.echeances.tous")}</option>
                {(clients.data ?? []).map((c) => (
                  <option key={c.tenantId} value={c.tenantId}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          }
        >
          {t("cab.echeances.calendar")}
        </SectionTitle>

        {echec ? (
          <p role="alert" className="text-[12.5px] text-signal-stop">
            {texteDeLErreur(echec, OU, t("common.error"))}
          </p>
        ) : null}
        {marquer.isError ? (
          <p role="alert" className="text-[12.5px] text-signal-stop">
            {texteDeLErreur(marquer.error, OU, t("common.error"))}
          </p>
        ) : null}

        {chargement ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : rows.length === 0 ? (
          <EmptyState>{t("cab.echeances.empty")}</EmptyState>
        ) : (
          <div className="overflow-x-auto border border-border bg-card">
            <table className="min-w-full border-collapse text-[12.5px]">
              <caption className="sr-only">{t("cab.echeances.title")}</caption>
              <thead>
                <tr className="border-b border-foreground">
                  {[
                    t("cab.echeances.col.obligation"),
                    t("cab.queue.client"),
                    t("cab.echeances.col.legal"),
                    t("cab.echeances.col.depot"),
                    t("cab.echeances.col.state"),
                    t("cab.echeances.col.action"),
                  ].map((h, i) => (
                    <th
                      key={h}
                      scope="col"
                      className={cn(
                        "px-3 py-2 text-[9.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground",
                        i === 3 ? "text-end" : "text-start",
                      )}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id} className="border-b border-border hover:bg-secondary/60">
                    <td className="whitespace-nowrap px-3 py-2 font-medium">
                      {e.label}
                      {e.period ? (
                        <span className="num block text-[10.5px] font-normal text-muted-foreground">
                          {t("cab.echeances.periode", { period: e.period })}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        to="/cabinet/dossier/$clientId"
                        params={{ clientId: e.tenantId }}
                        className="hover:underline"
                      >
                        {nomDe(e.tenantId)}
                      </Link>
                    </td>
                    <td className="min-w-[240px] px-3 py-2" title={e.texteSource ?? undefined}>
                      <span className="num block whitespace-nowrap text-[11px] text-signal-info">
                        {e.article ?? e.texteSource ?? "—"}
                      </span>
                      {e.regle ? (
                        <span className="mt-0.5 block max-w-[34ch] text-[10.5px] leading-[1.35] text-muted-foreground">
                          {e.regle}
                        </span>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-end">
                      <span className="num block text-[12px]">{dateLongue(e.dueDate)}</span>
                      <span
                        className={cn(
                          "mt-0.5 block text-[10px] font-semibold tracking-[0.06em]",
                          e.status === "en_retard"
                            ? "text-signal-stop"
                            : e.status === "fait"
                              ? "text-signal-ok"
                              : jours(e.dueDate) <= 7
                                ? "text-marigold-on-paper"
                                : "text-muted-foreground",
                        )}
                      >
                        {compteDe(e)}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          aria-hidden
                          className={cn("inline-block h-[7px] w-[7px]", tonDe(e))}
                        />
                        <span className="text-[10px] font-semibold uppercase tracking-[0.1em]">
                          {etatDe(e)}
                        </span>
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <button
                        type="button"
                        disabled={marquer.isPending}
                        onClick={() => marquer.mutate({ id: e.id, fait: e.status !== "fait" })}
                        className="border border-border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] hover:border-foreground disabled:opacity-40"
                      >
                        {e.status === "fait"
                          ? t("cab.echeances.rouvrir")
                          : t("cab.echeances.marquer")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ---- les dossiers sans calendrier */}
      {manques.length > 0 ? (
        <section className="border border-s-2 border-border border-s-marigold bg-card p-4">
          <p className="text-[9.5px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            {t("cab.echeances.manques.titre")}
          </p>
          <p className="mt-1.5 text-[12.5px] text-text-2">{t("cab.echeances.manques.lede")}</p>
          <ul className="mt-3 divide-y divide-border">
            {manques.map((m) => (
              <li key={m.tenantId} className="flex items-baseline justify-between gap-3 py-2">
                <Link
                  to="/cabinet/dossier/$clientId"
                  params={{ clientId: m.tenantId }}
                  className="text-[13px] hover:underline"
                >
                  {nomDe(m.tenantId)}
                </Link>
                <span className="text-[11px] text-muted-foreground">
                  {libelleDeLaRaison(m.raison, t)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="text-[10px] italic text-muted-foreground">{t("cab.echeances.source")}</p>
    </div>
  );
}

/** La raison pour laquelle rien n'a été dérivé, dans la langue de la personne. */
function libelleDeLaRaison(raison: string | null, t: (k: MessageKey) => string): string {
  const cle = raison ? RAISONS[raison] : undefined;
  return cle ? t(cle) : "";
}
