/**
 * Ajouter une société (recette du 13 novembre 2026, A3) — l'écran court, dédié.
 *
 * Trois champs : matricule fiscal, raison sociale, adresse du siège. La juridiction et la
 * devise sont celles de la société en cours (le pack, jamais demandées) ; le mode de
 * validation est le défaut du produit (R10). La base rattache la société à la licence de son
 * propriétaire (`create_organization`, `20261222110000`) : cet écran ne décide d'aucun prix.
 *
 * La ligne d'état dit la vérité AVANT le geste, depuis ce que la base a déjà dit — l'offre,
 * les sociétés qu'elle comprend, le prix d'une société en plus (`mes_prix_en_plus`). Sur la
 * coque Android, aucune ligne d'offre ni de prix : elle ne vend rien.
 */
import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { COMMERCE } from "@/capabilities/coque";
import { usePme } from "@/components/malica/pme-context";
import { usePrix } from "@/hooks/use-decimales";
import { libelleDOffre, useCatalogueDesOffres } from "@/hooks/use-offres";
import { useI18n } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { ligneDeLaSocieteEnPlus } from "@/lib/societe-en-plus";
import { office } from "@/verticals/malica-office/composition";

export const Route = createFileRoute("/_authenticated/pme/societe-en-plus")({
  component: SocieteEnPlus,
});

const OU = "routes/_authenticated/pme.societe-en-plus";

function SocieteEnPlus() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pme = usePme();
  const aLEchelle = usePrix();
  const catalogue = useCatalogueDesOffres().data;
  const accueil = useQuery({
    queryKey: ["societe-en-plus-devis"],
    // `__COMMERCE__` : l'appel disparaît du paquet de la coque, qui ne vend rien.
    queryFn: __COMMERCE__ ? () => office().facturation.societeEnPlusDevis() : skipToken,
  });

  const [matricule, setMatricule] = useState("");
  const [nom, setNom] = useState("");
  const [adresse, setAdresse] = useState("");
  const [pending, setPending] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const retour = () => void navigate({ to: "/pme/reglages", search: { page: "societes" } });

  /**
   * Ce que la base dit de la licence qui accueillerait la société — pas celle de la société
   * ouverte, qui n'est pas forcément celle-là (un propriétaire de plusieurs licences). Rien n'est
   * calculé ici ; tant que la base n'a pas répondu, aucune phrase.
   */
  const ligne = (() => {
    if (!COMMERCE || accueil.data === undefined) return null;
    const l = ligneDeLaSocieteEnPlus(accueil.data);
    switch (l.cle) {
      case "pme.societe.rejointInclus":
        return t(l.cle, {
          offre: libelleDOffre(catalogue, l.offre),
          n: String(l.n),
          total: String(l.total),
        });
      case "pme.societe.rejointEnPlus":
        return t(l.cle, {
          offre: libelleDOffre(catalogue, l.offre),
          prix: aLEchelle(l.prix),
          devise: pme.currency,
        });
      case "pme.societe.propreAbonnement":
        return t(l.cle);
      case "pme.societe.rejoint":
        return t(l.cle, { offre: libelleDOffre(catalogue, l.offre) });
    }
  })();

  async function ajouter(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setErreur(null);
    try {
      await office().identity.createOrganization({
        kind: "pme",
        name: nom.trim(),
        legalId: matricule.trim() || null,
        // Celles de la société en cours : le pack, jamais demandées (R4).
        jurisdiction: pme.jurisdiction,
        currency: pme.currency,
        adresse: adresse.trim() || null,
      });
      await queryClient.invalidateQueries();
      await navigate({ to: "/office" });
    } catch (err) {
      setErreur(texteDeLErreur(err, OU, t("onboarding.error")));
    } finally {
      setPending(false);
    }
  }

  return (
    <div data-ecran="societe-en-plus" className="rg-rise">
      <div className="top">
        <button type="button" className="bk" aria-label={t("pme.regler.retour")} onClick={retour}>
          <svg viewBox="0 0 24 24" className="g" aria-hidden>
            <path d="M14.5 5.5L8 12l6.5 6.5" />
          </svg>
        </button>
      </div>
      <h1>{t("pme.societe.titre")}</h1>
      {ligne ? (
        <p className="t-body" data-ligne-d-etat aria-live="polite">
          {ligne}
        </p>
      ) : null}

      <form onSubmit={(e) => void ajouter(e)} className="mt-2">
        <label className="block">
          <span className="t-body">{t("onboarding.legalId")}</span>
          <input
            value={matricule}
            onChange={(e) => setMatricule(e.target.value)}
            autoComplete="off"
            className="num mt-2 h-[46px] w-full border border-line-strong bg-transparent px-3 text-[14px]"
          />
        </label>
        <label className="mt-2 block">
          <span className="t-body">{t("onboarding.name")}</span>
          <input
            value={nom}
            onChange={(e) => setNom(e.target.value)}
            required
            autoComplete="organization"
            className="mt-2 h-[46px] w-full border border-line-strong bg-transparent px-3 text-[14px]"
          />
        </label>
        <label className="mt-2 block">
          <span className="t-body">{t("onboarding.adresse")}</span>
          <input
            value={adresse}
            onChange={(e) => setAdresse(e.target.value)}
            autoComplete="street-address"
            className="mt-2 h-[46px] w-full border border-line-strong bg-transparent px-3 text-[14px]"
          />
        </label>

        {erreur ? (
          <p className="warn mt-2" role="alert">
            {erreur}
          </p>
        ) : null}

        <button type="submit" className="btn mt-2" disabled={pending || nom.trim() === ""}>
          {t("pme.societe.ajouter")}
        </button>
        <button type="button" className="btn btn-sec mt-2" onClick={retour}>
          {t("pme.societe.annuler")}
        </button>
      </form>
    </div>
  );
}
