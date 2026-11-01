import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";

import { ApercuDePiece } from "@/components/malica/apercu-de-piece";
import {
  CarteDeGroupe,
  IconeCalendrier,
  IconeSiege,
  IconeSociete,
} from "@/components/malica/carte-de-groupe";
import { FileLocale } from "@/components/malica/file-locale";
import { EtatDeLecture } from "@/components/malica/lecture-refusee";
import { usePme } from "@/components/malica/pme-context";
import { RailDesDossiers } from "@/components/malica/rail-des-dossiers";
import { useI18n } from "@/i18n";
import { motifDeLEtat, refusDuPlafond } from "@/lib/champ-lisible";
import { piecesALire, statutDeLaPieceLue } from "@/lib/lecture";
import { statutDuCircuit, TON_PME } from "@malica/socle/statut-d-envoi";
import { motDuStatut } from "@/lib/statut";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { nombre } from "@/lib/forfait";
import { jourOuInstant, momentDeLEnvoi, montant } from "@/lib/lisible";
import { cn } from "@/lib/utils";
import { sommeDecimale } from "@malica/socle/somme-decimale";
import type { PieceLue } from "@malica/socle/ports/repositories";
import { clePiecesLues, usePiecesLues } from "@/hooks/use-pieces-lues";
import { usePiecesDesSocietes } from "@/hooks/use-pieces-des-societes";
import { useDossiers } from "@/hooks/use-dossiers";
import { dossierDeLaPiece, moisDeLaPiece } from "@/lib/dossiers";
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

/** Le groupe déroulé : un mois, un siège ou une organisation, et sa clé. */
interface Ouvert {
  genre: "mois" | "siege" | "societe";
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

  const { toutes, parSociete, parSiege, chargement, nomDeSociete, parSieges, ouvrirSaSociete } =
    usePiecesDesSocietes();
  /** Les pièces de la société ouverte : celles des dossiers, des sièges et des mois. */
  const ici = useMemo(
    () => toutes.filter((x) => x.societe === pme.tenantId).map((x) => x.piece),
    [toutes, pme.tenantId],
  );

  const [ouvert, setOuvert] = useState<Ouvert | null>(null);
  const [tout, setTout] = useState(false);

  // -------------------------------------------------------------- les groupes
  const organisations = pme.dossiers
    .map((d) => ({
      id: d.id,
      pieces: toutes.filter((x) => x.societe === d.id).map((x) => x.piece),
    }))
    .filter((c) => c.pieces.length > 0);
  const sieges = parSieges(ici);
  const mois = useMemo(() => {
    const carte = new Map<string, PieceLue[]>();
    for (const p of ici) {
      const cle = moisDeLaPiece(p);
      carte.set(cle, [...(carte.get(cle) ?? []), p]);
    }
    // Le plus récent devant.
    return [...carte].sort(([a], [b]) => b.localeCompare(a));
  }, [ici]);

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
    const achats = connus.filter((p) => p.kind !== "facture_vente").map((p) => p.total!);
    const ventes = connus.filter((p) => p.kind === "facture_vente").map((p) => p.total!);
    if (achats.length === 0 && ventes.length === 0) return "—";
    return (
      <>
        {achats.length > 0
          ? `${t("pme.doc.type.achats")} ${montant(sommeDecimale(achats), locale)}`
          : null}
        {achats.length > 0 && ventes.length > 0 ? " · " : null}
        {ventes.length > 0 ? (
          <u>
            {t("pme.doc.type.ventes")} {montant(sommeDecimale(ventes), locale)}
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
        : ouvert.genre === "siege"
          ? {
              titre: sieges.get(ouvert.cle)?.nom ?? "",
              pieces: sieges.get(ouvert.cle)?.pieces ?? [],
            }
          : {
              titre: nomDeSociete(ouvert.cle),
              pieces: organisations.find((c) => c.id === ouvert.cle)?.pieces ?? [],
            };
  const ouvrir = (suivant: Ouvert) => {
    setOuvert(suivant);
    window.scrollTo(0, 0);
  };

  const jour = (p: PieceLue) =>
    jourOuInstant(p.dateDocument ?? p.createdAt, locale, { day: "2-digit", month: "short" });

  const f = pme.forfait.ligne;

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

  return (
    /*
     * Les marges négatives annulent le `px-4 py-5` du layout : `.pad` porte
     * les siennes, et le dessin ne veut pas de double gouttière.
     */
    <div data-ecran="bibliotheque" className="-mx-4 -my-5 flex min-h-0 flex-1 flex-col">
      <div className="pad">
        <h1>{t("pme.home.bibliotheque")}</h1>

        {/*
         * Ce que la bibliothèque contient, et ce que le forfait laisse. Les
         * bornes du compteur s'écrivent « — » tant qu'on ne les sait pas.
         */}
        <p className="sub">
          {t("pme.doc.compte", { count: ici.length })}
          <br />
          {compte(f?.lectures_restantes)} / {compte(f?.lectures_droit)} · {t("pme.home.lectures")}
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
            <div className="lines">
              {groupeOuvert.pieces.map((p) => (
                <Link
                  key={p.id}
                  to="/pme/piece/$pieceId"
                  params={{ pieceId: p.id }}
                  onClick={() => ouvrirSaSociete(p.id)}
                  className={cn("pc", p.status === "capturee" && "dim")}
                >
                  <VignetteDeLaPiece piece={p} />
                  <span className="cps">
                    <span className="hd">
                      {/*
                       * Le titre ne ment pas : sans émetteur, une pièce LUE
                       * dit « sans émetteur », pas « pas encore lue ».
                       */}
                      <span className="nm">
                        {p.emetteur ??
                          (p.status === "capturee"
                            ? t("pme.list.nonLue")
                            : t("pme.list.sansEmetteur"))}
                      </span>
                      {/* Sans montant : « — », jamais « 0,000 », qui serait un fait comptable. */}
                      <span className={cn("vl", p.kind === "facture_vente" && "rec")}>
                        {p.total === null ? "—" : montant(p.total, locale)}
                      </span>
                    </span>
                    <span className="mt">
                      {[sept.parCode(dossierDeLaPiece(p, sept.types))?.libelle ?? null, jour(p)]
                        .filter((x): x is string => !!x)
                        .join(" · ")}
                    </span>
                    {/*
                     * Une pièce non lue n'est pas une pièce qui attend : au
                     * plafond, elle dit pourquoi elle n'a pas été lue.
                     */}
                    {p.status === "capturee" ? (
                      <EtatDeLecture refus={p.lectureRefusee} vis={p.vis} lecture={p.lecture} />
                    ) : (
                      // Le statut, un mot et une couleur — jamais une écriture.
                      <span className={cn("tag", TON_PME[statutDeLaPieceLue(p)])}>
                        <i aria-hidden />
                        {motDuStatut(statutDuCircuit(p), nomDuCabinet, t)}
                      </span>
                    )}
                  </span>
                </Link>
              ))}
            </div>
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

            {/* ------------------------------------------- les organisations */}
            {parSociete && organisations.length > 0 ? (
              <>
                <div className="sec">
                  <h2>{t("pme.dossier.organisations")}</h2>
                  <span>{organisations.length}</span>
                </div>
                {organisations.map((c) => (
                  <CarteDeGroupe
                    key={c.id}
                    onClick={() => ouvrir({ genre: "societe", cle: c.id })}
                    icone={<IconeSociete />}
                    titre={nomDeSociete(c.id)}
                    valeur={sommes(c.pieces)}
                    n={c.pieces.length}
                  />
                ))}
              </>
            ) : null}

            {/* ------------------------------------------------- les sièges */}
            {parSiege && sieges.size > 0 ? (
              <>
                <div className="sec">
                  <h2>{t("pme.dossier.sieges")}</h2>
                  <span>{sieges.size}</span>
                </div>
                {[...sieges].map(([id, g]) => (
                  <CarteDeGroupe
                    key={id}
                    onClick={() => ouvrir({ genre: "siege", cle: id })}
                    icone={<IconeSiege />}
                    titre={g.nom}
                    valeur={sommes(g.pieces)}
                    n={g.pieces.length}
                  />
                ))}
              </>
            ) : null}

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
