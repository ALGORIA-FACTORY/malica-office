/**
 * L'essai gratuit, autour des écrans de la PME (décision du 25 novembre 2026).
 *
 *   - en cours : une ligne en haut dit les jours qui restent, et « Passer à l'abonnement »
 *     — le titulaire paie quand il veut : c'est ainsi qu'on interrompt l'essai ;
 *   - terminé sans paiement : le dossier est fermé, entièrement. Ses données restent ; seule
 *     la page de paiement reste ouverte. Le paiement le rouvre ;
 *   - converti, ou sans essai : rien ne s'affiche.
 *
 * Un clic : `changerForfait` sur l'offre en cours (Basic pendant l'essai) rend le paiement à
 * régler, et l'écran va droit à la page de paiement. Aucun montant n'est calculé ici : la base
 * joue la première facture et la rend (R3).
 *
 * Commerce seulement : chargé en différé sous `COMMERCE`, jamais dans la coque.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { usePme } from "@/components/malica/pme-context";
import { useI18n } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { dateEnLettres } from "@/lib/lisible";
import { office } from "@/verticals/malica-office/composition";

const OU = "pme.essai";

/** La page de paiement reste ouverte quand l'essai est terminé : c'est elle qui le rouvre. */
const TOUJOURS_OUVERT = "/pme/payer/";

export default function GardeDEssai({ children }: { children: ReactNode }) {
  const { t, locale } = useI18n();
  const pme = usePme();
  const navigate = useNavigate();
  const chemin = useRouterState({ select: (s) => s.location.pathname });
  const essai = useQuery({
    queryKey: ["mon-essai", pme.tenantId],
    queryFn: () => office().facturation.monEssai(pme.tenantId),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
  const offre = pme.forfait.ligne?.offre ?? null;
  const passer = useMutation({
    mutationFn: () => office().facturation.changerForfait(offre!, pme.tenantId),
    onSuccess: (r) => {
      if (r.paiement) {
        void navigate({
          to: "/pme/payer/$paiementId",
          params: { paiementId: r.paiement.paiement_id },
        });
      }
    },
  });

  const e = essai.data;
  if (!e || e.etat === "converti" || chemin.startsWith(TOUJOURS_OUVERT)) return <>{children}</>;

  const bouton = e.titulaire ? (
    <button
      type="button"
      className="mt-3 min-h-[44px] border border-foreground bg-foreground px-4 text-xs uppercase tracking-wide text-background disabled:opacity-60"
      disabled={passer.isPending || offre === null}
      onClick={() => passer.mutate()}
    >
      {passer.isPending ? t("common.loading") : t("pme.essai.passer")}
    </button>
  ) : (
    <p className="mt-2 text-sm text-text-2">{t("pme.essai.demanderAuPrincipal")}</p>
  );
  const erreur = passer.isError ? (
    <p role="alert" className="mt-2 text-sm text-[var(--etat-stop)]">
      {texteDeLErreur(passer.error, OU, t("common.error"))}
    </p>
  ) : null;

  if (e.etat === "termine") {
    return (
      <section
        aria-labelledby="essai-termine"
        className="border border-[var(--etat-stop)] bg-card p-6"
      >
        <h1 id="essai-termine" className="text-lg font-semibold">
          {t("pme.essai.termine.titre")}
        </h1>
        <p className="mt-2 text-sm text-text-2">
          {t("pme.essai.termine.corps", { date: dateEnLettres(e.dernier_jour, locale) })}
        </p>
        {bouton}
        {erreur}
      </section>
    );
  }

  return (
    <>
      <div role="status" className="mb-4 border border-[var(--etat-info)] bg-card px-4 py-3">
        <p className="text-sm">
          {t(e.jours_restants <= 1 ? "pme.essai.enCours.dernier" : "pme.essai.enCours", {
            jours: e.jours_restants,
            date: dateEnLettres(e.dernier_jour, locale),
          })}
        </p>
        {bouton}
        {erreur}
      </div>
      {children}
    </>
  );
}
