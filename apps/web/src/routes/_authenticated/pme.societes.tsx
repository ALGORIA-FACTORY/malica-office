/**
 * « Mes sociétés » — planche 13, approuvée le 8 novembre 2026.
 *
 * « On ne change ni l'accueil ni la bibliothèque ; on ne peut pas ajouter des
 * écrans intuitifs ? » Voici l'écran ajouté. Il s'ouvre par « Toutes les
 * sociétés », dans le choix de l'en-tête, et c'est le SEUL endroit où le
 * propriétaire voit toutes ses sociétés ensemble :
 *
 *   [ À traiter ] [ À lire ] [ En retard ]       les totaux
 *   [ Chercher parmi 113            ]
 *   ( Ce qui attend ) ( A → Z ) ( Épinglées )
 *   une ligne par société : ce qui l'attend ; un toucher ouvre son accueil
 *
 * Sur l'ordinateur, la même liste se lit en tableau.
 *
 * Rien de nouveau n'est demandé au serveur : ce sont les MÊMES lectures, sous
 * les MÊMES clés, que la cloche (les alertes), la bibliothèque (les pièces,
 * en un appel pour toutes les sociétés) et les échéances. Chacun ne voit que
 * ses sociétés : la base filtre (RLS) ; le propriétaire les voit toutes.
 *
 * Rien de commercial : ni offre, ni prix (coque Android).
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { ParTranches } from "@/components/malica/par-tranches";
import { usePme } from "@/components/malica/pme-context";
import { useSocietesEnBref } from "@/hooks/use-societes-en-bref";
import { useRevenir } from "@/hooks/use-revenir";
import { useI18n } from "@/i18n";
import { epinglees, type Ligne, plier, type Tri, trierLesLignes } from "@/lib/mes-societes";

export const Route = createFileRoute("/_authenticated/pme/societes")({
  component: MesSocietes,
});

function MesSocietes() {
  const { t, locale } = useI18n();
  const pme = usePme();
  const navigate = useNavigate();
  const revenir = useRevenir();
  const [cherche, setCherche] = useState("");
  const [tri, setTri] = useState<Tri>("attend");

  const { lignes, total, charge } = useSocietesEnBref();
  const q = plier(cherche.trim());
  const visibles = trierLesLignes(
    q
      ? lignes.filter((l) => plier(l.name).includes(q) || plier(l.matricule ?? "").includes(q))
      : lignes,
    tri,
    locale,
    tri === "epinglees" ? epinglees() : [],
  );

  const ouvrir = (id: string) => {
    if (id !== pme.tenantId) pme.choisirDossier(id);
    void navigate({ to: "/pme" });
  };

  const etat = (l: Ligne) =>
    [
      l.enRetard > 0 ? t("pme.mesSocietes.enRetardN", { count: l.enRetard }) : null,
      l.aTraiter > 0 ? t("pme.mesSocietes.aTraiterN", { count: l.aTraiter }) : null,
      l.aLire > 0 ? t("pme.mesSocietes.aLireN", { count: l.aLire }) : null,
    ]
      .filter(Boolean)
      .join(" · ") || t("pme.mesSocietes.aJour");

  const initiales = (nom: string) => {
    const mots = nom
      .replace(/[^\p{L}\p{N} ]/gu, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    return ((mots[0]?.[0] ?? "") + (mots[1]?.[0] ?? "")).toLocaleUpperCase() || "·";
  };

  return (
    <div
      data-ecran="mes-societes"
      data-famille="papiers"
      className="-mx-4 -my-5 flex min-h-0 flex-1 flex-col"
    >
      <div className="top">
        <button
          type="button"
          className="bk"
          aria-label={t("pme.regler.retour")}
          onClick={() => revenir("/pme")}
        >
          <svg viewBox="0 0 24 24" className="g" aria-hidden>
            <path d="M14.5 5.5L8 12l6.5 6.5" />
          </svg>
        </button>
        <span className="ttl">{t("pme.mesSocietes.titre")}</span>
      </div>

      <div className="pad">
        <div className="tot">
          <div>
            <small>{t("pme.notifs.onglet.aTraiter")}</small>
            <b>{charge ? "—" : total("aTraiter")}</b>
          </div>
          <div>
            <small>{t("pme.mesSocietes.aLire")}</small>
            <b>{charge ? "—" : total("aLire")}</b>
          </div>
          <div data-alerte={!charge && total("enRetard") > 0 ? "" : undefined}>
            <small>{t("pme.mesSocietes.enRetard")}</small>
            <b>{charge ? "—" : total("enRetard")}</b>
          </div>
        </div>

        <label className="cherche">
          <svg viewBox="0 0 24 24" className="g" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            type="search"
            value={cherche}
            placeholder={t("pme.mesSocietes.chercher", { count: lignes.length })}
            aria-label={t("pme.societes.chercher")}
            onChange={(e) => setCherche(e.target.value)}
          />
        </label>

        <div className="tris" role="group" aria-label={t("pme.mesSocietes.trier")}>
          {(
            [
              ["attend", t("pme.mesSocietes.triAttend")],
              ["az", t("pme.mesSocietes.triAZ")],
              ["epinglees", t("pme.societes.epinglees")],
            ] as const
          ).map(([cle, libelle]) => (
            <button key={cle} type="button" aria-pressed={tri === cle} onClick={() => setTri(cle)}>
              {libelle}
            </button>
          ))}
        </div>

        {visibles.length === 0 ? (
          <p className="rien">
            {tri === "epinglees" && !q
              ? t("pme.mesSocietes.aucuneEpinglee")
              : t("pme.societes.aucune")}
          </p>
        ) : (
          <>
            {/* Le téléphone : une ligne par société. */}
            <ul className="lignes">
              <ParTranches
                elements={visibles}
                rendre={(l) => (
                  <li key={l.id}>
                    <button type="button" onClick={() => ouvrir(l.id)}>
                      <span className="ini" aria-hidden>
                        {initiales(l.name)}
                      </span>
                      <span className="bd">
                        <b>{l.name}</b>
                        <span>{charge ? "…" : etat(l)}</span>
                      </span>
                      {l.enRetard > 0 ? <em>{t("pme.mesSocietes.retard")}</em> : null}
                      <svg viewBox="0 0 24 24" className="g" aria-hidden>
                        <path d="m9 6 6 6-6 6" />
                      </svg>
                    </button>
                  </li>
                )}
              />
            </ul>
            {/* L'ordinateur : la même liste, en tableau. */}
            <table className="tableau">
              <thead>
                <tr>
                  <th scope="col">{t("pme.notifs.societe")}</th>
                  <th scope="col">{t("pme.notifs.onglet.aTraiter")}</th>
                  <th scope="col">{t("pme.mesSocietes.aLire")}</th>
                  <th scope="col">{t("pme.mesSocietes.enRetard")}</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((l) => (
                  <tr key={l.id}>
                    <th scope="row">
                      <button type="button" onClick={() => ouvrir(l.id)}>
                        {l.name}
                      </button>
                    </th>
                    <td>{charge ? "—" : l.aTraiter}</td>
                    <td>{charge ? "—" : l.aLire}</td>
                    <td data-alerte={l.enRetard > 0 ? "" : undefined}>
                      {charge ? "—" : l.enRetard}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}
