/**
 * Un dossier ouvert — la liste des pièces d'un des sept dossiers de la société.
 *
 * Écran de la PME : on y arrive en touchant la pochette d'un dossier sur l'accueil. Il
 * montre toutes les pièces du dossier, rangées par société et par siège quand l'abonnement
 * les ouvre, puis par mois (ou par année pour un dossier annuel) ; la période la plus
 * récente est déroulée. Chaque ligne porte un aperçu et un état : un mot et une couleur,
 * jamais une écriture comptable.
 *
 * Les pièces viennent de la lecture déjà faite par l'accueil (`capture.listAvecLecture`) :
 * ouvrir un dossier ne coûte aucune requête de plus. Une pièce privée n'y figure pas.
 * La société montrée est celle choisie dans l'en-tête.
 */
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Fragment, useEffect, useState } from "react";

import { ApercuDePiece } from "@/components/malica/apercu-de-piece";
import { CarteDeGroupe, IconeCalendrier } from "@/components/malica/carte-de-groupe";
import { ImprimerDepuisLaPme } from "@/components/malica/imprimer-les-pieces";
import { RangeeDesSieges, type Siege } from "@/components/malica/rangee-des-sieges";
import { usePhotosDeProfil } from "@/hooks/use-photos-de-profil";
import { usePme } from "@/components/malica/pme-context";
import { useI18n, type MessageKey } from "@/i18n";
import { jourOuInstant, montant } from "@/lib/lisible";
import type { PieceLue } from "@malica/socle/ports/repositories";
import { TON_PME, type StatutPme } from "@malica/socle/statut-d-envoi";
import { attendLaPersonne, statutDeLaPieceLue } from "@/lib/lecture";
import { MOT_PME } from "@/lib/statut";
import { usePiecesDesSocietes } from "@/hooks/use-pieces-des-societes";
import { ParTranches } from "@/components/malica/par-tranches";
import { useDossiers } from "@/hooks/use-dossiers";
import { currentPeriod } from "@/hooks/use-tva";
import { dossierDeLaPiece, moisDeLaPiece, periodeMontree } from "@/lib/dossiers";
import { sommeDecimale } from "@malica/socle/somme-decimale";
import { useRevenir } from "@/hooks/use-revenir";

export const Route = createFileRoute("/_authenticated/pme/dossier/$type")({
  head: () => ({
    meta: [{ title: "Dossier — Malica Office" }],
  }),
  /*
   * Une autre pièce, un autre écran : sans cela, le routeur garde le
   * composant et son état d'une pièce à l'autre (« Validée » affiché sur la
   * suivante, boutons disparus — audit du 27 octobre 2026).
   */
  remountDeps: ({ params }) => params,
  component: Dossier,
});

/**
 * Un dossier ouvert — la « playlist » d'un des sept dossiers (`ref.dossiers`).
 *
 * 23 octobre 2026, maquette validée par Wissem : la pochette touchée sur
 * l'accueil s'ouvre ici, avec UN geste principal (ouvrir ce qui attend) et la
 * liste, chaque ligne avec la vraie page en aperçu. L'état est le statut de la
 * pièce, un mot et une couleur (« Malica sans blocage », §2) : jamais une écriture.
 *
 * 1er novembre 2026, maquette validée par Wissem : plus de filtres par état ni
 * de renvoi « pièces plus anciennes » vers la bibliothèque. Le dossier montre
 * TOUTES ses pièces, rangées comme la bibliothèque : les sociétés et les sièges
 * quand l'abonnement les ouvre, puis les mois (ou les années d'un dossier
 * annuel), chacun déroulant ses pièces. La période la plus récente est
 * déroulée à l'ouverture, comme la carte de l'accueil la montre.
 *
 * Les pièces viennent de la lecture que l'accueil a déjà faite
 * (`capture.listAvecLecture` : type, émetteur, date, total — toutes les
 * pièces, pas les cent dernières), sous la même clé : ouvrir un dossier ne
 * coûte aucune requête de plus. Une pièce privée n'est pas dans la bibliothèque, donc pas ici.
 */

/** Les états qu'une personne distingue : le statut d'une pièce lue, ou « non lue ». */
type Etat = StatutPme | "nonLue" | "autre";

/** Dans l'ordre des filtres : ce qui vous attend d'abord, puis ce qui est chez le cabinet. */
const ETATS: ReadonlyArray<{ etat: Exclude<Etat, "autre">; cle: MessageKey }> = [
  { etat: "a_envoyer", cle: MOT_PME.a_envoyer },
  { etat: "retour", cle: MOT_PME.retour },
  // La file du propriétaire : les pièces de ses sièges (lot 4).
  { etat: "recue", cle: MOT_PME.recue },
  { etat: "corrigee", cle: MOT_PME.corrigee },
  { etat: "retournee", cle: MOT_PME.retournee },
  { etat: "envoyee", cle: MOT_PME.envoyee },
  { etat: "vue", cle: MOT_PME.vue },
  { etat: "prise_en_charge", cle: MOT_PME.prise_en_charge },
  { etat: "gardee", cle: MOT_PME.gardee },
  { etat: "nonLue", cle: "pme.refus.titre" },
];

function etatDe(p: PieceLue): Etat {
  // Un reçu ou un justificatif ne se lit pas : il n'est jamais « non lu ».
  if (p.accompagne) return "autre";
  if (p.status === "capturee") return "nonLue";
  return statutDeLaPieceLue(p);
}

/** La couleur du point : celle du statut ; une pièce non lue reste grise. */
const tonDe = (e: Etat) => (e === "nonLue" || e === "autre" ? "neutre" : TON_PME[e]);

function Dossier() {
  const { type } = Route.useParams();
  const { t, locale } = useI18n();
  const pme = usePme();
  const navigate = useNavigate();
  const revenir = useRevenir();

  const {
    toutes: dePme,
    parSociete,
    parSiege,
    chargement: lecture,
    nomDeSociete,
    parSieges,
    ouvrirSaSociete,
  } = usePiecesDesSocietes();

  /*
   * La société montrée est CELLE DE L'EN-TÊTE (`pme.societeAffichee`, « Toutes
   * les sociétés » = `null`). Une seule sélection pour tous les écrans
   * (10 novembre 2026) : plus de cartes « Organisations » ici, qui la
   * redisaient.
   */
  const societe = pme.societeAffichee;
  const [siege, setSiege] = useState<string | null>(null);
  /** La période déroulée ; `undefined` : la plus récente qui a des pièces. */
  const [ouverte, setOuverte] = useState<string | null | undefined>(undefined);
  // Changer de société dans l'en-tête (9 novembre 2026) oublie le siège et
  // la période choisis : ils étaient ceux de l'autre société (revue de #315).
  useEffect(() => {
    setSiege(null);
    setOuverte(undefined);
  }, [societe]);

  /*
   * Le paramètre est un DOSSIER (`ref.dossiers`) depuis le 25 octobre 2026.
   * Un lien d'avant portait un type : il ouvre le dossier de ce type.
   */
  const sept = useDossiers();
  const dossier =
    sept.parCode(type) ?? sept.parCode(sept.types.find((x) => x.code === type)?.dossier);
  const libelle = dossier?.libelle ?? "";

  const toutes = dePme.filter(
    (x) => dossier !== null && dossierDeLaPiece(x.piece, sept.types) === dossier.code,
  );

  const deLaSociete = toutes.filter((x) => !parSociete || !societe || x.societe === societe);
  const retenues = deLaSociete
    .filter((x) => !parSiege || !siege || x.piece.auteurId === siege)
    .map((x) => x.piece)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  // ------------------------------------------------------------ les sièges
  // Ceux des pièces que l'en-tête montre ; toutes les sociétés : chaque siège
  // dit la sienne (celle de sa première pièce — un siège est d'une société).
  const groupes = [...parSieges(deLaSociete.map((x) => x.piece))];
  const photos = usePhotosDeProfil(groupes.map(([id]) => id));
  const sieges: Siege[] = groupes.map(([id, g]) => ({
    id,
    nom: g.nom,
    pieces: g.pieces,
    photo: photos[id] ?? null,
    societe:
      parSociete && societe === null
        ? nomDeSociete(deLaSociete.find((x) => x.piece.auteurId === id)?.societe ?? "")
        : null,
  }));
  const siegeChoisi = sieges.find((x) => x.id === siege) ?? null;

  // ----------------------------------------------------------- les périodes
  const annuel = dossier?.periode === "annee";
  const periodeDe = (p: PieceLue) => (annuel ? moisDeLaPiece(p).slice(0, 4) : moisDeLaPiece(p));
  const periodes = [...new Set(retenues.map(periodeDe))].sort().reverse();
  const deroulee =
    ouverte !== undefined
      ? ouverte
      : retenues.length > 0 && dossier
        ? periodeMontree(retenues, dossier.periode, currentPeriod())
        : null;
  const nomDePeriode = (cle: string, avecAnnee: boolean) =>
    annuel
      ? cle
      : new Intl.DateTimeFormat(locale, {
          month: "long",
          ...(avecAnnee ? { year: "numeric" } : {}),
          timeZone: "UTC",
        }).format(new Date(`${cle}-01T00:00:00Z`));
  const etiquette = deroulee ? nomDePeriode(deroulee, false) : "";

  const total = (ps: readonly PieceLue[]) => {
    const connus = ps.map((p) => p.total).filter((v): v is string => v !== null);
    return `${libelle} ${connus.length === 0 ? "—" : montant(sommeDecimale(connus), locale)}`;
  };
  const typesDe = (ps: readonly PieceLue[]) =>
    [
      ...new Set(
        ps
          .map((p) => sept.types.find((x) => x.code === p.typeDeDocument)?.libelle)
          .filter((l): l is string => Boolean(l)),
      ),
    ].join(" · ");

  const faites = retenues.filter((p) => etatDe(p) === "prise_en_charge").length;
  const aVerifier = retenues.filter(attendLaPersonne);
  const part = retenues.length === 0 ? 0 : Math.round((faites / retenues.length) * 100);
  const jour = (iso: string) => jourOuInstant(iso, locale);
  const chargement = lecture || !sept.pret;

  return (
    <div data-ecran="pochette" className="-mx-4 -my-5 flex min-h-0 flex-1 flex-col">
      <div className="tete" data-teinte={dossier?.teinte}>
        <button
          type="button"
          className="bk"
          aria-label={t("pme.regler.retour")}
          onClick={() => revenir("/pme")}
        >
          <svg viewBox="0 0 24 24" className="g fl" aria-hidden>
            <path d="M14.5 5.5L8 12l6.5 6.5" />
          </svg>
        </button>
        <div className="id">
          <span className="cv" aria-hidden="true">
            <span className="ini">{libelle.slice(0, 1)}</span>
          </span>
          <span className="tx">
            <span className="k">
              {[t("pme.dossier.kicker"), etiquette, siegeChoisi?.nom].filter(Boolean).join(" · ")}
            </span>
            <h1>{libelle}</h1>
            <span>{t("pme.home.dossier.pieces", { count: retenues.length })}</span>
          </span>
        </div>
        <div className="av">
          <span className="bar">
            <i style={{ width: `${part}%` }} />
          </span>
          <span>{t("pme.dossier.avancement", { fait: faites, total: retenues.length })}</span>
        </div>
      </div>

      <div className="pad">
        <div className="gestes">
          {aVerifier[0] ? (
            <Link
              to="/pme/piece/$pieceId"
              params={{ pieceId: aVerifier[0].id }}
              onClick={() => ouvrirSaSociete(aVerifier[0]!.id)}
              className="principal"
            >
              {t("pme.dossier.verifier", { count: aVerifier.length })}
            </Link>
          ) : null}
          {/*
           * Le « + » du dossier est le « + » de la barre : il ouvre « Ajouter
           * des pièces » (photographier, importer des images ou des PDF), pas
           * l'appareil photo directement (1er novembre 2026, Wissem).
           */}
          <button
            type="button"
            className="plus"
            aria-label={t("pme.nav.add")}
            disabled={pme.capturing}
            onClick={() => void navigate({ to: "/pme/capturer", search: { dossier: type } })}
          >
            <svg viewBox="0 0 24 24" className="g" aria-hidden>
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>
        {/* Imprimer le dossier (7.7) : ce que l'écran montre, siège et société compris. */}
        {chargement ? null : (
          <ImprimerDepuisLaPme
            key={`${type}:${societe}:${siege}`}
            pieces={retenues.map((p) => p.id)}
            portee="dossier"
            nom={libelle}
            libelle={t("cab.biblio.imprimer.dossier")}
            classe="plus-anciennes"
            classeDuTexte="vide"
          />
        )}

        {chargement ? (
          <p className="vide">{t("common.loading")}</p>
        ) : toutes.length === 0 ? (
          <p className="vide">{t("pme.dossier.vide")}</p>
        ) : (
          <>
            {parSiege && sieges.length > 0 ? (
              <RangeeDesSieges
                sieges={sieges}
                choisi={siege}
                choisir={(id) => {
                  setSiege(id);
                  setOuverte(undefined);
                }}
              />
            ) : null}

            <div className="sec">
              <h2>{annuel ? t("pme.dossier.annees") : t("pme.vue.mois")}</h2>
              <span>{periodes.length}</span>
            </div>
            {periodes.map((cle) => {
              const ps = retenues.filter((p) => periodeDe(p) === cle);
              const ouvert = deroulee === cle;
              return (
                <Fragment key={cle}>
                  <CarteDeGroupe
                    deroule={ouvert}
                    onClick={() => setOuverte(ouvert ? null : cle)}
                    icone={<IconeCalendrier />}
                    titre={nomDePeriode(cle, true)}
                    sous={<span className="k">{typesDe(ps)}</span>}
                    valeur={total(ps)}
                    n={ps.length}
                  />
                  {ouvert ? (
                    <div className="liste">
                      <ParTranches
                        elements={ps}
                        rendre={(p) => {
                          const e = etatDe(p);
                          const nom = ETATS.find((x) => x.etat === e);
                          return (
                            <Link
                              key={p.id}
                              to="/pme/piece/$pieceId"
                              params={{ pieceId: p.id }}
                              onClick={() => ouvrirSaSociete(p.id)}
                            >
                              <ApercuDePiece pieceId={p.id} className="vignette" />
                              <span className="bd">
                                <b>{p.emetteur ?? t("pme.capture.pieceNonLue")}</b>
                                <span>
                                  <i data-ton={tonDe(e)} />
                                  {[nom ? t(nom.cle) : null, jour(p.dateDocument ?? p.createdAt)]
                                    .filter(Boolean)
                                    .join(" · ")}
                                </span>
                              </span>
                              {p.total ? <em>{montant(p.total, locale)}</em> : null}
                            </Link>
                          );
                        }}
                      />
                    </div>
                  ) : null}
                </Fragment>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
