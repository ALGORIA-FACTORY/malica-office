/**
 * Mon cabinet, cote boite aux lettres - ce que le cabinet dit au dirigeant,
 * et ce que chaque mot lui demande de faire.
 *
 * ========================================================== CE QUE PORTE L'ECRAN
 *
 * Le dessin valide (`livraison/ecrans/malica-manquants.html`, ecran
 * « Cabinet ») est porte ici tel qu'il est rendu. La route ne change pas de
 * metier : elle portait deja la file des notifications de la PME, elle la
 * porte encore. Seul l'habillage change - le cablage est intact,
 * `collab.notifications` pour lire, `collab.markRead` pour accuser.
 *
 * `pme.regler.tsx` porte le MEME dessin sur le volet des pieces retournees
 * (il appelle en plus `supervision.motifs`, `capture.listAvecLecture` et
 * `identite.monCabinet`). Les deux ecrans sont l'onglet « Echanges » du
 * cablage, livre en deux morceaux (`05-cablage-ecran-par-ecran.md`, tranche
 * du 19 octobre) : celui-la montre les pieces a reprendre, celui-ci montre
 * tout ce que le cabinet a dit, lu ou non.
 *
 * ================================================= POURQUOI CARTE OU LIGNE
 *
 * Le pied du dessin donne la regle de l'ecran, et ce n'est pas une phrase
 * d'ambiance : « Ce qui les separe n'est pas l'ecran : c'est ce qu'ils vous
 * demandent de faire. » Donc :
 *
 * - une notification NON LUE demande encore quelque chose - elle est une
 *   `.card`, avec ses deux boutons ;
 * - une notification LUE ne demande plus rien - elle est une `.rw`, une
 *   ligne qui se lit.
 *
 * ======================================================== R10, ET LES DEUX POIDS
 *
 * R10 - « Malica propose un defaut, l'expert arrete le parametrage », et sa
 * deuxieme consequence : « un defaut se dit », il reste distinguable de ce
 * que l'expert a arrete. Sur cet ecran, cela se voit deux fois :
 *
 * 1. Les deux boutons d'une carte n'ont pas le meme poids, et c'est le
 *    dessin qui le dit : `.card .b button` est la pastille accent,
 *    `.card .b button.sec` est sourde. Le geste que le CABINET demande
 *    (ouvrir la piece, repondre au mandat) est le principal ; « Lu » n'est
 *    qu'un accuse, il est secondaire. Quand le cabinet ne demande aucun
 *    geste, « Lu » reste seul et devient le principal : il n'y a rien
 *    d'autre a faire.
 * 2. Un avis se lit comme un avis. `conseil.decide` est la reponse que
 *    l'expert a arretee : accent (`.rw span.acc`), on peut s'en prevaloir.
 *    `conseil.repondu` (Malica a repondu, l'expert est en copie) et
 *    `conseil.arbitrage` (il relit) sont ambre (`.rw span.am`, `.rw i.am`) -
 *    une proposition en cours, jamais une decision deja prise. Les couleurs
 *    sont celles du dessin, qui montre exactement ces deux lignes.
 *
 * ==================================================== R7, ET L'ACCUSE DE LECTURE
 *
 * R7 - « une correction est une ecriture nouvelle ». `collab.markRead(id)`
 * reste appele tel quel, avec le seul identifiant de la notification : c'est
 * un accuse de lecture, une ecriture a part, et non la modification du fait
 * notifie. L'ecran n'offre aucun geste qui reecrirait le contenu d'une
 * notification, et le libelle ne dit pas autre chose que ce qui est fait.
 *
 * ============================================== LE CSS EXISTE, ON NE L'ECRIT PAS
 *
 * `data-famille="papiers"` fait descendre les regles de la famille,
 * `data-ecran="notifications"` est l'identite que l'audit recense et que la
 * regle d'en-tete unique interroge
 * (`.app:has([data-ecran] .top) > header{display:none}`). Le dessin porte un
 * `.top`, donc cet ecran fournit son en-tete et celui du layout s'efface de
 * lui-meme.
 *
 * Classes employees, toutes relevees dans `styles-pme.css` : `.top .bk .ttl
 * .ic`, `h1`, `.sub`, `.seg` + `.seg button.on`, `.sec:not(button) .sec h2
 * .sec span`, `.card .hd .hd b .hd span .card p .card .b .card .b button
 * .card .b button.sec`, `.rw .rw i .rw i.am .rw .bd .rw b .rw span
 * .rw span.am .rw span.acc .rw .rt .rw .dt`, `.sgn .sgn .ph`, `.dit .dit em`,
 * et `.pad .foot .g` au niveau de la surface. Aucune classe utilitaire sur
 * ces elements ; `.app` et `.nav` sont tenus par le layout `pme.tsx`.
 *
 * ========================================== CE QUI N'EST PAS RENDU, ET POURQUOI
 *
 * - Le second onglet « Ses documents » du dessin : le cablage l'a tranche le
 *   19 octobre - `cabinet.documents` et `cabinet.accuserReception` ne sont
 *   pas livrees, et un onglet structurellement vide est un placeholder que R9
 *   interdit. Le `.seg` porte donc la seule coupe que la donnee deja en main
 *   soutient : ce qui attend un geste, ou tout.
 * - La section « Vos demandes » : `collab.demandesDUnePiece` est par piece.
 *   Une liste d'ecran demanderait une requete par piece, contre la regle
 *   « un ecran, une fenetre de donnees » ; le geste reste sur
 *   `pme.piece.$pieceId`.
 * - Le mot d'etat colore de l'en-tete de carte (« Refusee », « Reclame ») est
 *   un motif GOUVERNE : il vient de `supervision.motifs`, que cette route
 *   n'appelle pas - c'est `pme.regler.tsx` qui le lit. L'en-tete porte donc
 *   la date, qui est vraie ici, et pas une paraphrase du motif.
 * - La variante Premium du dessin (`h1` suffixe « · 2 sur 3 societes ») :
 *   mesure faite, c'est la SEULE difference entre `cab.solo.html` et
 *   `cab.premium.html`. Un seul libelle, donc aucun bloc conditionnel ; le
 *   chiffre demanderait `facturation.organisations`, qui n'est pas appelee
 *   ici.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";

import type { Notification } from "@malica/socle/ports/repositories";

import portraitMalica from "@/assets/malica.webp";
import { ApercuDePiece } from "@/components/malica/apercu-de-piece";
import { usePme } from "@/components/malica/pme-context";
import { useI18n } from "@/i18n";
import { laReponseAEffaceLaPiece } from "@/lib/demande-sur-piece";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { jourOuInstant } from "@/lib/lisible";
import { compteurs, sourceDe, trier, type Onglet } from "@/lib/tri-des-notifications";
import { chaine, cleDuGenre, detailDe, seMontreIci } from "@/lib/libelle-de-notification";
import { CIBLE_COQUE } from "@/capabilities/coque";
import { office } from "@/verticals/malica-office/composition";
import { useRevenir } from "@/hooks/use-revenir";

export const Route = createFileRoute("/_authenticated/pme/notifications")({
  head: () => ({
    meta: [
      { title: "Notifications — Malica Office" },
      {
        name: "description",
        content:
          "Les retours de votre comptabilité et les validations, avec le motif gouverné et le lien vers la pièce concernée. Aucune notification-appât.",
      },
      { property: "og:title", content: "Notifications — Malica Office" },
      {
        property: "og:description",
        content: "Retours motivés de votre comptabilité et validations, rien d'autre.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PmeNotifications,
});

const OU = "routes/_authenticated/pme.notifications";

function PmeNotifications() {
  const { t, locale } = useI18n();
  const pme = usePme();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const revenir = useRevenir();

  /*
   * PLANCHE 2 (approuvée le 7 novembre 2026) : quatre onglets, une société ou
   * toutes, les non lues seules si l'on veut. Par défaut : ce qui attend un
   * geste, toutes sociétés — ce que compte la pastille de la cloche.
   */
  const [onglet, setOnglet] = useState<Onglet>("aTraiter");
  const [societe, setSociete] = useState<string | null>(null);
  const [nonLuesSeulement, setNonLuesSeulement] = useState(false);
  const [ouverts, setOuverts] = useState<ReadonlySet<string>>(new Set());

  const societes = pme.dossiers.length > 0 ? pme.dossiers.map((d) => d.id) : [pme.tenantId];
  const plusieurs = pme.dossiers.length > 1;
  const nomDe = (id: string) => pme.dossiers.find((d) => d.id === id)?.name ?? null;

  const notifs = useQuery({
    /*
     * TOUTES les sociétés de la personne, comme la cloche qui mène ici : une
     * alerte de B annoncée pendant que A est ouverte se trouve sur cet écran,
     * et la lire éteint la pastille (revue de #270).
     */
    queryKey: ["notifications", "toutes", ...societes],
    queryFn: () => office().collab.notifications(societes),
  });

  /*
   * Lire se voit AUSSITÔT : la ligne passe en lue avant la réponse du
   * serveur, et revient si le serveur refuse. Le préfixe `notifications`
   * rafraîchit ensuite cet écran ET la cloche.
   */
  const cle = ["notifications", "toutes", ...societes];
  const lire = useMutation({
    mutationFn: async (ids: string[]) => {
      for (let i = 0; i < ids.length; i += 500)
        await office().collab.markAllRead(ids.slice(i, i + 500));
    },
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: cle });
      const avant = qc.getQueryData<Notification[]>(cle);
      const maintenant = new Date().toISOString();
      const lues = new Set(ids);
      qc.setQueryData<Notification[]>(cle, (l) =>
        l?.map((n) => (lues.has(n.id) && !n.readAt ? { ...n, readAt: maintenant } : n)),
      );
      return { avant };
    },
    onError: (_e, _ids, ctx) => {
      if (ctx?.avant) qc.setQueryData(cle, ctx.avant);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const kindLabel = (kind: string, payload: Record<string, unknown> = {}) =>
    t(cleDuGenre(kind, payload));

  // Dans la coque, rien ne parle d'abonnement (`seMontreIci`).
  const rows = (notifs.data ?? []).filter((n) => seMontreIci(n.kind, CIBLE_COQUE));
  const nombres = compteurs(rows, societe);
  const sections = trier(rows, { onglet, societe, nonLuesSeulement });
  const nonLuesIci = sections.flatMap((s) =>
    s.groupes.flatMap((g) => g.elements.filter((n) => !n.readAt).map((n) => n.id)),
  );
  const panne = notifs.error ?? lire.error;

  /** Le jour, ou l'heure si c'est aujourd'hui. */
  const jour = (iso: string) => jourOuInstant(iso, locale, { day: "2-digit", month: "short" });

  /**
   * La pièce dont la carte parle, si elle existe encore. Une suppression
   * accordée : la pièce n'existe plus, rien ne s'y ouvre ni ne s'y montre.
   */
  const pieceDe = (kind: string, payload: Record<string, unknown>): string | null => {
    const pieceId = chaine(payload, "piece_id");
    return pieceId && !laReponseAEffaceLaPiece(kind, payload) ? pieceId : null;
  };

  /**
   * Le geste que l'alerte demande, et rien d'autre : ouvrir la pièce dont
   * elle parle, ou aller répondre au mandat proposé. Sans destination,
   * `null` — la ligne garde son seul « Lu ».
   */
  const gesteDe = (
    kind: string,
    payload: Record<string, unknown>,
    tenantId: string,
  ): { libelle: string; aller: () => void } | null => {
    // La fiche d'une pièce et le mandat se lisent sur la société OUVERTE :
    // une alerte d'une autre société ouvre d'abord la sienne.
    const dabord = () => {
      if (tenantId !== pme.tenantId) pme.choisirDossier(tenantId);
    };
    const pieceId = pieceDe(kind, payload);
    if (pieceId) {
      return {
        libelle: kind === "piece.demande" ? t("pme.notifs.repondre") : t("pme.notifs.open"),
        aller: () => {
          dabord();
          void navigate({ to: "/pme/piece/$pieceId", params: { pieceId } });
        },
      };
    }
    if (
      kind === "acces.propose" ||
      kind === "acces.descente_demandee" ||
      kind === "acces.monte" ||
      kind === "acces.arrete"
    ) {
      return {
        libelle: t("pme.notifs.voirProposition"),
        aller: () => {
          dabord();
          void navigate({ to: "/pme/reglages", search: { page: "abonnement" } });
        },
      };
    }
    if (kind === "place.suggeree" || kind === "place.donnee") {
      return {
        libelle: t("pme.notifs.voirEquipe"),
        aller: () => {
          dabord();
          void navigate({ to: "/pme/reglages", search: { page: "utilisateurs" } });
        },
      };
    }
    if (kind === "mandat.propose") {
      return {
        libelle: t("pme.mandat.accepter"),
        aller: () => {
          dabord();
          void navigate({ to: "/pme" });
        },
      };
    }
    return null;
  };

  /** Ce qui se lit sous le titre : le détail, la société si on les voit toutes, le jour. */
  const sousTitre = (n: Notification) => {
    const payload = (n.payload ?? {}) as Record<string, unknown>;
    const detail = detailDe(n.kind, payload);
    const cite = n.kind === "piece.retournee" || n.kind === "piece.demande_tranchee";
    return [
      detail ? (cite ? `« ${detail} »` : detail) : null,
      plusieurs && societe === null ? nomDe(n.tenantId) : null,
      jour(n.createdAt),
    ]
      .filter(Boolean)
      .join(" · ");
  };

  const basculer = (cleGroupe: string) =>
    setOuverts((o) => {
      const n = new Set(o);
      if (n.has(cleGroupe)) n.delete(cleGroupe);
      else n.add(cleGroupe);
      return n;
    });

  /** Une alerte : son signe, son titre, ce qu'elle dit, ses gestes. */
  const ligne = (n: Notification) => {
    const payload = (n.payload ?? {}) as Record<string, unknown>;
    const geste = gesteDe(n.kind, payload, n.tenantId);
    const piece = pieceDe(n.kind, payload);
    return (
      <Glissable key={n.id} actif={!n.readAt} onLu={() => lire.mutate([n.id])}>
        <div className="nt" data-lue={n.readAt ? "" : undefined}>
          <span className="sg" data-source={sourceDe(n.kind)} aria-hidden>
            {piece ? (
              <ApercuDePiece pieceId={piece} className="vignette" />
            ) : (
              <IconeDe kind={n.kind} />
            )}
          </span>
          <span className="bd">
            <b>{kindLabel(n.kind, payload)}</b>
            <span>{sousTitre(n)}</span>
          </span>
          <span className="ac">
            {geste ? (
              <button type="button" onClick={geste.aller}>
                {geste.libelle}
              </button>
            ) : null}
            {!n.readAt ? (
              <button
                type="button"
                className="lu"
                aria-label={t("pme.notifs.markRead")}
                onClick={() => lire.mutate([n.id])}
              >
                <svg viewBox="0 0 24 24" className="g" aria-hidden>
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              </button>
            ) : null}
          </span>
        </div>
      </Glissable>
    );
  };

  return (
    <div
      data-ecran="notifications"
      data-famille="papiers"
      className="-mx-4 -my-5 flex min-h-0 flex-1 flex-col"
    >
      {/* ── la barre du haut : retour, titre, « Tout lire » ─────────────── */}
      <div className="top">
        <button
          type="button"
          className="bk"
          aria-label={t("pme.regler.retour")}
          onClick={() => revenir("/pme")}
        >
          <svg viewBox="0 0 24 24" className="g" aria-hidden>
            <path d="M14.5 5.5L8 12l6.5 6.5" />
          </svg>
        </button>
        <span className="ttl">{t("pme.notifs.title")}</span>
        <button
          type="button"
          className="tl"
          disabled={nonLuesIci.length === 0 || lire.isPending}
          onClick={() => lire.mutate(nonLuesIci)}
        >
          {t("pme.notifs.toutLire")}
        </button>
      </div>

      <div className="pad">
        {/* ── les quatre onglets ─────────────────────────────────────── */}
        <div className="seg ong" role="tablist">
          {(
            [
              ["aTraiter", t("pme.notifs.onglet.aTraiter")],
              ["comptabilite", t("pme.notifs.onglet.comptabilite")],
              ["malica", t("pme.notifs.onglet.malica")],
              ["tout", t("cab.plan.filter.tout")],
            ] as const
          ).map(([cleOnglet, libelle]) => (
            <button
              key={cleOnglet}
              type="button"
              role="tab"
              className={onglet === cleOnglet ? "on" : undefined}
              aria-selected={onglet === cleOnglet}
              onClick={() => setOnglet(cleOnglet)}
            >
              {libelle}
              {(cleOnglet === "aTraiter" || cleOnglet === "tout") && nombres[cleOnglet] > 0 ? (
                <em>{nombres[cleOnglet] > 99 ? "99+" : nombres[cleOnglet]}</em>
              ) : null}
            </button>
          ))}
        </div>

        {/* ── la société, et les non lues seules ─────────────────────── */}
        <div className="flt">
          {plusieurs ? (
            <label className="soc">
              <span className="sr-only">{t("pme.notifs.societe")}</span>
              <select
                value={societe ?? ""}
                onChange={(e) => setSociete(e.target.value === "" ? null : e.target.value)}
              >
                <option value="">{t("pme.notifs.toutesSocietes")}</option>
                {[...pme.dossiers]
                  .sort((a, b) => a.name.localeCompare(b.name, locale))
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
              </select>
            </label>
          ) : null}
          <button
            type="button"
            className="chip"
            aria-pressed={nonLuesSeulement}
            onClick={() => setNonLuesSeulement((v) => !v)}
          >
            {t("pme.notifs.nonLues")}
          </button>
        </div>

        {panne ? (
          <div className="card" role="alert">
            <p>{texteDeLErreur(panne, OU, t("common.error"))}</p>
          </div>
        ) : null}

        {notifs.isPending ? (
          <div className="squel" aria-busy="true" aria-label={t("common.loading")}>
            <i />
            <i />
            <i />
          </div>
        ) : notifs.isError ? null : rows.length === 0 ? (
          /* La boîte est vide, et c'est elle qui le dit — sans rien promettre. */
          <>
            <div className="sgn">
              <span className="ph">
                <img src={portraitMalica} alt="Malica" width={620} height={620} />
              </span>
              <b>{t("malica.chat.her")}</b>
            </div>
            <div className="dit">
              {t("pme.notifs.empty")}
              <em>{t("pme.notifications.videSous")}</em>
            </div>
          </>
        ) : sections.length === 0 ? (
          <p className="rien">{t("pme.notifs.rienIci")}</p>
        ) : (
          sections.map((section) => (
            <section key={section.periode}>
              <div className="sec">
                <h2>
                  {section.periode === "semaine"
                    ? t("pme.notifs.cetteSemaine")
                    : t("pme.notifs.plusTot")}
                </h2>
              </div>
              {section.groupes.map((g) => {
                if (g.elements.length === 1) return ligne(g.elements[0]!);
                /*
                 * LE REGROUPEMENT : neuf retours du cabinet sont UNE ligne,
                 * avec leur nombre, un exemple, et de quoi les voir ou les
                 * lire d'un coup.
                 */
                const premier = g.elements[0]!;
                const payload = (premier.payload ?? {}) as Record<string, unknown>;
                const ouvert = ouverts.has(g.cle);
                const aLire = g.elements.filter((n) => !n.readAt).map((n) => n.id);
                return (
                  <div key={g.cle} className="grp" data-ouvert={ouvert || undefined}>
                    <Glissable actif={aLire.length > 0} onLu={() => lire.mutate(aLire)}>
                      <div className="nt" data-lue={aLire.length === 0 ? "" : undefined}>
                        <span className="sg" data-source={sourceDe(g.kind)} aria-hidden>
                          <b className="nb">{g.elements.length}</b>
                        </span>
                        <span className="bd">
                          <b>{kindLabel(g.kind, payload)}</b>
                          <span>
                            {[t("pme.notifs.regroupees"), sousTitre(premier)].join(" · ")}
                          </span>
                        </span>
                        <span className="ac">
                          <button
                            type="button"
                            aria-expanded={ouvert}
                            onClick={() => basculer(g.cle)}
                          >
                            {ouvert
                              ? t("pme.notifs.replier")
                              : t("pme.notifs.voirLes", { count: g.elements.length })}
                          </button>
                          {aLire.length > 0 ? (
                            <button
                              type="button"
                              className="lu"
                              aria-label={t("pme.notifs.markRead")}
                              onClick={() => lire.mutate(aLire)}
                            >
                              <svg viewBox="0 0 24 24" className="g" aria-hidden>
                                <path d="M5 12.5l4.5 4.5L19 7.5" />
                              </svg>
                            </button>
                          ) : null}
                        </span>
                      </div>
                    </Glissable>
                    {ouvert ? <div className="sous">{g.elements.map(ligne)}</div> : null}
                  </div>
                );
              })}
            </section>
          ))
        )}

        <p className="foot">{t("pme.regler.pied")}</p>
      </div>
    </div>
  );
}

/**
 * GLISSER POUR LIRE (planche 2) : sur le téléphone, une ligne poussée de côté
 * au-delà de 88 px se marque lue — la coche qui apparaît derrière le dit.
 * En deçà, elle revient. Le bouton « Lu » reste : le geste n'est qu'un
 * raccourci, et le clavier ou un lecteur d'écran n'en dépendent pas.
 */
function Glissable({
  actif,
  onLu,
  children,
}: {
  actif: boolean;
  onLu: () => void;
  children: React.ReactNode;
}) {
  const [dx, setDx] = useState(0);
  const depart = useRef<{ x: number; y: number; id: number } | null>(null);
  const SEUIL = 88;
  if (!actif) return <>{children}</>;
  return (
    <div
      className="gl"
      style={{ "--dx": `${dx}px` } as React.CSSProperties}
      data-pret={Math.abs(dx) >= SEUIL || undefined}
      data-glisse={dx !== 0 || undefined}
      onPointerDown={(e) => {
        if (e.pointerType === "mouse") return;
        depart.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
      }}
      onPointerMove={(e) => {
        const d = depart.current;
        if (!d || d.id !== e.pointerId) return;
        const ex = e.clientX - d.x;
        // Un défilement vertical n'est pas un glissement.
        if (Math.abs(e.clientY - d.y) > Math.abs(ex) && Math.abs(ex) < 12) return;
        setDx(ex);
      }}
      onPointerUp={() => {
        if (Math.abs(dx) >= SEUIL) onLu();
        depart.current = null;
        setDx(0);
      }}
      onPointerCancel={() => {
        depart.current = null;
        setDx(0);
      }}
    >
      <span className="fond" aria-hidden>
        <svg viewBox="0 0 24 24" className="g">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </span>
      {children}
    </div>
  );
}

/** Le signe d'une alerte sans pièce : le cabinet, Malica, ou une feuille. */
function IconeDe({ kind }: { kind: string }) {
  const source = sourceDe(kind);
  if (source === "comptabilite") return <IconeCabinet />;
  if (source === "malica")
    return (
      <svg viewBox="0 0 24 24" className="g">
        <path d="M12 3.5l1.9 4.6 4.6 1.9-4.6 1.9L12 16.5l-1.9-4.6L5.5 10l4.6-1.9z" />
        <path d="M18.5 15.5l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8z" />
      </svg>
    );
  return <IconePiece />;
}

/* ===========================================================================
 *
 *   LES SIGNES DU DESSIN
 *
 * Repris trait pour trait de `malica-manquants.html`. Ils portent `class="g"`,
 * la seule regle d'icone commune aux dix ecrans : `stroke:currentColor`,
 * `fill:none`, bouts arrondis. La taille vient toujours du contexte
 * (`.top .ic svg`, `.rw i svg`), jamais de l'icone.
 */

/** Deux personnes - le cabinet. */
function IconeCabinet() {
  return (
    <svg viewBox="0 0 24 24" className="g">
      <circle cx="9" cy="9" r="3" />
      <circle cx="16.5" cy="10" r="2.4" />
      <path d="M3.5 19.5a5.5 5.5 0 0 1 11 0M14.5 19.5a4.5 4.5 0 0 1 6.5-3.4" />
    </svg>
  );
}

/** Une piece - la feuille au coin plie. */
function IconePiece() {
  return (
    <svg viewBox="0 0 24 24" className="g">
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4" />
      <path d="M9 12h6M9 15.5h6" />
    </svg>
  );
}
