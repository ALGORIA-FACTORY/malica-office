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
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  CheckCheck,
  CircleCheck,
  FileCheck2,
  MessageSquare,
  NotebookText,
  Search,
  Users,
} from "lucide-react";

import { ApercuDePiece } from "@/components/malica/apercu-de-piece";
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
import { FileEnPiles } from "@/components/malica/file-en-piles";
import { useI18n, type MessageKey } from "@/i18n";
import {
  dansLeFiltre,
  feuDuStatut,
  joursDAttente,
  prisesEnChargeDepuis,
  type FiltreDeLaFile,
} from "@/lib/file-cabinet";
import { MOT_CABINET } from "@/lib/statut";
import { initialesDe } from "@/lib/initiales";
import { enDebutDePhrase, montant } from "@/lib/lisible";
import { idsDesMandatsActifs } from "@/lib/portefeuille-actif";
import { oublierLOrdre } from "@/lib/ordre-de-revue";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { cn } from "@/lib/utils";
import { office } from "@/verticals/malica-office/composition";
import type { QueueItem } from "@malica/socle/ports/repositories";
import { A_TRAITER } from "@malica/socle/statut-d-envoi";

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

const JOUR_MS = 86_400_000;

function CabinetToday() {
  const { t, locale } = useI18n();
  const { org } = useCabinet();
  // Revenir à la file, c'est recommencer une revue : l'ordre gardé d'une pièce
  // à l'autre (`ordre-de-revue.ts`) repart de la file telle qu'elle est ici.
  useEffect(() => oublierLOrdre(org.id), [org.id]);

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
  const actifs = useMemo(() => idsDesMandatsActifs(clients.data ?? []), [clients.data]);
  const clientIds = useMemo(() => [...actifs], [actifs]);
  const echeances = useQuery({
    queryKey: ["cab-echeances", org.id, clientIds, locale],
    queryFn: () => office().collab.echeances(clientIds, locale),
    enabled: clientIds.length > 0,
  });

  useMalicaPanel(<MalicaNote>{t("cab.malica.queue")}</MalicaNote>, [locale]);

  const rows = useMemo(
    () => (queue.data ?? []).filter((r) => actifs.has(r.tenantId)),
    [queue.data, actifs],
  );
  const compteParFiltre = (f: FiltreDeLaFile) => rows.filter((r) => dansLeFiltre(r, f)).length;
  const toReview = compteParFiltre("a_traiter");
  const doublons = compteParFiltre("doublons");
  // Les clients mandatés : ni le mandat révoqué, ni le refusé (ANO-013).
  const clientCount = (clients.data ?? []).filter((c) => c.engagementStatus === "actif").length;

  /* ---- filtres : statut, collaborateur, texte */
  const [filtreChoisi, setFiltre] = useState<FiltreDeLaFile>("tout");
  // La puce « Doublons probables » disparaît quand il n'en reste plus : son
  // filtre ne doit pas survivre à sa puce et laisser une file vide sans raison.
  const filtre = filtreChoisi === "doublons" && doublons === 0 ? "tout" : filtreChoisi;
  const [collab, setCollab] = useState<string | null>(null); // null = tout le cabinet ; "" = sans
  const [texte, setTexte] = useState("");
  const file = useRef<HTMLElement | null>(null);

  const collaborateurs = useMemo(() => {
    const emails = new Set<string>();
    for (const r of rows) if (r.collaborateur) emails.add(r.collaborateur);
    for (const m of membres.data ?? []) emails.add(m.email);
    return [...emails].sort();
  }, [rows, membres.data]);

  const visibles = useMemo(() => {
    const q = texte.trim().toLocaleLowerCase();
    return rows.filter((r) => {
      if (!dansLeFiltre(r, filtre)) return false;
      if (collab === "" && r.collaborateur) return false;
      if (collab && r.collaborateur !== collab) return false;
      const cherche = `${r.clientName} ${r.libelle ?? ""} ${r.tiers ?? ""}`;
      if (q && !cherche.toLocaleLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, filtre, collab, texte]);

  /* ---- la charge : par collaborateur, ses mandats et ce qui attend */
  const charge = useMemo(() => {
    const parCollab = new Map<string, { mandats: number; attente: number }>();
    for (const email of collaborateurs) parCollab.set(email, { mandats: 0, attente: 0 });
    const actives = (affectations.data ?? []).filter(
      (a) => a.active && actifs.has(a.clientTenantId),
    );
    const parUser = new Map((membres.data ?? []).map((m) => [m.userId, m.email]));
    for (const a of actives) {
      const email = parUser.get(a.collaboratorId);
      if (!email) continue;
      const c = parCollab.get(email) ?? { mandats: 0, attente: 0 };
      c.mandats += 1;
      parCollab.set(email, c);
    }
    for (const r of rows) {
      if (!r.collaborateur || !A_TRAITER.has(r.statut)) continue;
      const c = parCollab.get(r.collaborateur) ?? { mandats: 0, attente: 0 };
      c.attente += 1;
      parCollab.set(r.collaborateur, c);
    }
    const max = Math.max(1, ...[...parCollab.values()].map((c) => c.attente));
    return [...parCollab.entries()].map(([email, c]) => ({ email, ...c, part: c.attente / max }));
  }, [collaborateurs, affectations.data, membres.data, rows, actifs]);

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
  // Reçues = arrivées au cabinet : une photo reprise garde la date de la première.
  // Prises en charge = validées ou forcées dans la fenêtre, quelle que soit l'arrivée.
  const recentes = rows.filter((r) => new Date(r.envoyeeLe).getTime() >= depuisHier);
  const socle = [
    { key: "recues", label: t("cab.today.socle.recues"), value: String(recentes.length) },
    {
      key: "lues",
      label: t("cab.today.socle.lues"),
      value: String(recentes.filter((r) => r.status !== "capturee").length),
    },
    {
      key: "prises",
      label: t("cab.today.socle.prises"),
      value: String(prisesEnChargeDepuis(rows, depuisHier)),
    },
  ];

  // « Mercredi 4 novembre » : l'initiale de la phrase, pas celle de chaque mot.
  const today = enDebutDePhrase(
    new Intl.DateTimeFormat(locale, {
      weekday: "long",
      day: "numeric",
      month: "long",
    }).format(new Date()),
    locale,
  );
  const premiere = rows.find((r) => A_TRAITER.has(r.statut)) ?? rows[0] ?? null;

  const sources = [clients, queue, membres, affectations];
  const panne = sources.find((source) => source.error)?.error;
  if (panne || sources.some((source) => source.isPending)) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold">{t("cab.today.title")}</h1>
        {panne ? (
          <div role="alert">
            <p>{texteDeLErreur(panne, "cabinet.index", t("common.error"))}</p>
            <button
              type="button"
              className="min-h-[44px] underline"
              onClick={() => {
                for (const source of sources) void source.refetch();
              }}
            >
              {t("doc.retry")}
            </button>
          </div>
        ) : (
          <p role="status">{t("common.loading")}</p>
        )}
      </section>
    );
  }

  return (
    <div className="cab-dashboard space-y-8">
      <header className="cab-day-header">
        <div>
          <p className="cab-eyebrow">{today}</p>
          <h1>{t("cab.design.journee")}</h1>
          <p className="cab-day-summary">
            {t("cab.today.summary", {
              pieces: t("cab.today.summary.pieces", { count: rows.length }),
              mandats: t("cab.today.summary.mandats", { count: clientCount }),
            })}
          </p>
          {/* La journée se referme sur son journal : tous les dossiers, aujourd'hui. */}
          <Link
            to="/cabinet/journal"
            search={{ client: "tous" }}
            className="mt-3 inline-flex min-h-[44px] items-center gap-1.5 text-[13px] font-semibold underline underline-offset-4"
          >
            <NotebookText size={16} aria-hidden />
            {t("cab.nav.journal")}
          </Link>
        </div>
        <div className="cab-day-actions">
          <Link to="/cabinet/clients" className="cab-button cab-button-secondary">
            <Users size={16} />
            {t("cab.nav.clients")}
          </Link>
          {premiere ? (
            <Link
              to="/cabinet/piece/$pieceId"
              params={{ pieceId: premiere.pieceId }}
              className="cab-button cab-button-primary"
            >
              {t("cab.design.commencer")}
              <ArrowRight size={16} />
            </Link>
          ) : null}
        </div>
      </header>
      <div className="cab-day-columns">
        {/* ---- la file */}
        <section ref={file} className="cab-worklist min-w-0 space-y-3">
          <SectionTitle
            action={
              <span className="num text-[11px] text-muted-foreground">
                {visibles.length} / {rows.length}
              </span>
            }
          >
            {t("cab.today.queue")}
          </SectionTitle>

          <div className="cab-list-toolbar flex flex-wrap items-center gap-2">
            <div className="cab-tabs flex border border-border">
              {(
                [
                  // Les statuts se filtrent par les tuiles du haut (À traiter,
                  // Retournées, Prises en charge) : les répéter ici en puces
                  // doublait chaque geste (recette du 5 novembre 2026). Restent
                  // « Tout », pour revenir, et les doublons, qu'aucune tuile ne porte.
                  ["tout", "cab.today.filter.all"],
                  // Seulement s'il y en a : une puce à zéro serait du bruit.
                  ...(doublons > 0 ? [["doublons", "cab.today.filter.doublons"]] : []),
                ] as Array<[FiltreDeLaFile, MessageKey]>
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
            <label className="cab-list-search flex min-w-[200px] flex-1 items-center gap-2 border border-border bg-card px-2.5 py-1.5 text-muted-foreground focus-within:border-foreground">
              <Search size={16} aria-hidden />
              <input
                value={texte}
                onChange={(e) => setTexte(e.target.value)}
                placeholder={t("cab.today.search")}
                aria-label={t("cab.today.search")}
                className="min-w-0 flex-1 bg-transparent text-[12.5px] text-foreground outline-none placeholder:text-muted-foreground"
              />
            </label>
          </div>

          {collaborateurs.length > 0 ? (
            <div className="cab-assignees flex flex-wrap items-center gap-1.5">
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

          {toReview > 0 ? (
            <div className="cab-batch-link">
              <Link to="/cabinet/propositions" className="cab-cible">
                {t("cab.today.bulk")}
                <ArrowRight size={15} />
              </Link>
            </div>
          ) : null}
          {queue.isPending ? (
            <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
          ) : visibles.length === 0 ? (
            <div className="cab-worklist-empty" role="status">
              <span className="cab-empty-icon">
                <CircleCheck size={26} strokeWidth={1.5} />
              </span>
              <h3>
                {t(
                  texte || collab !== null || filtre !== "tout"
                    ? "cab.design.aucunResultat"
                    : clientCount === 0
                      ? "cab.design.pasDeMandat"
                      : "cab.design.fileAjour",
                )}
              </h3>
              <p>
                {t(
                  texte || collab !== null || filtre !== "tout"
                    ? "cab.design.ajusterFiltres"
                    : clientCount === 0
                      ? "cab.design.commencerMandat"
                      : "cab.queue.empty",
                )}
              </p>
              {texte || collab !== null || filtre !== "tout" ? (
                <button
                  type="button"
                  className="cab-button cab-button-secondary"
                  onClick={() => {
                    setFiltre("tout");
                    setCollab(null);
                    setTexte("");
                  }}
                >
                  {t("cab.design.effacerFiltres")}
                </button>
              ) : (
                <Link to="/cabinet/clients" className="cab-button cab-button-secondary">
                  {t("cab.nav.clients")}
                  <ArrowRight size={15} />
                </Link>
              )}
            </div>
          ) : (
            <FileEnPiles rows={visibles} cabinetId={org.id} />
          )}
        </section>

        {/* ---- la colonne de droite */}
        <aside className="cab-day-aside hidden space-y-8 xl:block">
          <section className="space-y-3">
            <SectionTitle
              action={
                <Link
                  to="/cabinet/pilotage"
                  className="cab-cible text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground underline"
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
                  className="cab-cible text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground underline"
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

/**
 * La file, en table au bureau et en cartes au téléphone.
 *
 * Relevé sur staging le 4 novembre 2026 à 375 px : les sept colonnes
 * restaient une table dans un défilement de côté, et le libellé s'écrasait
 * à une lettre par ligne. Sous 720 px, chaque ligne devient une carte — la
 * vignette et le client en tête avec le statut, le libellé sur toute la
 * largeur, puis le montant, l'attente et « Ouvrir ». Un seul balisage pour
 * les deux : la carte est la même ligne, posée autrement par la feuille
 * (`.cab-file`), et rien ne se dédouble au DOM.
 */
export function QueueTable({ rows }: { rows: QueueItem[] }) {
  const { t, locale } = useI18n();
  return (
    <InkTable
      className="cab-file"
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
        const jours = joursDAttente(row.envoyeeLe);
        return (
          <InkTableRow key={row.pieceId}>
            <InkCell numeric className="cab-file-rang">
              {i + 1}
            </InkCell>
            <InkCell className="cab-file-client">
              {/* La vraie page, à gauche : le comptable reconnaît la pièce avant de l'ouvrir. */}
              <span className="flex items-center gap-3">
                <ApercuDePiece pieceId={row.pieceId} className="vignette" />
                <span className="min-w-0">
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
                  {row.doublonDe ? (
                    <span className="mt-0.5 ms-1 inline-block bg-signal-warn px-1.5 py-px text-[10px] font-semibold uppercase tracking-[0.08em] text-background">
                      {t("cab.file.doublon")}
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
                </span>
              </span>
            </InkCell>
            <InkCell className="cab-file-libelle">
              {/*
               * « Pas encore lue » était faux, et visiblement faux.
               *
               * 13 octobre 2026 : huit lignes de la file portaient le statut
               * LUE et, dans la colonne LIBELLÉ, « Pas encore lue ». Le
               * libellé de cette colonne est celui de l'ÉCRITURE ; son repli
               * décrivait la pièce, et se trompait de sujet. Une pièce lue
               * dont aucune écriture n'est comptabilisée n'est pas une pièce
               * non lue — c'est précisément celle que le cabinet doit
               * regarder.
               *
               * 4 novembre 2026 : « Lue — aucune écriture », sans un nom, ne
               * dit pas QUELLE pièce attend. Le fournisseur lu (ou dit par une
               * personne) s'y ajoute quand on le connaît.
               */}
              <span className="block">
                {row.libelle ??
                  (row.status === "capturee"
                    ? t("cab.queue.unread")
                    : row.tiers
                      ? t("cab.queue.sansEcriture.tiers", { tiers: row.tiers })
                      : t("cab.queue.sansEcriture"))}
              </span>
              {row.dateEcriture ? (
                <span className="num block text-[10.5px] text-muted-foreground">
                  {jourLisible(row.dateEcriture, locale)}
                </span>
              ) : null}
            </InkCell>
            <InkCell numeric className="cab-file-montant" label={t("cab.queue.amount")}>
              {/* L'écriture d'abord ; sinon le TTC lu ; sinon rien (7 novembre 2026). */}
              {row.montant
                ? montant(row.montant, locale)
                : row.montantLu
                  ? montant(row.montantLu, locale)
                  : "—"}
            </InkCell>
            <InkCell className="cab-file-statut">
              <SignalLight tone={feuDuStatut(row.statut)} label={t(MOT_CABINET[row.statut])} />
            </InkCell>
            <InkCell numeric className="cab-file-attente" label={t("cab.queue.age")}>
              {jours === 0 ? t("cab.queue.age.today") : t("cab.queue.age.days", { n: jours })}
            </InkCell>
            <InkCell className="cab-file-ouvrir">
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
