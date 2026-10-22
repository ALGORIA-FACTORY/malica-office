import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { FileLocale } from "@/components/malica/file-locale";
import { EtatDeLecture } from "@/components/malica/lecture-refusee";
import { usePme } from "@/components/malica/pme-context";
import { useI18n } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { montant } from "@/lib/lisible";
import { office } from "@/verticals/malica-office/composition";
import type { PieceLue } from "@malica/socle/ports/repositories";

export const Route = createFileRoute("/_authenticated/pme/coffre")({
  head: () => ({
    meta: [
      { title: "Mon espace — Malica Office" },
      {
        name: "description",
        content: "Ce que vous gardez pour vous seul, invisible au cabinet mandaté.",
      },
      { property: "og:title", content: "Mon espace — Malica Office" },
      {
        property: "og:description",
        content: "Ce que vous gardez pour vous seul, invisible au cabinet mandaté.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PmeCoffre,
});

const OU = "routes/_authenticated/pme.coffre";

/* ===========================================================================
 *
 *   LES CHAÎNES NOUVELLES — UN SEUL BLOC, ET C'EST UNE DETTE NOMMÉE
 *
 * Le dessin apporte du texte que le dictionnaire ne porte pas. Il est ici, en
 * un seul endroit, en français seulement — à vider dans `packages/socle/src/
 * messages.ts`, clés proposées `pme.prive.*`, dès que les trois langues
 * peuvent être écrites ensemble.
 *
 * Tout le reste de l'écran lit `t()`. Les clés `pme.prive.sous`,
 * `pme.prive.vide`, `pme.prive.transmettre`, `pme.coffre.wall`,
 * `pme.coffre.votreComptable`, `pme.nav.coffre`, `pme.list.*` et
 * `pme.status.*` existent en FR/EN/AR et ne sont PAS réécrites : une phrase
 * du dessin qui dit la même chose qu'une clé traduite ne vaut pas la perte
 * de deux langues.
 *
 * ================================= TROIS PHRASES DU DESSIN NE SONT PAS ÉCRITES
 *
 * Elles ne sont pas vraies de ce produit, et le dessin ne fait pas foi contre
 * le câblage :
 *
 * - `.sub` « Attaché à votre compte, pas à la société. Il vous suit si vous
 *   la quittez. » — faux : la liste est lue par `listAvecLecture(tenantId)`,
 *   donc attachée au DOSSIER. `t("pme.prive.sous")` dit ce qui est vrai.
 * - `.mur` « …et il n'y a aucun bouton pour transmettre. » — faux : le bouton
 *   de transmission est le seul geste de cet écran, et il reste.
 *   `t("pme.coffre.wall")` dit la cloison telle que la base la tient.
 * - `.sec` « dans les deux sens » — faux depuis le 11 octobre 2026 : le geste
 *   ne va QUE de `personnel` vers `partage`. Le compte des cartes prend la
 *   place de la note.
 */
const MOTS = {
  /** Le grand titre du dessin. La barre du haut garde `pme.nav.coffre`. */
  titre: "Vos papiers",
  /** Les deux sections du dessin. */
  vosDocuments: "Vos documents",
  bouger: "Ce qui peut encore bouger",
  /**
   * Le dessin écrit « …ou la supprimer sans demander à personne ».
   * `capture.supprimer` est au contrat mais cet écran ne l'appelle pas :
   * ajouter un geste est du recâblage, pas de l'habillage. La phrase s'arrête
   * donc à ce que l'écran fait.
   */
  libre:
    "Vous l'avez mise ici après l'avoir capturée. Elle n'est jamais partie au cabinet : vous pouvez encore la remettre dans la bibliothèque.",
  /**
   * Le dessin écrit « sa sortie passe par une demande ». Aucune méthode ne
   * porte cette demande — `collab.demanderSurPiece` est une question sur une
   * pièce, pas une demande de retrait. La phrase garde ce qui est tenu :
   * l'accord du cabinet, et le journal.
   */
  pied: "Une pièce transmise ne revient pas en silence : son retour demande l'accord de votre cabinet, et chaque passage s'inscrit au journal.",
} as const;

/**
 * Mon espace — ce que vous gardez pour vous.
 *
 * Le dessin validé (`malica-manquants.html`, écran « Espace privé »), porté
 * sur la route qui portait déjà ce mur et son seul geste. Identique aux
 * quatre forfaits : mesuré, les quatre rendus font 3 942 octets au bit près,
 * donc aucun bloc conditionnel d'abonnement.
 *
 * ============================================================ CE QUI EST VRAI
 *
 * Le prototype montre, côté comptable, des documents que le cabinet PRODUIT :
 * déclaration déposée, quittance, états financiers, dépôt RNE. Rien de tout
 * cela n'existe encore dans le produit — le cabinet ne dépose aucun document
 * vers la PME.
 *
 * L'écran portait donc, sous le nom « Le Coffre », L'INVERSE de ce que ce nom
 * annonce : la liste des pièces que la PME a transmises AU cabinet. Un coffre
 * qui montre ce qu'on a donné, et non ce qu'on a reçu.
 *
 * Cet onglet est supprimé. Une case vide en attendant le dépôt cabinet → PME
 * serait un titre qui promet, et le produit ne promet pas ce qu'il ne tient
 * pas. Ce qui a été transmis reste visible dans « Vos documents », avec son
 * statut — là où on le cherche vraiment.
 *
 * Cette décision est TENUE ici, et elle diverge du dessin : le dessin pose
 * une section « Vos documents » sur cet écran. Les deux cohabitent sans se
 * contredire parce que la section du dessin liste des pièces PERSONNELLES,
 * pas des documents reçus du cabinet — mais l'onglet « Ses documents » de
 * `pme.regler`, lui, reste vide et le dit. Rien n'est tranché ici.
 *
 * Reste ce qui EST vrai : le mur de visibilité, tenu par la RLS, et le seul
 * geste que la PME exerce dessus.
 *
 * ============================================================== LE SEUL GESTE
 *
 * Transmettre. Il bascule `vis` de `personnel` à `partage`, par la fonction
 * gouvernée du Socle qui le journalise.
 *
 * DANS CE SENS SEULEMENT, depuis le 11 octobre 2026. Ce commentaire disait
 * « dans l'autre sens aussi — une pièce partagée par erreur se reprend » ;
 * c'est faux désormais, et le code qui composait encore `personnel` pour une
 * pièce partagée est retiré. Une pièce que le cabinet a reçue ne revient que
 * par son accord, et c'est la BASE qui le refuse, plus le filtre de cette
 * liste.
 *
 * Le sens libre reste libre, et il le restera : « j'ai classé dans mon
 * coffre, j'aurai toujours la possibilité de transmettre au cabinet ».
 *
 * ================================================ LES DEUX SECTIONS, PAR LE STATUT
 *
 * Le dessin pose deux sections sur deux ensembles DISJOINTS de pièces : les
 * papiers posés, en rangées, et ce qui peut encore bouger, en cartes. La
 * seule chose qui sépare les deux dans les données est `reprenable()` — le
 * garde que cet écran portait déjà. Chaque pièce privée paraît donc une fois,
 * et une seule : en rangée si son sort est joué, en carte si la décision est
 * encore au dirigeant.
 *
 * La phrase `pme.coffre.scellee` n'est plus rendue, et c'est la seule perte :
 * elle expliquait l'absence d'un bouton dans une liste plate où le voisin en
 * avait un. Ici, aucune rangée ne porte de bouton — rien ne promet, donc rien
 * n'est à excuser — et le libellé du statut (« Comptabilisée », « Supervisée »)
 * porte le fait, dans les trois langues.
 *
 * ================================================ LE CSS EXISTE, ON NE L'ÉCRIT PAS
 *
 * `data-famille="papiers"` fait descendre les 125 règles de la famille ;
 * `data-ecran="coffre"` est l'identité que l'audit recense et que la règle
 * d'en-tête unique interroge. La vue rendue porte un `.top` : l'en-tête du
 * layout disparaît d'elle-même (`.app:has([data-ecran] .top) > header`), et
 * on n'en ajoute pas un second.
 *
 * `.app` et `.nav` ne sont pas rendus — la coque et la barre du bas sont
 * tenues par `pme.tsx`, une fois pour tous les écrans. `-mx-4 -my-5` annule
 * le `px-4 py-5` de son `<main>`.
 *
 * ===================================================== LA TEINTE DE L'ESPACE PRIVÉ
 *
 * Elle est peinte par la feuille, sur la coque, et cet écran n'a rien à poser
 * pour elle. Ce qui a demandé de corriger la feuille, pas de la contourner.
 *
 * Ce que la conversion avait relevé, et qui était juste : la feuille portait
 * DEUX règles pour ce fond, toutes deux injouables. La première voulait un
 * `.app` DESCENDANT de `[data-famille]` — or le seul `.app` de tout l'arbre
 * est celui du layout `pme.tsx`, et il est ANCÊTRE. En rendre un second ici
 * aurait rouvert la coque dans la coque (`max-width:440px`, `min-height:100vh`,
 * `padding-top:4.75rem`) : exactement la pile de doublons vue sur l'appareil.
 * La seconde voulait un attribut `data-prive` que, relevé, RIEN dans le dépôt
 * ne posait.
 *
 * La feuille descend donc maintenant comme la règle d'en-tête unique, par
 * `:has()`, depuis la coque vers l'écran qu'elle contient :
 *
 *   [data-surface="pme"] .app:has([data-ecran="coffre"]) { background: var(--prive) }
 *
 * et la variante `data-prive`, que personne ne posait, est partie (R9).
 *
 * Conséquence pour ce fichier : l'utilitaire `bg-prive` qui tenait lieu de
 * rustine sur la racine est retiré. La coque entière prend la teinte, barre du
 * bas comprise — ce que le dessin veut : on sait qu'on est chez soi, et ça ne
 * s'arrête pas au bord du contenu. Il ne reste donc sur la racine que les
 * marges négatives.
 */
function PmeCoffre() {
  const { t, locale } = useI18n();
  const pme = usePme();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [erreur, setErreur] = useState<string | null>(null);

  const pieces = useQuery({
    queryKey: ["pieces-lues", pme.tenantId],
    queryFn: () => office().capture.listAvecLecture(pme.tenantId),
  });

  const cabinet = useQuery({
    queryKey: ["mon-cabinet", pme.tenantId],
    queryFn: () => office().identity.monCabinet(pme.tenantId),
    staleTime: 10 * 60 * 1000,
  });

  const basculer = useMutation({
    mutationFn: (p: PieceLue) => office().collab.setPieceVis(p.id, "partage"),
    onSuccess: async () => {
      setErreur(null);
      await qc.invalidateQueries({ queryKey: ["pieces-lues", pme.tenantId] });
      await qc.invalidateQueries({ queryKey: ["pieces", pme.tenantId] });
    },
    onError: (e: unknown) => setErreur(texteDeLErreur(e, OU, t("common.error"))),
  });

  // Seules les pièces gardées pour soi. Ce qui est parti chez le cabinet se
  // regarde dans « Vos documents », avec son statut.
  const visibles = (pieces.data ?? []).filter((p) => p.vis === "personnel");

  const nomDuCabinet = cabinet.data?.name ?? t("pme.coffre.votreComptable");

  /**
   * Une pièce ne se reprend que tant qu'elle n'est pas comptabilisée.
   *
   * Au-delà, le cabinet a bâti une écriture dessus : la retirer de son champ
   * de vision laisserait un fait comptable sans sa preuve. La base l'interdit,
   * et l'écran cesse de le proposer plutôt que de laisser essayer.
   */
  const reprenable = (p: PieceLue) => p.status === "capturee" || p.status === "lue";

  /** Les deux sections du dessin, et elles ne se chevauchent pas. */
  const bougent = visibles.filter((p) => reprenable(p));
  const posees = visibles.filter((p) => !reprenable(p));

  const jour = (p: PieceLue) => {
    const iso = p.dateDocument ?? p.createdAt;
    return new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "2-digit",
      timeZone: "UTC",
    }).format(new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso));
  };

  // Le titre suit le STATUT : une pièce lue sans émetteur n'est pas une pièce
  // non lue. Voir pme.list.tsx.
  const titreDe = (p: PieceLue) =>
    p.emetteur ?? (p.status === "capturee" ? t("pme.list.nonLue") : t("pme.list.sansEmetteur"));

  /**
   * Le montant, ou rien. `montant(null)` rend la chaîne vide, et c'est voulu :
   * « un montant absent n'est pas un montant nul ». La valeur ne s'affiche
   * donc pas plutôt que d'afficher un zéro qui n'a pas été lu.
   */
  const somme = (p: PieceLue) => {
    const rendu = montant(p.total, locale);
    return rendu === "" ? "" : `${rendu} ${p.devise ?? pme.currency}`;
  };

  const panne = pieces.error ?? null;

  return (
    <div
      data-ecran="coffre"
      data-famille="papiers"
      className="-mx-4 -my-5 flex min-h-0 flex-1 flex-col"
    >
      {/* ── la barre du haut ─────────────────────────────────────────────── */}
      <div className="top">
        <button
          type="button"
          className="bk"
          /*
           * Le libellé générique du retour n'existe qu'une fois, dans l'espace
           * de `pme.regler`. Emprunté plutôt que recopié en français seul :
           * une étiquette d'accessibilité dans la mauvaise langue est pire
           * qu'un nom de clé mal rangé.
           *
           * DETTE, et elle est nommée : `common.retour` n'existe pas dans
           * `packages/socle/src/messages.ts`. Les dix retours du produit
           * lisent donc une clé rangée sous l'écran « à régler », qui n'a
           * rien à voir avec eux. Le renommage appartient au socle, pas à
           * cet écran.
           */
          aria-label={t("pme.regler.retour")}
          onClick={() => void navigate({ to: "/pme" })}
        >
          <svg viewBox="0 0 24 24" className="g" aria-hidden>
            <path d="M14.5 5.5L8 12l6.5 6.5" />
          </svg>
        </button>
        <span className="ttl">{t("pme.nav.coffre")}</span>
        <span className="ic" aria-hidden>
          <IconeCadenas />
        </span>
      </div>

      <div className="pad">
        <h1>{MOTS.titre}</h1>
        <p className="sub">{t("pme.prive.sous")}</p>

        {/* Le mur. Il n'est pas décoratif : c'est la seule chose que le
            dirigeant veut savoir avant de déposer. */}
        <div className="mur">
          <IconeCadenas />
          <p>{t("pme.coffre.wall")}</p>
        </div>

        <FileLocale vis="personnel" />

        {panne || pieces.fetchStatus === "paused" ? (
          <div className="card" role="status">
            <p>
              {pieces.fetchStatus === "paused"
                ? t("common.horsLigne")
                : texteDeLErreur(panne, OU, t("common.error"))}
            </p>
            <button
              type="button"
              className="btn"
              disabled={pieces.fetchStatus === "paused"}
              onClick={() => void pieces.refetch()}
            >
              {t("common.reessayer")}
            </button>
          </div>
        ) : null}

        {erreur ? (
          <div className="card" role="alert">
            <p>{erreur}</p>
          </div>
        ) : null}

        {pieces.isPending && pieces.fetchStatus !== "paused" ? (
          <p className="foot">{t("common.loading")}</p>
        ) : !pieces.isSuccess && pieces.data === undefined ? null : visibles.length === 0 &&
          !pme.file.elements.some((e) => e.vis === "personnel") ? (
          <div className="card">
            <p>{t("pme.prive.vide")}</p>
          </div>
        ) : (
          <>
            {/* ── vos documents : ce qui est posé ──────────────────────── */}
            {posees.length > 0 ? (
              <>
                <div className="sec">
                  <h2>{MOTS.vosDocuments}</h2>
                  <span>{posees.length}</span>
                </div>

                {posees.map((p) => (
                  /*
                   * Un `<button>`, comme le dessin : `.rw` porte `border:0`,
                   * `background:none` et `cursor:pointer`, et la rangée mène
                   * au dossier de la pièce.
                   *
                   * Une seule icône pour toutes les rangées. Le dessin en
                   * dessine quatre — carte d'identité, logement, banque,
                   * facture — et `PieceLue.kind` ne connaît que
                   * `facture_achat` / `facture_vente` / `null` : quatre
                   * icônes sur deux faits seraient une devinette.
                   */
                  <button
                    key={p.id}
                    type="button"
                    className="rw"
                    onClick={() =>
                      void navigate({ to: "/pme/piece/$pieceId", params: { pieceId: p.id } })
                    }
                  >
                    <i>
                      <IconePiece />
                    </i>
                    <span className="bd">
                      <b>{titreDe(p)}</b>
                      <span>{t(`pme.status.${p.status}` as never)}</span>
                    </span>
                    <span className="rt">
                      {somme(p) === "" ? null : <span className="vl">{somme(p)}</span>}
                      <span className="dt">{jour(p)}</span>
                    </span>
                  </button>
                ))}
              </>
            ) : null}

            {/* ── ce qui peut encore bouger : le seul geste ─────────────── */}
            {bougent.length > 0 ? (
              <>
                <div className="sec">
                  <h2>{MOTS.bouger}</h2>
                  <span>{bougent.length}</span>
                </div>

                {bougent.map((p) => (
                  <div key={p.id} className="card">
                    <div className="hd">
                      <b>{titreDe(p)}</b>
                      {somme(p) === "" ? null : <span>{somme(p)}</span>}
                    </div>

                    <p>{MOTS.libre}</p>

                    {/*
                     * Au coffre, toute pièce est `personnel` — donc tout refus
                     * y est `piece_personnelle`, et c'est exactement ce qu'il
                     * faut dire : « je ne la lis pas tant que vous ne la
                     * transmettez pas ». Le bouton est juste en dessous.
                     */}
                    {p.status === "capturee" ? (
                      <EtatDeLecture refus={p.lectureRefusee} vis={p.vis} />
                    ) : null}

                    <div className="b">
                      {/*
                       * Le dessin écrit « Remettre dans la bibliothèque ».
                       * `pme.prive.transmettre` nomme le MÊME geste et existe
                       * en trois langues : on ne le réécrit pas pour en perdre
                       * deux. Divergence nommée, pas tranchée.
                       */}
                      <button
                        type="button"
                        disabled={basculer.isPending}
                        onClick={() => basculer.mutate(p)}
                      >
                        {t("pme.prive.transmettre", { cabinet: nomDuCabinet })}
                      </button>
                    </div>
                  </div>
                ))}
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
 * la seule règle d'icône commune aux dix écrans. La taille vient toujours du
 * contexte (`.top .ic svg`, `.mur svg`, `.rw i svg`), jamais de l'icône.
 */

/** Le cadenas — l'espace privé, dans la barre et dans le mur. */
function IconeCadenas() {
  return (
    <svg viewBox="0 0 24 24" className="g" aria-hidden>
      <rect x="5" y="10.5" width="14" height="10" rx="1.5" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
      <path d="M12 14.5v2.5" />
    </svg>
  );
}

/** Une pièce — la feuille au coin plié. */
function IconePiece() {
  return (
    <svg viewBox="0 0 24 24" className="g" aria-hidden>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4" />
      <path d="M9 12h6M9 15.5h6" />
    </svg>
  );
}
