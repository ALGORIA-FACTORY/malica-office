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
import { useState } from "react";

import malicaLoin from "@/assets/malica-loin.webp";
import { usePme } from "@/components/malica/pme-context";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { office } from "@/verticals/malica-office/composition";

export const Route = createFileRoute("/_authenticated/pme/notifications")({
  head: () => ({
    meta: [
      { title: "Notifications — Malica Office" },
      {
        name: "description",
        content:
          "Les retours du cabinet et les validations, avec le motif gouverné et le lien vers la pièce concernée. Aucune notification-appât.",
      },
      { property: "og:title", content: "Notifications — Malica Office" },
      {
        property: "og:description",
        content: "Retours motivés du cabinet et validations, rien d'autre.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PmeNotifications,
});

/** Les genres que la base pose sur le dossier d'une PME, et leur phrase. */
const GENRES: Record<string, MessageKey> = {
  "piece.retournee": "notif.kind.piece.retournee",
  "piece.validee": "notif.kind.piece.validee",
  "piece.partagee": "notif.kind.piece.partagee",
  "pv.envoye": "notif.kind.pv.envoye",
  "mandat.propose": "notif.kind.mandat.propose",
  "mandat.accepte": "notif.kind.mandat.accepte",
  "mandat.refuse": "notif.kind.mandat.refuse",
  // ANO-037 : ces genres arrivent aussi sur le dossier de la PME, et
  // tombaient sous « Un événement du dossier. ».
  "mandat.revoque": "notif.kind.mandat.revoque",
  "piece.a_valider": "notif.kind.piece.a_valider",
  "piece.a_revalider": "notif.kind.piece.a_revalider",
  "piece.demande_tranchee": "notif.kind.piece.demande_tranchee",
  "acces.propose": "notif.kind.acces.propose",
  "acces.accepte": "notif.kind.acces.accepte",
  "acces.repris": "notif.kind.acces.repris",
  "conseil.arbitrage": "notif.kind.conseil.arbitrage",
  "conseil.repondu": "notif.kind.conseil.repondu",
  "conseil.decide": "notif.kind.conseil.decide",
};

const OU = "routes/_authenticated/pme.notifications";

/* ===========================================================================
 *
 *   LES CHAINES NOUVELLES - UN SEUL BLOC, ET C'EST UNE DETTE NOMMEE
 *
 * Le dessin apporte du texte que le dictionnaire ne porte pas encore. Il est
 * ici, en un seul endroit, en francais seulement, comme sur `pme.regler.tsx` :
 * ce bloc est a vider dans `packages/socle/src/messages.ts` - cles proposees
 * `pme.cabinet.*` - des que les trois langues peuvent etre ecrites ensemble.
 * `MOTS.pied` est le MEME pied que celui de `pme.regler.tsx` : les deux
 * ecrans rendent le meme dessin, et la chaine est a mutualiser au meme
 * moment.
 *
 * Tout le reste de l'ecran lit `t()` : `pme.notifs.*`, `pme.mandat.accepter`,
 * `pme.regler.retour`, `malica.chat.her`, `notif.kind.*` et `common.*`
 * existent et ne sont pas touchees. On remplace le balisage, pas le cablage.
 */
const MOTS = {
  /** Ce que la boite est, sous le titre. */
  sous: "Tout ce que votre cabinet vous dit arrive ici. Ce qui attend un geste est en haut.",
  ongletAttente: "À traiter",
  ongletTout: "Tout",
  ilVousAttend: "Il vous attend",
  sesAvis: "Ses avis",
  /** La seconde ligne de la bulle, quand la boite est vide. */
  videSous: "Rien n'est caché : quand votre cabinet vous écrit, c'est ici que ça arrive.",
  pied: "Les retours sur pièces et les avis arrivent du même cabinet, donc de la même boîte. Ce qui les sépare n'est pas l'écran : c'est ce qu'ils vous demandent de faire.",
} as const;

function chaine(payload: Record<string, unknown>, cle: string): string | null {
  const v = payload[cle];
  return typeof v === "string" && v.trim().length > 0 ? v : null;
}

/**
 * Ce que la notification porte en plus de son genre : un titre de PV et le
 * cabinet qui l'envoie, le cabinet qui propose, le sujet d'une question, la
 * note d'un retour. Tel que range, jamais recompose.
 */
function detailDe(kind: string, payload: Record<string, unknown>): string | null {
  if (kind === "pv.envoye") {
    return (
      [chaine(payload, "titre"), chaine(payload, "cabinet")].filter(Boolean).join(" · ") || null
    );
  }
  if (kind.startsWith("mandat.")) return chaine(payload, "cabinet");
  if (kind.startsWith("conseil.")) return chaine(payload, "theme");
  return chaine(payload, "note");
}

function PmeNotifications() {
  const { t, locale } = useI18n();
  const pme = usePme();
  const qc = useQueryClient();
  const navigate = useNavigate();

  /** Les deux faces de la boite : ce qui attend un geste, et tout. */
  const [onglet, setOnglet] = useState<"attente" | "tout">("attente");

  const notifs = useQuery({
    queryKey: ["notifications", pme.tenantId],
    queryFn: () => office().collab.notifications([pme.tenantId]),
  });

  const read = useMutation({
    mutationFn: (id: string) => office().collab.markRead(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications", pme.tenantId] }),
  });

  const kindLabel = (kind: string) => t(GENRES[kind] ?? "cab.notif.kind.autre");

  const rows = notifs.data ?? [];
  /** Non lue : elle demande encore quelque chose. C'est une carte. */
  const attente = rows.filter((n) => !n.readAt);
  /** Lues, et ce sont des avis : le volet que le dessin appelle « Ses avis ». */
  const avis = rows.filter((n) => n.readAt !== null && n.kind.startsWith("conseil."));
  /** Lues, et ce ne sont pas des avis : elles ne demandent plus rien. */
  const classees = rows.filter((n) => n.readAt !== null && !n.kind.startsWith("conseil."));
  const panne = notifs.error ?? read.error;

  /** L'instant, pour l'en-tete d'une carte : le mono du dessin le porte. */
  const instant = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));

  /** Le jour seul, pour la colonne de droite d'une ligne. */
  const jour = (iso: string) =>
    new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", timeZone: "UTC" }).format(
      new Date(iso),
    );

  /**
   * Le geste que le CABINET demande, et rien d'autre : ouvrir la piece dont
   * il parle, ou aller repondre au mandat qu'il propose. Sans destination,
   * `null` - la carte garde son seul accuse de lecture.
   */
  const gesteDe = (
    kind: string,
    payload: Record<string, unknown>,
  ): { libelle: string; aller: () => void } | null => {
    const pieceId = chaine(payload, "piece_id");
    if (pieceId) {
      return {
        libelle: t("pme.notifs.open"),
        aller: () => void navigate({ to: "/pme/piece/$pieceId", params: { pieceId } }),
      };
    }
    if (kind === "mandat.propose") {
      return {
        libelle: t("pme.mandat.accepter"),
        aller: () => void navigate({ to: "/pme" }),
      };
    }
    return null;
  };

  return (
    <div
      data-ecran="notifications"
      data-famille="papiers"
      className="-mx-4 -my-5 flex min-h-0 flex-1 flex-col"
    >
      {/* ── la barre du haut ───────────────────────────────────────────── */}
      <div className="top">
        <button
          type="button"
          className="bk"
          aria-label={t("pme.regler.retour")}
          onClick={() => void navigate({ to: "/pme" })}
        >
          <svg viewBox="0 0 24 24" className="g" aria-hidden>
            <path d="M14.5 5.5L8 12l6.5 6.5" />
          </svg>
        </button>
        <span className="ttl">{t("pme.notifs.title")}</span>
        <span className="ic" aria-hidden>
          <IconeCabinet />
        </span>
      </div>

      <div className="pad">
        {/*
         * Le titre dit ou l'on en est - c'est la phrase que la voix de Malica
         * portait avant, au mot pres. Le sous-titre dit ce qu'est la boite.
         */}
        <h1>
          {rows.length === 0
            ? t("pme.notifs.voice.empty")
            : attente.length === 0
              ? t("pme.notifs.voice.clear")
              : t("pme.notifs.voice.unread", { count: attente.length })}
        </h1>
        <p className="sub">{MOTS.sous}</p>

        {/* ── les deux faces ─────────────────────────────────────────── */}
        <div className="seg">
          <button
            type="button"
            className={onglet === "attente" ? "on" : undefined}
            aria-pressed={onglet === "attente"}
            onClick={() => setOnglet("attente")}
          >
            {MOTS.ongletAttente}
          </button>
          <button
            type="button"
            className={onglet === "tout" ? "on" : undefined}
            aria-pressed={onglet === "tout"}
            onClick={() => setOnglet("tout")}
          >
            {MOTS.ongletTout}
          </button>
        </div>

        {panne ? (
          <div className="card" role="alert">
            <p>{texteDeLErreur(panne, OU, t("common.error"))}</p>
          </div>
        ) : null}

        {notifs.isPending ? (
          <p className="sub">{t("common.loading")}</p>
        ) : notifs.isError ? null : rows.length === 0 ? (
          /* La boite est vide, et c'est elle qui le dit - sans rien promettre. */
          <>
            <div className="sgn">
              <span className="ph">
                <img src={malicaLoin} alt="Malica" width={620} height={620} />
              </span>
              <b>{t("malica.chat.her")}</b>
            </div>
            <div className="dit">
              {t("pme.notifs.empty")}
              <em>{MOTS.videSous}</em>
            </div>
          </>
        ) : (
          <>
            {/* ── il vous attend : les non lues, en cartes ───────────── */}
            {attente.length > 0 ? (
              <>
                <div className="sec">
                  <h2>{MOTS.ilVousAttend}</h2>
                  <span>{attente.length}</span>
                </div>

                {attente.map((n) => {
                  const payload = (n.payload ?? {}) as Record<string, unknown>;
                  const detail = detailDe(n.kind, payload);
                  const geste = gesteDe(n.kind, payload);
                  /*
                   * Sur un retour de piece, le detail EST la parole du
                   * cabinet - la note qu'il a ecrite. Elle se cite, entre
                   * guillemets, comme le dessin la cite. Ailleurs c'est un
                   * sujet ou un nom : il se lit tel quel.
                   */
                  const cite = n.kind === "piece.retournee";
                  return (
                    <div key={n.id} className="card">
                      <div className="hd">
                        <b>{kindLabel(n.kind)}</b>
                        <span>{instant(n.createdAt)}</span>
                      </div>
                      {detail ? <p>{cite ? `« ${detail} »` : detail}</p> : null}
                      <div className="b">
                        {/*
                         * R10 : le geste que le cabinet demande est le
                         * principal. Il n'est la que s'il mene quelque part.
                         */}
                        {geste ? (
                          <button type="button" onClick={geste.aller}>
                            {geste.libelle}
                          </button>
                        ) : null}
                        {/*
                         * R7 : un accuse de lecture, pas une reecriture du
                         * fait notifie. Secondaire quand le cabinet demande
                         * autre chose ; principal quand il ne demande rien,
                         * parce qu'alors c'est le seul geste de la carte.
                         */}
                        <button
                          type="button"
                          className={geste ? "sec" : undefined}
                          disabled={read.isPending}
                          onClick={() => read.mutate(n.id)}
                        >
                          {t("pme.notifs.markRead")}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </>
            ) : null}

            {onglet === "tout" ? (
              <>
                {/* ── ses avis ────────────────────────────────────────── */}
                {avis.length > 0 ? (
                  <>
                    <div className="sec">
                      <h2>{MOTS.sesAvis}</h2>
                      <span>{avis.length}</span>
                    </div>
                    {avis.map((n) => {
                      const payload = (n.payload ?? {}) as Record<string, unknown>;
                      const theme = chaine(payload, "theme");
                      const etat = kindLabel(n.kind);
                      /*
                       * R10 : seul `conseil.decide` est ce que l'expert a
                       * arrete - accent, on peut s'en prevaloir. Les deux
                       * autres genres sont une proposition de Malica en cours
                       * de relecture : ambre, et jamais autre chose.
                       */
                      const arrete = n.kind === "conseil.decide";
                      return (
                        /*
                         * Une `<div>`, pas un `<button>` : le dessin fait de
                         * cette ligne un bouton, mais `conseil.lire` n'est
                         * jamais appele en PME et aucun ecran ne porte le fil
                         * du conseil. Un bouton qui ne mene nulle part est
                         * pire qu'une ligne qui se lit.
                         */
                        <div key={n.id} className="rw">
                          <i className={arrete ? undefined : "am"}>
                            <IconePiece />
                          </i>
                          <span className="bd">
                            <b>{theme ?? etat}</b>
                            {theme ? <span className={arrete ? "acc" : "am"}>{etat}</span> : null}
                          </span>
                          <span className="rt">
                            <span className="dt">{jour(n.createdAt)}</span>
                          </span>
                        </div>
                      );
                    })}
                  </>
                ) : null}

                {/* ── ce qui ne demande plus rien ─────────────────────── */}
                {classees.length > 0 ? (
                  <>
                    <div className="sec">
                      <h2>{t("pme.notifs.list")}</h2>
                      <span>{classees.length}</span>
                    </div>
                    {classees.map((n) => {
                      const payload = (n.payload ?? {}) as Record<string, unknown>;
                      const detail = detailDe(n.kind, payload);
                      const geste = gesteDe(n.kind, payload);
                      const corps = (
                        <>
                          <i>
                            <IconePiece />
                          </i>
                          <span className="bd">
                            <b>{kindLabel(n.kind)}</b>
                            {detail ? <span>{detail}</span> : null}
                          </span>
                          <span className="rt">
                            <span className="dt">{jour(n.createdAt)}</span>
                          </span>
                        </>
                      );
                      /* Un bouton seulement s'il mene quelque part. */
                      return geste ? (
                        <button key={n.id} type="button" className="rw" onClick={geste.aller}>
                          {corps}
                        </button>
                      ) : (
                        <div key={n.id} className="rw">
                          {corps}
                        </div>
                      );
                    })}
                  </>
                ) : null}
              </>
            ) : null}

            <p className="foot">{MOTS.pied}</p>
          </>
        )}
      </div>
    </div>
  );
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
