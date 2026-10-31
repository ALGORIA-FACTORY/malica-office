import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { ApercuDePiece } from "@/components/malica/apercu-de-piece";
import { usePme } from "@/components/malica/pme-context";
import { useI18n, type MessageKey } from "@/i18n";
import { jourOuInstant, montant } from "@/lib/lisible";
import type { PieceLue } from "@malica/socle/ports/repositories";
import { TON_PME, type StatutPme } from "@malica/socle/statut-d-envoi";
import { attendLaPersonne, statutDeLaPieceLue } from "@/lib/lecture";
import { MOT_PME } from "@/lib/statut";
import { usePiecesLues } from "@/hooks/use-pieces-lues";
import { useDossiers } from "@/hooks/use-dossiers";
import { currentPeriod } from "@/hooks/use-tva";
import { dansLaPeriodeMontree, dossierDeLaPiece, periodeMontree } from "@/lib/dossiers";

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
 * l'accueil s'ouvre ici, avec UN geste principal (ouvrir ce qui attend),
 * des filtres par état — seulement ceux qui ont des pièces — et la liste, chaque
 * ligne avec la vraie page en aperçu. L'état est le statut de la pièce, un
 * mot et une couleur (« Malica sans blocage », §2) : jamais une écriture.
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
  const [filtre, setFiltre] = useState<Etat | "toutes">("toutes");

  const lues = usePiecesLues();
  /*
   * Le paramètre est un DOSSIER (`ref.dossiers`) depuis le 25 octobre 2026.
   * Un lien d'avant portait un type : il ouvre le dossier de ce type.
   */
  const sept = useDossiers();
  const dossier =
    sept.parCode(type) ?? sept.parCode(sept.types.find((x) => x.code === type)?.dossier);
  const libelle = dossier?.libelle ?? "";
  /*
   * LA MÊME PÉRIODE QUE SA CARTE : la carte « Aucune pièce » ne doit pas
   * ouvrir une page pleine (revue du 25 octobre). Ce qui est plus ancien se
   * retrouve dans la bibliothèque, rangée par dossier.
   */
  const periode = currentPeriod();
  const duDossier = (lues.data ?? []).filter(
    (p) =>
      dossier !== null && p.vis !== "personnel" && dossierDeLaPiece(p, sept.types) === dossier.code,
  );
  // La période de sa carte : la plus récente qui a des pièces (`periodeMontree`).
  const montree = dossier ? periodeMontree(duDossier, dossier.periode, periode) : periode;
  const horsPeriode = dossier
    ? duDossier.filter((p) => !dansLaPeriodeMontree(p, montree)).length
    : 0;
  const etiquette = !dossier
    ? ""
    : dossier.periode === "mois"
      ? new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(
          new Date(`${montree}-01T00:00:00Z`),
        )
      : montree;
  const toutes = duDossier
    .filter((p) => dossier !== null && dansLaPeriodeMontree(p, montree))
    .sort((x, y) => y.createdAt.localeCompare(x.createdAt));
  const faites = toutes.filter((p) => etatDe(p) === "prise_en_charge").length;
  const aVerifier = toutes.filter(attendLaPersonne);
  const filtres = ETATS.filter((e) => toutes.some((p) => etatDe(p) === e.etat));
  const visibles = filtre === "toutes" ? toutes : toutes.filter((p) => etatDe(p) === filtre);
  const part = toutes.length === 0 ? 0 : Math.round((faites / toutes.length) * 100);
  const jour = (iso: string) => jourOuInstant(iso, locale);

  return (
    <div data-ecran="pochette" className="-mx-4 -my-5 flex min-h-0 flex-1 flex-col">
      <div className="tete" data-teinte={dossier?.teinte}>
        <button
          type="button"
          className="bk"
          aria-label={t("pme.regler.retour")}
          onClick={() => void navigate({ to: "/pme" })}
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
              {[t("pme.dossier.kicker"), etiquette].filter(Boolean).join(" · ")}
            </span>
            <h1>{libelle}</h1>
            <span>{t("pme.home.dossier.pieces", { count: toutes.length })}</span>
          </span>
        </div>
        <div className="av">
          <span className="bar">
            <i style={{ width: `${part}%` }} />
          </span>
          <span>{t("pme.dossier.avancement", { fait: faites, total: toutes.length })}</span>
        </div>
      </div>

      <div className="pad">
        <div className="gestes">
          {aVerifier[0] ? (
            <Link
              to="/pme/piece/$pieceId"
              params={{ pieceId: aVerifier[0].id }}
              className="principal"
            >
              {t("pme.dossier.verifier", { count: aVerifier.length })}
            </Link>
          ) : null}
          <button
            type="button"
            className="plus"
            aria-label={t("pme.capture.photo")}
            disabled={pme.capturing}
            onClick={() => pme.ouvrirScanner()}
          >
            <svg viewBox="0 0 24 24" className="g" aria-hidden>
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>

        {filtres.length > 1 ? (
          <div className="filtres" role="group">
            <button
              type="button"
              aria-pressed={filtre === "toutes"}
              onClick={() => setFiltre("toutes")}
            >
              {t("pme.dossier.filtre.toutes")}
            </button>
            {filtres.map((e) => (
              <button
                key={e.etat}
                type="button"
                aria-pressed={filtre === e.etat}
                onClick={() => setFiltre(e.etat)}
              >
                {t(e.cle)}
              </button>
            ))}
          </div>
        ) : null}

        {lues.isPending || !sept.pret ? (
          <p className="vide">{t("common.loading")}</p>
        ) : visibles.length === 0 ? (
          <p className="vide">{t("pme.dossier.vide")}</p>
        ) : (
          <div className="liste">
            {visibles.map((p) => {
              const e = etatDe(p);
              const nom = ETATS.find((x) => x.etat === e);
              return (
                <Link key={p.id} to="/pme/piece/$pieceId" params={{ pieceId: p.id }}>
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
            })}
          </div>
        )}
        {horsPeriode > 0 ? (
          <Link to="/pme/list" search={{ axe: "dossier" }} className="plus-anciennes">
            {t("pme.dossier.horsPeriode", { count: horsPeriode })}
          </Link>
        ) : null}
      </div>
    </div>
  );
}
