/**
 * Le dossier d'un client — sa synthèse.
 *
 * ============================================================== POURQUOI
 *
 * Le lieu qu'on visite : un masthead qui situe le mandat (exercice, début,
 * pack), quatre chiffres du Socle, le compte de résultat en cumul
 * d'exercice, les pièces récentes, les feux de conformité et le journal du
 * mandat. Les moteurs tournent dans `useSyntheseClient` ; l'écran lit.
 */
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { useCabinet, useMalicaPanel } from "@/components/malica/cabinet-context";
import { ecrireDossierCourant } from "@/components/malica/dossier-courant";
import { EmptyState, MalicaNote, SectionTitle } from "@/components/malica/office-ui";
import { useSyntheseClient } from "@/hooks/use-synthese-client";
import { useI18n } from "@/i18n";
import { libelleDeLAction } from "@/lib/champ-lisible";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { finDuMois } from "@malica/socle/exercice";
import { montant } from "@/lib/lisible";
import { cn } from "@/lib/utils";
import { office } from "@/verticals/malica-office/composition";

import { QueueTable } from "./cabinet.index";

export const Route = createFileRoute("/_authenticated/cabinet/dossier/$clientId")({
  head: () => ({
    meta: [
      { title: "Dossier client — Malica Office" },
      {
        name: "description",
        content:
          "La synthèse d'un dossier mandaté : compte de résultat, TVA du mois, pièces, feux de conformité et journal du mandat.",
      },
      { property: "og:title", content: "Dossier client — Malica Office" },
      {
        property: "og:description",
        content: "Compte de résultat, TVA, pièces et journal d'un dossier mandaté.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CabinetClient,
});

const JOUR_MS = 86_400_000;
const OU = "routes/_authenticated/cabinet.dossier";

function CabinetClient() {
  const { clientId } = Route.useParams();
  const { t, locale } = useI18n();
  const { org } = useCabinet();
  const [periode, setPeriode] = useState(() => new Date().toISOString().slice(0, 7));

  const clients = useQuery({
    queryKey: ["cab-clients", org.id],
    queryFn: () => office().supervision.listClients(org.id),
  });
  const client = (clients.data ?? []).find((c) => c.tenantId === clientId) ?? null;

  useEffect(() => {
    if (client) ecrireDossierCourant({ id: client.tenantId, name: client.name });
  }, [client]);

  const queue = useQuery({
    queryKey: ["cab-queue", org.id, clientId],
    queryFn: () => office().supervision.queue(org.id, clientId),
  });
  const echeances = useQuery({
    queryKey: ["cab-echeances", org.id, [clientId]],
    queryFn: () => office().collab.echeances([clientId]),
  });
  const journal = useQuery({
    queryKey: ["cab-journal", clientId],
    queryFn: () => office().supervision.journalDuMandat(clientId),
  });
  const synthese = useSyntheseClient(client, periode);
  const affectations = useQuery({
    queryKey: ["cab-assignments", org.id],
    queryFn: () => office().collab.assignments(org.id),
  });
  const membres = useQuery({
    queryKey: ["cab-members", org.id],
    queryFn: () => office().collab.members(org.id),
  });
  // Le briefing qui a accompagné le dernier transfert du dossier.
  const affectation =
    (affectations.data ?? []).find((a) => a.active && a.clientTenantId === clientId) ?? null;

  useMalicaPanel(<MalicaNote>{t("cab.dos.panel")}</MalicaNote>, [locale]);

  const rows = queue.data ?? [];
  const aSuperviser = rows.filter((r) => r.status === "comptabilisee");
  const duMois = rows.filter((r) => r.createdAt.slice(0, 7) === periode).length;
  // Trente jours : la fenêtre de lecture du feu, telle que son libellé la dit — pas une règle du pack.
  const proches = useMemo(() => {
    const maintenant = Date.now();
    return (echeances.data ?? []).filter((e) => {
      const d = new Date(e.dueDate).getTime();
      return d >= maintenant - JOUR_MS && d <= maintenant + 30 * JOUR_MS;
    });
  }, [echeances.data]);

  const dateLisible = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso));
  const fin = finDuMois(periode);

  if (clients.isPending) {
    return <p className="text-sm text-muted-foreground">{t("common.loading")}</p>;
  }
  if (clients.isError) {
    return (
      <p role="alert" className="text-[12.5px] text-signal-stop">
        {texteDeLErreur(clients.error, OU, t("common.error"))}
      </p>
    );
  }
  if (!client) {
    return <EmptyState>{t("cab.clients.empty")}</EmptyState>;
  }

  // La devise est celle du dossier, jamais un repli (R4).
  const devise = client.currency;
  const pnl = synthese.pnl;
  const tva = synthese.tva;
  const kpis = [
    {
      key: "ca",
      label: t("cab.dos.kpi.ca"),
      value: pnl ? montant(pnl.produits, locale) : "—",
      ctx: t("cab.dos.kpi.ca.ctx"),
    },
    {
      key: "res",
      label: t("cab.dos.kpi.resultat"),
      value: pnl ? montant(pnl.resultat, locale) : "—",
      ctx: t("cab.dos.kpi.resultat.ctx"),
    },
    {
      key: "tva",
      label: t("cab.dos.kpi.tva"),
      value: tva ? montant(tva.totals.solde, locale) : "—",
      ctx: t("cab.dos.kpi.tva.ctx"),
    },
    {
      key: "pieces",
      label: t("cab.dos.kpi.pieces"),
      value: String(duMois),
      ctx: t("cab.dos.kpi.pieces.ctx"),
    },
  ];
  const parCompte = (pnl?.by_account ?? []).filter(
    (a) => a.solde !== "0" && !/^0(\.0+)?$/.test(a.solde),
  );
  // Le nombre flottant ne sert qu'à proportionner les barres ; le montant
  // affiché reste la chaîne décimale du moteur, sans arrondi de l'écran.
  const maxSolde = Math.max(1, ...parCompte.map((a) => Math.abs(Number(a.solde))));

  return (
    <div className="space-y-8">
      {/* ---- masthead */}
      <header className="-mx-4 -mt-6 bg-foreground px-4 py-8 text-background sm:-mx-6 sm:px-6 lg:-mx-9 lg:-mt-7 lg:px-10 lg:py-9">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-marigold-on-ink">
              {t("cab.dos.kicker", { date: dateLisible(fin) })}
            </p>
            <h1 className="mt-2 text-[32px] font-semibold leading-[1.02] tracking-[-0.03em] sm:text-[42px] lg:text-[54px]">
              {client.name}
            </h1>
            <p className="num mt-3 text-[13px] text-background/70">
              {t("cab.dos.sous", {
                cloture: synthese.clotureConnue
                  ? dateLisible(synthese.debutExercice)
                  : t("cab.dos.cloture.inconnue"),
                depuis: client.mandatDepuis
                  ? dateLisible(client.mandatDepuis)
                  : t("cab.dos.depuis.inconnu"),
                pack: synthese.pack
                  ? `${client.jurisdiction} ${synthese.pack.version}`
                  : t("cab.dos.pack.inconnu"),
              })}
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-background/60">
                {t("cab.dos.mois")}
              </span>
              <input
                type="month"
                value={periode}
                onChange={(e) => e.target.value && setPeriode(e.target.value)}
                className="num border border-background/40 bg-transparent px-2 py-1.5 text-[12.5px] text-background"
              />
            </label>
            {aSuperviser[0] ? (
              <Link
                to="/cabinet/piece/$pieceId"
                params={{ pieceId: aSuperviser[0].pieceId }}
                className="border border-background bg-background px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground hover:bg-marigold-on-ink"
              >
                {t("cab.dos.superviser", { n: aSuperviser.length })}
              </Link>
            ) : null}
          </div>
        </div>
        <div className="mt-7 grid grid-cols-2 gap-x-6 gap-y-5 lg:grid-cols-4">
          {kpis.map((k) => (
            <div key={k.key}>
              <p className="text-[9.5px] font-semibold uppercase tracking-[0.18em] text-background/60">
                {k.label}
              </p>
              <p
                className={cn(
                  "num mt-1.5 text-[26px] leading-none lg:text-[32px]",
                  k.value === "—" ? "text-background/50" : "",
                )}
              >
                {k.value}
              </p>
              <p className="mt-1 text-[10.5px] text-background/60">{k.ctx}</p>
            </div>
          ))}
        </div>
      </header>

      <div className="grid gap-8 xl:grid-cols-[1.7fr_1fr]">
        <div className="min-w-0 space-y-8">
          {/* ---- le compte de résultat */}
          <section className="space-y-3">
            <SectionTitle
              action={
                <span className="num text-[10.5px] text-muted-foreground">
                  {t("cab.dos.pnl.source")}
                </span>
              }
            >
              {t("cab.dos.pnl.titre", { date: dateLisible(fin) })}
            </SectionTitle>
            {synthese.erreur !== null ? (
              <p role="alert" className="text-[12.5px] text-signal-stop">
                {texteDeLErreur(synthese.erreur, OU, t("common.error"))}
              </p>
            ) : synthese.chargement ? (
              <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
            ) : !pnl ? (
              <EmptyState>{t("cab.dos.pnl.vide")}</EmptyState>
            ) : (
              <div className="border border-border bg-card">
                <ul className="divide-y divide-border">
                  {parCompte.map((a) => {
                    // Le moteur pose le solde en débit moins crédit : un solde
                    // créditeur (négatif) est un produit, un débiteur une charge.
                    const produit = a.solde.startsWith("-");
                    const valeur = a.solde.replace(/^-/, "");
                    return (
                      <li key={a.account_code} className="px-4 py-2.5">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="min-w-0 truncate text-[13px]">
                            <span className="num text-muted-foreground">{a.account_code}</span>{" "}
                            {a.label || "—"}
                          </span>
                          <span className="num text-[13px]">{montant(valeur, locale)}</span>
                        </div>
                        <span aria-hidden className="mt-1 block h-[3px] w-full bg-secondary">
                          <span
                            className={cn("block h-full", produit ? "bg-foreground" : "bg-chart-3")}
                            style={{
                              width: `${Math.round((Math.abs(Number(a.solde)) / maxSolde) * 100)}%`,
                            }}
                          />
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <div className="grid grid-cols-3 gap-3 border-t border-foreground px-4 py-3">
                  {[
                    [t("cab.dos.pnl.produits"), pnl.produits],
                    [t("cab.dos.pnl.charges"), pnl.charges],
                    [t("cab.dos.pnl.resultat"), pnl.resultat],
                  ].map(([label, valeur]) => (
                    <span key={label}>
                      <span className="block text-[9.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                        {label}
                      </span>
                      <span className="num block text-[15px] font-semibold">
                        {montant(valeur!, locale)} {devise}
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* ---- les pièces récentes */}
          <section className="space-y-3">
            <SectionTitle>{t("cab.dos.pieces.titre")}</SectionTitle>
            {queue.isPending ? (
              <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
            ) : queue.isError ? (
              <p role="alert" className="text-[12.5px] text-signal-stop">
                {texteDeLErreur(queue.error, OU, t("common.error"))}
              </p>
            ) : rows.length === 0 ? (
              <EmptyState>{t("cab.dos.pieces.vide")}</EmptyState>
            ) : (
              <QueueTable rows={rows.slice(0, 8)} />
            )}
          </section>
        </div>

        <aside className="space-y-8">
          {/* ---- les feux */}
          <section className="border border-border bg-card p-4">
            <p className="text-[9.5px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              {t("cab.dos.feux.titre")}
            </p>
            <ul className="mt-3 space-y-2.5">
              {[
                {
                  label: t("cab.dos.feux.superviser"),
                  n: client.counts.comptabilisee,
                  tone: "warn",
                },
                { label: t("cab.dos.feux.retournees"), n: client.counts.retournee, tone: "stop" },
                { label: t("cab.dos.feux.nonLues"), n: client.counts.capturee, tone: "neutral" },
                { label: t("cab.dos.feux.echeances"), n: proches.length, tone: "warn" },
              ].map((f) => (
                <li key={f.label} className="flex items-baseline gap-2.5">
                  <span
                    aria-hidden
                    className={cn(
                      "mt-1 h-[7px] w-[7px] shrink-0",
                      f.n === 0
                        ? "bg-signal-ok"
                        : f.tone === "stop"
                          ? "bg-signal-stop"
                          : f.tone === "warn"
                            ? "bg-marigold"
                            : "bg-border",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px]">{f.label}</span>
                    <span className="num block text-[11px] text-muted-foreground">
                      {f.n === 0
                        ? t("cab.dos.feux.aucune")
                        : t("cab.dos.feux.pieces", { count: f.n })}
                    </span>
                  </span>
                </li>
              ))}
              <li className="flex items-baseline gap-2.5">
                <span
                  aria-hidden
                  className={cn(
                    "mt-1 h-[7px] w-[7px] shrink-0",
                    tva ? "bg-signal-ok" : "bg-border",
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px]">{t("cab.dos.feux.tva")}</span>
                  <span className="num block text-[11px] text-muted-foreground">
                    {tva
                      ? t("cab.dos.feux.tva.calculee", {
                          n: tva.collectee.length + tva.deductible.length,
                        })
                      : t("cab.dos.feux.tva.sans")}
                  </span>
                </span>
              </li>
            </ul>
          </section>

          {/* ---- le briefing du dossier */}
          <section className="border border-border bg-card p-4">
            <p className="text-[9.5px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              {t("cab.dos.briefing.titre")}
            </p>
            {affectation?.briefing ? (
              <>
                <p className="num mt-1 text-[10.5px] text-muted-foreground">
                  {t("cab.dos.briefing.pour", {
                    email:
                      (membres.data ?? []).find((m) => m.userId === affectation.collaboratorId)
                        ?.email ?? "—",
                    date: dateLisible(affectation.createdAt),
                  })}
                </p>
                <p className="mt-2 whitespace-pre-line text-[12.5px] leading-[1.5]">
                  {affectation.briefing}
                </p>
              </>
            ) : (
              <p className="mt-1 text-[12px] text-muted-foreground">{t("cab.dos.briefing.vide")}</p>
            )}
          </section>

          {/* ---- le journal */}
          <section className="space-y-3">
            <SectionTitle>{t("cab.dos.journal.titre")}</SectionTitle>
            {journal.isPending ? (
              <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
            ) : journal.isError ? (
              <p role="alert" className="text-[12.5px] text-signal-stop">
                {texteDeLErreur(journal.error, OU, t("common.error"))}
              </p>
            ) : journal.data.length === 0 ? (
              <EmptyState>{t("cab.dos.journal.vide")}</EmptyState>
            ) : (
              <ol className="divide-y divide-border border border-border bg-card">
                {journal.data.map((j) => (
                  <li key={j.id} className="flex items-baseline justify-between gap-3 px-3 py-2">
                    <span className="min-w-0 text-[12.5px]">{libelleDeLAction(j.action, t)}</span>
                    <span className="num shrink-0 text-[10.5px] text-muted-foreground">
                      {new Intl.DateTimeFormat(locale, {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      }).format(new Date(j.at))}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
