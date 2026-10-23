/**
 * Le paiement en ligne, une logique pour deux écrans.
 *
 * La société paie depuis ses réglages, le cabinet depuis ses abonnements
 * (23 octobre 2026) : deux surfaces, deux habillages, mais une seule façon de
 * choisir le moyen et de revenir de la page du prestataire. Ce qui est vrai
 * vient de la base — le montant, les moyens, l'état ; ce qui fait foi au
 * retour, c'est la réponse du PRESTATAIRE, jamais le navigateur.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { useI18n } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { office } from "@/verticals/malica-office/composition";
import type { MessageKey } from "@/i18n";
import type { MoyenDePaiement, PaiementEnLigne } from "@malica/socle/ports/repositories";

/**
 * Ce qu'on dit d'un paiement constaté. Une facture payée est réglée — si de
 * l'argent est entré : un « payé » du simulateur ne s'inscrit sur rien
 * (`impute` faux), et la facture reste due. Une montée, une recharge ou
 * l'année sont des acomptes qui figureront sur la facture du mois.
 */
function phraseDuPaye(p: Pick<PaiementEnLigne, "objet" | "impute">): MessageKey {
  if (p.objet !== "facture") return "pme.reglages.paiement.paye";
  return p.impute ? "pme.reglages.paiement.factureReglee" : "pme.reglages.paiement.simuleSansEffet";
}

/** Le paiement à régler, les moyens de la base, et le geste qui ouvre la page de carte. */
export function useChoixDuMoyen(paiementId: string, ou: string) {
  const { t, locale } = useI18n();
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
      if (r.paiement.etat === "paye") setMessage(t(phraseDuPaye(r.paiement)));
      else if (!r.ouvert) setMessage(t("pme.reglages.paiement.ferme"));
      else if (r.lien) window.location.assign(r.lien);
    },
    onError: (e: unknown) => setMessage(texteDeLErreur(e, ou, t("common.error"))),
  });

  /** Pourquoi un moyen ne se choisit pas ici, ou `null` s'il se choisit. */
  const empechement = (m: MoyenDePaiement): string | null =>
    !m.actif ? t("pme.payer.bientot") : !m.accepte ? t("pme.payer.indisponible") : null;

  return {
    paiements,
    choix,
    paiement: paiements.data?.find((p) => p.paiement_id === paiementId) ?? null,
    prestataire: choix.data?.prestataire ?? null,
    payer,
    message,
    empechement,
  };
}

/**
 * Revenu de la page du prestataire : l'adresse porte `?paiement=<id>`, et l'on
 * demande au PRESTATAIRE où en est le paiement — une fois, au montage. En
 * staging, `&simulateur=1` montre « payé » et « refusé » à la place d'une page
 * de carte.
 */
export function useRetourDuPrestataire(actif: boolean, ou: string, apres?: () => Promise<void>) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [retour, setRetour] = useState<string | null>(null);

  const ici = typeof window === "undefined" ? null : new URL(window.location.href);
  const revenu = ici?.searchParams.get("paiement") ?? null;
  const simulateur = ici?.searchParams.get("simulateur") === "1";

  const rafraichir = async () => {
    await apres?.();
    await qc.invalidateQueries({ queryKey: ["mes-paiements"] });
    await qc.invalidateQueries({ queryKey: ["mes-factures"] });
  };

  const verifier = useMutation({
    mutationFn: (id: string) => office().facturation.verifierPaiement(id),
    onSuccess: async (p) => {
      setRetour(
        p.etat === "paye"
          ? t(phraseDuPaye(p))
          : p.etat === "refuse"
            ? t("pme.reglages.paiement.refuse")
            : t("pme.reglages.paiement.enAttente"),
      );
      await rafraichir();
    },
    onError: (e: unknown) => setRetour(texteDeLErreur(e, ou, t("common.error"))),
  });

  const simuler = useMutation({
    mutationFn: (p: { id: string; decision: "paye" | "refuse" }) =>
      office().facturation.simulerPaiement(p.id, p.decision),
    onSuccess: async (p) => {
      setRetour(p.etat === "paye" ? t(phraseDuPaye(p)) : t("pme.reglages.paiement.refuse"));
      await rafraichir();
    },
    onError: (e: unknown) => setRetour(texteDeLErreur(e, ou, t("common.error"))),
  });

  const { mutate: verifierUneFois } = verifier;
  useEffect(() => {
    if (actif && revenu && !simulateur) verifierUneFois(revenu);
  }, [actif, revenu, simulateur, verifierUneFois]);

  return { revenu, simulateur, verifier, simuler, retour };
}
