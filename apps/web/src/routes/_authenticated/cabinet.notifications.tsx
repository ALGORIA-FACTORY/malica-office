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

import { useCabinet, useMalicaPanel } from "@/components/malica/cabinet-context";
import { EmptyState, MalicaNote, SectionTitle, EnTeteCabinet } from "@/components/malica/office-ui";
import { useNotificationsDuCabinet } from "@/hooks/use-notifications-du-cabinet";
import { useI18n, type MessageKey } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { cn } from "@/lib/utils";
import { office } from "@/verticals/malica-office/composition";
import type { Notification } from "@malica/socle/ports/repositories";

export const Route = createFileRoute("/_authenticated/cabinet/notifications")({
  head: () => ({
    meta: [
      { title: "Notifications — cabinet — Malica Office" },
      { name: "description", content: "Ce que les dossiers mandatés ont fait savoir au cabinet." },
      { property: "og:title", content: "Notifications — cabinet — Malica Office" },
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
  // Recette du 20 octobre 2026 : la révocation n'arrivait pas chez le cabinet.
  "mandat.revoque": "cab.notif.kind.mandat.revoque",
  "pv.envoye": "cab.notif.kind.pv.envoye",
  // Le client demande le retour ou l'effacement d'une pièce transmise. Sans
  // ces deux entrées, la demande arrivait sous une phrase générique et
  // n'était pas signalée comme attendant un geste : le canal de retour était
  // muet des deux côtés.
  "piece.demande": "cab.notif.kind.piece.demande",
  "piece.demande_tranchee": "cab.notif.kind.piece.demande_tranchee",
  // ANO-037 : les genres que la base pose et qu'aucune phrase ne disait.
  "piece.a_valider": "cab.notif.kind.piece.a_valider",
  "piece.a_revalider": "cab.notif.kind.piece.a_revalider",
  "acces.propose": "cab.notif.kind.acces.propose",
  "acces.accepte": "cab.notif.kind.acces.accepte",
  "acces.repris": "cab.notif.kind.acces.repris",
  "facture.emise": "cab.notif.kind.facture.emise",
};

/** Un genre qui attend un geste du cabinet se lit en or. */
const ATTEND_LE_CABINET = new Set([
  "piece.partagee",
  "ecriture.booked",
  "ecriture.proposed",
  "conseil.arbitrage",
  "mandat.refuse",
  // Un client qui attend une réponse attend sur un geste du cabinet.
  "piece.demande",
]);

/** Les genres qui mènent ailleurs qu'à une pièce : la file d'arbitrage, les mandats, les PV. */
const MENE_AU_CONSEIL = new Set(["conseil.arbitrage", "conseil.repondu", "conseil.decide"]);
const MENE_AUX_CLIENTS = new Set([
  "mandat.propose",
  "mandat.accepte",
  "mandat.refuse",
  "mandat.revoque",
]);
const MENE_AUX_PV = new Set(["pv.envoye"]);

function pieceDe(n: Notification): string | null {
  const p = n.payload;
  if (!p || typeof p !== "object") return null;
  const id =
    (p as Record<string, unknown>)["piece_id"] ?? (p as Record<string, unknown>)["pieceId"];
  return typeof id === "string" ? id : null;
}

/** Un champ texte du payload, ou `null`. */
function texteDuPayload(n: Notification, cle: string): string | null {
  const p = n.payload;
  if (!p || typeof p !== "object") return null;
  const v = (p as Record<string, unknown>)[cle];
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

function CabinetNotifications() {
  const { t, locale } = useI18n();
  const { org } = useCabinet();
  const qc = useQueryClient();

  const clients = useQuery({
    queryKey: ["cab-clients", org.id],
    queryFn: () => office().supervision.listClients(org.id),
  });
  const notifications = useNotificationsDuCabinet(org.id, clients.data);

  useMalicaPanel(<MalicaNote>{t("cab.notif.malica")}</MalicaNote>, [locale]);

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
  // Une notification inscrite chez le cabinet nomme le client dans sa charge.
  const nomDuClient = (n: Notification) =>
    (clients.data ?? []).find((c) => c.tenantId === n.tenantId)?.name ??
    texteDuPayload(n, "client") ??
    "—";

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
      <EnTeteCabinet
        surtitre={
          <>
            {nonLues.length > 0
              ? t("cab.notif.kicker.attente", { n: nonLues.length })
              : t("cab.notif.kicker.rien")}
          </>
        }
        titre={<>{t("cab.nav.notifications")}</>}
        chapeau={<>{t("cab.notif.lede")}</>}
        actions={
          <>
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
          </>
        }
      />

      {erreur ? (
        <p className="text-[12.5px] text-signal-warn">
          {texteDeLErreur(erreur, "routes/_authenticated/cabinet.notifications", t("common.error"))}
        </p>
      ) : null}

      {notifications.isPending ? (
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
                        {nomDuClient(n)} · <span className="num">{heureLisible(n.createdAt)}</span>
                      </span>
                      {texteDuPayload(n, "motif") ? (
                        <span className="mt-1 block text-[12px] text-text-2">
                          {t("cab.notif.motif", { motif: texteDuPayload(n, "motif") ?? "" })}
                        </span>
                      ) : null}
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
