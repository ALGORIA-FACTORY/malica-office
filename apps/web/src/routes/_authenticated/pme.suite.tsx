/**
 * La suite de l'arrivée : le forfait, puis la comptabilité (recette du 14 novembre 2026, C1).
 *
 * « C'est exact — commencer » annonçait « choisir votre forfait, puis inviter votre
 * comptabilité — ou pas », puis ouvrait directement « Ajouter des pièces ». Cet écran tient
 * la promesse, en deux temps : le forfait se choisit dans les Réglages (sa page existe déjà),
 * puis la comptabilité s'invite au même endroit, ou se passe d'un geste.
 *
 * Il ne crée ni ne change rien lui-même : il mène aux écrans qui écrivent. Le retour ramène à
 * l'accueil ; l'arrivée est déjà marquée vue par « C'est exact ».
 */
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { useI18n } from "@/i18n";

export const Route = createFileRoute("/_authenticated/pme/suite")({
  head: () => ({
    meta: [
      { title: "Votre abonnement et votre comptabilité — Malica Office" },
      { name: "description", content: "Choisissez votre forfait, puis votre comptabilité." },
      { property: "og:title", content: "Votre abonnement et votre comptabilité — Malica Office" },
      { property: "og:type", content: "website" },
    ],
  }),
  component: Suite,
});

type Etape = "forfait" | "comptabilite";

function Suite() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [etape, setEtape] = useState<Etape>("forfait");

  return (
    <div
      data-ecran="suite"
      data-famille="papiers"
      className="-mx-4 -my-5 flex min-h-0 flex-1 flex-col"
    >
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
        <span className="ttl">{t("pme.suite.barre")}</span>
      </div>

      <div className="pad">
        <div className="dit">{t("pme.suite.titre")}</div>

        {etape === "forfait" ? (
          <>
            <div className="sec">
              <h2>{t("pme.suite.etape1")}</h2>
              <span>{t("pme.suite.etape1.sous")}</span>
            </div>
            <Link to="/pme/reglages" search={{ page: "abonnement" }} className="rw">
              <span className="bd">
                <b>{t("pme.suite.forfait.voir")}</b>
                <span>{t("pme.suite.forfait.aide")}</span>
              </span>
            </Link>
            <div className="go">
              <button type="button" className="pr" onClick={() => setEtape("comptabilite")}>
                {t("pme.suite.continuer")}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="sec">
              <h2>{t("pme.suite.etape2")}</h2>
              <span>{t("pme.suite.etape2.sous")}</span>
            </div>
            <Link to="/pme/reglages" search={{ page: "societes" }} className="rw">
              <span className="bd">
                <b>{t("pme.suite.compta.inviter")}</b>
                <span>{t("pme.suite.compta.inviter.aide")}</span>
              </span>
            </Link>
            <button
              type="button"
              className="rw"
              onClick={() => void navigate({ to: "/pme/capturer" })}
            >
              <span className="bd">
                <b>{t("pme.suite.compta.sans")}</b>
                <span>{t("pme.suite.compta.sans.aide")}</span>
              </span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
