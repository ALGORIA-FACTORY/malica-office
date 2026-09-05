/**
 * Notifications — ce que les dossiers ont fait savoir au cabinet.
 *
 * ============================================================== POURQUOI
 *
 * La base pose une notification à chaque geste qui concerne le cabinet :
 * une pièce transmise, une écriture proposée ou comptabilisée, un retour,
 * une précision. Elles existaient depuis le début ; aucun écran ne les
 * montrait, et la cloche du design n'avait rien à compter.
 *
 * Chaque genre est nommé dans la langue de la personne — jamais son code.
 * Une notification qui parle d'une pièce mène à la pièce. « Tout marquer
 * lu » marque, ligne par ligne, par la méthode qui existe : rien n'est
 * effacé, la base garde la trace.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";

import { useCabinet, useRegalicaPanel } from "@/components/regalica/cabinet-context";
import { EmptyState, RegalicaNote, SectionTitle } from "@/components/regalica/office-ui";
import { useI18n, type MessageKey } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { cn } from "@/lib/utils";
import { office } from "@/verticals/regalica-office/composition";
import type { Notification } from "@regalica/socle/ports/repositories";

export const Route = createFileRoute("/_authenticated/cabinet/notifications")({
  head: () => ({
    meta: [
      { title: "Notifications — cabinet — Regalica Office" },
      { name: "description", content: "Ce que les dossiers mandatés ont fait savoir au cabinet." },
      { property: "og:title", content: "Notifications — cabinet — Regalica Office" },
      {
        property: "og:description",
        content: "Ce que les dossiers mandatés ont fait savoir au cabinet.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CabinetNotifications,
});

/**
 * Le genre de la base → la phrase de la personne. Un genre inconnu prend une
 * phrase générique : l'écran ne montre jamais un code.
 */
const PHRASE_DU_GENRE: Record<string, MessageKey> = {
  "piece.partagee": "cab.notif.kind.piece.partagee",
  "piece.captured": "cab.notif.kind.piece.captured",
  "piece.read": "cab.notif.kind.piece.read",
  "piece.validee": "cab.notif.kind.piece.validee",
  "piece.retournee": "cab.notif.kind.piece.retournee",
  "piece.precisee": "cab.notif.kind.piece.precisee",
  "piece.vis_changed": "cab.notif.kind.piece.vis_changed",
  "piece.articles_projected": "cab.notif.kind.piece.articles_projected",
  "ecriture.proposed": "cab.notif.kind.ecriture.proposed",
  "ecriture.booked": "cab.notif.kind.ecriture.booked",
  "ecriture.validee": "cab.notif.kind.ecriture.validee",
  "ecriture.retournee": "cab.notif.kind.ecriture.retournee",
  "conseil.arbitrage": "cab.notif.kind.conseil.arbitrage",
  "conseil.repondu": "cab.notif.kind.conseil.repondu",
  "conseil.decide": "cab.notif.kind.conseil.decide",
  "mandat.propose": "cab.notif.kind.mandat.propose",
  "mandat.accepte": "cab.notif.kind.mandat.accepte",
  "mandat.refuse": "cab.notif.kind.mandat.refuse",
  "pv.envoye": "cab.notif.kind.pv.envoye",
};

/** Un genre qui attend un geste du cabinet se lit en or. */
const ATTEND_LE_CABINET = new Set([
  "piece.partagee",
  "ecriture.booked",
  "ecriture.proposed",
  "conseil.arbitrage",
  "mandat.refuse",
]);

/** Les genres qui mènent ailleurs qu'à une pièce : la file d'arbitrage, les mandats, les PV. */
const MENE_AU_CONSEIL = new Set(["conseil.arbitrage", "conseil.repondu", "conseil.decide"]);
const MENE_AUX_CLIENTS = new Set(["mandat.propose", "mandat.accepte", "mandat.refuse"]);
const MENE_AUX_PV = new Set(["pv.envoye"]);

function pieceDe(n: Notification): string | null {
  const p = n.payload;
  if (!p || typeof p !== "object") return null;
  const id =
    (p as Record<string, unknown>)["piece_id"] ?? (p as Record<string, unknown>)["pieceId"];
  return typeof id === "string" ? id : null;
}

function CabinetNotifications() {
  const { t, locale } = useI18n();
  const { org } = useCabinet();
  const qc = useQueryClient();

  const clients = useQuery({
    queryKey: ["cab-clients", org.id],
    queryFn: () => office().supervision.listClients(org.id),
  });
  const clientIds = useMemo(() => (clients.data ?? []).map((c) => c.tenantId), [clients.data]);
  const notifications = useQuery({
    queryKey: ["cab-notifications", org.id, clientIds],
    queryFn: () => office().collab.notifications(clientIds),
    enabled: clientIds.length > 0,
  });

  useRegalicaPanel(<RegalicaNote>{t("cab.notif.regalica")}</RegalicaNote>, [locale]);

  const invalider = () => qc.invalidateQueries({ queryKey: ["cab-notifications", org.id] });

  const marquer = useMutation({
    mutationFn: (id: string) => office().collab.markRead(id),
    onSuccess: invalider,
  });
  const toutMarquer = useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) await office().collab.markRead(id);
    },
    onSuccess: invalider,
  });

  const liste = useMemo(() => notifications.data ?? [], [notifications.data]);
  const nonLues = liste.filter((n) => !n.readAt);
  const nomDuClient = (tenantId: string) =>
    (clients.data ?? []).find((c) => c.tenantId === tenantId)?.name ?? "—";

  // Groupées par jour, les plus récentes d'abord.
  const parJour = useMemo(() => {
    const groupes = new Map<string, Notification[]>();
    for (const n of [...liste].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
      const jour = n.createdAt.slice(0, 10);
      groupes.set(jour, [...(groupes.get(jour) ?? []), n]);
    }
    return [...groupes.entries()];
  }, [liste]);

  const jourLisible = (iso: string) =>
    new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" }).format(
      new Date(`${iso}T00:00:00Z`),
    );
  const heureLisible = (iso: string) =>
    new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

  const erreur = marquer.error ?? toutMarquer.error;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-marigold">
            {nonLues.length > 0
              ? t("cab.notif.kicker.attente", { n: nonLues.length })
              : t("cab.notif.kicker.rien")}
          </p>
          <h1 className="mt-1 text-[30px] font-semibold leading-tight tracking-[-0.025em]">
            {t("cab.nav.notifications")}
          </h1>
          <p className="mt-1 max-w-[62ch] text-[13.5px] leading-[1.5] text-text-2">
            {t("cab.notif.lede")}
          </p>
        </div>
        {nonLues.length > 0 ? (
          <button
            type="button"
            onClick={() => toutMarquer.mutate(nonLues.map((n) => n.id))}
            disabled={toutMarquer.isPending}
            className="border border-foreground bg-foreground px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-background disabled:opacity-40"
          >
            {t("cab.notif.toutLu")}
          </button>
        ) : null}
      </header>

      {erreur ? (
        <p className="text-[12.5px] text-signal-warn">
          {texteDeLErreur(erreur, "routes/_authenticated/cabinet.notifications", t("common.error"))}
        </p>
      ) : null}

      {notifications.isPending && clientIds.length > 0 ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : liste.length === 0 ? (
        <EmptyState>{t("cab.notif.vide")}</EmptyState>
      ) : (
        parJour.map(([jour, items]) => (
          <section key={jour} className="space-y-2">
            <SectionTitle>{jourLisible(jour)}</SectionTitle>
            <ul className="divide-y divide-border border border-border bg-card">
              {items.map((n) => {
                const piece = pieceDe(n);
                const attend = ATTEND_LE_CABINET.has(n.kind);
                const lue = n.readAt !== null;
                const ailleurs = MENE_AU_CONSEIL.has(n.kind)
                  ? "/cabinet/conseil"
                  : MENE_AUX_CLIENTS.has(n.kind)
                    ? "/cabinet/clients"
                    : MENE_AUX_PV.has(n.kind)
                      ? "/cabinet/pv"
                      : null;
                return (
                  <li
                    key={n.id}
                    className={cn(
                      "flex flex-wrap items-start gap-3 px-4 py-3",
                      lue ? "opacity-70" : "",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "mt-1.5 h-[7px] w-[7px] shrink-0",
                        lue ? "bg-border" : attend ? "bg-marigold" : "bg-foreground",
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13.5px]">
                        {t(PHRASE_DU_GENRE[n.kind] ?? "cab.notif.kind.autre")}
                      </span>
                      <span className="mt-0.5 block text-[11.5px] text-muted-foreground">
                        {nomDuClient(n.tenantId)} ·{" "}
                        <span className="num">{heureLisible(n.createdAt)}</span>
                      </span>
                    </span>
                    <span className="flex shrink-0 gap-1.5">
                      {piece ? (
                        <Link
                          to="/cabinet/piece/$pieceId"
                          params={{ pieceId: piece }}
                          onClick={() => {
                            if (!lue) marquer.mutate(n.id);
                          }}
                          className="border border-foreground bg-foreground px-2 py-1 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-background"
                        >
                          {t("cab.notif.ouvrir")}
                        </Link>
                      ) : ailleurs ? (
                        <Link
                          to={ailleurs}
                          onClick={() => {
                            if (!lue) marquer.mutate(n.id);
                          }}
                          className="border border-foreground bg-foreground px-2 py-1 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-background"
                        >
                          {t("cab.notif.ouvrir")}
                        </Link>
                      ) : null}
                      {!lue ? (
                        <button
                          type="button"
                          onClick={() => marquer.mutate(n.id)}
                          disabled={marquer.isPending}
                          className="border border-border bg-card px-2 py-1 text-[9.5px] font-semibold uppercase tracking-[0.14em] hover:bg-accent disabled:opacity-40"
                        >
                          {t("cab.notif.marquerLu")}
                        </button>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
