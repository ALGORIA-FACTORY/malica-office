/**
 * Le dossier d'une comptabilité — planche 6, approuvée le 7 novembre 2026.
 *
 * « Tout ce qui relie la société à AUDICORP, au même endroit. » Trois
 * onglets :
 *   À répondre   les pièces qu'elle a retournées ;
 *   Transmis     ce qui est parti chez elle ;
 *   Mandat       les sociétés qu'elle tient.
 * Avec plusieurs sociétés, un choix « Toutes ses sociétés » les filtre.
 *
 * Aucune lecture de plus : les fiches des sociétés et les pièces viennent des
 * mêmes clés que les Réglages et la bibliothèque. Ni prix ni paiement ici.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { ApercuDePiece } from "@/components/malica/apercu-de-piece";
import { usePme } from "@/components/malica/pme-context";
import { useFichesDesSocietes } from "@/hooks/use-fiches-des-societes";
import { usePiecesLuesDesSocietes } from "@/hooks/use-pieces-lues";
import { useRevenir } from "@/hooks/use-revenir";
import { useI18n } from "@/i18n";
import { jourEtMois } from "@/lib/lisible";

export const Route = createFileRoute("/_authenticated/pme/comptabilite/$cabinetId")({
  component: DossierDeLaComptabilite,
});

type Onglet = "repondre" | "transmis" | "mandat";

const TRANCHE = 200;

function DossierDeLaComptabilite() {
  const { cabinetId } = Route.useParams();
  const { t, locale } = useI18n();
  const pme = usePme();
  const navigate = useNavigate();
  const revenir = useRevenir();
  const { fiches } = useFichesDesSocietes();
  const [onglet, setOnglet] = useState<Onglet>("repondre");
  const [societe, setSociete] = useState<string>("toutes");
  /** Transmis se montre par tranches : rien n'est perdu au-delà de la première. */
  const [montres, setMontres] = useState(TRANCHE);

  const siennes = (fiches.data ?? []).filter((f) => f.cabinetId === cabinetId);
  const nom = siennes[0]?.cabinet ?? "";
  const ids = siennes.map((f) => f.tenantId);
  const lectures = usePiecesLuesDesSocietes(ids);
  const nomDe = new Map(pme.dossiers.map((d) => [d.id, d.name]));
  const vues = societe === "toutes" ? ids : ids.filter((id) => id === societe);
  const pieces = ids.flatMap((id, i) =>
    vues.includes(id) ? (lectures[i]?.data ?? []).map((p) => ({ p, tenantId: id })) : [],
  );
  const aRepondre = pieces.filter(({ p }) => p.status === "retournee");
  const transmis = pieces
    .filter(({ p }) => p.vis === "partage" && p.status !== "retournee")
    .sort((a, b) =>
      (b.p.transmiseLe ?? b.p.createdAt).localeCompare(a.p.transmiseLe ?? a.p.createdAt),
    );
  const ouvrir = (pieceId: string, tenantId: string) => {
    if (tenantId !== pme.tenantId) pme.choisirDossier(tenantId);
    void navigate({ to: "/pme/piece/$pieceId", params: { pieceId } });
  };
  const charge = fiches.isPending || lectures.some((q) => q.isPending);
  // Une lecture en échec n'est jamais une liste vide : on le dit, et on relance.
  const enEchec = fiches.isError || lectures.some((q) => q.isError);
  const relancer = () => {
    if (fiches.isError) void fiches.refetch();
    for (const q of lectures) if (q.isError) void q.refetch();
  };

  const ligne = ({ p, tenantId }: { p: (typeof pieces)[number]["p"]; tenantId: string }) => (
    <li key={p.id}>
      <button type="button" className="pc" onClick={() => ouvrir(p.id, tenantId)}>
        <ApercuDePiece pieceId={p.id} className="vignette" />
        <span className="bd">
          <b>{p.emetteur ?? t("pme.capture.pieceNonLue")}</b>
          <span>
            {[
              ids.length > 1 ? nomDe.get(tenantId) : null,
              jourEtMois(p.transmiseLe ?? p.dateDocument ?? p.createdAt, locale),
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </span>
        {p.status === "retournee" ? <em>{t("pme.compta.aFaire")}</em> : null}
      </button>
    </li>
  );

  return (
    <div
      data-ecran="comptabilite"
      data-famille="papiers"
      className="-mx-4 -my-5 flex min-h-0 flex-1 flex-col"
    >
      <div className="top">
        <button
          type="button"
          className="bk"
          aria-label={t("pme.regler.retour")}
          onClick={() => revenir("/pme/list")}
        >
          <svg viewBox="0 0 24 24" className="g" aria-hidden>
            <path d="M14.5 5.5L8 12l6.5 6.5" />
          </svg>
        </button>
        <span className="ttl">{nom}</span>
        <span className="av" aria-hidden>
          {nom.slice(0, 1).toLocaleUpperCase()}
        </span>
      </div>

      <div className="pad">
        <div className="puces" role="tablist" aria-label={nom}>
          {(
            [
              ["repondre", t("pme.compta.onglet.repondre"), aRepondre.length],
              ["transmis", t("pme.compta.onglet.transmis"), transmis.length],
              ["mandat", t("pme.compta.onglet.mandat"), siennes.length],
            ] as const
          ).map(([cle, libelle, n]) => (
            <button
              key={cle}
              type="button"
              role="tab"
              aria-selected={onglet === cle}
              onClick={() => setOnglet(cle)}
            >
              {libelle} <i>{n}</i>
            </button>
          ))}
        </div>
        {ids.length > 1 && onglet !== "mandat" ? (
          <select
            className="choix"
            value={societe}
            aria-label={t("pme.compta.societes")}
            onChange={(e) => {
              setSociete(e.target.value);
              setMontres(TRANCHE);
            }}
          >
            <option value="toutes">{t("pme.compta.toutes")}</option>
            {ids.map((id) => (
              <option key={id} value={id}>
                {nomDe.get(id) ?? id}
              </option>
            ))}
          </select>
        ) : null}

        {charge ? (
          <p className="foot">{t("common.loading")}</p>
        ) : enEchec ? (
          <div className="foot" role="alert">
            <p>{t("common.error")}</p>
            <button type="button" className="plus" onClick={relancer}>
              {t("common.reessayer")}
            </button>
          </div>
        ) : onglet === "repondre" ? (
          aRepondre.length > 0 ? (
            <ul className="liste">{aRepondre.map(ligne)}</ul>
          ) : (
            <p className="foot">{t("pme.compta.rienARepondre")}</p>
          )
        ) : onglet === "transmis" ? (
          transmis.length > 0 ? (
            <>
              <ul className="liste">{transmis.slice(0, montres).map(ligne)}</ul>
              {transmis.length > montres ? (
                <button
                  type="button"
                  className="plus"
                  onClick={() => setMontres((n) => n + TRANCHE)}
                >
                  {t("pme.compta.voirPlus", { count: transmis.length - montres })}
                </button>
              ) : null}
            </>
          ) : (
            <p className="foot">{t("pme.compta.rienTransmis")}</p>
          )
        ) : (
          <ul className="liste">
            {siennes.map((f) => (
              <li key={f.tenantId}>
                <button
                  type="button"
                  className="pc"
                  onClick={() =>
                    void navigate({ to: "/pme/reglages", search: { page: "societes" } })
                  }
                >
                  <span className="ini" aria-hidden>
                    {(nomDe.get(f.tenantId) ?? "·").slice(0, 1).toLocaleUpperCase()}
                  </span>
                  <span className="bd">
                    <b>{nomDe.get(f.tenantId) ?? f.tenantId}</b>
                    <span>{t("pme.compta.mandatActif")}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
