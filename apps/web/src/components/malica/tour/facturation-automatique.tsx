import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { useI18n, type MessageKey } from "@/i18n";
import { office } from "@/verticals/malica-office/composition";

import { ALERTE, BOUTON, CARTE, CHAMP, TEXTE, TITRE, useRetour } from "./commun";

const ENTIER = /^\d+$/;

/**
 * L'émission automatique des factures mensuelles (décision du 4 novembre
 * 2026) : chaque jour, Malica émet les factures des mois clos qui manquent,
 * une par payeur et par mois, au prorata, jamais deux. La tour l'ouvre ou la
 * coupe, motif à l'appui, règle combien de mois clos chaque passage examine,
 * et voit ce que le dernier passage a fait. La base décide de tout le reste.
 */
export function LaFacturationAutomatique() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const { retour, setRetour, echec } = useRetour();
  const etat = useQuery({
    queryKey: ["tour-facturation-auto"],
    queryFn: () => office().tour.reglageFacturationAuto(),
  });
  const [rattrapage, setRattrapage] = useState("");
  const [motif, setMotif] = useState("");

  useEffect(() => {
    const r = etat.data?.reglage;
    if (r) setRattrapage(String(r.rattrapage_mois));
  }, [etat.data]);

  const r = etat.data?.reglage ?? null;
  const dernier = etat.data?.dernier ?? null;
  const valide = ENTIER.test(rattrapage.trim()) && Number(rattrapage) >= 1;
  const pret = etat.isSuccess && valide && motif.trim() !== "";

  const regler = useMutation({
    mutationFn: (actif: boolean) =>
      office().tour.reglerFacturationAuto(actif, Number(rattrapage), motif),
    onSuccess: async () => {
      setRetour(t("tour.fait"));
      setMotif("");
      await qc.invalidateQueries({ queryKey: ["tour-facturation-auto"] });
    },
    onError: echec,
  });

  const date = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(new Date(iso));
  const qui = r?.decide_par_nom ?? r?.decide_par_email ?? null;
  const compteurs: Array<{ cle: MessageKey; n: number; couleur: string }> = dernier
    ? [
        { cle: "tour.facturation.compteur.emises", n: dernier.emises, couleur: "" },
        { cle: "tour.facturation.compteur.deja", n: dernier.deja_emises, couleur: "" },
        { cle: "tour.facturation.compteur.rien", n: dernier.rien_a_facturer, couleur: "" },
        {
          cle: "tour.facturation.compteur.erreurs",
          n: dernier.erreurs,
          couleur: dernier.erreurs > 0 ? "text-signal-stop" : "",
        },
      ]
    : [];

  return (
    <div className={CARTE} data-facturation-auto>
      <h2 className={TITRE}>{t("tour.facturation")}</h2>
      <p className={TEXTE}>{t("tour.facturation.aide")}</p>
      {r ? (
        <>
          <p className={`${TEXTE} ${r.actif ? "text-signal-ok" : ""}`} data-etat>
            {t(r.actif ? "tour.facturation.etat.ouverte" : "tour.facturation.etat.coupee", {
              date: date(r.decide_le),
            })}
          </p>
          <p className={TEXTE} data-par>
            {qui ? t("tour.facturation.par", { qui }) : t("tour.facturation.parLaLivraison")}
          </p>
          <p className={TEXTE} data-motif>
            {t("tour.facturation.motif", { motif: r.motif })}
          </p>
        </>
      ) : etat.isPending ? (
        <p className={TEXTE}>{t("common.loading")}</p>
      ) : null}

      <div className="mt-2 flex flex-col gap-2">
        <label className={TEXTE}>
          {t("tour.facturation.rattrapage")}
          <input
            value={rattrapage}
            onChange={(e) => setRattrapage(e.target.value)}
            inputMode="numeric"
            aria-label={t("tour.facturation.rattrapage")}
            className={`${CHAMP} mt-1 w-full`}
          />
        </label>
        <p className={TEXTE}>{t("tour.facturation.rattrapage.aide")}</p>
        {!valide && etat.isSuccess ? (
          <p className={ALERTE}>{t("tour.facturation.invalide")}</p>
        ) : null}
        <input
          value={motif}
          onChange={(e) => setMotif(e.target.value)}
          placeholder={t("common.motif")}
          aria-label={t("common.motif")}
          className={CHAMP}
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            data-basculer
            className={BOUTON}
            disabled={regler.isPending || !pret}
            onClick={() => regler.mutate(!r?.actif)}
          >
            {t(r?.actif ? "tour.facturation.couper" : "tour.facturation.ouvrir")}
          </button>
          {r?.actif ? (
            <button
              type="button"
              className={BOUTON}
              disabled={regler.isPending || !pret}
              onClick={() => regler.mutate(true)}
            >
              {t("tour.enregistrer")}
            </button>
          ) : null}
        </div>
      </div>
      {retour ? (
        <p className={TEXTE} aria-live="polite">
          {retour}
        </p>
      ) : null}

      <h3 className={`${TITRE} mt-4`}>
        {dernier
          ? t("tour.facturation.dernier", { date: date(dernier.passee_le) })
          : t("tour.facturation.dernier.aucun")}
      </h3>
      {dernier ? (
        <>
          <ul className="grid gap-1 sm:grid-cols-4" data-compteurs>
            {compteurs.map((c) => (
              <li key={c.cle} className={TEXTE} data-compteur={c.cle}>
                {t(c.cle)} · <span className={`num ${c.couleur}`}>{c.n}</span>
              </li>
            ))}
          </ul>
          {dernier.detail_erreurs.length > 0 ? (
            <ul className="grid gap-1">
              {dernier.detail_erreurs.map((e) => (
                <li
                  key={`${e.licence ?? e.cabinet ?? ""}-${e.periode}`}
                  className={`${TEXTE} text-signal-stop`}
                  data-erreur
                >
                  <span className="num">{e.periode}</span> · <span className="num">{e.cle}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
