import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { ApercuDePiece } from "@/components/malica/apercu-de-piece";
import { usePme } from "@/components/malica/pme-context";
import { useI18n, type MessageKey } from "@/i18n";
import { montant } from "@/lib/lisible";
import { office } from "@/verticals/malica-office/composition";
import type { PieceLue } from "@malica/socle/ports/repositories";

export const Route = createFileRoute("/_authenticated/pme/dossier/$type")({
  head: () => ({
    meta: [{ title: "Dossier — Malica Office" }],
  }),
  component: Dossier,
});

/**
 * Un dossier ouvert — la « playlist » d'un type de pièce.
 *
 * 23 octobre 2026, maquette validée par Wissem : la pochette touchée sur
 * l'accueil s'ouvre ici, avec UN geste principal (vérifier ce qui attend),
 * des filtres par état — seulement ceux qui ont des pièces — et la liste, chaque
 * ligne avec la vraie page en aperçu.
 *
 * Les pièces viennent de la lecture que l'accueil a déjà faite
 * (`capture.listAvecLecture` : type, émetteur, date, total — toutes les
 * pièces, pas les cent dernières), sous la même clé : ouvrir un dossier ne
 * coûte aucune requête de plus. Une pièce privée n'est pas dans la bibliothèque, donc pas ici.
 */

/** Les états qu'une personne distingue, et la clé de leur nom. */
type Etat = "verifier" | "retour" | "comptabilisee" | "nonLue" | "autre";

const ETATS: ReadonlyArray<{ etat: Exclude<Etat, "autre">; cle: MessageKey }> = [
  { etat: "verifier", cle: "pme.charges.answer.verifier" },
  { etat: "retour", cle: "pme.home.etat.retour" },
  { etat: "comptabilisee", cle: "pme.dossier.etat.comptabilisee" },
  { etat: "nonLue", cle: "pme.refus.titre" },
];

function etatDe(p: PieceLue): Etat {
  if (p.status === "lue" || p.status === "proposee") return "verifier";
  if (p.status === "retournee") return "retour";
  if (p.status === "comptabilisee" || p.status === "supervisee") return "comptabilisee";
  if (p.status === "capturee") return "nonLue";
  return "autre";
}

function Dossier() {
  const { type } = Route.useParams();
  const { t, locale } = useI18n();
  const pme = usePme();
  const navigate = useNavigate();
  const [filtre, setFiltre] = useState<Etat | "toutes">("toutes");

  const lues = useQuery({
    queryKey: ["pieces-lues", pme.tenantId],
    queryFn: () => office().capture.listAvecLecture(pme.tenantId),
  });
  const typesDoc = useQuery({
    queryKey: ["types-document", locale],
    queryFn: () => office().referential.typesDeDocument(locale),
    staleTime: 60 * 60 * 1000,
  });

  const libelle = (typesDoc.data ?? []).find((x) => x.code === type)?.libelle ?? type;
  const toutes = (lues.data ?? [])
    .filter((p) => p.typeDeDocument === type && p.vis !== "personnel")
    .sort((x, y) => y.createdAt.localeCompare(x.createdAt));
  const faites = toutes.filter((p) => etatDe(p) === "comptabilisee").length;
  const aVerifier = toutes.filter((p) => etatDe(p) === "verifier");
  const filtres = ETATS.filter((e) => toutes.some((p) => etatDe(p) === e.etat));
  const visibles = filtre === "toutes" ? toutes : toutes.filter((p) => etatDe(p) === filtre);
  const part = toutes.length === 0 ? 0 : Math.round((faites / toutes.length) * 100);
  const jour = (iso: string) =>
    new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", timeZone: "UTC" }).format(
      new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso),
    );

  return (
    <div data-ecran="pochette" className="-mx-4 -my-5 flex min-h-0 flex-1 flex-col">
      <div className="tete">
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
            <span className="k">{t("pme.dossier.kicker")}</span>
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

        {lues.isPending ? (
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
                  <ApercuDePiece pieceId={p.id} className="mini" />
                  <span className="bd">
                    <b>{p.emetteur ?? t("pme.capture.pieceNonLue")}</b>
                    <span>
                      <i data-etat={e} />
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
      </div>
    </div>
  );
}
