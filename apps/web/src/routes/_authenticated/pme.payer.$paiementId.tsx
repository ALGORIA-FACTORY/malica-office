import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { COMMERCE } from "@/capabilities/coque";
import { useI18n } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { montant } from "@/lib/lisible";
import { office } from "@/verticals/malica-office/composition";
import type { MoyenDePaiement } from "@malica/socle/ports/repositories";

export const Route = createFileRoute("/_authenticated/pme/payer/$paiementId")({
  head: () => ({
    meta: [
      { title: "Moyen de paiement — Malica Office" },
      { name: "description", content: "Choisir comment régler un paiement en ligne." },
      { property: "og:title", content: "Moyen de paiement — Malica Office" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  // Payer, c'est vendre : pas dans l'application Android (`COMMERCE`). La page
  // n'entre pas dans son paquet, et une adresse tapée ramène aux réglages.
  beforeLoad: () => {
    if (!COMMERCE) throw redirect({ to: "/pme/reglages" });
  },
  component: COMMERCE ? ChoisirLeMoyen : () => null,
});

const OU = "routes/_authenticated/pme.payer.$paiementId";

/**
 * Le choix du moyen de paiement — web et PWA seulement.
 *
 * Tout ce que la page montre vient des tables (20261023110000) : les moyens,
 * leur logo, leur rang, leur nom dans la langue de la personne
 * (`ref.labels`, `moyen_en_ligne`), s'ils sont actifs et si le prestataire
 * que la tour a ouvert les accepte. La page ne décide de rien : un moyen
 * inactif se dit « bientôt disponible » (D17, tant que l'intégration de La
 * Poste n'est pas contractée), un moyen que le prestataire en service
 * n'accepte pas se dit « indisponible ici ». Le montant est celui que la base
 * a calculé ; la page de carte est celle du PRESTATAIRE.
 *
 * Au retour, la personne arrive sur les réglages, où le paiement est vérifié
 * auprès du prestataire (`ARegler`, `abonnement-pilote.tsx`).
 */
function ChoisirLeMoyen() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const { paiementId } = Route.useParams();
  const [message, setMessage] = useState<string | null>(null);

  const paiements = useQuery({
    queryKey: ["mes-paiements"],
    queryFn: () => office().facturation.mesPaiements(),
    retry: false,
  });
  const choix = useQuery({
    queryKey: ["moyens-de-paiement", locale],
    queryFn: () => office().facturation.moyensDePaiementEnLigne(locale),
    retry: false,
  });

  const payer = useMutation({
    mutationFn: (moyen: string) => office().facturation.payerEnLigne(paiementId, moyen),
    onSuccess: (r) => {
      if (r.paiement.etat === "paye") setMessage(t("pme.reglages.paiement.paye"));
      else if (!r.ouvert) setMessage(t("pme.reglages.paiement.ferme"));
      else if (r.lien) window.location.assign(r.lien);
    },
    onError: (e: unknown) => setMessage(texteDeLErreur(e, OU, t("common.error"))),
  });

  const paiement = paiements.data?.find((p) => p.paiement_id === paiementId) ?? null;
  const prestataire = choix.data?.prestataire ?? null;

  const etat = (m: MoyenDePaiement): string | null =>
    !m.actif ? t("pme.payer.bientot") : !m.accepte ? t("pme.payer.indisponible") : null;

  return (
    <div data-ecran="paiement" className="-mx-4 -my-5 flex min-h-0 flex-1 flex-col">
      <div className="top">
        <button
          type="button"
          className="bk"
          aria-label={t("pme.regler.retour")}
          onClick={() => void navigate({ to: "/pme/reglages" })}
        >
          <svg viewBox="0 0 24 24" className="g" aria-hidden>
            <path d="M14.5 5.5L8 12l6.5 6.5" />
          </svg>
        </button>
        <span className="ttl">{t("pme.payer.titre")}</span>
      </div>

      <div className="corps">
        {paiements.isPending || choix.isPending ? (
          <p className="et" aria-busy>
            {t("common.loading")}
          </p>
        ) : paiements.isError || choix.isError ? (
          <p className="warn" role="alert">
            {texteDeLErreur(paiements.error ?? choix.error, OU, t("common.error"))}
          </p>
        ) : !paiement || paiement.etat === "paye" ? (
          <p className="et">{t("pme.payer.rienARegler")}</p>
        ) : (
          <>
            <div className="du">
              <b>{paiement.libelle}</b>
              <span className="px">
                {t("pme.reglages.paiement.montant", {
                  ttc: montant(paiement.montant_ttc, locale),
                  devise: paiement.devise,
                })}
              </span>
            </div>

            {prestataire ? null : <p className="et">{t("pme.reglages.paiement.ferme")}</p>}

            <ul className="moyens">
              {(choix.data?.moyens ?? []).map((m) => {
                const pourquoi = etat(m);
                return (
                  <li key={m.code}>
                    <button
                      type="button"
                      className="moyen"
                      data-moyen={m.code}
                      disabled={pourquoi !== null || payer.isPending}
                      aria-describedby={pourquoi ? `moyen-${m.code}` : undefined}
                      onClick={() => payer.mutate(m.code)}
                    >
                      <span className="logo">
                        <img src={m.logo} alt="" />
                      </span>
                      <span className="nm">{m.libelle}</span>
                      {pourquoi ? (
                        <span className="et" id={`moyen-${m.code}`}>
                          {pourquoi}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>

            {prestataire ? (
              <p className="securise">
                {prestataire.logo ? (
                  <span className="logo">
                    <img src={prestataire.logo} alt="" />
                  </span>
                ) : null}
                {t("pme.payer.securise", { prestataire: prestataire.libelle })}
              </p>
            ) : null}
          </>
        )}
        {message ? (
          <p className="t-body" aria-live="polite">
            {message}
          </p>
        ) : null}
      </div>
    </div>
  );
}
