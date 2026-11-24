/**
 * La bibliothèque — tout ce que la société a rangé, en cartes.
 *
 * Écran de la PME : de haut en bas, les sept dossiers en miniatures, les organisations et
 * les sièges quand l'abonnement les ouvre, puis les mois, le plus récent devant. Toucher
 * une carte montre toutes ses pièces ; le retour revient aux cartes. Un bouton transmet d'un
 * geste au cabinet ce qui est resté chez la société : jamais l'espace privé, jamais une pièce
 * que le dirigeant a décidé de garder.
 *
 * Les pièces viennent de la lecture déjà faite par l'accueil (`capture.listAvecLecture`) :
 * aucune requête de plus. Une pièce privée n'y figure pas.
 */
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";

import { ApercuDePiece } from "@/components/malica/apercu-de-piece";
import { CarteDeGroupe, IconeCalendrier } from "@/components/malica/carte-de-groupe";
import { RangeeDesSieges, type Siege } from "@/components/malica/rangee-des-sieges";
import { usePhotosDeProfil } from "@/hooks/use-photos-de-profil";
import { FileLocale } from "@/components/malica/file-locale";
import {
  ExporterDepuisLaPme,
  type SocieteExportee,
} from "@/components/malica/exporter-depuis-la-pme";
import { ImprimerDepuisLaPme } from "@/components/malica/imprimer-les-pieces";
import { EtatDeLecture } from "@/components/malica/lecture-refusee";
import { usePme } from "@/components/malica/pme-context";
import { RailDesDossiers } from "@/components/malica/rail-des-dossiers";
import { useI18n } from "@/i18n";
import { motifDeLEtat, refusDuPlafond } from "@/lib/champ-lisible";
import { piecesALire, statutDeLaPieceLue } from "@/lib/lecture";
import { statutDuCircuit, TON_PME, type StatutPme } from "@malica/socle/statut-d-envoi";
import { MOT_PME, motDuStatut } from "@/lib/statut";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { LectureLaPlusBasse } from "@/components/malica/lecture-la-plus-basse";
import { nombre } from "@/lib/forfait";
import { jourOuInstant, momentDeLEnvoi, montant } from "@/lib/lisible";
import { cn } from "@/lib/utils";
import { montantDeLaPiece, totauxParDevise } from "@/lib/totaux-des-pieces";
import type { PieceLue } from "@malica/socle/ports/repositories";
import { clePiecesLues, usePiecesLues } from "@/hooks/use-pieces-lues";
import { usePiecesDesSocietes } from "@/hooks/use-pieces-des-societes";
import { useDossiers } from "@/hooks/use-dossiers";
import { useParTranches } from "@/hooks/use-par-tranches";
import { useRevenir } from "@/hooks/use-revenir";
import { dossierDeLaPiece, etendueDesPeriodes, moisDeLaPiece } from "@/lib/dossiers";
import { groupesParMois } from "@/lib/ordre-de-la-bibliotheque";
import { useBureau } from "@/hooks/use-bureau";
import { partieLeVers, partieVers } from "@/lib/envoi";
import { EcranEnvoye, PasEncoreParti } from "@/components/malica/envoye";
import { useMonCabinet } from "@/hooks/use-mon-cabinet";
import { useDestinationDeLEnvoi } from "@/hooks/use-destination-de-l-envoi";
import { useEnvoyerEnLot } from "@/hooks/use-gestes-du-circuit";

export const Route = createFileRoute("/_authenticated/pme/list")({
  head: () => ({
    meta: [
      { title: "Bibliothèque — Malica Office" },
      {
        name: "description",
        content: "Ce que Malica a lu et classé, par dossier, par siège et par mois.",
      },
      { property: "og:title", content: "Bibliothèque — Malica Office" },
      {
        property: "og:description",
        content: "Ce que Malica a lu et classé, par dossier, par siège et par mois.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Bibliotheque,
});

/** Combien de mois avant que « Voir les N » ne paraisse. */
const PREMIERS = 9;

/** Un entier rendu par la base, ou l'absence — qui s'écrit « — », jamais « 0 ». */
function compte(valeur: number | string | null | undefined): string {
  const n = nombre(valeur);
  return n === null ? "—" : String(n);
}

/** Le groupe déroulé : un mois ou un siège, et sa clé. */
interface Ouvert {
  genre: "mois" | "siege";
  cle: string;
}

/**
 * Transmettre d'un geste ce qui est resté chez la société (ANO-LIVE-003).
 *
 * Seules partent les pièces de la société qui n'ont pas été transmises et
 * dont le dirigeant n'a pas DÉCIDÉ de les garder : l'espace privé ne part
 * jamais en lot, et une décision de garder n'est pas défaite par un bouton
 * de masse. Deux touches : la première arme, la seconde engage.
 */
function TransmettreCeQuiReste({ pieces }: { pieces: readonly PieceLue[] }) {
  const { t, locale } = useI18n();
  const pme = usePme();
  const qc = useQueryClient();
  const navigate = useNavigate();
  /*
   * Le même geste en lot, deux passages (lot 4) : le siège envoie au
   * propriétaire, le propriétaire au comptable. La base choisit
   * (`collab.transmettreLesPieces` passe par `piece_envoyer`) ; l'écran le
   * nomme comme partout (`useDestinationDeLEnvoi`).
   */
  const envoiVers = useDestinationDeLEnvoi(pme.tenantId);
  const destination = envoiVers.destination;
  const auProprietaire = destination === "proprietaire";
  const [armee, setArmee] = useState(false);
  /** Les pièces parties dans ce geste — l'écran « Envoyé » les compte. */
  const [envoi, setEnvoi] = useState<readonly string[] | null>(null);
  /** Un refus rédigé par la base (impayé, pièce privée) : il dit quoi faire. */
  const [refus, setRefus] = useState<string | null>(null);
  const qui = destination ? envoiVers.quiPour(destination) : "";
  /** Partie dans ce geste : chez le propriétaire (le siège), ou au cabinet. */
  const partie = (p: PieceLue) => (destination ? partieVers(p, destination) : false);
  const partieLe = (p: PieceLue) => (destination ? partieLeVers(p, destination) : null);
  // La seule porte du lot : ce qui reste à envoyer, et rien d'autre.
  const transmettre = useEnvoyerEnLot(pme.tenantId, {
    onMutate: () => setRefus(null),
    onSuccess: async (ids) => {
      setArmee(false);
      // Relire avant de dire : le compte et l'heure viennent de la base.
      await qc.invalidateQueries({ queryKey: clePiecesLues(pme.tenantId) });
      setEnvoi(ids);
    },
    onError: (e: unknown) => {
      setArmee(false);
      // « Pas encore parti » se dit sur place ; la panne va au journal, le
      // refus rédigé (4xx) se lit dessous.
      setRefus(texteDeLErreur(e, "routes/_authenticated/pme.list", "") || null);
    },
  });
  const restantes = pieces.filter(transmettre.reste);

  /* ====================================================== ENVOYÉ, EN LOT
   *
   * Jamais « tout est parti » sur un succès partiel : ce qui est resté est
   * nommé, avec de quoi l'ouvrir (maquette du 27 octobre 2026).
   */
  if (envoi) {
    const duLot = pieces.filter((p) => envoi.includes(p.id));
    const parties = duLot.filter(partie);
    const restees = duLot.filter((p) => !partie(p));
    const derniere = parties
      .map(partieLe)
      .filter((d): d is string => Boolean(d))
      .sort()
      .at(-1);
    const fermer = () => setEnvoi(null);
    return (
      <EcranEnvoye
        titre={
          restees.length > 0
            ? t("envoi.lot.titre", { count: parties.length, total: duLot.length })
            : t("envoi.lot.tout", { count: parties.length })
        }
        quoi={
          derniere && destination
            ? envoiVers.quoiDuLot(
                destination,
                parties.length,
                momentDeLEnvoi(derniere, locale).quand,
              )
            : t("pme.list.transmettre.fait", { count: parties.length })
        }
        suite={null}
        trace={null}
        restees={{
          titre: t("envoi.lot.restee", { count: restees.length }),
          ouvrir: t("envoi.lot.ouvrir"),
          liste: restees.map((p) => ({
            id: p.id,
            nom: p.emetteur ?? t("envoi.piece.sansNom"),
            raison: t("envoi.lot.restee.raison"),
            ouvrir: () => void navigate({ to: "/pme/piece/$pieceId", params: { pieceId: p.id } }),
          })),
        }}
        principale={{ libelle: t("envoi.lot.revenir"), action: fermer }}
        secondaire={null}
      />
    );
  }

  if (!destination || restantes.length === 0) return null;
  return (
    <div className="card">
      <p className="t-body">
        {t(auProprietaire ? "circuit.lot.reste" : "pme.list.transmettre.reste", {
          count: restantes.length,
        })}
      </p>
      {transmettre.isError && !armee ? (
        <PasEncoreParti
          qui={qui}
          reessayer={() => transmettre.mutate(restantes)}
          enCours={transmettre.isPending}
        />
      ) : (
        <button
          type="button"
          className="btn"
          disabled={transmettre.isPending}
          onClick={() => (armee ? transmettre.mutate(restantes) : setArmee(true))}
        >
          {transmettre.isPending
            ? t("common.loading")
            : armee
              ? t("pme.list.transmettre.confirmer", { count: restantes.length })
              : t(auProprietaire ? "circuit.lot.action" : "pme.list.transmettre.action")}
        </button>
      )}
      {refus ? (
        <p className="t-body" role="alert">
          {refus}
        </p>
      ) : null}
    </div>
  );
}

/**
 * La bibliothèque — tout ce que la société a rangé, en cartes.
 *
 * 1er novembre 2026, maquette validée par Wissem (« Bibliothèque en cartes ») :
 * plus d'axes, de vue annuelle ni de pastilles de filtre. L'écran montre, de
 * haut en bas :
 *
 *   — les sept DOSSIERS en miniatures, la rangée de l'accueil
 *     (`RailDesDossiers`) : toucher « Achats » ouvre le dossier ;
 *   — les ORGANISATIONS et les SIÈGES, quand l'abonnement les ouvre
 *     (`usePiecesDesSocietes`, la règle du dossier ouvert) ;
 *   — les MOIS, le plus récent devant.
 *
 * Toucher une organisation, un siège ou un mois montre toutes ses pièces ; le
 * retour revient aux cartes. Tous les « Tout voir » de l'accueil et l'onglet
 * « Bibliothèque » de la barre arrivent ici.
 *
 * Les pièces viennent de la lecture que l'accueil a déjà faite
 * (`capture.listAvecLecture`, clé `pieces-lues`) : aucune requête de plus.
 * Une pièce privée n'est pas dans la bibliothèque.
 *
 * `data-ecran="bibliotheque"` fait descendre les règles de `styles-pme.css` ;
 * la barre du bas est rendue par `pme.tsx`, une fois pour tous les écrans PME.
 */
function Bibliotheque() {
  const { t, locale } = useI18n();
  const pme = usePme();
  const sept = useDossiers();
  // Le cabinet, nommé dans le statut quand il a ouvert la pièce.
  const nomDuCabinet = useMonCabinet(pme.tenantId).data?.name ?? null;

  const lues = usePiecesLues();
  const brutes = useMemo(() => lues.data ?? [], [lues.data]);
  const aLire = useMemo(() => piecesALire(brutes), [brutes]);
  const { toutes, parSiege, parSociete, nomDeSociete, chargement, parSieges, ouvrirSaSociete } =
    usePiecesDesSocietes();
  // Les sociétés d'un lot à exporter, avec le nombre de pièces de chacune : la feuille
  // d'export dit son périmètre (une société, ou « un dossier par société »).
  const societeDe = useMemo(() => new Map(toutes.map((x) => [x.piece.id, x.societe])), [toutes]);
  const societesDuLot = (lot: readonly PieceLue[]): SocieteExportee[] => {
    const nombres = new Map<string, number>();
    for (const p of lot) {
      const s = societeDe.get(p.id);
      if (s) nombres.set(s, (nombres.get(s) ?? 0) + 1);
    }
    return [...nombres].map(([id, n]) => ({ id, nom: nomDeSociete(id), n }));
  };
  /*
   * Les pièces montrées : celle de l'en-tête, ou toutes les sociétés quand
   * l'en-tête dit « Toutes » (`pme.societeAffichee`, 9 novembre 2026) —
   * celles des dossiers, des sièges et des mois.
   */
  const ici = useMemo(
    () =>
      toutes
        .filter((x) => pme.societeAffichee === null || x.societe === pme.societeAffichee)
        .map((x) => x.piece),
    [toutes, pme.societeAffichee],
  );

  const [ouvert, setOuvert] = useState<Ouvert | null>(null);
  /** Les pièces cochées pour « Imprimer la sélection » ; `null` : pas de cases. */
  const [choix, setChoix] = useState<ReadonlySet<string> | null>(null);
  // Changer de société referme le groupe déroulé : il montrait l'autre
  // (revue de #211). Les cases partent avec lui.
  useEffect(() => setOuvert(null), [pme.societeAffichee]);
  useEffect(() => setChoix(null), [ouvert]);
  const revenir = useRevenir();
  const [tout, setTout] = useState(false);
  const bureau = useBureau();

  // -------------------------------------------------------------- les groupes
  const sieges = parSieges(ici);
  // Les sièges tels que la rangée les montre ; toutes les sociétés : chacun dit la sienne.
  const photos = usePhotosDeProfil([...sieges.keys()]);
  const rangee: Siege[] = [...sieges].map(([id, g]) => ({
    id,
    nom: g.nom,
    pieces: g.pieces,
    photo: photos[id] ?? null,
    societe:
      parSociete && pme.societeAffichee === null
        ? nomDeSociete(toutes.find((x) => x.piece.auteurId === id)?.societe ?? "")
        : null,
  }));
  // Le plus récent devant : l'ordre que la pièce ouverte suit aussi (J / K).
  const mois = useMemo(() => groupesParMois(ici), [ici]);

  const nomDuMois = (p: string) =>
    new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(
      new Date(`${p}-01T00:00:00Z`),
    );

  /** Les dossiers présents dans un lot, dans l'ordre de l'accueil. */
  const dossiersDe = (ps: readonly PieceLue[]) =>
    sept.dossiers
      .filter((d) => ps.some((p) => dossierDeLaPiece(p, sept.types) === d.code))
      .map((d) => d.libelle)
      .join(" · ");

  /*
   * Les montants CONNUS, en décimal exact : un reçu ou un justificatif répète
   * le montant de sa facture et ne s'additionne pas ; une pièce sans montant
   * compte dans le groupe, jamais pour zéro.
   */
  const sommes = (ps: readonly PieceLue[]): ReactNode => {
    const connus = ps.filter((p) => p.total !== null && !p.accompagne);
    // Un avoir retranche ; chaque devise a son total, à ses décimales (22 novembre 2026).
    const ecrire = (groupe: readonly PieceLue[]) =>
      totauxParDevise(groupe, sept.types)
        .map((x) => `${montant(x.total, locale)}${x.devise ? `\u00A0${x.devise}` : ""}`)
        .join(" · ");
    const achats = connus.filter((p) => p.kind !== "facture_vente");
    const ventes = connus.filter((p) => p.kind === "facture_vente");
    if (achats.length === 0 && ventes.length === 0) return "—";
    return (
      <>
        {achats.length > 0 ? `${t("pme.doc.type.achats")} ${ecrire(achats)}` : null}
        {achats.length > 0 && ventes.length > 0 ? " · " : null}
        {ventes.length > 0 ? (
          <u>
            {t("pme.doc.type.ventes")} {ecrire(ventes)}
          </u>
        ) : null}
      </>
    );
  };

  const groupeOuvert: { titre: string; pieces: PieceLue[] } | null =
    ouvert === null
      ? null
      : ouvert.genre === "mois"
        ? { titre: nomDuMois(ouvert.cle), pieces: mois.find(([c]) => c === ouvert.cle)?.[1] ?? [] }
        : {
            titre: sieges.get(ouvert.cle)?.nom ?? "",
            pieces: sieges.get(ouvert.cle)?.pieces ?? [],
          };
  // Un mois de cent cinquante sociétés se dessine par tranches (planche 1).
  const tranches = useParTranches(
    groupeOuvert?.pieces ?? [],
    60,
    ouvert === null ? null : `${ouvert.genre}:${ouvert.cle}`,
  );
  const ouvrir = (suivant: Ouvert) => {
    setOuvert(suivant);
    window.scrollTo(0, 0);
  };

  const jour = (p: PieceLue) =>
    jourOuInstant(p.dateDocument ?? p.createdAt, locale, { day: "2-digit", month: "short" });

  /** Le titre ne ment pas : sans émetteur, une pièce LUE dit « sans émetteur », pas « pas encore lue ». */
  const nomDe = (p: PieceLue) =>
    p.emetteur ?? (p.status === "capturee" ? t("pme.list.nonLue") : t("pme.list.sansEmetteur"));

  /*
   * Une pièce non lue n'est pas une pièce qui attend : au plafond, elle dit
   * pourquoi elle n'a pas été lue. Lue, le statut : un mot et une couleur —
   * jamais une écriture.
   */
  const etatDe = (p: PieceLue) =>
    p.status === "capturee" ? (
      <EtatDeLecture refus={p.lectureRefusee} vis={p.vis} lecture={p.lecture} />
    ) : (
      <span className={cn("tag", TON_PME[statutDeLaPieceLue(p)])}>
        <i aria-hidden />
        {motDuStatut(statutDuCircuit(p), nomDuCabinet, t)}
      </span>
    );

  const f = pme.forfait.ligne;
  /*
   * Sous « Toutes les sociétés », le compteur n'est plus celui de la société ouverte : chaque
   * société a sa licence, donc on montre la plus basse, nommée — jamais un total (13 novembre 2026).
   */
  const sousToutes = pme.societeAffichee === null && pme.dossiers.length > 1;

  /*
   * LE PLAFOND, QUAND IL MORD : des pièces RÉELLEMENT refusées pour cause de
   * plafond (`plafond_atteint`, lu par `motifDeLEtat`), pas « l'offre Basic ».
   */
  const auPlafond = useMemo(
    () =>
      brutes.filter((p) => {
        const motif = motifDeLEtat(p.lectureRefusee, p.vis);
        return motif !== null && refusDuPlafond(motif);
      }).length,
    [brutes],
  );

  const vusDansLaListe = tout ? mois : mois.slice(0, PREMIERS);

  const lesSieges =
    parSiege && rangee.length > 0 ? (
      <RangeeDesSieges
        sieges={rangee}
        choisi={null}
        choisir={(id) => (id ? ouvrir({ genre: "siege", cle: id }) : setOuvert(null))}
      />
    ) : null;

  return (
    /*
     * Les marges négatives annulent le `px-4 py-5` du layout : `.pad` porte
     * les siennes, et le dessin ne veut pas de double gouttière.
     */
    <div data-ecran="bibliotheque" className="-mx-4 -my-5 flex min-h-0 flex-1 flex-col">
      {/*
       * Le retour (Wissem, 1er novembre 2026) : une carte ouverte se referme
       * d'abord ; sinon l'écran d'où l'on vient — l'accueil par défaut.
       */}
      <div className="top">
        <button
          type="button"
          className="bk"
          aria-label={t("pme.regler.retour")}
          onClick={() => (ouvert ? setOuvert(null) : revenir("/pme"))}
        >
          <svg viewBox="0 0 24 24" className="g" aria-hidden>
            <path d="M14.5 5.5L8 12l6.5 6.5" />
          </svg>
        </button>
      </div>
      <div className="pad">
        <h1>{t("pme.home.bibliotheque")}</h1>

        {/*
         * Ce que la bibliothèque contient, et ce que le forfait laisse. Les
         * bornes du compteur s'écrivent « — » tant qu'on ne les sait pas.
         */}
        <p className="sub">
          {t("pme.doc.compte", { count: ici.length })}
          <br />
          {sousToutes ? (
            <LectureLaPlusBasse />
          ) : (
            <>
              {compte(f?.lectures_restantes)} / {compte(f?.lectures_droit)} ·{" "}
              {t("pme.home.lectures")}
              {/* Le compteur est celui d'une société : il la nomme quand il y en a plusieurs. */}
              {pme.dossiers.length > 1 && pme.societeAffichee !== null ? ` · ${pme.orgName}` : null}
            </>
          )}
        </p>

        <TransmettreCeQuiReste pieces={brutes} />

        {/* Les pièces remises « à plus tard » : on les retrouve d'ici aussi. */}
        {aLire.length > 0 ? (
          <div className="fil">
            <Link to="/pme/a-lire" className="alire">
              {t("pme.list.aLire", { count: aLire.length })}
            </Link>
          </div>
        ) : null}

        {auPlafond > 0 ? (
          <div className="ceil" role="status">
            <i aria-hidden />
            <p>
              <b>{t("pme.doc.lead.nonLues", { count: auPlafond })}</b>{" "}
              {t("pme.refus.plafond_atteint")}
            </p>
          </div>
        ) : null}

        {chargement || !sept.pret ? (
          <p className="sub">{t("common.loading")}</p>
        ) : groupeOuvert !== null ? (
          <>
            <div className="sec">
              <h2>{groupeOuvert.titre}</h2>
              <button type="button" className="ret" onClick={() => setOuvert(null)}>
                {t("pme.regler.retour")}
              </button>
            </div>
            <p className="sub">
              {t("pme.doc.compte", { count: groupeOuvert.pieces.length })} ·{" "}
              {sommes(groupeOuvert.pieces)}
            </p>
            {/*
             * Imprimer (7.7) : le groupe ouvert, ou les pièces cochées — un
             * seul PDF, une page de garde par société quand « Toutes les
             * sociétés » en mêle plusieurs.
             */}
            {choix === null ? (
              <>
                <ImprimerDepuisLaPme
                  key={`groupe:${ouvert?.cle}`}
                  pieces={groupeOuvert.pieces.map((p) => p.id)}
                  portee="dossier"
                  nom={groupeOuvert.titre}
                  libelle={t("cab.biblio.imprimer.mois", { mois: groupeOuvert.titre })}
                  classe="more"
                  classeDuTexte="sub"
                />
                <ExporterDepuisLaPme
                  key={`export:${ouvert?.cle}`}
                  pieces={groupeOuvert.pieces.map((p) => p.id)}
                  societes={societesDuLot(groupeOuvert.pieces)}
                  titre={t("pme.export.titre", { mois: groupeOuvert.titre })}
                  libelle={t("pme.export.bouton", { mois: groupeOuvert.titre })}
                  classe="more"
                  classeDuTexte="sub"
                />
                <button type="button" className="more" onClick={() => setChoix(new Set())}>
                  {t("cab.biblio.imprimer.selectionner")}
                </button>
              </>
            ) : (
              <>
                <ImprimerDepuisLaPme
                  key={`choix:${[...choix].join(",")}`}
                  pieces={groupeOuvert.pieces.filter((p) => choix.has(p.id)).map((p) => p.id)}
                  portee="selection"
                  nom={groupeOuvert.titre}
                  libelle={t("cab.biblio.imprimer.selection", { n: choix.size })}
                  classe="more"
                  classeDuTexte="sub"
                />
                <ExporterDepuisLaPme
                  key={`export-choix:${[...choix].join(",")}`}
                  pieces={groupeOuvert.pieces.filter((p) => choix.has(p.id)).map((p) => p.id)}
                  societes={societesDuLot(groupeOuvert.pieces.filter((p) => choix.has(p.id)))}
                  titre={t("pme.export.selection", { n: choix.size })}
                  libelle={t("pme.export.selection", { n: choix.size })}
                  classe="more"
                  classeDuTexte="sub"
                />
                <button type="button" className="more" onClick={() => setChoix(null)}>
                  {t("cab.biblio.imprimer.terminer")}
                </button>
              </>
            )}
            <div className="lines">
              {tranches.visibles.map((p) => {
                const contenu = (
                  <>
                    <VignetteDeLaPiece piece={p} />
                    <span className="cps">
                      <span className="hd">
                        <span className="nm">{nomDe(p)}</span>
                        {/* Sans montant : « — », jamais « 0,000 », qui serait un fait comptable. */}
                        <span className={cn("vl", p.kind === "facture_vente" && "rec")}>
                          {p.total === null
                            ? "—"
                            : montant(montantDeLaPiece(p, sept.types), locale)}
                        </span>
                      </span>
                      <span className="mt">
                        {[
                          sept.parCode(dossierDeLaPiece(p, sept.types))?.libelle ?? null,
                          jour(p),
                          // Une retenue à la source : le montant est le net à payer, le TTC et
                          // la retenue se disent ici, comme sur la fiche (23 novembre 2026).
                          p.retenue
                            ? `${t("pme.extract.ttc")} ${montant(p.retenue.totalTtc, locale)} · ${t("pme.extract.retenue")} −${montant(p.retenue.montant, locale)}`
                            : null,
                        ]
                          .filter((x): x is string => !!x)
                          .join(" · ")}
                      </span>
                      {etatDe(p)}
                    </span>
                  </>
                );
                // En sélection, la ligne se coche au lieu de s'ouvrir.
                return choix !== null ? (
                  <label key={p.id} className={cn("pc", p.status === "capturee" && "dim")}>
                    <input
                      type="checkbox"
                      checked={choix.has(p.id)}
                      aria-label={t("cab.biblio.imprimer.cocher", {
                        nom: p.emetteur ?? t("pme.list.sansEmetteur"),
                      })}
                      onChange={(e) =>
                        setChoix((c) => {
                          const suivant = new Set(c);
                          if (e.target.checked) suivant.add(p.id);
                          else suivant.delete(p.id);
                          return suivant;
                        })
                      }
                    />
                    {contenu}
                  </label>
                ) : (
                  <Link
                    key={p.id}
                    to="/pme/piece/$pieceId"
                    params={{ pieceId: p.id }}
                    onClick={() => ouvrirSaSociete(p.id)}
                    className={cn("pc", p.status === "capturee" && "dim")}
                  >
                    {contenu}
                  </Link>
                );
              })}
              {tranches.reste ? <span ref={tranches.sentinelle} aria-hidden /> : null}
            </div>
          </>
        ) : bureau ? (
          /*
           * Au bureau, un seul tableau (maquette « Bibliothèque — desktop ») :
           * les dossiers en puces, les filtres, puis toutes les pièces par mois,
           * cochables, avec le résumé à droite. Les sièges restent au-dessus.
           */
          <>
            {lesSieges}
            <TableauDuBureau
              pieces={ici}
              sommes={sommes}
              nomDuMois={nomDuMois}
              nomDe={nomDe}
              etatDe={etatDe}
              jour={jour}
              societesDuLot={societesDuLot}
              ouvrirSaSociete={ouvrirSaSociete}
            />
          </>
        ) : (
          <>
            {/* ------------------------------------------------ les dossiers */}
            {sept.dossiers.length > 0 ? (
              <>
                <div className="sec">
                  <h2>{t("pme.home.dossiers")}</h2>
                  <span>{sept.dossiers.length}</span>
                </div>
                <RailDesDossiers pieces={ici} />
              </>
            ) : null}

            {/*
             * Plus de section « Organisations » (9 novembre 2026) : la société
             * montrée est celle de l'en-tête, et « Toutes les sociétés » s'y
             * choisit aussi.
             */}
            {/* ------------------------------------------------- les sièges */}
            {/*
             * La même rangée que dans un dossier (10 novembre 2026) : une carte
             * par siège poussait les mois hors de l'écran dès qu'une organisation
             * en comptait quelques dizaines. Choisir un siège ouvre ses pièces.
             */}
            {lesSieges}

            {/* --------------------------------------------------- les mois */}
            <div className="sec">
              <h2>{t("pme.vue.mois")}</h2>
              <span>{mois.length}</span>
            </div>
            {mois.length === 0 ? <p className="sub">{t("pme.list.empty")}</p> : null}
            {vusDansLaListe.map(([cle, ps]) => (
              <CarteDeGroupe
                key={cle}
                onClick={() => ouvrir({ genre: "mois", cle })}
                accent={ps.every((p) => p.kind === "facture_vente")}
                icone={<IconeCalendrier />}
                titre={nomDuMois(cle)}
                sous={<span className="k">{dossiersDe(ps)}</span>}
                valeur={sommes(ps)}
                n={ps.length}
              />
            ))}
            {mois.length > PREMIERS ? (
              <button type="button" className="more" onClick={() => setTout(!tout)}>
                {tout ? t("pme.list.replier") : t("pme.list.voirTout", { n: mois.length })}
              </button>
            ) : null}
          </>
        )}

        {/* Ce qui attend de partir, pour ce dossier. Il parle de lui-même. */}
        <FileLocale />
      </div>
    </div>
  );
}

/**
 * La vraie photo d'une ligne, à gauche, et son point d'état : le statut dérivé
 * au Socle, des faits que la liste porte déjà. Non lue : point gris.
 */
function VignetteDeLaPiece({ piece }: { piece: PieceLue }) {
  const ton = piece.status === "capturee" ? "neutre" : TON_PME[statutDeLaPieceLue(piece)];
  return <ApercuDePiece pieceId={piece.id} className="vignette" ton={ton} />;
}

/**
 * La Bibliothèque au bureau (maquette « Bibliothèque — desktop », validée par le
 * dirigeant) : les dossiers en puces, une barre de filtres, un tableau dense par
 * mois — total par mois et total général —, la sélection multiple et le résumé
 * à droite.
 *
 * Les colonnes sont celles que la liste porte : le net à payer (le montant de la
 * pièce), et, quand une retenue est tranchée, le TTC avant elle et la retenue.
 * La liste ne porte ni la base HT ni la TVA : le tableau ne les invente pas, la
 * fiche de la pièce les dit.
 */
function TableauDuBureau({
  pieces,
  sommes,
  nomDuMois,
  nomDe,
  etatDe,
  jour,
  societesDuLot,
  ouvrirSaSociete,
}: {
  pieces: readonly PieceLue[];
  sommes: (ps: readonly PieceLue[]) => ReactNode;
  nomDuMois: (cle: string) => string;
  nomDe: (p: PieceLue) => string;
  etatDe: (p: PieceLue) => ReactNode;
  jour: (p: PieceLue) => string;
  societesDuLot: (lot: readonly PieceLue[]) => SocieteExportee[];
  ouvrirSaSociete: (pieceId: string) => void;
}) {
  const { t, locale } = useI18n();
  const sept = useDossiers();
  const [dossier, setDossier] = useState<string | null>(null);
  const [moisChoisi, setMois] = useState<string | null>(null);
  const [etat, setEtat] = useState<StatutPme | null>(null);
  const [avecRetenue, setAvecRetenue] = useState(false);
  const [coches, setCoches] = useState<ReadonlySet<string>>(new Set());

  const dossierDe = (p: PieceLue) => dossierDeLaPiece(p, sept.types);
  const etatDeLaPiece = (p: PieceLue) =>
    p.status === "capturee" ? null : statutDuCircuit(p).statut;
  const choisi = sept.parCode(dossier);

  const duDossier = dossier === null ? pieces : pieces.filter((p) => dossierDe(p) === dossier);
  const filtrees = duDossier.filter(
    (p) =>
      (moisChoisi === null || moisDeLaPiece(p) === moisChoisi) &&
      (etat === null || etatDeLaPiece(p) === etat) &&
      (!avecRetenue || Boolean(p.retenue)),
  );
  const groupes = groupesParMois(filtrees);
  const moisPresents = groupesParMois(duDossier).map(([cle]) => cle);
  const etatsPresents = [
    ...new Set(duDossier.map(etatDeLaPiece).filter((s): s is StatutPme => s !== null)),
  ];
  const cochees = filtrees.filter((p) => coches.has(p.id));
  const toutCoche = filtrees.length > 0 && cochees.length === filtrees.length;

  // Des centaines de pièces se dessinent par tranches, comme un groupe ouvert.
  const tranches = useParTranches(
    filtrees,
    60,
    `${dossier}:${moisChoisi}:${etat}:${avecRetenue}:${pieces.length}`,
  );
  const visibles = new Set(tranches.visibles.map((p) => p.id));

  const cocher = (id: string, oui: boolean) =>
    setCoches((c) => {
      const suivant = new Set(c);
      if (oui) suivant.add(id);
      else suivant.delete(id);
      return suivant;
    });

  // Un montant garde son signe devant lui, en arabe aussi : il s'écrit de gauche à droite.
  const chiffre = (v: string | null) =>
    v === null ? "—" : <span dir="ltr">{montant(v, locale)}</span>;
  const etendue = etendueDesPeriodes(
    groupes.map(([cle]) => cle),
    false,
    (cle, avecAnnee) =>
      new Intl.DateTimeFormat(locale, {
        month: "short",
        ...(avecAnnee ? { year: "numeric" } : {}),
        timeZone: "UTC",
      }).format(new Date(`${cle}-01T00:00:00Z`)),
  );
  const titre = choisi?.libelle ?? t("pme.home.bibliotheque");
  // Imprimer et exporter portent la sélection, ou, sans elle, tout ce que les filtres montrent.
  const lot = cochees.length > 0 ? cochees : filtrees;
  const cleDuLot = lot.map((p) => p.id).join(",");

  return (
    <div className="b-biblio">
      <div className="b-puces" role="group" aria-label={t("pme.home.dossiers")}>
        <button
          type="button"
          className="b-puce"
          aria-pressed={dossier === null}
          onClick={() => setDossier(null)}
        >
          {t("pme.list.bureau.tous")}
          <span className="n">{pieces.length}</span>
        </button>
        {sept.dossiers.map((d) => (
          <button
            key={d.code}
            type="button"
            className="b-puce"
            data-teinte={d.teinte}
            aria-pressed={dossier === d.code}
            onClick={() => {
              setDossier(d.code);
              setMois(null);
              setEtat(null);
            }}
          >
            <i aria-hidden />
            {d.libelle}
            <span className="n">{pieces.filter((p) => dossierDe(p) === d.code).length}</span>
          </button>
        ))}
      </div>

      <div className="b-grille">
        <section className="b-table" aria-label={titre}>
          <div className="b-filtres" role="group" aria-label={t("pme.list.bureau.filtres")}>
            <label>
              <span>{t("pme.vue.mois")}</span>
              <select
                value={moisChoisi ?? ""}
                onChange={(e) => setMois(e.target.value === "" ? null : e.target.value)}
              >
                <option value="">{t("pme.list.bureau.tous")}</option>
                {moisPresents.map((cle) => (
                  <option key={cle} value={cle}>
                    {nomDuMois(cle)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{t("pme.list.bureau.etat")}</span>
              <select
                value={etat ?? ""}
                onChange={(e) => setEtat(etatsPresents.find((s) => s === e.target.value) ?? null)}
              >
                <option value="">{t("pme.list.bureau.tous")}</option>
                {etatsPresents.map((s) => (
                  <option key={s} value={s}>
                    {t(MOT_PME[s])}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="b-bascule"
              aria-pressed={avecRetenue}
              onClick={() => setAvecRetenue((v) => !v)}
            >
              {t("pme.list.bureau.avecRetenue")}
            </button>
            <span className="b-actions">
              <ImprimerDepuisLaPme
                key={`imprimer:${cleDuLot}`}
                pieces={lot.map((p) => p.id)}
                portee={cochees.length > 0 ? "selection" : "dossier"}
                nom={titre}
                libelle={
                  cochees.length > 0
                    ? t("cab.biblio.imprimer.selection", { n: cochees.length })
                    : t("cab.biblio.imprimer.tout", { n: filtrees.length })
                }
                classe="b-act"
                classeDuTexte="sub"
              />
              <ExporterDepuisLaPme
                key={`exporter:${cleDuLot}`}
                pieces={lot.map((p) => p.id)}
                societes={societesDuLot(lot)}
                titre={
                  cochees.length > 0
                    ? t("pme.export.selection", { n: cochees.length })
                    : t("pme.export.titre", { mois: titre })
                }
                libelle={
                  cochees.length > 0
                    ? t("pme.export.selection", { n: cochees.length })
                    : t("pme.list.bureau.exporter")
                }
                classe="b-act pr"
                classeDuTexte="sub"
              />
            </span>
          </div>

          <table>
            <thead>
              <tr>
                <th scope="col" className="ck">
                  <input
                    type="checkbox"
                    checked={toutCoche}
                    disabled={filtrees.length === 0}
                    aria-label={t("pme.list.bureau.toutCocher")}
                    onChange={(e) =>
                      setCoches(e.target.checked ? new Set(filtrees.map((p) => p.id)) : new Set())
                    }
                  />
                </th>
                <th scope="col">{t("pme.piece.title")}</th>
                <th scope="col">{t("pme.extract.date")}</th>
                <th scope="col" className="nb">
                  {t("pme.extract.ttc")}
                </th>
                <th scope="col" className="nb">
                  {t("pme.extract.retenue")}
                </th>
                <th scope="col" className="nb">
                  {t("pme.extract.netAPayer")}
                </th>
              </tr>
            </thead>
            <tbody>
              {filtrees.length === 0 ? (
                <tr>
                  <td colSpan={6} className="vide">
                    {pieces.length === 0 ? t("pme.list.empty") : t("pme.list.bureau.aucune")}
                  </td>
                </tr>
              ) : null}
              {groupes.map(([cle, ps]) => {
                const montrees = ps.filter((p) => visibles.has(p.id));
                if (montrees.length === 0) return null;
                return (
                  <Fragment key={cle}>
                    <tr className="mo">
                      <th scope="colgroup" colSpan={3}>
                        {nomDuMois(cle)}
                        <span>{t("pme.doc.compte", { count: ps.length })}</span>
                      </th>
                      <td colSpan={3} className="nb">
                        {sommes(ps)}
                      </td>
                    </tr>
                    {montrees.map((p) => {
                      const net = p.total === null ? null : montantDeLaPiece(p, sept.types);
                      return (
                        <tr key={p.id} className={cn(p.status === "capturee" && "dim")}>
                          <td className="ck">
                            <input
                              type="checkbox"
                              checked={coches.has(p.id)}
                              aria-label={t("cab.biblio.imprimer.cocher", { nom: nomDe(p) })}
                              onChange={(e) => cocher(p.id, e.target.checked)}
                            />
                          </td>
                          <td>
                            <Link
                              to="/pme/piece/$pieceId"
                              params={{ pieceId: p.id }}
                              onClick={() => ouvrirSaSociete(p.id)}
                              className={cn("pc b-piece", p.status === "capturee" && "dim")}
                            >
                              <VignetteDeLaPiece piece={p} />
                              <span className="cps">
                                <span className="nm">{nomDe(p)}</span>
                                <span className="mt">
                                  {sept.parCode(dossierDe(p))?.libelle ?? null}
                                  {etatDe(p)}
                                </span>
                              </span>
                            </Link>
                          </td>
                          <td className="dt">{jour(p)}</td>
                          <td className="nb">{chiffre(p.retenue ? p.retenue.totalTtc : net)}</td>
                          <td className={cn("nb", p.retenue && "ras")}>
                            {p.retenue ? (
                              <span dir="ltr">−{montant(p.retenue.montant, locale)}</span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className={cn("nb net", p.kind === "facture_vente" && "rec")}>
                            {chiffre(net)}
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                );
              })}
            </tbody>
            {filtrees.length > 0 ? (
              <tfoot>
                <tr>
                  <th scope="row" colSpan={3}>
                    {t("pme.list.bureau.total")}
                    <span>{t("pme.doc.compte", { count: filtrees.length })}</span>
                  </th>
                  <td colSpan={3} className="nb">
                    {sommes(filtrees)}
                  </td>
                </tr>
              </tfoot>
            ) : null}
          </table>
          {tranches.reste ? <span ref={tranches.sentinelle} aria-hidden /> : null}
        </section>

        <aside className="b-cote">
          <section className="b-resume" data-teinte={choisi?.teinte}>
            <span className="k">{[titre, etendue].filter(Boolean).join(" · ")}</span>
            <b>{sommes(filtrees)}</b>
            <span>
              {t("pme.doc.compte", { count: filtrees.length })} ·{" "}
              {t("pme.home.dossier.faites", {
                count: filtrees.filter((p) => statutDeLaPieceLue(p) === "prise_en_charge").length,
              })}
            </span>
            {choisi ? (
              <Link to="/pme/dossier/$type" params={{ type: choisi.code }}>
                {t("pme.list.bureau.ouvrirDossier", { dossier: choisi.libelle })}
              </Link>
            ) : null}
          </section>
          <section className="b-sel">
            <b>{t("pme.list.bureau.selection")}</b>
            <span>
              {cochees.length > 0
                ? t("pme.list.bureau.cochees", { count: cochees.length })
                : t("pme.list.bureau.selection.aide")}
            </span>
            {cochees.length > 0 ? (
              <button type="button" onClick={() => setCoches(new Set())}>
                {t("pme.list.bureau.decocher")}
              </button>
            ) : null}
            <span className="k">{t("pme.list.bureau.raccourci")}</span>
          </section>
        </aside>
      </div>
    </div>
  );
}
