import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { useI18n } from "@/i18n";
import { office } from "@/verticals/malica-office/composition";

import { ALERTE, BOUTON, CARTE, CHAMP, TEXTE, TITRE, useRetour } from "./commun";

/**
 * L'abonnement, réglé par la tour (19 octobre 2026) : le report d'un mois, et
 * l'année — ouverte ou non, et combien de mois elle offre. Et, depuis le
 * 25 novembre 2026, les jours d'essai gratuit des NOUVELLES entrées : un essai
 * fige ses jours à la naissance de la licence, un changement ne touche que les
 * suivantes. Et le délai après lequel un dossier dont le dû n'est pas payé
 * ferme (D12, 25 novembre 2026) : la facture ne naît qu'au paiement.
 *
 * La base calcule tout (`facturation.report_de`, `public.mon_annuel`) ; la
 * tour ne règle que les interrupteurs et le nombre, datés et motivés. Un
 * changement de mois offerts ne touche pas les engagements déjà pris : ils
 * gardent le nombre du jour où ils ont été souscrits.
 */
export function ReglerLAbonnement() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const { retour, setRetour, echec } = useRetour();
  const reglage = useQuery({
    queryKey: ["tour-abonnement"],
    queryFn: () => office().tour.reglageAbonnement(),
  });
  const [report, setReport] = useState<0 | 1>(1);
  const [annuel, setAnnuel] = useState(true);
  const [offerts, setOfferts] = useState("2");
  const [essai, setEssai] = useState("0");
  const [delai, setDelai] = useState("14");
  const [blocage, setBlocage] = useState("14");
  const [suspension, setSuspension] = useState("30");
  const [motif, setMotif] = useState("");

  useEffect(() => {
    if (!reglage.data) return;
    setReport(reglage.data.report_mois === 1 ? 1 : 0);
    setAnnuel(reglage.data.annuel_ouvert);
    setOfferts(String(reglage.data.annuel_mois_offerts));
    setEssai(String(reglage.data.essai_jours));
    setDelai(String(reglage.data.renouvellement_delai_jours));
    // Sans réglage encore, la base ne rend rien : le champ garde son point de départ.
    if (reglage.data.releve_blocage_jours != null)
      setBlocage(String(reglage.data.releve_blocage_jours));
    if (reglage.data.releve_suspension_jours != null)
      setSuspension(String(reglage.data.releve_suspension_jours));
  }, [reglage.data]);

  const nOfferts = Number.parseInt(offerts, 10);
  const offertsValide = Number.isInteger(nOfferts) && nOfferts >= 0 && nOfferts <= 11;
  const nEssai = Number.parseInt(essai, 10);
  const essaiValide = /^\d+$/.test(essai) && nEssai >= 0 && nEssai <= 90;
  const nDelai = Number.parseInt(delai, 10);
  const delaiValide = /^\d+$/.test(delai) && nDelai >= 1 && nDelai <= 90;
  // Le relevé de la comptabilité (D11) : les attributions ferment, puis ses clients sont suspendus.
  const nBlocage = Number.parseInt(blocage, 10);
  const nSuspension = Number.parseInt(suspension, 10);
  const releveValide =
    /^\d+$/.test(blocage) &&
    /^\d+$/.test(suspension) &&
    nBlocage >= 1 &&
    nBlocage <= 90 &&
    nSuspension >= nBlocage &&
    nSuspension <= 180;

  const regler = useMutation({
    mutationFn: () =>
      office().tour.reglerAbonnement(
        report,
        annuel,
        nOfferts,
        nEssai,
        nDelai,
        nBlocage,
        nSuspension,
        motif,
      ),
    onSuccess: async () => {
      setRetour(t("tour.fait"));
      setMotif("");
      await qc.invalidateQueries({ queryKey: ["tour-abonnement"] });
    },
    onError: echec,
  });

  return (
    <div className={CARTE}>
      <h2 className={TITRE}>{t("tour.abonnement")}</h2>
      <p className={TEXTE}>{t("tour.abonnement.report.aide")}</p>
      {reglage.data?.decide_le ? (
        <p className={TEXTE}>
          {t(
            reglage.data.report_mois === 1
              ? "tour.abonnement.report.oui"
              : "tour.abonnement.report.non",
            {
              date: new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(
                new Date(reglage.data.decide_le),
              ),
            },
          )}
        </p>
      ) : null}
      <div className="mt-2 flex flex-col gap-2">
        <select
          value={report}
          onChange={(e) => setReport(e.target.value === "1" ? 1 : 0)}
          aria-label={t("tour.abonnement.report")}
          className={CHAMP}
        >
          <option value="1">{t("tour.abonnement.report.un")}</option>
          <option value="0">{t("tour.abonnement.report.aucun")}</option>
        </select>
        <p className={TEXTE}>{t("tour.abonnement.annuel.aide")}</p>
        <select
          value={annuel ? "1" : "0"}
          onChange={(e) => setAnnuel(e.target.value === "1")}
          aria-label={t("tour.abonnement.annuel")}
          className={CHAMP}
        >
          <option value="1">{t("tour.abonnement.annuel.ouvert")}</option>
          <option value="0">{t("tour.abonnement.annuel.ferme")}</option>
        </select>
        <label className={TEXTE}>
          {t("tour.abonnement.annuel.offerts")}
          <input
            value={offerts}
            onChange={(e) => setOfferts(e.target.value)}
            inputMode="numeric"
            aria-label={t("tour.abonnement.annuel.offerts")}
            className={`${CHAMP} mt-1 w-full`}
          />
        </label>
        {!offertsValide ? (
          <p className={ALERTE}>{t("tour.abonnement.annuel.offerts.borne")}</p>
        ) : null}
        <p className={TEXTE}>{t("tour.abonnement.essai.aide")}</p>
        <label className={TEXTE}>
          {t("tour.abonnement.essai")}
          <input
            value={essai}
            onChange={(e) => setEssai(e.target.value)}
            inputMode="numeric"
            aria-label={t("tour.abonnement.essai")}
            className={`${CHAMP} mt-1 w-full`}
          />
        </label>
        {!essaiValide ? <p className={ALERTE}>{t("tour.abonnement.essai.borne")}</p> : null}
        <p className={TEXTE}>{t("tour.abonnement.delai.aide")}</p>
        <label className={TEXTE}>
          {t("tour.abonnement.delai")}
          <input
            value={delai}
            onChange={(e) => setDelai(e.target.value)}
            inputMode="numeric"
            aria-label={t("tour.abonnement.delai")}
            className={`${CHAMP} mt-1 w-full`}
          />
        </label>
        {!delaiValide ? <p className={ALERTE}>{t("tour.abonnement.delai.borne")}</p> : null}
        <p className={TEXTE}>{t("tour.abonnement.releve.aide")}</p>
        <label className={TEXTE}>
          {t("tour.abonnement.releve.blocage")}
          <input
            value={blocage}
            onChange={(e) => setBlocage(e.target.value)}
            inputMode="numeric"
            aria-label={t("tour.abonnement.releve.blocage")}
            className={`${CHAMP} mt-1 w-full`}
          />
        </label>
        <label className={TEXTE}>
          {t("tour.abonnement.releve.suspension")}
          <input
            value={suspension}
            onChange={(e) => setSuspension(e.target.value)}
            inputMode="numeric"
            aria-label={t("tour.abonnement.releve.suspension")}
            className={`${CHAMP} mt-1 w-full`}
          />
        </label>
        {!releveValide ? <p className={ALERTE}>{t("tour.abonnement.releve.borne")}</p> : null}
        <input
          value={motif}
          onChange={(e) => setMotif(e.target.value)}
          placeholder={t("common.motif")}
          aria-label={t("common.motif")}
          className={CHAMP}
        />
        <button
          type="button"
          className={BOUTON}
          disabled={
            regler.isPending ||
            motif.trim() === "" ||
            !offertsValide ||
            !essaiValide ||
            !delaiValide ||
            !releveValide
          }
          onClick={() => regler.mutate()}
        >
          {t("tour.enregistrer")}
        </button>
      </div>
      {retour ? (
        <p className={TEXTE} aria-live="polite">
          {retour}
        </p>
      ) : null}
    </div>
  );
}
