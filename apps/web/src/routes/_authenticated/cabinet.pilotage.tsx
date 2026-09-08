/**
 * Pilotage — la charge et le rendement du cabinet sur le même axe.
 *
 * ============================================================== POURQUOI
 *
 * Le design fond deux anciens écrans — l'affectation et les statistiques —
 * en un seul : qui porte quoi, ce que cela produit, et où la file s'accumule.
 * Deux vues : la charge par collaborateur (avec la matrice clients × collab
 * et le geste d'affecter), les statistiques (supervisées par mois, motifs de
 * retour, production du Socle).
 *
 * Aucun chiffre n'est calculé ici au-delà d'un compte ou d'un rapport entre
 * deux comptes ; les agrégats viennent de l'API (`supervision.statistiques`,
 * `collab.stats`), et la capacité de référence est un réglage du cabinet.
 * Les états (« Surcharge », « À suivre ») se déduisent de ces réglages et
 * de la moyenne du cabinet, jamais d'un seuil écrit ici.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { useCabinet, useMalicaPanel } from "@/components/malica/cabinet-context";
import {
  EmptyState,
  InkCell,
  InkTable,
  InkTableRow,
  MalicaNote,
  SectionTitle,
} from "@/components/malica/office-ui";
import { useI18n, type MessageKey } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { initialesDe } from "@/lib/initiales";
import { etatDeCharge, santeDuMandat, tauxDeRetour } from "@/lib/pilotage";
import { cn } from "@/lib/utils";
import { office } from "@/verticals/malica-office/composition";
import type { ClientStats, ClientSummary } from "@malica/socle/ports/repositories";

export const Route = createFileRoute("/_authenticated/cabinet/pilotage")({
  head: () => ({
    meta: [
      { title: "Pilotage — cabinet — Malica Office" },
      {
        name: "description",
        content:
          "La charge et le rendement du cabinet : qui porte quoi, ce que le Socle produit, où la file s'accumule.",
      },
      { property: "og:title", content: "Pilotage — cabinet — Malica Office" },
      {
        property: "og:description",
        content: "Charge par collaborateur, affectations, statistiques du cabinet.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CabinetPilotage,
});

type Vue = "charge" | "stats";

function CabinetPilotage() {
  const { t, locale } = useI18n();
  const { org } = useCabinet();
  const qc = useQueryClient();
  const [vue, setVue] = useState<Vue>("charge");

  const clients = useQuery({
    queryKey: ["cab-clients", org.id],
    queryFn: () => office().supervision.listClients(org.id),
  });
  const membres = useQuery({
    queryKey: ["cab-members", org.id],
    queryFn: () => office().collab.members(org.id),
  });
  const affectations = useQuery({
    queryKey: ["cab-assignments", org.id],
    queryFn: () => office().collab.assignments(org.id),
  });
  const reglages = useQuery({
    queryKey: ["cab-reglages", org.id],
    queryFn: () => office().parametrage.reglagesCabinet(org.id),
  });
  const clientIds = useMemo(() => (clients.data ?? []).map((c) => c.tenantId), [clients.data]);
  const stats = useQuery({
    queryKey: ["cab-stats", org.id, clientIds],
    queryFn: () => office().collab.stats(clientIds),
    enabled: clientIds.length > 0,
  });
  const statistiques = useQuery({
    queryKey: ["cab-statistiques", org.id, locale],
    queryFn: () => office().supervision.statistiques(org.id, locale),
  });

  useMalicaPanel(<MalicaNote>{t("cab.pil.panel")}</MalicaNote>, [locale]);

  const statsDe = useMemo(
    () => new Map((stats.data ?? []).map((s) => [s.tenantId, s])),
    [stats.data],
  );
  const emailDe = useMemo(
    () => new Map((membres.data ?? []).map((m) => [m.userId, m.email])),
    [membres.data],
  );
  /* ---- l'affectation active de chaque client */
  const collabDe = useMemo(() => {
    const carte = new Map<string, string>();
    for (const a of (affectations.data ?? []).filter((x) => x.active)) {
      if (!carte.has(a.clientTenantId)) carte.set(a.clientTenantId, a.collaboratorId);
    }
    return carte;
  }, [affectations.data]);

  /* ---- la charge par collaborateur */
  const capacite = reglages.data?.capaciteDossiers ?? null;
  const parCollab = useMemo(() => {
    return (membres.data ?? []).map((m) => {
      const mandats = (clients.data ?? []).filter((c) => collabDe.get(c.tenantId) === m.userId);
      const s = mandats
        .map((c) => statsDe.get(c.tenantId))
        .filter((x): x is ClientStats => Boolean(x));
      const pieces = s.reduce((n, x) => n + x.pieces, 0);
      const retournees = s.reduce((n, x) => n + x.retournees, 0);
      const heures = s.filter((x) => x.heuresMoyennes > 0);
      return {
        userId: m.userId,
        email: m.email,
        mandats,
        attente: mandats.reduce((n, c) => n + c.counts.comptabilisee, 0),
        traitees: s.reduce((n, x) => n + x.supervisees, 0),
        delai: heures.length
          ? heures.reduce((n, x) => n + x.heuresMoyennes, 0) / heures.length
          : null,
        retour: pieces > 0 ? retournees / pieces : null,
      };
    });
  }, [membres.data, clients.data, collabDe, statsDe]);
  const sansCollab = (clients.data ?? []).filter((c) => !collabDe.has(c.tenantId));
  const charges = parCollab.map((c) => c.mandats.length);
  const ecart = charges.length ? Math.max(...charges) - Math.min(...charges) : 0;
  const totalPieces = (stats.data ?? []).reduce((n, s) => n + s.pieces, 0);
  const totalRetours = (stats.data ?? []).reduce((n, s) => n + s.retournees, 0);
  const tauxCabinet = totalPieces > 0 ? totalRetours / totalPieces : 0;

  /* ---- affecter */
  const [clientId, setClientId] = useState("");
  const [userId, setUserId] = useState("");
  const [briefing, setBriefing] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [fait, setFait] = useState(false);
  // Malica rédige le briefing depuis les faits du dossier ; l'expert relit et complète.
  const redaction = useMutation({
    mutationFn: () =>
      office().malica.redigerLeBriefing({
        cabinetId: org.id,
        clientId,
        collaborateur: emailDe.get(userId) ?? "",
        langue: locale,
      }),
    onSuccess: (r) => {
      setErreur(null);
      setBriefing(r.texte);
    },
    onError: (e: unknown) =>
      setErreur(
        texteDeLErreur(
          e,
          "routes/_authenticated/cabinet.pilotage",
          t("cab.pil.affecter.rediger.erreur"),
        ),
      ),
  });
  const affecter = useMutation({
    mutationFn: () =>
      office().collab.assign({
        cabinetTenantId: org.id,
        clientTenantId: clientId,
        collaboratorId: userId,
        briefing: briefing.trim() || null,
      }),
    onSuccess: async () => {
      setErreur(null);
      setFait(true);
      setBriefing("");
      // La file du jour porte le collaborateur de chaque dossier : elle change aussi.
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["cab-assignments", org.id] }),
        qc.invalidateQueries({ queryKey: ["cab-queue", org.id] }),
      ]);
    },
    onError: (e: unknown) =>
      setErreur(texteDeLErreur(e, "routes/_authenticated/cabinet.pilotage", t("common.error"))),
  });

  const pourcent = (v: number) => `${Math.round(v * 100)} %`;
  const heures = (h: number | null) =>
    h === null
      ? t("cab.pil.stats.sans")
      : h < 1
        ? t("cab.pil.stats.moinsUneHeure")
        : t("cab.pil.stats.heures", { h: Math.round(h) });
  const nomDuClient = (id: string) =>
    (clients.data ?? []).find((c) => c.tenantId === id)?.name ?? "—";
  const jour = (iso: string) =>
    new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", year: "numeric" }).format(
      new Date(iso),
    );

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="num text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            {t("cab.pil.kicker", {
              count: (membres.data ?? []).length,
              collabs: (membres.data ?? []).length,
              mandats: (clients.data ?? []).length,
            })}
          </p>
          <h1 className="mt-1 text-[30px] font-semibold leading-tight tracking-[-0.025em]">
            {t("cab.nav.pilotage")}
          </h1>
          <p className="mt-1 max-w-[62ch] text-[13.5px] leading-[1.5] text-text-2">
            {t("cab.pil.doctrine")}
          </p>
        </div>
        <div className="flex border border-border">
          {(
            [
              ["charge", "cab.pil.vue.charge"],
              ["stats", "cab.pil.vue.stats"],
            ] as Array<[Vue, MessageKey]>
          ).map(([v, cle]) => (
            <button
              key={v}
              type="button"
              onClick={() => setVue(v)}
              aria-pressed={vue === v}
              className={cn(
                "px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em]",
                vue === v ? "bg-foreground text-background" : "bg-card hover:bg-accent",
              )}
            >
              {t(cle)}
            </button>
          ))}
        </div>
      </header>

      {/* ---- les chiffres */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          {
            key: "ecart",
            label: t("cab.pil.kpi.ecart"),
            value: String(ecart),
            ctx: t("cab.pil.kpi.ecart.ctx"),
          },
          {
            key: "sans",
            label: t("cab.pil.kpi.sans"),
            value: String(sansCollab.length),
            ctx: t("cab.pil.kpi.sans.ctx"),
          },
          {
            key: "delai",
            label: t("cab.pil.kpi.delai"),
            value: heures(statistiques.data?.socle.delaiMedianHeures ?? null),
            ctx: t("cab.pil.kpi.delai.ctx"),
          },
          {
            key: "sup",
            label: t("cab.pil.kpi.supervisees"),
            value: String(statistiques.data?.socle.comptabilisees ?? 0),
            ctx: t("cab.pil.kpi.supervisees.ctx"),
          },
        ].map((k) => (
          <div key={k.key} className="border border-border bg-card px-4 py-4">
            <p className="text-[9.5px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {k.label}
            </p>
            <p className="num mt-1.5 text-[28px] leading-none">{k.value}</p>
            <p className="mt-1.5 text-[11px] text-muted-foreground">{k.ctx}</p>
          </div>
        ))}
      </div>

      {vue === "charge" ? (
        <>
          {/* ---- la charge par collaborateur */}
          <section className="space-y-3">
            <SectionTitle
              action={
                capacite !== null ? (
                  <span className="num text-[11px] text-muted-foreground">
                    {t("cab.pil.charge.capacite", { count: capacite })}
                  </span>
                ) : null
              }
            >
              {t("cab.pil.charge.titre")}
            </SectionTitle>
            {parCollab.length === 0 ? (
              <EmptyState>{t("cab.pil.charge.aucun")}</EmptyState>
            ) : (
              <ul className="grid gap-3 xl:grid-cols-2">
                {parCollab.map((c) => {
                  const etat = capacite !== null ? etatDeCharge(c.mandats.length, capacite) : null;
                  const part = capacite ? Math.min(1, c.mandats.length / capacite) : 0;
                  return (
                    <li key={c.userId} className="border border-border bg-card p-4">
                      <div className="flex flex-wrap items-start gap-3">
                        <span className="num flex h-8 w-8 shrink-0 items-center justify-center bg-foreground text-[11px] font-semibold text-background">
                          {initialesDe(c.email)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-baseline gap-2">
                            <span className="truncate text-[14px] font-semibold">{c.email}</span>
                            {etat ? (
                              <span
                                className={cn(
                                  "text-[9.5px] font-semibold uppercase tracking-[0.14em]",
                                  etat === "cab.pil.etat.surcharge"
                                    ? "text-signal-stop"
                                    : "text-muted-foreground",
                                )}
                              >
                                {t(etat)}
                              </span>
                            ) : null}
                          </p>
                          <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
                            {c.mandats.map((m) => m.name).join(" · ") || "—"}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setUserId(c.userId);
                            document
                              .getElementById("affecter")
                              ?.scrollIntoView({ behavior: "smooth" });
                          }}
                          className="border border-border bg-card px-2.5 py-1.5 text-[9.5px] font-semibold uppercase tracking-[0.14em] hover:bg-accent"
                        >
                          {t("cab.pil.charge.affecter")}
                        </button>
                      </div>
                      <div className="mt-3 grid grid-cols-5 gap-2">
                        {[
                          [t("cab.pil.m.dossiers"), String(c.mandats.length)],
                          [t("cab.pil.m.attente"), String(c.attente)],
                          [t("cab.pil.m.traitees"), String(c.traitees)],
                          [t("cab.pil.m.delai"), heures(c.delai)],
                          [t("cab.pil.m.retour"), c.retour === null ? "—" : pourcent(c.retour)],
                        ].map(([label, valeur]) => (
                          <span key={label}>
                            <span className="num block text-[15px] font-semibold">{valeur}</span>
                            <span className="block text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                              {label}
                            </span>
                          </span>
                        ))}
                      </div>
                      {capacite !== null ? (
                        <div className="mt-3">
                          <span aria-hidden className="block h-[3px] w-full bg-secondary">
                            <span
                              className={cn(
                                "block h-full",
                                c.mandats.length > capacite ? "bg-signal-stop" : "bg-foreground",
                              )}
                              style={{ width: `${Math.round(part * 100)}%` }}
                            />
                          </span>
                          <span className="num mt-1 block text-[10.5px] text-muted-foreground">
                            {t("cab.pil.charge.jauge", {
                              pct: Math.round((c.mandats.length / capacite) * 100),
                            })}
                          </span>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* ---- la matrice */}
          <section className="space-y-3">
            <SectionTitle
              action={
                <span className="text-[11px] text-muted-foreground">
                  {t("cab.pil.matrice.hint")}
                </span>
              }
            >
              {t("cab.pil.matrice.titre")}
            </SectionTitle>
            <InkTable
              caption={t("cab.pil.matrice.titre")}
              head={[
                t("cab.pil.matrice.collab"),
                t("cab.pil.matrice.mandat"),
                t("cab.pil.m.attente"),
                t("cab.pil.m.traitees"),
                t("cab.pil.m.delai"),
                t("cab.pil.matrice.sante"),
              ]}
            >
              {[
                ...parCollab.flatMap((c) =>
                  c.mandats.map((m, i) => ({ collab: c.email, premier: i === 0, m })),
                ),
                ...sansCollab.map((m, i) => ({ collab: null, premier: i === 0, m })),
              ].map(({ collab, premier, m }) => {
                const s = statsDe.get(m.tenantId);
                const taux = tauxDeRetour(s);
                return (
                  <LigneMatrice
                    key={`${collab ?? "sans"}-${m.tenantId}`}
                    collab={collab}
                    premier={premier}
                    client={m}
                    attente={m.counts.comptabilisee}
                    traitees={s?.supervisees ?? 0}
                    delai={heures(s && s.heuresMoyennes > 0 ? s.heuresMoyennes : null)}
                    sante={t(santeDuMandat(taux, tauxCabinet))}
                    aSuivre={santeDuMandat(taux, tauxCabinet) === "cab.pil.sante.suivre"}
                  />
                );
              })}
            </InkTable>
          </section>

          {/* ---- affecter */}
          <section id="affecter" className="space-y-3">
            <SectionTitle>{t("cab.pil.affecter.titre")}</SectionTitle>
            <p className="max-w-[62ch] text-[12.5px] leading-[1.5] text-text-2">
              {t("cab.pil.affecter.doctrine")}
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (clientId && userId) affecter.mutate();
              }}
              className="grid gap-3 border border-border bg-card p-4 md:grid-cols-[1fr_1fr_2fr_auto]"
            >
              <label className="block">
                <span className="text-[9.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  {t("cab.pil.affecter.client")}
                </span>
                <select
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  required
                  className="mt-1 w-full border border-border bg-background px-2 py-1.5 text-[12.5px]"
                >
                  <option value="">—</option>
                  {(clients.data ?? []).map((c) => (
                    <option key={c.tenantId} value={c.tenantId}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-[9.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  {t("cab.pil.affecter.collab")}
                </span>
                <select
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  required
                  className="mt-1 w-full border border-border bg-background px-2 py-1.5 text-[12.5px]"
                >
                  <option value="">—</option>
                  {(membres.data ?? []).map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.email}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-[9.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  {t("cab.pil.affecter.briefing")}
                </span>
                <textarea
                  value={briefing}
                  onChange={(e) => setBriefing(e.target.value)}
                  rows={5}
                  className="mt-1 w-full border border-border bg-background px-2 py-1.5 text-[12.5px] leading-[1.5]"
                />
                <button
                  type="button"
                  disabled={!clientId || !userId || redaction.isPending}
                  onClick={() => redaction.mutate()}
                  className="mt-2 border border-border px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] hover:border-foreground disabled:opacity-40"
                >
                  {redaction.isPending
                    ? t("cab.pil.affecter.rediger.attente")
                    : t("cab.pil.affecter.rediger")}
                </button>
                {redaction.isSuccess && briefing ? (
                  <p className="mt-1 text-[11px] text-signal-ok">{t("cab.pil.affecter.redige")}</p>
                ) : null}
              </label>
              <button
                type="submit"
                disabled={!clientId || !userId || affecter.isPending}
                className="self-end border border-foreground bg-foreground px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-background disabled:opacity-40"
              >
                {t("cab.pil.affecter.submit")}
              </button>
            </form>
            {fait ? (
              <p className="text-[12.5px] text-signal-ok">{t("cab.pil.affecter.fait")}</p>
            ) : null}
            {erreur ? <p className="text-[12.5px] text-signal-warn">{erreur}</p> : null}
          </section>

          <section className="space-y-3">
            <SectionTitle>{t("cab.pil.journal.titre")}</SectionTitle>
            {(affectations.data ?? []).length === 0 ? (
              <EmptyState>{t("cab.pil.journal.vide")}</EmptyState>
            ) : (
              <InkTable
                caption={t("cab.pil.journal.titre")}
                head={[
                  t("cab.pil.journal.date"),
                  t("cab.pil.affecter.client"),
                  t("cab.pil.affecter.collab"),
                  t("cab.pil.affecter.briefing"),
                  t("cab.pil.journal.etat"),
                ]}
              >
                {(affectations.data ?? []).map((a) => (
                  <InkTableRow key={a.id}>
                    <InkCell numeric>{jour(a.createdAt)}</InkCell>
                    <InkCell>{nomDuClient(a.clientTenantId)}</InkCell>
                    <InkCell>{emailDe.get(a.collaboratorId) ?? "—"}</InkCell>
                    <InkCell>{a.briefing ?? "—"}</InkCell>
                    <InkCell>
                      {a.active ? t("cab.pil.journal.active") : t("cab.pil.journal.passee")}
                    </InkCell>
                  </InkTableRow>
                ))}
              </InkTable>
            )}
          </section>
        </>
      ) : (
        <Statistiques
          parMois={statistiques.data?.parMois ?? []}
          motifs={statistiques.data?.motifsDeRetour ?? []}
          socle={statistiques.data?.socle ?? null}
          heures={heures}
          locale={locale}
        />
      )}
    </div>
  );
}

function LigneMatrice({
  collab,
  premier,
  client,
  attente,
  traitees,
  delai,
  sante,
  aSuivre,
}: {
  collab: string | null;
  premier: boolean;
  client: ClientSummary;
  attente: number;
  traitees: number;
  delai: string;
  sante: string;
  aSuivre: boolean;
}) {
  const { t } = useI18n();
  return (
    <InkTableRow>
      <InkCell>
        {premier ? (
          collab ? (
            <span className="flex items-center gap-1.5 text-[12px]">
              <span className="num bg-foreground px-1 text-[9px] text-background">
                {initialesDe(collab)}
              </span>
              <span className="truncate">{collab}</span>
            </span>
          ) : (
            <span className="text-[12px] text-signal-warn">{t("cab.pil.kpi.sans")}</span>
          )
        ) : null}
      </InkCell>
      <InkCell>
        <Link
          to="/cabinet/dossier/$clientId"
          params={{ clientId: client.tenantId }}
          className="font-medium hover:underline"
        >
          {client.name}
        </Link>
      </InkCell>
      <InkCell numeric>{attente}</InkCell>
      <InkCell numeric>{traitees}</InkCell>
      <InkCell numeric>{delai}</InkCell>
      <InkCell>
        <span className={cn("text-[12px]", aSuivre ? "text-signal-warn" : "text-muted-foreground")}>
          {sante}
        </span>
      </InkCell>
    </InkTableRow>
  );
}

function Statistiques({
  parMois,
  motifs,
  socle,
  heures,
  locale,
}: {
  parMois: Array<{ mois: string; collaborateur: string | null; supervisees: number }>;
  motifs: Array<{ label: string; retours: number }>;
  socle: {
    lues: number;
    proposees: number;
    comptabilisees: number;
    delaiMedianHeures: number | null;
  } | null;
  heures: (h: number | null) => string;
  locale: string;
}) {
  const { t } = useI18n();
  const mois = [...new Set(parMois.map((p) => p.mois))].sort();
  const collabs = [...new Set(parMois.map((p) => p.collaborateur ?? ""))].sort();
  const totalDuMois = (m: string) =>
    parMois.filter((p) => p.mois === m).reduce((n, p) => n + p.supervisees, 0);
  const max = Math.max(1, ...mois.map(totalDuMois));
  const nomDuMois = (m: string) =>
    new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(
      new Date(`${m}-01T00:00:00Z`),
    );
  const maxMotif = Math.max(1, ...motifs.map((m) => m.retours));
  const nuances = ["bg-foreground", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-chart-5"];

  return (
    <>
      <section className="space-y-3">
        <SectionTitle
          action={
            <span className="flex flex-wrap gap-3 text-[10.5px] text-muted-foreground">
              {collabs.map((c, i) => (
                <span key={c || "—"} className="flex items-center gap-1.5">
                  <span aria-hidden className={cn("h-2 w-2", nuances[i % nuances.length])} />
                  {c || "—"}
                </span>
              ))}
            </span>
          }
        >
          {t("cab.pil.stats.mois")}
        </SectionTitle>
        {mois.length === 0 ? (
          <EmptyState>{t("cab.pil.stats.mois.vide")}</EmptyState>
        ) : (
          <div className="border border-border bg-card p-4">
            <div className="flex h-40 items-end gap-2">
              {mois.map((m) => (
                <span key={m} className="flex flex-1 flex-col items-center justify-end gap-1">
                  <span className="num text-[10.5px]">{totalDuMois(m)}</span>
                  <span
                    aria-hidden
                    className="flex w-full flex-col-reverse"
                    style={{ height: `${(totalDuMois(m) / max) * 120}px` }}
                  >
                    {collabs.map((c, i) => {
                      const part =
                        parMois.find((p) => p.mois === m && (p.collaborateur ?? "") === c)
                          ?.supervisees ?? 0;
                      const total = totalDuMois(m) || 1;
                      return (
                        <span
                          key={c || "—"}
                          className={cn("block w-full", nuances[i % nuances.length])}
                          style={{ height: `${(part / total) * 100}%` }}
                        />
                      );
                    })}
                  </span>
                </span>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              {mois.map((m) => (
                <span
                  key={m}
                  className="flex-1 text-center text-[10px] uppercase tracking-[0.14em] text-muted-foreground"
                >
                  {nomDuMois(m)}
                </span>
              ))}
            </div>
          </div>
        )}
      </section>

      <div className="grid gap-8 xl:grid-cols-2">
        <section className="space-y-3">
          <SectionTitle>{t("cab.pil.stats.motifs")}</SectionTitle>
          {motifs.length === 0 ? (
            <EmptyState>{t("cab.pil.stats.motifs.vide")}</EmptyState>
          ) : (
            <ul className="space-y-3">
              {motifs.map((m) => (
                <li key={m.label}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[13px]">{m.label}</span>
                    <span className="num text-[12px]">{m.retours}</span>
                  </div>
                  <span aria-hidden className="mt-1 block h-[3px] w-full bg-secondary">
                    <span
                      className="block h-full bg-foreground"
                      style={{ width: `${Math.round((m.retours / maxMotif) * 100)}%` }}
                    />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="space-y-3">
          <SectionTitle>{t("cab.pil.stats.socle")}</SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            {[
              [t("cab.pil.stats.lues"), String(socle?.lues ?? 0)],
              [t("cab.pil.stats.proposees"), String(socle?.proposees ?? 0)],
              [t("cab.pil.stats.comptabilisees"), String(socle?.comptabilisees ?? 0)],
              [t("cab.pil.stats.delai"), heures(socle?.delaiMedianHeures ?? null)],
            ].map(([label, valeur]) => (
              <div key={label} className="border border-border bg-card px-4 py-4">
                <p className="num text-[26px] leading-none">{valeur}</p>
                <p className="mt-1.5 text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
                  {label}
                </p>
              </div>
            ))}
          </div>
          <p className="text-[11px] leading-[1.5] text-muted-foreground">
            {t("cab.today.socle.doctrine")}
          </p>
        </section>
      </div>
    </>
  );
}
