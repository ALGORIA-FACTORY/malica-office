/**
 * L'abonnement, autour des écrans de la PME (décisions du 25 novembre 2026).
 *
 * L'essai gratuit :
 *   - en cours : une ligne en haut dit les jours qui restent, et « Passer à l'abonnement »
 *     — le titulaire paie quand il veut : c'est ainsi qu'on interrompt l'essai ;
 *   - terminé sans paiement : le dossier est fermé.
 *
 * Ce qui est dû (D7, D12) — aucune facture avant le paiement :
 *   - à payer : une ligne en haut dit le montant et le dernier jour, et « Payer » ;
 *   - non payé dans le délai : le dossier est fermé.
 *
 * Un dossier fermé l'est entièrement : ses données restent, seule la page de paiement reste
 * ouverte, et le paiement le rouvre. Aucun montant n'est calculé ici : la base chiffre ce que
 * le paiement émettra et le rend (R3).
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

const OU = "pme.abonnement";

/** La page de paiement reste ouverte quand le dossier est fermé : c'est elle qui le rouvre. */
const TOUJOURS_OUVERT = "/pme/payer/";

const BOUTON =
  "mt-3 min-h-[44px] border border-foreground bg-foreground px-4 text-xs uppercase tracking-wide text-background disabled:opacity-60";

export default function GardeDAbonnement({ children }: { children: ReactNode }) {
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
  const du = useQuery({
    queryKey: ["mon-echeance", pme.tenantId],
    queryFn: () => office().facturation.monEcheance(pme.tenantId),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
  const offre = pme.forfait.ligne?.offre ?? null;
  const allerPayer = (paiementId: string) =>
    void navigate({ to: "/pme/payer/$paiementId", params: { paiementId } });
  const passer = useMutation({
    mutationFn: () => office().facturation.changerForfait(offre!, pme.tenantId),
    onSuccess: (r) => {
      if (r.paiement) allerPayer(r.paiement.paiement_id);
    },
  });

  if (chemin.startsWith(TOUJOURS_OUVERT)) return <>{children}</>;

  const e = essai.data && essai.data.etat !== "converti" ? essai.data : null;
  const d = du.data ?? null;
  if (!e && !d) return <>{children}</>;

  const titulaire = (e ?? d)!.titulaire;
  const nonTitulaire = <p className="mt-2 text-sm text-text-2">{t("pme.abonnement.principal")}</p>;
  const erreur = passer.isError ? (
    <p role="alert" className="mt-2 text-sm text-[var(--etat-stop)]">
      {texteDeLErreur(passer.error, OU, t("common.error"))}
    </p>
  ) : null;
  // Ce qui est dû passe avant l'essai : c'est le paiement qui rouvre ou garde le dossier.
  const bouton = !titulaire ? (
    nonTitulaire
  ) : d ? (
    <button type="button" className={BOUTON} onClick={() => allerPayer(d.paiement_id)}>
      {t("pme.abonnement.payer")}
    </button>
  ) : (
    <button
      type="button"
      className={BOUTON}
      disabled={passer.isPending || offre === null}
      onClick={() => passer.mutate()}
    >
      {passer.isPending ? t("common.loading") : t("pme.essai.passer")}
    </button>
  );

  const ferme = d?.etat === "ferme" || e?.etat === "termine";
  if (ferme) {
    const titre = d?.etat === "ferme" ? "pme.abonnement.ferme.titre" : "pme.essai.termine.titre";
    const corps = d?.etat === "ferme" ? "pme.abonnement.ferme.corps" : "pme.essai.termine.corps";
    const date = d?.etat === "ferme" ? d.dernier_jour : e!.dernier_jour;
    return (
      <section
        aria-labelledby="abonnement-ferme"
        className="border border-[var(--etat-stop)] bg-card p-6"
      >
        <h1 id="abonnement-ferme" className="text-lg font-semibold">
          {t(titre)}
        </h1>
        <p className="mt-2 text-sm text-text-2">
          {t(corps, {
            date: dateEnLettres(date, locale),
            montant: d ? `${d.montant_ttc} ${d.devise}` : "",
          })}
        </p>
        {bouton}
        {erreur}
      </section>
    );
  }

  const ligne = d
    ? t("pme.abonnement.aPayer", {
        montant: `${d.montant_ttc} ${d.devise}`,
        date: dateEnLettres(d.dernier_jour, locale),
      })
    : t(e!.jours_restants <= 1 ? "pme.essai.enCours.dernier" : "pme.essai.enCours", {
        jours: e!.jours_restants,
        date: dateEnLettres(e!.dernier_jour, locale),
      });
  return (
    <>
      <div
        role="status"
        className={`mb-4 border bg-card px-4 py-3 ${d ? "border-[var(--etat-warn)]" : "border-[var(--etat-info)]"}`}
      >
        <p className="text-sm">{ligne}</p>
        {bouton}
        {erreur}
      </div>
      {children}
    </>
  );
}
