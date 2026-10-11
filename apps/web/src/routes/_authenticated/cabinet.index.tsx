/**
 * Aujourd'hui — la file du cabinet, priorisée.
 *
 * ============================================================== POURQUOI
 *
 * L'écran du design : un masthead qui salue et résume, quatre chiffres, la
 * file à gauche avec ses filtres, et à droite la charge du cabinet, les
 * échéances proches et ce que le Socle a produit sur vingt-quatre heures.
 *
 * Tout ce qui s'affiche vient de l'API : la file (`supervision.queue`, qui
 * porte déjà le montant posé par le Socle et le collaborateur affecté), les
 * affectations, les échéances. Aucun chiffre n'est calculé ici au-delà
 * d'un compte de lignes — et un compte de lignes n'est pas un montant.
 */
import { useQuery } from "@tanstack/react-query";
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
  SignalLight,
} from "@/components/malica/office-ui";
import { useI18n, type MessageKey } from "@/i18n";
import { joursDAttente, toneForStatus } from "@/lib/file-cabinet";
import { initialesDe } from "@/lib/initiales";
import { montant } from "@/lib/lisible";
import { cn } from "@/lib/utils";
import { office } from "@/verticals/malica-office/composition";
import type { QueueItem } from "@malica/socle/ports/repositories";

export const Route = createFileRoute("/_authenticated/cabinet/")({
  head: () => ({
    meta: [
      { title: "Aujourd'hui — cabinet — Malica Office" },
      {
        name: "description",
        content: "La file priorisée du jour, la charge du cabinet et les échéances proches.",
      },
      { property: "og:title", content: "Aujourd'hui — cabinet — Malica Office" },
      {
        property: "og:description",
        content: "La file priorisée du jour, la charge du cabinet et les échéances proches.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CabinetToday,
});

type Filtre = "tout" | "comptabilisee" | "retournee" | "supervisee";

const JOUR_MS = 86_400_000;

function CabinetToday() {
  const { t, locale } = useI18n();
  const { org } = useCabinet();

  const clients = useQuery({
    queryKey: ["cab-clients", org.id],
    queryFn: () => office().supervision.listClients(org.id),
  });
  const queue = useQuery({
    queryKey: ["cab-queue", org.id],
    queryFn: () => office().supervision.queue(org.id),
  });
  const membres = useQuery({
    queryKey: ["cab-members", org.id],
    queryFn: () => office().collab.members(org.id),
  });
  const affectations = useQuery({
    queryKey: ["cab-assignments", org.id],
    queryFn: () => office().collab.assignments(org.id),
  });
  const clientIds = useMemo(() => (clients.data ?? []).map((c) => c.tenantId), [clients.data]);
  const echeances = useQuery({
    queryKey: ["cab-echeances", org.id, clientIds],
    queryFn: () => office().collab.echeances(clientIds),
    enabled: clientIds.length > 0,
  });

  useMalicaPanel(<MalicaNote>{t("cab.malica.queue")}</MalicaNote>, [locale]);

  const rows = useMemo(() => queue.data ?? [], [queue.data]);
  const toReview = rows.filter((r) => r.status === "comptabilisee").length;
  const returned = rows.filter((r) => r.status === "retournee").length;
  const supervised = rows.filter((r) => r.status === "supervisee").length;
  const clientCount = (clients.data ?? []).length;

  /* ---- filtres : statut, collaborateur, texte */
  const [filtre, setFiltre] = useState<Filtre>("tout");
  const [collab, setCollab] = useState<string | null>(null); // null = tout le cabinet ; "" = sans
  const [texte, setTexte] = useState("");

  const collaborateurs = useMemo(() => {
    const emails = new Set<string>();
    for (const r of rows) if (r.collaborateur) emails.add(r.collaborateur);
    for (const m of membres.data ?? []) emails.add(m.email);
    return [...emails].sort();
  }, [rows, membres.data]);

  const visibles = useMemo(() => {
    const q = texte.trim().toLocaleLowerCase();
    return rows.filter((r) => {
      if (filtre !== "tout" && r.status !== filtre) return false;
      if (collab === "" && r.collaborateur) return false;
      if (collab && r.collaborateur !== collab) return false;
      if (q && !`${r.clientName} ${r.libelle ?? ""}`.toLocaleLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, filtre, collab, texte]);

  const compteParFiltre = (f: Filtre) =>
    f === "tout" ? rows.length : rows.filter((r) => r.status === f).length;

  /* ---- la charge : par collaborateur, ses mandats et ce qui attend */
  const charge = useMemo(() => {
    const parCollab = new Map<string, { mandats: number; attente: number }>();
    for (const email of collaborateurs) parCollab.set(email, { mandats: 0, attente: 0 });
    const actives = (affectations.data ?? []).filter((a) => a.active);
    const parUser = new Map((membres.data ?? []).map((m) => [m.userId, m.email]));
    for (const a of actives) {
      const email = parUser.get(a.collaboratorId);
      if (!email) continue;
      const c = parCollab.get(email) ?? { mandats: 0, attente: 0 };
      c.mandats += 1;
      parCollab.set(email, c);
    }
    for (const r of rows) {
      if (!r.collaborateur || r.status !== "comptabilisee") continue;
      const c = parCollab.get(r.collaborateur) ?? { mandats: 0, attente: 0 };
      c.attente += 1;
      parCollab.set(r.collaborateur, c);
    }
    const max = Math.max(1, ...[...parCollab.values()].map((c) => c.attente));
    return [...parCollab.entries()].map(([email, c]) => ({ email, ...c, part: c.attente / max }));
  }, [collaborateurs, affectations.data, membres.data, rows]);

  /* ---- les échéances des trente prochains jours */
  const proches = useMemo(() => {
    const maintenant = Date.now();
    return (echeances.data ?? [])
      .filter((e) => {
        const d = new Date(e.dueDate).getTime();
        return d >= maintenant - JOUR_MS && d <= maintenant + 30 * JOUR_MS;
      })
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .slice(0, 6);
  }, [echeances.data]);
  const nomDuClient = (tenantId: string) =>
    (clients.data ?? []).find((c) => c.tenantId === tenantId)?.name ?? "—";

  /* ---- le Socle, vingt-quatre heures : des comptes de lignes, rien d'autre */
  const depuisHier = Date.now() - JOUR_MS;
  const recentes = rows.filter((r) => new Date(r.createdAt).getTime() >= depuisHier);
  const socle = [
    { key: "recues", label: t("cab.today.socle.recues"), value: String(recentes.length) },
    {
      key: "lues",
      label: t("cab.today.socle.lues"),
      value: String(recentes.filter((r) => r.status !== "capturee").length),
    },
    {
      key: "comptabilisees",
      label: t("cab.today.socle.comptabilisees"),
      value: String(recentes.filter((r) => r.ecritureId !== null).length),
    },
  ];

  const today = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());
  const premiere = rows.find((r) => r.status === "comptabilisee") ?? rows[0] ?? null;

  return (
    <div className="space-y-8">
      {/* ---- masthead */}
      <header className="-mx-4 -mt-6 bg-foreground px-4 py-8 text-background sm:-mx-6 sm:px-6 lg:-mx-9 lg:-mt-7 lg:px-10 lg:py-9">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-marigold-on-ink">
              {t("cab.today.title")} · {today}
            </p>
            <h1 className="mt-2 text-[32px] font-semibold leading-[1.02] tracking-[-0.03em] sm:text-[42px] lg:text-[54px]">
              {t("cab.today.greeting")}
            </h1>
            <p className="mt-3 max-w-[62ch] text-[14.5px] leading-[1.5] text-background/80">
              {t("cab.today.summary", { pieces: rows.length, clients: clientCount })}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              to="/cabinet/propositions"
              className="border border-background px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] hover:bg-background hover:text-foreground"
            >
              {t("cab.today.bulk")}
            </Link>
            {premiere ? (
              <Link
                to="/cabinet/piece/$pieceId"
                params={{ pieceId: premiere.pieceId }}
                className="border border-background bg-background px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground hover:bg-marigold-on-ink"
              >
                {t("cab.today.openFirst")} <span className="num">↵</span>
              </Link>
            ) : null}
          </div>
        </div>
        <div className="mt-7 grid grid-cols-2 gap-x-6 gap-y-5 lg:grid-cols-4">
          {[
            { key: "review", label: t("cab.kpi.review"), value: toReview, tone: "warn" as const },
            {
              key: "supervised",
              label: t("cab.kpi.supervised"),
              value: supervised,
              tone: "ok" as const,
            },
            {
              key: "returned",
              label: t("cab.kpi.returned"),
              value: returned,
              tone: "stop" as const,
            },
            {
              key: "clients",
              label: t("cab.kpi.clients"),
              value: clientCount,
              tone: "neutral" as const,
            },
          ].map((k) => (
            <div key={k.key}>
              <p className="text-[9.5px] font-semibold uppercase tracking-[0.18em] text-background/60">
                {k.label}
              </p>
              <p
                className={cn(
                  "num mt-1.5 text-[30px] leading-none lg:text-[38px]",
                  k.value === 0
                    ? "text-background/50"
                    : k.tone === "warn"
                      ? "text-marigold-on-ink"
                      : "text-background",
                )}
              >
                {k.value}
              </p>
            </div>
          ))}
        </div>
      </header>

      <div className="grid gap-8 xl:grid-cols-[1.85fr_1fr]">
        {/* ---- la file */}
        <section className="min-w-0 space-y-3">
          <SectionTitle
            action={
              <span className="num text-[11px] text-muted-foreground">
                {visibles.length} / {rows.length}
              </span>
            }
          >
            {t("cab.today.queue")}
          </SectionTitle>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex border border-border">
              {(
                [
                  ["tout", "cab.today.filter.all"],
                  ["comptabilisee", "cab.kpi.review"],
                  ["retournee", "cab.kpi.returned"],
                  ["supervisee", "cab.kpi.supervised"],
                ] as Array<[Filtre, MessageKey]>
              ).map(([f, cle]) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFiltre(f)}
                  aria-pressed={filtre === f}
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em]",
                    filtre === f ? "bg-foreground text-background" : "bg-card hover:bg-accent",
                  )}
                >
                  {t(cle)}
                  <span className="num font-normal opacity-70">{compteParFiltre(f)}</span>
                </button>
              ))}
            </div>
            <label className="flex min-w-[200px] flex-1 items-center gap-2 border border-border bg-card px-2.5 py-1.5 text-muted-foreground focus-within:border-foreground">
              <span aria-hidden className="num text-[11px]">
                /
              </span>
              <input
                value={texte}
                onChange={(e) => setTexte(e.target.value)}
                placeholder={t("cab.today.search")}
                className="min-w-0 flex-1 bg-transparent text-[12.5px] text-foreground outline-none placeholder:text-muted-foreground"
              />
            </label>
          </div>

          {collaborateurs.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="me-1 text-[9.5px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {t("cab.today.affectation")}
              </span>
              <Puce actif={collab === null} onClick={() => setCollab(null)}>
                {t("cab.today.allcabinet")}
              </Puce>
              {collaborateurs.map((email) => (
                <Puce key={email} actif={collab === email} onClick={() => setCollab(email)}>
                  <span className="num me-1.5 bg-foreground px-1 text-[9px] text-background">
                    {initialesDe(email)}
                  </span>
                  {email}
                  <span className="num ms-1.5 opacity-60">
                    {rows.filter((r) => r.collaborateur === email).length}
                  </span>
                </Puce>
              ))}
              <Puce actif={collab === ""} onClick={() => setCollab("")}>
                {t("cab.today.unassigned")}
                <span className="num ms-1.5 opacity-60">
                  {rows.filter((r) => !r.collaborateur).length}
                </span>
              </Puce>
            </div>
          ) : null}

          {queue.isPending ? (
            <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
          ) : visibles.length === 0 ? (
            <EmptyState>{t("cab.queue.empty")}</EmptyState>
          ) : (
            <QueueTable rows={visibles} />
          )}
        </section>

        {/* ---- la colonne de droite */}
        <aside className="space-y-8">
          <section className="space-y-3">
            <SectionTitle
              action={
                <Link
                  to="/cabinet/pilotage"
                  className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground underline"
                >
                  {t("cab.today.charge.affecter")}
                </Link>
              }
            >
              {t("cab.today.charge")}
            </SectionTitle>
            {charge.length === 0 ? (
              <EmptyState>{t("cab.today.unassigned")}</EmptyState>
            ) : (
              <ul className="space-y-3">
                {charge.map((c) => (
                  <li key={c.email}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-[13px]">{c.email}</span>
                      <span className="num text-[11px] text-muted-foreground">
                        {t("cab.rail.mandats", { count: c.mandats })}
                      </span>
                    </div>
                    <span aria-hidden className="mt-1.5 block h-[3px] w-full bg-secondary">
                      <span
                        className="block h-full bg-foreground"
                        style={{ width: `${Math.round(c.part * 100)}%` }}
                      />
                    </span>
                    <span className="mt-1 block text-[11px] text-muted-foreground">
                      {t("cab.today.charge.pieces", { count: c.attente })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-3">
            <SectionTitle
              action={
                <Link
                  to="/cabinet/echeances"
                  className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground underline"
                >
                  {t("cab.today.echeances.all")}
                </Link>
              }
            >
              {t("cab.today.echeances")}
            </SectionTitle>
            {proches.length === 0 ? (
              <EmptyState>{t("cab.today.echeances.none")}</EmptyState>
            ) : (
              <ul className="divide-y divide-border border border-border bg-card">
                {proches.map((e) => (
                  <li key={e.id} className="flex items-baseline justify-between gap-3 px-3 py-2.5">
                    <span className="min-w-0">
                      <span className="block truncate text-[13px]">{e.label}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {nomDuClient(e.tenantId)}
                      </span>
                    </span>
                    <span className="num shrink-0 text-[12px]">
                      {jourLisible(e.dueDate, locale)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="border border-border bg-card p-4">
            <p className="text-[9.5px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              {t("cab.today.socle")}
            </p>
            <div className="mt-3 grid grid-cols-3 gap-3">
              {socle.map((s) => (
                <div key={s.key}>
                  <p className="num text-[24px] leading-none">{s.value}</p>
                  <p className="mt-1 text-[10.5px] leading-[1.35] text-muted-foreground">
                    {s.label}
                  </p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[11px] leading-[1.5] text-muted-foreground">
              {t("cab.today.socle.doctrine")}
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}

function Puce({
  actif,
  onClick,
  children,
}: {
  actif: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={actif}
      className={cn(
        "flex items-center border px-2 py-1 text-[11px]",
        actif
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-card hover:bg-accent",
      )}
    >
      {children}
    </button>
  );
}

/** Une date d'écriture, dans la langue de la personne — jamais un horodatage brut. */
function jourLisible(iso: string, locale: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}

export function QueueTable({ rows }: { rows: QueueItem[] }) {
  const { t, locale } = useI18n();
  return (
    <InkTable
      caption={t("cab.queue.title")}
      head={[
        t("cab.queue.rank"),
        t("cab.queue.client"),
        t("cab.queue.libelle"),
        t("cab.queue.amount"),
        t("cab.queue.status"),
        t("cab.queue.age"),
        "",
      ]}
    >
      {rows.map((row, i) => {
        const jours = joursDAttente(row.createdAt);
        return (
          <InkTableRow key={row.pieceId}>
            <InkCell numeric>{i + 1}</InkCell>
            <InkCell>
              <span className="block font-medium">{row.clientName}</span>
              {/*
               * Une demande qui attend se VOIT dans la file. Sans cette
               * pastille, le comptable devrait ouvrir chaque pièce pour
               * découvrir qu'un client attend une réponse — donc il ne la
               * découvrirait pas.
               */}
              {row.demandeEnAttente ? (
                <span className="mt-0.5 inline-block bg-signal-warn px-1.5 py-px text-[10px] font-semibold uppercase tracking-[0.08em] text-background">
                  {t(
                    row.demandeEnAttente === "rappel"
                      ? "cab.file.demande.rappel"
                      : "cab.file.demande.suppression",
                  )}
                </span>
              ) : null}
              {row.collaborateur ? (
                <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className="num bg-foreground px-1 text-[9px] text-background">
                    {initialesDe(row.collaborateur)}
                  </span>
                  <span className="truncate">{row.collaborateur}</span>
                </span>
              ) : null}
            </InkCell>
            <InkCell>
              <span className="block">{row.libelle ?? t("cab.queue.unread")}</span>
              {row.dateEcriture ? (
                <span className="num block text-[10.5px] text-muted-foreground">
                  {jourLisible(row.dateEcriture, locale)}
                </span>
              ) : null}
            </InkCell>
            <InkCell numeric>{row.montant ? montant(row.montant, locale) : "—"}</InkCell>
            <InkCell>
              <SignalLight
                tone={toneForStatus(row.status)}
                label={t(`pme.status.${row.status}` as MessageKey)}
              />
            </InkCell>
            <InkCell numeric>
              {jours === 0 ? t("cab.queue.age.today") : t("cab.queue.age.days", { n: jours })}
            </InkCell>
            <InkCell>
              <Link
                to="/cabinet/piece/$pieceId"
                params={{ pieceId: row.pieceId }}
                className="border border-border px-2 py-1 text-[9.5px] font-semibold uppercase tracking-[0.14em] hover:bg-foreground hover:text-background"
              >
                {t("cab.queue.open")}
              </Link>
            </InkCell>
          </InkTableRow>
        );
      })}
    </InkTable>
  );
}
