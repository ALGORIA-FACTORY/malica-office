import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { FileLocale } from "@/components/malica/file-locale";
import {
  CompteDesPapiers,
  ConfirmerLaSuppression,
  GrilleDesMois,
} from "@/components/malica/grille-des-mois";
import { EtatDeLecture } from "@/components/malica/lecture-refusee";
import { usePme } from "@/components/malica/pme-context";
import { Aide } from "@/components/malica/aide";
import { useI18n } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { partieLeVers, partieVers } from "@/lib/envoi";
import { LotInterrompu, unParUn } from "@/lib/un-par-un";
import { jourEtMois, momentDeLEnvoi, montant } from "@/lib/lisible";
import { EcranEnvoye } from "@/components/malica/envoye";
import { office } from "@/verticals/malica-office/composition";
import type { PieceLue } from "@malica/socle/ports/repositories";
import { clePiecesLues, usePiecesLues } from "@/hooks/use-pieces-lues";
import { useDestinationDeLEnvoi } from "@/hooks/use-destination-de-l-envoi";
import { useEnvoyerEnLot, useSupprimerEnLot } from "@/hooks/use-gestes-du-circuit";
import { useRevenir } from "@/hooks/use-revenir";
import { useRangementsPrives } from "@/hooks/use-rangements-prives";
import { useSuperposition } from "@/hooks/use-superposition";
import { RayonsPrives } from "@/components/malica/rayons-prives";
import { libelleDuRayon, RAYONS_PROPOSES, rayonsASoi } from "@/lib/rayons-prives";
import { plier } from "@/lib/mes-societes";

export const Route = createFileRoute("/_authenticated/pme/coffre")({
  head: () => ({
    meta: [
      { title: "Mon espace privé — Malica Office" },
      {
        name: "description",
        content: "Ce que vous gardez pour vous seul, invisible au cabinet mandaté.",
      },
      { property: "og:title", content: "Mon espace privé — Malica Office" },
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

/** Le mois d'une pièce, `AAAA-MM` : la date du document, sinon celle du dépôt. */
const moisDe = (p: PieceLue) => (p.dateDocument ?? p.createdAt).slice(0, 7);

/**
 * Mon espace — ce que vous gardez pour vous.
 *
 * ================================================ LE DESSIN DU 28 OCTOBRE 2026
 *
 * Maquette « Malica sans blocage », écran « Mon espace », validée par Wissem :
 * on reconnaît un papier à sa tête. Une grille de grandes miniatures, rangées
 * par mois ; un compte, « Mon espace · N papiers » ; deux gestes côte à côte,
 * « Mettre dans la société » et « Supprimer », sur les papiers choisis.
 *
 * Toucher un papier l'ouvre, comme partout ailleurs ; le rond de son coin le
 * choisit. Deux cibles, chacune de 44 points au moins, plutôt qu'un appui long
 * que personne ne devine. L'explication est dans le ⓘ du titre, pas à l'écran.
 *
 * ============================================ LE MUR EST TENU PAR LA BASE
 *
 * Seules les pièces `personnel` de leur auteur paraissent ici : la RLS ne rend
 * à personne d'autre — pas même au dirigeant — le Mon espace d'un siège
 * (`l-espace-prive-l-est-aussi-du-patron.test.ts`). La miniature passe par la
 * même RLS (`/pieces/:id/miniature`).
 *
 * ================================================== « METTRE DANS LA SOCIÉTÉ »
 *
 * Le libellé dit le geste : `vis` passe de `personnel` à `entite`, la
 * bibliothèque de la société — le même geste que « La dire à la société » sur
 * la fiche. Rien ne part chez le cabinet, et l'écran qui suit le DIT. Il porte
 * ensuite le geste que cet écran portait seul jusqu'ici, « Transmettre à
 * {cabinet} », et son écran « Envoyé » : la transmission reste une décision
 * séparée, à un geste de là, jamais un effet de bord.
 *
 * Avant ce dessin, « Transmettre » passait directement de `personnel` à
 * `partage`. Le libellé « Mettre dans la société » ne peut pas porter ce
 * geste-là sans mentir.
 *
 * ================================================== CE QUI RESTE DU DESSIN D'AVANT
 *
 * `.app` et `.nav` ne sont pas rendus — la coque et la barre du bas sont
 * tenues par `pme.tsx`. `-mx-4 -my-5` annule le `px-4 py-5` de son `<main>`.
 * La teinte de l'espace privé est peinte par la feuille, sur la coque, par
 * `:has([data-ecran="coffre"])` : cet écran n'a rien à poser pour elle.
 */
function PmeCoffre() {
  const { t, locale } = useI18n();
  const pme = usePme();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const revenir = useRevenir();
  const [erreur, setErreur] = useState<string | null>(null);
  /** Les papiers choisis, dans l'ordre où on les a touchés. */
  const [choisis, setChoisis] = useState<readonly string[]>([]);
  const [confirmer, setConfirmer] = useState(false);
  /** Ce qui vient d'entrer dans la société, puis ce qui vient de partir au cabinet. */
  const [misEnSociete, setMisEnSociete] = useState<readonly string[] | null>(null);
  const [transmis, setTransmis] = useState<readonly string[] | null>(null);

  const pieces = usePiecesLues();
  /*
   * Planche 10 (7 novembre 2026) : des rayons à soi, un nom, une recherche.
   * Le rayon et le nom viennent de la personne (`capture.rangements_prives`) :
   * un papier privé n'est jamais lu.
   */
  const rangements = useRangementsPrives(pme.tenantId);
  const [cherche, setCherche] = useState("");
  const [rayonVu, setRayonVu] = useState<string | null>(null);
  const [rangerOuvert, setRangerOuvert] = useState(false);
  const feuille = useRef<HTMLDivElement>(null);
  const fermerRanger = useCallback(() => setRangerOuvert(false), []);
  useSuperposition(rangerOuvert, fermerRanger, feuille);
  // Le siège envoie au propriétaire ; qui transmet, au comptable (lot 4).
  const envoi = useDestinationDeLEnvoi(pme.tenantId);
  const destination = envoi.destination;

  const relire = async () => {
    await qc.invalidateQueries({ queryKey: clePiecesLues(pme.tenantId) });
    await qc.invalidateQueries({ queryKey: ["pieces", pme.tenantId] });
  };

  /**
   * Un geste interrompu au milieu d'un lot se DIT : combien sont passés, et
   * ce qui reste — choisi, prêt à être repris. Jamais un état partiel muet.
   */
  const direLInterruption = (
    e: unknown,
    cle: "pme.coffre.partiel.mis" | "pme.coffre.partiel.supprimes",
  ) => {
    if (!(e instanceof LotInterrompu)) return texteDeLErreur(e, OU, t("common.error"));
    const raison = texteDeLErreur(e.cause, OU, t("common.error"));
    if (e.faits.length === 0) return raison;
    setChoisis(e.restants);
    const total = e.faits.length + e.restants.length;
    return `${t(cle, { faits: e.faits.length, total, count: e.restants.length })} ${raison}`;
  };

  const mettre = useMutation({
    mutationFn: (ids: readonly string[]) =>
      unParUn(ids, (id) => office().collab.setPieceVis(id, "entite")),
    onSuccess: async (ids) => {
      setErreur(null);
      setChoisis([]);
      await relire();
      setMisEnSociete(ids);
    },
    onError: async (e: unknown) => {
      setErreur(direLInterruption(e, "pme.coffre.partiel.mis"));
      await relire();
    },
  });

  // La seule porte de la suppression : ce que le Socle permet, pièce par pièce.
  const supprimer = useSupprimerEnLot(pme.tenantId, {
    onSuccess: async () => {
      setErreur(null);
      setChoisis([]);
      setConfirmer(false);
      await relire();
    },
    onError: async (e: unknown) => {
      setConfirmer(false);
      setErreur(direLInterruption(e, "pme.coffre.partiel.supprimes"));
      await relire();
    },
  });

  // La seule porte du lot : ce qui reste à envoyer, et rien d'autre.
  const transmettre = useEnvoyerEnLot(pme.tenantId, {
    // Vers le comptable, la décision est relue au dernier instant ; aucun
    // destinataire n'est inventé. Un refus ici arrête le lot avant tout envoi.
    onMutate: async () => {
      if (destination === "cabinet" && !(await office().identity.monCabinet(pme.tenantId)))
        throw new Error(t("relation.sansDestinataire"));
    },
    onSuccess: async (ids) => {
      setErreur(null);
      // Relire avant de dire : l'heure de la transmission vient de la base.
      await relire();
      setMisEnSociete(null);
      setTransmis(ids);
    },
    onError: (e: unknown) => setErreur(texteDeLErreur(e, OU, t("common.error"))),
  });

  // Seules les pièces gardées pour soi. Ce qui est dans la société se regarde
  // dans « Vos documents », avec son statut.
  const toutes = pieces.data ?? [];
  const privees = toutes
    .filter((p) => p.vis === "personnel")
    .sort((a, b) => (b.dateDocument ?? b.createdAt).localeCompare(a.dateDocument ?? a.createdAt));
  const rangement = (p: PieceLue) => rangements.parPiece.get(p.id) ?? null;
  const rayonDe = (p: PieceLue) => {
    const r = rangement(p)?.rayon;
    return r ? libelleDuRayon(r, t) : null;
  };

  // Le nom que la personne a donné ; sinon le rayon ; sinon ce que la lecture
  // a trouvé ; sinon « Papier » — jamais « Non lue » : un papier privé n'est
  // pas fait pour être lu (planche 10).
  const titreDe = (p: PieceLue) =>
    rangement(p)?.nom ?? p.emetteur ?? rayonDe(p) ?? t("pme.prive.papier");
  const jour = (p: PieceLue) => jourEtMois(p.dateDocument ?? p.createdAt, locale);

  // Les rayons qui ont des papiers, dans l'ordre proposé puis les siens.
  const rayonsUtilises = new Set(
    privees.map((p) => rangement(p)?.rayon).filter((r): r is string => !!r),
  );
  const tuilesDeRayon = [
    ...RAYONS_PROPOSES.filter((r) => rayonsUtilises.has(r.code)).map((r) => ({
      code: r.code as string,
      teinte: r.teinte as string | null,
    })),
    ...rayonsASoi([...rayonsUtilises], locale).map((r) => ({ code: r, teinte: null })),
  ];
  const q = plier(cherche.trim());
  const visibles = privees.filter((p) => {
    if (rayonVu && rangement(p)?.rayon !== rayonVu) return false;
    if (!q) return true;
    return [titreDe(p), rayonDe(p) ?? "", p.emetteur ?? ""].some((x) => plier(x).includes(q));
  });
  /**
   * Le montant, ou rien : « un montant absent n'est pas un montant nul ».
   * `montant(null)` rend la chaîne vide, et rien ne s'affiche.
   */
  const somme = (p: PieceLue) => {
    const rendu = montant(p.total, locale);
    return rendu === "" ? "" : `${rendu} ${p.devise ?? pme.currency}`;
  };

  const basculer = (id: string) =>
    setChoisis((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  // Un choix qui a quitté l'espace (supprimé ailleurs, relu) ne compte plus.
  const choix = choisis.filter((id) => visibles.some((p) => p.id === id));
  /** Les papiers choisis, dans l'ordre du toucher. */
  const choisies = choix.flatMap((id) => visibles.filter((p) => p.id === id));
  // « Supprimer » n'est offert que si chaque papier choisi se supprime : un
  // lot ne laisse jamais un papier derrière lui sans le dire.
  const supprimables = choisies.length > 0 && choisies.every(supprimer.peut);
  const occupe = mettre.isPending || supprimer.isPending;

  const panne = pieces.error ?? null;

  /* ============================================================== ENVOYÉ
   *
   * Les papiers sont partis — chez le propriétaire (le siège, lot 4) ou chez
   * le comptable : sans cet écran, ils disparaîtraient de la grille sans un
   * mot (maquette « Écran Envoyé », 27 octobre 2026). Partie chez le
   * propriétaire, une pièce reste dans la société : c'est le circuit qui le
   * dit (`partieVers`). Les mots et l'heure viennent de la base relue.
   */
  const partis = transmis ? toutes.filter((p) => transmis.includes(p.id)) : [];
  const premier = partis[0];
  if (transmis && premier && destination && partis.every((p) => partieVers(p, destination))) {
    const qui = envoi.quiPour(destination);
    const le = partieLeVers(premier, destination);
    const quand = le ? momentDeLEnvoi(le, locale).quand : null;
    return (
      <EcranEnvoye
        titre={t("envoi.lot.tout", { count: partis.length })}
        quoi={
          quand
            ? partis.length === 1
              ? t("envoi.piece.chez", { piece: titreDe(premier), qui, quand })
              : envoi.quoiDuLot(destination, partis.length, quand)
            : t("pme.transmettre.faite", { cabinet: qui })
        }
        suite={partis.length === 1 ? envoi.suite(destination) : null}
        trace={le ? envoi.trace(destination, jourEtMois(le, locale)) : null}
        principale={{ libelle: t("envoi.coffre.retour"), action: () => setTransmis(null) }}
        secondaire={
          partis.length === 1
            ? {
                libelle: t("envoi.voir"),
                action: () =>
                  void navigate({
                    to: "/pme/piece/$pieceId",
                    params: { pieceId: premier.id },
                    search: { onglet: "suivi" },
                  }),
              }
            : null
        }
      />
    );
  }

  /* ================================================= DANS LA SOCIÉTÉ
   *
   * Le même écran de fin que tout passage : ce qui a bougé, et où. Rien n'est
   * parti, et c'est écrit ; « Envoyer » est le geste suivant, vers le
   * propriétaire pour le siège, vers le comptable pour qui transmet.
   */
  const entres = misEnSociete ? toutes.filter((p) => misEnSociete.includes(p.id)) : [];
  const entre = entres[0];
  if (misEnSociete && entre && entres.every((p) => p.vis === "entite")) {
    return (
      <EcranEnvoye
        titre={t("pme.coffre.mis.titre")}
        quoi={
          <>
            {t("pme.coffre.mis.quoi", { count: entres.length, piece: titreDe(entre) })}
            {erreur ? (
              <span role="alert" className="mt-2 block text-signal-stop">
                {erreur}
              </span>
            ) : null}
          </>
        }
        suite={
          destination
            ? t("pme.coffre.mis.suite", { qui: envoi.quiPour(destination) })
            : // Personne à qui envoyer : la raison de l'absence du geste se dit ici.
              t("relation.sansDestinataire")
        }
        trace={null}
        principale={{ libelle: t("envoi.coffre.retour"), action: () => setMisEnSociete(null) }}
        secondaire={
          destination && entres.some(transmettre.reste)
            ? {
                libelle: envoi.action(destination),
                action: () => {
                  // Ce qui reste à envoyer, au sens du seul prédicat.
                  if (!transmettre.isPending) transmettre.mutate(entres);
                },
              }
            : null
        }
      />
    );
  }

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
           * DETTE, et elle est nommée : `common.retour` n'existe pas dans
           * `packages/socle/src/messages.ts`. Les retours du produit lisent une
           * clé rangée sous l'écran « à régler ». Le renommage appartient au
           * socle, pas à cet écran.
           */
          aria-label={t("pme.regler.retour")}
          onClick={() => revenir("/pme")}
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
        <h1>
          {t("pme.coffre.titre")}
          <Aide
            titre={t("pme.coffre.titre")}
            paragraphes={[
              { texte: t("pme.prive.sous") },
              { texte: t("pme.coffre.wall") },
              { texte: t("pme.coffre.choisir.aide") },
              { texte: t("pme.coffre.pied") },
            ]}
          />
        </h1>

        <CompteDesPapiers n={privees.length} />

        <FileLocale vis="personnel" />

        {privees.length > 0 ? (
          <>
            <label className="rp-cherche">
              <svg viewBox="0 0 24 24" className="g" aria-hidden>
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input
                type="search"
                value={cherche}
                placeholder={t("pme.prive.chercher")}
                aria-label={t("pme.prive.chercher")}
                onChange={(e) => setCherche(e.target.value)}
              />
            </label>
            {tuilesDeRayon.length > 0 ? (
              <div className="rp-grille" role="group" aria-label={t("pme.prive.rayons")}>
                {tuilesDeRayon.map((r) => {
                  const n = privees.filter((p) => rangement(p)?.rayon === r.code).length;
                  return (
                    <button
                      key={r.code}
                      type="button"
                      className="rp-tt"
                      aria-pressed={rayonVu === r.code}
                      style={r.teinte ? { background: r.teinte } : undefined}
                      onClick={() => setRayonVu((v) => (v === r.code ? null : r.code))}
                    >
                      <i aria-hidden>{libelleDuRayon(r.code, t).slice(0, 1).toLocaleUpperCase()}</i>
                      <small>{t("pme.prive.rayon.compte", { count: n })}</small>
                      <b>{libelleDuRayon(r.code, t)}</b>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </>
        ) : null}

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
        ) : !pieces.isSuccess && pieces.data === undefined ? null : privees.length === 0 &&
          !pme.file.elements.some((e) => e.vis === "personnel") ? (
          <div className="card">
            <p>{t("pme.prive.vide")}</p>
          </div>
        ) : (
          <>
            {visibles.length === 0 && privees.length > 0 ? (
              <p className="foot">{t("pme.prive.aucun")}</p>
            ) : null}
            <GrilleDesMois
              papiers={visibles}
              moisDe={moisDe}
              titreDe={titreDe}
              ligneDe={(p) => [rayonDe(p), jour(p), somme(p)].filter(Boolean).join(" · ")}
              enPlus={(p) =>
                // Planche 10 : plus de « Non lue » en rouge sur un papier privé.
                // Seul un refus d'une AUTRE raison se dit encore.
                p.status === "capturee" &&
                p.lectureRefusee &&
                p.lectureRefusee.motif !== "piece_personnelle" ? (
                  <EtatDeLecture
                    refus={p.lectureRefusee}
                    vis={p.vis}
                    lecture={p.lecture}
                    motifDitAilleurs="piece_personnelle"
                  />
                ) : null
              }
              ouvrir={(p) =>
                void navigate({ to: "/pme/piece/$pieceId", params: { pieceId: p.id } })
              }
              choisis={choix}
              basculer={basculer}
              occupe={occupe}
            />

            {visibles.length > 0 ? (
              <div className="gestes">
                <button
                  type="button"
                  className="pr"
                  disabled={choix.length === 0 || occupe}
                  onClick={() => mettre.mutate(choix)}
                >
                  {t("pme.coffre.mettre")}
                </button>
                <button
                  type="button"
                  disabled={!supprimables || occupe}
                  onClick={() => setConfirmer(true)}
                >
                  {t("pme.coffre.supprimer")}
                </button>
                {choix.length > 0 ? (
                  <button type="button" disabled={occupe} onClick={() => setRangerOuvert(true)}>
                    {t("pme.prive.ranger")}
                  </button>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </div>

      {rangerOuvert
        ? createPortal(
            <div className="rp-voile" onClick={fermerRanger}>
              <div
                ref={feuille}
                className="rp-feuille"
                role="dialog"
                aria-modal="true"
                aria-label={t("pme.prive.rayon.titre")}
                onClick={(e) => e.stopPropagation()}
              >
                <RayonsPrives
                  aSoi={rayonsASoi(
                    (rangements.lecture.data ?? []).map((r) => r.rayon),
                    locale,
                  )}
                  occupe={rangements.ranger.isPending}
                  onSociete={null}
                  onChoisir={(rayon, nom) =>
                    rangements.ranger.mutate(
                      { ids: choix, rayon, nom },
                      {
                        onSuccess: () => {
                          setRangerOuvert(false);
                          setChoisis([]);
                        },
                        onError: (e) => {
                          setRangerOuvert(false);
                          setErreur(texteDeLErreur(e, OU, t("common.error")));
                        },
                      },
                    )
                  }
                />
              </div>
            </div>,
            document.querySelector('[data-surface="pme"]') ?? document.body,
          )
        : null}

      {confirmer ? (
        <ConfirmerLaSuppression
          n={choix.length}
          enCours={supprimer.isPending}
          oui={() => supprimer.mutate(choisies)}
          fermer={() => setConfirmer(false)}
        />
      ) : null}
    </div>
  );
}

/**
 * Le cadenas — l'espace privé, dans la barre du haut. Il porte `class="g"`, la
 * seule règle d'icône commune aux écrans de la famille ; sa taille vient du
 * contexte (`.top .ic svg`).
 */
function IconeCadenas() {
  return (
    <svg viewBox="0 0 24 24" className="g" aria-hidden>
      <rect x="5" y="10.5" width="14" height="10" rx="1.5" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
      <path d="M12 14.5v2.5" />
    </svg>
  );
}
