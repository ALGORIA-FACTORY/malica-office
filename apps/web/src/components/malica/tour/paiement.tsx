/**
 * La carte « Paiement » de la tour — choisir le prestataire de paiement.
 *
 * Écran réservé aux opérateurs d'ALGORIA (la tour). L'opérateur voit le prestataire
 * actuel et choisit l'un de ceux que la base propose ; selon le prestataire retenu,
 * l'écran demande l'adresse de l'API ou l'adresse de retour. Un motif est obligatoire
 * pour enregistrer. La liste des prestataires, leur nom et ce qu'ils exigent viennent
 * d'une table (`prestatairesDePaiement`), pas de l'écran. Les secrets du compte marchand
 * restent sur le serveur : la carte dit seulement s'ils sont posés, jamais leur valeur.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { useI18n } from "@/i18n";
import { office } from "@/verticals/malica-office/composition";

import { BOUTON, CARTE, CHAMP, TEXTE, TITRE, useRetour } from "./commun";
import { dateCourte } from "./donnees";

export function ReglerLePaiement() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const { retour, setRetour, echec } = useRetour();
  const reglage = useQuery({
    queryKey: ["tour-paiement"],
    queryFn: () => office().tour.reglagePaiement(),
  });
  // Les prestataires, leur nom et ce qu'ils demandent : la table, pas l'écran.
  const prestataires = useQuery({
    queryKey: ["tour-prestataires", locale],
    queryFn: () => office().tour.prestatairesDePaiement(locale),
  });
  const [prestataire, setPrestataire] = useState("");
  const [urlApi, setUrlApi] = useState("");
  const [urlRetour, setUrlRetour] = useState("");
  const [motif, setMotif] = useState("");

  useEffect(() => {
    const r = reglage.data;
    if (!r) return;
    setPrestataire(r.prestataire);
    setUrlApi(r.url_api ?? "");
    setUrlRetour(r.url_retour ?? (typeof window === "undefined" ? "" : window.location.origin));
  }, [reglage.data]);

  const regler = useMutation({
    mutationFn: () =>
      office().tour.reglerPaiement(prestataire, urlApi || null, urlRetour || null, motif),
    onSuccess: async () => {
      setRetour(t("tour.fait"));
      setMotif("");
      await qc.invalidateQueries({ queryKey: ["tour-paiement"] });
    },
    onError: echec,
  });

  const choisi = prestataires.data?.find((p) => p.code === prestataire) ?? null;
  const libelleDe = (code: string) =>
    prestataires.data?.find((p) => p.code === code)?.libelle ?? code;

  return (
    <div className={CARTE}>
      <h2 className={TITRE}>{t("tour.paiement")}</h2>
      {reglage.data ? (
        <p className={TEXTE}>
          {t("tour.paiement.actuel", { prestataire: libelleDe(reglage.data.prestataire) })}
          {reglage.data.secrets_poses === null
            ? null
            : ` — ${
                reglage.data.secrets_poses
                  ? t("tour.paiement.secretsOui")
                  : t("tour.paiement.secretsNon")
              }`}
        </p>
      ) : null}
      <div className="mt-2 flex flex-col gap-2">
        <select
          value={prestataire}
          onChange={(e) => setPrestataire(e.target.value)}
          aria-label={t("tour.paiement.prestataire")}
          className={CHAMP}
        >
          {(prestataires.data ?? []).map((p) => (
            <option key={p.code} value={p.code}>
              {p.libelle}
            </option>
          ))}
        </select>
        {choisi?.exige_url_api ? (
          <input
            value={urlApi}
            onChange={(e) => setUrlApi(e.target.value)}
            placeholder={t("tour.paiement.urlApi")}
            aria-label={t("tour.paiement.urlApi")}
            className={CHAMP}
          />
        ) : null}
        {choisi?.ouvre_le_paiement ? (
          <input
            value={urlRetour}
            onChange={(e) => setUrlRetour(e.target.value)}
            placeholder={t("tour.paiement.urlRetour")}
            aria-label={t("tour.paiement.urlRetour")}
            className={CHAMP}
          />
        ) : null}
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
          disabled={regler.isPending || motif.trim() === ""}
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

/**
 * La carte « Conditions générales de vente » de la tour (20261231260000). Chaque client
 * accepte la version en vigueur en cochant la case avant de payer ; l'acceptation est gardée
 * avec le paiement. Une version mise en ligne sur le site se publie ici, sans déploiement :
 * datée (aujourd'hui ou plus tard), motivée, en ajout seul.
 */
export function ReglerLesCgv() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const { retour, setRetour, echec } = useRetour();
  const cgv = useQuery({ queryKey: ["tour-cgv"], queryFn: () => office().tour.cgvEnVigueur() });
  const [version, setVersion] = useState("");
  const [url, setUrl] = useState("");
  const [valideDes, setValideDes] = useState("");
  const [motif, setMotif] = useState("");

  const publier = useMutation({
    mutationFn: () => office().tour.reglerCgv(version, url.trim(), valideDes, motif),
    onSuccess: async () => {
      setRetour(t("tour.cgv.publiee"));
      setMotif("");
      await qc.invalidateQueries({ queryKey: ["tour-cgv"] });
    },
    onError: echec,
  });

  return (
    <div className={CARTE}>
      <h2 className={TITRE}>{t("tour.cgv.titre")}</h2>
      {cgv.data ? (
        <p className={TEXTE}>
          {t("tour.cgv.enVigueur", {
            version: dateCourte(cgv.data.version, locale),
            url: cgv.data.url,
            depuis: dateCourte(cgv.data.valide_des, locale),
          })}
        </p>
      ) : null}
      <p className={TEXTE}>{t("tour.cgv.aide")}</p>
      <div className="mt-2 flex flex-col gap-2">
        <label className={TEXTE}>
          {t("tour.cgv.version")}
          <input
            type="date"
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            className={CHAMP}
          />
        </label>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={t("tour.cgv.url")}
          aria-label={t("tour.cgv.url")}
          className={CHAMP}
        />
        <label className={TEXTE}>
          {t("tour.cgv.valideDes")}
          <input
            type="date"
            value={valideDes}
            onChange={(e) => setValideDes(e.target.value)}
            className={CHAMP}
          />
        </label>
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
            publier.isPending || !version || !url.trim() || !valideDes || motif.trim() === ""
          }
          onClick={() => publier.mutate()}
        >
          {t("tour.cgv.publier")}
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
