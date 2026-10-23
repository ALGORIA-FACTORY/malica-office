import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import portraitMalica from "@/assets/malica.webp";
import { usePme } from "@/components/malica/pme-context";
import { LivrablesRecus } from "@/components/malica/livrables-recus";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { office } from "@/verticals/malica-office/composition";

export const Route = createFileRoute("/_authenticated/pme/regler")({
  head: () => ({
    meta: [
      { title: "Mon cabinet — Malica Office" },
      {
        name: "description",
        content: "Ce que votre comptable vous a retourné, ce qu'il vous a répondu, et pourquoi.",
      },
      { property: "og:title", content: "Mon cabinet — Malica Office" },
      {
        property: "og:description",
        content: "Ce que votre comptable vous a retourné, ce qu'il vous a répondu, et pourquoi.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ARegler,
});

const OU = "routes/_authenticated/pme.regler";

/** Les genres de conseil, tels que la base les pose — leur phrase est au dictionnaire. */
const CONSEIL: Record<string, MessageKey> = {
  "conseil.arbitrage": "notif.kind.conseil.arbitrage",
  "conseil.repondu": "notif.kind.conseil.repondu",
  "conseil.decide": "notif.kind.conseil.decide",
};

interface RetourPayload {
  piece_id?: string;
  motif_id?: string;
  note?: string | null;
}

function chaine(payload: Record<string, unknown>, cle: string): string | null {
  const v = payload[cle];
  return typeof v === "string" && v.trim().length > 0 ? v : null;
}

/**
 * Mon cabinet — le dessin validé (`livraison/ecrans/malica-manquants.html`,
 * écran « Cabinet »), porté sur la route qui portait déjà ses retours.
 *
 * ====================================================== POURQUOI CETTE ROUTE
 *
 * Le dossier de livraison désigne cet écran comme le sixième livrable :
 * « Le cabinet côté PME (`malica-manquants.html`, écran Cabinet) — deux
 * onglets : ses réponses, et les documents qu'il dépose. » Le câblage le
 * nomme `pme.cabinet.tsx` *(route à créer)*, mais la route existe déjà sous
 * un autre nom : `pme.regler` est, aujourd'hui, l'écran qui porte ce que le
 * cabinet réclame — les pièces qu'il a retournées avec leur motif gouverné.
 * On ne crée donc pas un doublon : on fait grandir celui-là. L'accueil y
 * mène déjà (`tile` du cabinet), et le lien ne change pas.
 *
 * ====================================================== POURQUOI « ENSEMBLE »
 *
 * Une pièce retournée n'est pas une faute du dirigeant. Le prototype le
 * disait dans son titre — « à régler ENSEMBLE » — et dans sa dernière
 * phrase : « aucune urgence ». Le ton n'a pas changé de propriétaire : c'est
 * `pme.regler.rassure`, et il reste sous la liste.
 *
 * ============================================================== D'OÙ ÇA VIENT
 *
 * De la notification, et de rien d'autre. Quand le cabinet retourne une
 * pièce, `socle_ecriture_review` inscrit `piece.retournee` avec le motif
 * gouverné et la note. Le motif est traduit par `ref.rejet_motifs`
 * (`supervision.motifs`) : la PME lit le MÊME libellé que l'expert a choisi,
 * pas une paraphrase.
 *
 * Les avis viennent du même canal, genres `conseil.*`. `conseil.file` n'est
 * PAS appelée : elle prend un `cabinetTenantId` et rend la file du cabinet
 * pour tous ses clients — une PME qui la lirait verrait les dossiers des
 * autres. Ce que la PME peut savoir de son avis, c'est ce que le cabinet lui
 * a notifié.
 *
 * ================================================ LE CSS EXISTE, ON NE L'ÉCRIT PAS
 *
 * `styles-pme.css` porte les règles du dessin sous
 * `[data-surface="pme"] [data-ecran="manquants"]`. Cet écran pose donc
 * `data-ecran="manquants"` et n'emploie QUE les classes relevées dans cette
 * feuille — `.top .bk .ttl .ic .sub .seg .sec .rw .card .hd .b .regle .sgn
 * .dit`, plus `.pad .foot .g`, qui sont au niveau de la surface. Aucune
 * classe utilitaire par-dessus : une seule contredirait le dessin.
 *
 * `.app` et `.nav` ne sont pas rendus — la coque et la barre du bas sont
 * tenues par le layout `pme.tsx`, une fois pour tous les écrans. Les marges
 * négatives annulent son `px-4 py-5` : `.top` et `.pad` portent leurs
 * gouttières, et le dessin ne veut pas de double gouttière.
 *
 * La rangée « Basic · Solo · Team · Premium » du dessin est une affordance de
 * maquette : elle n'est pas portée.
 *
 * =================================================== `.sec` VEUT DIRE DEUX CHOSES
 *
 * Dans cette feuille, `.sec` est à la fois le titre de section
 * (`.sec:not(button)`) et le bouton secondaire (`.card .b button.sec`). La
 * garde `:not(button)` fait le tri — à une condition : le bouton secondaire
 * doit être un VRAI `<button>`. « Voir la pièce » était un `<Link>`, donc un
 * `<a class="sec">` : il aurait reçu les 30 px de marge et le `display:flex`
 * du titre de section, et se serait affiché comme un titre. Il navigue
 * maintenant par `navigate()`. Rien n'est contourné ; c'est le balisage qui
 * s'aligne sur la feuille.
 *
 * ============================================ CE QUI N'EST PAS BRANCHÉ, ET POURQUOI
 *
 * - « Ses documents » reçoit les PV publiés du dépôt `collab`, avec une
 *   réception explicite. Les autres dépôts de fichiers restent hors de ce lot.
 * - « Il vous réclame un relevé » : aucun genre de notification ne porte une
 *   demande de document du cabinet vers la PME. La carte n'est pas inventée.
 * - « Vos demandes » : `collab.demandesDUnePiece` est par pièce. Une liste
 *   d'écran voudrait une requête par pièce — contre la règle « un écran, une
 *   fenêtre de données ». Et `collab.demanderSurPiece` est un geste de
 *   pièce : il reste sur `pme.piece.$pieceId`.
 * - Les variantes Premium du dessin (« 2 sur 3 sociétés », « Vos autres
 *   sociétés · 2 cabinets ») demanderaient un `monCabinet` par dossier.
 *   Elles attendent une méthode qui les rende en une fois.
 */
function ARegler() {
  const { t, locale } = useI18n();
  const pme = usePme();
  const navigate = useNavigate();

  /** Les deux faces du cabinet : ce qu'on s'échange, et ce qu'il nous remet. */
  const [onglet, setOnglet] = useState<"echanges" | "docs">("echanges");

  const notifs = useQuery({
    queryKey: ["notifications", pme.tenantId],
    queryFn: () => office().collab.notifications([pme.tenantId]),
  });

  const motifs = useQuery({
    queryKey: ["rejet-motifs", locale],
    queryFn: () => office().supervision.motifs(locale),
  });

  const cabinet = useQuery({
    queryKey: ["mon-cabinet", pme.tenantId],
    queryFn: () => office().identity.monCabinet(pme.tenantId),
    staleTime: 10 * 60 * 1000,
  });

  const pieces = useQuery({
    queryKey: ["pieces-lues", pme.tenantId],
    queryFn: () => office().capture.listAvecLecture(pme.tenantId),
  });

  const nomDuCabinet = cabinet.data?.name ?? t("pme.coffre.votreComptable");

  // Seules les pièces ENCORE retournées : une pièce reprise puis
  // recomptabilisée ne doit plus figurer ici, même si sa notification reste.
  const enAttente = (pieces.data ?? []).filter((p) => p.status === "retournee");

  const retours = (notifs.data ?? [])
    .filter((n) => n.kind === "piece.retournee")
    .map((n) => ({ notif: n, charge: (n.payload ?? {}) as RetourPayload }))
    .filter((r) => enAttente.some((p) => p.id === r.charge.piece_id));

  /** Ce que le cabinet a répondu sur une question de conseil. */
  const avis = (notifs.data ?? []).filter((n) => n.kind.startsWith("conseil."));

  const libelleDuMotif = (id: string | undefined) =>
    (motifs.data ?? []).find((m) => m.id === id)?.label ?? t("pme.regler.motifInconnu");

  const emetteur = (pieceId: string | undefined) =>
    // Une pièce en attente de règlement a forcément été lue : le repli
    // « pas encore lue » y serait faux à tous les coups.
    enAttente.find((p) => p.id === pieceId)?.emetteur ?? t("pme.list.sansEmetteur");

  const jour = (iso: string) =>
    new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", timeZone: "UTC" }).format(
      new Date(iso),
    );

  const panne = notifs.error ?? pieces.error ?? cabinet.error ?? null;
  const chargement = notifs.isPending || pieces.isPending || cabinet.isPending;

  return (
    /*
     * `data-ecran="manquants"` : le marqueur qui fait descendre sur cet arbre
     * les règles du dessin. Le nom est celui du fichier de maquette
     * (`malica-manquants.html`, « les écrans qui manquaient »), pas une
     * description de l'écran — la feuille le porte déjà ainsi.
     */
    <div
      data-ecran="manquants"
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
        <span className="ttl">{t("pme.regler.barre")}</span>
        <span className="ic" aria-hidden>
          <IconeCabinet />
        </span>
      </div>

      <div className="pad">
        {/* Le cabinet, nommé. `null` → on ne lui invente pas un nom. */}
        <h1>
          {cabinet.isPending
            ? t("common.loading")
            : cabinet.isError
              ? t("relation.indisponible")
              : cabinet.data
                ? cabinet.data.name
                : t("pme.regler.sansCabinet")}
        </h1>
        <p className="sub">
          {cabinet.isSuccess
            ? cabinet.data
              ? t("pme.regler.sousMandat")
              : t("pme.regler.sousSansMandat")
            : null}
        </p>
        {cabinet.isSuccess && !cabinet.data ? (
          <p className="regle" role="status">
            {t("relation.historique")}
          </p>
        ) : null}

        {/* ── les deux onglets ───────────────────────────────────────── */}
        <div className="seg">
          <button
            type="button"
            className={onglet === "echanges" ? "on" : undefined}
            aria-pressed={onglet === "echanges"}
            onClick={() => setOnglet("echanges")}
          >
            {t("pme.regler.ongletEchanges")}
          </button>
          <button
            type="button"
            className={onglet === "docs" ? "on" : undefined}
            aria-pressed={onglet === "docs"}
            onClick={() => setOnglet("docs")}
          >
            {t("pme.regler.ongletDocuments")}
          </button>
        </div>

        {onglet === "docs" ? (
          <LivrablesRecus tenantId={pme.tenantId} />
        ) : (
          <>
            {panne ? (
              <div className="card" role="alert">
                <p>{texteDeLErreur(panne, OU, t("common.error"))}</p>
              </div>
            ) : null}

            {chargement ? (
              <p className="regle">
                <span>{t("common.loading")}</span>
              </p>
            ) : retours.length === 0 ? (
              /*
               * Rien n'est retourné, et c'est elle qui le dit — le ton est la
               * moitié de cet écran. Les deux phrases sont celles d'avant.
               */
              <>
                <div className="sgn">
                  <span className="ph">
                    <img src={portraitMalica} alt="Malica" width={620} height={620} />
                  </span>
                  <b>{t("malica.chat.her")}</b>
                </div>
                <div className="dit">
                  {t("pme.regler.rien.titre")}
                  <em>
                    {cabinet.data
                      ? t("pme.regler.rien.sous", { cabinet: nomDuCabinet })
                      : t("relation.sansMandat")}
                  </em>
                </div>
              </>
            ) : (
              <>
                <div className="sec">
                  <h2>{t("pme.regler.ilVousAttend")}</h2>
                  <span>{retours.length}</span>
                </div>

                {retours.map(({ notif, charge }) => (
                  <div key={notif.id} className="card">
                    {/*
                     * Le dessin met le motif dans l'en-tête de la carte, à la
                     * place où il écrit « Refusée ». C'est le bon endroit : le
                     * motif est GOUVERNÉ — il vient de `ref.rejet_motifs`, pas
                     * d'un texte libre — et le dirigeant lit donc le même mot
                     * que l'expert a choisi, à côté du nom de l'émetteur.
                     */}
                    <div className="hd">
                      <b>{emetteur(charge.piece_id)}</b>
                      <span>
                        {t("pme.regler.motif")} {libelleDuMotif(charge.motif_id)}
                      </span>
                    </div>

                    {/*
                     * Un seul paragraphe, et c'est le dessin qui le veut ainsi :
                     * la note du cabinet telle qu'il l'a écrite, puis ce qu'elle
                     * demande. `.card p` porte `margin:0` et la feuille n'a pas
                     * de règle `p+p` ici — deux paragraphes se toucheraient.
                     */}
                    <p>
                      {charge.note ? `« ${charge.note} » ` : ""}
                      {t("pme.regler.demande", {
                        cabinet: nomDuCabinet,
                        emetteur: emetteur(charge.piece_id),
                      })}
                    </p>

                    <div className="b">
                      {/*
                       * Le geste principal : rouvrir l'obturateur. C'est le
                       * même chemin que la barre du bas — scanner de
                       * l'appareil s'il y en a un, le nôtre sinon.
                       */}
                      <button type="button" onClick={() => pme.ouvrirScanner()}>
                        {t("pme.regler.reprendre")}
                      </button>
                      {/*
                       * Un `<button class="sec">`, pas un `<Link>` : voir
                       * l'en-tête du fichier — `.sec` sur un `<a>` prendrait
                       * les règles du TITRE de section.
                       */}
                      <BoutonVoir
                        pieceId={charge.piece_id}
                        libelle={t("pme.regler.voir")}
                        ouvrir={(pieceId) =>
                          void navigate({ to: "/pme/piece/$pieceId", params: { pieceId } })
                        }
                      />
                    </div>
                  </div>
                ))}

                {/* Le ton, à la fin : aucune urgence. */}
                <p className="foot">{t("pme.regler.rassure")}</p>
              </>
            )}

            {/* ── ses avis ─────────────────────────────────────────────── */}
            {avis.length > 0 ? (
              <>
                <div className="sec">
                  <h2>{t(cabinet.data ? "pme.regler.sesAvis" : "relation.avisHistorique")}</h2>
                  <span>{avis.length}</span>
                </div>

                {avis.map((n) => {
                  const payload = (n.payload ?? {}) as Record<string, unknown>;
                  const theme = chaine(payload, "theme");
                  /*
                   * Un avis rendu est une action possible ; une question en
                   * relecture n'attend que le cabinet. La pastille ambre dit
                   * la seconde — c'est la seule chose qui les sépare.
                   */
                  const enRelecture = n.kind === "conseil.arbitrage";
                  /*
                   * La phrase du genre, au dictionnaire. Elle sert de TITRE
                   * quand la charge ne porte pas de thème — sans quoi la ligne
                   * dirait deux fois la même chose, en gras puis en petit.
                   */
                  const etat = !cabinet.data
                    ? t(
                        n.kind === "conseil.arbitrage"
                          ? "relation.avisSansSuivi"
                          : "relation.avisArchive",
                      )
                    : t(CONSEIL[n.kind] ?? "cab.notif.kind.autre");
                  return (
                    /*
                     * Une `<div>`, pas un `<button>` : le dessin fait de cette
                     * ligne un bouton, mais il n'y a aucun écran où aller —
                     * `pme.malica`, qui portera le fil du conseil, n'existe
                     * pas. Un bouton qui ne mène nulle part est pire qu'une
                     * ligne qui se lit. Elle redeviendra un bouton avec la
                     * route, et c'est une ligne à changer.
                     */
                    <div key={n.id} className="rw">
                      <i className={enRelecture ? "am" : undefined}>
                        <IconePiece />
                      </i>
                      <span className="bd">
                        <b>{theme ?? etat}</b>
                        {theme ? <span className={enRelecture ? "am" : "acc"}>{etat}</span> : null}
                      </span>
                      <span className="rt">
                        <span className="dt">{jour(n.createdAt)}</span>
                      </span>
                    </div>
                  );
                })}
              </>
            ) : null}

            <p className="foot">{t(cabinet.data ? "pme.regler.pied" : "relation.historique")}</p>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * « Voir la pièce » — le bouton secondaire, et il ne paraît que s'il mène
 * quelque part.
 *
 * Une notification de retour sans `piece_id` existe : le genre est posé par
 * la base, la charge est libre. Sans l'identifiant, le bouton n'aurait pas de
 * destination — il ne s'affiche pas, et la carte garde son geste principal.
 */
function BoutonVoir({
  pieceId,
  libelle,
  ouvrir,
}: {
  pieceId: string | undefined;
  libelle: string;
  ouvrir: (pieceId: string) => void;
}) {
  if (!pieceId) return null;
  return (
    <button type="button" className="sec" onClick={() => ouvrir(pieceId)}>
      {libelle}
    </button>
  );
}

/* ===========================================================================
 *
 *   LES SIGNES DU DESSIN
 *
 * Repris trait pour trait de `malica-manquants.html`. Ils portent `class="g"`,
 * la seule règle d'icône commune aux dix écrans : `stroke:currentColor`,
 * `fill:none`, bouts arrondis. La taille vient toujours du contexte
 * (`.top .ic svg`, `.rw i svg`, `.regle svg`), jamais de l'icône.
 */

/** Deux personnes — le cabinet. */
function IconeCabinet() {
  return (
    <svg viewBox="0 0 24 24" className="g">
      <circle cx="9" cy="9" r="3" />
      <circle cx="16.5" cy="10" r="2.4" />
      <path d="M3.5 19.5a5.5 5.5 0 0 1 11 0M14.5 19.5a4.5 4.5 0 0 1 6.5-3.4" />
    </svg>
  );
}

/** Une pièce — la feuille au coin plié. */
function IconePiece() {
  return (
    <svg viewBox="0 0 24 24" className="g">
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4" />
      <path d="M9 12h6M9 15.5h6" />
    </svg>
  );
}
